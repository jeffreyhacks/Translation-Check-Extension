import { JSDOM } from 'jsdom';
import fs from 'fs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULT = {
  lang: 'es', mode: 'balanced', host: 'shop.example.com', pageLang: 'es', score: 67, live: true,
  source: { status: 'used', lang: 'en' },
  stats: { ok: 200, bad: 100, unsure: 10, bug: 20, fmt: 0, okN: 20, badN: 2, unsureN: 1, bugN: 1, fmtN: 0, assumedN: 3, ignoredN: 4 },
  issues: [
    { id: 1, verdict: 'bug', kind: 'text', text: 'checkout.button.save', reason: 'Looks like a translation key', len: 20 },
    { id: 2, verdict: 'bad', kind: 'text', text: 'Add to cart', detected: 'en', reason: 'Looks like English text', len: 11 },
    { id: 3, verdict: 'bad', kind: 'attr', attr: 'placeholder', text: '<img src=x onerror=alert(1)>Enter your email address here so that we can send you the confirmation', detected: 'en', reason: 'Detected as another language', len: 30 },
    { id: 4, verdict: 'unsure', kind: 'text', text: 'Lorem ipsum', reason: undefined, len: 11 },
  ],
};

async function boot(file = 'popup.html') {
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://abc/' + file });
  const w = dom.window;
  const store = {}, sent = [], reg = [], downloads = [];
  let msgL;
  w.chrome = {
    i18n: { getUILanguage: () => 'en-US' },
    storage: { local: { get: async () => store, set: async (o) => Object.assign(store, o) } },
    tabs: { query: async () => [{ id: 5, url: 'https://shop.example.com/x' }], sendMessage: async (id, m) => { sent.push(m); return m.type === 'scan' ? RESULT : m.type === 'status' ? { result: null } : m.type === 'export' ? { url: 'https://shop.example.com/x', title: 'Shop', lang: 'es', generated: 'now', issues: RESULT.issues.map((i) => ({ ...i, selector: 'main > p:nth-of-type(2)' })) } : { ok: true }; },
      onActivated: { addListener() {} }, onUpdated: { addListener() {} } },
    scripting: { executeScript: async () => {}, registerContentScripts: async (a) => reg.push(...a), unregisterContentScripts: async () => {} },
    permissions: { request: async () => true, remove: async () => true },
    runtime: { onMessage: { addListener: (f) => (msgL = f) } },
    sidePanel: { open: async () => {} },
  };
  w.URL.createObjectURL = (b) => { downloads.push(b); return 'blob:x'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download }); };
  w.Element.prototype.scrollIntoView = function () {};
  w.eval(fs.readFileSync('popup.js', 'utf8'));
  await sleep(50);
  return { w, d: w.document, store, sent, reg, downloads, msg: (m, s) => msgL(m, s), $: (s) => w.document.querySelector(s) };
}

{
  const p = await boot();
  t('popup: language picker populated', p.$('#lang').options.length >= 39 && p.$('#lang').value === 'en');
  t('popup: side-panel button shown in popup', p.$('#openPanel').hidden === false);
  t('popup: result hidden before a check', p.$('#result').hidden);
  p.$('#scan').click(); await sleep(50);
  t('popup: scan shows result', !p.$('#result').hidden && p.$('#score').textContent === '67%');
  const scanMsg = p.sent.find((m) => m.type === 'scan');
  t('popup: scan sends every option', scanMsg && scanMsg.lang === 'en' && scanMsg.live === true && scanMsg.source === true && scanMsg.hints === false && scanMsg.related === true, JSON.stringify(scanMsg));
  t('popup: tab counts', p.$('#tabBad .n').textContent === '2' && p.$('#tabUnsure .n').textContent === '1' && !p.$('#tabBug').hidden && p.$('#tabFmt').hidden);
  t('popup: meta mentions source, skipped, assumed, live', /Compared with the en/.test(p.$('#meta').textContent) && /4 numbers/.test(p.$('#meta').textContent) && /3 unclear/.test(p.$('#meta').textContent) && /live/i.test(p.$('#meta').textContent));
  t('popup: page text is shown as text, never as HTML', !p.$('#list img') && /<img src=x/.test(p.$('#list').textContent));
  p.$('#next').click(); await sleep(10);
  t('popup: next focuses the first issue', p.sent.some((m) => m.type === 'focus' && m.id === 2) && p.$('#pos').textContent === '1 / 2');
  p.$('#next').click(); p.$('#next').click(); await sleep(10);
  t('popup: next wraps around', p.$('#pos').textContent === '1 / 2');
  p.$('#prev').click(); await sleep(10);
  t('popup: previous goes back', p.$('#pos').textContent === '2 / 2');
  p.$('#tabBug').click();
  t('popup: broken-text tab lists the leaked key', /checkout\.button\.save/.test(p.$('#list').textContent) && !p.$('#list .ignore'));
  p.$('#tabBad').click();
  t('popup: Ignore button only on short strings', p.d.querySelectorAll('#list .ignore').length === 1);
  p.$('#list .ignore').click(); await sleep(80);
  t('popup: Ignore saves to this site\'s list and re-checks', JSON.stringify(p.store.ignore.sites['shop.example.com']) === '["Add to cart"]' && p.$('#ignoreSite').value === 'Add to cart' && p.sent.filter((m) => m.type === 'scan').length === 2);
  t('popup: re-check sends the ignore list', p.sent.filter((m) => m.type === 'scan').pop().ignore.includes('Add to cart'));
  p.$('#expCsv').click(); await sleep(50);
  const blob = p.downloads.find((d) => d instanceof p.w.Blob);
  const csv = blob && await blob.text();
  const bytes = blob && new Uint8Array(await blob.arrayBuffer());
  t('popup: CSV has a UTF-8 BOM so Excel reads accents', bytes && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF);
  t('popup: CSV export has header, selector and broken-text rows', csv && csv.startsWith('"type"') && /main > p:nth-of-type\(2\)/.test(csv) && /"Broken text"/.test(csv), csv && csv.slice(0, 120));
  p.downloads.length = 0;
  p.$('#expHtml').click(); await sleep(50);
  const html = await p.downloads.find((d) => d instanceof p.w.Blob).text();
  t('popup: HTML report escapes page text', !/<img src=x/.test(html) && /&lt;img src=x/.test(html));
  p.$('#auto').click(); await sleep(50);
  t('popup: auto-check registers the content script for this site only', p.reg.length === 1 && p.reg[0].matches[0] === '*://shop.example.com/*' && p.store.autoSites.includes('shop.example.com'));
  p.$('#auto').click(); await sleep(50);
  t('popup: auto-check can be switched off', !p.store.autoSites.includes('shop.example.com'));
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 50 } }, { tab: { id: 5 } });
  t('popup: live update from the page refreshes the view', p.$('#score').textContent === '50%');
  p.msg({ type: 'tc-result', result: { ...RESULT, score: 10 } }, { tab: { id: 99 } });
  t('popup: updates from other tabs are ignored', p.$('#score').textContent === '50%');
  p.$('#clear').click(); await sleep(30);
  t('popup: clear hides results', p.$('#result').hidden);
  p.$('#hints').checked = true; p.$('#hints').dispatchEvent(new p.w.Event('change')); await sleep(20);
  t('popup: options are remembered', p.store.opts.hints === true);
}
{
  const p = await boot('panel.html');
  t('panel: loads in side-panel mode (no side-panel button)', p.$('#openPanel').hidden === true && p.d.body.classList.contains('panel'));
}
console.log(`\npopup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
