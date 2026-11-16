# Translation Check 2.1

Checks whether a web page **or a PDF open in the browser** is fully in the language you pick, and highlights what isn't.
Load this folder in `chrome://extensions` (Developer mode → Load unpacked). Needs Chrome 114+.

## How a warning is decided
1. **tinyld** + rules (numbers, durations, versions, model names, brands and URLs are ignored first) propose a verdict.
2. **CLD3** (Google's detector, WebAssembly) and **franc** vote independently. Two models that read the text as the target language
   withdraw the warning; two that agree on another language can raise one. Each warning shows three dots (one per model) and a ✓ when 2+ agree.
   Settings → *Confirmed only* shows nothing that a second model doesn't back.
3. Page-level logic: sentence context, source-language comparison (hreflang), and the "mostly translated" fallback for very short strings.

## PDFs
Open a PDF in the browser and click the toolbar icon → **Check PDF**. The file is downloaded by the extension, read with pdf.js and checked
with the same pipeline. Clicking an issue jumps to its page and copies the snippet so you can press Ctrl+F. Scanned (image-only) PDFs have no text to check.
Local `file://` PDFs need "Allow access to file URLs" on the extension's details page.

## Layout
- `background.js` – service worker: the language models (loaded once for the whole browser).
- `content.js` – small page-side scanner. `pdfcheck.js` + `vendor/` – PDF reader (pdf.js, Apache-2.0).
- `popup.html` / `panel.html` + `popup.js` – popup and side panel (same code).
- `src/` – sources. `npm install && npm run build` rebuilds; `npm test` runs the checks; `test/e2e/` drives a real Chromium.
