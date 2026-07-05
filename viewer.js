/* =========================================================================
   viewer.js
   -------------------------------------------------------------------------
   1. Reads the "movie" id from the URL query string (?movie=avatar)
   2. Looks it up in movieDatabase (movies-data.js)
   3. Populates: video source, title, description, meta, episode dropdown,
      subtitle dropdown, and the download button
   4. Handles switching episodes and subtitles live, without a page reload
   ========================================================================= */

// ---------------------------- DOM references ----------------------------
const videoPlayer       = document.getElementById('videoPlayer');
const movieTitleEl      = document.getElementById('movieTitle');
const movieDescEl       = document.getElementById('movieDescription');
const movieYearEl       = document.getElementById('movieYear');
const movieGenreEl      = document.getElementById('movieGenre');
const movieRatingEl     = document.getElementById('movieRating');
const seasonGroup       = document.getElementById('seasonGroup');
const seasonSelect      = document.getElementById('seasonSelect');
const episodeSelectGroup = document.getElementById('episodeSelectGroup');
const episodeSelect     = document.getElementById('episodeSelect');
const episodeListSection = document.getElementById('episodeListSection');
const episodeListHeading = document.getElementById('episodeListHeading');
const episodeGrid       = document.getElementById('episodeGrid');
const subtitleSelect    = document.getElementById('subtitleSelect');
const qualitySelect     = document.getElementById('qualitySelect');
const downloadBtn       = document.getElementById('downloadBtn');
const viewerContent     = document.getElementById('viewerContent');
const notFoundEl        = document.getElementById('notFound');
const autoplayOverlay      = document.getElementById('autoplayOverlay');
const autoplayThumb        = document.getElementById('autoplayThumb');
const autoplayTitle        = document.getElementById('autoplayTitle');
const autoplaySub          = document.getElementById('autoplaySub');
const autoplayProgressBar  = document.getElementById('autoplayProgressBar');
const autoplayCancelBtn    = document.getElementById('autoplayCancelBtn');
const autoplayPlayNowBtn   = document.getElementById('autoplayPlayNowBtn');

let currentMovie = null;
let hlsInstance  = null; // active hls.js instance, if any
let lastVideoUrl = '';   // the real source URL last passed to loadSource() —
                          // used to feed cast.js (window.svCast), since
                          // videoPlayer.currentSrc becomes a meaningless
                          // local blob: URL once hls.js/MSE is attached
let autoplayEnabled = true;   // from Settings -> Autoplay (defaults on, mirrors svAuth.DEFAULT_SETTINGS)
let autoplayTimer   = null;   // pending setTimeout id for the "up next" countdown
const AUTOPLAY_COUNTDOWN_SECONDS = 6;

// Streaming quality — default 720p for everyone; 1080p/2K/4K/UHD unlock
// per subscription plan (see the quality-gating block near the bottom).
const QUALITY_STORAGE_KEY = 'sv_stream_quality';
let currentQuality = '720p';
try { currentQuality = localStorage.getItem(QUALITY_STORAGE_KEY) || '720p'; } catch (e) { /* ignore */ }

// ---------------------------- 1. Read the movie id from the URL ----------------------------
const params  = new URLSearchParams(window.location.search);
const movieId = params.get('movie');

