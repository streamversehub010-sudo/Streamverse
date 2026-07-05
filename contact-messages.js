/* =========================================================================
   contact-messages.js
   -------------------------------------------------------------------------
   Stores "Contact Us" popup submissions (footer-contact.js) in Firestore
   instead of emailing them out via EmailJS. Every submission lands in the
   admin panel's Broadcast tab, under "Contact Messages", in real time —
   same live-feed pattern as broadcast.js / catalog-firestore.js.

   Why this replaced EmailJS: the popup form no longer requires a Premium
   plan, so everyone (including signed-out visitors) can use it — and
   routing every submission through the admin panel means there's one
   inbox to check instead of relying on a third-party email relay.

   Firestore layout:
     - contactMessages/{id} -> { name, email, type, message, userId,
                                  plan, createdAt, read }

   Exposes window.svContactMessages:
     - subscribe(callback) -> callback(list) now + on every change; returns unsubscribe fn
     - getSnapshot()        -> most recent messages array (sync, newest first)
     - ready()              -> promise, resolves after first snapshot arrives
     - submit({name,email,type,message,userId,plan}) -> async: file a new message
     - markRead(id, read)   -> async: toggle read/unread (admin panel)
     - remove(id)           -> async: delete one message
     - clearAll()           -> async: delete every message
   ========================================================================= */

import { db } from "./firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const MESSAGES_COLLECTION = "contactMessages";
const MAX_MESSAGES = 300;

let latestMessages = [];
let messagesLoaded = false;
const messageListeners = new Set();
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

function emitMessages() {
  if (!messagesLoaded) return;
  resolveReady();
  messageListeners.forEach((cb) => {
    try { cb(latestMessages); } catch (e) { console.error("svContactMessages listener error:", e); }
  });
}

onSnapshot(collection(db, MESSAGES_COLLECTION), (snap) => {
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  latestMessages = list.slice(0, MAX_MESSAGES);
  messagesLoaded = true;
  emitMessages();
}, (err) => console.error("svContactMessages listener error:", err));

async function svLogSafe(message) {
  if (window.svAuth && typeof window.svAuth.log === "function") window.svAuth.log(message);
}

const svContactMessages = {
  subscribe(cb) {
    messageListeners.add(cb);
    if (messagesLoaded) cb(latestMessages);
    return () => messageListeners.delete(cb);
  },

  getSnapshot() {
    return latestMessages;
  },

  ready() {
    return readyPromise;
  },

  /** Files a new Contact Us submission. Open to everyone — signed-out
   *  visitors included — since this is no longer a Premium-only perk. */
  async submit({ name, email, type, message, userId, plan } = {}) {
    email = (email || "").trim();
    message = (message || "").trim();
    if (!email) return { ok: false, error: "An email address is required." };
    if (!message) return { ok: false, error: "A message is required." };

    await addDoc(collection(db, MESSAGES_COLLECTION), {
      name: (name || "").trim() || "StreamVerse visitor",
      email,
      type: type || "Feedback",
      message,
      userId: userId || null,
      plan: plan || "guest",
      createdAt: Date.now(),
      read: false
    });
    await svLogSafe(`Contact Us message received from ${email}`);
    return { ok: true };
  },

  async markRead(id, read = true) {
    await updateDoc(doc(db, MESSAGES_COLLECTION, id), { read: !!read });
  },

  async remove(id) {
    const item = latestMessages.find((m) => m.id === id);
    await deleteDoc(doc(db, MESSAGES_COLLECTION, id));
    await svLogSafe(`Contact message removed: ${item ? item.email : id}`);
  },

  async clearAll() {
    const batch = writeBatch(db);
    const docs = await getDocs(collection(db, MESSAGES_COLLECTION));
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await svLogSafe("All contact messages cleared.");
  }
};

window.svContactMessages = svContactMessages;
window.dispatchEvent(new Event("svContactMessagesReady"));
