/* =========================================================================
   theme.js
   -------------------------------------------------------------------------
   Applies the user's saved theme preference (light/dark) as early as
   possible via a localStorage mirror, so pages don't flash dark-then-light
   while waiting on Firestore. Settings.html is the source of truth and
   keeps this mirror in sync (see firebase-auth.js -> updateSettings).
   Safe no-op if nothing has been saved yet (defaults to the site's normal
   dark theme).
   ========================================================================= */
(function () {
  try {
    const saved = localStorage.getItem('sv_theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) { /* no-op */ }
})();

/* -------------------------------------------------------------------------
   Live viewport tracking
   -------------------------------------------------------------------------
   100dvh (used as the --vh100 fallback chain in style.css) covers most
   modern mobile browsers, but plenty of devices/webviews in the wild still
   only report the OS's nominal screen size and don't update it live when
   the browser chrome, an on-screen keyboard, split-screen, or a rotation
   changes the actually-visible area. Re-measuring window.innerHeight /
   innerWidth on load, resize, orientation change, and (where supported)
   visualViewport changes keeps --vh / --vw glued to the real, current
   device viewport, so the layout always fits the screen you're actually
   looking at instead of a stale/rounded value.
   ------------------------------------------------------------------------- */
(function () {
  const root = document.documentElement;
  function setViewportVars() {
    const vv = window.visualViewport;
    const h = (vv && vv.height) || window.innerHeight;
    const w = (vv && vv.width) || window.innerWidth;
    root.style.setProperty('--vh', (h * 0.01) + 'px');
    root.style.setProperty('--vw', (w * 0.01) + 'px');
  }
  setViewportVars();
  window.addEventListener('resize', setViewportVars, { passive: true });
  window.addEventListener('orientationchange', setViewportVars, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setViewportVars, { passive: true });
  }
})();
