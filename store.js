/* =========================================================================
   store.js
   -------------------------------------------------------------------------
   Shared client-side data layer for the StreamVerse demo.

   - AUTH (accounts, sessions, roles, ban status) lives in Firebase —
     see firebase-auth.js and its window.svAuth API.
   - The MOVIE CATALOG (titles admins add/edit/delete) lives in Firestore
     too, synced in real time across every browser/device — see
     catalog-firestore.js and its window.svCatalog API.
   - This file now only handles live-stream ops ("who's live right now")
     and the tiny per-browser demo random-walk that makes viewer counts
     feel alive. This part intentionally stays local/simulated.
   ========================================================================= */

const SV_KEYS = {
  LIVE: 'sv_live_ops'
};

function svRead(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function svWrite(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------------------- Activity log ---------------------------- */
// Delegates to svAuth.log/getLog (from firebase-auth.js) when available,
// so auth, catalog, and live-ops events all land in one shared log.
function svLog(message){
  if (window.svAuth && typeof window.svAuth.log === 'function'){
    window.svAuth.log(message);
  }
}
function svGetLog(){
  return (window.svAuth && typeof window.svAuth.getLog === 'function')
    ? window.svAuth.getLog()
    : [];
}

/* ---------------------------- Live stream operations ---------------------------- */
function svGetLiveOps(){ return svRead(SV_KEYS.LIVE, {}); }

function svSetLive(id, isLive, movieTitleHint){
  const live = svGetLiveOps();
  if (isLive){
    live[id] = { since: Date.now(), viewers: Math.floor(Math.random() * 400) + 60 };
  } else {
    delete live[id];
  }
  svWrite(SV_KEYS.LIVE, live);
  svLog(`${isLive ? 'Stream started' : 'Stream ended'}: ${movieTitleHint || id}`);
}

// Small random walk so the admin dashboard feels "live" without a real backend
function svTickLiveViewers(){
  const live = svGetLiveOps();
  Object.keys(live).forEach(id => {
    const delta = Math.floor(Math.random() * 25) - 11;
    live[id].viewers = Math.max(3, live[id].viewers + delta);
  });
  svWrite(SV_KEYS.LIVE, live);
  return live;
}
