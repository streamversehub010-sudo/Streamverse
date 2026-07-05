/* =========================================================================
   cast.js — StreamVerse Cast & Second Screen
   -------------------------------------------------------------------------
   Adapted from the cast-demo project and wired directly into viewer.js /
   viewer.html so it works for every title in movieDatabase (movies, series,
   anime, cartoons, k-dramas, sports — every `category`), since they all
   flow through this one player page.

   PART 1  — Cast to TV: Google Cast SDK (Chromecast, real receiver
             session) with a Remote Playback API fallback (AirPlay on
             Safari, or the browser's native picker).
   PART 2  — Second Screen / Connect to PC: Presentation API where a real
             cast target exists, otherwise a seamless WebRTC (PeerJS)
             pairing via receiver.html — QR/link or a typed short code.
   PART 3  — Background playback: Media Session API + page-visibility
             resync so a paired second screen keeps playing on its own
             while this tab is backgrounded, and this tab snaps to the
             receiver's live position the moment it's foregrounded again.

   KEY DIFFERENCE FROM THE DEMO: nothing here plays a hardcoded sample
   video. Every cast/pairing/sync payload is built from `nowPlaying`, which
   viewer.js refreshes (via window.svCast.setNowPlaying) every time it
   loads a movie, episode, or subtitle — so whatever's actually on screen
   is exactly what gets cast or mirrored, including for hls.js-backed HLS
   sources whose <video>.currentSrc is a meaningless local blob: URL.
   ========================================================================= */
