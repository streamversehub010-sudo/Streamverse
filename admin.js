/* =========================================================================
   admin.js — powers admin.html
   Auth (login state, role, ban, user list) comes from Firebase via
   window.svAuth (see firebase-auth.js). The movie catalog is a real-time
   Firestore feed via window.svCatalog (see catalog-firestore.js) — edits
   made here push live to every other open browser/admin session. Live
   stream ops / activity log stay in store.js.
   ========================================================================= */

let svUser = null;
let cachedUsers = [];
let cachedMovies = {};

function initAdmin(){
  // Wires up the file input / progress bar / preview for the Poster Image
  // field in the Add/Edit Title modal. See admin-poster-upload.js.
  window.svPosterUpload.init();

  document.getElementById('adminLogout').addEventListener('click', async (e) => {
    e.preventDefault();
    await svAuth.logout();
    window.location.href = 'index.html';
  });

  /* ---------------------------- Sidebar navigation ---------------------------- */
  const navLinks = document.querySelectorAll('.admin-nav-link[data-panel]');
  const panels = document.querySelectorAll('.admin-panel');

  function showPanel(name){
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.panel === name));
    panels.forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  }
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel(link.dataset.panel);
    });
  });
  if (location.hash){
    const initial = location.hash.replace('#','');
    if (['dashboard','content','users','payments','activity','broadcast','support'].includes(initial)) showPanel(initial);
  }

  /* ---------------------------- Init ---------------------------- */
  // Live, real-time catalog feed: fires immediately with the current
  // catalog, then again any time ANY admin (this tab or another device)
  // changes a title. Both content library and dashboard re-render on it.
  svCatalog.subscribe((movies) => {
    cachedMovies = movies;
    renderContent();
    renderDashboard();
    renderTrendingOrder();
  });
  renderUsers();
  renderLog();
  renderPaymentsPanel();

  /* ---------------------------- Broadcast panel ---------------------------- */
  // Live feed of every sent broadcast, pushed to this table in real time
  // the same way svCatalog pushes catalog edits.
  svBroadcast.subscribe((broadcasts) => renderBroadcasts(broadcasts));
  svBroadcast.subscribeLiveNotify((enabled) => {
    document.getElementById('liveNotifyToggle').checked = enabled;
  });

  // Live feed of every "Contact Us" popup submission (see
  // contact-messages.js) — shows up here the instant a visitor sends one.
  svContactMessages.subscribe((messages) => renderContactMessages(messages));
  document.getElementById('clearContactMsgsBtn').addEventListener('click', () => {
    if (confirm('Remove every contact message? This cannot be undone.')){
      svContactMessages.clearAll();
    }
  });

  document.getElementById('liveNotifyToggle').addEventListener('change', (e) => {
    svBroadcast.setLiveNotifyEnabled(e.target.checked);
  });

  document.getElementById('broadcastForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const emailStatusEl = document.getElementById('bEmailStatus');
    const title = document.getElementById('bTitle').value.trim();
    const body = document.getElementById('bBody').value.trim();
    const sendEmailToo = document.getElementById('bSendEmail').checked;

    submitBtn.disabled = true;
    emailStatusEl.textContent = '';
    const result = await svBroadcast.send({
      icon: document.getElementById('bIcon').value.trim(),
      title,
      body,
      category: document.getElementById('bCategory').value
    });
    if (!result.ok){
      submitBtn.disabled = false;
      alert(result.error || 'Could not send broadcast.');
      return;
    }

    // In-app broadcast sent. If requested, also fan it out as real email
    // to every registered user via the Netlify Function (server-side,
    // since a large user base can't reliably be emailed straight from
    // the browser with EmailJS — see netlify/functions/send-email-broadcast.js).
    if (sendEmailToo){
      emailStatusEl.textContent = 'Sending email to all users… this can take a minute for large lists.';
      emailStatusEl.style.color = '';
      try {
        const idToken = await svAuth.getIdToken();
        if (!idToken) throw new Error('Not signed in.');
        const res = await fetch('/.netlify/functions/send-email-broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            subject: title,
            html: `<p>${body.replace(/\n/g, '<br>') || title}</p>`
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok){
          emailStatusEl.textContent = `Email broadcast issue: ${data.error || (data.failedBatches && data.failedBatches.length ? `${data.sentCount}/${data.recipientCount} delivered, some batches failed.` : 'Unknown error.')}`;
          emailStatusEl.style.color = '#e35b5b';
        } else {
          emailStatusEl.textContent = `Emailed ${data.sentCount} of ${data.recipientCount} registered users successfully.`;
          emailStatusEl.style.color = '#4caf7d';
        }
      } catch (err) {
        console.error('Email broadcast failed:', err);
        emailStatusEl.textContent = 'Could not reach the email broadcast service. Check Netlify function logs.';
        emailStatusEl.style.color = '#e35b5b';
      }
    }

    submitBtn.disabled = false;
    e.target.reset();
    // No manual re-render needed — the svBroadcast.subscribe() above
    // will push the new broadcast to this table (and every user's bell)
    // automatically.
  });

  document.getElementById('userEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const statusEl = document.getElementById('ueStatus');
    const targetEmail = document.getElementById('ueTargetEmail').value.trim();
    const subject = document.getElementById('ueSubject').value.trim();
    const bodyHtml = document.getElementById('ueBody').value.trim();

    submitBtn.disabled = true;
    statusEl.textContent = 'Sending…';
    statusEl.style.color = '';
    try {
      const idToken = await svAuth.getIdToken();
      if (!idToken) throw new Error('Not signed in.');
      const res = await fetch('/.netlify/functions/send-transactional-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          type: 'admin_custom',
          targetEmail,
          subject,
          heading: subject,
          bodyHtml
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok){
        statusEl.textContent = `Could not send: ${data.error || 'Unknown error.'}`;
        statusEl.style.color = '#e35b5b';
      } else {
        statusEl.textContent = `Email sent to ${targetEmail}.`;
        statusEl.style.color = '#4caf7d';
        e.target.reset();
      }
    } catch (err) {
      console.error('Message a User send failed:', err);
      statusEl.textContent = 'Could not reach the email service. Check Netlify function logs.';
      statusEl.style.color = '#e35b5b';
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('clearBroadcastsBtn').addEventListener('click', () => {
    if (confirm('Remove every broadcast? This clears them from every user\'s notification center.')){
      svBroadcast.clearAll();
    }
  });

  /* ---------------------------- Support Contact panel ---------------------------- */
  initSupportContactPanel();

  document.getElementById('resetCatalogBtn').addEventListener('click', async () => {
    if (confirm('Reset the catalog to its original default titles? Any titles you added or edited here will be lost.')){
      await svCatalog.resetCatalog();
      // No manual re-render needed — the svCatalog subscription above
      // will push the reset catalog to every open tab automatically.
    }
  });

  document.getElementById('clearLogBtn').addEventListener('click', () => {
    if (confirm('Clear the entire activity log?')){
      svAuth.clearLog();
      renderLog();
    }
  });

  /* ---------------------------- Activity logging bot toggle ---------------------------- */
  const logBotToggle = document.getElementById('logBotToggle');
  logBotToggle.checked = svAuth.isLoggingEnabled();
  updateLogBotStatusText(logBotToggle.checked);
  logBotToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    svAuth.setLoggingEnabled(enabled); // also records the toggle itself
    updateLogBotStatusText(enabled);
    renderLog();
  });

  // Simulate live traffic ticking
  setInterval(() => {
    svTickLiveViewers();
    if (document.getElementById('panel-dashboard').classList.contains('active')) renderDashboard();
  }, 4000);

  // Keep users/log panels reasonably fresh while admin sits on the page
  setInterval(() => {
    if (document.getElementById('panel-users').classList.contains('active')) renderUsers();
    if (document.getElementById('panel-activity').classList.contains('active')) renderLog();
    if (document.getElementById('panel-payments').classList.contains('active')) renderUpgradeRequests();
  }, 5000);
}

