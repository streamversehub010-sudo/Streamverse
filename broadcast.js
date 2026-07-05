/* =========================================================================
   broadcast.js
   -------------------------------------------------------------------------
   Real-time, site-wide announcements for StreamVerse, backed by Firestore
   (same "live feed" pattern as catalog-firestore.js).

   What this powers:
     - Admin > Broadcast panel: send a message to every registered user
       (downtime notices, "new movie incoming" hype, cinema ticket news,
       etc). Every open browser/tab/device gets it pushed instantly via
       onSnapshot() — no refresh, no per-user fan-out needed.
     - A single admin-controlled toggle: "Notify everyone when a title
       goes live". When ON, starting a stream from the Live Dashboard
       also drops a broadcast into every user's notification center.
     - notifications.js merges these into the same bell/panel viewers
       already use for personal alerts (badge unlocks, etc), so there is
       one unified notification center per user.

   Firestore layout:
     - broadcasts/{id}        -> { icon, title, body, category, createdAt, createdBy }
       (createdAt is a client timestamp number so ordering/rendering
       doesn't have to wait on serverTimestamp() resolution)
     - app_config/broadcast   -> { liveNotifyEnabled: boolean }
       Single settings doc the admin toggle reads/writes.

   Because every notification is one shared Firestore doc (not copied
   into each user's own storage), "read" state is tracked per-browser in
   localStorage instead (see notifications.js) — the same way a person
   dismissing an email newsletter doesn't delete it for everyone else.

   Exposes window.svBroadcast:
     - subscribe(callback)         -> callback(list) now + on every change; returns unsubscribe fn
     - getSnapshot()                -> most recent broadcasts array (sync, newest first)
     - ready()                      -> promise, resolves after first snapshot arrives
     - send({icon,title,body,category}) -> async: publish a new broadcast to all users
     - remove(id)                   -> async: delete a broadcast
     - clearAll()                   -> async: delete every broadcast
     - getLiveNotifyEnabled()       -> sync, current cached value (defaults true)
     - subscribeLiveNotify(cb)      -> callback(bool) now + on every change; returns unsubscribe fn
     - setLiveNotifyEnabled(bool)   -> async: flip the admin toggle
     - notifyLiveIfEnabled(movie)   -> async: if the toggle is on, auto-broadcasts
                                        "<title> is streaming live now"
   ========================================================================= */

import { db } from "./firebase-auth.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDocs,
  setDoc,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const BROADCASTS_COLLECTION = "broadcasts";
const CONFIG_DOC = "app_config/broadcast";
const MAX_BROADCASTS = 100;

let latestBroadcasts = [];
let broadcastsLoaded = false;
const broadcastListeners = new Set();
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

let liveNotifyEnabled = true; // sensible default until Firestore confirms otherwise
let liveNotifyLoaded = false;
const liveNotifyListeners = new Set();

function emitBroadcasts() {
  if (!broadcastsLoaded) return;
  resolveReady();
  broadcastListeners.forEach((cb) => {
    try { cb(latestBroadcasts); } catch (e) { console.error("svBroadcast listener error:", e); }
  });
}

function emitLiveNotify() {
  if (!liveNotifyLoaded) return;
  liveNotifyListeners.forEach((cb) => {
    try { cb(liveNotifyEnabled); } catch (e) { console.error("svBroadcast liveNotify listener error:", e); }
  });
}

onSnapshot(collection(db, BROADCASTS_COLLECTION), (snap) => {
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  latestBroadcasts = list.slice(0, MAX_BROADCASTS);
  broadcastsLoaded = true;
  emitBroadcasts();
}, (err) => console.error("svBroadcast broadcasts listener error:", err));

onSnapshot(doc(db, CONFIG_DOC), (snap) => {
  liveNotifyEnabled = snap.exists() ? snap.data().liveNotifyEnabled !== false : true;
  liveNotifyLoaded = true;
  emitLiveNotify();
}, (err) => console.error("svBroadcast config listener error:", err));

async function svLogSafe(message) {
  if (window.svAuth && typeof window.svAuth.log === "function") window.svAuth.log(message);
}

const svBroadcast = {
  subscribe(cb) {
    broadcastListeners.add(cb);
    if (broadcastsLoaded) cb(latestBroadcasts);
    return () => broadcastListeners.delete(cb);
  },

  getSnapshot() {
    return latestBroadcasts;
  },

  ready() {
    return readyPromise;
  },

  /** Publishes a new site-wide announcement. category is one of
   *  'general' | 'downtime' | 'new-movie' | 'tickets' (used only to pick
   *  a default icon when none is supplied). */
  async send({ icon, title, body, category } = {}) {
    title = (title || "").trim();
    body = (body || "").trim();
    if (!title) return { ok: false, error: "A title is required." };

    const defaultIcons = { downtime: "🛠️", "new-movie": "🎬", tickets: "🎟️", general: "📢" };
    const admin = window.svAuth ? await window.svAuth.currentUser() : null;

    await addDoc(collection(db, BROADCASTS_COLLECTION), {
      icon: icon || defaultIcons[category] || "📢",
      title,
      body,
      category: category || "general",
      createdAt: Date.now(),
      createdBy: admin ? admin.username : "Admin"
    });
    await svLogSafe(`Broadcast sent to all users: ${title}`);
    return { ok: true };
  },

  async remove(id) {
    const item = latestBroadcasts.find((b) => b.id === id);
    await deleteDoc(doc(db, BROADCASTS_COLLECTION, id));
    await svLogSafe(`Broadcast removed: ${item ? item.title : id}`);
  },

  async clearAll() {
    const batch = writeBatch(db);
    const docs = await getDocs(collection(db, BROADCASTS_COLLECTION));
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await svLogSafe("All broadcasts cleared.");
  },

  getLiveNotifyEnabled() {
    return liveNotifyEnabled;
  },

  subscribeLiveNotify(cb) {
    liveNotifyListeners.add(cb);
    if (liveNotifyLoaded) cb(liveNotifyEnabled);
    return () => liveNotifyListeners.delete(cb);
  },

  async setLiveNotifyEnabled(enabled) {
    await setDoc(doc(db, CONFIG_DOC), { liveNotifyEnabled: !!enabled }, { merge: true });
    await svLogSafe(`Live-stream broadcast notifications turned ${enabled ? "ON" : "OFF"}.`);
  },

  /** Called by the admin dashboard's Live toggle. Only publishes when
   *  the admin has left the "notify everyone" switch on. */
  async notifyLiveIfEnabled(movie) {
    if (!liveNotifyEnabled || !movie) return;
    await svBroadcast.send({
      icon: "🔴",
      title: `Now streaming live: ${movie.title}`,
      body: "It's live right now on StreamVerse — jump in before it ends.",
      category: "new-movie"
    });
  }
};

window.svBroadcast = svBroadcast;
window.dispatchEvent(new Event("svBroadcastReady"));
