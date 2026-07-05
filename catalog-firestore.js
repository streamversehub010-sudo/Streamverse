/* =========================================================================
   catalog-firestore.js
   -------------------------------------------------------------------------
   Real-time, cross-device movie catalog for StreamVerse, backed by
   Firestore instead of localStorage.

   Design (same "overlay" idea as the old localStorage version, just
   synced through Firestore now):
     - movieDatabase (movies-data.js) is the read-only "factory" catalog,
       bundled with the site.
     - Firestore collection `movie_overrides/{id}` holds any titles an
       admin has added or edited. Each doc *is* the full movie object.
     - Firestore collection `movie_deleted/{id}` holds a marker doc for
       any factory title an admin has removed (doc existing = deleted).
     - The merged, live catalog = movieDatabase + overrides - deleted.

   Because this uses onSnapshot() listeners, every browser/tab/device
   with the site open gets catalog edits pushed to it in real time —
   no refresh needed, and admin changes are visible to every viewer and
   every other admin session immediately.

   Exposes window.svCatalog:
     - subscribe(callback)      -> callback(mergedMoviesObject) now + on every change; returns an unsubscribe function
     - getSnapshot()            -> the most recent merged catalog (sync, may be {} before first snapshot arrives)
     - saveMovie(movie)         -> async: create/update a title
     - deleteMovie(id)          -> async: remove a title from the live catalog
     - resetCatalog()           -> async: clear all overrides/deletions, restoring factory defaults
   ========================================================================= */

import { db } from "./firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const OVERRIDES_COLLECTION = "movie_overrides";
const DELETED_COLLECTION = "movie_deleted";

let overrides = {};   // id -> movie object, from Firestore
let deletedIds = {};  // id -> true, from Firestore
let overridesLoaded = false;
let deletedLoaded = false;

let latestSnapshot = {};
const listeners = new Set();
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

function computeMerged(){
  const base = (typeof movieDatabase !== "undefined") ? movieDatabase : {};
  const merged = Object.assign({}, base, overrides);
  Object.keys(deletedIds).forEach((id) => delete merged[id]);
  return merged;
}

function emit(){
  if (!overridesLoaded || !deletedLoaded) return; // wait for both initial reads
  latestSnapshot = computeMerged();
  resolveReady();
  listeners.forEach((cb) => {
    try { cb(latestSnapshot); } catch (e) { console.error("svCatalog listener error:", e); }
  });
}

onSnapshot(collection(db, OVERRIDES_COLLECTION), (snap) => {
  const next = {};
  snap.forEach((d) => { next[d.id] = d.data(); });
  overrides = next;
  overridesLoaded = true;
  emit();
}, (err) => console.error("svCatalog overrides listener error:", err));

onSnapshot(collection(db, DELETED_COLLECTION), (snap) => {
  const next = {};
  snap.forEach((d) => { next[d.id] = true; });
  deletedIds = next;
  deletedLoaded = true;
  emit();
}, (err) => console.error("svCatalog deleted listener error:", err));

async function svLogSafe(message){
  if (window.svAuth && typeof window.svAuth.log === "function") window.svAuth.log(message);
}

const svCatalog = {
  /** Registers cb(mergedMovies) to run immediately (if data has already
   *  loaded) and on every future catalog change. Returns an unsubscribe
   *  function. */
  subscribe(cb){
    listeners.add(cb);
    if (overridesLoaded && deletedLoaded) cb(latestSnapshot);
    return () => listeners.delete(cb);
  },

  /** Synchronous read of the most recently received merged catalog. */
  getSnapshot(){
    return latestSnapshot;
  },

  /** Waits for the first Firestore snapshot(s) to arrive, then resolves. */
  ready(){
    return readyPromise;
  },

  async getMovieById(id){
    await readyPromise;
    return latestSnapshot[id] || null;
  },

  async saveMovie(movie){
    await setDoc(doc(db, OVERRIDES_COLLECTION, movie.id), movie);
    // Saving (e.g. re-adding a previously-deleted id) should un-delete it.
    await deleteDoc(doc(db, DELETED_COLLECTION, movie.id)).catch(() => {});
    await svLogSafe(`Title saved: ${movie.title}`);
  },

  async deleteMovie(id){
    const movie = latestSnapshot[id];
    await setDoc(doc(db, DELETED_COLLECTION, id), { deletedAt: Date.now() });
    await svLogSafe(`Title removed: ${movie ? movie.title : id}`);
  },

  async resetCatalog(){
    const batch = writeBatch(db);
    const [overrideDocs, deletedDocs] = await Promise.all([
      getDocs(collection(db, OVERRIDES_COLLECTION)),
      getDocs(collection(db, DELETED_COLLECTION))
    ]);
    overrideDocs.forEach((d) => batch.delete(d.ref));
    deletedDocs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await svLogSafe("Catalog reset to defaults.");
  }
};

window.svCatalog = svCatalog;
window.dispatchEvent(new Event("svCatalogReady"));
