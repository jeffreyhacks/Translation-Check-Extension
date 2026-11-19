import { JSDOM } from 'jsdom';
import fs from 'fs';
import { loadNew } from './harness.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULT = {
  lang: 'es', requested: 'auto', mode: 'balanced', host: 'shop.example.com', pageLang: 'es', score: 67, live: true,
  source: { status: 'used', lang: 'en' }, models: { cld3: 'wasm', franc: 'ready' },
  stats: { ok: 200, bad: 100, unsure: 10, bug: 20, fmt: 0, name: 40, okN: 20, badN: 2, unsureN: 1, bugN: 1, fmtN: 0, nameN: 5, assumedN: 3, ignoredN: 4 },
  issues: [
    { id: 1, verdict: 'bug', kind: 'text', text: 'checkout.button.save', reason: 'Looks like a translation key', len: 20 },
    { id: 2, verdict: 'bad', kind: 'text', text: 'Add to cart', detected: 'en', reason: 'Looks like English text', len: 11, votes: { tinyld: 'other', cld3: 'other', franc: 'abstain' }, confirmed: true },
    { id: 3, verdict: 'bad', kind: 'attr', attr: 'placeholder', text: '<img src=x onerror=alert(1)>Enter your email address here so that we can send you the confirmation', detected: 'en', reason: 'Detected as another language', len: 30, votes: { tinyld: 'other', cld3: 'abstain', franc: 'abstain' }, confirmed: false },
    { id: 4, verdict: 'unsure', kind: 'text', text: 'Lorem ipsum', reason: undefined, len: 11 },
  ],
};
const PDF_RESULT = { kind: 'pdf', lang: 'de', requested: 'auto', mode: 'balanced', pageLang: '', score: 80, live: false, source: { status: 'pdf', pages: 12 }, models: { cld3: 'wasm', franc: 'ready' },
  stats: { ok: 100, bad: 30, unsure: 0, bug: 0, fmt: 0, okN: 9, badN: 1, unsureN: 0, bugN: 0, fmtN: 0, assumedN: 0, ignoredN: 2 },
  issues: [{ id: 1, verdict: 'bad', kind: 'pdf', page: 3, pages: [3, 4, 7], text: 'Please read it carefully before you start.', detected: 'en', reason: 'Detected as another language', len: 40, votes: { tinyld: 'other', cld3: 'other', franc: 'other' }, confirmed: true }] };
PDF_RESULT.allIssues = PDF_RESULT.issues;

async function boot(file = 'popup.html', tabUrl = 'https://shop.example.com/x', o = {}) {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://abc/' + file });
  const w = dom.window;
  const store = { ...(o.store || {}) }, sent = [], reg = [], downloads = [], updates = [], clip = [], perms = [], removed = [], runtimeSent = [];
  let permAnswer = true, contains = o.contains !== false;
  let msgL, fetchOk = true, storageL = null;
  w.chrome = {
    i18n: { getUILanguage: () => 'en-US' },
    storage: { local: { get: async () => store, set: async (o) => Object.assign(store, o) }, onChanged: { addListener: (f) => (storageL = f) } },
    tabs: { query: async () => [{ id: 5, url: tabUrl }], update: async (id, o) => updates.push([id, o]),
      sendMessage: async (id, m) => { sent.push(m); const R = o.result || RESULT; return m.type === 'scan' ? R : m.type === 'status' ? { result: null } : m.type === 'export' ? (o.export || { url: tabUrl, title: 'Shop', lang: 'es', generated: 'now', issues: R.issues.map((i) => ({ ...i, selector: 'main > p:nth-of-type(2)' })) }) : { ok: true }; },
      onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
    scripting: { executeScript: async () => {}, registerContentScripts: async (a) => reg.push(...a), unregisterContentScripts: async () => {} },
    permissions: { request: (q) => { perms.push(q); return o.hold ? new Promise(() => {}) : Promise.resolve(permAnswer); }, remove: async (q) => { removed.push(q); return true; }, contains: async () => contains },
    runtime: { onMessage: { addListener: (f) => (msgL = f) }, getURL: (p) => 'chrome-extension://abc/' + p, sendMessage: async (m) => { runtimeSent.push(m); return {}; } },
    sidePanel: { open: async () => {} },
    extension: { isAllowedFileSchemeAccess: (cb) => cb(o.fileAccess !== false) },
  };
  if (o.noScripting) { // Vivaldi: the popup has no chrome.scripting; injection goes through the background worker
    delete w.chrome.scripting;
    w.chrome.runtime.sendMessage = async (m) => { runtimeSent.push(m); return m.type === 'tc-inject' ? { ok: true } : {}; };
  }
  if (o.partialBrowser) { // browsers that also define a partial `browser` namespace (no scripting): the popup must still use chrome
    w.chrome.runtime.id = 'abc';
    w.browser = { runtime: { id: 'abc', sendMessage: async () => ({}) }, storage: w.chrome.storage, tabs: w.chrome.tabs };
  }
  w.URL.createObjectURL = (b) => { downloads.push(b); return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download }); };
  w.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (x) => clip.push(x) } });
  // PDF libraries: external <script> files don't load in jsdom, so simulate loading + provide stand-ins
  const origAppend = w.document.head.append.bind(w.document.head);
  w.document.head.append = (s) => { if (s.tagName === 'SCRIPT' && s.src) { setTimeout(() => s.onload && s.onload(), 0); return; } return origAppend(s); };
  w.pdfjsLib = { GlobalWorkerOptions: {} };
  const pdfCalls = [];
  w.TCPDF = { analyzePdf: async (o) => { pdfCalls.push(o); o.onProgress({ stage: 'read', page: 1, pages: 12 }); return PDF_RESULT; } };
  let fetchN = 0, fetchesBeforeGrant = 0;
  const realFetchCount = () => { fetchN++; if (!perms.length) fetchesBeforeGrant++; };
  w.fetch = async () => (realFetchCount(), fetchOk || (o.fileGrantFixes && perms.some((q) => q.origins[0] === 'file:///*') && permAnswer) ? { ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer } : { ok: false, status: 403 });
  if (o.learn !== false) w.eval(fs.readFileSync('learn.js', 'utf8')); // loaded before popup.js, as in popup.html
  w.eval(fs.readFileSync('popup.js', 'utf8'));
  await sleep(50);
  const scanBtn = w.document.querySelector('#scan');
  let permAtClick = -1;
  if (scanBtn) { const orig = scanBtn.click.bind(scanBtn); scanBtn.click = () => { orig(); permAtClick = perms.length; }; } // perms requested synchronously in the click
  return { get permAtClick() { return permAtClick; }, get fetchesBeforeGrant() { return fetchesBeforeGrant; }, fetches: () => fetchN, w, d: w.document, store, sent, reg, downloads, updates, clip, perms, removed, pdfCalls, runtimeSent, denyPerms: () => (permAnswer = false), failFetch: () => (fetchOk = false), msg: (m, s) => msgL(m, s), storageChanged: (ch) => storageL && storageL(ch, 'local'), $: (s) => w.document.querySelector(s) };
}
const readBlob = (w, blob, as = 'text') => new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(r.result); if (as === 'text') r.readAsText(blob); else r.readAsArrayBuffer(blob); });
const chipsText = (p) => [...p.d.querySelectorAll('#chips .chip')].map((c) => c.textContent).join(' | ');

