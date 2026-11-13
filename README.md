# Translation Check 2.0

Load this folder in chrome://extensions (Developer mode -> Load unpacked). Needs Chrome 114+.

- `background.js` – service worker; hosts the language model once for the whole browser.
- `content.js` – small page-side scanner (collect, mask, highlight, report).
- `popup.html` / `panel.html` + `popup.js` – the popup and the side-panel UI (same code).
- `src/` – sources. Edit these, then `npm install && npm run build`. `npm test` runs the checks.