// ---------------------------- 2. Load the movie ----------------------------
async function init(){
  currentMovie = movieId ? await svCatalog.getMovieById(movieId) : null;
  window.currentMovie = currentMovie; // exposed for watch-tracker.js (badge tracking)

  if (!currentMovie){
    viewerContent.style.display = 'none';
    notFoundEl.style.display = 'block';
    document.title = 'StreamVerse — Title not found';
    return;
  }

  document.title = `StreamVerse — ${currentMovie.title}`;

  // Basic info
  movieTitleEl.textContent = currentMovie.title;
  movieDescEl.textContent  = currentMovie.description || '';
  movieYearEl.textContent  = currentMovie.year;
  movieGenreEl.textContent = currentMovie.genre;
  movieRatingEl.querySelector('.star-icon').textContent = '★';
  movieRatingEl.querySelector('.rating-text').textContent = currentMovie.rating;

  buildSubtitleOptions(currentMovie.subtitles || []);

  // Settings -> Autoplay is per-account (falls back to the default of "on"
  // for signed-out visitors); svAuth is always ready by this point since
  // it's loaded before viewer.js on this page.
  if (window.svAuth){
    const settings = await svAuth.getSettings();
    autoplayEnabled = !!settings.autoplay;
  }

  currentSeasons = window.svSeasons.getSeasons(currentMovie);
  seriesMode = currentSeasons.some(s => s.episodes.length > 0);

  if (seriesMode){
    seasonGroup.style.display = currentSeasons.length > 1 ? 'flex' : 'none';
    episodeListSection.style.display = 'block';
    buildSeasonOptions(currentSeasons);
    selectSeason(currentSeasons[0].number);
  } else {
    seasonGroup.style.display = 'none';
    episodeSelectGroup.style.display = 'none';
    episodeListSection.style.display = 'none';
    loadSource(currentMovie.video, currentMovie.downloadUrl);
  }

  await refreshQualityGating();
  applyDefaultSubtitle();
}

// ---------------------------- Seasons / Episodes ----------------------------
let currentSeasons = [];
let currentSeasonNumber = null;
let currentEpisode = null;
let seriesMode = false;

function buildSeasonOptions(seasons){
  seasonSelect.innerHTML = seasons
    .map(s => `<option value="${s.number}">${escapeHtml(s.title)}${s.year ? ' · ' + escapeHtml(s.year) : ''}</option>`)
    .join('');
}

seasonSelect.addEventListener('change', () => {
  selectSeason(Number(seasonSelect.value));
});

function selectSeason(seasonNumber, forcePlay){
  currentSeasonNumber = seasonNumber;
  seasonSelect.value = String(seasonNumber);
  const season = currentSeasons.find(s => s.number === seasonNumber);
  const episodes = season ? season.episodes : [];
  episodeListHeading.textContent = `Episodes${season ? ' — ' + season.title : ''}`;
  episodeSelectGroup.style.display = episodes.length ? 'flex' : 'none';
  buildEpisodeOptions(episodes);
  renderEpisodeGrid(episodes);
  if (episodes.length) loadEpisode(episodes[0], forcePlay);
}

// Episode dropdown — a compact alternative to the episode card grid for
// quickly jumping to a specific episode (handy for long seasons / mobile).
function buildEpisodeOptions(episodes){
  episodeSelect.innerHTML = episodes
    .map((ep, i) => `<option value="${i}">E${ep.number || (i + 1)} · ${escapeHtml(ep.title || 'Episode ' + (ep.number || i + 1))}</option>`)
    .join('');
}

episodeSelect.addEventListener('change', () => {
  activateEpisodeByIndex(Number(episodeSelect.value));
});

function renderEpisodeGrid(episodes){
  episodeGrid.innerHTML = episodes.map((ep, i) => `
    <button type="button" class="episode-card" data-idx="${i}">
      <div class="episode-thumb-wrap">
        <img src="${escapeHtml(ep.thumbnail || currentMovie.poster || '')}" alt="" loading="lazy">
        <span class="episode-number-badge">E${ep.number || (i + 1)}</span>
      </div>
      <div class="episode-card-info">
        <div class="episode-card-title">${escapeHtml(ep.title || 'Episode ' + (ep.number || i + 1))}</div>
        ${ep.duration ? `<div class="episode-card-meta">${escapeHtml(ep.duration)}</div>` : ''}
        ${ep.description ? `<div class="episode-card-desc">${escapeHtml(ep.description)}</div>` : ''}
      </div>
    </button>`).join('');

  episodeGrid.querySelectorAll('.episode-card').forEach((card, i) => {
    card.addEventListener('click', () => activateEpisodeByIndex(i));
  });
  if (episodeGrid.children[0]) episodeGrid.children[0].classList.add('active');
  episodeSelect.value = '0';
}

