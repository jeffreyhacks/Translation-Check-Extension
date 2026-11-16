const api = globalThis.browser ?? chrome;
const $ = (s) => document.querySelector(s);
const IS_PANEL = document.body.classList.contains('panel');
const LANGS = 'en es fr de it pt nl sv da no fi pl cs sk hu ro bg hr el tr ru uk ar fa he ur hi bn ta te th vi id ms sw ja ko zh ca'.split(' ');
const VIEWS = { bad: '#tabBad', unsure: '#tabUnsure', bug: '#tabBug', fmt: '#tabFmt' };
const english = new Intl.DisplayNames(['en'], { type: 'language' });
const nameOf = (c) => { try { return english.of(c) || c; } catch { return c; } };
const isPdfUrl = (u) => /\.pdf([?#]|$)/i.test(u || '');

// Small inline icons (constants, never page text)
const ICON = {
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg>',
  check: '<svg class="check" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
};

let tabId = null, tabUrl = '', host = '', isPdf = false, result = null, view = 'bad', cursor = -1;
let ign = { global: [], sites: {} }, autoSites = [];

// ---------- Language picker: "Page's own language", then English name first, e.g. "German (Deutsch)" ----------
{
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Page’s own language';
  $('#lang').append(auto);
}
for (const c of LANGS.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
  let native = nameOf(c);
  try { native = new Intl.DisplayNames([c], { type: 'language' }).of(c) || native; } catch {}
  const o = document.createElement('option');
  o.value = c;
  o.textContent = native.toLowerCase() === nameOf(c).toLowerCase() ? nameOf(c) : `${nameOf(c)} (${native})`;
  $('#lang').append(o);
}

function setStatus(msg, err = false) { $('#status').textContent = msg; $('#status').className = err ? 'err' : ''; }
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const mode = () => document.querySelector('input[name=mode]:checked')?.value || 'balanced';
const storable = () => ({ lang: $('#lang').value, mode: mode(), attrs: $('#attrs').checked, unsure: $('#unsure').checked, related: $('#related').checked,
  verify: $('#verify').checked, confirmedOnly: $('#confirmed').checked, live: $('#live').checked, source: $('#source').checked, hints: $('#hints').checked });
const options = () => ({ ...storable(), ignore: [...ign.global, ...(ign.sites[host] || [])] });
const save = () => api.storage.local.set({ opts: storable(), ignore: ign, autoSites });
const send = (msg) => api.tabs.sendMessage(tabId, msg);
const ensureInjected = () => api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

// ---------- Rendering ----------
const rowsNow = () => (result ? result.issues.filter((i) => i.verdict === view) : []);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function chip(icon, text, title, cls = '') {
  const c = el('span', 'chip ' + cls);
  if (icon) c.insertAdjacentHTML('afterbegin', icon);
  c.append(el('span', '', text));
  if (title) c.title = title;
  return c;
}

function likelyWrongTarget() {
  if (!result || result.score == null || result.score > 50 || result.stats.badN < 3) return null;
  const tally = {};
  let total = 0;
  for (const i of result.issues) if (i.verdict === 'bad' && /^[a-z]{2,3}$/.test(i.detected || '')) { tally[i.detected] = (tally[i.detected] || 0) + i.len; total += i.len; }
  const [top, w] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [];
  return top && w / total >= 0.7 && top !== result.lang && LANGS.includes(top) ? top : null;
}

function renderChips() {
  const box = $('#chips');
  box.replaceChildren();
  const { stats } = result, src = result.source || {};
  box.append(chip(ICON.globe, nameOf(result.lang), `Checked for ${nameOf(result.lang)}${result.requested === 'auto' ? ' (the page’s own language)' : ''}`));
  if (result.kind === 'pdf') box.append(chip(ICON.doc, `PDF · ${src.pages} p.`, 'PDF document'));
  const m = result.models;
  if (m && $('#verify').checked) {
    const n = 2 + (m.cld3 && m.cld3 !== 'off' ? 1 : 0);
    box.append(chip(ICON.shield, `${n} models`, `Warnings double-checked by tinyld${m.cld3 === 'wasm' ? ', CLD3' : m.cld3 === 'chrome' ? ', Chrome’s CLD' : ''} and franc`));
  }
  if (result.live) box.append(chip('', 'Live', 'Updating as the page changes', 'live'));
  if (src.status === 'used') box.append(chip(ICON.link, `Source: ${src.lang && src.lang !== 'x-default' ? nameOf(src.lang.split('-')[0]) : 'default'}`, 'Compared with the source-language version of this page'));
  if (stats.ignoredN) box.append(chip(ICON.skip, `${stats.ignoredN} skipped`, `${stats.ignoredN} numbers, times, codes, names and language names skipped`));
  if (stats.nameN) box.append(chip(ICON.user, `${stats.nameN} ${stats.nameN === 1 ? 'name' : 'names'}`, 'People, places and brands read the same in every language, so they were left alone'));
  if (stats.assumedN) box.append(chip('', `${stats.assumedN} assumed`, 'Unclear short strings assumed translated because the rest of the page is'));
}

function render() {
  if (!result) { $('#result').hidden = true; return; }
  $('#result').hidden = false;
  const { stats, score } = result;
  $('#score').textContent = score == null ? '–' : score + '%';
  const arc = $('#arc');
  arc.setAttribute('stroke-dasharray', `${score ?? 0} 100`);
  arc.style.stroke = score == null ? 'var(--track)' : score >= 90 ? 'var(--ok)' : score >= 60 ? '#e0a100' : 'var(--bad)';
  $('#nOk').textContent = stats.okN;
  $('#nBad').textContent = stats.badN;
  $('#nUnsure').textContent = stats.unsureN;
  renderChips();

  const fix = likelyWrongTarget();
  $('#mismatch').hidden = !fix;
  if (fix) {
    const declared = (result.pageLang || '').toLowerCase().split('-')[0] === fix;
    $('#mismatchText').textContent = `Mostly ${nameOf(fix)}${declared ? ' — the page’s own language' : ''}. Wrong target?`;
    $('#mismatchFix').textContent = `Check for ${nameOf(fix)}`;
    $('#mismatchFix').onclick = () => { setLang(fix); save().then(() => runScan()); };
  }

  const counts = { bad: stats.badN, unsure: stats.unsureN, bug: stats.bugN, fmt: stats.fmtN };
  $('#tabBug').hidden = !stats.bugN;
  $('#tabFmt').hidden = !$('#hints').checked && !stats.fmtN;
  if ($(VIEWS[view]).hidden) view = 'bad';
  for (const [k, sel] of Object.entries(VIEWS)) {
    $(sel).setAttribute('aria-selected', k === view);
    $(sel).querySelector('.n').textContent = counts[k] || 0;
  }

  const list = $('#list');
  list.replaceChildren();
  const rows = rowsNow();
  if (cursor >= rows.length) cursor = -1;
  $('#pos').textContent = `${cursor + 1} / ${rows.length}`;
  $('#prev').disabled = $('#next').disabled = !rows.length;
  if (!rows.length) {
    list.append(el('li', 'empty', { bad: 'Nothing untranslated 🎉', unsure: 'Nothing unclear', bug: 'No broken text', fmt: 'No format hints' }[view]));
    return;
  }
  rows.forEach((i, idx) => {
    const li = el('li', i.verdict + (idx === cursor ? ' current' : ''));
    const b = el('button');
    b.append(el('span', 'snippet', i.text)); // page text is always inserted as text, never HTML
    const meta = el('span', 'meta');
    const det = i.detected && i.detected.length <= 3 ? nameOf(i.detected) : i.detected;
    if (det) meta.append(el('span', 'tag', det));
    if (i.kind === 'pdf') meta.append(el('span', 'tag', `p.${i.page}${i.pages && i.pages.length > 1 ? ` +${i.pages.length - 1}` : ''}`));
    if (i.kind === 'attr') meta.append(el('span', 'tag', i.attr));
    if (i.votes) { // how the three models voted: red = other language, green = target, grey = abstained
      const agreeBox = el('span', 'agree');
      const pips = el('span', 'pips' + (i.confirmed ? ' confirmed' : ''));
      pips.title = `tinyld: ${i.votes.tinyld} · CLD3: ${i.votes.cld3} · franc: ${i.votes.franc}`;
      for (const k of ['tinyld', 'cld3', 'franc']) pips.append(el('i', 'pip ' + i.votes[k]));
      if (i.confirmed) pips.insertAdjacentHTML('beforeend', ICON.check);
      const n = ['tinyld', 'cld3', 'franc'].filter((k) => i.votes[k] === 'other').length;
      agreeBox.append(pips, el('span', '', `${n}/3`));
      agreeBox.style.marginLeft = 'auto';
      meta.append(agreeBox);
    }
    b.append(meta);
    if (i.reason) b.append(el('span', 'why', i.reason));
    b.title = i.reason || 'Too short or ambiguous to judge';
    b.addEventListener('click', () => { cursor = idx; focusRow(i); render(); });
    li.append(b);
    if ((i.verdict === 'bad' || i.verdict === 'unsure') && i.text.length <= 60) { // one-click "never flag this"
      const x = el('button', 'ignore-btn', 'Ignore');
      x.title = 'Never flag this text';
      x.addEventListener('click', () => addIgnore(i.text));
      li.append(x);
    }
    list.append(li);
  });
}

async function focusRow(i) {
  if (result.kind === 'pdf') { // jump to the page in the browser's PDF viewer and copy the snippet for Ctrl+F
    try { await api.tabs.update(tabId, { url: `${tabUrl.split('#')[0]}#page=${i.page}` }); } catch {}
    try { await navigator.clipboard.writeText(i.text.slice(0, 80)); setStatus(`Page ${i.page} · snippet copied, press Ctrl+F to find it`); } catch { setStatus(`Page ${i.page}`); }
    return;
  }
  return send({ type: 'focus', id: i.id }).catch(() => setStatus('Page changed — check again.', true));
}
function step(d) {
  const rows = rowsNow();
  if (!rows.length) return;
  cursor = (cursor + d + rows.length) % rows.length;
  focusRow(rows[cursor]);
  render();
  $('#list .current')?.scrollIntoView({ block: 'nearest' });
}
for (const [k, sel] of Object.entries(VIEWS)) $(sel).onclick = () => { view = k; cursor = -1; render(); };
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);

// ---------- Searchable language picker ----------
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); // "espanol" finds "español"
const picker = (() => {
  const input = $('#langInput'), list = $('#langList'), sel = $('#lang');
  const items = [...sel.options].map((o) => ({ value: o.value, label: o.textContent, hay: fold(`${o.textContent} ${o.value}${o.value === 'auto' ? ' auto page own declared' : ''}`) }));
  let shown = [], active = -1, open = false;
  const sync = () => { input.value = items.find((i) => i.value === sel.value)?.label || ''; };
  function filter(q) {
    const toks = fold(q).split(/\s+/).filter(Boolean);
    if (!toks.length) return items;
    const rank = (it) => { const l = fold(it.label); return l.startsWith(toks[0]) ? 0 : l.split(/[\s(]+/).some((w) => w.startsWith(toks[0])) ? 1 : 2; };
    return items.filter((it) => toks.every((t) => it.hay.includes(t))).sort((a, b) => rank(a) - rank(b));
  }
  function setActive(i) {
    active = i;
    [...list.children].forEach((li, k) => li.classList.toggle('active', k === i));
    const cur = list.children[i];
    if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }
  function draw(q) {
    shown = filter(q);
    list.replaceChildren();
    if (!shown.length) { list.append(el('li', 'none', 'No matching language')); setActive(-1); return; }
    shown.forEach((it, i) => {
      const li = el('li', '', it.label);
      li.id = 'lang-opt-' + i; li.dataset.value = it.value;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(it.value === sel.value));
      list.append(li);
    });
    setActive(q.trim() ? 0 : Math.max(shown.findIndex((it) => it.value === sel.value), 0));
  }
  function show() { if (open) return; open = true; list.hidden = false; input.setAttribute('aria-expanded', 'true'); document.body.classList.add('picking'); draw(''); }
  function hide() { if (!open) return; open = false; list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); document.body.classList.remove('picking'); sync(); }
  function choose(v) { const changed = sel.value !== v; sel.value = v; hide(); if (changed) sel.dispatchEvent(new Event('change')); }
  input.addEventListener('focus', () => { show(); input.select(); });
  input.addEventListener('click', show);
  input.addEventListener('input', () => { show(); draw(input.value); });
  input.addEventListener('blur', hide);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else setActive(Math.min(active + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { if (open && shown[active]) { e.preventDefault(); choose(shown[active].value); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); hide(); } }
    else if (e.key === 'Tab') hide();
  });
  list.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-value]'); if (li) choose(li.dataset.value); });
  $('#langBox .chev').addEventListener('mousedown', (e) => { e.preventDefault(); if (open) hide(); else { input.focus(); show(); } });
  return { sync };
})();
function setLang(v) { $('#lang').value = v; picker.sync(); }

