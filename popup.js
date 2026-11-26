// Chromium's own namespace has everything this extension uses (scripting, sidePanel...). Some browsers also define a partial `browser`
// object, so `browser` is only used when there is no usable `chrome` (Firefox).
const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : (globalThis.browser ?? globalThis.chrome);
const $ = (s) => document.querySelector(s);
const IS_PANEL = document.body.classList.contains('panel');
const LANGS = 'en es fr de it pt nl sv da no fi pl cs sk hu ro bg hr el tr ru uk ar fa he ur hi bn ta te th vi id ms sw ja ko zh ca'.split(' ');
const VIEWS = { bad: '#tabBad', unsure: '#tabUnsure', bug: '#tabBug', fmt: '#tabFmt', skip: '#tabSkip' };
// Ignore-list learning (learn.js, loaded before this file). Missing in very old builds: then Ignore just adds the term, as before.
const L = globalThis.TCLearn || null;
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
const CHEV = { left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>', right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' };

let tabId = null, tabUrl = '', host = '', isPdf = false, result = null, view = 'bad', cursor = -1;
let ign = { global: [], sites: {} }, marked = { global: [], sites: {} }, autoSites = [], mem = L ? L.emptyMemory() : null, occAt = new Map(), lastLearned = [];

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
const storable = () => ({ unclearMarks: 2, lang: $('#lang').value, mode: mode(), attrs: $('#attrs').checked, unsure: $('#unsure').checked, related: $('#related').checked,
  verify: $('#verify').checked, confirmedOnly: $('#confirmed').checked, live: $('#live').checked, source: $('#source').checked, hints: $('#hints').checked, hoverCard: $('#hoverCard').checked });
const learnedRules = () => (L && mem && mem.on ? L.rulesFor(mem, host) : []);
const options = () => ({ ...storable(), ignore: [...ign.global, ...(ign.sites[host] || [])], learned: learnedRules(), marked: [...marked.global, ...(marked.sites[host] || [])] });
const save = () => api.storage.local.set({ opts: storable(), ignore: ign, marked, autoSites, ...(mem ? { learn: mem } : {}) });
const send = (msg) => api.tabs.sendMessage(tabId, msg);
// Browser pages (vivaldi:, chrome:, edge:, opera:, about:...) can never be scripted by an extension.
const BROWSER_PAGE = /^(?:chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|brave|opera|vivaldi|about|view-source|extension|moz-extension):/i;
// The popup injects the page script itself when it can. Some Chromium browsers (Vivaldi) don't give the popup `chrome.scripting`, so the
// background worker, which always has it, does the injection instead.
async function ensureInjected() {
  if (BROWSER_PAGE.test(tabUrl)) throw new Error('chrome: browser page');
  const scripting = api.scripting || globalThis.chrome?.scripting;
  if (scripting?.executeScript) return scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const r = await api.runtime.sendMessage({ type: 'tc-inject', tabId });
  if (!r || r.error) throw new Error(r?.error || 'The extension could not load its page script. Reload the extension and try again.');
  return r;
}

// ---------- Rendering ----------
const rowsNow = () => (result ? (view === 'skip' ? result.ignored || [] : result.issues.filter((i) => i.verdict === view)) : []);
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
  if (!top || w / total < 0.7 || top === result.lang || !LANGS.includes(top)) return null;
  // judged against all the checked text, not just the flagged text: English project names on a page that is mostly Hindi
  // are mostly English among the warnings, but the page itself is not mostly English
  const checked = (result.stats.ok || 0) + (result.stats.bad || 0);
  const share = checked ? w / checked : 0;
  return share > 0.5 && w > (result.stats.ok || 0) ? { lang: top, share: Math.round(share * 100) } : null;
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
  if (stats.acceptedN) { // untranslated text you OK'd: listed under Ignored, but still not translated, so it keeps the score below 100%
    const one = stats.acceptedN === 1;
    const c = chip('', `${stats.acceptedN} accepted untranslated`, `${one ? 'This untranslated text was' : `These ${stats.acceptedN} untranslated texts were`} accepted with OK or Ignore. ${one ? 'It is' : 'They are'} listed in the Ignored tab and still count as not translated in the score. Click to see ${one ? 'it' : 'them'}.`, 'accepted');
    c.setAttribute('role', 'button'); c.tabIndex = 0;
    const open = () => { view = 'skip'; cursor = -1; occAt.clear(); render(); };
    c.addEventListener('click', open);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    box.append(c);
  }
  if (stats.unconfirmedN) {
    const c = chip('', `${stats.unconfirmedN} unconfirmed hidden`, `Confirmed warnings only is on: ${stats.unconfirmedN} ${stats.unconfirmedN === 1 ? 'warning' : 'warnings'} that a second model doesn’t back ${stats.unconfirmedN === 1 ? 'is' : 'are'} hidden. They are listed in the Ignored tab. Click to see them.`, 'accepted');
    c.setAttribute('role', 'button'); c.tabIndex = 0;
    const open = () => { view = 'skip'; cursor = -1; occAt.clear(); render(); };
    c.addEventListener('click', open);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    box.append(c);
  }
  if (stats.ignoredN) box.append(chip(ICON.skip, `${stats.ignoredN} skipped`, `${stats.ignoredN} numbers, times, codes, names and language names skipped`));
  if (stats.nameN) box.append(chip(ICON.user, `${stats.nameN} ${stats.nameN === 1 ? 'name' : 'names'}`, 'People, places and brands read the same in every language, so they were left alone'));
  if (stats.assumedN) box.append(chip('', `${stats.assumedN} assumed`, 'Unclear short strings assumed translated because the rest of the page is'));
  if (stats.learnedN) box.append(chip(ICON.skip, `${stats.learnedN} auto-ignored`, 'Skipped by rules learned from your Ignore clicks (Settings › Ignore list)'));
}