// Single entry point for "play episode #idx of the currently selected
// season" — used by the episode dropdown, the episode card grid, and by
// autoplay when the next episode is still in the same season. Keeps the
// dropdown value and the card grid's highlighted card in sync no matter
// which UI triggered the switch.
function activateEpisodeByIndex(idx, forcePlay){
  const season = currentSeasons.find(s => s.number === currentSeasonNumber);
  const episodes = season ? season.episodes : [];
  if (!episodes[idx]) return;
  loadEpisode(episodes[idx], forcePlay);
  applyDefaultSubtitle();
  episodeSelect.value = String(idx);
  episodeGrid.querySelectorAll('.episode-card').forEach(c => c.classList.remove('active'));
  const card = episodeGrid.querySelector(`.episode-card[data-idx="${idx}"]`);
  if (card) card.classList.add('active');
}

function loadEpisode(episode, forcePlay){
  currentEpisode = episode;
  loadSource(episode.video, episode.downloadUrl, forcePlay);
}

// ---------------------------- Autoplay next episode ----------------------------
// Auto-maps the next episode across season boundaries: next episode in the
// current season if there is one, otherwise episode 1 of the next season
// (by season number order), otherwise null if this was the series finale.
function getNextEpisode(){
  const season = currentSeasons.find(s => s.number === currentSeasonNumber);
  if (!season) return null;
  const idx = season.episodes.indexOf(currentEpisode);

  if (idx > -1 && idx < season.episodes.length - 1){
    return { seasonNumber: season.number, episodeIndex: idx + 1, episode: season.episodes[idx + 1] };
  }

  const sortedSeasons = [...currentSeasons].sort((a, b) => a.number - b.number);
  const seasonPos = sortedSeasons.findIndex(s => s.number === season.number);
  for (let i = seasonPos + 1; i < sortedSeasons.length; i++){
    if (sortedSeasons[i].episodes.length > 0){
      return { seasonNumber: sortedSeasons[i].number, episodeIndex: 0, episode: sortedSeasons[i].episodes[0] };
    }
  }
  return null; // series finale reached
}

function playNextEpisode(next){
  if (next.seasonNumber !== currentSeasonNumber){
    selectSeason(next.seasonNumber, true); // selectSeason already loads that season's first episode
  } else {
    activateEpisodeByIndex(next.episodeIndex, true);
  }
}

function hideAutoplayOverlay(){
  clearTimeout(autoplayTimer);
  autoplayTimer = null;
  autoplayOverlay.classList.remove('show');
  autoplayProgressBar.classList.remove('counting');
}

function showAutoplayOverlay(next){
  const ep = next.episode;
  const seasonLabel = currentSeasons.find(s => s.number === next.seasonNumber);
  autoplayThumb.src = ep.thumbnail || currentMovie.poster || '';
  autoplayTitle.textContent = ep.title || `Episode ${ep.number || next.episodeIndex + 1}`;
  autoplaySub.textContent = `${seasonLabel ? seasonLabel.title : 'Season ' + next.seasonNumber} · Episode ${ep.number || next.episodeIndex + 1}`;

  autoplayOverlay.classList.add('show');
  // Restart the shrinking progress bar animation each time it's shown
  autoplayProgressBar.classList.remove('counting');
  void autoplayProgressBar.offsetWidth; // force reflow so the animation restarts
  autoplayProgressBar.style.animationDuration = `${AUTOPLAY_COUNTDOWN_SECONDS}s`;
  autoplayProgressBar.classList.add('counting');

  autoplayTimer = setTimeout(() => {
    hideAutoplayOverlay();
    playNextEpisode(next);
  }, AUTOPLAY_COUNTDOWN_SECONDS * 1000);
}

autoplayCancelBtn.addEventListener('click', hideAutoplayOverlay);
autoplayPlayNowBtn.addEventListener('click', () => {
  const next = getNextEpisode();
  hideAutoplayOverlay();
  if (next) playNextEpisode(next);
});

