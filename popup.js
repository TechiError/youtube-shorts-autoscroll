// YouTube Shorts Auto Scroller - Popup Script

const $ = (id) => document.getElementById(id);

const toggleEnabled  = $('toggle-enabled');
const intervalSlider = $('interval-slider');
const intervalDisplay = $('interval-display');
const skipAds        = $('skip-ads');
const scrollOnEnd    = $('scroll-on-end');
const statusBadge    = $('status-badge');
const notOnShorts    = $('not-on-shorts');
const btnNext        = $('btn-next');

let currentSettings = {
  enabled: false,
  interval: 15,
  skipAds: true,
  scrollOnEnd: true
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendToContent(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ ...msg, target: 'content' }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(resp);
      }
    });
  });
}

function updateBadge(enabled) {
  statusBadge.textContent = enabled ? 'ON' : 'OFF';
  statusBadge.className   = `badge badge--${enabled ? 'on' : 'off'}`;
}

function applyUIState(settings, onShorts) {
  toggleEnabled.checked   = settings.enabled;
  intervalSlider.value    = settings.interval;
  intervalDisplay.textContent = formatInterval(settings.interval);
  skipAds.checked         = settings.skipAds;
  scrollOnEnd.checked     = settings.scrollOnEnd;
  updateBadge(settings.enabled);

  if (!onShorts) {
    notOnShorts.classList.remove('hidden');
    toggleEnabled.disabled  = true;
    intervalSlider.disabled = true;
    skipAds.disabled        = true;
    scrollOnEnd.disabled    = true;
    btnNext.disabled        = true;
  }
}

function saveAndSend() {
  chrome.storage.sync.set({ autoScrollSettings: currentSettings });
  sendToContent({ action: 'updateSettings', settings: currentSettings });
}

// ── Init: load status from content script ────────────────────────────────────

async function init() {
  const resp = await sendToContent({ action: 'getStatus' });

  if (!resp) {
    // Content script not injected yet — load from storage only
    chrome.storage.sync.get(['autoScrollSettings'], (result) => {
      if (result.autoScrollSettings) {
        Object.assign(currentSettings, result.autoScrollSettings);
      }
      applyUIState(currentSettings, false);
    });
    return;
  }

  Object.assign(currentSettings, resp.settings);
  applyUIState(currentSettings, resp.onShorts);
}

// ── Event listeners ──────────────────────────────────────────────────────────

toggleEnabled.addEventListener('change', () => {
  currentSettings.enabled = toggleEnabled.checked;
  updateBadge(currentSettings.enabled);
  saveAndSend();
});

function formatInterval(val) {
  const isInstant = val === 0;
  intervalDisplay.dataset.instant = isInstant;
  return isInstant ? '⚡ Instant' : `${val}s`;
}

intervalSlider.addEventListener('input', () => {
  const val = parseInt(intervalSlider.value, 10);
  intervalDisplay.textContent = formatInterval(val);
  currentSettings.interval = val;
});

intervalSlider.addEventListener('change', () => {
  saveAndSend();
});

skipAds.addEventListener('change', () => {
  currentSettings.skipAds = skipAds.checked;
  saveAndSend();
});

scrollOnEnd.addEventListener('change', () => {
  currentSettings.scrollOnEnd = scrollOnEnd.checked;
  saveAndSend();
});

btnNext.addEventListener('click', () => {
  sendToContent({ action: 'next' });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
init();
