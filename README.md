# YouTube Shorts Auto Scroller

> A lightweight Chrome extension that automatically scrolls through YouTube Shorts — with a slick in-page overlay UI and smart end-detection that respects looping videos.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

---

## Features

- **Auto-scroll** through Shorts at a customizable interval (3s – 60s)
- **⚡ Instant mode** — skips the moment the current Short ends (loop-aware)
- **Skip sponsored / ad Shorts** — automatically skips sponsored content when enabled
- **In-page overlay UI** — floating, draggable panel directly on YouTube Shorts
  - Fully draggable anywhere on screen (both expanded & compact form)
  - One-tap quick toggle between full settings and an ultra-compact floating badge
  - Live progress ring that tracks playback of the active Short
  - Next video skip button
- **SPA-aware** — seamlessly handles YouTube's client-side navigation without page reloads
- **Persistent settings** via `chrome.storage.sync` (syncs across Chrome profiles)

---

## Screenshots

> Floating overlay appears on the right side of every YouTube Short.

| Popup | In-page overlay |
|---|---|
| Dark-themed settings popup | Live progress ring + toggle + skip |

---

## Installation

### From source (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/TechiError/yt-shorts-autoscroll.git
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the project folder.

5. The extension icon appears in your toolbar. Pin it for quick access.

---

## Usage

### Popup
Click the extension icon in the toolbar to open the settings popup:

| Control | Description |
|---|---|
| **Auto Scroll toggle** | Enable / disable auto-scrolling |
| **Interval slider** | Time between skips (drag all the way left for ⚡ Instant) |
| **Skip while ad plays** | Pauses the timer during ads; resumes after |
| **Scroll when video ends** | Skips the moment the Short finishes rather than on a fixed timer |
| **⏭ Next Short** | Manually skip to the next Short |

### In-page overlay
A floating control panel appears on every `youtube.com/shorts/*` page:

| Element | Action |
|---|---|
| **Large circle button** | Toggle auto-scroll (turns red when active) |
| **Red arc ring** | Live progress indicator — fills as the video plays |
| **Small ⏭ button** | Skip to the next Short immediately |

---

## How It Works

```
Video starts
     │
     ▼
timeupdate fires ~4× per second
     │
     ├── remaining < 0.5s? ──► onNearEnd() ──► goToNext()
     │
     └── interval cap timer ──► goToNext()   (fallback if end never detected)
```

**Why `timeupdate` instead of `ended`?**
YouTube Shorts set `loop=true` on the `<video>` element, so the browser restarts the video silently — the `ended` event **never fires**. The extension watches `timeupdate` and triggers when less than 0.5 seconds remain.

**Navigation fallback chain** (tried in order):
1. Click YouTube's native next-video button
2. `scrollBy()` on the Shorts scroll container
3. `scrollIntoView()` on the next `ytd-reel-video-renderer`
4. Dispatch `ArrowDown` keyboard event

---

## Project Structure

```
yt-shorts-autoscroll/
├── manifest.json        ← Chrome Extension Manifest V3
├── content.js           ← Auto-scroll logic + in-page overlay UI
├── background.js        ← Service worker (storage init + message relay)
├── popup.html           ← Extension popup markup
├── popup.css            ← Dark-themed popup styles
├── popup.js             ← Popup logic & chrome.storage sync
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Persist and sync user settings |
| `tabs` | Identify the active YouTube tab to relay messages |
| `host: youtube.com` | Inject the content script on YouTube Shorts pages |

No data is collected or transmitted externally.

---

## Contributing

Pull requests are welcome! For major changes, please open an issue first.

1. Fork the repo
2. Create your branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

[MIT](LICENSE) © 2026 [TechiError](https://github.com/TechiError)