// If the person scrubs back and replays after the overlay appeared (or
// after it already fired), don't let a stale countdown fire mid-rewatch.
videoPlayer.addEventListener('play', hideAutoplayOverlay);

videoPlayer.addEventListener('ended', () => {
  if (!seriesMode || !autoplayEnabled) return;
  const next = getNextEpisode();
  if (next) showAutoplayOverlay(next);
});

function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------- Streaming quality (plan-gated) ----------------------------
// The picker always starts on 720p. Standard unlocks Full HD (1080p);
// Premium unlocks everything up through 2K/4K/UHD — mirroring the
// resolution ceiling already promised on each plan card (see
// firebase-auth.js PLANS). Basic-plan viewers (and guests) can only pick
// 720p; higher options are shown but disabled with an upgrade hint, and
// picking one anyway (or losing a plan mid-session) snaps back down and
// opens the same upgrade flow the Download button uses.
const QUALITY_TIERS = [
  { key: '720p',  label: '720p HD',        minPlan: 'basic',    height: 720  },
  { key: '1080p', label: '1080p Full HD',  minPlan: 'standard', height: 1080 },
  { key: '2k',    label: '2K QHD',         minPlan: 'premium',  height: 1440 },
  { key: '4k',    label: '4K Ultra HD',    minPlan: 'premium',  height: 2160 },
  { key: 'uhd',   label: 'UHD',            minPlan: 'premium',  height: 2160 }
];
const QUALITY_PLAN_LABEL = { basic: '', standard: 'Standard', premium: 'Premium' };
let qualityEligibility = { basic: true, standard: false, premium: false };

async function refreshQualityEligibility(){
  if (window.svUpgrade){
    try {
      qualityEligibility.standard = await svUpgrade.meetsPlan('standard');
      qualityEligibility.premium  = await svUpgrade.meetsPlan('premium');
    } catch (e) { qualityEligibility.standard = qualityEligibility.premium = true; }
  } else {
    qualityEligibility.standard = true;
    qualityEligibility.premium  = true;
  }
}

function isTierEligible(tier){
  return !!qualityEligibility[tier.minPlan];
}

// If the remembered/selected tier isn't covered by the current plan
// anymore, fall back to the highest tier that still is (never blocks
// playback outright — it just steps the resolution back down).
function highestEligibleTierKey(desiredKey){
  const desiredIdx = Math.max(0, QUALITY_TIERS.findIndex(t => t.key === desiredKey));
  for (let i = desiredIdx; i >= 0; i--){
    if (isTierEligible(QUALITY_TIERS[i])) return QUALITY_TIERS[i].key;
  }
  return '720p';
}

function renderQualityOptions(){
  if (!qualitySelect) return;
  qualitySelect.innerHTML = QUALITY_TIERS.map(t => {
    const eligible = isTierEligible(t);
    const label = eligible ? t.label : `${t.label} 🔒 ${QUALITY_PLAN_LABEL[t.minPlan]}`;
    return `<option value="${t.key}"${eligible ? '' : ' disabled'}>${escapeHtml(label)}</option>`;
  }).join('');
  qualitySelect.value = currentQuality;
}

// Re-checks the signed-in viewer's plan, rebuilds the picker, and applies
// the (possibly downgraded) result to whatever's currently loaded. Runs on
// init and again on every sign-in/out/plan change.
async function refreshQualityGating(){
  await refreshQualityEligibility();
  currentQuality = highestEligibleTierKey(currentQuality);
  try { localStorage.setItem(QUALITY_STORAGE_KEY, currentQuality); } catch (e) { /* ignore */ }
  renderQualityOptions();
  applyQualityToPlayer(currentQuality);
}

