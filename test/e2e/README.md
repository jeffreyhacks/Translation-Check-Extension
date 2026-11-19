# End-to-end test (real Chromium + the real extension)

    pip install playwright && playwright install chromium
    npm run build && python test/e2e/run.py

Loads the built extension in Chromium and drives the real popup against local pages and PDFs:
real service worker, CLD3 WebAssembly under the extension security policy, CSS highlights, live updates, pdf.js worker.
Set `CHROME=/path/to/chrome` to use a specific browser. Screenshots are written to `test/e2e/shots/`.
The test copy of the extension only adds host permissions for the local server (stands in for the toolbar click).

Other scripts in this folder (same setup): `picker.py` – searchable language list and dark/light contrast audit;
`ghost.py` – highlights left on a page by an older copy of the extension are removed by a new check (pixel-checked from real screenshots).
`names.py` – names are counted and never highlighted, while English interface labels next to them still are (pixel-checked).
`auto.py` – "check this site automatically" against Chrome's real permission validation (unmodified manifest) and end to end, plus the logo in both themes.
`v206.py` – grouped strings and their locations, context lines, Ignore that learns (and Undo), spelling hints, the layout check from real
rendered boxes, and the stretch test (the page's HTML must be byte-identical afterwards).
`localpdf.py` – a PDF opened from disk (`file://`): local-file access is asked for in the click, the file is checked, and no "Not allowed to load local resource" error is logged.
`connectors.py` – the reported German "Connectors" page (`site/de-connectors.html`): status badges, tab labels, REST API, date and time
formats, and the CSV export (one line per row, no blank fields, every location).
`projects.py` – the reported German "Projekte" list (`site/de-projects.html`): no project name is dropped, the coverage line, orange wavy
underlines (pixel-checked), the hover card and its decision buttons, and the popup following a decision made on the page.
`contrast.py` – every visible text in the popup (results, both tabs, settings) meets WCAG AA contrast in the light and the dark theme.