/* ---------------------------- Helpers ---------------------------- */
function timeAgo(ts){
  ts = tsToMillis(ts);
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff/60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}
function formatDate(ts){
  return new Date(tsToMillis(ts)).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}
// Same as formatDate, but for the Users table's Expires column: flags a
// past date so an overdue Standard/Premium plan (due for a manual revert
// to Basic) jumps out instead of requiring the admin to do date math.
function formatExpiryDate(ts){
  const label = formatDate(ts);
  const isOverdue = tsToMillis(ts) < Date.now();
  return isOverdue ? `<span class="expired-date">${label} (overdue)</span>` : label;
}
// Firestore serverTimestamp() fields deserialize as {seconds,nanoseconds}
// (or a Firestore Timestamp instance with .toMillis()); this normalizes
// any of those, plus plain numbers, into a millis value.
function tsToMillis(ts){
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return Date.now();
}
function escapeHtml(str){
  return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------------------------- Dashboard rendering ---------------------------- */
async function renderDashboard(){
  const movies = cachedMovies;
  const live = svGetLiveOps();
  const liveIds = Object.keys(live);
  const totalViewers = liveIds.reduce((sum, id) => sum + (live[id].viewers || 0), 0);
  cachedUsers = await svAuth.listUsers();
  const activeUsers = cachedUsers.filter(u => !u.banned).length;

  document.getElementById('statActiveStreams').textContent = liveIds.length;
  document.getElementById('statConcurrentViewers').textContent = totalViewers.toLocaleString();
  document.getElementById('statCatalogSize').textContent = Object.keys(movies).length;
  document.getElementById('statUserCount').textContent = cachedUsers.length;
  document.getElementById('statUserSub').textContent = `${activeUsers} active accounts`;

  // Live table
  const liveBody = document.getElementById('liveTableBody');
  const liveEmpty = document.getElementById('liveEmpty');
  if (liveIds.length === 0){
    liveBody.innerHTML = '';
    liveEmpty.style.display = 'block';
  } else {
    liveEmpty.style.display = 'none';
    liveBody.innerHTML = liveIds.map(id => {
      const m = movies[id];
      if (!m) return '';
      return `<tr>
        <td>${escapeHtml(m.title)}</td>
        <td>${timeAgo(live[id].since)}</td>
        <td><span class="badge badge-live">${live[id].viewers.toLocaleString()} watching</span></td>
        <td><button class="btn-admin danger small" data-endlive="${id}">End Stream</button></td>
      </tr>`;
    }).join('');
  }

  // Quick toggle table
  const toggleBody = document.getElementById('quickToggleBody');
  toggleBody.innerHTML = Object.values(movies).map(m => {
    const isLive = !!live[m.id];
    return `<tr>
      <td>${escapeHtml(m.title)}</td>
      <td>${escapeHtml(m.genre)}</td>
      <td>${isLive ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-off">Offline</span>'}</td>
      <td>
        <label class="switch">
          <input type="checkbox" data-livetoggle="${m.id}" ${isLive ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
      </td>
    </tr>`;
  }).join('');

  liveBody.querySelectorAll('[data-endlive]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.endlive;
      svSetLive(id, false, movies[id] ? movies[id].title : id);
      renderDashboard();
    });
  });
  toggleBody.querySelectorAll('[data-livetoggle]').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.livetoggle;
      svSetLive(id, input.checked, movies[id] ? movies[id].title : id);
      // Push a "now streaming live" alert into every user's notification
      // center, but only if the admin has left the Broadcast panel's
      // live-notify toggle switched on.
      if (input.checked && window.svBroadcast) svBroadcast.notifyLiveIfEnabled(movies[id]);
      renderDashboard();
    });
  });
}

/* ---------------------------- Content library ---------------------------- */
function renderContent(){
  const movies = cachedMovies;
  const live = svGetLiveOps();
  const list = Object.values(movies);
  document.getElementById('contentCount').textContent = `${list.length} title${list.length === 1 ? '' : 's'} in the catalog`;

  const body = document.getElementById('contentTableBody');
  if (list.length === 0){
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state">No titles yet. Click "Add New Title" to create one.</div></td></tr>`;
    return;
  }

  const CATEGORY_LABELS = { movie: 'Movie', series: 'Series', anime: 'Anime', kdrama: 'K-Drama', cartoon: 'Cartoon', sport: 'Live Sport' };
  body.innerHTML = list.map(m => {
    const isSeries = window.svSeasons.isSeries(m);
    const isLive = !!live[m.id];
    return `<tr>
      <td><img class="row-thumb" src="${escapeHtml(m.poster)}" alt=""></td>
      <td>${escapeHtml(m.title)}</td>
      <td>${escapeHtml(m.genre)}</td>
      <td>${escapeHtml(CATEGORY_LABELS[m.category] || m.category || 'Movie')}</td>
      <td>${escapeHtml(m.year)}</td>
      <td>★ ${escapeHtml(m.rating)}</td>
      <td>${isSeries ? 'Series' : 'Movie'}</td>
      <td>${isLive ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-off">Offline</span>'}</td>
      <td style="white-space:nowrap;">
        <button class="btn-admin secondary small" data-edit="${m.id}">Edit</button>
        <button class="btn-admin danger small" data-delete="${m.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openTitleModal(movies[btn.dataset.edit]));
  });
  body.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const m = movies[btn.dataset.delete];
      if (confirm(`Delete "${m.title}" from the catalog? This can't be undone.`)){
        await svCatalog.deleteMovie(btn.dataset.delete);
        // svCatalog subscription re-renders content + dashboard everywhere.
      }
    });
  });
}

/* ---------------------------- Trending slideshow order (drag-and-drop) ---------------------------- */
function renderTrendingOrder(){
  const list = document.getElementById('trendingOrderList');
  const empty = document.getElementById('trendingOrderEmpty');
  const trending = Object.values(cachedMovies)
    .filter(m => m.trending)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!trending.length){
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = trending.map((m, i) => `
    <div class="trending-order-row" draggable="true" data-id="${m.id}">
      <span class="trending-order-index">${i + 1}</span>
      <span class="trending-order-handle" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></span>
      <img class="trending-order-thumb" src="${escapeHtml(m.poster)}" alt="">
      <div class="trending-order-info">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="meta">${escapeHtml(m.genre)} · ${escapeHtml(m.year)}</div>
      </div>
    </div>`).join('');

  let dragEl = null;

  list.querySelectorAll('.trending-order-row').forEach(row => {
    row.addEventListener('dragstart', () => {
      dragEl = row;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.trending-order-row').forEach(r => r.classList.remove('drag-over'));
      persistTrendingOrder();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row === dragEl) return;
      row.classList.add('drag-over');
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      list.insertBefore(dragEl, before ? row : row.nextSibling);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
    });
  });

  ensureTrendingOrderObserver(list);
}

// Renumbers the visible index badges live as rows are dragged around —
// set up once (observing the list container itself, which persists across
// re-renders) rather than re-created on every catalog snapshot.
let trendingOrderObserverAttached = false;
function ensureTrendingOrderObserver(list){
  if (trendingOrderObserverAttached) return;
  trendingOrderObserverAttached = true;
  const observer = new MutationObserver(() => {
    list.querySelectorAll('.trending-order-row').forEach((row, i) => {
      const badge = row.querySelector('.trending-order-index');
      if (badge) badge.textContent = i + 1;
    });
  });
  observer.observe(list, { childList: true });
}