// ---------- Scan (web page or PDF) ----------
const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.append(s); });

async function fetchPdf(url) {
  const get = async () => { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
  try { return await get(); } catch (e) {
    if (/^file:/.test(url)) throw new Error('Local PDFs need “Allow access to file URLs” turned on for this extension in chrome://extensions.');
    if (/^https?:/.test(url)) { // ask once for access to this site, then retry
      let granted = false;
      try { granted = await api.permissions.request({ origins: [new URL(url).origin + '/*'] }); } catch {}
      if (granted) { try { return await get(); } catch {} }
    }
    throw new Error('Couldn’t download this PDF (it may need a sign-in or block downloads).');
  }
}

async function runPdf() {
  await loadScript('vendor/pdf.min.js');
  await loadScript('pdfcheck.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdf.worker.min.js');
  const data = await fetchPdf(tabUrl);
  const res = await window.TCPDF.analyzePdf({
    pdfjs: window.pdfjsLib, data, params: options(), send: (m) => api.runtime.sendMessage(m),
    onProgress: (e) => setStatus(e.stage === 'read' ? `Reading page ${e.page} of ${e.pages}…` : 'Checking text…'),
  });
  if (res.error) throw new Error(res.error);
  return res;
}

async function runScan({ keepView = false } = {}) {
  const btn = $('#scan');
  btn.disabled = true;
  setStatus('Checking…');
  try {
    let res;
    if (isPdf) res = await runPdf();
    else { await ensureInjected(); res = await send({ type: 'scan', ...options() }); }
    if (res?.error) throw new Error(res.error);
    result = res; view = keepView ? view : 'bad'; cursor = -1; // after Ignore the person stays on the list they were working in
    setStatus('');
    render();
  } catch (e) {
    result = null; render();
    const m = String(e.message || e);
    setStatus(/Cannot access|extensions gallery|chrome:|activeTab|permission/i.test(m) && !isPdf
      ? (IS_PANEL ? 'Click the toolbar icon on this tab once to allow checking it.' : 'This page can’t be checked (browser or store page).')
      : m, true);
  } finally { btn.disabled = false; }
}
$('#scan').onclick = () => runScan();
$('#clear').onclick = async () => { if (!isPdf) { try { await send({ type: 'clear' }); } catch {} } result = null; render(); setStatus(''); };

// ---------- Settings drawer ----------
const MODE_HINT = { relaxed: 'Assumes unclear text is translated. Fewest warnings.', balanced: 'Assumes very short unclear text is translated when the rest of the page is.', strict: 'Lists everything unclear. Most warnings.' };
const showModeHint = () => { $('#modeHint').textContent = MODE_HINT[mode()]; };
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', showModeHint));
$('#settingsBtn').onclick = () => { const open = $('#settings').hidden; $('#settings').hidden = !open; $('#settingsBtn').setAttribute('aria-expanded', open); };

// ---------- Never-flag lists (this site + all sites), import / export ----------
async function addIgnore(term) {
  const list = host ? (ign.sites[host] = ign.sites[host] || []) : ign.global;
  if (!list.some((x) => x.toLowerCase() === term.toLowerCase())) list.push(term);
  syncIgnoreBoxes();
  await save();
  runScan({ keepView: true });
}
function syncIgnoreBoxes() {
  $('#ignoreGlobal').value = ign.global.join('\n');
  $('#ignoreSite').value = (ign.sites[host] || []).join('\n');
}
$('#ignoreGlobal').addEventListener('change', () => { ign.global = lines($('#ignoreGlobal').value); save(); });
$('#ignoreSite').addEventListener('change', () => { if (host) { ign.sites[host] = lines($('#ignoreSite').value); save(); } });

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('#expIgnore').onclick = () => download('translation-check-ignore-list.json', 'application/json', JSON.stringify({ version: 1, ...ign }, null, 2));
$('#impIgnore').onclick = () => $('#impFile').click();
$('#impFile').addEventListener('change', async () => {
  try {
    const d = JSON.parse(await $('#impFile').files[0].text());
    const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
    ign.global = [...new Set([...ign.global, ...clean(d.global)])];
    for (const [h, l] of Object.entries(d.sites || {})) ign.sites[h] = [...new Set([...(ign.sites[h] || []), ...clean(l)])];
    syncIgnoreBoxes(); await save(); setStatus('Ignore list imported.');
  } catch { setStatus('That file isn’t a valid ignore list.', true); }
  $('#impFile').value = '';
});

// ---------- Export (CSV / HTML report) ----------
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { bad: 'Not translated', unsure: 'Can’t tell', bug: 'Broken text', fmt: 'Format hint' };
const where = (i) => (i.kind === 'pdf' ? `page ${i.pages && i.pages.length > 1 ? i.pages.join(', ') : i.page}` : i.kind === 'attr' ? i.attr + ' attribute' : 'text');
const agree = (i) => (i.votes ? `${['tinyld', 'cld3', 'franc'].filter((k) => i.votes[k] === 'other').length}/3 models${i.confirmed ? ' (confirmed)' : ''}` : '');

async function getExport() {
  const d = result && result.kind === 'pdf'
    ? { url: tabUrl, title: 'PDF document', lang: result.lang, generated: new Date().toISOString(), issues: result.allIssues.map((i) => ({ ...i, selector: '' })) }
    : await send({ type: 'export' });
  if (!d || !d.issues.length) throw new Error('Nothing to export yet — run a check first.');
  return d;
}
$('#expCsv').onclick = async () => {
  try {
    const d = await getExport();
    const head = ['type', 'text', 'reason', 'detected language', 'model agreement', 'where', 'selector', 'document'];
    const rows = d.issues.map((i) => [LABEL[i.verdict], i.text, i.reason, i.detected, agree(i), where(i), i.selector, d.url]);
    download('translation-issues.csv', 'text/csv', '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  } catch (e) { setStatus(e.message, true); }
};
$('#expHtml').onclick = async () => {
  try {
    const d = await getExport();
    const rows = d.issues.map((i) => `<tr><td>${esc(LABEL[i.verdict])}</td><td>${esc(i.text)}</td><td>${esc(i.reason)}${i.detected ? ' (' + esc(i.detected) + ')' : ''} ${esc(agree(i))}</td><td>${esc(where(i))}${i.selector ? '<br><code>' + esc(i.selector) + '</code>' : ''}</td></tr>`).join('');
    download('translation-report.html', 'text/html', `<!doctype html><meta charset="utf-8"><title>Translation report</title>
<style>body{font:14px system-ui;margin:24px;color:#14213d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dde3ec;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f4f9}code{font-size:12px}</style>
<h1>Translation report</h1><p><a href="${esc(d.url)}">${esc(d.title || d.url)}</a><br>Target language: <b>${esc(d.lang)}</b> · ${esc(d.generated)} · ${d.issues.length} issue(s)</p>
<table><tr><th>Type</th><th>Text</th><th>Why</th><th>Where</th></tr>${rows}</table>`);
  } catch (e) { setStatus(e.message, true); }
};

// ---------- Auto-check a site (optional permission requested only for that site) ----------
// Chrome's permission prompt can close this popup, so the choice is saved first and the background worker registers the page script
// once the permission arrives. Only origins that the manifest lists as optional can be requested: one per scheme, never "*://".
const hostOrigins = (schemes) => schemes.map((sc) => `${sc}://${host}/*`);
$('#auto').addEventListener('change', async (e) => {
  const on = e.target.checked, before = [...autoSites];
  try {
    if (on) {
      const scheme = tabUrl.split(':')[0];
      if (!host || !/^https?$/.test(scheme)) throw new Error('this page type can’t be checked automatically');
      autoSites = [...new Set([...autoSites, host])];
      await save();
      if (!(await api.permissions.request({ origins: hostOrigins([scheme]) }))) { autoSites = before; await save(); e.target.checked = false; return; }
    } else {
      autoSites = autoSites.filter((h) => h !== host);
      await save();
      for (const o of hostOrigins(['http', 'https'])) { try { await api.permissions.remove({ origins: [o] }); } catch {} }
    }
    try { await api.runtime.sendMessage({ type: 'tc-sync-auto' }); } catch {}
  } catch (err) {
    autoSites = before; try { await save(); } catch {}
    e.target.checked = !on; setStatus('Could not change auto-check: ' + (err.message || err), true);
  }
});

for (const id of ['lang', 'attrs', 'unsure', 'related', 'verify', 'confirmed', 'live', 'source', 'hints']) $('#' + id).addEventListener('change', save);
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', save));
$('#hints').addEventListener('change', render);
$('#verify').addEventListener('change', render);

// ---------- Tabs, side panel, live updates ----------
async function refreshTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id; tabUrl = tab?.url || '';
  try { host = new URL(tabUrl).hostname; } catch { host = ''; }
  isPdf = isPdfUrl(tabUrl);
  $('#scanLabel').textContent = isPdf ? 'Check PDF' : 'Check page';
  $('#scanIcon').innerHTML = isPdf ? '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.8"/>' : '<path d="M7 5l12 7-12 7z"/>';
  $('#hostName').textContent = host || 'site';
  $('#auto').disabled = !/^https?:/.test(tabUrl) || isPdf;
  let allowed = true;
  try { if (/^https?:/.test(tabUrl)) allowed = await api.permissions.contains({ origins: hostOrigins([tabUrl.split(':')[0]]) }); } catch {}
  $('#auto').checked = !!host && autoSites.includes(host) && allowed;
  $('#ignoreSite').disabled = !host;
  syncIgnoreBoxes();
  result = null; cursor = -1; render();
  if (isPdf) return; // PDFs are checked on demand
  try { // restore results if this page was already checked
    const s = await send({ type: 'status' });
    if (s?.result) { result = s.result; setLang(result.requested || result.lang); render(); }
  } catch {}
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'tc-result' && sender.tab?.id === tabId) { result = msg.result; render(); }
});
if (IS_PANEL) {
  api.tabs.onActivated.addListener(() => refreshTab());
  api.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'loading') { result = null; render(); } });
}
if (api.sidePanel && !IS_PANEL) {
  $('#openPanel').hidden = false;
  $('#openPanel').onclick = async () => { try { await api.sidePanel.open({ tabId }); window.close(); } catch (e) { setStatus('Could not open the side panel.', true); } };
}

(async () => {
  const d = await api.storage.local.get(['opts', 'ignore', 'autoSites']);
  autoSites = d.autoSites || [];
  ign = d.ignore || { global: d.opts?.ignore || [], sites: {} };
  const o = d.opts || {};
  setLang(o.lang || 'auto');
  const m = document.querySelector(`input[name=mode][value=${o.mode || 'balanced'}]`); if (m) m.checked = true;
  for (const [k, id] of [['attrs', 'attrs'], ['unsure', 'unsure'], ['related', 'related'], ['verify', 'verify'], ['confirmedOnly', 'confirmed'], ['live', 'live'], ['source', 'source'], ['hints', 'hints']]) if (k in o) $('#' + id).checked = !!o[k];
  showModeHint();
  await refreshTab();
})();
