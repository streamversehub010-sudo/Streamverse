/* =========================================================================
   plan-notify.js
   -------------------------------------------------------------------------
   Auto-notifies a viewer the moment their subscription plan is upgraded by
   an admin — whether that happened because the admin approved their
   checkout request, or because the admin set the plan directly from the
   Users panel. Both paths write/flip an "approved" doc in the shared
   upgradeRequests Firestore collection (see firebase-auth.js), so this
   just needs to watch that collection for the signed-in user's own docs.

   Delivery reuses the existing notification center (window.svNotify from
   notifications.js) so the upgrade alert shows up in the same bell/panel
   as badge unlocks and admin broadcasts — no separate UI needed.

   "Already seen" state is tracked per-account in localStorage
   (sv_plan_notif_seen_<uid>), the same pattern broadcast read-state uses,
   so a fresh sign-in doesn't replay a viewer's entire upgrade history as
   if it just happened.
   ========================================================================= */
import { db, auth } from "./firebase-auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const REQUESTS_COLLECTION = "upgradeRequests";
const MAX_SEEN = 300;

function seenKey(uid) { return `sv_plan_notif_seen_${uid}`; }

function loadSeen(uid) {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(uid)) || "[]")); }
  catch (e) { return new Set(); }
}
function saveSeen(uid, set) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify([...set].slice(-MAX_SEEN))); }
  catch (e) { /* no-op */ }
}

let unsubscribe = null;

onAuthStateChanged(auth, (fbUser) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!fbUser) return;

  const uid = fbUser.uid;
  const seen = loadSeen(uid);
  let isFirstSnapshot = true;

  const q = query(
    collection(db, REQUESTS_COLLECTION),
    where("uid", "==", uid),
    where("status", "==", "approved")
  );

  unsubscribe = onSnapshot(q, (snap) => {
    // First snapshot after load = existing history, not a "just happened"
    // event. Mark it all seen and only notify on changes from here on.
    if (isFirstSnapshot) {
      snap.forEach((d) => seen.add(d.id));
      saveSeen(uid, seen);
      isFirstSnapshot = false;
      return;
    }

    snap.docChanges().forEach((change) => {
      if (change.type !== "added" && change.type !== "modified") return;
      if (seen.has(change.doc.id)) return;
      seen.add(change.doc.id);
      saveSeen(uid, seen);

      const r = change.doc.data();
      if (!window.svNotify) return;
      window.svNotify.push(uid, {
        icon: "🎉",
        title: `You're now on the ${r.planLabel || "new"} plan!`,
        body: r.months
          ? `Your ${r.planLabel} plan (${r.planPrice || ""}) is active for ${r.months} month${r.months === 1 ? "" : "s"}.`
          : `Your ${r.planLabel} plan is now active.`
      });
    });
  }, (err) => {
    console.error("plan-notify: listener error", err);
  });
});
