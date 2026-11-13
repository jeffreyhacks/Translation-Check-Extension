# Translation Check 2.0

A browser extension for localization review and quality assurance.

## Installation

1. Open `chrome://extensions` in Google Chrome (Requires Chrome 114+).
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select this folder.

## Architecture

* **`background.js`** – Service worker; hosts the language model once for the whole browser.
* **`content.js`** – Page-side scanner (collects, masks, highlights, and reports).
* **`popup.html` / `panel.html` + `popup.js`** – The extension popup and side-panel UI (shared codebase).
* **`src/`** – Source files. 

## Development

```bash
# Install dependencies and build
npm install && npm run build

# Run automated checks
npm test