async function persistTrendingOrder(){
  const rows = document.querySelectorAll('#trendingOrderList .trending-order-row');
  const saves = [];
  rows.forEach((row, i) => {
    const movie = cachedMovies[row.dataset.id];
    if (!movie) return;
    if (movie.order === i) return; // unchanged, skip the write
    saves.push(svCatalog.saveMovie(Object.assign({}, movie, { order: i })));
  });
  if (saves.length) await Promise.all(saves);
  // svCatalog subscription re-renders this panel with the persisted order.
}


const titleModal = document.getElementById('titleModal');
const titleForm = document.getElementById('titleForm');
const titleModalHeading = document.getElementById('titleModalHeading');
const fCategory = document.getElementById('fCategory');
const seasonsManager = document.getElementById('seasonsManager');
const seasonsList = document.getElementById('seasonsList');
const seasonsEmptyHint = document.getElementById('seasonsEmptyHint');

// In-memory working copy of the seasons/episodes tree while the modal is
// open. Only written back into the saved movie object on submit.
let workingSeasons = [];
// "sIdx:eIdx" of the episode currently expanded into its inline edit form
// (only one at a time), or null if none is being edited.
let editingEpisodeKey = null;

function openTitleModal(movie){
  titleForm.reset();
  document.getElementById('editingOriginalId').value = movie ? movie.id : '';
  titleModalHeading.textContent = movie ? `Edit "${movie.title}"` : 'Add New Title';

  document.getElementById('fTitle').value = movie ? movie.title : '';
  document.getElementById('fId').value = movie ? movie.id : '';
  document.getElementById('fId').disabled = !!movie; // don't let id change on edit (keeps links stable)
  document.getElementById('fGenre').value = movie ? movie.genre : '';
  document.getElementById('fCategory').value = movie ? (movie.category || 'movie') : 'movie';
  document.getElementById('fYear').value = movie ? movie.year : '';
  document.getElementById('fRating').value = movie ? movie.rating : '';
  document.getElementById('fPoster').value = movie ? movie.poster : '';
  // Shows the existing poster as the preview when editing, or clears the
  // uploader back to empty when adding a new title. See admin-poster-upload.js.
  window.svPosterUpload.reset(movie ? movie.poster : '');
  document.getElementById('fBackdrop').value = movie ? (movie.backdrop || '') : '';
  document.getElementById('fDescription').value = movie ? (movie.description || '') : '';
  document.getElementById('fVideo').value = movie ? (movie.video || '') : '';
  document.getElementById('fDownloadUrl').value = movie ? (movie.downloadUrl || '') : '';
  document.getElementById('fFeatured').checked = movie ? !!movie.featured : false;
  document.getElementById('fTrending').checked = movie ? !!movie.trending : false;
  document.getElementById('fNewRelease').checked = movie ? !!movie.newRelease : false;

  // Deep-clone so edits inside the modal don't mutate the live catalog
  // until "Save Title" is actually submitted.
  workingSeasons = JSON.parse(JSON.stringify(window.svSeasons.getSeasons(movie)));
  editingEpisodeKey = null;
  renderSeasonsManager();
  updateSeasonsManagerVisibility();

  titleModal.classList.add('open');
}

function updateSeasonsManagerVisibility(){
  const show = fCategory.value !== 'movie' && fCategory.value !== 'sport';
  seasonsManager.style.display = show ? 'block' : 'none';
}
fCategory.addEventListener('change', updateSeasonsManagerVisibility);

/* ---------------------------- Seasons & Episodes manager ---------------------------- */
function renumberSeasons(){
  workingSeasons.forEach((s, i) => { s.number = i + 1; if (!s.title) s.title = `Season ${i + 1}`; });
}

function renderSeasonsManager(){
  renumberSeasons();
  seasonsEmptyHint.style.display = workingSeasons.length ? 'none' : 'block';

  seasonsList.innerHTML = workingSeasons.map((season, sIdx) => `
    <div class="season-block" data-season-idx="${sIdx}">
      <div class="season-block-head">
        <span class="season-number-tag">Season ${season.number}</span>
        <input type="text" class="season-title" data-season-field="title" data-season-idx="${sIdx}" value="${escapeHtml(season.title)}" placeholder="Season title">
        <input type="text" class="season-year" data-season-field="year" data-season-idx="${sIdx}" value="${escapeHtml(season.year || '')}" placeholder="Year">
      </div>

      ${season.episodes.length ? `
        <div class="episode-rows">
          ${season.episodes.map((ep, eIdx) => {
            const key = `${sIdx}:${eIdx}`;
            if (editingEpisodeKey === key){
              return `
              <div class="episode-edit-form" data-editing-episode="${key}">
                <input type="text" placeholder="Episode title" data-edit-ep-title="${key}" value="${escapeHtml(ep.title || '')}">
                <input type="text" placeholder="Duration (e.g. 42m)" data-edit-ep-duration="${key}" value="${escapeHtml(ep.duration || '')}">
                <input type="url" placeholder="Video URL (.mp4 or .m3u8)" class="full" data-edit-ep-video="${key}" value="${escapeHtml(ep.video || '')}">
                <input type="url" placeholder="Thumbnail URL (optional, falls back to poster)" class="full" data-edit-ep-thumb="${key}" value="${escapeHtml(ep.thumbnail || '')}">
                <input type="url" placeholder="Download link (optional)" class="full" data-edit-ep-download="${key}" value="${escapeHtml(ep.downloadUrl || '')}">
                <textarea placeholder="Episode description (optional)" class="full" data-edit-ep-desc="${key}">${escapeHtml(ep.description || '')}</textarea>
                <div class="full" style="display:flex;gap:8px;justify-content:flex-end;">
                  <button type="button" class="btn-admin ghost small" data-cancel-edit-ep="${key}">Cancel</button>
                  <button type="button" class="btn-admin small" data-save-edit-ep="${key}">Save Episode</button>
                </div>
              </div>`;
            }
            return `
            <div class="episode-row">
              <span class="ep-num">E${ep.number}</span>
              <span class="ep-title-cell" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</span>
              <span class="ep-duration-cell">${escapeHtml(ep.duration || '')}</span>
              <span class="ep-actions">
                <button type="button" data-move-up="${key}" ${eIdx === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" data-move-down="${key}" ${eIdx === season.episodes.length - 1 ? 'disabled' : ''}>↓</button>
                <button type="button" data-edit-ep="${key}">Edit</button>
                <button type="button" class="danger" data-del-ep="${key}">Delete</button>
              </span>
            </div>`;
          }).join('')}
        </div>` : `<p class="field-hint">No episodes in this season yet.</p>`}

      <div class="episode-add-form">
        <input type="text" placeholder="Episode title" data-new-ep-title="${sIdx}">
        <input type="text" placeholder="Duration (e.g. 42m)" data-new-ep-duration="${sIdx}">
        <input type="url" placeholder="Video URL (.mp4 or .m3u8)" class="full" data-new-ep-video="${sIdx}">
        <input type="url" placeholder="Thumbnail URL (optional, falls back to poster)" class="full" data-new-ep-thumb="${sIdx}">
        <textarea placeholder="Episode description (optional)" class="full" data-new-ep-desc="${sIdx}"></textarea>
        <button type="button" class="btn-admin secondary small full" data-add-ep="${sIdx}">+ Add This Episode</button>
        <label class="bulk-drop-zone" data-bulk-zone="${sIdx}">
          Drag &amp; drop multiple video files here to bulk-add episodes (auto-numbered from filenames),
          or click to choose files.
          <input type="file" accept="video/*" multiple data-bulk-input="${sIdx}">
        </label>
      </div>

      <div class="season-block-actions">
        <span></span>
        <button type="button" class="btn-admin danger small" data-del-season="${sIdx}">Delete Season</button>
      </div>
    </div>`).join('');

  wireSeasonsManagerEvents();
}