// Caps hls.js to the nearest rendition at or below the chosen resolution.
// (Progressive/native-HLS sources have only one rendition in this demo
// catalog, so the picker still enforces the plan limit but has nothing
// else to switch between.)
function applyQualityToPlayer(tierKey){
  const tier = QUALITY_TIERS.find(t => t.key === tierKey);
  if (!tier || !hlsInstance || !hlsInstance.levels || !hlsInstance.levels.length) return;
  let bestIdx = -1, bestHeight = -1;
  hlsInstance.levels.forEach((lvl, idx) => {
    if (lvl.height && lvl.height <= tier.height && lvl.height > bestHeight){
      bestHeight = lvl.height;
      bestIdx = idx;
    }
  });
  hlsInstance.currentLevel = bestIdx === -1 ? 0 : bestIdx;
}

if (qualitySelect){
  qualitySelect.addEventListener('change', () => {
    const picked = QUALITY_TIERS.find(t => t.key === qualitySelect.value);
    if (!picked || !isTierEligible(picked)){
      qualitySelect.value = currentQuality; // snap back to the last allowed tier
      if (window.svUpgrade) svUpgrade.promptUpgrade('quality');
      return;
    }
    currentQuality = picked.key;
    try { localStorage.setItem(QUALITY_STORAGE_KEY, currentQuality); } catch (e) { /* ignore */ }
    applyQualityToPlayer(currentQuality);
  });
}

if (window.svAuth) svAuth.onChange(refreshQualityGating);
else window.addEventListener('svAuthReady', () => svAuth.onChange(refreshQualityGating), { once: true });

// ---------------------------- Cast / Second Screen hookup ----------------------------
// Replaces cast.js's built-in demo video with whatever StreamVerse is
// actually playing. Called at init, on every loadSource() (movie or
// episode change), and whenever the subtitle selection changes, so
// Cast/Second Screen/Connect to PC always reflect exactly what's on
// screen — for every category (movie, series, anime, cartoon, k-drama,
// sport) since they all render through this one player.
function pushNowPlaying(){
  if (!window.svCast || !currentMovie || !lastVideoUrl) return;
  const epLabel = currentEpisode
    ? ` — ${currentEpisode.title || 'Episode ' + (currentEpisode.number || '')}`
    : '';
  let subs = null;
  if (subtitleSelect.value !== 'off' && currentMovie.subtitles){
    subs = currentMovie.subtitles[Number(subtitleSelect.value)] || null;
  }
  window.svCast.setNowPlaying({
    url: lastVideoUrl,
    contentType: /\.m3u8($|\?)/i.test(lastVideoUrl) ? 'application/x-mpegurl' : 'video/mp4',
    title: currentMovie.title + epLabel,
    subtitle: `${currentMovie.genre || ''}${currentMovie.year ? ' · ' + currentMovie.year : ''}`,
    poster: currentMovie.backdrop || currentMovie.poster || '',
    subs
  });
}

// ---------------------------- Video source + download link ----------------------------
function loadSource(videoUrl, downloadUrl, forcePlay){
  hideAutoplayOverlay();
  lastVideoUrl = videoUrl;
  const wasPlaying = forcePlay || !videoPlayer.paused;
  const isHls = /\.m3u8($|\?)/i.test(videoUrl);

  // Tear down any previous hls.js instance before loading a new source
  if (hlsInstance){
    hlsInstance.destroy();
    hlsInstance = null;
  }

  if (isHls && window.Hls && Hls.isSupported()){
    hlsInstance = new Hls();
    hlsInstance.loadSource(videoUrl);
    hlsInstance.attachMedia(videoPlayer);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (wasPlaying) videoPlayer.play().catch(() => {});
      applyQualityToPlayer(currentQuality);
    });
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal){
        console.error('hls.js fatal error:', data);
        switch (data.type){
          case Hls.ErrorTypes.NETWORK_ERROR:
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hlsInstance.recoverMediaError();
            break;
          default:
            hlsInstance.destroy();
            hlsInstance = null;
            break;
        }
      }
    });
  } else if (isHls && videoPlayer.canPlayType('application/vnd.apple.mpegurl')){
    // Safari / iOS: native HLS support, no hls.js needed
    videoPlayer.src = videoUrl;
    videoPlayer.load();
    if (wasPlaying) videoPlayer.play().catch(() => {});
  } else {
    // Regular progressive file (mp4, webm, etc.)
    videoPlayer.src = videoUrl;
    videoPlayer.load();
    if (wasPlaying) videoPlayer.play().catch(() => {});
  }

  // The Download button never touches the playback stream itself — it only
  // opens whichever external, rights-holder-authorized link was entered for
  // this title in the admin panel (movie.downloadUrl). If none was set, the
  // button is hidden.
  if (downloadUrl){
    downloadBtn.href = downloadUrl;
    downloadBtn.style.display = '';
  } else {
    downloadBtn.removeAttribute('href');
    downloadBtn.style.display = 'none';
  }

  pushNowPlaying();
}