{
  const p = await boot('popup.html', 'https://shop.example.com/x', { noScripting: true });
  p.$('#scan').click(); await sleep(50);
  t('popup: without chrome.scripting (Vivaldi) the background worker injects the page script', p.runtimeSent.some((m) => m.type === 'tc-inject' && m.tabId === 5) && !p.$('#result').hidden, p.$('#status').textContent);
}
{
  const p = await boot('popup.html', 'vivaldi:extensions');
  p.$('#scan').click(); await sleep(50);
  t('popup: browser pages (vivaldi:extensions) get a clear message, not a crash', /can’t be checked/.test(p.$('#status').textContent) && !p.sent.some((m) => m.type === 'scan'), p.$('#status').textContent);
}
{
  const p = await boot('popup.html', 'https://shop.example.com/x', { partialBrowser: true });
  p.$('#scan').click(); await sleep(50);
  t('popup: works when the browser also has a partial "browser" object without scripting', !p.$('#result').hidden && !/executeScript/.test(p.$('#status').textContent), p.$('#status').textContent);
}
{
  const p = await boot();
  t('popup: language picker populated, defaulting to the page\'s own language', p.$('#lang').options.length >= 40 && p.$('#lang').value === 'auto' && p.$('#lang').options[0].value === 'auto');
  const label = (c) => [...p.$('#lang').options].find((o) => o.value === c)?.textContent;
  t('popup: English name comes first ("German (Deutsch)")', label('de') === 'German (Deutsch)' && label('es') === 'Spanish (español)' && label('ja').startsWith('Japanese ('), `${label('de')} | ${label('es')}`);
  t('popup: settings drawer is collapsed by default, language field is labelled', p.$('#settings').hidden && p.$('#result').hidden && /Page should be in/.test(p.$('.cap').textContent) && p.$('h1').textContent === 'Translation Check');
  p.$('#settingsBtn').click();
  t('popup: gear opens the settings drawer', !p.$('#settings').hidden && p.$('#settingsBtn').getAttribute('aria-expanded') === 'true');
  t('popup: drawer is grouped and every option has a description', p.d.querySelectorAll('#settings .grp h2').length === 4 && p.d.querySelectorAll('#settings .opt .d').length === 11 && /Assumes very short unclear text/.test(p.$('#modeHint').textContent));
  t('popup: drawer has strictness segments and the new model switches', p.d.querySelectorAll('input[name=mode]').length === 3 && p.$('#verify').checked && !p.$('#confirmed').checked);
  t('popup: side-panel button shown in popup', p.$('#openPanel').hidden === false);
  t('popup: button says "Check page" on web pages', p.$('#scanLabel').textContent === 'Check page');
  p.$('#scan').click(); await sleep(50);
  t('popup: scan shows result', !p.$('#result').hidden && p.$('#score').textContent === '67%' && p.$('#arc').getAttribute('stroke-dasharray') === '67 100');
  const scanMsg = p.sent.find((m) => m.type === 'scan');
  t('popup: scan sends every option incl. model verification', scanMsg && scanMsg.lang === 'auto' && scanMsg.live === true && scanMsg.source === true && scanMsg.hints === false && scanMsg.related === true && scanMsg.verify === true && scanMsg.confirmedOnly === false && scanMsg.mode === 'balanced', JSON.stringify(scanMsg));
  t('popup: stats and tab counts', p.$('#nBad').textContent === '2' && p.$('#tabBad .n').textContent === '2' && p.$('#tabUnsure .n').textContent === '1' && !p.$('#tabBug').hidden && p.$('#tabFmt').hidden);
  const ct = chipsText(p);
  t('popup: info is shown as short labelled chips', /Spanish/.test(ct) && /3 models/.test(ct) && /Live/.test(ct) && /Source: English/.test(ct) && /4 skipped/.test(ct) && /3 assumed/.test(ct), ct);
  t('popup: names are a chip of their own, with an explanation, not part of the unclear count', /5 names/.test(ct) && /same in every language/.test(p.d.querySelector('#chips').innerHTML) && p.$('#tabUnsure .n').textContent === '1', ct);
  t('popup: page text is shown as text, never as HTML', !p.$('#list img') && /<img src=x/.test(p.$('#list').textContent));
  t('popup: each row shows why it was flagged and how many models agree', /Looks like English text/.test(p.$('#list').textContent) && /2\/3/.test(p.$('#list').textContent) && /1\/3/.test(p.$('#list').textContent));
  t('popup: model agreement dots (red = other language) with tooltip', p.d.querySelectorAll('#list .pips').length === 2 && p.d.querySelector('#list .pips .pip.other') && /CLD3: other/.test(p.d.querySelector('#list .pips').title));
  t('popup: confirmed warnings get a check mark, unconfirmed do not', p.d.querySelectorAll('#list .pips.confirmed').length === 1 && p.d.querySelectorAll('#list .pips .check').length === 1);
  p.$('#next').click(); await sleep(10);
  t('popup: next focuses the first issue', p.sent.some((m) => m.type === 'focus' && m.id === 2) && p.$('#pos').textContent === '1 / 2');
  p.$('#next').click(); p.$('#next').click(); await sleep(10);
  t('popup: next wraps around', p.$('#pos').textContent === '1 / 2');
  p.$('#prev').click(); await sleep(10);
  t('popup: previous goes back', p.$('#pos').textContent === '2 / 2');
  p.$('#tabBug').click();
  t('popup: broken-text tab lists the leaked key', /checkout\.button\.save/.test(p.$('#list').textContent) && !p.$('#list .ignore-btn'));
  p.$('#tabBad').click();
  t('popup: Ignore button only on short strings', p.d.querySelectorAll('#list .ignore-btn').length === 1);
  p.$('#list .ignore-btn').click(); await sleep(80);
  t('popup: Ignore saves to this site\'s list and re-checks', JSON.stringify(p.store.ignore.sites['shop.example.com']) === '["Add to cart"]' && p.$('#ignoreSite').value === 'Add to cart' && p.sent.filter((m) => m.type === 'scan').length === 2);
  t('popup: re-check sends the ignore list', p.sent.filter((m) => m.type === 'scan').pop().ignore.includes('Add to cart'));
  p.$('#expCsv').click(); await sleep(50);
  const blob = p.downloads.find((d) => d instanceof p.w.Blob);
  const csv = blob && await readBlob(p.w, blob);
  const bytes = blob && new Uint8Array(await readBlob(p.w, blob, 'bytes'));
  t('popup: CSV has a UTF-8 BOM so Excel reads accents', bytes && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF);
  t('popup: CSV has selector, broken-text rows and model agreement', csv && csv.startsWith('"type"') && /main > p:nth-of-type\(2\)/.test(csv) && /"Broken text"/.test(csv) && /2\/3 models \(confirmed\)/.test(csv), csv && csv.slice(0, 200));
  p.downloads.length = 0;
  p.$('#expHtml').click(); await sleep(50);
  const html = await readBlob(p.w, p.downloads.find((d) => d instanceof p.w.Blob));
  t('popup: HTML report escapes page text', !/<img src=x/.test(html) && /&lt;img src=x/.test(html));
  p.$('#auto').click(); await sleep(50);
  t('popup: auto-check asks for this site only, with an origin the manifest lists as optional (https://host/*, never "*://")', p.perms.length === 1 && p.perms[0].origins.length === 1 && p.perms[0].origins[0] === 'https://shop.example.com/*' && p.store.autoSites.includes('shop.example.com'), JSON.stringify(p.perms));
  t('popup: auto-check asks the background worker to finish the setup (the popup itself does not register scripts)', p.runtimeSent.some((m) => m.type === 'tc-sync-auto') && p.reg.length === 0);
  t('popup: no error is shown after turning auto-check on', !/Could not/.test(p.$('#status').textContent), p.$('#status').textContent);
  p.$('#auto').click(); await sleep(50);
  t('popup: auto-check can be switched off, and the permission is given back', !p.store.autoSites.includes('shop.example.com') && p.removed.some((r) => r.origins[0] === 'https://shop.example.com/*'), JSON.stringify(p.removed));
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 50 } }, { tab: { id: 5 } });
  t('popup: live update from the page refreshes the view', p.$('#score').textContent === '50%');
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 10 } }, { tab: { id: 99 } });
  t('popup: updates from other tabs are ignored', p.$('#score').textContent === '50%');
  const wrong = { ...RESULT, lang: 'en', requested: 'en', pageLang: 'de', score: 12, stats: { ...RESULT.stats, badN: 15, okN: 2 },
    issues: Array.from({ length: 15 }, (_, k) => ({ id: 100 + k, verdict: 'bad', kind: 'text', text: 'Beschwerde über fehlerhaftes Gerät ' + k, detected: 'de', reason: 'Detected as another language', len: 34 })) };
  p.msg({ type: 'tc-result', result: wrong }, { tab: { id: 5 } });
  t('popup: short banner appears when the target is probably wrong', !p.$('#mismatch').hidden && /Mostly German \(\d+% of the text\)/.test(p.$('#mismatchText').textContent) && /page’s own language/.test(p.$('#mismatchText').textContent), p.$('#mismatchText').textContent);
  t('popup: banner offers one-click fix', p.$('#mismatchFix').textContent === 'Check for German');
  p.$('#mismatchFix').click(); await sleep(60);
  t('popup: fix switches the target and re-checks', p.$('#lang').value === 'de' && p.$('#langInput').value === 'German (Deutsch)' && p.sent.filter((m) => m.type === 'scan').pop().lang === 'de' && p.store.opts.lang === 'de');
  p.$('#clear').click(); await sleep(30);
  t('popup: clear hides results', p.$('#result').hidden);
  p.$('#confirmed').checked = true; p.$('#confirmed').dispatchEvent(new p.w.Event('change')); p.$('#hints').checked = true; p.$('#hints').dispatchEvent(new p.w.Event('change')); await sleep(20);
  t('popup: options are remembered', p.store.opts.hints === true && p.store.opts.confirmedOnly === true && p.store.opts.verify === true);
  const strict = p.d.querySelector('input[name=mode][value=strict]'); strict.checked = true; strict.dispatchEvent(new p.w.Event('change')); await sleep(10);
  t('popup: strictness segment is saved', p.store.opts.mode === 'strict');
}
// ---- auto-check: Chrome's permission prompt can close the popup; denial; shown state ----
{
  const p = await boot('popup.html', 'https://shop.example.com/x', { hold: true });
  p.$('#auto').click(); await sleep(40);
  t('auto-check: the choice is saved before the permission prompt, so it survives the popup closing', p.store.autoSites.includes('shop.example.com'), JSON.stringify(p.store));
  const d = await boot('popup.html', 'https://shop.example.com/x');
  d.denyPerms(); d.$('#auto').click(); await sleep(60);
  t('auto-check: if the permission is refused the switch goes back off and nothing is kept', d.$('#auto').checked === false && !(d.store.autoSites || []).includes('shop.example.com'), JSON.stringify(d.store));
  const o = await boot('popup.html', 'https://shop.example.com/x', { store: { autoSites: ['shop.example.com'] } });
  t('auto-check: shows on when the site is saved and permitted', o.$('#auto').checked === true);
  const n = await boot('popup.html', 'https://shop.example.com/x', { store: { autoSites: ['shop.example.com'] }, contains: false });
  t('auto-check: shows off when the permission was taken away in Chrome', n.$('#auto').checked === false);
  const h = await boot('popup.html', 'http://intranet.local:8080/x'); h.$('#auto').click(); await sleep(50);
  t('auto-check: http sites ask for the http origin', h.perms[0] && h.perms[0].origins[0] === 'http://intranet.local/*', JSON.stringify(h.perms));
}
// ---- Ignore keeps you on the tab you were working in ----
{
  const p = await boot(); p.$('#scan').click(); await sleep(50);
  p.$('#tabUnsure').click();
  t('ignore: the Unclear tab lists its text with an Ignore button', /Lorem ipsum/.test(p.$('#list').textContent) && !!p.$('#list .ignore-btn'));
  p.$('#list .ignore-btn').click(); await sleep(90);
  t('ignore: after Ignore on the Unclear tab you stay on the Unclear tab', p.$('#tabUnsure').getAttribute('aria-selected') === 'true' && p.$('#tabBad').getAttribute('aria-selected') === 'false', p.$('#tabUnsure').getAttribute('aria-selected'));
  t('ignore: the re-check ran with the new ignore list', p.sent.filter((m) => m.type === 'scan').pop().ignore.includes('Lorem ipsum'));
  p.$('#scan').click(); await sleep(60);
  t('ignore: a fresh "Check page" still starts on Untranslated', p.$('#tabBad').getAttribute('aria-selected') === 'true');
}
// ---- Unclear → mark as untranslated (Ignore stays) ----
{
  const p = await boot(); p.$('#scan').click(); await sleep(50);
  p.$('#tabUnsure').click();
  const row = p.$('#list li');
  t('mark: an unclear row has both "Untranslated" and "Ignore"', !!row.querySelector('.mark-btn') && row.querySelector('.mark-btn').textContent === 'Untranslated' && !!row.querySelector('.ignore-btn'));
  p.$('#tabBad').click();
  t('mark: untranslated rows have no "Untranslated" button', ![...p.d.querySelectorAll('#list .mark-btn')].some((b) => b.textContent === 'Untranslated'));
  p.$('#tabUnsure').click();
  p.$('#list .mark-btn').click(); await sleep(90);
  const sc = p.sent.filter((m) => m.type === 'scan').pop();
  t('mark: the re-check carries the marked text', sc.marked.includes('Lorem ipsum'), JSON.stringify(sc.marked));
  t('mark: saved for this site', p.store.marked?.sites?.['shop.example.com']?.includes('Lorem ipsum'), JSON.stringify(p.store.marked));
  t('mark: you stay on the Unclear tab, with a note', p.$('#tabUnsure').getAttribute('aria-selected') === 'true' && /moved to Untranslated/.test(p.$('#status').textContent), p.$('#status').textContent);
  t('mark: shown in Settings › marked list', p.$('#markedSite').value === 'Lorem ipsum');
  // ignoring a marked text takes it off the marked list (latest decision wins), and the other way round
  p.$('#tabUnsure').click(); p.$('#list .ignore-btn').click(); await sleep(90);
  t('mark: Ignore afterwards removes it from the marked list', !p.store.marked.sites['shop.example.com'].includes('Lorem ipsum') && p.store.ignore.sites['shop.example.com'].includes('Lorem ipsum'));
  p.$('#tabUnsure').click(); p.$('#list .mark-btn').click(); await sleep(90);
  t('mark: marking afterwards removes it from the ignore list', !p.store.ignore.sites['shop.example.com'].includes('Lorem ipsum') && p.store.marked.sites['shop.example.com'].includes('Lorem ipsum'));
  p.$('#expIgnore').click(); await sleep(30);
  t('mark: exported with the ignore list', p.downloads.some((d) => d.name === 'translation-check-ignore-list.json'));
}
{
  const R = { ...RESULT, issues: [{ id: 9, verdict: 'bad', kind: 'text', text: 'Truecost', reason: 'Marked untranslated by you', marked: true, len: 8 }] };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: R, store: { marked: { global: [], sites: { 'shop.example.com': ['Truecost'] } } } });
  p.$('#scan').click(); await sleep(50);
  t('mark: a marked item offers Unmark next to Ignore', p.$('#list .mark-btn')?.textContent === 'Unmark' && !!p.$('#list .ignore-btn'));
  p.$('#list .mark-btn').click(); await sleep(90);
  t('mark: Unmark removes it and re-checks', !p.store.marked.sites['shop.example.com'].includes('Truecost') && !p.sent.filter((m) => m.type === 'scan').pop().marked.includes('Truecost'));
}
// ---- PDF in the browser's viewer ----
{
  const p = await boot('popup.html', 'https://docs.example.org/files/handbook.pdf?download=1');
  t('pdf popup: scan button switches to "Check PDF"', p.$('#scanLabel').textContent === 'Check PDF');
  t('pdf popup: auto-check is disabled for PDFs', p.$('#auto').disabled);
  p.$('#scan').click(); await sleep(80);
  t('pdf popup: runs the PDF analyser with all options, not the page scanner', p.pdfCalls.length === 1 && p.pdfCalls[0].params.lang === 'auto' && p.pdfCalls[0].params.verify === true && !p.sent.some((m) => m.type === 'scan'));
  t('pdf popup: downloaded the PDF bytes and set the pdf.js worker', p.pdfCalls[0].data.length === 4 && p.w.pdfjsLib.GlobalWorkerOptions.workerSrc === 'chrome-extension://abc/vendor/pdf.worker.min.js');
  t('pdf popup: shows the result with a PDF chip and page tag', !p.$('#result').hidden && /PDF · 12 p\./.test(chipsText(p)) && /p\.3 \+2/.test(p.$('#list').textContent), chipsText(p));
  p.$('#list li > button').click(); await sleep(30);
  t('pdf popup: clicking an issue jumps to its page in the viewer', p.updates.length === 1 && p.updates[0][1].url === 'https://docs.example.org/files/handbook.pdf?download=1#page=3', JSON.stringify(p.updates));
  t('pdf popup: copies the snippet so it can be found with Ctrl+F', p.clip[0] === 'Please read it carefully before you start.' && /Ctrl\+F/.test(p.$('#status').textContent), p.$('#status').textContent);
  p.$('#expCsv').click(); await sleep(50);
  const csv = await readBlob(p.w, p.downloads.find((d) => d instanceof p.w.Blob));
  t('pdf popup: CSV export lists the pages', /page 3, 4, 7/.test(csv) && /3\/3 models \(confirmed\)/.test(csv), csv.slice(0, 300));
}
{
  const p = await boot('popup.html', 'https://docs.example.org/private.pdf');
  p.failFetch();
  p.$('#scan').click(); await sleep(80);
  t('pdf popup: blocked download asks for site access once, then explains', p.perms.length === 1 && p.perms[0].origins[0] === 'https://docs.example.org/*' && /Couldn’t download this PDF/.test(p.$('#status').textContent), p.$('#status').textContent);
  const f = await boot('popup.html', 'file:///C:/docs/local.pdf', { fileAccess: false });
  f.failFetch(); f.$('#scan').click(); await sleep(80);
  t('pdf popup: local files explain the file-access switch when it is off, without trying to read the file', /Allow access to file URLs/.test(f.$('#status').textContent) && f.fetches() === 0, f.$('#status').textContent);
  // switch on, but Chrome also needs the file:///* host permission to read the file (verified in real Chrome): ask once, then read it
  const g = await boot('popup.html', 'file:///C:/docs/local.pdf', { fileGrantFixes: true });
  g.failFetch(); g.$('#scan').click(); await sleep(100);
  t('pdf popup: local PDF asks for file:///* once, then is checked', g.perms.length === 1 && g.perms[0].origins[0] === 'file:///*' && g.pdfCalls.length === 1 && !g.$('#result').hidden, g.$('#status').textContent);
  t('pdf popup: the local-file request is made in the click itself (before any await), and the file is read only after it', g.permAtClick === 1 && g.fetchesBeforeGrant === 0, JSON.stringify([g.permAtClick, g.fetchesBeforeGrant]));
  const h = await boot('popup.html', 'file:///C:/docs/local.pdf', { fileGrantFixes: true });
  h.failFetch(); h.denyPerms(); h.$('#scan').click(); await sleep(100);
  t('pdf popup: refusing local-file access explains what to allow, without trying to read the file', /allow the extension to read local files/.test(h.$('#status').textContent) && !h.pdfCalls.length && h.fetches() === 0, h.$('#status').textContent);
}
// ---- searchable language picker ----
{
  const p = await boot();
  const input = p.$('#langInput'), list = p.$('#langList'), W = p.w;
  const type = (q) => { input.value = q; input.dispatchEvent(new W.Event('input', { bubbles: true })); };
  const key = (k) => input.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const opts = () => [...p.d.querySelectorAll('#langList li[data-value]')].map((l) => l.textContent);
  t('picker: shows the current choice and starts closed', input.value === 'Page’s own language' && list.hidden && input.getAttribute('aria-expanded') === 'false');
  input.dispatchEvent(new W.Event('focus'));
  t('picker: focusing opens the full list with the current one marked', !list.hidden && opts().length === p.$('#lang').options.length && p.$('#langList li[aria-selected=true]').textContent === 'Page’s own language' && p.d.body.classList.contains('picking'));
  t('picker: exposed to screen readers (combobox/listbox/option)', input.getAttribute('role') === 'combobox' && list.getAttribute('role') === 'listbox' && p.d.querySelector('#langList li').getAttribute('role') === 'option');
  type('deu'); t('picker: native name ("deu" → German)', opts()[0] === 'German (Deutsch)', JSON.stringify(opts()));
  type('ger'); t('picker: English name ("ger" → German first)', opts()[0] === 'German (Deutsch)', JSON.stringify(opts()));
  type('espanol'); t('picker: accent-insensitive ("espanol" → Spanish)', opts()[0] === 'Spanish (español)', JSON.stringify(opts()));
  type('中'); t('picker: native scripts ("中" → Chinese)', opts()[0] === 'Chinese (中文)', JSON.stringify(opts()));
  type('pt'); t('picker: language code ("pt" → Portuguese)', opts().includes('Portuguese (português)'));
  type('own'); t('picker: "own" finds the page-language option', opts()[0] === 'Page’s own language');
  type('zzzz'); key('Enter');
  t('picker: no match shows a message and Enter does nothing', /No matching language/.test(list.textContent) && p.$('#lang').value === 'auto');
  type('ja'); key('Enter'); await sleep(20);
  t('picker: Enter chooses best match, closes and saves', p.$('#lang').value === 'ja' && list.hidden && /Japanese/.test(input.value) && p.store.opts.lang === 'ja', input.value);
  input.dispatchEvent(new W.Event('focus')); type('ita'); key('Escape');
  t('picker: Escape closes and restores the previous choice', list.hidden && /Japanese/.test(input.value) && p.$('#lang').value === 'ja', input.value);
  input.dispatchEvent(new W.Event('focus')); type('xx'); input.dispatchEvent(new W.Event('blur'));
  t('picker: clicking away discards a half-typed search', list.hidden && input.value !== 'xx', input.value);
  input.dispatchEvent(new W.Event('focus'));
  [...p.d.querySelectorAll('#langList li[data-value]')].find((l) => l.dataset.value === 'it').dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, cancelable: true })); await sleep(20);
  t('picker: clicking an option chooses it', p.$('#lang').value === 'it' && input.value === 'Italian (italiano)' && p.store.opts.lang === 'it', input.value);
  p.$('#scan').click(); await sleep(60);
  t('picker: the chosen language is what gets checked', p.sent.filter((m) => m.type === 'scan').pop().lang === 'it');
}
{
  const p = await boot('panel.html');
  t('panel: loads in side-panel mode (no side-panel button)', p.$('#openPanel').hidden === true && p.d.body.classList.contains('panel'));
}