function wireSeasonsManagerEvents(){
  seasonsList.querySelectorAll('[data-season-field]').forEach(input => {
    input.addEventListener('input', () => {
      const idx = Number(input.dataset.seasonIdx);
      workingSeasons[idx][input.dataset.seasonField] = input.value;
    });
  });

  seasonsList.querySelectorAll('[data-del-season]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.delSeason);
      if (confirm(`Delete "${workingSeasons[idx].title}" and all its episodes?`)){
        workingSeasons.splice(idx, 1);
        editingEpisodeKey = null;
        renderSeasonsManager();
      }
    });
  });

  seasonsList.querySelectorAll('[data-del-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [sIdx, eIdx] = btn.dataset.delEp.split(':').map(Number);
      workingSeasons[sIdx].episodes.splice(eIdx, 1);
      if (editingEpisodeKey === btn.dataset.delEp) editingEpisodeKey = null;
      renderSeasonsManager();
    });
  });

  seasonsList.querySelectorAll('[data-edit-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingEpisodeKey = btn.dataset.editEp;
      renderSeasonsManager();
    });
  });

  seasonsList.querySelectorAll('[data-cancel-edit-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingEpisodeKey = null;
      renderSeasonsManager();
    });
  });

  seasonsList.querySelectorAll('[data-save-edit-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveEditEp;
      const [sIdx, eIdx] = key.split(':').map(Number);
      const episode = workingSeasons[sIdx].episodes[eIdx];
      const title = seasonsList.querySelector(`[data-edit-ep-title="${key}"]`).value.trim();
      const video = seasonsList.querySelector(`[data-edit-ep-video="${key}"]`).value.trim();
      if (!title || !video){ alert('Please provide at least an episode title and video URL.'); return; }
      episode.title = title;
      episode.video = video;
      episode.duration = seasonsList.querySelector(`[data-edit-ep-duration="${key}"]`).value.trim();
      episode.thumbnail = seasonsList.querySelector(`[data-edit-ep-thumb="${key}"]`).value.trim();
      episode.downloadUrl = seasonsList.querySelector(`[data-edit-ep-download="${key}"]`).value.trim();
      episode.description = seasonsList.querySelector(`[data-edit-ep-desc="${key}"]`).value.trim();
      editingEpisodeKey = null;
      renderSeasonsManager();
    });
  });

  seasonsList.querySelectorAll('[data-move-up]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [sIdx, eIdx] = btn.dataset.moveUp.split(':').map(Number);
      const eps = workingSeasons[sIdx].episodes;
      [eps[eIdx - 1], eps[eIdx]] = [eps[eIdx], eps[eIdx - 1]];
      editingEpisodeKey = null;
      renderSeasonsManager();
    });
  });
  seasonsList.querySelectorAll('[data-move-down]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [sIdx, eIdx] = btn.dataset.moveDown.split(':').map(Number);
      const eps = workingSeasons[sIdx].episodes;
      [eps[eIdx + 1], eps[eIdx]] = [eps[eIdx], eps[eIdx + 1]];
      editingEpisodeKey = null;
      renderSeasonsManager();
    });
  });

  seasonsList.querySelectorAll('[data-add-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sIdx = Number(btn.dataset.addEp);
      const season = workingSeasons[sIdx];
      const title = seasonsList.querySelector(`[data-new-ep-title="${sIdx}"]`).value.trim();
      const video = seasonsList.querySelector(`[data-new-ep-video="${sIdx}"]`).value.trim();
      if (!title || !video){ alert('Please provide at least an episode title and video URL.'); return; }
      const duration = seasonsList.querySelector(`[data-new-ep-duration="${sIdx}"]`).value.trim();
      const thumbnail = seasonsList.querySelector(`[data-new-ep-thumb="${sIdx}"]`).value.trim();
      const description = seasonsList.querySelector(`[data-new-ep-desc="${sIdx}"]`).value.trim();
      const number = window.svSeasons.nextEpisodeNumber(season);
      season.episodes.push({
        id: `s${season.number}e${number}-${Date.now().toString(36)}`,
        number, title, description, thumbnail, video, downloadUrl: '', duration,
        uploadDate: new Date().toISOString().slice(0, 10)
      });
      renderSeasonsManager();
    });
  });

  // Bulk drag-and-drop / multi-file upload
  seasonsList.querySelectorAll('[data-bulk-zone]').forEach(zone => {
    const sIdx = Number(zone.dataset.bulkZone);
    const input = zone.querySelector('[data-bulk-input]');
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => handleBulkFiles(sIdx, input.files));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      handleBulkFiles(sIdx, e.dataTransfer.files);
    });
  });
}

function handleBulkFiles(sIdx, fileList){
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('video/'));
  if (!files.length) return;
  const season = workingSeasons[sIdx];
  files.forEach(file => {
    const number = window.svSeasons.nextEpisodeNumber(season);
    const niceTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
    season.episodes.push({
      id: `s${season.number}e${number}-${Date.now().toString(36)}-${number}`,
      number,
      title: niceTitle || `Episode ${number}`,
      description: '',
      thumbnail: '',
      // Local object URL so it previews immediately in this browser session.
      // Swap for a real hosted video URL (CDN / storage bucket) before
      // publishing — object URLs don't persist across page reloads or
      // other viewers' browsers.
      video: URL.createObjectURL(file),
      downloadUrl: '',
      duration: '',
      uploadDate: new Date().toISOString().slice(0, 10)
    });
  });
  renderSeasonsManager();
  alert(`Added ${files.length} episode(s) from local files. Note: these use temporary local preview links — replace each Video URL with a real hosted link (CDN/storage) before this goes live for other viewers.`);
}

function addSeasonToWorking(){
  workingSeasons.push({ number: workingSeasons.length + 1, title: '', year: '', episodes: [] });
  renderSeasonsManager();
}
document.getElementById('addSeasonBtn').addEventListener('click', addSeasonToWorking);
function closeTitleModal(){ titleModal.classList.remove('open'); }

document.getElementById('addTitleBtn').addEventListener('click', () => openTitleModal(null));
document.getElementById('cancelModalBtn').addEventListener('click', closeTitleModal);
titleModal.addEventListener('click', (e) => { if (e.target === titleModal) closeTitleModal(); });

titleForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Block saving mid-upload — otherwise a save could go through before the
  // Cloudinary URL has come back, leaving #fPoster empty or pointed at a
  // half-finished upload. See admin-poster-upload.js.
  if (window.svPosterUpload.isUploading()){
    alert('Please wait for the poster image to finish uploading before saving.');
    return;
  }
  // #fPoster is a hidden field now (see admin.html), and hidden inputs are
  // exempt from HTML5's `required` validation, so this check replaces the
  // browser-native guard the old visible <input required> used to give us.
  if (!document.getElementById('fPoster').value.trim()){
    alert('Please upload a poster image before saving.');
    return;
  }

  const originalId = document.getElementById('editingOriginalId').value;
  const id = originalId || document.getElementById('fId').value.trim()
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  if (!id){ alert('Please provide a valid ID.'); return; }
  if (!originalId && cachedMovies[id]){ alert('That ID is already in use — pick a different one.'); return; }

  const existing = originalId ? cachedMovies[originalId] : null;
  const trendingNow = document.getElementById('fTrending').checked;
  // Newly-trending titles join the end of the slideshow order; titles that
  // were already trending keep their existing position (reordering happens
  // via drag-and-drop in the Trending Slideshow Order panel instead).
  let order = existing ? (existing.order ?? 0) : 0;
  if (trendingNow && !(existing && existing.trending)){
    const trendingCount = Object.values(cachedMovies).filter(m => m.trending).length;
    order = trendingCount;
  }

  const movie = {
    id,
    title: document.getElementById('fTitle').value.trim(),
    genre: document.getElementById('fGenre').value.trim(),
    category: document.getElementById('fCategory').value,
    year: document.getElementById('fYear').value.trim(),
    rating: document.getElementById('fRating').value.trim(),
    poster: document.getElementById('fPoster').value.trim(),
    backdrop: document.getElementById('fBackdrop').value.trim(),
    description: document.getElementById('fDescription').value.trim(),
    video: document.getElementById('fVideo').value.trim(),
    downloadUrl: document.getElementById('fDownloadUrl').value.trim(),
    featured: document.getElementById('fFeatured').checked,
    trending: trendingNow,
    newRelease: document.getElementById('fNewRelease').checked,
    order,
    subtitles: existing ? existing.subtitles : [],
    // Legacy flat `episodes` is no longer written for new/edited titles —
    // everything lives under `seasons` now. renumberSeasons() keeps
    // season.number contiguous with the on-screen order.
    episodes: [],
    seasons: (() => { renumberSeasons(); return workingSeasons.filter(s => s.episodes.length || s.title); })()
  };

  const submitBtn = titleForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
  try{
    await svCatalog.saveMovie(movie);
    closeTitleModal();
    // svCatalog subscription re-renders content + dashboard everywhere.
  } catch(err){
    alert('Could not save this title: ' + (err.message || err));
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Save Title';
  }
});

/* ---------------------------- Users panel ---------------------------- */
async function renderUsers(){
  cachedUsers = await svAuth.listUsers();
  const users = cachedUsers;
  document.getElementById('userCount').textContent = `${users.length} account${users.length === 1 ? '' : 's'}`;

  const body = document.getElementById('usersTableBody');
  if (users.length === 0){
    body.innerHTML = `<tr><td colspan="8"><div class="empty-state">No accounts yet.</div></td></tr>`;
    return;
  }

  body.innerHTML = users.slice().sort((a,b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt)).map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.role === 'admin' ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-viewer">Viewer</span>'}</td>
      <td>${escapeHtml(svAuth.getPlan(u.plan || 'basic').label)}</td>
      <td>${u.planExpiresAt ? formatExpiryDate(u.planExpiresAt) : '—'}</td>
      <td>${u.banned ? '<span class="badge badge-banned">Suspended</span>' : '<span class="badge badge-active">Active</span>'}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td style="white-space:nowrap;">
        ${u.role === 'admin' ? '' : `
          <button class="btn-admin small" data-editplan="${u.uid}">Edit Plan</button>
          <button class="btn-admin secondary small" data-ban="${u.uid}">${u.banned ? 'Unsuspend' : 'Suspend'}</button>
          <button class="btn-admin danger small" data-deluser="${u.uid}">Delete</button>
        `}
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-editplan]').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = cachedUsers.find(x => x.uid === btn.dataset.editplan);
      openPlanModal(u);
    });
  });
  body.querySelectorAll('[data-ban]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const u = cachedUsers.find(x => x.uid === btn.dataset.ban);
      await svAuth.setBanned(u.uid, u.username, !u.banned);
      renderUsers();
      renderDashboard();
    });
  });
  body.querySelectorAll('[data-deluser]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const u = cachedUsers.find(x => x.uid === btn.dataset.deluser);
      if (confirm(`Delete the account "${u.username}"? This can't be undone.`)){
        await svAuth.deleteUserProfile(u.uid, u.username);
        renderUsers();
        renderDashboard();
      }
    });
  });
}

/* ------------------------- Users panel: Edit Plan modal ------------------------- */
// Admin-only control: this is the ONLY place a user's Standard/Premium plan
// can be granted. Viewers can self-downgrade to Basic from their profile
// page, but cannot self-assign a paid plan — svAuth.upgradePlan() rejects
// that. Renewals/changes here always go through svAuth.setUserPlan().
const planModal        = document.getElementById('planModal');
const planForm          = document.getElementById('planForm');
const planModalSub      = document.getElementById('planModalSub');
const pUid               = document.getElementById('pUid');
const pPlanKey           = document.getElementById('pPlanKey');
const pMonths            = document.getElementById('pMonths');
const pMonthsField       = document.getElementById('pMonthsField');
const pTotalPreview      = document.getElementById('pTotalPreview');
const planFormStatus     = document.getElementById('planFormStatus');

function openPlanModal(user){
  planForm.reset();
  planFormStatus.textContent = '';
  pUid.value = user.uid;
  planModalSub.textContent = `Setting the plan for ${user.username} (${user.email})`;
  // Rebuild the options from the live plan catalog each time the modal
  // opens, so any admin-edited price (see Payments → Plan Pricing) and
  // the current billing currency symbol are always shown correctly.
  pPlanKey.innerHTML = svAuth.getPlans().map((p) =>
    `<option value="${p.key}">${escapeHtml(p.label)} — ${escapeHtml(p.price)}</option>`
  ).join('');
  pPlanKey.value = user.plan || 'basic';
  pMonths.value = user.planMonths || 1;
  updatePlanFormVisibility();
  planModal.classList.add('open');
}
function closePlanModal(){ planModal.classList.remove('open'); }

function updatePlanFormVisibility(){
  const isBasic = pPlanKey.value === 'basic';
  pMonthsField.style.display = isBasic ? 'none' : 'flex';
  if (isBasic) {
    pTotalPreview.textContent = 'Basic is free — no billing duration needed.';
    return;
  }
  const plan = svAuth.getPlan(pPlanKey.value);
  const months = Math.max(1, parseInt(pMonths.value, 10) || 1);
  const unitPrice = parseFloat(String(plan.price).replace(/[^0-9.]/g, '')) || 0;
  const total = (unitPrice * months).toFixed(2);
  pTotalPreview.textContent = `${plan.price} × ${months} month${months === 1 ? '' : 's'} = ${svAuth.getBillingCurrencySymbol()}${total} total`;
}
pPlanKey.addEventListener('change', updatePlanFormVisibility);
pMonths.addEventListener('input', updatePlanFormVisibility);

document.getElementById('cancelPlanBtn').addEventListener('click', closePlanModal);
planModal.addEventListener('click', (e) => { if (e.target === planModal) closePlanModal(); });

planForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = cachedUsers.find(x => x.uid === pUid.value);
  if (!u) return;
  const saveBtn = document.getElementById('savePlanBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  const result = await svAuth.setUserPlan(u.uid, u.username, pPlanKey.value, pMonths.value);
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Plan';
  if (!result.ok) {
    planFormStatus.textContent = result.error;
    planFormStatus.style.color = '#ff8b90';
    return;
  }
  planFormStatus.style.color = '#3ee082';
  planFormStatus.textContent = 'Plan updated.';
  await renderUsers();
  setTimeout(closePlanModal, 500);
});

/* ---------------------------- Payments panel ---------------------------- */
let cachedPaymentMethods = {};
let cachedPlanPricing = [];

async function renderPaymentsPanel(){
  await svAuth.refreshPlanPricing();
  renderPlanPricingEditor();
  await renderPaymentMethodsEditor();
  await renderUpgradeRequests();
}