// ---------------------------- Subtitles ----------------------------
function buildSubtitleOptions(subtitles){
  const offOption = `<option value="off">Off</option>`;
  const langOptions = subtitles
    .map((s, i) => `<option value="${i}">${s.label}</option>`)
    .join('');
  subtitleSelect.innerHTML = offOption + langOptions;
}

function applyDefaultSubtitle(){
  // Clear any existing <track> elements from a previous episode/subtitle
  Array.from(videoPlayer.querySelectorAll('track')).forEach(t => t.remove());

  const subtitles = currentMovie.subtitles || [];
  const defaultIndex = subtitles.findIndex(s => s.default);

  if (defaultIndex > -1){
    addSubtitleTrack(subtitles[defaultIndex]);
    subtitleSelect.value = String(defaultIndex);
  } else {
    subtitleSelect.value = 'off';
  }
  pushNowPlaying();
}

subtitleSelect.addEventListener('change', () => {
  Array.from(videoPlayer.querySelectorAll('track')).forEach(t => t.remove());
  if (subtitleSelect.value === 'off') return;

  const sub = currentMovie.subtitles[Number(subtitleSelect.value)];
  addSubtitleTrack(sub);
  pushNowPlaying();
});

function addSubtitleTrack(sub){
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = sub.label;
  track.srclang = sub.lang;
  track.src = sub.src;
  track.default = true;
  videoPlayer.appendChild(track);

  // Make sure the newly added track is actually showing
  videoPlayer.addEventListener('loadedmetadata', function enableTrack(){
    if (videoPlayer.textTracks[0]) videoPlayer.textTracks[0].mode = 'showing';
    videoPlayer.removeEventListener('loadedmetadata', enableTrack);
  });
}

// ---------------------------- Download button (plan-gated redirect) ----------------------------
// This button does NOT fetch, stitch, or save the playback stream in any
// way. It simply opens movie.downloadUrl — an external link you provide in
// the admin panel for a legally authorized download source — in a new tab.
// Before doing that, it verifies the signed-in viewer's plan via the shared
// upgrade-trigger.js module (also used by catalog-render.js so there's one
// eligibility check and one upgrade flow site-wide, not several copies).
// Basic-plan viewers (and guests) aren't eligible, so the click is
// swallowed and they're sent straight to the "Choose Your Plan" modal.
downloadBtn.target = '_blank';
downloadBtn.rel = 'noopener noreferrer';

downloadBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  const href = downloadBtn.getAttribute('href');
  if (!href || href === '#') return;

  downloadBtn.classList.add('downloading');
  const eligible = await window.svUpgrade.isEligibleForDownload();
  downloadBtn.classList.remove('downloading');

  if (!eligible) {
    window.svUpgrade.promptUpgrade('download');
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
});

// ---------------------------- Cleanup ----------------------------
// Without this, navigating back to the homepage (or to another title)
// left the previous hls.js instance running in the background — still
// fetching segments and decoding — which is wasted CPU/network and made
// the next page feel sluggish. pagehide covers back/forward-cache cases
// that 'unload' misses.
window.addEventListener('pagehide', () => {
  if (hlsInstance){
    hlsInstance.destroy();
    hlsInstance = null;
  }
});

// ---------------------------- Go ----------------------------
if (window.svCatalog) init();
else window.addEventListener('svCatalogReady', init, { once: true });