// ---------- 2.0.6: grouped strings, context, learning, exports ----------
const G = {
  ...RESULT, score: 50,
  stats: { ...RESULT.stats, badN: 4, unsureN: 0, bugN: 0, learnedN: 6 },
  issues: [
    { id: 10, verdict: 'bad', kind: 'text', text: 'Add to cart', detected: 'en', reason: 'Looks like English text', len: 33, count: 3, slot: 'button.cart-btn',
      context: { kind: 'button', path: 'Navigation “Main menu”' },
      occ: [{ id: 10, kind: 'text', where: 'button · Navigation “Main menu”', before: 'Inicio Productos', after: '' },
        { id: 11, kind: 'text', where: 'button · Main › “Camiseta azul”', before: 'Algodón orgánico', after: '' },
        { id: 12, kind: 'text', where: 'button · Main › “Pantalón negro”', before: 'Corte recto', after: '' }] },
    { id: 13, verdict: 'bad', kind: 'text', text: 'SKU-1001', detected: 'en', reason: 'Detected as another language', len: 8, count: 1, occ: [{ id: 13, kind: 'text', where: 'text · Main', before: '', after: '' }] },
  ],
};
{
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: G });
  p.$('#scan').click(); await sleep(60);
  const row = p.$('#list li.bad');
  t('206 grouped: one row with ×3 for three copies', /×3/.test(row.textContent) && p.d.querySelectorAll('#list li.bad').length === 2, row.textContent);
  t('206 context: the row says where the text is and what is around it', /button · Navigation “Main menu”/.test(row.querySelector('.where').textContent) && /Inicio Productos/.test(row.querySelector('.near').textContent));
  const btn = () => p.$('#list li.bad button');
  btn().click(); await sleep(20);
  t('206 grouped: first click goes to the first copy', p.sent.filter((m) => m.type === 'focus').pop().id === 10 && /Copy 1 of 3/.test(p.$('#list li.bad').textContent));
  btn().click(); await sleep(20);
  t('206 grouped: clicking again goes to the next copy, with its own context', p.sent.filter((m) => m.type === 'focus').pop().id === 11 && /Copy 2 of 3/.test(p.$('#list li.bad').textContent) && /Camiseta azul/.test(p.$('#list li.bad .where').textContent));
  btn().click(); await sleep(20); btn().click(); await sleep(20);
  t('206 grouped: after the last copy it starts again at the first', p.sent.filter((m) => m.type === 'focus').pop().id === 10);
  t('206 nav: the selected group has previous/next copy buttons', !!p.$('#list li.bad .occ-prev') && /Copy 1 of 3/.test(p.$('#list li.bad .occnav').textContent));
  p.$('#list li.bad .occ-prev').click(); await sleep(20);
  t('206 nav: previous from the first copy goes to the last', p.sent.filter((m) => m.type === 'focus').pop().id === 12 && /Copy 3 of 3/.test(p.$('#list li.bad .occnav').textContent));
  p.$('#list li.bad .occ-prev').click(); await sleep(20);
  t('206 nav: previous again goes back one copy', p.sent.filter((m) => m.type === 'focus').pop().id === 11);
  p.d.querySelectorAll('#list li.bad > button:first-child')[1].click(); await sleep(20); // another item
  t('206 nav: other items have no copy buttons', !p.d.querySelectorAll('#list li.bad')[1].querySelector('.occnav'));
  p.d.querySelectorAll('#list li.bad > button:first-child')[0].click(); await sleep(20); // back to the group
  t('206 nav: coming back to a group resumes at the copy you were on', p.sent.filter((m) => m.type === 'focus').pop().id === 11 && /Copy 2 of 3/.test(p.$('#list li.bad .occnav')?.textContent), JSON.stringify([p.sent.filter((m) => m.type === 'focus').slice(-3), p.$('#list').textContent.slice(0, 300)]));
  t('removed: no spelling or layout tabs, no stretch button, no Quality settings', !p.$('#tabSpell') && !p.$('#tabLayout') && !p.$('#stretch') && !p.$('#spell') && !p.$('#layout'));
  t('206 score: the score and the untranslated count', p.$('#score').textContent === '50%' && p.$('#nBad').textContent === '4');
  t('206 chips: rules learned from Ignore show how many texts they skipped', /6 auto-ignored/.test(chipsText(p)), chipsText(p));
  // CSV keeps the first eight columns, adds the new ones at the end
  p.$('#expCsv').click(); await sleep(50);
  const csv = await readBlob(p.w, p.downloads.find((d) => d.size));
  const head = csv.replace(/^\ufeff/, '').split('\r\n')[0];
  t('206 csv: original columns first, then occurrences, context, surrounding text, all locations', head === '"type","text","reason","detected language","model agreement","where","selector","document","occurrences","context","surrounding text","all locations"', head);
  t('206 csv: the grouped row has its count', /"Add to cart".*"3"/.test(csv));
}
{
  // learning: three Ignores of codes on one site learn a rule, with an Undo
  const result = { ...G, issues: [1, 2, 3].map((k) => ({ id: k, verdict: 'bad', kind: 'text', text: `SKU-100${k}`, detected: 'en', reason: 'x', len: 8, count: 1, occ: [{ id: k, kind: 'text', where: '' }] })) };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result });
  p.$('#scan').click(); await sleep(60);
  for (let k = 0; k < 2; k++) { p.d.querySelectorAll('#list .ignore-btn')[k].click(); await sleep(60); }
  t('206 learn: two Ignores learn nothing yet', p.$('#learnNote').hidden && !(p.store.learn.rules || []).length);
  p.d.querySelectorAll('#list .ignore-btn')[2].click(); await sleep(80);
  t('206 learn: the third similar Ignore learns a rule and says so', !p.$('#learnNote').hidden && /codes like/.test(p.$('#learnText').textContent) && p.store.learn.rules.length === 1, p.$('#learnText').textContent);
  t('206 learn: the ignore list itself is unchanged in format (exact terms per site)', JSON.stringify(p.store.ignore.sites['shop.example.com']) === '["SKU-1001","SKU-1002","SKU-1003"]');
  const last = p.sent.filter((m) => m.type === 'scan').pop();
  t('206 learn: the next check sends the learned rule to the page', last.learned.length === 1 && last.learned[0].type === 'shape' && last.learned[0].value === 'code');
  t('206 learn: the rule is listed in settings with Remove', /codes like/.test(p.$('#learnedList').textContent) && !!p.$('#learnedList button'));
  p.$('#learnUndo').click(); await sleep(80);
  t('206 learn: Undo removes the rule and it is not learned again', p.$('#learnNote').hidden && !p.store.learn.rules.length && p.store.learn.rejected.length === 1 && !p.sent.filter((m) => m.type === 'scan').pop().learned.length);
  p.$('#learn').checked = false; p.$('#learn').dispatchEvent(new p.w.Event('change')); await sleep(20);
  t('206 learn: can be switched off', p.store.learn.on === false && /Learning is off/.test(p.$('#learnedList').textContent));
  p.$('#expIgnore').click(); await sleep(30);
  const exp = JSON.parse(await readBlob(p.w, p.downloads.filter((d) => d.size).pop()));
  t('206 learn: ignore-list export is version 2 and still has global/sites', exp.version === 2 && Array.isArray(exp.global) && exp.sites['shop.example.com'].length === 3 && Array.isArray(exp.learned));
}
{
  // a learn.js that failed to load must not break the popup: Ignore works exactly as before
  const p = await boot('popup.html', 'https://shop.example.com/x', { learn: false });
  p.$('#scan').click(); await sleep(60);
  p.$('#list .ignore-btn').click(); await sleep(80);
  t('206 learn: without learn.js, Ignore still saves the term and re-checks', JSON.stringify(p.store.ignore.sites['shop.example.com']) === '["Add to cart"]' && p.sent.filter((m) => m.type === 'scan').length === 2);
}