function escapeAttr(str){
  return escapeHtml(str).replace(/"/g, '&quot;');
}

/* ---- Plan pricing (billing price/month, editable by admin) ---- */
function renderPlanPricingEditor(){
  cachedPlanPricing = svAuth.getPlans();
  const editor = document.getElementById('planPricingEditor');
  editor.innerHTML = cachedPlanPricing.map((p) => {
    const isFree = p.key === 'basic';
    const currentValue = isFree ? '0' : (parseFloat(String(p.price).replace(/[^0-9.]/g, '')) || 0).toFixed(2);
    return `
    <div class="plan-price-card" data-plan-key="${p.key}">
      <h4>${escapeHtml(p.label)}</h4>
      <p class="plan-price-sub">${isFree ? 'Always free — not editable' : 'Monthly billing price'}</p>
      <div class="plan-price-input-wrap">
        <span>${escapeHtml(svAuth.getBillingCurrencySymbol())}</span>
        <input type="number" class="plan-price-input" min="0" step="0.01" value="${currentValue}" ${isFree ? 'disabled' : ''} aria-label="${escapeAttr(p.label)} monthly price">
        <small>/mo</small>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('savePlanPricingBtn').addEventListener('click', async () => {
  const btn = document.getElementById('savePlanPricingBtn');
  const statusEl = document.getElementById('planPricingStatus');
  const prices = {};
  document.querySelectorAll('#planPricingEditor [data-plan-key]').forEach((card) => {
    const key = card.dataset.planKey;
    if (key === 'basic') return;
    const input = card.querySelector('.plan-price-input');
    const val = parseFloat(input.value);
    prices[key] = isNaN(val) ? 0 : val;
  });
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const result = await svAuth.updatePlanPricing(prices);
  btn.disabled = false;
  btn.textContent = 'Save Pricing';
  statusEl.classList.remove('ok','err');
  statusEl.classList.add('show', result.ok ? 'ok' : 'err');
  statusEl.textContent = result.ok ? 'Plan pricing saved.' : result.error;
  if (result.ok) {
    renderPlanPricingEditor();
    setTimeout(() => statusEl.classList.remove('show'), 3000);
  }
});

/* ---- Checkout payment methods (structured per-method fields) ---- */
// Field layout per method key: id, label, placeholder, and either
// type 'text' or type 'select' (with its own options). `wide: true`
// spans the full grid row (used for the Card Purchase billing address).
const PM_FIELD_DEFS = {
  transfer: [
    { id: 'bankName', label: 'Bank Name', placeholder: 'Global Trust Bank' },
    { id: 'accountName', label: 'Account Name', placeholder: 'StreamVerse Ltd' },
    { id: 'accountNumber', label: 'Account Number', placeholder: '12345678901234' },
    { id: 'swift', label: 'SWIFT / BIC', placeholder: 'GTBGB2L' },
    { id: 'currency', label: 'Currency', type: 'select' }
  ],
  bankDeposit: [
    { id: 'bankName', label: 'Bank Name', placeholder: 'Global Trust Bank' },
    { id: 'accountName', label: 'Account Name', placeholder: 'StreamVerse Ltd' },
    { id: 'accountNumber', label: 'Account Number', placeholder: '12345678901234' },
    { id: 'branchCode', label: 'Branch Code', placeholder: '001' },
    { id: 'depositSlipReference', label: 'Deposit Slip Reference', placeholder: 'DEP-00012345' }
  ],
  card: [
    { id: 'cardholderName', label: 'Cardholder Name', placeholder: 'John Doe' },
    { id: 'cardNumber', label: 'Card Number', placeholder: '1234 5678 9012 3456' },
    { id: 'expiry', label: 'Expiry Date', placeholder: 'MM/YY' },
    { id: 'cvv', label: 'CVV', placeholder: '123' },
    { id: 'billingEmail', label: 'Billing Email', placeholder: 'john@example.com' },
    { id: 'billingAddress', label: 'Billing Address', placeholder: '123 Main St, City, State, ZIP, Country', wide: true }
  ]
};

function renderPmField(methodKey, field, currentFields){
  const value = (currentFields && currentFields[field.id]) || '';
  const wideClass = field.wide ? ' pm-field-wide' : '';
  const inputId = `pm-${methodKey}-${field.id}`;
  if (field.type === 'select') {
    const options = svAuth.getPaymentCurrencies().map((c) =>
      `<option value="${c.code}" ${value === c.code ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
    ).join('');
    return `
      <div class="pm-field${wideClass}">
        <label for="${inputId}">${escapeHtml(field.label)}</label>
        <select id="${inputId}" class="pm-data-field" data-field="${field.id}">${options}</select>
      </div>`;
  }
  return `
    <div class="pm-field${wideClass}">
      <label for="${inputId}">${escapeHtml(field.label)}</label>
      <input type="text" id="${inputId}" class="pm-data-field" data-field="${field.id}" value="${escapeAttr(value)}" placeholder="${escapeAttr(field.placeholder || '')}">
    </div>`;
}

async function renderPaymentMethodsEditor(){
  cachedPaymentMethods = await svAuth.getPaymentMethods();
  const editor = document.getElementById('paymentMethodsEditor');
  editor.innerHTML = Object.values(cachedPaymentMethods).map((m) => {
    const fieldDefs = PM_FIELD_DEFS[m.key] || [];
    const fieldsHtml = fieldDefs.map((f) => renderPmField(m.key, f, m.fields)).join('');
    return `
    <div class="pm-card" data-method="${m.key}" data-enabled="${m.enabled ? 'true' : 'false'}">
      <div class="pm-card-head">
        <label class="switch">
          <input type="checkbox" class="pm-enabled" ${m.enabled ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
        <input type="text" class="pm-label" value="${escapeAttr(m.label)}" aria-label="Payment method name">
        <span class="pm-card-badge">${m.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <p class="pm-helper">${escapeHtml(m.instructions || '')}</p>
      <div class="pm-grid">${fieldsHtml}</div>
    </div>`;
  }).join('');

  editor.querySelectorAll('.pm-enabled').forEach((cb) => {
    cb.addEventListener('change', () => {
      const card = cb.closest('.pm-card');
      card.dataset.enabled = cb.checked ? 'true' : 'false';
      card.querySelector('.pm-card-badge').textContent = cb.checked ? 'Enabled' : 'Disabled';
    });
  });
}

document.getElementById('savePaymentMethodsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('savePaymentMethodsBtn');
  const statusEl = document.getElementById('paymentMethodsStatus');
  const updated = {};
  document.querySelectorAll('#paymentMethodsEditor [data-method]').forEach((card) => {
    const key = card.dataset.method;
    const fields = {};
    card.querySelectorAll('.pm-data-field').forEach((el) => {
      fields[el.dataset.field] = el.value.trim();
    });
    updated[key] = {
      ...cachedPaymentMethods[key],
      key,
      enabled: card.querySelector('.pm-enabled').checked,
      label: card.querySelector('.pm-label').value.trim() || cachedPaymentMethods[key].label,
      instructions: cachedPaymentMethods[key].instructions || '',
      fields
    };
  });
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const result = await svAuth.updatePaymentMethods(updated);
  btn.disabled = false;
  btn.textContent = 'Save Payment Methods';
  statusEl.classList.remove('ok','err');
  statusEl.classList.add('show', result.ok ? 'ok' : 'err');
  statusEl.textContent = result.ok ? 'Payment methods saved.' : result.error;
  if (result.ok) {
    cachedPaymentMethods = updated;
    setTimeout(() => statusEl.classList.remove('show'), 3000);
  }
});

let cachedUpgradeRequests = [];

async function renderUpgradeRequests(){
  cachedUpgradeRequests = await svAuth.listUpgradeRequests();
  const pendingCount = cachedUpgradeRequests.filter(r => r.status === 'pending').length;
  document.getElementById('upgradeRequestCount').textContent =
    `${pendingCount} pending request${pendingCount === 1 ? '' : 's'} · ${cachedUpgradeRequests.length} total`;

  const body = document.getElementById('upgradeRequestsBody');
  if (cachedUpgradeRequests.length === 0){
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state">No upgrade requests yet.</div></td></tr>`;
    return;
  }

  const statusBadge = (s) => {
    if (s === 'approved') return '<span class="badge badge-active">Approved</span>';
    if (s === 'rejected') return '<span class="badge badge-banned">Rejected</span>';
    return '<span class="badge badge-viewer">Pending</span>';
  };

  body.innerHTML = cachedUpgradeRequests.map(r => `
    <tr>
      <td>${escapeHtml(r.username)}<br><span class="card-sub" style="font-size:11px;">${escapeHtml(r.email || '')}</span></td>
      <td>${escapeHtml(r.planLabel)} (${escapeHtml(r.planPrice)})</td>
      <td>${r.months}</td>
      <td>${escapeHtml(r.methodLabel)}</td>
      <td>${escapeHtml(r.note || '—')}</td>
      <td>${r.proofUrl ? `<button class="btn-admin ghost small" data-view-proof="${r.id}">View ${r.proofType === 'application/pdf' ? 'PDF' : 'JPG'}</button>` : '<span class="card-sub">—</span>'}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${formatDate(r.createdAt)}</td>
      <td style="white-space:nowrap;">
        ${r.status === 'pending' ? `
          <button class="btn-admin small" data-approve="${r.id}">Approve</button>
          <button class="btn-admin danger small" data-reject="${r.id}">Reject</button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-view-proof]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = cachedUpgradeRequests.find(x => x.id === btn.dataset.viewProof);
      if (r) openProofModal(r);
    });
  });
  body.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const result = await svAuth.approveUpgradeRequest(btn.dataset.approve);
      if (!result.ok) { alert(result.error); btn.disabled = false; return; }
      renderUpgradeRequests();
      renderUsers();
    });
  });
  body.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt('Reason for rejecting this request (optional):') || '';
      btn.disabled = true;
      const result = await svAuth.rejectUpgradeRequest(btn.dataset.reject, reason);
      if (!result.ok) { alert(result.error); btn.disabled = false; return; }
      renderUpgradeRequests();
    });
  });
}

