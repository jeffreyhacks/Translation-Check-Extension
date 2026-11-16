import { JSDOM } from 'jsdom';
import fs from 'fs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULT = {
  lang: 'es', requested: 'auto', mode: 'balanced', host: 'shop.example.com', pageLang: 'es', score: 67, live: true,
  source: { status: 'used', lang: 'en' }, models: { cld3: 'wasm', franc: 'ready' },
  stats: { ok: 200, bad: 100, unsure: 10, bug: 20, fmt: 0, okN: 20, badN: 2, unsureN: 1, bugN: 1, fmtN: 0, assumedN: 3, ignoredN: 4 },
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

async function boot(file = 'popup.html', tabUrl = 'https://shop.example.com/x') {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://abc/' + file });
  const w = dom.window;
  const store = {}, sent = [], reg = [], downloads = [], updates = [], clip = [], perms = [], runtimeSent = [];
  let msgL, fetchOk = true;
  w.chrome = {
    i18n: { getUILanguage: () => 'en-US' },
    storage: { local: { get: async () => store, set: async (o) => Object.assign(store, o) } },
    tabs: { query: async () => [{ id: 5, url: tabUrl }], update: async (id, o) => updates.push([id, o]),
      sendMessage: async (id, m) => { sent.push(m); return m.type === 'scan' ? RESULT : m.type === 'status' ? { result: null } : m.type === 'export' ? { url: tabUrl, title: 'Shop', lang: 'es', generated: 'now', issues: RESULT.issues.map((i) => ({ ...i, selector: 'main > p:nth-of-type(2)' })) } : { ok: true }; },
      onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
    scripting: { executeScript: async () => {}, registerContentScripts: async (a) => reg.push(...a), unregisterContentScripts: async () => {} },
    permissions: { request: async (o) => { perms.push(o); return true; }, remove: async () => true },
    runtime: { onMessage: { addListener: (f) => (msgL = f) }, getURL: (p) => 'chrome-extension://abc/' + p, sendMessage: async (m) => { runtimeSent.push(m); return {}; } },
    sidePanel: { open: async () => {} },
  };
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
  w.fetch = async () => (fetchOk ? { ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer } : { ok: false, status: 403 });
  w.eval(fs.readFileSync('popup.js', 'utf8'));
  await sleep(50);
  return { w, d: w.document, store, sent, reg, downloads, updates, clip, perms, pdfCalls, runtimeSent, failFetch: () => (fetchOk = false), msg: (m, s) => msgL(m, s), $: (s) => w.document.querySelector(s) };
}
const readBlob = (w, blob, as = 'text') => new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(r.result); if (as === 'text') r.readAsText(blob); else r.readAsArrayBuffer(blob); });
const chipsText = (p) => [...p.d.querySelectorAll('#chips .chip')].map((c) => c.textContent).join(' | ');

