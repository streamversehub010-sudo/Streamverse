/* =========================================================================
   notifications.js
   -------------------------------------------------------------------------
   Renders the notification bell into the `.nav-right` slot on every page
   that has a `#navNotifSlot` element, sitting between the search box and
   the account dropdown (see index.html / category.html / viewer.html /
   profile.html / settings.html).

   - Signed-out visitors see nothing here (same pattern as nav-auth.js) —
     the slot stays empty so the navbar layout doesn't shift.
   - Notifications are stored per-account in localStorage (fast, no
     Firestore reads needed just to paint a bell) under
     `sv_notifs_<uid>`, so they persist across page loads / reloads for
     the same browser.
   - Other scripts push notifications via `window.svNotify.push(uid, {...})`
     — watch-tracker.js uses this for "badge unlocked" alerts.
   - Site-wide admin announcements (downtime notices, new-movie hype,
     cinema ticket news, "X is live now" alerts) come from broadcast.js /
     window.svBroadcast, which syncs one shared Firestore feed to every
     browser in real time. Those are merged into the same bell/panel here
     so each viewer has a single unified notification center. Since a
     broadcast is one shared doc (not copied per-user), "read" state for
     broadcasts is tracked locally per account under `sv_notifs_read_<uid>`
     (a set of broadcast ids that account has already seen).
   ========================================================================= */
(function () {
  const MAX_STORED = 50;

  function storageKey(uid) { return `sv_notifs_${uid}`; }
  function readBroadcastsKey(uid) { return `sv_notifs_read_${uid}`; }

  function loadAll(uid) {
    try {
      const raw = localStorage.getItem(storageKey(uid));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveAll(uid, list) {
    try { localStorage.setItem(storageKey(uid), JSON.stringify(list.slice(0, MAX_STORED))); }
    catch (e) { /* no-op */ }
  }

  function loadReadBroadcastIds(uid) {
    try {
      const raw = localStorage.getItem(readBroadcastsKey(uid));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveReadBroadcastIds(uid, ids) {
    try { localStorage.setItem(readBroadcastsKey(uid), JSON.stringify(ids.slice(0, 300))); }
    catch (e) { /* no-op */ }
  }

  /** Merges this account's personal alerts with the live site-wide
   *  broadcast feed into one time-sorted list the bell/panel can render. */
  function loadMerged(uid) {
    const personal = loadAll(uid).map(n => ({ ...n, kind: 'personal' }));
    const broadcasts = (window.svBroadcast ? window.svBroadcast.getSnapshot() : []);
    const readIds = new Set(loadReadBroadcastIds(uid));
    const broadcastNotifs = broadcasts.map(b => ({
      id: `bcast-${b.id}`,
      icon: b.icon || '📢',
      title: b.title,
      body: b.body,
      time: b.createdAt || Date.now(),
      read: readIds.has(b.id),
      kind: 'broadcast',
      broadcastId: b.id
    }));
    return [...personal, ...broadcastNotifs].sort((a, b) => b.time - a.time);
  }

  /** Public API other scripts use to raise a notification. */
  const svNotify = {
    push(uid, { icon, title, body } = {}) {
      if (!uid) return;
      const list = loadAll(uid);
      list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, icon: icon || '🔔', title: title || '', body: body || '', time: Date.now(), read: false });
      saveAll(uid, list);
      window.dispatchEvent(new Event('svNotifsChanged'));
    },
    markAllRead(uid) {
      const list = loadAll(uid).map(n => ({ ...n, read: true }));
      saveAll(uid, list);
      const broadcasts = window.svBroadcast ? window.svBroadcast.getSnapshot() : [];
      saveReadBroadcastIds(uid, broadcasts.map(b => b.id));
      window.dispatchEvent(new Event('svNotifsChanged'));
    },
    getAll(uid) { return loadMerged(uid); }
  };
  window.svNotify = svNotify;

  const slot = document.getElementById('navNotifSlot');
  if (!slot) return;

  document.addEventListener('click', () => {
    const openPanel = document.getElementById('notifPanel');
    if (openPanel) openPanel.classList.remove('open');
  });

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function render(user) {
    slot.innerHTML = '';
    if (!user) return; // guests never see the bell

    const notifs = svNotify.getAll(user.uid);
    const unread = notifs.filter(n => !n.read).length;

    const wrap = document.createElement('div');
    wrap.className = 'notif-menu';
    wrap.innerHTML = `
      <button class="notif-bell" id="notifBellBtn" aria-label="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        ${unread ? `<span class="notif-dot">${unread > 9 ? '9+' : unread}</span>` : ''}
      </button>
      <div class="notif-panel" id="notifPanel">
        <div class="notif-panel-head">
          <span>Notifications</span>
          ${notifs.length ? '<button type="button" id="notifMarkReadBtn">Mark all read</button>' : ''}
        </div>
        <div class="notif-list">
          ${notifs.length ? notifs.map(n => `
            <div class="notif-item${n.read ? '' : ' unread'}">
              <span class="notif-item-icon">${n.icon}</span>
              <div class="notif-item-body">
                <div class="notif-item-title">${n.title}</div>
                <div class="notif-item-desc">${n.body}</div>
                <div class="notif-item-time">${timeAgo(n.time)}</div>
              </div>
            </div>`).join('') : '<div class="notif-empty">You\'re all caught up — no notifications yet.</div>'}
        </div>
      </div>`;
    slot.appendChild(wrap);

    const bellBtn = document.getElementById('notifBellBtn');
    const panel = document.getElementById('notifPanel');
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    const markBtn = document.getElementById('notifMarkReadBtn');
    if (markBtn) {
      markBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        svNotify.markAllRead(user.uid);
      });
    }
  }

  let currentUser = null;
  function init() {
    svAuth.onChange((user) => {
      currentUser = user;
      render(user);
    });
    window.addEventListener('svNotifsChanged', () => render(currentUser));

    // The broadcast feed (admin announcements, live-stream alerts) loads
    // asynchronously from Firestore; re-render whenever it changes so new
    // broadcasts appear in the bell without a page refresh.
    function watchBroadcasts() {
      window.svBroadcast.subscribe(() => render(currentUser));
    }
    if (window.svBroadcast) watchBroadcasts();
    else window.addEventListener('svBroadcastReady', watchBroadcasts, { once: true });
  }

  if (window.svAuth) init();
  else window.addEventListener('svAuthReady', init, { once: true });
})();