/* -------------------- Proof of payment preview modal -------------------- */
// Lets an admin visually confirm a viewer's bank transfer slip (PDF or JPG)
// before approving their upgrade request, without leaving the dashboard.
// proofUrl is a base64 data: URL (stored directly in Firestore — see
// firebase-auth.js). Chrome blocks top-level navigation to data: URLs, so
// we convert it to a blob: URL for both the inline preview and the
// "Open in New Tab" link.
const proofModal        = document.getElementById('proofModal');
const proofModalSub     = document.getElementById('proofModalSub');
const proofModalBody    = document.getElementById('proofModalBody');
const proofOpenNewTab   = document.getElementById('proofOpenNewTab');
const closeProofBtn     = document.getElementById('closeProofBtn');
let currentProofBlobUrl = null;

async function openProofModal(r){
  proofModalSub.textContent = `${r.username} — ${r.planLabel}, submitted ${formatDate(r.createdAt)}`;
  proofModalBody.innerHTML = '<p class="card-sub" style="padding:16px;">Loading…</p>';
  proofOpenNewTab.href = '#';
  proofModal.classList.add('open');
  try {
    const resp = await fetch(r.proofUrl);
    const blob = await resp.blob();
    currentProofBlobUrl = URL.createObjectURL(blob);
    proofOpenNewTab.href = currentProofBlobUrl;
    if (r.proofType === 'application/pdf') {
      proofModalBody.innerHTML = `<iframe src="${currentProofBlobUrl}" style="width:100%;height:65vh;border:0;display:block;"></iframe>`;
    } else {
      proofModalBody.innerHTML = `<img src="${currentProofBlobUrl}" alt="Proof of payment" style="width:100%;display:block;">`;
    }
  } catch (err) {
    proofModalBody.innerHTML = '<p class="card-sub" style="padding:16px;">Could not load this proof of payment.</p>';
  }
}
function closeProofModal(){
  proofModal.classList.remove('open');
  proofModalBody.innerHTML = '';
  if (currentProofBlobUrl) { URL.revokeObjectURL(currentProofBlobUrl); currentProofBlobUrl = null; }
}
closeProofBtn.addEventListener('click', closeProofModal);
proofModal.addEventListener('click', (e) => { if (e.target === proofModal) closeProofModal(); });

/* ---------------------------- Activity log ---------------------------- */
function updateLogBotStatusText(enabled){
  const el = document.getElementById('logBotStatusText');
  if (!el) return;
  el.textContent = enabled
    ? 'Records every login, logout, content change, and moderation action automatically. Turn off to pause new entries — existing history is kept either way.'
    : 'Paused — new account and content activity is not being recorded. Existing history below is untouched. Turn back on to resume logging.';
}

function renderLog(){
  const log = svGetLog();
  const list = document.getElementById('logList');
  const botOff = svAuth && typeof svAuth.isLoggingEnabled === 'function' && !svAuth.isLoggingEnabled();
  const pausedBanner = botOff
    ? `<div class="empty-state">Logging bot is currently paused — new activity won't appear here until it's re-enabled above.</div>`
    : '';
  if (log.length === 0){
    list.innerHTML = pausedBanner || `<div class="empty-state">No activity yet.</div>`;
    return;
  }
  list.innerHTML = pausedBanner + log.map(entry => `
    <div class="log-row">
      <span class="log-msg">${escapeHtml(entry.message)}</span>
      <span class="log-time">${timeAgo(entry.time)}</span>
    </div>`).join('');
}

const CATEGORY_LABELS = {
  general: 'General',
  downtime: 'Downtime',
  'new-movie': 'New Movie',
  tickets: 'Tickets'
};

