const api = globalThis.browser ?? chrome;
const $ = (s) => document.querySelector(s);
const IS_PANEL = document.body.classList.contains('panel');
const LANGS = 'en es fr de it pt nl sv da no fi pl cs sk hu ro bg hr el tr ru uk ar fa he ur hi bn ta te th vi id ms sw ja ko zh ca'.split(' ');
const VIEWS = { bad: '#tabBad', unsure: '#tabUnsure', bug: '#tabBug', fmt: '#tabFmt' };
const uiLang = (api.i18n.getUILanguage?.() || 'en').split('-')[0];
const english = new Intl.DisplayNames(['en'], { type: 'language' });
const nameOf = (c) => { try { return english.of(c) || c; } catch { return c; } };

let tabId = null, tabUrl = '', host = '', result = null, view = 'bad', cursor = -1;
let ign = { global: [], sites: {} }, autoSites = [];

// ---------- Language picker ("Español (Spanish)") ----------
for (const c of LANGS.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
  let native = nameOf(c);
  try { native = new Intl.DisplayNames([c], { type: 'language' }).of(c) || native; } catch {}
  const o = document.createElement('option');
  o.value = c;
  o.textContent = native.toLowerCase() === nameOf(c).toLowerCase() ? native : `${native} (${nameOf(c)})`;
  $('#lang').append(o);
}

function setStatus(msg, err = false) { $('#status').textContent = msg; $('#status').className = err ? 'err' : ''; }
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const storable = () => ({ lang: $('#lang').value, mode: $('#mode').value, attrs: $('#attrs').checked, unsure: $('#unsure').checked,
  related: $('#related').checked, live: $('#live').checked, source: $('#source').checked, hints: $('#hints').checked });
const options = () => ({ ...storable(), ignore: [...ign.global, ...(ign.sites[host] || [])] });
const save = () => api.storage.local.set({ opts: storable(), ignore: ign, autoSites });
const send = (msg) => api.tabs.sendMessage(tabId, msg);
const ensureInjected = () => api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

// ---------- Rendering ----------
const rowsNow = () => (result ? result.issues.filter((i) => i.verdict === view) : []);

function render() {
  if (!result) { $('#result').hidden = true; return; }
  $('#result').hidden = false;
  const { stats, score } = result;
  $('#score').textContent = score == null ? '–' : score + '%';
  const ring = $('#ring');
  ring.style.setProperty('--p', score ?? 0);
  ring.style.setProperty('--c', score == null ? 'var(--track)' : score >= 90 ? 'var(--ok)' : score >= 60 ? '#e0a100' : 'var(--pen)');
  $('#nOk').textContent = stats.okN;
  $('#nBad').textContent = stats.badN;
  $('#nUnsure').textContent = stats.unsureN;

  const src = result.source || {};
  $('#meta').textContent = `Page declares lang="${result.pageLang || 'none'}". Score is weighted by amount of text.` +
    (stats.ignoredN ? ` ${stats.ignoredN} numbers, times, codes and names were skipped.` : '') +
    (stats.assumedN ? ` ${stats.assumedN} unclear short strings were assumed translated because the rest of the page is.` : '') +
    (src.status === 'used' ? ` Compared with the ${src.lang && src.lang !== 'x-default' ? src.lang : 'default'} version of this page.` : '') +
    (result.live ? ' Updating live.' : '');

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
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = { bad: 'Nothing untranslated found.', unsure: 'Nothing uncertain.', bug: 'No broken text found.', fmt: 'No formatting hints.' }[view];
    list.append(li);
    return;
  }
  rows.forEach((i, idx) => {
    const li = document.createElement('li');
    li.className = i.verdict + (idx === cursor ? ' current' : '');
    const b = document.createElement('button');
    const snip = document.createElement('span');
    snip.className = 'snippet';
    snip.textContent = i.text; // page text is always inserted as text, never HTML
    const why = document.createElement('span');
    why.className = 'why';
    const det = i.detected && i.detected.length <= 3 ? nameOf(i.detected) : i.detected;
    why.textContent = (i.kind === 'attr' ? `${i.attr} attribute · ` : '') + (det ? `${det} · ` : '') + (i.reason || 'Too short or ambiguous to judge');
    b.append(snip, why);
    b.addEventListener('click', () => { cursor = idx; focusRow(i); render(); });
    li.append(b);
    if ((i.verdict === 'bad' || i.verdict === 'unsure') && i.text.length <= 60) { // one-click "never flag this"
      const x = document.createElement('button');
      x.className = 'ignore';
      x.textContent = 'Ignore';
      x.title = 'Never flag this text on this site';
      x.addEventListener('click', () => addIgnore(i.text));
      li.append(x);
    }
    list.append(li);
  });
}

const focusRow = (i) => send({ type: 'focus', id: i.id }).catch(() => setStatus('Page changed — check again.', true));
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

