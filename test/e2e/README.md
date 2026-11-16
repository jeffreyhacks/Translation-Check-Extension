# End-to-end test (real Chromium + the real extension)

    pip install playwright && playwright install chromium
    npm run build && python test/e2e/run.py

Loads the built extension in Chromium and drives the real popup against local pages and PDFs:
real service worker, CLD3 WebAssembly under the extension security policy, CSS highlights, live updates, pdf.js worker.
Set `CHROME=/path/to/chrome` to use a specific browser. Screenshots are written to `test/e2e/shots/`.
The test copy of the extension only adds host permissions for the local server (stands in for the toolbar click).