function renderBroadcasts(broadcasts){
  document.getElementById('broadcastCount').textContent =
    `${broadcasts.length} broadcast${broadcasts.length === 1 ? '' : 's'} sent`;

  const body = document.getElementById('broadcastTableBody');
  const empty = document.getElementById('broadcastEmpty');
  if (broadcasts.length === 0){
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = broadcasts.map(b => `
    <tr>
      <td>${b.icon || '📢'}</td>
      <td>${escapeHtml(b.title)}</td>
      <td>${escapeHtml(b.body || '')}</td>
      <td>${escapeHtml(CATEGORY_LABELS[b.category] || 'General')}</td>
      <td>${timeAgo(b.createdAt)}</td>
      <td><button class="btn-admin danger small" data-removebroadcast="${b.id}">Remove</button></td>
    </tr>`).join('');

  body.querySelectorAll('[data-removebroadcast]').forEach(btn => {
    btn.addEventListener('click', () => svBroadcast.remove(btn.dataset.removebroadcast));
  });
}

function renderContactMessages(messages){
  document.getElementById('contactMsgCount').textContent =
    `${messages.length} message${messages.length === 1 ? '' : 's'}` +
    (messages.some(m => !m.read) ? ` · ${messages.filter(m => !m.read).length} unread` : '');

  const body = document.getElementById('contactMsgTableBody');
  const empty = document.getElementById('contactMsgEmpty');
  if (messages.length === 0){
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const PLAN_TAGS = { guest: 'Guest', basic: 'Basic', standard: 'Standard', premium: 'Premium' };
  const preview = (str, len = 140) => {
    const clean = (str || '').trim();
    return clean.length > len ? escapeHtml(clean.slice(0, len)).trim() + '…' : escapeHtml(clean);
  };
  body.innerHTML = messages.map(m => `
    <tr style="${m.read ? '' : 'font-weight:600;'}">
      <td>${m.read ? '📩' : '🔵'}</td>
      <td>
        ${escapeHtml(m.name || 'StreamVerse visitor')}<br>
        <a href="mailto:${escapeHtml(m.email || '')}" style="color:var(--muted,#9aa0ab);font-weight:normal;font-size:12.5px;">${escapeHtml(m.email || '')}</a>
      </td>
      <td>${escapeHtml(m.type || 'Feedback')}</td>
      <td style="color:var(--text-low,#9aa0ab);font-weight:normal;max-width:320px;white-space:normal;line-height:1.5;">${preview(m.message)}</td>
      <td>${escapeHtml(PLAN_TAGS[m.plan] || m.plan || 'Guest')}</td>
      <td>${timeAgo(m.createdAt)}</td>
      <td><button class="btn-admin ghost small" data-viewmsg="${m.id}">View Message</button></td>
      <td style="white-space:nowrap;">
        <button class="btn-admin ghost small" data-toggleread="${m.id}" data-read="${m.read ? '1' : '0'}">${m.read ? 'Mark unread' : 'Mark read'}</button>
        <button class="btn-admin danger small" data-removemsg="${m.id}">Remove</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-viewmsg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = messages.find(m => m.id === btn.dataset.viewmsg);
      if (msg) openContactMsgModal(msg);
    });
  });
  body.querySelectorAll('[data-toggleread]').forEach(btn => {
    btn.addEventListener('click', () => svContactMessages.markRead(btn.dataset.toggleread, btn.dataset.read !== '1'));
  });
  body.querySelectorAll('[data-removemsg]').forEach(btn => {
    btn.addEventListener('click', () => svContactMessages.remove(btn.dataset.removemsg));
  });
}

/* ---- Contact message viewer (liquid glass popup, same pattern as proofModal) ---- */
const contactMsgModal      = document.getElementById('contactMsgModal');
const contactMsgModalSubj  = document.getElementById('contactMsgModalSubject');
const contactMsgModalMeta  = document.getElementById('contactMsgModalMeta');
const contactMsgModalBody  = document.getElementById('contactMsgModalBody');
const contactMsgModalReply = document.getElementById('contactMsgModalReply');
const closeContactMsgBtn   = document.getElementById('closeContactMsgBtn');

function openContactMsgModal(m){
  const PLAN_TAGS = { guest: 'Guest', basic: 'Basic', standard: 'Standard', premium: 'Premium' };
  contactMsgModalSubj.textContent = m.type || 'Feedback';
  contactMsgModalMeta.textContent =
    `${m.name || 'StreamVerse visitor'} · ${m.email || 'no email'} · ` +
    `${PLAN_TAGS[m.plan] || m.plan || 'Guest'} · ${timeAgo(m.createdAt)}`;
  contactMsgModalBody.textContent = m.message || '';
  contactMsgModalReply.href = `mailto:${m.email || ''}?subject=${encodeURIComponent('Re: ' + (m.type || 'your message to StreamVerse'))}`;
  contactMsgModal.classList.add('open');
  if (!m.read) svContactMessages.markRead(m.id, true);
}

function closeContactMsgModal(){
  contactMsgModal.classList.remove('open');
}

closeContactMsgBtn.addEventListener('click', closeContactMsgModal);
contactMsgModal.addEventListener('click', (e) => { if (e.target === contactMsgModal) closeContactMsgModal(); });

/* ---------------------------- Support Contact panel ---------------------------- */
// Manages app_config/supportContact via window.svSupportContact — the
// email/phone/extra-info block shown in the index.html footer's "Contact
// Us" popup. Extra-info rows are a free-form admin add/remove list.
let scExtraFields = []; // [{id,label,value}]

function scRenderExtraFields(){
  const list = document.getElementById('scExtraFieldsList');
  const emptyHint = document.getElementById('scExtraEmptyHint');
  if (!list) return;

  if (scExtraFields.length === 0){
    list.innerHTML = '';
    emptyHint.style.display = 'block';
    return;
  }
  emptyHint.style.display = 'none';
  list.innerHTML = scExtraFields.map((f, i) => `
    <div class="support-extra-row" data-index="${i}">
      <input type="text" class="sc-extra-label" placeholder="Label (e.g. Live Chat Hours)" value="${escapeHtml(f.label || '')}">
      <input type="text" class="sc-extra-value" placeholder="Value (e.g. 9am–6pm WAT, Mon–Fri)" value="${escapeHtml(f.value || '')}">
      <button type="button" class="btn-admin danger small" data-removeextra="${i}">Remove</button>
    </div>`).join('');

  list.querySelectorAll('.sc-extra-label').forEach((input, i) => {
    input.addEventListener('input', () => { scExtraFields[i].label = input.value; });
  });
  list.querySelectorAll('.sc-extra-value').forEach((input, i) => {
    input.addEventListener('input', () => { scExtraFields[i].value = input.value; });
  });
  list.querySelectorAll('[data-removeextra]').forEach(btn => {
    btn.addEventListener('click', () => {
      scExtraFields.splice(parseInt(btn.dataset.removeextra, 10), 1);
      scRenderExtraFields();
    });
  });
}

function initSupportContactPanel(){
  const emailInput = document.getElementById('scEmail');
  const phoneInput = document.getElementById('scPhone');
  const statusEl = document.getElementById('scStatus');

  svSupportContact.subscribe((info) => {
    emailInput.value = info.email || '';
    phoneInput.value = info.phone || '';
    scExtraFields = (info.extraInfo || []).map(f => ({ ...f }));
    scRenderExtraFields();
  });

  document.getElementById('scAddFieldBtn').addEventListener('click', () => {
    scExtraFields.push({ label: '', value: '' });
    scRenderExtraFields();
  });

  document.getElementById('scSaveBtn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('scSaveBtn');
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';
    statusEl.className = 'account-status';
    const result = await svSupportContact.save({
      email: emailInput.value,
      phone: phoneInput.value,
      extraInfo: scExtraFields
    });
    saveBtn.disabled = false;
    if (!result.ok){
      statusEl.textContent = result.error || 'Could not save.';
      statusEl.className = 'account-status show err';
      return;
    }
    statusEl.textContent = 'Saved — the Contact Us popup is now up to date.';
    statusEl.className = 'account-status show ok';
  });
}

/* ---------------------------- Auth gate ---------------------------- */
// Wait for firebase-auth.js (a module script) to finish loading, then
// check the signed-in user's role before showing anything.
function boot(){
  svAuth.currentUser().then((user) => {
    if (!user || user.role !== 'admin'){
      window.location.href = 'admin-login.html';
      return;
    }
    svUser = user;
    document.getElementById('adminWhoami').innerHTML =
      `<span class="avatar-circle" style="margin-right:2px;">${svUser.username.charAt(0).toUpperCase()}</span>
       <span style="color:var(--text-hi);font-weight:600;">${escapeHtml(svUser.username)}</span>`;
    initAdmin();
  });
}
function whenReady(cb){
  const authReady = !!window.svAuth;
  const catalogReady = !!window.svCatalog;
  const broadcastReady = !!window.svBroadcast;
  const supportReady = !!window.svSupportContact;
  const contactMsgReady = !!window.svContactMessages;
  if (authReady && catalogReady && broadcastReady && supportReady && contactMsgReady) return cb();
  let remaining = (authReady ? 0 : 1) + (catalogReady ? 0 : 1) + (broadcastReady ? 0 : 1) + (supportReady ? 0 : 1) + (contactMsgReady ? 0 : 1);
  function tick(){ if (--remaining <= 0) cb(); }
  if (!authReady) window.addEventListener('svAuthReady', tick, { once: true });
  if (!catalogReady) window.addEventListener('svCatalogReady', tick, { once: true });
  if (!broadcastReady) window.addEventListener('svBroadcastReady', tick, { once: true });
  if (!supportReady) window.addEventListener('svSupportContactReady', tick, { once: true });
  if (!contactMsgReady) window.addEventListener('svContactMessagesReady', tick, { once: true });
}
whenReady(boot);
