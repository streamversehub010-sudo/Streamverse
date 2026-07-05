/* =========================================================================
   auth-guard.js
   -------------------------------------------------------------------------
   Client-side route protection for pages that must only be visible to
   signed-in viewers (profile.html, settings.html). NOT a security
   boundary by itself (that's what Firestore rules are for) — this just
   keeps guests/public visitors from ever seeing the page content and
   bounces them to login.html instead.

   Usage: load AFTER firebase-auth.js on any protected page, then call
     window.svGuard.requireAuth(function(user){ ... })
   The callback only fires once a signed-in user's profile is confirmed.
   ========================================================================= */
(function () {
  function requireAuth(onReady) {
    function check() {
      svAuth.currentUser().then((user) => {
        if (!user) {
          // Preserve where the visitor was headed (including any query
          // string, e.g. profile.html?upgrade=1) so login can bounce them
          // right back instead of just dropping them on the homepage.
          const redirect = encodeURIComponent(
            (location.pathname.split('/').pop() || 'index.html') + location.search
          );
          window.location.replace(`login.html?redirect=${redirect}`);
          return;
        }
        document.documentElement.classList.remove('sv-auth-pending');
        if (typeof onReady === 'function') onReady(user);
      });
    }
    if (window.svAuth) check();
    else window.addEventListener('svAuthReady', check, { once: true });
  }

  window.svGuard = { requireAuth };
})();
