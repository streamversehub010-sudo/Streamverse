/* =========================================================================
   catalog-render.js
   -------------------------------------------------------------------------
   Shared rendering helpers for anything that draws a grid/row of movie
   cards (index.html's homepage rows + category.html's "View All" page).
   Pulled out into its own file so the card markup only exists once instead
   of being copy-pasted across pages and drifting out of sync.
   ========================================================================= */

function playIconSVG(){
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}
function downloadIconSVG(){
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg>`;
}

const CATEGORY_LABELS = {
  movie: 'Movie', series: 'Series', anime: 'Anime',
  kdrama: 'K-Drama', cartoon: 'Cartoon', sport: 'Live Sport'
};

const CATEGORY_HEADINGS = {
  all: 'All Movies & Series', movie: 'Movies', series: 'Series', anime: 'Anime',
  kdrama: 'K-Drama', cartoon: 'Cartoons', sport: 'Live Sport ⚽'
};

function renderMovieCard(movie){
  // The "Download" button links to an external, authorized download source
  // set per-title (or per-episode-1, for series) in the admin panel. It
  // never touches the playback stream itself, and is omitted when no link
  // has been set for that title.
  const isSeries = window.svSeasons ? window.svSeasons.isSeries(movie) : (movie.episodes && movie.episodes.length > 0);
  const firstEp = window.svSeasons ? window.svSeasons.firstEpisode(movie) : (movie.episodes && movie.episodes[0]);
  const downloadUrl = isSeries ? (firstEp ? firstEp.downloadUrl : '') : movie.downloadUrl;
  const downloadBtnHtml = downloadUrl
    ? `<a class="btn btn-download" href="${downloadUrl}" target="_blank" rel="noopener noreferrer">
          ${downloadIconSVG()} <span class="dl-label">Download</span>
        </a>`
    : '';
  const category = movie.category || 'movie';
  const catLabel = CATEGORY_LABELS[category] || category;
  const cornerBadge = movie.live
    ? `<div class="rating-badge live-badge"><span class="live-dot"></span> LIVE</div>`
    : `<div class="rating-badge"><span class="star-icon">★</span><span class="rating-text">${movie.rating}</span></div>`;

  const newBadgeHtml = movie.newRelease ? `<div class="new-badge">New</div>` : '';

  return `
  <article class="movie-card" data-category="${category}">
    <div class="poster-wrap">
      <img src="${movie.poster}" alt="${movie.title} poster" loading="lazy">
      ${cornerBadge}
      <div class="category-tag">${catLabel}</div>
      ${newBadgeHtml}
    </div>
    <div class="movie-info">
      <h3>${movie.title}</h3>
      <div class="movie-meta">
        <span>${movie.year}</span><span class="dot"></span><span>${movie.genre}</span>
      </div>
      <div class="card-actions">
        <a class="btn btn-watch" href="viewer.html?movie=${encodeURIComponent(movie.id)}">
          ${playIconSVG()} ${movie.live ? 'Watch Live' : 'Watch Now'}
        </a>
        ${downloadBtnHtml}
      </div>
    </div>
  </article>`;
}

function filterByCategory(movies, category){
  const out = {};
  Object.values(movies).forEach(m => {
    if ((m.category || 'movie') === category) out[m.id] = m;
  });
  return out;
}

function filterMovies(movies, q){
  const out = {};
  Object.values(movies).forEach(m => {
    if (m.title.toLowerCase().includes(q) || m.genre.toLowerCase().includes(q)) out[m.id] = m;
  });
  return out;
}

// Delays running fn until `wait` ms after the last call — used so grids
// aren't fully rebuilt on every single keystroke while typing a search.
function debounce(fn, wait){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------------------------------------------------------------------
   Download eligibility gate
   -------------------------------------------------------------------
   Every "Download" link rendered by this file (movie-card grids here
   and the trending carousel in index.html) shares the class
   btn-download and points straight at an external, admin-set URL.
   Rather than let the browser navigate there directly, clicks are
   intercepted (event delegation, since cards re-render constantly) and
   checked against the shared upgrade-trigger.js module — the same one
   viewer.js uses for the watch page's own Download button — so there's
   one eligibility check and one upgrade flow site-wide instead of
   separate copies per page.
   --------------------------------------------------------------------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('a.btn-download');
  if (!btn) return;
  e.preventDefault();
  const href = btn.getAttribute('href');
  if (!href) return;

  btn.classList.add('downloading');
  const eligible = await window.svUpgrade.isEligibleForDownload();
  btn.classList.remove('downloading');

  if (!eligible) {
    window.svUpgrade.promptUpgrade('download');
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
});
