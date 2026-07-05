/* =========================================================================
   upgrade-trigger.js
   -------------------------------------------------------------------------
   Single shared place for two things every plan-gated feature needs:

   1. "Is this viewer's plan good enough for X?" — previously duplicated
      almost verbatim in viewer.js (watch page Download button) and
      catalog-render.js (movie-card/carousel Download buttons), each with
      its own copy of the Firestore lookup AND its own toast element/CSS.
      That's now one cached check here.

   2. "Send them to the upgrade flow." Basic-plan viewers who hit a gated
      feature (Download today; easy to extend later) are taken straight to
      the "Choose Your Plan" modal — either opened in place if already on
      profile.html, or via a redirect to profile.html?upgrade=1 that opens
      it automatically as soon as the page loads. This replaces the old
      dead-end link some upsell copy pointed at settings.html, which has no
      upgrade UI at all.

   Include this AFTER firebase-auth.js on any page with a gated feature.
   ========================================================================= */
(function () {
  const PLAN_RANK = { basic: 0, standard: 1, premium: 2 };

  // Short-lived cache so a burst of clicks (e.g. scrolling a movie grid and
  // tapping several Download buttons in a row) doesn't re-run a Firestore
  // read for each one — they'll all get the same answer anyway.
  let cachedUser = null;
  let cacheAt = 0;
  const CACHE_MS = 15000;

  async function getUserCached() {
    if (!window.svAuth) return null;
    if (cachedUser !== null && Date.now() - cacheAt < CACHE_MS) return cachedUser;
    try {
      cachedUser = await svAuth.currentUser();
    } catch (err) {
      cachedUser = null;
    }
    cacheAt = Date.now();
    return cachedUser;
  }

  function invalidateCache() { cachedUser = null; cacheAt = 0; }

  // Drop the cache immediately on sign-in/out or a plan change, rather than
  // waiting for it to expire, so an admin-approved upgrade is reflected on
  // the very next check.
  function wireInvalidation() { svAuth.onChange(invalidateCache); }
  if (window.svAuth) wireInvalidation();
  else window.addEventListener('svAuthReady', wireInvalidation, { once: true });

  async function meetsPlan(minPlan) {
    const user = await getUserCached();
    const planKey = user ? (user.plan || 'basic') : 'basic';
    return (PLAN_RANK[planKey] ?? 0) >= (PLAN_RANK[minPlan] ?? 0);
  }

  /** Basic-vs-everything-else check used by every Download button site-wide. */
  async function isEligibleForDownload() {
    // No auth module loaded yet, or the check errors out — fail open
    // rather than block a legitimate paying viewer over a transient glitch.
    if (!window.svAuth) return true;
    try {
      return await meetsPlan('standard');
    } catch (err) {
      return true;
    }
  }

  /** Sends the viewer to the upgrade flow for a gated feature they just hit.
   *  `reason` is a short machine tag (e.g. 'download', 'contact') carried
   *  through as a query param purely for context/analytics — nothing in
   *  the modal currently branches on it, but profile.html could later. */
  function promptUpgrade(reason) {
    if (typeof window.openUpgradeModalFromTrigger === 'function') {
      window.openUpgradeModalFromTrigger(reason);
      return;
    }
    const url = new URL('profile.html', window.location.href);
    url.searchParams.set('upgrade', '1');
    if (reason) url.searchParams.set('reason', reason);
    window.location.href = url.toString();
  }

  window.svUpgrade = { isEligibleForDownload, meetsPlan, promptUpgrade, invalidateCache };
  window.dispatchEvent(new Event('svUpgradeReady'));
})();