// ---------- Scan ----------
async function runScan() {
  const btn = $('#scan');
  btn.disabled = true;
  setStatus('Checking…');
  try {
    await ensureInjected();
    const res = await send({ type: 'scan', ...options() });
    if (res?.error) throw new Error(res.error);
    result = res; view = 'bad'; cursor = -1;
    setStatus('');
    render();
  } catch (e) {
    result = null; render();
    const m = String(e.message || e);
    setStatus(/Cannot access|extensions gallery|chrome:|activeTab|permission/i.test(m)
      ? (IS_PANEL ? 'Click the Translation Check toolbar icon on this tab once to allow checking it.' : 'This page can’t be checked (browser or store page).')
      : m, true);
  } finally { btn.disabled = false; }
}
$('#scan').onclick = runScan;
$('#clear').onclick = async () => { try { await send({ type: 'clear' }); } catch {} result = null; render(); setStatus('Marks cleared.'); };

// ---------- Never-flag lists (global + per site), import / export ----------
async function addIgnore(term) {
  const list = host ? (ign.sites[host] = ign.sites[host] || []) : ign.global;
  if (!list.some((x) => x.toLowerCase() === term.toLowerCase())) list.push(term);
  syncIgnoreBoxes();
  $('details:nth-of-type(2)').open = true;
  await save();
  runScan();
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

async function getExport() {
  const d = await send({ type: 'export' });
  if (!d || !d.issues.length) throw new Error('Nothing to export yet — run a check first.');
  return d;
}
$('#expCsv').onclick = async () => {
  try {
    const d = await getExport();
    const head = ['type', 'text', 'reason', 'detected language', 'where', 'selector', 'page'];
    const rows = d.issues.map((i) => [LABEL[i.verdict], i.text, i.reason, i.detected, i.kind === 'attr' ? i.attr + ' attribute' : 'text', i.selector, d.url]);
    download('translation-issues.csv', 'text/csv', '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  } catch (e) { setStatus(e.message, true); }
};
$('#expHtml').onclick = async () => {
  try {
    const d = await getExport();
    const rows = d.issues.map((i) => `<tr><td>${esc(LABEL[i.verdict])}</td><td>${esc(i.text)}</td><td>${esc(i.reason)}${i.detected ? ' (' + esc(i.detected) + ')' : ''}</td><td><code>${esc(i.selector)}</code></td></tr>`).join('');
    download('translation-report.html', 'text/html', `<!doctype html><meta charset="utf-8"><title>Translation report</title>
<style>body{font:14px system-ui;margin:24px;color:#14213d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dde3ec;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f4f9}code{font-size:12px}</style>
<h1>Translation report</h1><p><a href="${esc(d.url)}">${esc(d.title || d.url)}</a><br>Target language: <b>${esc(d.lang)}</b> · ${esc(d.generated)} · ${d.issues.length} issue(s)</p>
<table><tr><th>Type</th><th>Text</th><th>Why</th><th>Where (CSS selector)</th></tr>${rows}</table>`);
  } catch (e) { setStatus(e.message, true); }
};

// ---------- Auto-check a site (optional permission requested only for that site) ----------
$('#auto').addEventListener('change', async (e) => {
  const on = e.target.checked, id = 'auto-' + host, origins = [`*://${host}/*`];
  try {
    if (on) {
      if (!(await api.permissions.request({ origins }))) { e.target.checked = false; return; }
      try { await api.scripting.unregisterContentScripts({ ids: [id] }); } catch {}
      await api.scripting.registerContentScripts([{ id, matches: origins, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
      autoSites = [...new Set([...autoSites, host])];
    } else {
      try { await api.scripting.unregisterContentScripts({ ids: [id] }); } catch {}
      try { await api.permissions.remove({ origins }); } catch {}
      autoSites = autoSites.filter((h) => h !== host);
    }
    await save();
  } catch (err) { e.target.checked = !on; setStatus('Could not change auto-check: ' + (err.message || err), true); }
});

for (const id of ['lang', 'mode', 'attrs', 'unsure', 'related', 'live', 'source', 'hints']) $('#' + id).addEventListener('change', save);

// ---------- Tabs, side panel, live updates ----------
async function refreshTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id; tabUrl = tab?.url || '';
  try { host = new URL(tabUrl).hostname; } catch { host = ''; }
  $('#hostName').textContent = host || 'this site';
  $('#auto').disabled = !/^https?:/.test(tabUrl);
  $('#auto').checked = !!host && autoSites.includes(host);
  $('#ignoreSite').disabled = !host;
  syncIgnoreBoxes();
  result = null; cursor = -1; render();
  try { // restore results if this page was already checked
    const s = await send({ type: 'status' });
    if (s?.result) { result = s.result; $('#lang').value = result.lang; $('#mode').value = result.mode || 'balanced'; render(); }
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
  $('#lang').value = o.lang || (LANGS.includes(uiLang) ? uiLang : 'en');
  $('#mode').value = o.mode || 'balanced';
  for (const k of ['attrs', 'unsure', 'related', 'live', 'source', 'hints']) if (k in o) $('#' + k).checked = !!o[k];
  await refreshTab();
})();