(function () {
  const video = document.getElementById('videoPlayer');
  if (!video) return; // not on the viewer page

  const castBtn         = document.getElementById('castBtn');
  const secondScreenBtn = document.getElementById('secondScreenBtn');
  const connectPcBtn    = document.getElementById('connectPcBtn');
  const disconnectBtn   = document.getElementById('disconnectBtn');
  const statusEl        = document.getElementById('castStatus');
  const qrPanel         = document.getElementById('castQrPanel');
  const qrImg           = document.getElementById('castQrImg');
  const secondScreenUrlEl = document.getElementById('castSecondScreenUrl');
  const qrPanelIntro    = document.getElementById('castQrIntro');
  const qrPanelLabel    = document.getElementById('castQrLabel');
  const qrPanelFooter   = document.getElementById('castQrFooter');
  const copyLinkBtn     = document.getElementById('castCopyLinkBtn');
  const joinPanel       = document.getElementById('castJoinPanel');
  const joinToggle      = document.getElementById('castJoinToggle');
  const joinCodeInput   = document.getElementById('castJoinCodeInput');
  const joinCodeBtn     = document.getElementById('castJoinCodeBtn');
  const joinStatus      = document.getElementById('castJoinStatus');

  // ---------------------------- Now playing (fed by viewer.js) ----------------------------
  // Replaces the demo's hardcoded Big Buck Bunny sample: this is StreamVerse's
  // actual source of truth for whatever cast/pairing/sync needs to send out.
  let nowPlaying = {
    url: video.currentSrc || video.src || '',
    contentType: 'video/mp4',
    title: document.title.replace(/^StreamVerse\s*—\s*/, '') || 'StreamVerse',
    subtitle: '',
    poster: '',
    subs: null // { label, lang, src } of the currently active subtitle track, or null
  };

  function castSourceUrl() {
    return nowPlaying.url || video.currentSrc || video.src || '';
  }

  function setStatus(text, connected) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('connected', !!connected);
  }

  // Public API — called by viewer.js on init(), on every loadSource(), and
  // whenever the subtitle selection changes, so this module is always
  // describing exactly what's on screen.
  window.svCast = {
    setNowPlaying(meta) {
      nowPlaying = Object.assign({}, nowPlaying, meta);
      setupMediaSession();
      // Mid-playback title change (e.g. autoplay moved to the next episode)
      // while already casting/paired — push the update out immediately
      // instead of waiting for the next natural sync tick.
      if (peerConnection || presentationConnection) sendState();
      if (isCastSessionActive()) loadCastMedia();
    }
  };

  // ============================================================
  // PLAN GATING — Cast to TV, Second Screen, and Connect to PC are all
  // Standard/Premium perks (Basic stays single-device, per the plan
  // cards). Uses the same shared svUpgrade helper as the Download button
  // (upgrade-trigger.js) so there's one eligibility check and one upgrade
  // flow site-wide, refreshed live on sign-in/out/plan changes.
  // ============================================================
  const CAST_MIN_PLAN = 'standard';
  const gatedCastBtns = [castBtn, secondScreenBtn, connectPcBtn].filter(Boolean);

  async function isCastEligible() {
    if (!window.svUpgrade) return true; // fail open if the module hasn't loaded
    try { return await svUpgrade.meetsPlan(CAST_MIN_PLAN); } catch (e) { return true; }
  }

  // Blocks a gated action and sends the viewer to the upgrade flow;
  // returns whether the action should proceed.
  async function requireCastPlan(reason) {
    const ok = await isCastEligible();
    if (!ok && window.svUpgrade) svUpgrade.promptUpgrade(reason);
    return ok;
  }

  async function refreshCastGating() {
    const eligible = await isCastEligible();
    gatedCastBtns.forEach((btn) => {
      if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title || '';
      btn.classList.toggle('locked', !eligible);
      btn.title = eligible
        ? btn.dataset.baseTitle
        : `${btn.dataset.baseTitle} — Standard/Premium plan required`.trim();
    });
  }
  refreshCastGating();
  if (window.svAuth) svAuth.onChange(refreshCastGating);
  else window.addEventListener('svAuthReady', () => { svAuth.onChange(refreshCastGating); }, { once: true });

  // ============================================================
  // PART 1: CAST TO TV — Google Cast SDK, with Remote Playback API fallback
  // ============================================================
  let gCastReady = false;

  function isCastSessionActive() {
    return gCastReady && window.cast && cast.framework &&
      !!cast.framework.CastContext.getInstance().getCurrentSession();
  }

  function inferContentType(url) {
    if (/\.m3u8($|\?)/i.test(url)) return 'application/x-mpegurl';
    if (/\.webm($|\?)/i.test(url)) return 'video/webm';
    return 'video/mp4';
  }

  function loadCastMedia() {
    if (!window.chrome || !chrome.cast || !cast.framework) return;
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session) return;

    const url = castSourceUrl();
    if (!url) return;
    const contentType = nowPlaying.contentType || inferContentType(url);

    const mediaInfo = new chrome.cast.media.MediaInfo(url, contentType);
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = nowPlaying.title || 'StreamVerse';
    if (nowPlaying.subtitle) mediaInfo.metadata.subtitle = nowPlaying.subtitle;
    if (nowPlaying.poster) mediaInfo.metadata.images = [{ url: nowPlaying.poster }];
    if (contentType === 'application/x-mpegurl') {
      mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
    }

    let activeTrackIds = [];
    if (nowPlaying.subs && nowPlaying.subs.src) {
      const track = new chrome.cast.media.Track(1, chrome.cast.media.TrackType.TEXT);
      track.trackContentId = nowPlaying.subs.src;
      track.trackContentType = 'text/vtt';
      track.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
      track.name = nowPlaying.subs.label || 'Subtitles';
      track.language = nowPlaying.subs.lang || 'en';
      mediaInfo.tracks = [track];
      activeTrackIds = [1];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = video.currentTime || 0;
    request.autoplay = !video.paused;
    if (activeTrackIds.length) request.activeTrackIds = activeTrackIds;

    session.loadMedia(request).then(
      () => setStatus(`Casting "${nowPlaying.title}" to TV`, true),
      (err) => { console.error('Cast loadMedia failed:', err); setStatus('Cast failed'); }
    );
  }

  window['__onGCastApiAvailable'] = function (isAvailable) {
    if (!isAvailable || !window.chrome || !chrome.cast) return;
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    gCastReady = true;

    context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      switch (e.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
        case cast.framework.SessionState.SESSION_RESUMED:
          loadCastMedia();
          if (castBtn) castBtn.classList.add('active');
          if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
          break;
        case cast.framework.SessionState.SESSION_ENDED:
          if (castBtn) castBtn.classList.remove('active');
          if (!peerConnection && !presentationConnection && disconnectBtn) {
            disconnectBtn.style.display = 'none';
          }
          setStatus('Not connected');
          break;
      }
    });
  };

  if ('remote' in video) {
    video.remote.watchAvailability((available) => {
      if (castBtn && !gCastReady) castBtn.disabled = !available;
    }).catch(() => { if (castBtn) castBtn.disabled = false; });

    video.remote.addEventListener('connect', () => setStatus('Connected to TV', true));
    video.remote.addEventListener('connecting', () => setStatus('Connecting…'));
    video.remote.addEventListener('disconnect', () => { if (!isCastSessionActive()) setStatus('Not connected'); });
  } else if (castBtn && !('chrome' in window)) {
    castBtn.title = 'Casting works best in Chrome, Edge, or Safari';
  }

  if (castBtn) {
    castBtn.addEventListener('click', async () => {
      if (!(await requireCastPlan('cast'))) return;
      // Prefer the full Google Cast SDK — it casts the real source URL
      // (works for HLS + progressive alike) with proper title/poster/
      // subtitle metadata on the TV, instead of just mirroring this tab's
      // local <video> element.
      if (gCastReady && window.cast && cast.framework) {
        try {
          if (isCastSessionActive()) {
            loadCastMedia();
          } else {
            await cast.framework.CastContext.getInstance().requestSession();
          }
        } catch (err) {
          if (err !== 'cancel') { console.error('Cast session request failed:', err); setStatus('Cast failed'); }
        }
        return;
      }
      // Fallback: Remote Playback API (AirPlay on Safari, native picker elsewhere)
      if ('remote' in video) {
        try {
          await video.remote.prompt();
          setStatus('Casting…', true);
        } catch (err) {
          if (err.name !== 'AbortError') { console.error('Cast failed:', err); setStatus('Cast failed'); }
        }
      }
    });
  }

  // ============================================================
  // PART 2: SECOND SCREEN / CONNECT TO PC (Presentation API + WebRTC fallback)
  // ============================================================
  const receiverUrl = new URL('receiver.html', window.location.href);
  let presentationConnection = null;
  let peer = null;
  let peerConnection = null;
  let activeBtn = null;
  let lastPairUrl = '';
  let lastPairCode = null;
  let lastPairMode = null;
  let hiddenSince = null;
  let isBackgrounded = false;
  let awaitingSync = false;

  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };

  function generatePairingCode() {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  async function checkConnectionRoute(pc, attempt = 0) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report;
      });
      if (!pair) {
        if (attempt < 5) setTimeout(() => checkConnectionRoute(pc, attempt + 1), 500);
        return;
      }
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const isRelay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      const label = activeBtn === connectPcBtn ? 'PC' : 'Second screen';
      setStatus(isRelay ? `${label} connected (relayed)` : `${label} connected — direct Wi-Fi`, true);
    } catch (err) { /* getStats unavailable — not critical */ }
  }

  function sendToReceiver(payload) {
    const json = JSON.stringify(payload);
    if (peerConnection) peerConnection.send(json);
    else if (presentationConnection) presentationConnection.send(json);
  }

  function requestSyncFromReceiver() {
    if (!peerConnection && !presentationConnection) return;
    awaitingSync = true;
    sendToReceiver({ action: 'sync-request' });
    setTimeout(() => { awaitingSync = false; }, 4000);
  }

  function handleIncomingData(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.ping) return;

    if (msg.action === 'sync-response') {
      awaitingSync = false;
      const drift = Math.abs(video.currentTime - msg.currentTime);
      if (drift > 0.35) video.currentTime = msg.currentTime;
      if (msg.paused && !video.paused) video.pause();
      if (!msg.paused && video.paused) video.play().catch(() => {});
      if (typeof msg.rate === 'number' && msg.rate !== video.playbackRate) video.playbackRate = msg.rate;
      setStatus(activeBtn === connectPcBtn ? 'PC connected' : 'Second screen connected', true);
      return;
    }

    if (msg.action === 'remote-command') {
      if (msg.type === 'play') video.play().catch(() => {});
      else if (msg.type === 'pause') video.pause();
      else if (msg.type === 'seek' && typeof msg.currentTime === 'number') video.currentTime = msg.currentTime;
      else if (msg.type === 'rate' && typeof msg.rate === 'number') video.playbackRate = msg.rate;
    }
  }

  // The full current state — src/title/poster/subs always come from
  // `nowPlaying`, never from video.currentSrc, so HLS (blob: currentSrc)
  // titles still pair and sync correctly.
  function sendState() {
    sendToReceiver({
      action: video.paused ? 'pause' : 'play',
      currentTime: video.currentTime,
      src: castSourceUrl(),
      rate: video.playbackRate,
      title: nowPlaying.title,
      subs: nowPlaying.subs
    });
  }

  function closeJoinPanel() {
    if (joinPanel) joinPanel.classList.remove('show');
    if (joinToggle) joinToggle.classList.remove('open');
  }

  function wireConnection(connection, kind) {
    presentationConnection = kind === 'presentation' ? connection : presentationConnection;
    peerConnection = kind === 'peer' ? connection : peerConnection;

    if (activeBtn) activeBtn.classList.add('active');
    setStatus(activeBtn === connectPcBtn ? 'PC connected' : 'Second screen connected', true);
    if (qrPanel) qrPanel.classList.remove('show');
    closeJoinPanel();
    if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';

    if (kind === 'peer' && connection.peerConnection) checkConnectionRoute(connection.peerConnection);

    let pauseDebounce = null;
    const onPauseEvent = () => {
      if (isBackgrounded) return;
      clearTimeout(pauseDebounce);
      pauseDebounce = setTimeout(() => { if (video.paused && !isBackgrounded) sendState(); }, 400);
    };
    const onPlayEvent = () => { clearTimeout(pauseDebounce); if (!isBackgrounded) sendState(); };
    const onSeekedEvent = () => { if (!isBackgrounded) sendState(); };
    const onRateChangeEvent = () => { if (!isBackgrounded) sendState(); };
    const onClose = () => {
      presentationConnection = null;
      peerConnection = null;
      if (activeBtn) activeBtn.classList.remove('active');
      activeBtn = null;
      if (!isCastSessionActive()) setStatus('Not connected');
      if (disconnectBtn) disconnectBtn.style.display = isCastSessionActive() ? 'inline-flex' : 'none';
      clearTimeout(pauseDebounce);
      video.removeEventListener('play', onPlayEvent);
      video.removeEventListener('pause', onPauseEvent);
      video.removeEventListener('seeked', onSeekedEvent);
      video.removeEventListener('ratechange', onRateChangeEvent);
    };

    if (kind === 'presentation') {
      connection.addEventListener('close', onClose);
      connection.addEventListener('message', (e) => handleIncomingData(e.data));
    } else {
      connection.on('close', onClose);
      connection.on('error', onClose);
    }

    sendState();
    video.addEventListener('play', onPlayEvent);
    video.addEventListener('pause', onPauseEvent);
    video.addEventListener('seeked', onSeekedEvent);
    video.addEventListener('ratechange', onRateChangeEvent);
  }

  function startPeerPairing(mode = 'second-screen') {
    if (typeof Peer === 'undefined') {
      renderPlainLinkFallback();
      return;
    }

    const code = generatePairingCode();
    peer = new Peer(`svcast-${code}`, { config: RTC_CONFIG, debug: 1 });

    peer.on('open', () => {
      lastPairCode = code;
      lastPairMode = mode;

      const pairUrl = new URL(receiverUrl);
      pairUrl.searchParams.set('pair', code);
      pairUrl.searchParams.set('src', castSourceUrl());
      pairUrl.searchParams.set('title', nowPlaying.title || '');
      pairUrl.searchParams.set('target', mode === 'pc' ? 'pc' : 'screen');
      lastPairUrl = pairUrl.toString();

      if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(lastPairUrl)}`;

      if (mode === 'pc') {
        if (qrPanelIntro) qrPanelIntro.textContent = 'Open this link in a browser on a PC connected to the same Wi-Fi:';
        if (qrPanelLabel) qrPanelLabel.textContent = 'PC connect link';
        if (qrPanelFooter) qrPanelFooter.textContent = 'As soon as the PC opens the link it finds this player over the local network and pairs automatically.';
      } else {
        if (qrPanelIntro) qrPanelIntro.textContent = 'Scan with a TV/tablet on the same Wi-Fi network:';
        if (qrPanelLabel) qrPanelLabel.textContent = 'Second-screen link';
        if (qrPanelFooter) qrPanelFooter.textContent = 'Once it connects, this player becomes the remote and the second device shows the synced view.';
      }

      if (secondScreenUrlEl) secondScreenUrlEl.textContent = `Pairing code: ${code}`;
      if (qrPanel) qrPanel.classList.add('show');
      closeJoinPanel();
      setStatus(`Waiting for device (code ${code})…`);
      if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => wireConnection(conn, 'peer'));
      conn.on('data', handleIncomingData);
    });

    peer.on('disconnected', () => { setStatus('Reconnecting…'); peer.reconnect(); });
    peer.on('error', (err) => { console.error('Peer pairing error:', err); setStatus('Pairing failed — try again'); });
  }

  function renderPlainLinkFallback() {
    const url = receiverUrl.toString();
    lastPairUrl = url;
    if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}`;
    if (secondScreenUrlEl) secondScreenUrlEl.textContent = url;
    if (qrPanel) qrPanel.classList.add('show');
  }

  function stopActiveConnection() {
    if (presentationConnection) presentationConnection.terminate();
    if (peerConnection) peerConnection.close();
    if (peer) { peer.destroy(); peer = null; }
    presentationConnection = null;
    peerConnection = null;
    lastPairCode = null;
    lastPairMode = null;
    if (activeBtn) activeBtn.classList.remove('active');
    activeBtn = null;
    if (isCastSessionActive() && window.cast) {
      cast.framework.CastContext.getInstance().endCurrentSession(true);
    }
    if (!isCastSessionActive()) setStatus('Not connected');
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (qrPanel) qrPanel.classList.remove('show');
  }

  if (disconnectBtn) disconnectBtn.addEventListener('click', stopActiveConnection);

  if (secondScreenBtn) {
    secondScreenBtn.addEventListener('click', async () => {
      if (presentationConnection || peerConnection) { stopActiveConnection(); return; }
      if (!(await requireCastPlan('second-screen'))) return;
      activeBtn = secondScreenBtn;

      if ('PresentationRequest' in window) {
        try {
          const presentationRequest = new PresentationRequest([receiverUrl.toString()]);
          const connection = await presentationRequest.start();
          wireConnection(connection, 'presentation');
          return;
        } catch (err) {
          console.warn('No Presentation target, using WebRTC pairing instead:', err);
        }
      }
      startPeerPairing('second-screen');
    });
  }

  if (connectPcBtn) {
    connectPcBtn.addEventListener('click', async () => {
      if (presentationConnection || peerConnection) { stopActiveConnection(); return; }
      if (!(await requireCastPlan('connect-pc'))) return;
      activeBtn = connectPcBtn;
      startPeerPairing('pc');
    });
  }

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      if (!lastPairUrl) return;
      try {
        await navigator.clipboard.writeText(lastPairUrl);
        const original = copyLinkBtn.textContent;
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => { copyLinkBtn.textContent = original; }, 1500);
      } catch (err) {
        window.prompt('Copy this link:', lastPairUrl);
      }
    });
  }

  function setJoinStatus(text, kind) {
    if (!joinStatus) return;
    joinStatus.textContent = text;
    joinStatus.className = 'cast-join-status' + (kind ? ' ' + kind : '');
  }

  async function joinByCode(rawCode) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) { setJoinStatus('Enter a code first.', 'err'); return; }
    if (!(await requireCastPlan('second-screen'))) { setJoinStatus('Standard/Premium plan required.', 'err'); return; }
    if (peerConnection || presentationConnection) stopActiveConnection();
    if (typeof Peer === 'undefined') { setJoinStatus('WebRTC pairing unavailable in this browser.', 'err'); return; }

    activeBtn = null;
    setJoinStatus(`Connecting to ${code}…`);
    if (joinCodeBtn) joinCodeBtn.disabled = true;

    peer = new Peer({ config: RTC_CONFIG, debug: 1 });

    peer.on('open', () => {
      const conn = peer.connect(`svcast-${code}`, { reliable: true });
      const failTimer = setTimeout(() => {
        setJoinStatus(`Could not reach code ${code} — check it and try again.`, 'err');
        if (joinCodeBtn) joinCodeBtn.disabled = false;
      }, 8000);

      conn.on('open', () => {
        clearTimeout(failTimer);
        lastPairCode = code;
        lastPairMode = 'second-screen';
        wireConnection(conn, 'peer');
        requestSyncFromReceiver();
        setJoinStatus(`Connected to ${code}.`, 'ok');
        if (joinCodeBtn) joinCodeBtn.disabled = false;
      });
      conn.on('data', handleIncomingData);
      conn.on('error', (err) => {
        clearTimeout(failTimer);
        console.error('Join by code failed:', err);
        setJoinStatus(`Could not connect to ${code}.`, 'err');
        if (joinCodeBtn) joinCodeBtn.disabled = false;
      });
    });

    peer.on('error', (err) => {
      console.error('Join by code peer error:', err);
      setJoinStatus(`Could not connect to ${code}.`, 'err');
      if (joinCodeBtn) joinCodeBtn.disabled = false;
    });
  }

  if (joinCodeBtn) joinCodeBtn.addEventListener('click', () => joinByCode(joinCodeInput.value));
  if (joinCodeInput) {
    joinCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(joinCodeInput.value); });
    joinCodeInput.addEventListener('input', () => { joinCodeInput.value = joinCodeInput.value.toUpperCase(); });
  }
  if (joinToggle && joinPanel) {
    joinToggle.addEventListener('click', () => {
      const isOpen = joinPanel.classList.toggle('show');
      joinToggle.classList.toggle('open', isOpen);
      if (isOpen && joinCodeInput) joinCodeInput.focus();
    });
  }

  // ============================================================
  // PART 2.5: BACKGROUND PLAYBACK
  // ============================================================
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.title || 'StreamVerse',
        artist: 'StreamVerse',
        artwork: nowPlaying.poster ? [{ src: nowPlaying.poster, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      navigator.mediaSession.setActionHandler('play', () => video.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') video.currentTime = details.seekTime;
      });
    } catch (err) { console.warn('Media Session setup failed:', err); }
  }

  function updateMediaSessionState() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
  }
  video.addEventListener('play', updateMediaSessionState);
  video.addEventListener('pause', updateMediaSessionState);
  setupMediaSession();

  function rejoinPairing() {
    if (!lastPairCode || (peer && !peer.destroyed)) return;
    activeBtn = lastPairMode === 'pc' ? connectPcBtn : secondScreenBtn;
    setStatus('Reconnecting…');
    peer = new Peer(`svcast-${lastPairCode}`, { config: RTC_CONFIG, debug: 1 });

    peer.on('connection', (conn) => {
      conn.on('open', () => { wireConnection(conn, 'peer'); requestSyncFromReceiver(); });
      conn.on('data', handleIncomingData);
    });
    peer.on('error', (err) => console.warn('Rejoin attempt failed:', err));
  }

  let wasPlayingBeforeInterruption = false;
  video.addEventListener('playing', () => { wasPlayingBeforeInterruption = true; });
  video.addEventListener('pause', () => { wasPlayingBeforeInterruption = false; });

  video.addEventListener('error', () => {
    if (!wasPlayingBeforeInterruption || document.hidden) return;
    const resumeAt = video.currentTime;
    const src = video.currentSrc;
    console.warn('Playback error, attempting recovery (likely an audio-session interruption)');
    setTimeout(() => {
      video.src = src;
      video.load();
      video.addEventListener('loadedmetadata', function onLoaded() {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.currentTime = resumeAt;
        video.play().catch(() => {});
      });
    }, 500);
  });

  video.addEventListener('stalled', () => {
    if (document.hidden || video.paused || !wasPlayingBeforeInterruption) return;
    video.play().catch(() => {});
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenSince = Date.now();
      isBackgrounded = true;
      if (peerConnection || presentationConnection) {
        try { sendToReceiver({ action: 'sender-background' }); } catch (e) {}
      }
      return;
    }
    isBackgrounded = false;
    if (hiddenSince === null) return;
    hiddenSince = null;

    if (peerConnection || presentationConnection) requestSyncFromReceiver();
    else if (lastPairCode) rejoinPairing();
  });
})();
