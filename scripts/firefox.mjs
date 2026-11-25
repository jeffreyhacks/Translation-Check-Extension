// Builds a Firefox / Zen version of the extension into firefox-build/ (the Chrome files are not touched).
// Usage: npm run build:firefox  (run `npm run build` first if src/ changed), then in Firefox/Zen open
// about:debugging#/runtime/this-firefox -> "Load Temporary Add-on..." -> pick firefox-build/manifest.json
import fs from 'fs';
const out = 'firefox-build';
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

// Chrome-only: service worker, side panel API, minimum Chrome version.
delete m.minimum_chrome_version;
delete m.side_panel;
m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
m.background = { scripts: ['background.js'] };
// Firefox's equivalent of the side panel (View > Sidebars). The panel page is the same one Chrome uses.
m.sidebar_action = { default_title: 'Translation Check', default_panel: 'panel.html', default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png' } };
m.browser_specific_settings = { gecko: { id: 'translation-check@local', strict_min_version: '128.0' } };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['background.js', 'content.js', 'pdfcheck.js', 'learn.js', 'popup.html', 'popup.css', 'popup.js', 'panel.html']) fs.copyFileSync(f, `${out}/${f}`);
for (const d of ['icons', 'vendor']) fs.cpSync(d, `${out}/${d}`, { recursive: true });
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify(m, null, 2) + '\n');
console.log(`Firefox build ready: ${out}/ (version ${m.version})`);
