// Translation Check — page-side scanner (injected on demand via activeTab, or automatically on opted-in sites).
// Language judgement happens in the background worker (one shared model); this script only collects,
// masks, highlights and reports.
import { mask, compileTerms } from './mask.js';
import { detectBug, formatHints } from './rules.js';

(() => {
  if (window.__tcLoaded) return;
  window.__tcLoaded = true;
  const api = globalThis.browser ?? globalThis.chrome;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'SVG', 'MATH', 'TEMPLATE', 'IFRAME', 'CANVAS']);
  const SKIP_SEL = 'script,style,noscript,code,pre,kbd,samp,textarea,svg,math,template,iframe,canvas';
  const NO_TRANSLATE = '[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"]';
  const URLISH = /^(https?:\/\/|www\.)\S+$|^\S+@\S+\.\S+$/i;
  const MAX_ITEMS = 6000, STYLE_ID = 'tc-style', KEYS = ['tc-bad', 'tc-unsure', 'tc-bug', 'tc-fmt', 'tc-focus'];
  const RANK = { fmt: 1, unsure: 2, bad: 3, bug: 4 };

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const words = (s) => (s.match(/\p{L}+/gu) || []).length;
  const nk = (s) => clean(s).toLowerCase();
  const send = (m) => { try { const p = api.runtime.sendMessage(m); return p && p.then ? p : Promise.resolve(p); } catch (e) { return Promise.reject(e); } };
  const quiet = (m) => send(m).catch(() => {});

  let state = null, last = null, seq = 0, busy = false, again = false, timer = 0;
  let visCache = new WeakMap(), blockCache = new WeakMap();
  const vcache = new Map(), targets = new Map(), styled = new Map(), marks = new Map();
  let observers = [], observed = new WeakSet();
  const dirty = new Set();

  // ---------- Collection (time-sliced; pierces open shadow roots and same-origin iframes) ----------
  function visible(el) {
    if (!el) return false;
    if (visCache.has(el)) return visCache.get(el);
    const v = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0;
    visCache.set(el, v);
    return v;
  }
  const collectable = (t, p) => t.length >= 2 && !URLISH.test(t) && (/\p{L}/u.test(t) || /[{%]/.test(t) || (p.hints && /\d/.test(t)));
  const blocked = (el) => !!(el.closest && (el.closest(NO_TRANSLATE) || el.closest(SKIP_SEL)));

  async function collectFrom(root, p, out, scope, depth = 0) {
    if (root.nodeType === 1 && blocked(root)) return;
    scope.roots.add(root);
    const doc = root.ownerDocument || root;
    const shadows = [], frames = [];
    const walker = doc.createTreeWalker(root, 5, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          const tag = n.tagName.toUpperCase();
          if (tag === 'IFRAME' || tag === 'FRAME') { frames.push(n); return 2; }
          if (SKIP.has(tag) || n.matches(NO_TRANSLATE)) return 2;
          if (n.shadowRoot) shadows.push(n.shadowRoot);
          return 3;
        }
        return 1;
      },
    });
    let t0 = performance.now(), n = 0;
    while (walker.nextNode() && out.length < MAX_ITEMS) {
      if ((++n & 255) === 0 && performance.now() - t0 > 12) { await tick(); t0 = performance.now(); }
      const node = walker.currentNode;
      const text = clean(node.nodeValue || '');
      if (collectable(text, p) && visible(node.parentElement || node.parentNode?.host)) out.push({ kind: 'text', text, node });
    }
    if (p.attrs && root.querySelectorAll) {
      const sel = '[placeholder],[alt],[title],[aria-label],input[type=submit],input[type=button]';
      for (const el of root.querySelectorAll(sel)) {
        if (out.length >= MAX_ITEMS) break;
        if (blocked(el) || !visible(el)) continue;
        for (const attr of ['placeholder', 'alt', 'title', 'aria-label', 'value']) {
          if (attr === 'value' && !/^(submit|button)$/.test(el.type || '')) continue;
          const text = clean(el.getAttribute(attr) || '');
          if (collectable(text, p)) out.push({ kind: 'attr', attr, text, el });
        }
      }
    }
    for (const sr of shadows) await collectFrom(sr, p, out, scope, depth);
    if (depth < 3) for (const f of frames) { try { const b = f.contentDocument && f.contentDocument.body; if (b) await collectFrom(b, p, out, scope, depth + 1); } catch (e) { /* cross-origin */ } }
  }

  // Names that belong to this site and must never be "translated" (hostname labels, og:site_name…)
  function siteTerms() {
    const t = new Set();
    for (const part of location.hostname.replace(/^www\./, '').split('.').slice(0, -1)) if (part.length >= 4) t.add(part);
    for (const sel of ['meta[property="og:site_name"]', 'meta[name="application-name"]', 'meta[name="apple-mobile-web-app-title"]']) {
      const v = document.querySelector(sel)?.content?.trim();
      if (v && v.length <= 40) t.add(v);
    }
    return [...t];
  }

  // Broken-string detection + masking of untranslatable values; returns items worth judging.
  function prepare(raw, p, termRe) {
    const keep = [];
    let ign = 0;
    for (const it of raw) {
      if (p.bugs) {
        const b = detectBug(it.text);
        if (b) { it.base = { v: 'bug', reason: b }; it.j = ''; it.len = it.text.length; keep.push(it); continue; }
      }
      if (p.hints) { const f = formatHints(it.text, p.lang); if (f.length) it.fmt = f; }
      const m = mask(it.text, p.lang, termRe);
      if (!/\p{L}{2}/u.test(m.text)) {
        if (/\p{L}/u.test(it.text)) ign++;
        if (it.fmt) { it.base = { v: 'ok' }; it.j = ''; it.len = 0; keep.push(it); }
        continue;
      }
      it.j = m.text; it.nameLike = m.nameLike; it.len = m.text.length;
      keep.push(it);
    }
    return { keep, ign };
  }

  // The full run of inline text around a fragment (e.g. the whole sentence around a <b> or <a>).
  function contextFor(node) {
    const gcs = (e) => (e.ownerDocument.defaultView || window).getComputedStyle(e);
    let b = node.parentElement;
    while (b && b.tagName !== 'BODY' && gcs(b).display.startsWith('inline')) b = b.parentElement;
    if (!b) return null;
    if (blockCache.has(b)) return blockCache.get(b);
    const parts = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1 && !SKIP.has(c.tagName.toUpperCase())) {
          if (gcs(c).display.startsWith('inline')) walk(c); else parts.push('. ');
        }
      }
    })(b);
    const text = clean(parts.join('')).slice(0, 500);
    blockCache.set(b, text);
    return text;
  }

  // ---------- Judging (via the background model, with a per-page verdict cache) ----------
  const ck = (t) => `${state.p.lang}|${state.p.related ? 1 : 0}|${(state.ctx?.sources || []).join(',')}|${t}`;

  async function ensureCtx(items) {
    if (state.ctx) return;
    const longest = [...new Set(items.map((i) => i.j))].filter((t) => t.length >= 30).sort((a, b) => b.length - a.length).slice(0, 40);
    const res = await send({ type: 'tc-classify', lang: state.p.lang, related: state.p.related, htmlLang: document.documentElement.lang, texts: [], ctxTexts: longest });
    if (!res || res.error) throw new Error(res?.error || 'The language engine did not respond. Try again.');
    state.ctx = res.ctx;
  }

  async function classifyTexts(texts) {
    const need = [...new Set(texts)].filter((t) => !vcache.has(ck(t)));
    for (let i = 0; i < need.length; i += 300) {
      const chunk = need.slice(i, i + 300);
      const res = await send({ type: 'tc-classify', lang: state.p.lang, related: state.p.related, ctx: state.ctx, texts: chunk });
      if (!res || res.error) throw new Error(res?.error || 'The language engine did not respond. Try again.');
      chunk.forEach((t, k) => vcache.set(ck(t), res.verdicts[k]));
      await tick(); // keep the page responsive
    }
  }

  // ---------- Source-language comparison (hreflang alternates, same-origin only) ----------
  function pickSource(lang) {
    const here = location.href.split('#')[0];
    const base = (h) => h.split('-')[0];
    const alts = [...document.querySelectorAll('link[rel~="alternate"][hreflang]')]
      .map((l) => ({ h: (l.getAttribute('hreflang') || '').toLowerCase(), href: l.href }))
      .filter((a) => a.href && a.href.split('#')[0] !== here && (a.h === 'x-default' || base(a.h) !== lang));
    const order = (a) => (a.h === 'x-default' ? 0 : base(a.h) === 'en' ? 1 : 2);
    return alts.sort((a, b) => order(a) - order(b))[0] || null;
  }

  async function loadSource(p) {
    const alt = pickSource(p.lang);
    if (!alt) return { info: { status: 'none' } };
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 7000);
      const res = await fetch(alt.href, { credentials: 'omit', signal: ctl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error('http');
      const html = await res.text();
      if (html.length > 4e6) throw new Error('large');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const set = new Set(), long = [];
      const w = doc.createTreeWalker(doc.body, 5, { acceptNode: (n) => (n.nodeType === 1 ? (SKIP.has(n.tagName.toUpperCase()) ? 2 : 3) : 1) });
      while (w.nextNode()) { const t = clean(w.currentNode.nodeValue || ''); if (t.length >= 2) { set.add(t.toLowerCase()); if (t.length >= 30) long.push(t); } }
      for (const el of doc.body.querySelectorAll('[placeholder],[alt],[title],[aria-label]')) {
        for (const a of ['placeholder', 'alt', 'title', 'aria-label']) { const t = clean(el.getAttribute(a) || ''); if (t.length >= 2) set.add(t.toLowerCase()); }
      }
      return { set, long: long.sort((a, b) => b.length - a.length).slice(0, 10), lang: (doc.documentElement.lang || '').toLowerCase().split('-')[0], info: { status: 'used', url: alt.href, lang: alt.h } };
    } catch (e) {
      return { info: { status: 'unavailable', url: alt.href } };
    }
  }

  async function usableSource(si) { // discard if that page is actually in the target language
    if (!si || !si.set) return null;
    if (si.lang && si.lang === state.p.lang) { si.info = { ...si.info, status: 'same-language' }; return null; }
    if (!si.lang && si.long.length) {
      await classifyTexts(si.long);
      const ok = si.long.filter((t) => vcache.get(ck(t))?.v === 'ok').length;
      if (ok / si.long.length >= 0.5) { si.info = { ...si.info, status: 'same-language' }; return null; }
    }
    return si;
  }

  async function judge(items) {
    const todo = items.filter((it) => !it.base);
    await ensureCtx(items);
    await classifyTexts(todo.map((it) => it.j));
    for (const it of todo) { // pass 1
      let v = vcache.get(ck(it.j));
      // Short capitalised phrases are often product/person names: weak evidence isn't enough to flag them.
      if (it.nameLike && v.v === 'bad' && v.reason !== 'Looks like English text') v = { v: 'unsure' };
      it.base = v;
    }
    // pass 2: fragments we couldn't judge inherit the verdict of the sentence they sit in
    const ctxFor = new Map();
    for (const it of todo) {
      if (it.base.v !== 'unsure' || it.kind !== 'text') continue;
      const raw = contextFor(it.node);
      const c = raw && mask(raw, state.p.lang, state.termRe).text;
      if (c && c.length > it.j.length + 3) ctxFor.set(it, c);
    }
    await classifyTexts([...ctxFor.values()]);
    for (const [it, c] of ctxFor) { const vc = vcache.get(ck(c)); if (vc.v !== 'unsure') it.base = { ...vc, via: 'context' }; }
    // pass 3: still unclear but identical to the source-language page → almost certainly untranslated
    const src = state.sourceInfo.status === 'used' ? state.source : null;
    if (src) {
      for (const it of todo) {
        if (it.base.v === 'unsure' && !it.nameLike && src.has(nk(it.text)) && (words(it.j) >= 2 || it.j.length >= 8)) {
          it.base = { v: 'bad', detected: state.sourceInfo.lang ? state.sourceInfo.lang.split('-')[0] : undefined, reason: 'Identical to the source-language page', via: 'source' };
        }
      }
    }
  }

  // Page-level tendency: if the page is clearly translated, unclear short strings almost certainly are too.
  function finalize() {
    let okC = 0, badC = 0;
    for (const it of state.items) { if (it.base.v === 'ok') okC += it.len; else if (it.base.v === 'bad') badC += it.len; }
    const tendency = okC + badC ? okC / (okC + badC) : null;
    const assume = state.p.mode === 'relaxed' || (state.p.mode === 'balanced' && tendency !== null && tendency >= 0.6);
    state.assumedN = 0;
    for (const it of state.items) {
      if (it.base.v === 'unsure' && assume) { it.v = { v: 'ok', assumed: true }; state.assumedN++; } else it.v = it.base;
    }
  }

  // ---------- Highlighting ----------
  const winOf = (n) => (n.ownerDocument || n).defaultView || window;
  const nodeOf = (it) => it.node || it.el;

  function ensureStyle(rootNode) {
    if (styled.has(rootNode)) return;
    const doc = rootNode.nodeType === 9 ? rootNode : rootNode.ownerDocument;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      ::highlight(tc-bad){background-color:rgba(255,214,0,.7);color:#111;text-decoration:underline wavy #d7263d}
      ::highlight(tc-unsure){background-color:rgba(80,140,255,.28);text-decoration:underline dotted #3b6df0}
      ::highlight(tc-bug){background-color:rgba(190,60,255,.45);color:#111;text-decoration:underline wavy #7a1fa2}
      ::highlight(tc-fmt){text-decoration:underline dotted #0f9d8a}
      ::highlight(tc-focus){background-color:#d7263d;color:#fff}
      [data-tc-flag="bad"]{outline:2px dashed #d7263d!important;outline-offset:2px!important}
      [data-tc-flag="unsure"]{outline:2px dotted #3b6df0!important;outline-offset:2px!important}
      [data-tc-flag="bug"]{outline:2px dashed #7a1fa2!important;outline-offset:2px!important}
      [data-tc-flag="fmt"]{outline:2px dotted #0f9d8a!important;outline-offset:2px!important}
      [data-tc-focus]{box-shadow:0 0 0 4px rgba(215,38,61,.5)!important}`;
    (rootNode.nodeType === 9 ? rootNode.head || rootNode.documentElement : rootNode).appendChild(s);
    styled.set(rootNode, s);
  }

  function marksFor(win) {
    let m = marks.get(win);
    if (!m) {
      m = { bad: new win.Highlight(), unsure: new win.Highlight(), bug: new win.Highlight(), fmt: new win.Highlight() };
      m.bug.priority = 5; m.bad.priority = 4; m.unsure.priority = 2; m.fmt.priority = 1;
      marks.set(win, m);
    }
    return m;
  }

  function resetMarks() {
    for (const win of marks.keys()) { try { KEYS.forEach((k) => win.CSS.highlights.delete(k)); } catch (e) { /* frame gone */ } }
    marks.clear();
    for (const root of state ? state.scope.roots : []) root.querySelectorAll?.('[data-tc-flag]').forEach((el) => el.removeAttribute('data-tc-flag'));
  }

  function render() {
    const p = state.p;
    resetMarks();
    targets.clear();
    const stats = { ok: 0, bad: 0, unsure: 0, bug: 0, fmt: 0, okN: 0, badN: 0, unsureN: 0, bugN: 0, fmtN: 0, assumedN: state.assumedN, ignoredN: state.ignoredN };
    const issues = [];
    let id = 0;
    const add = (it, verdict, reason, detected) => {
      const myId = ++id;
      targets.set(myId, it);
      const n = nodeOf(it);
      ensureStyle(n.getRootNode());
      if (it.kind === 'text') {
        const r = n.ownerDocument.createRange();
        r.selectNodeContents(n);
        const m = marksFor(winOf(n));
        if (verdict === 'unsure') { if (p.unsure) m.unsure.add(r); } else m[verdict].add(r);
      } else if (verdict !== 'unsure' || p.unsure) {
        const cur = n.getAttribute('data-tc-flag');
        if (!cur || RANK[verdict] > RANK[cur]) n.setAttribute('data-tc-flag', verdict);
      }
      issues.push({ id: myId, verdict, kind: it.kind, attr: it.attr, detected, reason: reason && it.v?.via === 'context' && verdict !== 'fmt' ? reason + ' (judged from the surrounding sentence)' : reason, text: it.text.slice(0, 300), len: it.len || it.text.length });
    };
    for (const it of state.items) {
      if (!nodeOf(it).isConnected) continue;
      const v = it.v;
      stats[v.v] += it.len; stats[v.v + 'N']++;
      if (v.v !== 'ok') add(it, v.v, v.reason, v.detected);
      if (p.hints && it.fmt) for (const f of it.fmt) { stats.fmtN++; add(it, 'fmt', f); }
    }
    for (const win of marks.keys()) {
      const m = marks.get(win), reg = win.CSS.highlights;
      if (m.bad.size) reg.set('tc-bad', m.bad);
      if (m.unsure.size) reg.set('tc-unsure', m.unsure);
      if (m.bug.size) reg.set('tc-bug', m.bug);
      if (m.fmt.size) reg.set('tc-fmt', m.fmt);
    }
    const order = { bug: 0, bad: 1, unsure: 2, fmt: 3 };
    issues.sort((a, b) => order[a.verdict] - order[b.verdict] || b.len - a.len);
    state.allIssues = issues.slice(0, 5000);
    const judged = stats.ok + stats.bad;
    last = {
      lang: p.lang, mode: p.mode, host: location.hostname, pageLang: document.documentElement.lang || '', stats,
      score: judged ? Math.round((stats.ok / judged) * 100) : null,
      issues: issues.slice(0, 300).map((i) => ({ ...i, text: i.text.slice(0, 160) })), truncated: Math.max(0, issues.length - 300),
      source: state.sourceInfo, live: !!observers.length,
    };
  }

  function announce(live) {
    quiet({ type: 'tc-badge', count: last ? last.stats.badN + last.stats.bugN : 0 });
    if (live) quiet({ type: 'tc-result', result: last });
  }

  function clearAll() {
    clearTimeout(timer); dirty.clear();
    observers.forEach((o) => o.disconnect()); observers = []; observed = new WeakSet();
    resetMarks();
    for (const s of styled.values()) s.remove();
    styled.clear(); targets.clear();
    state = null; last = null;
  }

  function focusIssue(id) {
    const t = targets.get(id);
    if (!t) return false;
    const n = nodeOf(t);
    const el = t.kind === 'text' ? n.parentElement || n.parentNode?.host : n;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (t.kind === 'text') {
      const win = winOf(n);
      const r = n.ownerDocument.createRange();
      r.selectNodeContents(n);
      const h = new win.Highlight(r);
      h.priority = 10;
      ensureStyle(n.getRootNode());
      win.CSS.highlights.set('tc-focus', h);
      setTimeout(() => win.CSS.highlights.delete('tc-focus'), 2200);
    } else if (el) {
      el.setAttribute('data-tc-focus', '');
      setTimeout(() => el.removeAttribute('data-tc-focus'), 2200);
    }
    return true;
  }

  function selectorOf(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 8) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift('#' + n.id); break; }
      let s = n.tagName.toLowerCase();
      const par = n.parentElement;
      if (par) { const sib = [...par.children].filter((c) => c.tagName === n.tagName); if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; }
      parts.unshift(s);
      if (!par) { const r = n.getRootNode(); if (r && r.host) { parts.unshift('::shadow'); n = r.host; continue; } }
      n = par;
    }
    return parts.join(' > ');
  }

  function exportData() {
    if (!state) return { issues: [] };
    return {
      url: location.href, title: document.title, lang: state.p.lang, generated: new Date().toISOString(), source: state.sourceInfo,
      issues: state.allIssues.map((i) => {
        const t = targets.get(i.id), n = t && nodeOf(t);
        return { ...i, selector: n ? selectorOf(t.kind === 'text' ? n.parentElement || n.parentNode?.host : n) : '' };
      }),
    };
  }

  // ---------- Live updates: re-judge only what changed ----------
  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') { const e = r.target.parentElement || r.target.parentNode?.host; if (e) dirty.add(e); }
        else {
          for (const n of r.addedNodes) { if (n.nodeType === 1 && n.id !== STYLE_ID) dirty.add(n); else if (n.nodeType === 3) dirty.add(r.target); }
          if (r.removedNodes.length) dirty.add(null); // forces a re-render so highlights on removed text disappear
        }
      }
      clearTimeout(timer);
      timer = setTimeout(refresh, 700);
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    observers.push(mo);
  }

  async function refresh() {
    if (!state) return;
    if (busy) { again = true; return; }
    busy = true;
    const my = seq;
    try {
      const roots = [...dirty].filter((e) => e && e.isConnected);
      dirty.clear();
      visCache = new WeakMap();
      state.items = state.items.filter((it) => nodeOf(it).isConnected && !roots.some((r) => r.contains(nodeOf(it))));
      const raw = [];
      for (const r of roots) await collectFrom(r, state.p, raw, state.scope);
      const { keep } = prepare(raw, state.p, state.termRe);
      state.items.push(...keep);
      await judge(keep);
      if (my !== seq || !state) return;
      finalize(); render();
      for (const r of state.scope.roots) observe(r);
      announce(true);
    } catch (e) { /* keep the previous result */ } finally {
      busy = false;
      if (again) { again = false; timer = setTimeout(refresh, 300); }
    }
  }

  // ---------- Scan ----------
  async function scan(params) {
    if (!(window.CSS && CSS.highlights && window.Highlight)) return { error: 'This browser is too old for the highlight API (needs Chrome 105+).' };
    if (!document.body) return { error: 'This page has no body to scan.' };
    const my = ++seq;
    clearAll();
    visCache = new WeakMap(); blockCache = new WeakMap();
    const p = {
      lang: params.lang, mode: params.mode || 'balanced', attrs: !!params.attrs, unsure: !!params.unsure,
      related: params.related !== false, ignore: params.ignore || [], hints: !!params.hints,
      bugs: params.bugs !== false, source: params.source !== false, live: params.live !== false,
    };
    state = { p, items: [], scope: { roots: new Set() }, ctx: null, ignoredN: 0, assumedN: 0, allIssues: [], source: null, sourceInfo: { status: p.source ? 'none' : 'off' },
      termRe: compileTerms([...p.ignore, ...siteTerms()]) };
    try {
      const srcP = p.source ? loadSource(p) : null; // runs while we collect
      const raw = [];
      await collectFrom(document.body, p, raw, state.scope);
      const { keep, ign } = prepare(raw, p, state.termRe);
      state.items = keep; state.ignoredN = ign;
      await ensureCtx(keep);
      if (srcP) {
        const si = await usableSource(await srcP);
        const res = await srcP;
        state.sourceInfo = res.info;
        if (si) state.source = si.set;
      }
      await judge(keep);
      if (my !== seq || !state) return { error: 'A newer check replaced this one.' };
      finalize(); render();
      if (p.live) for (const r of state.scope.roots) observe(r);
      last.live = !!observers.length;
      announce(false);
      return last;
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  api.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg?.type) {
      case 'scan': scan(msg).then(reply, (e) => reply({ error: String(e) })); return true;
      case 'clear': clearAll(); announce(false); reply({ ok: true }); break;
      case 'focus': reply({ ok: focusIssue(msg.id) }); break;
      case 'status': reply({ result: last }); break;
      case 'export': reply(exportData()); break;
      default: break;
    }
    return false;
  });

  // Sites the user opted in to are checked automatically after load.
  (async () => {
    try {
      const d = await api.storage.local.get(['opts', 'autoSites', 'ignore']);
      if (!d || !d.opts || !(d.autoSites || []).includes(location.hostname)) return;
      await new Promise((r) => setTimeout(r, 1200));
      const ig = d.ignore || {};
      await scan({ ...d.opts, live: true, ignore: [...(ig.global || []), ...((ig.sites || {})[location.hostname] || [])] });
    } catch (e) { /* storage unavailable */ }
  })();
})();