{
  const p = await boot();
  t('popup: language picker populated, defaulting to the page\'s own language', p.$('#lang').options.length >= 40 && p.$('#lang').value === 'auto' && p.$('#lang').options[0].value === 'auto');
  const label = (c) => [...p.$('#lang').options].find((o) => o.value === c)?.textContent;
  t('popup: English name comes first ("German (Deutsch)")', label('de') === 'German (Deutsch)' && label('es') === 'Spanish (español)' && label('ja').startsWith('Japanese ('), `${label('de')} | ${label('es')}`);
  t('popup: minimal by default — settings drawer is collapsed', p.$('#settings').hidden && p.$('#result').hidden);
  p.$('#settingsBtn').click();
  t('popup: gear opens the settings drawer', !p.$('#settings').hidden && p.$('#settingsBtn').getAttribute('aria-expanded') === 'true');
  t('popup: drawer has strictness segments and the new model switches', p.d.querySelectorAll('input[name=mode]').length === 3 && p.$('#verify').checked && !p.$('#confirmed').checked);
  t('popup: side-panel button shown in popup', p.$('#openPanel').hidden === false);
  t('popup: button says "Check page" on web pages', p.$('#scanLabel').textContent === 'Check page');
  p.$('#scan').click(); await sleep(50);
  t('popup: scan shows result', !p.$('#result').hidden && p.$('#score').textContent === '67%' && p.$('#arc').getAttribute('stroke-dasharray') === '67 100');
  const scanMsg = p.sent.find((m) => m.type === 'scan');
  t('popup: scan sends every option incl. model verification', scanMsg && scanMsg.lang === 'auto' && scanMsg.live === true && scanMsg.source === true && scanMsg.hints === false && scanMsg.related === true && scanMsg.verify === true && scanMsg.confirmedOnly === false && scanMsg.mode === 'balanced', JSON.stringify(scanMsg));
  t('popup: stats and tab counts', p.$('#nBad').textContent === '2' && p.$('#tabBad .n').textContent === '2' && p.$('#tabUnsure .n').textContent === '1' && !p.$('#tabBug').hidden && p.$('#tabFmt').hidden);
  const ct = chipsText(p);
  t('popup: info is shown as compact chips, not sentences', /es/.test(ct) && /3 models/.test(ct) && /live/.test(ct) && /en/.test(ct) && /4/.test(ct) && /3 assumed/.test(ct), ct);
  t('popup: page text is shown as text, never as HTML', !p.$('#list img') && /<img src=x/.test(p.$('#list').textContent));
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
  t('popup: auto-check registers the content script for this site only', p.reg.length === 1 && p.reg[0].matches[0] === '*://shop.example.com/*' && p.store.autoSites.includes('shop.example.com'));
  p.$('#auto').click(); await sleep(50);
  t('popup: auto-check can be switched off', !p.store.autoSites.includes('shop.example.com'));
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 50 } }, { tab: { id: 5 } });
  t('popup: live update from the page refreshes the view', p.$('#score').textContent === '50%');
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 10 } }, { tab: { id: 99 } });
  t('popup: updates from other tabs are ignored', p.$('#score').textContent === '50%');
  const wrong = { ...RESULT, lang: 'en', requested: 'en', pageLang: 'de', score: 12, stats: { ...RESULT.stats, badN: 15, okN: 2 },
    issues: Array.from({ length: 15 }, (_, k) => ({ id: 100 + k, verdict: 'bad', kind: 'text', text: 'Beschwerde über fehlerhaftes Gerät ' + k, detected: 'de', reason: 'Detected as another language', len: 34 })) };
  p.msg({ type: 'tc-result', result: wrong }, { tab: { id: 5 } });
  t('popup: short banner appears when the target is probably wrong', !p.$('#mismatch').hidden && /Mostly German/.test(p.$('#mismatchText').textContent) && /page’s own language/.test(p.$('#mismatchText').textContent), p.$('#mismatchText').textContent);
  t('popup: banner offers one-click fix', p.$('#mismatchFix').textContent === 'Check for German');
  p.$('#mismatchFix').click(); await sleep(60);
  t('popup: fix switches the target and re-checks', p.$('#lang').value === 'de' && p.sent.filter((m) => m.type === 'scan').pop().lang === 'de' && p.store.opts.lang === 'de');
  p.$('#clear').click(); await sleep(30);
  t('popup: clear hides results', p.$('#result').hidden);
  p.$('#confirmed').checked = true; p.$('#confirmed').dispatchEvent(new p.w.Event('change')); p.$('#hints').checked = true; p.$('#hints').dispatchEvent(new p.w.Event('change')); await sleep(20);
  t('popup: options are remembered', p.store.opts.hints === true && p.store.opts.confirmedOnly === true && p.store.opts.verify === true);
  const strict = p.d.querySelector('input[name=mode][value=strict]'); strict.checked = true; strict.dispatchEvent(new p.w.Event('change')); await sleep(10);
  t('popup: strictness segment is saved', p.store.opts.mode === 'strict');
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
  const f = await boot('popup.html', 'file:///C:/docs/local.pdf');
  f.failFetch(); f.$('#scan').click(); await sleep(80);
  t('pdf popup: local files explain the file-access switch', /Allow access to file URLs/.test(f.$('#status').textContent), f.$('#status').textContent);
}
{
  const p = await boot('panel.html');
  t('panel: loads in side-panel mode (no side-panel button)', p.$('#openPanel').hidden === true && p.d.body.classList.contains('panel'));
}
console.log(`\npopup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
