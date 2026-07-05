/* =========================================================================
   support-contact.js
   -------------------------------------------------------------------------
   Admin-managed "Contact Us" info shown in the footer popup on index.html
   (see footer-contact.js), backed by Firestore (same live-feed pattern as
   broadcast.js / catalog-firestore.js).

   Firestore layout:
     - app_config/supportContact -> {
         email: string,
         phone: string,
         extraInfo: [{ id, label, value }, ...],  // admin add/remove list,
                                                    // e.g. "Live Chat Hours",
                                                    // "Office Address"
         updatedAt, updatedBy
       }

   Exposes window.svSupportContact:
     - subscribe(callback)  -> callback(info) now + on every change; returns unsubscribe fn
     - getSnapshot()        -> most recent info object (sync)
     - ready()               -> promise, resolves after first snapshot arrives
     - save({email, phone, extraInfo}) -> async, admin-only: persists the full record
   ========================================================================= */

import { db } from "./firebase-auth.js";
import {
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CONFIG_DOC = "app_config/supportContact";

const DEFAULT_INFO = {
  email: "support@streamverse.example",
  phone: "",
  extraInfo: []
};

let latestInfo = { ...DEFAULT_INFO };
let infoLoaded = false;
const infoListeners = new Set();
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

function emit() {
  if (!infoLoaded) return;
  resolveReady();
  infoListeners.forEach((cb) => {
    try { cb(latestInfo); } catch (e) { console.error("svSupportContact listener error:", e); }
  });
}

onSnapshot(doc(db, CONFIG_DOC), (snap) => {
  latestInfo = snap.exists()
    ? { ...DEFAULT_INFO, ...snap.data(), extraInfo: Array.isArray(snap.data().extraInfo) ? snap.data().extraInfo : [] }
    : { ...DEFAULT_INFO };
  infoLoaded = true;
  emit();
}, (err) => {
  console.error("svSupportContact listener error:", err);
  // Fail open with the defaults so the popup still shows something.
  infoLoaded = true;
  emit();
});

async function svLogSafe(message) {
  if (window.svAuth && typeof window.svAuth.log === "function") window.svAuth.log(message);
}

const svSupportContact = {
  subscribe(cb) {
    infoListeners.add(cb);
    if (infoLoaded) cb(latestInfo);
    return () => infoListeners.delete(cb);
  },

  getSnapshot() {
    return latestInfo;
  },

  ready() {
    return readyPromise;
  },

  /** Admin-only: replaces the full support-contact record. extraInfo is
   *  saved as-is (array of {id,label,value}) so the admin panel's
   *  add/remove rows map directly to what viewers see in the popup. */
  async save({ email, phone, extraInfo } = {}) {
    const admin = window.svAuth ? await window.svAuth.currentUser() : null;
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can update contact support info." };
    }
    const cleanExtra = (Array.isArray(extraInfo) ? extraInfo : [])
      .map((f) => ({
        id: f.id || `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: (f.label || "").trim(),
        value: (f.value || "").trim()
      }))
      .filter((f) => f.label || f.value);

    const record = {
      email: (email || "").trim(),
      phone: (phone || "").trim(),
      extraInfo: cleanExtra,
      updatedAt: Date.now(),
      updatedBy: admin.username
    };
    await setDoc(doc(db, CONFIG_DOC), record);
    await svLogSafe(`Admin ${admin.username} updated the Contact Us support info`);
    return { ok: true };
  }
};

window.svSupportContact = svSupportContact;
window.dispatchEvent(new Event("svSupportContactReady"));