// Coverage: how many text items the check found and where each one ended up. The numbers add up, so nothing can be skipped unnoticed.
function renderCoverage() {
  const s = result.stats || {}, box = $('#coverage');
  const scanned = s.scannedN ?? ((s.okN || 0) + (s.badN || 0) + (s.unsureN || 0) + (s.bugN || 0) + (s.nameN || 0) + (s.skipN || 0));
  box.hidden = !scanned || result.kind === 'pdf';
  if (box.hidden) return;
  const part = (cls, n, label) => `<span class="${cls}">${cls ? '<i></i>' : ''}<b>${n || 0}</b> ${label}</span>`;
  box.innerHTML = [part('', scanned, 'scanned'), part('ok', s.okN, 'translated'), part('bad', s.badN, 'not translated'), part('unsure', s.unsureN, 'unclear'),
    ...(s.bugN ? [part('bug', s.bugN, 'broken')] : []), part('skip', (s.nameN || 0) + (s.skipN || 0), 'ignored')].join('');
  box.title = 'Every text item on the page is in exactly one of these. Ignored: names, codes, technical terms, dates and your ignore list (listed with their reason in the CSV).';
}

function render() {
  if (!result) { $('#result').hidden = true; return; }
  $('#result').hidden = false;
  const { stats, score } = result;
  $('#score').textContent = score == null ? '–' : score + '%';
  // how the score is worked out: by the amount of text, not by the number of items, so it can't be recomputed from the counts beside it
  $('#score').title = score == null ? '' : `Share of the checked text that is in ${nameOf(result.lang)}, by length: translated ÷ (translated + not translated). `
    + 'Long text weighs more than short text, so it can differ from the counts. Unclear and ignored text are left out'
    + (stats.acceptedN ? ', except untranslated text you accepted, which still counts as not translated.' : '.');
  const arc = $('#arc');
  arc.setAttribute('stroke-dasharray', `${score ?? 0} 100`);
  arc.style.stroke = score == null ? 'var(--track)' : score >= 90 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--bad)';
  $('#nOk').textContent = stats.okN;
  $('#nBad').textContent = stats.badN;
  $('#nUnsure').textContent = stats.unsureN;
  renderChips();
  renderCoverage();

  const wrong = likelyWrongTarget(), fix = wrong && wrong.lang;
  $('#mismatch').hidden = !fix;
  if (fix) {
    const declared = (result.pageLang || '').toLowerCase().split('-')[0] === fix;
    $('#mismatchText').textContent = `Mostly ${nameOf(fix)} (${wrong.share}% of the text)${declared ? ' — the page’s own language' : ''}. Wrong target?`;
    $('#mismatchText').title = `${wrong.share}% of the checked text looks ${nameOf(fix)}, more than is in ${nameOf(result.lang)}`;
    $('#mismatchFix').textContent = `Check for ${nameOf(fix)}`;
    $('#mismatchFix').onclick = () => { setLang(fix); save().then(() => runScan()); };
  }

  // Tab counts are rows in the list, the same number the navigator steps through ("0 / 23"); the same text in several places is one row (×N).
  // The big numbers above count every place on the page.
  const places = { bad: stats.badN, unsure: stats.unsureN, bug: stats.bugN, fmt: stats.fmtN, skip: (stats.nameN || 0) + (stats.skipN || 0) };
  const counts = Object.fromEntries(Object.keys(places).map((k) => [k, k === 'skip' ? (result.ignored || []).length : (result.issues || []).filter((i) => i.verdict === k).length]));
  $('#tabSkip').hidden = !counts.skip;
  $('#tabBug').hidden = !stats.bugN;
  $('#tabFmt').hidden = !$('#hints').checked && !stats.fmtN;
  if ($(VIEWS[view]).hidden) view = 'bad';
  for (const [k, sel] of Object.entries(VIEWS)) {
    $(sel).setAttribute('aria-selected', k === view);
    $(sel).querySelector('.n').textContent = counts[k] || 0;
    $(sel).dataset.places = places[k] || 0;
    $(sel).title = `${$(sel).dataset.label || ($(sel).dataset.label = $(sel).title)}: ${counts[k] || 0} ${counts[k] === 1 ? 'row' : 'rows'}, ${places[k] || 0} ${places[k] === 1 ? 'place' : 'places'} on the page`;
  }
  $('#legendTip').textContent = $('#hoverCard').checked ? 'Point at underlined text on the page to decide' : 'Decide with the buttons on each row below';

  const list = $('#list');
  list.replaceChildren();
  const rows = rowsNow();
  if (cursor >= rows.length) cursor = -1;
  $('#pos').textContent = `${cursor + 1} / ${rows.length}`;
  $('#prev').disabled = $('#next').disabled = !rows.length;
  if (!rows.length) {
    list.append(el('li', 'empty', { bad: 'Nothing untranslated', unsure: 'Nothing unclear', bug: 'No broken text', fmt: 'No format or wording hints', skip: 'Nothing ignored' }[view]));
    return;
  }
  rows.forEach((i, idx) => {
    const li = el('li', i.verdict + (idx === cursor ? ' current' : ''));
    const b = el('button');
    const sn = el('span', 'snippet'); sn.append(el('span', 'hl', i.text)); b.append(sn); // page text is always inserted as text, never HTML; .hl marks it like the page does
    // where it is: the copy currently shown, e.g. "button · Navigation › “Settings”"
    const occ = i.occ || [], at = Math.min(occAt.get(i.id) || 0, Math.max(occ.length - 1, 0)), o = occ[at];
    const whereTxt = (o && o.where) || (at === 0 && i.context && [i.context.kind, i.context.path].filter(Boolean).join(' · ')) || '';
    if (whereTxt) b.append(el('span', 'where', whereTxt));
    if (o && (o.before || o.after)) b.append(el('span', 'near', `${o.before ? o.before + ' ' : ''}[ … ]${o.after ? ' ' + o.after : ''}`));
    const meta = el('span', 'meta');
    if ((i.count || 1) > 1) { const c = el('span', 'tag count', `×${i.count}`); c.title = `Appears ${i.count} times on this page — click again to go to the next one`; meta.append(c); }
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
    b.title = (i.reason || 'Too short or ambiguous to judge') + (i.marked && i.modelReason ? `\nModels: ${i.modelReason}` : '');
    // a click on the selected row moves on to the next place the same text appears; coming back to a row resumes where you left it
    b.addEventListener('click', () => {
      if (cursor === idx && occ.length > 1) occAt.set(i.id, (at + 1) % occ.length);
      cursor = idx; focusRow(i); render();
    });
    li.append(b);
    if (occ.length > 1 && idx === cursor) { // previous / next copy of this text
      li.classList.add('has-occ');
      const nav = el('div', 'occnav');
      const go = (d) => { occAt.set(i.id, (at + d + occ.length) % occ.length); focusRow(i); render(); };
      const prev = el('button', 'icon sm occ-prev'); prev.innerHTML = CHEV.left; prev.title = 'Previous place with this text'; prev.setAttribute('aria-label', prev.title); prev.addEventListener('click', () => go(-1));
      const next = el('button', 'icon sm occ-next'); next.innerHTML = CHEV.right; next.title = 'Next place with this text'; next.setAttribute('aria-label', next.title); next.addEventListener('click', () => go(1));
      nav.append(prev, el('span', 'occpos', `Copy ${at + 1} of ${occ.length}`), next);
      li.append(nav);
    }
    if (i.verdict === 'skip' && i.byUser) { // ignored by you: restore it to the tab it came from
      const acts = el('div', 'acts');
      const back = { bad: 'Untranslated', unsure: 'Unclear', name: 'the check', skip: 'the check' }[i.was] || 'the check';
      const r = el('button', 'ignore-btn restore-btn', 'Restore');
      r.title = `Take it off the ignore list: back to ${back}`;
      r.addEventListener('click', () => removeIgnore(i.text));
      acts.append(r);
      li.append(acts);
    }
    if ((i.verdict === 'bad' || i.verdict === 'unsure') && i.text.length <= 60) { // one-click "never flag this" / "this is untranslated"
      const acts = el('div', 'acts');
      if (i.verdict === 'unsure') {
        const m = el('button', 'mark-btn', 'Untranslated');
        m.title = (i.count || 1) > 1 ? `Mark as untranslated (all ${i.count} places) and keep listing it there` : 'Mark as untranslated and keep listing it there';
        m.addEventListener('click', () => addMarked(i.text));
        acts.append(m);
      } else if (i.marked) {
        const m = el('button', 'mark-btn', 'Unmark');
        m.title = 'You marked this as untranslated: let the language models judge it again';
        m.addEventListener('click', () => removeMarked(i.text));
        acts.append(m);
      }
      const x = el('button', 'ignore-btn', 'Ignore');
      x.title = (i.count || 1) > 1 ? `Never flag this text (all ${i.count} places)` : 'Never flag this text';
      x.addEventListener('click', () => addIgnore(i.text, i));
      acts.append(x);
      li.append(acts);
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
  const occ = i.occ || [], o = occ[Math.min(occAt.get(i.id) || 0, Math.max(occ.length - 1, 0))];
  return send({ type: 'focus', id: o ? o.id : i.id }).catch(() => setStatus('Page changed — check again.', true));
}
function step(d) {
  const rows = rowsNow();
  if (!rows.length) return;
  cursor = (cursor + d + rows.length) % rows.length;
  focusRow(rows[cursor]);
  render();
  $('#list .current')?.scrollIntoView({ block: 'nearest' });
}
for (const [k, sel] of Object.entries(VIEWS)) $(sel).onclick = () => { view = k; cursor = -1; occAt.clear(); render(); };
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

// A local file needs "Allow access to file URLs" AND the optional file:///* host permission. The permission is requested in the click
// itself (see the Check button), because browsers only allow permission requests right after a click; the file is read only once both are
// in place, so no refused read is logged as an error.
async function fetchPdf(url, fileGrant) {
  const get = async () => { const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
  if (/^file:/.test(url)) {
    const allowed = await new Promise((r) => { try { api.extension.isAllowedFileSchemeAccess(r); } catch { r(true); } });
    if (!allowed) throw new Error('Local PDFs need “Allow access to file URLs” turned on for this extension (open the extensions page, then Details).');
    let granted = false;
    try { granted = await (fileGrant || api.permissions.contains({ origins: ['file:///*'] })); } catch {}
    if (!granted) throw new Error('Couldn’t read this local PDF: click Check PDF again and allow the extension to read local files.');
    try { return await get(); } catch { throw new Error('Couldn’t read this local PDF.'); }
  }
  try { return await get(); } catch (e) {
    if (/^https?:/.test(url)) { // ask once for access to this site, then retry
      let granted = false;
      try { granted = await api.permissions.request({ origins: [new URL(url).origin + '/*'] }); } catch {}
      if (granted) { try { return await get(); } catch {} }
    }
    throw new Error('Couldn’t download this PDF (it may need a sign-in or block downloads).');
  }
}

async function runPdf(fileGrant) {
  await loadScript('vendor/pdf.min.js');
  await loadScript('pdfcheck.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = api.runtime.getURL('vendor/pdf.worker.min.js');
  const data = await fetchPdf(tabUrl, fileGrant);
  const res = await window.TCPDF.analyzePdf({
    pdfjs: window.pdfjsLib, data, params: options(), send: (m) => api.runtime.sendMessage(m),
    onProgress: (e) => setStatus(e.stage === 'read' ? `Reading page ${e.page} of ${e.pages}…` : 'Checking text…'),
  });
  if (res.error) throw new Error(res.error);
  return res;
}

async function runScan({ keepView = false, fileGrant } = {}) {
  const btn = $('#scan');
  btn.disabled = true;
  setStatus('Checking…');
  try {
    let res;
    if (isPdf) res = await runPdf(fileGrant);
    else { await ensureInjected(); res = await send({ type: 'scan', ...options() }); }
    if (res?.error) throw new Error(res.error);
    result = res; view = keepView ? view : 'bad'; cursor = -1; occAt.clear(); // after Ignore the person stays on the list they were working in
    setStatus('');
    render();
  } catch (e) {
    result = null; render();
    const m = String(e.message || e);
    setStatus(/Cannot access|extensions gallery|chrome:|activeTab|permission|cannot be scripted/i.test(m) && !isPdf
      ? (IS_PANEL ? 'Click the toolbar icon on this tab once to allow checking it.' : 'This page can’t be checked (browser or store page).')
      : m, true);
  } finally { btn.disabled = false; }
}
$('#scan').onclick = () => {
  // Local PDF: ask for local-file access now, while this is still the click (no-op once granted). Done before any await on purpose.
  let fileGrant;
  if (isPdf && /^file:/.test(tabUrl)) { try { fileGrant = Promise.resolve(api.permissions.request({ origins: ['file:///*'] })).catch(() => false); } catch { fileGrant = Promise.resolve(false); } }
  return runScan({ fileGrant });
};
$('#clear').onclick = async () => { if (!isPdf) { try { await send({ type: 'clear' }); } catch {} } result = null; render(); setStatus(''); };

// ---------- Settings drawer ----------
const MODE_HINT = { relaxed: 'Assumes unclear text is translated. Fewest warnings.', balanced: 'Assumes very short unclear text is translated when the rest of the page is.', strict: 'Lists everything unclear. Most warnings.' };
const showModeHint = () => { $('#modeHint').textContent = MODE_HINT[mode()]; };
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', showModeHint));
$('#settingsBtn').onclick = () => { const open = $('#settings').hidden; $('#settings').hidden = !open; $('#settingsBtn').setAttribute('aria-expanded', open); };

// ---------- Never-flag lists (this site + all sites), import / export ----------
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const drop = (lists, term) => { lists.global = lists.global.filter((x) => !same(x, term)); for (const h of Object.keys(lists.sites)) lists.sites[h] = lists.sites[h].filter((x) => !same(x, term)); };
// "Untranslated" on an unclear item: listed as untranslated on every check of this site (all sites when there is no site), until Unmark.
async function addMarked(term) {
  const list = host ? (marked.sites[host] = marked.sites[host] || []) : marked.global;
  if (!list.some((x) => same(x, term))) list.push(term);
  drop(ign, term); // the latest decision wins
  syncIgnoreBoxes();
  await save();
  await runScan({ keepView: true });
  setStatus(`“${term.length > 40 ? term.slice(0, 40) + '…' : term}” moved to Untranslated.`);
}
async function removeMarked(term) {
  drop(marked, term);
  syncIgnoreBoxes();
  await save();
  await runScan({ keepView: true });
}
// Restore from the Ignored tab: off the ignore list (this site and all sites), so the next check lists it where the models put it.
async function removeIgnore(term) {
  drop(ign, term);
  syncIgnoreBoxes();
  await save();
  await runScan({ keepView: true });
  setStatus(`“${term.length > 40 ? term.slice(0, 40) + '…' : term}” restored.`);
}
async function addIgnore(term, issue) {
  const list = host ? (ign.sites[host] = ign.sites[host] || []) : ign.global;
  if (!list.some((x) => same(x, term))) list.push(term);
  drop(marked, term); // the latest decision wins
  // learning: remember what was ignored and where; three similar Ignores make a rule (see learn.js)
  if (L && mem && mem.on && issue) {
    const r = L.record(mem, { text: term, host, slot: issue.slot || '', lang: result?.lang || '' }); // a rule belongs to the language that was checked
    mem = r.mem; lastLearned = r.learned;
    showLearned();
    renderLearned();
  }
  syncIgnoreBoxes();
  await save();
  runScan({ keepView: true });
}
function showLearned() {
  $('#learnNote').hidden = !lastLearned.length;
  if (!lastLearned.length) return;
  $('#learnText').textContent = `Learned: skipping ${lastLearned.map((r) => L.describeRule(r, host)).join('; ')}.`;
}
$('#learnUndo').onclick = async () => {
  for (const r of lastLearned) mem = L.reject(mem, r);
  lastLearned = []; showLearned(); renderLearned();
  await save();
  runScan({ keepView: true });
};
function renderLearned() {
  const box = $('#learnedList');
  box.replaceChildren();
  if (!L || !mem) { box.hidden = true; return; }
  $('#learn').checked = mem.on;
  const rules = mem.rules.filter((r) => r.scope === '*' || r.scope === host);
  if (!rules.length) { box.append(el('li', 'empty', mem.on ? 'Nothing learned for this site yet' : 'Learning is off')); return; }
  for (const r of rules) {
    const li = el('li');
    li.append(el('span', '', L.describeRule(r, host)));
    const x = el('button', '', 'Remove');
    x.title = 'Stop skipping these and don’t learn this again';
    x.addEventListener('click', async () => { mem = L.reject(mem, r); renderLearned(); await save(); });
    li.append(x);
    box.append(li);
  }
}
$('#learn').addEventListener('change', async () => { if (mem) { mem = { ...mem, on: $('#learn').checked }; renderLearned(); await save(); } });
function syncIgnoreBoxes() {
  $('#ignoreGlobal').value = ign.global.join('\n');
  $('#ignoreSite').value = (ign.sites[host] || []).join('\n');
  $('#markedSite').value = (marked.sites[host] || []).join('\n');
  $('#markedGlobal').value = marked.global.join('\n');
}
$('#ignoreGlobal').addEventListener('change', () => { ign.global = lines($('#ignoreGlobal').value); save(); });
$('#ignoreSite').addEventListener('change', () => { if (host) { ign.sites[host] = lines($('#ignoreSite').value); save(); } });
$('#markedSite').addEventListener('change', () => { if (host) { marked.sites[host] = lines($('#markedSite').value); save(); } });
$('#markedGlobal').addEventListener('change', () => { marked.global = lines($('#markedGlobal').value); save(); });

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('#expIgnore').onclick = () => download('translation-check-ignore-list.json', 'application/json', JSON.stringify({ version: 2, ...ign, learned: mem ? mem.rules : [], marked }, null, 2));
$('#impIgnore').onclick = () => $('#impFile').click();
$('#impFile').addEventListener('change', async () => {
  try {
    const d = JSON.parse(await $('#impFile').files[0].text());
    const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
    ign.global = [...new Set([...ign.global, ...clean(d.global)])];
    for (const [h, l] of Object.entries(d.sites || {})) ign.sites[h] = [...new Set([...(ign.sites[h] || []), ...clean(l)])];
    if (d.marked && typeof d.marked === 'object') { // files exported since "Mark untranslated" also carry the marked texts
      marked.global = [...new Set([...marked.global, ...clean(d.marked.global)])];
      for (const [h, l] of Object.entries(d.marked.sites || {})) marked.sites[h] = [...new Set([...(marked.sites[h] || []), ...clean(l)])];
    }
    if (L && mem && Array.isArray(d.learned)) { // version 2 files also carry learned rules
      const have = new Set(mem.rules.map((r) => `${r.type}|${r.scope}|${r.value}`));
      mem = L.loadMemory({ ...mem, rules: [...mem.rules, ...d.learned.filter((r) => r && !have.has(`${r.type}|${r.scope}|${r.value}`))] });
      renderLearned();
    }
    syncIgnoreBoxes(); await save(); setStatus('Ignore list imported.');
  } catch { setStatus('That file isn’t a valid ignore list.', true); }
  $('#impFile').value = '';
});

// ---------- Export (CSV / HTML report) ----------
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { bad: 'Not translated', unsure: 'Needs review', bug: 'Broken text', fmt: 'Format or wording hint', skip: 'Ignored' };
// A warning hidden by "Confirmed warnings only" is not a decision that the text is fine: it is listed as "Needs review", not as Ignored.
const typeOf = (i) => (i.verdict === 'skip' && i.unconfirmed ? 'Needs review' : LABEL[i.verdict]);
// One line per field: several locations are separated by " | ", never by a line break (a line break inside a field splits the row in text
// editors and breaks some spreadsheet imports).
const flat = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const SEP = ' | ';
const places = (i) => (i.occurrences || []).map((o) => flat([o.where, o.selector].filter(Boolean).join(' — '))).join(SEP);
const contexts = (i) => (i.occurrences && i.occurrences.length ? i.occurrences.map((o) => flat(o.where) || where(i)).join(SEP) : flat(i.context ? [i.context.kind, i.context.path].filter(Boolean).join(' · ') : ''));
const nearText = (i) => {
  const occ = (i.occurrences || []).filter((o) => o.before || o.after);
  if (occ.length) return occ.map((o) => flat(`${o.before} [${i.text}] ${o.after}`)).join(SEP);
  const c = i.context;
  return c && c.path ? flat(`[${i.text}] in ${c.path}`) : flat(`[${i.text}]`); // nothing around it on the page: say where it sits instead
};
// what kind of element the text is in (tab, heading, table cell, badge, button, placeholder…), or the PDF page
const where = (i) => (i.kind === 'pdf' ? `page ${i.pages && i.pages.length > 1 ? i.pages.join(', ') : i.page}` : i.kind === 'attr' ? (i.context?.kind || i.attr + ' attribute') : (i.context?.kind || i.occurrences?.[0]?.where?.split(' · ')[0] || 'text'));
const detectedOf = (i) => (i.verdict === 'bug' || i.verdict === 'fmt' || i.verdict === 'skip' ? 'n/a' : i.detected || 'unknown');
// for text you marked as untranslated, the models' own reading is kept next to your mark
const reasonOf = (i) => flat(i.marked && i.modelReason ? `${i.reason}; models: ${i.modelReason}` : i.reason || (i.verdict === 'unsure' ? 'Too short or ambiguous to judge' : ''));
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
    // new columns go at the end, so existing spreadsheets and scripts that read the first eight keep working
    const head = ['type', 'text', 'reason', 'detected language', 'model agreement', 'where', 'selector', 'document', 'occurrences', 'context', 'surrounding text', 'all locations'];
    const rows = d.issues.map((i) => [typeOf(i), flat(i.text), reasonOf(i), detectedOf(i), agree(i) || 'n/a', where(i), i.selector || 'n/a', d.url,
      i.count || 1, contexts(i), nearText(i), places(i)]);
    download('translation-issues.csv', 'text/csv', '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
  } catch (e) { setStatus(e.message, true); }
};
// ---------- Pictures in the report: each finding cropped from a screenshot of the page, with the text boxed in its colour ----------
// Chrome allows two screenshots a second, so a long list is capped; the page is scrolled back to where it was afterwards.
const SNAP_MAX = 40, SNAP_GAP = 550, SNAP_PAD = { x: 90, y: 50 }, SNAP_MIN_W = 440, SNAP_OUT_W = 760;
const SNAP_COLOR = { bad: '#d7263d', unsure: '#f08a24', bug: '#7b2cbf', fmt: '#0f9d8a' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snapId = (i) => (i.occ && i.occ[0] ? i.occ[0].id : i.id);
async function cropShot(dataUrl, at, color) {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = img.width / at.vw; // screenshot pixels per CSS pixel (screen scaling and page zoom included)
  const r = at.rect;
  let w = Math.max(r.w + 2 * SNAP_PAD.x, SNAP_MIN_W), h = r.h + 2 * SNAP_PAD.y;
  let x = r.x + r.w / 2 - w / 2, y = r.y - SNAP_PAD.y;
  w = Math.min(w, at.vw); h = Math.min(h, at.vh);
  x = Math.max(0, Math.min(x, at.vw - w)); y = Math.max(0, Math.min(y, at.vh - h));
  const kh = img.height / at.vh; // (the same, unless the screenshot is missing a bar at the bottom)
  if (kh < k) { h = Math.min(h, img.height / k); y = Math.max(0, Math.min(y, img.height / k - h)); }
  const out = Math.min(1, SNAP_OUT_W / (w * k)) * k; // output pixels per CSS pixel
  const c = document.createElement('canvas');
  c.width = Math.round(w * out); c.height = Math.round(h * out);
  const g = c.getContext('2d');
  g.drawImage(img, x * k, y * k, w * k, h * k, 0, 0, c.width, c.height);
  const bx = (r.x - x - 4) * out, by = (r.y - y - 3) * out, bw = (r.w + 8) * out, bh = (r.h + 6) * out;
  g.fillStyle = color + '22'; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = color; g.lineWidth = Math.max(2, 2.5 * out / k * Math.min(k, 2)); g.strokeRect(bx, by, bw, bh);
  return c.toDataURL('image/jpeg', 0.85);
}
async function takePictures(issues) {
  const pics = new Map(), want = issues.filter((i) => SNAP_COLOR[i.verdict]);
  const todo = want.slice(0, SNAP_MAX);
  let note = want.length > todo.length ? `Pictures of the first ${todo.length} of ${want.length} findings.` : '';
  if (!todo.length || result?.kind === 'pdf') return { pics, note: result?.kind === 'pdf' ? 'No pictures for PDF documents.' : note };
  let windowId;
  try { windowId = (await api.tabs.get(tabId)).windowId; } catch {}
  let last = 0;
  try {
    for (const [n, i] of todo.entries()) {
      setStatus(`Taking pictures for the report… ${n + 1} / ${todo.length}`);
      let at = null;
      try { at = await send({ type: 'tc-snap', id: snapId(i) }); } catch {}
      if (!at || !at.ok) { pics.set(i, { why: at?.why === 'hidden' ? 'Not visible on the page (hidden, or in a closed menu or tab)' : 'No longer on the page' }); continue; }
      await wait(Math.max(150, SNAP_GAP - (Date.now() - last))); // let the page paint after scrolling, and stay under Chrome's limit
      last = Date.now();
      const shot = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
      pics.set(i, { src: await cropShot(shot, at, SNAP_COLOR[i.verdict]), tooltip: at.tooltip });
    }
  } catch (e) {
    note = `Pictures stopped: ${e.message || e}. Open the extension from its toolbar button on the page, then download the report again.`;
  } finally {
    try { await send({ type: 'tc-snap-done' }); } catch {}
  }
  return { pics, note };
}

// The report puts what needs work first: findings (untranslated and broken text), then what needs a person's decision ("Needs review": unclear
// text, models that disagree, warnings hidden as unconfirmed), then format and wording hints, and last, collapsed, everything that was skipped
// with its reason (names, codes, numbers with units, your ignore list…). Skipped text is not a problem, so the header counts it apart.
const REPORT_CSS = `body{font:14px system-ui;margin:24px;color:#14213d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dde3ec;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f4f9}code{font-size:12px}ol{margin:0;padding-left:18px}i{color:#566176}td.pic{width:390px}td.pic img{display:block;max-width:380px;height:auto;border:1px solid #dde3ec;border-radius:4px}h2{margin:28px 0 8px;font-size:18px}h2 .n{color:#566176;font-weight:400}.sum{font-size:16px}.empty{color:#566176}details{margin-top:28px}summary{cursor:pointer;font-size:18px;font-weight:600}summary .n{color:#566176;font-weight:400}ul.why{margin:8px 0 12px;padding-left:20px}`;
const sectionOf = (i) => (i.verdict === 'bad' || i.verdict === 'bug' ? 'find' : i.verdict === 'unsure' || (i.verdict === 'skip' && i.unconfirmed) ? 'review' : i.verdict === 'fmt' ? 'fmt' : 'skip');
// the same place listed twice (one tooltip read from two attributes) is one place
const uniqOcc = (i) => { const seen = new Set(); return (i.occurrences || []).filter((o) => { const k = [o.where, o.selector, o.before, o.after].join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; }); };
// "Ignored by a rule learned from your Ignore clicks (text in span.x; …)" and "Code, number or ID (letters mixed with digits)" are grouped by
// the part before the brackets, so the skipped summary is a short list of reasons
const reasonKey = (i) => (reasonOf(i) || 'Skipped').replace(/\s*\(.*$/, '');

$('#expHtml').onclick = async () => {
  const btn = $('#expHtml');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const d = await getExport();
    const by = { find: [], review: [], fmt: [], skip: [] };
    for (const i of d.issues) by[sectionOf(i)].push(i);
    const { pics, note } = await takePictures([...by.find, ...by.review, ...by.fmt]);
    const loc = (i) => { const occ = uniqOcc(i); return occ.length
      ? `<ol>${occ.map((o) => `<li>${esc(o.where || where(i))}${o.before || o.after ? `<br><i>${esc(o.before)} [${esc(i.text)}] ${esc(o.after)}</i>` : ''}${o.selector ? '<br><code>' + esc(o.selector) + '</code>' : ''}</li>`).join('')}</ol>`
      : `${esc(where(i))}${i.selector ? '<br><code>' + esc(i.selector) + '</code>' : ''}`; };
    const pic = (i) => { const p = pics.get(i); if (!p) return ''; if (!p.src) return `<i>${esc(p.why)}</i>`;
      return `<a href="${p.src}" target="_blank"><img src="${p.src}" alt="${esc(i.text.slice(0, 80))} on the page"></a>${p.tooltip ? '<br><i>Tooltip text: the box shows what it belongs to</i>' : ''}`; };
    const shots = [...pics.values()].filter((p) => p.src).length;
    const count = (i) => ((i.count || 1) > 1 ? ` <b>×${i.count}</b>` : '');
    const row = (i, withPic) => `<tr><td>${esc(typeOf(i))}</td><td>${esc(i.text)}${count(i)}</td>${withPic ? `<td class="pic">${pic(i)}</td>` : ''}<td>${esc(reasonOf(i))}${i.detected && i.verdict !== 'skip' ? ' (' + esc(i.detected) + ')' : ''} ${esc(agree(i))}</td><td>${loc(i)}</td></tr>`;
    const table = (list, withPic) => `<table><tr><th>Type</th><th>Text</th>${withPic ? '<th>On the page</th>' : ''}<th>Why</th><th>Where</th></tr>${list.map((i) => row(i, withPic)).join('')}</table>`;
    const section = (title, list, empty) => `<h2>${title} <span class="n">(${list.length})</span></h2>${list.length ? table(list, true) : `<p class="empty">${empty}</p>`}`;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const occN = (list) => list.reduce((n, i) => n + (i.count || 1), 0);
    const reasons = new Map();
    for (const i of by.skip) { const k = reasonKey(i); const r = reasons.get(k) || { rows: 0, occ: 0 }; r.rows++; r.occ += i.count || 1; reasons.set(k, r); }
    const skipped = by.skip.length ? `<details><summary>Skipped <span class="n">(${by.skip.length} ${by.skip.length === 1 ? 'text' : 'texts'}, ${occN(by.skip)} on the page): not problems, each with its reason</span></summary>
<ul class="why">${[...reasons].sort((a, b) => b[1].rows - a[1].rows).map(([k, r]) => `<li>${esc(k)}: ${r.rows}${r.occ > r.rows ? ` (${r.occ} on the page)` : ''}</li>`).join('')}</ul>${table(by.skip, false)}</details>` : '';
    const head = [plural(by.find.length, 'finding', 'findings'), `${by.review.length} to review`, ...(by.fmt.length ? [plural(by.fmt.length, 'hint', 'hints')] : []), `${by.skip.length} skipped`].join(' · ');
    const picNote = note || (!by.find.length && !by.review.length && !by.fmt.length ? 'No pictures: nothing was found to show.' : '');
    download('translation-report.html', 'text/html', `<!doctype html><meta charset="utf-8"><title>Translation report</title>
<style>${REPORT_CSS}</style>
<h1>Translation report</h1><p><a href="${esc(d.url)}">${esc(d.title || d.url)}</a><br>Target language: <b>${esc(d.lang)}</b> · ${esc(d.generated)}</p>
<p class="sum"><b>${esc(head)}</b>${picNote ? `<br><i>${esc(picNote)}</i>` : ''}</p>
${section('Findings', by.find, 'No untranslated or broken text found.')}
${section('Needs review', by.review, 'Nothing to review.')}
${by.fmt.length ? section('Format and wording hints', by.fmt, '') : ''}
${skipped}`);
    setStatus(shots ? `Report downloaded with ${shots} ${shots === 1 ? 'picture' : 'pictures'}.` : 'Report downloaded.');
  } catch (e) { setStatus(e.message, true); } finally { btn.disabled = false; }
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

for (const id of ['lang', 'attrs', 'unsure', 'related', 'verify', 'confirmed', 'live', 'source', 'hints', 'hoverCard']) $('#' + id).addEventListener('change', save);
// the card on underlined text is switched on or off on the checked page right away, without checking it again
$('#hoverCard').addEventListener('change', () => { if (result && result.kind !== 'pdf') send({ type: 'tc-hovercard', on: $('#hoverCard').checked }).catch(() => {}); if (result) render(); });
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
  $('#ignoreSite').disabled = !host; $('#markedSite').disabled = !host;
  syncIgnoreBoxes();
  lastLearned = []; showLearned(); renderLearned();
  result = null; cursor = -1; render();
  if (isPdf) return; // PDFs are checked on demand
  try { // restore results if this page was already checked
    const s = await send({ type: 'status' });
    if (s?.result) { result = s.result; setLang(result.requested || result.lang); render(); }
  } catch {}
}

// Decisions made on the page (the card on underlined text) are saved by the page script: keep this window's copy of the lists in step.
api.storage.onChanged?.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.ignore?.newValue) ign = { global: ch.ignore.newValue.global || [], sites: ch.ignore.newValue.sites || {} };
  if (ch.marked?.newValue) marked = { global: ch.marked.newValue.global || [], sites: ch.marked.newValue.sites || {} };
  if (ch.ignore || ch.marked) syncIgnoreBoxes();
});
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
  const d = await api.storage.local.get(['opts', 'ignore', 'autoSites', 'learn', 'marked']);
  autoSites = d.autoSites || [];
  if (L) mem = L.loadMemory(d.learn);
  ign = d.ignore || { global: d.opts?.ignore || [], sites: {} };
  marked = { global: d.marked?.global || [], sites: d.marked?.sites || {} };
  const o = d.opts || {};
  setLang(o.lang || 'auto');
  const m = document.querySelector(`input[name=mode][value=${o.mode || 'balanced'}]`); if (m) m.checked = true;
  if (o.unclearMarks !== 2) o.unsure = true; // 2.0.6: unclear text is underlined in orange by default (switched on once for existing settings)
  for (const [k, id] of [['attrs', 'attrs'], ['unsure', 'unsure'], ['related', 'related'], ['verify', 'verify'], ['confirmedOnly', 'confirmed'], ['live', 'live'], ['source', 'source'], ['hints', 'hints'], ['hoverCard', 'hoverCard']]) if (k in o) $('#' + id).checked = !!o[k];
  showModeHint();
  if (d.opts && o.unclearMarks !== 2) save(); // keep the switched-on setting for automatic checks too
  await refreshTab();
})();
