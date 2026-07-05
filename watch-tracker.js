/* =========================================================================
   watch-tracker.js
   -------------------------------------------------------------------------
   Tracks real watch progress on the video player (viewer.html) and reports
   it to svAuth.recordWatchProgress(), which powers the Movie Badge rank
   shown on the Profile page.

   - A title counts as "watched" once playback crosses 90% of its duration
     (checked on 'timeupdate') or the video fires 'ended' — whichever comes
     first — and only once per title id, ever.
   - Guests (signed out) are silently ignored: svAuth.recordWatchProgress
     no-ops without a signed-in user, so nothing breaks for public viewers.
   - When recording progress unlocks a new, higher badge tier, a small
     toast notification slides in from the bottom-right of the page.

   Depends on: firebase-auth.js (window.svAuth), and expects a
   `window.currentMovie` object with an `id` — viewer.js already exposes
   `currentMovie` as a top-level variable, which becomes window.currentMovie
   in a classic (non-module) script.
   ========================================================================= */
(function () {
  const video = document.getElementById('videoPlayer');
  if (!video) return; // not on a viewer page

  let recordedForCurrentSrc = false;

  function currentMovieId(){
    // viewer.js tracks whichever episode is currently loaded (for series)
    // or the movie itself (for single titles) — either way `currentMovie`
    // is the right id to award badge credit against.
    const movie = window.currentMovie;
    return movie ? movie.id : null;
  }

  async function tryRecord(percent){
    if (recordedForCurrentSrc) return;
    const movieId = currentMovieId();
    if (!movieId || !window.svAuth) return;
    recordedForCurrentSrc = true; // avoid double-firing while the result is in flight
    const result = await svAuth.recordWatchProgress(movieId, percent);
    if (result && result.leveledUp) {
      showBadgeToast(result.badge);
      const user = await svAuth.currentUser();
      if (user && window.svNotify) {
        svNotify.push(user.uid, {
          icon: BADGE_ICONS[result.badge.key] || '🏆',
          title: 'New Badge Unlocked!',
          body: `You've ranked up to ${result.badge.label}.`
        });
      }
    }
  }

  video.addEventListener('timeupdate', () => {
    if (!video.duration || Number.isNaN(video.duration)) return;
    const percent = (video.currentTime / video.duration) * 100;
    if (percent >= 90) tryRecord(percent);
  });

  video.addEventListener('ended', () => tryRecord(100));

  // A new <video> source (episode change / different title) means we
  // should be able to record progress again for that new id.
  const observer = new MutationObserver(() => { recordedForCurrentSrc = false; });
  observer.observe(video, { attributes: true, attributeFilter: ['src'] });

  /* ------------------------------- Badge toast ------------------------------- */
  const BADGE_ICONS = {
    rookie: '🎬', pro: '🥉', master: '🥈', grandmaster: '🥇', legend: '🏆', ultimate: '👑'
  };

  function showBadgeToast(badge){
    const toast = document.createElement('div');
    toast.className = 'badge-toast';
    toast.innerHTML = `
      <div class="badge-toast-icon">${BADGE_ICONS[badge.key] || '🏆'}</div>
      <div>
        <div class="badge-toast-title">New Badge Unlocked!</div>
        <div class="badge-toast-desc">You've ranked up to <strong>${badge.label}</strong>.</div>
      </div>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  }
})();
