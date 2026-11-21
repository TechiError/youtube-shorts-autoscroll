// YouTube Shorts Auto Scroller - Service Worker

chrome.runtime.onInstalled.addListener(() => {
  // Set default settings on first install
  chrome.storage.sync.get(['autoScrollSettings'], (result) => {
    if (!result.autoScrollSettings) {
      chrome.storage.sync.set({
        autoScrollSettings: {
          enabled: false,
          interval: 15,
          skipAds: true,
          scrollOnEnd: true
        }
      });
    }
  });
});

// Relay messages from popup to the active tab's content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // async
  }
});
