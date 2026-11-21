// YouTube Shorts Auto Scroller - Content Script v2.1
// Fixes: reliable navigation + in-page floating UI + loop-aware end detection

(function () {
  'use strict';

  let scheduleTimer       = null;
  let isScrolling         = false;
  let currentVideo        = null;
  let domObserver         = null;
  let uiInjected          = false;
  let endDetectionCleanup = null; // tears down timeupdate listeners

  let settings = {
    enabled:     false,
    interval:    15,
    skipAds:     true,
    scrollOnEnd: true
  };

  // ── Navigation: multi-method with fallbacks ───────────────────────────────

  let lastSkipTime = 0;

  function goToNext() {
    // Debounce to prevent skip-storm: minimum 1.2s between automatic skips
    const now = Date.now();
    if (now - lastSkipTime < 1200) return;
    lastSkipTime = now;

    clearSchedule();

    // Method 1 — click YouTube's native down chevron / next video button
    const nextBtnSelectors = [
      '#navigation-button-down button',
      'ytd-button-renderer[id="navigation-button-down"] button',
      '#navigation-button-down',
      '[aria-label="Next video"]',
      'ytd-shorts [aria-label="Next video"]',
      'ytd-reel-player-overlay-renderer #navigation-button-down button',
      'ytd-reel-player-overlay-renderer button[aria-label="Next video"]',
      'button.ytd-shorts[aria-label*="Next"]',
      '#shorts-player-overlay #navigation-button-down'
    ];
    for (const sel of nextBtnSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return;
      }
    }

    // Method 2 — scroll into view the next reel item
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (active && active.nextElementSibling) {
      active.nextElementSibling.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Method 3 — scroll the Shorts viewport container
    const containers = [
      document.querySelector('#shorts-container'),
      document.querySelector('ytd-shorts #shorts-container'),
      document.querySelector('#shorts-inner-container'),
      document.querySelector('ytd-page-manager ytd-shorts'),
      window
    ];
    for (const c of containers) {
      if (c && c !== window) {
        c.scrollBy({ top: c.clientHeight || window.innerHeight, behavior: 'smooth' });
        return;
      }
    }

    // Method 4 — keyboard ArrowDown / PageDown events
    const target = document.activeElement || document.querySelector('ytd-shorts') || document.body;
    ['keydown', 'keyup'].forEach(type => {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: 'ArrowDown', code: 'ArrowDown',
        keyCode: 40, which: 40,
        bubbles: true, cancelable: true
      }));
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function isOnShorts() {
    return window.location.pathname.startsWith('/shorts/');
  }

  function getCurrentVideo() {
    // Find active reel's video first
    const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (activeReel) {
      const vid = activeReel.querySelector('video');
      if (vid) return vid;
    }

    // Otherwise find the playing/highest progress video
    const videos = Array.from(document.querySelectorAll('video'));
    for (const vid of videos) {
      if (!vid.paused && vid.currentTime > 0) return vid;
    }
    return videos[0] || null;
  }

  function isSponsoredOrAd() {
    // Only check the currently active reel renderer
    const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (!activeReel) return false;

    // Check specific sponsored elements within the active reel only
    const adBadge = activeReel.querySelector(
      '.badge-shape-wiz--ad, yt-ad-badge, ytd-ad-slot-renderer, [aria-label="Sponsored"]'
    );
    if (adBadge && adBadge.offsetParent !== null) {
      return true;
    }

    // Check for "Sponsored" label strictly in the channel/metadata bar of active reel
    const metadata = activeReel.querySelector('.ytd-reel-player-header-renderer, .metadata-container, #channel-container');
    if (metadata && /\bSponsored\b/i.test(metadata.textContent || '')) {
      return true;
    }

    return false;
  }

  // ── End detection (loop-aware) ────────────────────────────────────────────

  const NEAR_END_SEC = 0.1; // trigger only in the final fraction of a second so the full video plays

  function attachEndDetection(video) {
    detachEndDetection(); // always clean up first

    let triggered = false;
    let prevTime = video.currentTime;
    let hasPlayedEnough = false; // require at least 1s of playback before considering an end

    function checkEnd() {
      // Must have valid duration
      if (!video.duration || !isFinite(video.duration) || video.duration < 1.5) return;

      // Track that the video actually started playing
      if (video.currentTime > 0.8) {
        hasPlayedEnough = true;
      }

      const remaining = video.duration - video.currentTime;

      // 1. Time within final 0.1s of end (video has basically finished all frames)
      if (hasPlayedEnough && remaining > 0 && remaining <= NEAR_END_SEC && !triggered) {
        triggered = true;
        onNearEnd();
        return;
      }

      // 2. Loop detection: if YouTube loops before reaching <= 0.1s, catch the exact wrap-around
      if (hasPlayedEnough && prevTime > video.duration - 0.6 && video.currentTime < 0.3 && !triggered) {
        triggered = true;
        onNearEnd();
        return;
      }

      prevTime = video.currentTime;

      // Reset trigger if user manually rewinds
      if (remaining > 2) triggered = false;
    }

    // Check on timeupdate
    video.addEventListener('timeupdate', checkEnd);

    // Fast 50ms interval check to catch the exact final moments before a loop occurs
    const pollId = setInterval(checkEnd, 50);

    // Native ended event fallback
    function onEnded() {
      if (hasPlayedEnough && !triggered) {
        triggered = true;
        onNearEnd();
      }
    }
    video.addEventListener('ended', onEnded);

    endDetectionCleanup = () => {
      video.removeEventListener('timeupdate', checkEnd);
      video.removeEventListener('ended', onEnded);
      clearInterval(pollId);
      endDetectionCleanup = null;
    };
  }

  function detachEndDetection() {
    if (endDetectionCleanup) endDetectionCleanup();
  }

  function onNearEnd() {
    if (!settings.enabled) return;
    clearSchedule();
    detachEndDetection();
    // interval=0 → instant (no delay); otherwise tiny pause for YT's transition
    const delay = settings.interval === 0 ? 0 : 300;
    if (delay === 0) goToNext();
    else scheduleTimer = setTimeout(goToNext, delay);
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  function clearSchedule() {
    if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null; }
  }

  function scheduleNext() {
    clearSchedule();
    detachEndDetection();
    if (!settings.enabled || !isOnShorts()) return;

    // Check if current Short is sponsored / an ad: if skipAds is on, skip immediately!
    if (settings.skipAds && isSponsoredOrAd()) {
      scheduleTimer = setTimeout(goToNext, 300);
      return;
    }

    currentVideo = getCurrentVideo();

    if (settings.scrollOnEnd && currentVideo) {
      // Primary trigger: near-end detection (works even on looping videos)
      attachEndDetection(currentVideo);

      // interval=0 → pure "skip the moment it ends", no cap timer needed
      if (settings.interval === 0) return;

      // Cap timer: force-skip after N seconds even if end-detection never fires
      // (e.g. very long video, stalled playback, or no duration metadata yet)
      let capMs = settings.interval * 1000;
      if (currentVideo.duration && isFinite(currentVideo.duration)) {
        const remaining = Math.max(0, (currentVideo.duration - currentVideo.currentTime) * 1000);
        capMs = Math.max(remaining + 1000, settings.interval * 1000);
      }
      scheduleTimer = setTimeout(() => {
        detachEndDetection();
        goToNext();
      }, capMs);

    } else {
      // scrollOnEnd OFF — fixed interval regardless of video progress
      if (settings.interval === 0) {
        goToNext();
      } else {
        scheduleTimer = setTimeout(goToNext, settings.interval * 1000);
      }
    }
  }

  // ── Auto-scroll start / stop ──────────────────────────────────────────────

  function stopAutoScroll() {
    clearSchedule();
    detachEndDetection();
    isScrolling = false;
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
    currentVideo = null;
    updateUI();
  }

  function startAutoScroll() {
    stopAutoScroll();
    if (!isOnShorts()) return;
    isScrolling = true;

    domObserver = new MutationObserver(() => {
      // If an ad or sponsored badge dynamically loads into the active reel, skip it
      if (settings.skipAds && isSponsoredOrAd()) {
        scheduleNext();
        return;
      }
      const v = getCurrentVideo();
      if (v && v !== currentVideo) scheduleNext();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    scheduleNext();
    updateUI();
  }

  // ── In-page floating UI (full settings panel) ────────────────────────────

  const UI_ID    = 'yas-panel';
  const STYLE_ID = 'yas-styles';
  let   panelCollapsed = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ── Panel shell ───────────────────────────────────────────────────── */
      #yas-panel {
        position: fixed;
        left: 20px;
        top: 80px;
        z-index: 2147483647;
        width: 220px;
        max-width: 90vw;
        box-sizing: border-box;
        background: rgba(12, 12, 12, 0.94);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 12px 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: 'Segoe UI', system-ui, sans-serif;
        color: #e0e0e0;
        font-size: 11px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.75);
        user-select: none;
        cursor: grab;
        position: fixed;
        overflow: hidden;
        transition: opacity 0.3s ease;
      }

      /* ── Faded / idle state ─────────────────────────────────────────────── */
      #yas-panel.yas-faded {
        opacity: 0.25;
      }

      /* ── Dragging state ─────────────────────────────────────────────────── */
      #yas-panel.yas-dragging {
        transition: none !important;
        cursor: grabbing !important;
        box-shadow: 0 12px 40px rgba(0,0,0,0.85);
      }
      #yas-panel.yas-dragging * {
        cursor: grabbing !important;
      }

      /* ── Collapsed: sleek single compact floating button (34px) ───────── */
      #yas-panel.yas-collapsed {
        width: 34px !important;
        min-width: 34px !important;
        max-width: 34px !important;
        height: 34px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        gap: 0 !important;
        align-items: center;
        justify-content: center;
        background: rgba(14, 14, 14, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
        overflow: visible !important;
      }

      /* Hide panel body and extra header items */
      #yas-panel.yas-collapsed .yas-body,
      #yas-panel.yas-collapsed .yas-header-title,
      #yas-panel.yas-collapsed .yas-status-dot { display: none !important; }

      #yas-panel.yas-collapsed .yas-header {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #yas-panel.yas-collapsed .yas-header-left {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
      }

      #yas-panel.yas-collapsed .yas-ring-wrap {
        width: 34px !important;
        height: 34px !important;
      }
      #yas-panel.yas-collapsed .yas-main-toggle {
        width: 34px !important;
        height: 34px !important;
        background: transparent;
      }
      #yas-panel.yas-collapsed .yas-main-toggle.on {
        background: rgba(220, 0, 0, 0.85);
      }
      #yas-panel.yas-collapsed .yas-main-toggle svg {
        width: 13px !important;
        height: 13px !important;
      }

      /* Tiny expand badge docked at the top-right of the circle */
      #yas-panel.yas-collapsed .yas-collapse-btn {
        position: absolute !important;
        top: -4px !important;
        right: -6px !important;
        width: 18px !important;
        height: 18px !important;
        padding: 0 !important;
        margin: 0 !important;
        background: #242424 !important;
        border: 1px solid rgba(255, 255, 255, 0.25) !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: #ddd !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.6) !important;
        cursor: pointer;
        z-index: 10;
      }
      #yas-panel.yas-collapsed .yas-collapse-btn:hover {
        background: #383838 !important;
        color: #fff !important;
      }
      #yas-panel.yas-collapsed .yas-collapse-btn svg {
        transform: rotate(180deg);
        width: 9px !important;
        height: 9px !important;
      }

      /* ── Header ────────────────────────────────────────────────────────── */
      #yas-panel .yas-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      #yas-panel .yas-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      #yas-panel .yas-header-title {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #yas-panel .yas-status-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #444;
        flex-shrink: 0;
        transition: background 0.2s;
      }
      #yas-panel .yas-status-dot.on { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }

      /* collapse / expand button — base style (expanded state) */
      #yas-panel .yas-collapse-btn {
        background: none; border: none; cursor: pointer; padding: 2px;
        display: flex; align-items: center; color: #777;
        transition: color 0.15s;
        flex-shrink: 0;
        position: static;
      }
      #yas-panel .yas-collapse-btn:hover { color: #fff; }
      #yas-panel .yas-collapse-btn svg {
        width: 13px; height: 13px;
      }

      /* ── Ring + main toggle (always visible) ────────────────────────────── */
      #yas-panel .yas-ring-wrap {
        position: relative;
        width: 28px; height: 28px;
        flex-shrink: 0;
      }
      #yas-panel .yas-ring-svg {
        position: absolute; inset: 0;
        transform: rotate(-90deg);
        pointer-events: none;
        width: 100%; height: 100%;
      }
      #yas-panel .yas-ring-bg { fill: none; stroke: rgba(255,255,255,0.1); stroke-width: 2.5; }
      #yas-panel .yas-ring-fg {
        fill: none; stroke: #FF0000; stroke-width: 2.5;
        stroke-linecap: round;
        stroke-dasharray: 101;
        stroke-dashoffset: 101;
      }
      #yas-panel .yas-main-toggle {
        position: absolute; inset: 0;
        border: none; cursor: pointer; border-radius: 50%;
        background: rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s, transform 0.1s;
      }
      #yas-panel .yas-main-toggle:hover  { background: rgba(255,255,255,0.15); }
      #yas-panel .yas-main-toggle:active { transform: scale(0.9); }
      #yas-panel .yas-main-toggle.on     { background: rgba(220,0,0,0.8); }
      #yas-panel .yas-main-toggle svg    { width: 12px; height: 12px; }

      /* ── Body (hidden when collapsed) ───────────────────────────────────── */
      #yas-panel .yas-body {
        display: flex;
        flex-direction: column;
        gap: 7px;
        overflow: hidden;
      }

      /* ── Divider ────────────────────────────────────────────────────────── */
      #yas-panel .yas-hr {
        border: none;
        border-top: 1px solid rgba(255,255,255,0.07);
        margin: 0;
      }

      /* ── Row: label + toggle switch ─────────────────────────────────────── */
      #yas-panel .yas-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      #yas-panel .yas-row-label {
        color: #bbb;
        font-size: 10.5px;
        line-height: 1.2;
      }

      /* toggle switch */
      #yas-panel .yas-switch {
        position: relative;
        width: 28px; height: 16px;
        flex-shrink: 0;
        cursor: pointer;
      }
      #yas-panel .yas-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
      #yas-panel .yas-switch-track {
        position: absolute; inset: 0;
        background: #333;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.2s;
      }
      #yas-panel .yas-switch-track::before {
        content: '';
        position: absolute;
        left: 2px; top: 2px;
        width: 12px; height: 12px;
        background: #fff;
        border-radius: 50%;
        transition: transform 0.2s;
      }
      #yas-panel .yas-switch input:checked + .yas-switch-track { background: #e00; }
      #yas-panel .yas-switch input:checked + .yas-switch-track::before { transform: translateX(12px); }

      /* ── Interval section ───────────────────────────────────────────────── */
      #yas-panel .yas-interval-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10.5px;
        color: #bbb;
      }
      #yas-panel .yas-interval-label strong {
        font-size: 10.5px;
        color: #fff;
      }
      #yas-panel input[type="range"] {
        -webkit-appearance: none;
        width: 100%; height: 3px;
        background: #333; border-radius: 2px;
        outline: none; cursor: pointer;
        margin-top: 3px;
      }
      #yas-panel input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px; height: 12px;
        background: #FF0000;
        border-radius: 50%;
        box-shadow: 0 0 0 2px rgba(255,0,0,0.25);
      }
      #yas-panel .yas-tick-labels {
        display: flex;
        justify-content: space-between;
        font-size: 8.5px;
        color: #555;
        margin-top: 1px;
      }

      /* ── Next button ────────────────────────────────────────────────────── */
      #yas-panel .yas-next-btn {
        width: 100%;
        padding: 5px 0;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.1);
        background: rgba(255,255,255,0.06);
        color: #ddd;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transition: background 0.15s, color 0.15s;
      }
      #yas-panel .yas-next-btn:hover  { background: rgba(255,255,255,0.12); color: #fff; }
      #yas-panel .yas-next-btn:active { transform: scale(0.97); }
      #yas-panel .yas-next-btn svg    { width: 11px; height: 11px; }

      /* collapsed: show a compact icon-only next button */
      #yas-panel.yas-collapsed .yas-next-btn {
        width: 32px; height: 32px; padding: 0;
        border-radius: 50%;
      }
      #yas-panel.yas-collapsed .yas-next-btn .yas-next-label { display: none; }
    `;
    document.head.appendChild(s);
  }

  function createUI() {
    if (document.getElementById(UI_ID)) return;
    injectStyles();

    const panel = document.createElement('div');
    panel.id = UI_ID;
    if (panelCollapsed) panel.classList.add('yas-collapsed');

    // ── HEADER ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'yas-header';

    // Left side: ring-toggle + title
    const headerLeft = document.createElement('div');
    headerLeft.className = 'yas-header-left';

    // Ring + toggle button
    const ringWrap = document.createElement('div');
    ringWrap.className = 'yas-ring-wrap';
    ringWrap.innerHTML = `
      <svg class="yas-ring-svg" viewBox="0 0 36 36">
        <circle class="yas-ring-bg" cx="18" cy="18" r="16"/>
        <circle class="yas-ring-fg" id="yas-ring-fg" cx="18" cy="18" r="16"/>
      </svg>`;
    const mainToggle = document.createElement('button');
    mainToggle.className = 'yas-main-toggle';
    mainToggle.title = 'Toggle Auto Scroll';
    mainToggle.innerHTML = iconPlay();
    mainToggle.addEventListener('click', () => {
      settings.enabled = !settings.enabled;
      if (settings.enabled && isOnShorts()) startAutoScroll();
      else stopAutoScroll();
      chrome.storage.sync.set({ autoScrollSettings: settings });
      syncPanelControls();
    });
    ringWrap.appendChild(mainToggle);
    headerLeft.appendChild(ringWrap);

    // Status dot + title (hidden when collapsed)
    const dot = document.createElement('span');
    dot.className = 'yas-status-dot';
    dot.id = 'yas-dot';
    headerLeft.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'yas-header-title';
    title.textContent = 'AUTO SCROLLER';
    headerLeft.appendChild(title);

    header.appendChild(headerLeft);

    // Collapse button
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'yas-collapse-btn';
    collapseBtn.title = 'Collapse panel';
    collapseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>`;
    function toggleCollapse(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      panelCollapsed = !panelCollapsed;
      panel.classList.toggle('yas-collapsed', panelCollapsed);
      collapseBtn.title = panelCollapsed ? 'Expand panel' : 'Collapse panel';

      // Immediate viewport clamp calculation without lagging frames
      const MARGIN = 12;
      const r = panel.getBoundingClientRect();
      const maxL = window.innerWidth - panel.offsetWidth - MARGIN;
      const maxT = window.innerHeight - panel.offsetHeight - MARGIN;

      if (r.left > maxL || r.top > maxT) {
        const newL = Math.max(MARGIN, Math.min(r.left, maxL));
        const newT = Math.max(MARGIN, Math.min(r.top, maxT));
        panel.style.left = newL + 'px';
        panel.style.top  = newT + 'px';

        try {
          sessionStorage.setItem(POS_KEY, JSON.stringify({ left: newL, top: newT }));
        } catch (_) {}
      }
    }

    // Trigger instantly on pointerdown (0ms latency, doesn't wait for click/mouse release)
    collapseBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      toggleCollapse(e);
    });
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    header.appendChild(collapseBtn);
    panel.appendChild(header);

    // ── BODY (hidden when collapsed) ────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'yas-body';

    // — Auto Scroll toggle row —
    body.appendChild(makeHr());
    body.appendChild(makeToggleRow(
      'Auto Scroll', 'yas-sw-enabled',
      settings.enabled,
      (checked) => {
        settings.enabled = checked;
        if (settings.enabled && isOnShorts()) startAutoScroll();
        else stopAutoScroll();
        save();
        syncPanelControls();
      }
    ));

    // — Interval slider —
    body.appendChild(makeHr());

    const intervalLabelRow = document.createElement('div');
    intervalLabelRow.className = 'yas-interval-label';
    const intervalLabelText = document.createElement('span');
    intervalLabelText.textContent = 'Interval';
    const intervalVal = document.createElement('strong');
    intervalVal.id = 'yas-interval-val';
    intervalVal.textContent = fmtInterval(settings.interval);
    intervalLabelRow.appendChild(intervalLabelText);
    intervalLabelRow.appendChild(intervalVal);
    body.appendChild(intervalLabelRow);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id   = 'yas-slider';
    slider.min  = '0'; slider.max = '60'; slider.step = '1';
    slider.value = String(settings.interval);
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      intervalVal.textContent = fmtInterval(v);
      settings.interval = v;
    });
    slider.addEventListener('change', () => { save(); });
    body.appendChild(slider);

    const ticks = document.createElement('div');
    ticks.className = 'yas-tick-labels';
    ticks.innerHTML = '<span>Instant</span><span>30s</span><span>60s</span>';
    body.appendChild(ticks);

    // — Skip Ads toggle row —
    body.appendChild(makeHr());
    body.appendChild(makeToggleRow(
      'Skip during ads', 'yas-sw-ads',
      settings.skipAds,
      (checked) => { settings.skipAds = checked; save(); }
    ));

    // — Scroll on End toggle row —
    body.appendChild(makeToggleRow(
      'Scroll when video ends', 'yas-sw-end',
      settings.scrollOnEnd,
      (checked) => { settings.scrollOnEnd = checked; save(); }
    ));

    // — Next button —
    body.appendChild(makeHr());
    const nextBtn = document.createElement('button');
    nextBtn.className = 'yas-next-btn';
    nextBtn.innerHTML = `${iconNextSm()}<span class="yas-next-label">Next Short</span>`;
    nextBtn.title = 'Skip to next Short';
    nextBtn.addEventListener('click', () => goToNext());
    body.appendChild(nextBtn);

    panel.appendChild(body);
    document.body.appendChild(panel);
    makeDraggable(panel);
    setupFade(panel);
    uiInjected = true;
    syncPanelControls();
    startRingAnimation();
  }

  // ── Helpers for building UI elements ─────────────────────────────────────

  function makeHr() {
    const hr = document.createElement('hr');
    hr.className = 'yas-hr';
    return hr;
  }

  function makeToggleRow(label, switchId, initialValue, onChange) {
    const row = document.createElement('div');
    row.className = 'yas-row';

    const lbl = document.createElement('span');
    lbl.className = 'yas-row-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const sw = document.createElement('label');
    sw.className = 'yas-switch';
    const inp = document.createElement('input');
    inp.type = 'checkbox'; inp.id = switchId;
    inp.checked = initialValue;
    inp.addEventListener('change', () => onChange(inp.checked));
    const track = document.createElement('span');
    track.className = 'yas-switch-track';
    sw.appendChild(inp);
    sw.appendChild(track);
    row.appendChild(sw);

    return row;
  }

  function fmtInterval(v) {
    return v === 0 ? '⚡ Instant' : `${v}s`;
  }

  function save() {
    chrome.storage.sync.set({ autoScrollSettings: settings });
  }

  // Keep panel controls in sync when settings change externally (popup)
  function syncPanelControls() {
    const dot     = document.getElementById('yas-dot');
    const toggle  = document.querySelector('#yas-panel .yas-main-toggle');
    const swEn    = document.getElementById('yas-sw-enabled');
    const swAds   = document.getElementById('yas-sw-ads');
    const swEnd   = document.getElementById('yas-sw-end');
    const slider  = document.getElementById('yas-slider');
    const intVal  = document.getElementById('yas-interval-val');

    if (dot)    { dot.classList.toggle('on', settings.enabled); }
    if (toggle) {
      toggle.innerHTML = settings.enabled ? iconPause() : iconPlay();
      toggle.classList.toggle('on', settings.enabled);
    }
    if (swEn)   swEn.checked  = settings.enabled;
    if (swAds)  swAds.checked = settings.skipAds;
    if (swEnd)  swEnd.checked = settings.scrollOnEnd;
    if (slider) slider.value  = String(settings.interval);
    if (intVal) intVal.textContent = fmtInterval(settings.interval);
  }

  // ── Fade on idle ──────────────────────────────────────────────────────────
  //
  //  • After FADE_DELAY ms of no interaction the panel fades to 10% opacity
  //    and becomes pointer-events:none so it doesn't block YouTube's UI.
  //  • Moving the cursor within WAKE_PX pixels of the panel restores it.
  //

  const FADE_DELAY = 4000; // ms of inactivity before fading

  function setupFade(panel) {
    let fadeTimer = null;

    function scheduleFade() {
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        panel.classList.add('yas-faded');
      }, FADE_DELAY);
    }

    function wake() {
      panel.classList.remove('yas-faded');
      scheduleFade();
    }

    // Wake instantly when pointer enters or interacts
    panel.addEventListener('pointerenter', wake);
    panel.addEventListener('pointerdown', wake);
    panel.addEventListener('pointerleave', scheduleFade);

    scheduleFade();
  }

  // ── Draggable ─────────────────────────────────────────────────────────────
  //
  //  Drag by the header bar. Clamps to viewport edges.
  //  Saves position to sessionStorage so it survives SPA navigation
  //  within the same tab.
  //

  const POS_KEY = 'yas-panel-pos';
  const VIEWPORT_MARGIN = 12;

  function makeDraggable(panel) {
    function clampAndApply(left, top) {
      const maxL = Math.max(VIEWPORT_MARGIN, window.innerWidth  - panel.offsetWidth  - VIEWPORT_MARGIN);
      const maxT = Math.max(VIEWPORT_MARGIN, window.innerHeight - panel.offsetHeight - VIEWPORT_MARGIN);
      const clampL = Math.min(Math.max(VIEWPORT_MARGIN, left), maxL);
      const clampT = Math.min(Math.max(VIEWPORT_MARGIN, top),  maxT);
      panel.style.left = clampL + 'px';
      panel.style.top  = clampT + 'px';
      return { left: clampL, top: clampT };
    }

    // Convert CSS transform-based centering → explicit px so we can move it
    function initPxPosition() {
      if (panel.dataset.draggable) return;
      const r = panel.getBoundingClientRect();
      panel.style.transform = 'none';
      panel.style.right     = 'auto';
      panel.style.bottom    = 'auto';
      panel.dataset.draggable = '1';
      clampAndApply(r.left, r.top);
    }

    // Restore saved position from sessionStorage
    try {
      const saved = JSON.parse(sessionStorage.getItem(POS_KEY));
      if (saved) {
        initPxPosition();
        clampAndApply(saved.left, saved.top);
      }
    } catch (_) {}

    // Also re-clamp on window resize so resizing browser never hides the panel
    window.addEventListener('resize', () => {
      const r = panel.getBoundingClientRect();
      clampAndApply(r.left, r.top);
    });

    let dragging = false;
    let dragThresholdPassed = false;
    let ox = 0, oy = 0, startL = 0, startT = 0;

    // Attach mousedown to the entire panel so the WHOLE window is draggable
    panel.addEventListener('mousedown', (e) => {
      const isCollapsed = panel.classList.contains('yas-collapsed');

      // Never initiate drag from interactive controls
      if (e.target.closest('input, .yas-switch, .yas-collapse-btn, .yas-next-btn')) return;

      // In collapsed mode, allow toggle button click without drag delay
      if (isCollapsed && e.target.closest('.yas-main-toggle')) {
        // We will only drag if user moves noticeably
      } else if (!isCollapsed && e.target.closest('.yas-main-toggle')) {
        return;
      }

      initPxPosition();
      dragging = true;
      dragThresholdPassed = false;
      ox = e.clientX;
      oy = e.clientY;
      startL = parseInt(panel.style.left, 10);
      startT = parseInt(panel.style.top,  10);
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;

      // Threshold: 6px movement before considering it a drag gesture
      if (!dragThresholdPassed && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        dragThresholdPassed = true;
        panel.classList.add('yas-dragging');
      }

      if (dragThresholdPassed) {
        clampAndApply(startL + dx, startT + dy);
      }
    });

    // Suppress click ONLY if user actually moved > 6px (dragged)
    panel.addEventListener('click', (e) => {
      if (dragThresholdPassed) {
        e.preventDefault();
        e.stopImmediatePropagation();
        dragThresholdPassed = false;
      }
    }, true);

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('yas-dragging');

      if (dragThresholdPassed) {
        const r = panel.getBoundingClientRect();
        try {
          sessionStorage.setItem(POS_KEY, JSON.stringify({
            left: parseInt(r.left, 10),
            top:  parseInt(r.top,  10)
          }));
        } catch (_) {}
      }
    });
  }

  function removeUI() {
    const el = document.getElementById(UI_ID);
    if (el) el.remove();
    uiInjected = false;
  }

  function updateUI() { syncPanelControls(); }

  // ── Ring countdown animation ──────────────────────────────────────────────

  let ringRAF = null;
  const CIRCUMFERENCE = 2 * Math.PI * 16; // r=16 → ≈ 100.5

  function startRingAnimation() {
    if (ringRAF) cancelAnimationFrame(ringRAF);

    function tick() {
      const ring = document.getElementById('yas-ring-fg');
      if (!ring) { ringRAF = requestAnimationFrame(tick); return; }

      const video = getCurrentVideo();
      if (settings.enabled && video && video.duration && isFinite(video.duration) && video.duration > 0) {
        const progress = video.currentTime / video.duration;
        ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
        ring.style.display = '';
      } else {
        ring.style.display = 'none';
      }

      ringRAF = requestAnimationFrame(tick);
    }

    ringRAF = requestAnimationFrame(tick);
  }

  // ── SVG icons ─────────────────────────────────────────────────────────────

  function iconPlay() {
    return `<svg viewBox="0 0 24 24" fill="white" width="14" height="14">
      <polygon points="6,4 20,12 6,20"/>
    </svg>`;
  }
  function iconPause() {
    return `<svg viewBox="0 0 24 24" fill="white" width="14" height="14">
      <rect x="5"  y="4" width="4" height="16" rx="1"/>
      <rect x="15" y="4" width="4" height="16" rx="1"/>
    </svg>`;
  }
  function iconNextSm() {
    return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
      <polygon points="5,4 15,12 5,20"/>
      <rect x="17" y="4" width="3" height="16" rx="1"/>
    </svg>`;
  }

  // ── Message handler ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'getStatus':
        sendResponse({ isScrolling, settings, onShorts: isOnShorts() });
        break;
      case 'updateSettings':
        Object.assign(settings, msg.settings);
        if (settings.enabled && isOnShorts()) startAutoScroll();
        else stopAutoScroll();
        syncPanelControls();
        sendResponse({ ok: true });
        break;
      case 'toggle':
        settings.enabled = !settings.enabled;
        if (settings.enabled && isOnShorts()) startAutoScroll();
        else stopAutoScroll();
        syncPanelControls();
        sendResponse({ enabled: settings.enabled });
        break;
      case 'next':
        goToNext();
        sendResponse({ ok: true });
        break;
    }
    return true;
  });

  // ── SPA navigation watcher ────────────────────────────────────────────────

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    if (isOnShorts()) {
      setTimeout(() => {
        if (!uiInjected) createUI();
        if (settings.enabled) startAutoScroll();
      }, 600);
    } else {
      stopAutoScroll();
      removeUI();
    }
  }).observe(document, { subtree: true, childList: true });

  // ── Init ──────────────────────────────────────────────────────────────────

  chrome.storage.sync.get(['autoScrollSettings'], (result) => {
    if (result.autoScrollSettings) Object.assign(settings, result.autoScrollSettings);

    // Wait for page to settle before injecting UI
    const tryInject = () => {
      if (isOnShorts() && document.body) {
        createUI();
        if (settings.enabled) startAutoScroll();
      } else {
        setTimeout(tryInject, 500);
      }
    };
    tryInject();
  });

})();