// ---------- reported: CSV of the German "Connectors" page (real scan and export data) ----------
{
  const page = loadNew(fs.readFileSync('test/e2e/site/de-connectors.html', 'utf8'), { url: 'https://knowledge-harvestor.artisanscloud.com/admin/connectors' });
  const res = await page.call({ type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, marked: ['Übersicht'] });
  const ex = await page.call({ type: 'export' });
  const p = await boot('popup.html', ex.url, { result: res, export: ex });
  p.$('#scan').click(); await sleep(60);
  p.$('#expCsv').click(); await sleep(50);
  const csv = (await readBlob(p.w, p.downloads.find((d) => d.size))).replace(/^﻿/, '');
  const lines = csv.split('\r\n');
  const parse = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
  const head = parse(lines[0]), rows = lines.slice(1).map(parse);
  const col = (r, name) => r[head.indexOf(name)];
  const row = (text) => rows.find((r) => col(r, 'text') === text);
  t('csv connectors: no line breaks inside fields (one line per row)', !/\n/.test(csv.replace(/\r\n/g, '')) && lines.length === ex.issues.length + 1, JSON.stringify(csv.slice(0, 300)));
  t('csv connectors: no blank "detected language" (unknown / n/a instead)', rows.every((r) => col(r, 'detected language')), JSON.stringify(rows.map((r) => [col(r, 'text'), col(r, 'detected language')])));
  t('csv connectors: no blank surrounding text', rows.every((r) => col(r, 'surrounding text')), JSON.stringify(rows.map((r) => [col(r, 'text'), col(r, 'surrounding text')])));
  t('csv connectors: "Connectors" lists both locations in context and all locations, separated by " | "', col(row('Connectors'), 'occurrences') === '2' && col(row('Connectors'), 'context').split(' | ').length === 2 && col(row('Connectors'), 'all locations').split(' | ').length === 2, JSON.stringify(row('Connectors')));
  t('csv connectors: "where" names the element (tab, badge, paragraph), not just "text"', col(row('Connectors'), 'where') === 'tab' && col(row('Valid'), 'where') === 'badge' && rows.every((r) => col(r, 'where') !== 'text'), JSON.stringify(rows.map((r) => col(r, 'where'))));
  t('csv connectors: selectors start at #root', rows.every((r) => col(r, 'selector').startsWith('#root')));
  const m = row('Übersicht');
  t('csv connectors: a marked row keeps the models\' reason next to yours', m && /^Marked untranslated by you; models: \S/.test(col(m, 'reason')), m && col(m, 'reason'));
}

// ---------- reported: German "Projekte" list — coverage, legend, ignored rows in the CSV, orange marks on by default ----------
{
  const page = loadNew(fs.readFileSync('test/e2e/site/de-projects.html', 'utf8'), { url: 'https://knowledge-harvestor.artisanscloud.com/admin/projects' });
  const res = await page.call({ type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ignore: ['Wisight'] });
  const ex = await page.call({ type: 'export' });
  const p = await boot('popup.html', ex.url, { result: res, export: ex, store: { opts: { lang: 'de', unsure: false } } });
  t('projects popup: "Mark unclear text" is switched on once for existing settings', p.$('#unsure').checked && p.store.opts.unclearMarks === 2 && p.store.opts.unsure === true, JSON.stringify(p.store.opts));
  p.$('#scan').click(); await sleep(60);
  const cov = p.$('#coverage');
  const s = res.stats;
  t('projects popup: coverage line adds up', !cov.hidden && cov.textContent.startsWith(`${s.scannedN} scanned`) && cov.textContent.includes(`${s.unsureN} unclear`) && cov.textContent.includes(`${s.nameN + s.skipN} ignored`), cov.textContent);
  t('projects popup: legend explains the underlines', /Not translated/.test(p.$('#legend').textContent) && /Unclear/.test(p.$('#legend').textContent) && p.$('#legend .lg.unsure'));
  p.$('#expCsv').click(); await sleep(50);
  const csv = (await readBlob(p.w, p.downloads.find((d) => d.size))).replace(/^﻿/, '');
  const rows = csv.split('\r\n').slice(1);
  t('projects csv: unclear rows are in the export with a reason', rows.some((r) => r.startsWith('"Can’t tell","Smart Service Analytics","Name or title')), rows.filter((r) => /Smart/.test(r)).join('\n'));
  t('projects csv: ignored rows are in the export with a reason', rows.some((r) => r.startsWith('"Ignored","Wisight","Ignored by you (the models read it as unclear')) && rows.some((r) => /^"Ignored","\d\d\.\d\d\.2026","Date or time/.test(r)), rows.filter((r) => r.startsWith('"Ignored"')).slice(0, 3).join('\n'));
  // a decision made on the page (hover card) reaches this window through storage
  p.storageChanged({ marked: { newValue: { global: [], sites: { 'knowledge-harvestor.artisanscloud.com': ['Smart Service Analytics'] } } } });
  p.$('#settingsBtn').click();
  t('projects popup: a decision made on the page shows up in the marked list here', p.$('#markedSite').value === 'Smart Service Analytics', p.$('#markedSite').value);
}

// ---------- 2.0.7: readable counts, plain legend, card setting, tab counts = rows ----------
{
  const css = fs.readFileSync('popup.css', 'utf8');
  const rules = (sel) => css.split('}').filter((r) => r.trim().startsWith(sel)).join('}');
  t('207 css: coverage and legend use theme colours only (readable in light and dark)', !/#[0-9a-f]{3,6}/i.test(rules('.coverage') + rules('.legend')) && /\.coverage b\{color:var\(--ink\)/.test(css), rules('.coverage'));
  t('207 css: no wavy underline or highlight in the popup legend', !/wavy|var\(--mark\)/.test(rules('.legend')));
  const G = { ...RESULT, stats: { ...RESULT.stats, badN: 5, scannedN: 40, skipN: 3 }, issues: [...RESULT.issues, { id: 9, verdict: 'bad', kind: 'text', text: 'Save', count: 3, occ: [{ id: 9 }, { id: 10 }, { id: 11 }], reason: 'Looks like English text', len: 4 }] };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: G });
  t('207 setting: "Card on underlined text" is on by default', p.$('#hoverCard').checked);
  p.$('#scan').click(); await sleep(60);
  t('207 scan: the setting is sent with the check', p.sent.find((m) => m.type === 'scan').hoverCard === true);
  t('207 tabs: the Untranslated count is the number of rows, the same as the navigator', p.$('#tabBad .n').textContent === '3' && p.$('#pos').textContent === '0 / 3' && /5 places/.test(p.$('#tabBad').title), `${p.$('#tabBad .n').textContent} | ${p.$('#pos').textContent} | ${p.$('#tabBad').title}`);
  t('207 legend: a dot and a plain label for each colour', p.d.querySelectorAll('#legend .lg i').length === 2 && /Not translated/.test(p.$('#legend .lg.bad').textContent) && /Unclear/.test(p.$('#legend .lg.unsure').textContent));
  t('207 coverage: bold numbers with a colour dot per category', p.d.querySelectorAll('#coverage b').length >= 5 && p.d.querySelectorAll('#coverage i').length >= 4 && /^40 scanned/.test(p.$('#coverage').textContent), p.$('#coverage').textContent);
  p.$('#hoverCard').checked = false; p.$('#hoverCard').dispatchEvent(new p.w.Event('change')); await sleep(30);
  t('207 setting: switching it off is saved and sent to the page right away', p.store.opts.hoverCard === false && p.sent.some((m) => m.type === 'tc-hovercard' && m.on === false), JSON.stringify(p.sent.slice(-2)));
  t('207 setting: with the card off, the legend points to the row buttons', /buttons on each row/.test(p.$('#legendTip').textContent));
  const p2 = await boot('popup.html', 'https://shop.example.com/x', { store: { opts: { hoverCard: false, unclearMarks: 2 } } });
  t('207 setting: the choice is remembered', p2.$('#hoverCard').checked === false);
}

// ---------- 2.0.7: Ignored tab, Restore ----------
{
  const R = { ...RESULT, ignored: [
    { id: 30, verdict: 'skip', kind: 'text', text: 'Customer Support Hub', reason: 'Ignored by you (the models read it as not translated: Looks like English text)', byUser: true, was: 'bad', count: 1, occ: [{ id: 30 }] },
    { id: 31, verdict: 'skip', kind: 'text', text: 'AB-1001', reason: 'Code, number or ID (letters mixed with digits)', count: 1, occ: [{ id: 31 }] }] };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: R, store: { ignore: { global: [], sites: { 'shop.example.com': ['Customer Support Hub'] } } } });
  p.$('#scan').click(); await sleep(60);
  t('207 ignored: the Ignored tab is shown with one row per ignored text', !p.$('#tabSkip').hidden && p.$('#tabSkip .n').textContent === '2');
  p.$('#tabSkip').click(); await sleep(20);
  const rows = p.d.querySelectorAll('#list li.skip');
  t('207 ignored: rows show the reason', rows.length === 2 && /Ignored by you/.test(rows[0].textContent) && /Code, number or ID/.test(rows[1].textContent));
  t('207 ignored: only what you ignored has Restore', !!rows[0].querySelector('.restore-btn') && !rows[1].querySelector('.restore-btn') && /back to Untranslated/.test(rows[0].querySelector('.restore-btn').title));
  const scans = p.sent.filter((m) => m.type === 'scan').length;
  rows[0].querySelector('.restore-btn').click(); await sleep(80);
  t('207 restore: off the ignore list, and the page is checked again', !(p.store.ignore.sites['shop.example.com'] || []).length && p.sent.filter((m) => m.type === 'scan').length === scans + 1 && !p.sent.filter((m) => m.type === 'scan').pop().ignore.includes('Customer Support Hub'));
  p.$('#tabSkip').click(); p.$('#list li.skip button').click(); await sleep(20);
  t('207 ignored: clicking a row jumps to it on the page', p.sent.some((m) => m.type === 'focus' && m.id === 30));
}
{
  // Bug: 99% with 0 untranslated. Untranslated text you accepted is named next to the score, and the chip opens the Ignored tab.
  const R = { ...RESULT, score: 99, stats: { ...RESULT.stats, badN: 0, unsureN: 0, acceptedN: 1 }, issues: [],
    ignored: [{ id: 40, verdict: 'skip', kind: 'text', text: 'Customer Support Hub', reason: 'Ignored by you', byUser: true, count: 1, occ: [{ id: 40 }] }] };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: R });
  p.$('#scan').click(); await sleep(60);
  const c = p.$('#chips .chip.accepted');
  t('accepted chip: 99% with 0 untranslated says why', p.$('#score').textContent === '99%' && p.$('#nBad').textContent === '0' && c && /1 accepted untranslated/.test(c.textContent) && /still count as not translated/.test(c.title), chipsText(p));
  c.click(); await sleep(20);
  t('accepted chip: click opens the Ignored tab', p.$('#tabSkip').getAttribute('aria-selected') === 'true' && /Customer Support Hub/.test(p.$('#list').textContent));
  const q = await boot('popup.html', 'https://shop.example.com/x', { result: { ...RESULT, score: 100, stats: { ...RESULT.stats, badN: 0 } } });
  q.$('#scan').click(); await sleep(60);
  t('accepted chip: not shown when nothing was accepted', !q.$('#chips .chip.accepted'));
}
{
  // reported: a Hindi page with English project names said "Mostly English — the page's own language. Wrong target?"
  const issues = Array.from({ length: 8 }, (_, k) => ({ id: 200 + k, verdict: 'bad', kind: 'text', text: 'Riverside Cold-Chain Hub Migration ' + k, detected: 'en', reason: 'Looks like English text', len: 30 }));
  const hiPage = { ...RESULT, lang: 'hi', requested: 'hi', pageLang: 'en', score: 48, stats: { ...RESULT.stats, ok: 300, bad: 240, okN: 29, badN: 16, unconfirmedN: 2 }, issues };
  const p = await boot('popup.html', 'https://shop.example.com/x', { result: hiPage });
  p.$('#scan').click(); await sleep(60);
  t('banner: not shown when most of the checked text is in the target, even if the warnings are mostly English', p.$('#mismatch').hidden, p.$('#mismatchText').textContent);
  t('score: the tooltip says how it is worked out', /by length: translated ÷ \(translated \+ not translated\)/.test(p.$('#score').title), p.$('#score').title);
  const c = p.$('#chips .chip.accepted');
  t('unconfirmed chip: hidden warnings are counted, and the chip opens the Ignored tab', c && /2 unconfirmed hidden/.test(c.textContent), chipsText(p));
  const q = await boot('popup.html', 'https://shop.example.com/x', { result: { ...hiPage, stats: { ...hiPage.stats, ok: 100 } } });
  q.$('#scan').click(); await sleep(60);
  t('banner: shown when the other language outweighs the target', !q.$('#mismatch').hidden && /Mostly English \(71% of the text\) — the page’s own language/.test(q.$('#mismatchText').textContent), q.$('#mismatchText').textContent);
}
console.log(`\npopup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
