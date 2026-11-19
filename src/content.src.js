// Translation Check — page-side scanner (injected on demand via activeTab, or automatically on opted-in sites).
// Language judgement happens in the background worker (one shared model); this script only collects,
// masks, highlights and reports.
import { mask, compileTerms } from './mask.js';
import { detectBug, formatHints } from './rules.js';
import { describe, contextLine, slotOf } from './context.js';
import { matcher } from './learn.js';
import { nonLatinTarget, latinOnly } from './scripts.js';

(() => {
  if (window.__tcLoaded) return;
  window.__tcLoaded = true;
  const api = globalThis.chrome?.runtime?.id ? globalThis.chrome : (globalThis.browser ?? globalThis.chrome); // see popup.js

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'SVG', 'MATH', 'TEMPLATE', 'IFRAME', 'CANVAS']);
  const SKIP_SEL = 'script,style,noscript,code,pre,kbd,samp,textarea,svg,math,template,iframe,canvas';
  const NO_TRANSLATE = '[translate="no"],.notranslate,[contenteditable=""],[contenteditable="true"]';
  const URLISH = /^(https?:\/\/|www\.)\S+$|^\S+@\S+\.\S+$/i;
  const MAX_ITEMS = 6000;
  const ACCOUNT = /(admin|user|employee|manager|staff|test|demo|dev|support|team|bot|guest|owner|member|agent|trainer|trainee)/;
  // Every copy of this script marks the page under its own private names. A copy from before an extension update keeps running in tabs that
  // were not reloaded and its marks outlive it, so they must never share names with the current check (see purgeForeign).
  // 2.0.6 marks under "tc2-" names and data-tc2-* attributes. Older copies sweep away every mark named "tc-…" that isn't theirs on each live
  // update; under the old names a stale copy in a tab that wasn't reloaded erased this check's highlights as soon as the page changed.
  const NS = 'tc2-' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const A_STYLE = 'data-tc2-style', A_FLAG = 'data-tc2-flag', A_FOCUS = 'data-tc2-focus';
  const K = { bad: NS + '-bad', unsure: NS + '-unsure', bug: NS + '-bug', fmt: NS + '-fmt', focus: NS + '-focus' };
  const MARK_KEY = /^tc2?-(?:[a-z0-9]{6}-)?(?:bad|unsure|bug|fmt|spell|layout|focus)$/; // names any version of this extension has used (spell/layout: older 2.0.6 builds)
  const RANK = { fmt: 1, unsure: 2, bad: 3, bug: 4 };
  // Hints that never change whether text counts as translated: listed in their own tab, not in the score or the toolbar badge.
  const HINTS = new Set(['fmt']);

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const clean = (s) => s.replace(/\s+/g, ' ').trim();
  const words = (s) => (s.match(/\p{L}+/gu) || []).length;
  const otherVotes = (v) => (v && v.votes ? ['cld3', 'franc', 'tinyld'].filter((k) => v.votes[k] === 'other').length : 0);
  const nk = (s) => clean(s).toLowerCase();
  const send = (m) => { try { const p = api.runtime.sendMessage(m); return p && p.then ? p : Promise.resolve(p); } catch (e) { return Promise.reject(e); } };
  const quiet = (m) => send(m).catch(() => {});

  let state = null, last = null, seq = 0, busy = false, again = false, timer = 0, firstChange = 0, langDirty = false, sweeping = 0;
  let visCache = new WeakMap(), blockCache = new WeakMap(), ctxCache = new WeakMap();
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
  // Tooltips that are hidden until hover (`hidden group-hover:block`, `invisible`, a role="tooltip" box, the target of aria-describedby)
  // are still interface text: they are checked while hidden, so every tooltip is covered whether or not it happens to be open.
  // Only the tooltip box itself may be hidden; the element it belongs to must be on screen (a tooltip in a closed tab is skipped).
  const TIP_SEL = '[role="tooltip"],[class*="tooltip" i],[class*="popover" i],[class*="tippy" i],[class*="hovercard" i],' +
    '[class*="group-hover:"],[class*="peer-hover:"],[class*="group-focus"],[class*="peer-focus"]';
  let describedIds = new Set();
  function tipBox(el) {
    if (!el || !el.closest) return null;
    let c = el.closest(TIP_SEL);
    if (!c && describedIds.size) for (let e = el, k = 0; e && k < 5; e = e.parentElement, k++) if (e.id && describedIds.has(e.id)) { c = e; break; }
    if (!c || visible(c)) return null;
    const host = c.parentElement;
    return host && host.tagName !== 'BODY' && visible(host) ? c : null;
  }
  // Tooltips that exist only while open (Radix / shadcn, and libraries built the same way): during a check each tooltip button is focused for
  // a moment, as a keyboard user would, its text is read through aria-describedby, and focus goes back. The text is listed as the button's
  // tooltip, so it stays listed after the tooltip closes. The open tooltip's own text is then not counted a second time.
  const TIP_TRIGGER = '[data-state="closed"],[data-state="delayed-open"],[data-state="instant-open"]';
  const NOT_TIP_ROLE = new Set(['tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio', 'switch', 'treeitem', 'combobox']);
  const isTipTrigger = (e) => !e.hasAttribute('aria-expanded') && !e.hasAttribute('aria-haspopup') && !e.hasAttribute('aria-controls') &&
    !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(e.tagName) && !e.isContentEditable && !NOT_TIP_ROLE.has(e.getAttribute('role') || '') &&
    !e.closest('[role="tooltip"],[data-radix-popper-content-wrapper]');
  const inOpenTip = (el) => { const w = el && el.closest && el.closest('[data-radix-popper-content-wrapper]'); return !!(w && w.querySelector('[role="tooltip"]')); };
  const settle = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 80); });
  async function readTooltips(root, p, out) {
    if (!root.querySelectorAll) return;
    const doc = root.ownerDocument || root;
    const trig = [...root.querySelectorAll(TIP_TRIGGER)].filter((e) => isTipTrigger(e) && !blocked(e) && visible(e)).slice(0, 300);
    if (!trig.length) return;
    const prev = doc.activeElement;
    sweeping++;
    try {
      for (const e of trig) {
        if (out.length >= MAX_ITEMS) break;
        let text = '';
        try {
          e.focus({ preventScroll: true });
          await settle();
          const id = e.getAttribute('aria-describedby');
          const tip = id && doc.getElementById(id);
          if (tip && tip.getAttribute('role') === 'tooltip') text = clean(tip.textContent || '');
        } catch (err) { /* a button that can't take focus */ }
        try { e.blur(); } catch (err) { /* ignore */ }
        if (text && collectable(text, p)) out.push({ kind: 'attr', attr: 'tooltip', text, el: e });
      }
    } finally {
      try { if (prev && prev !== doc.body && prev.isConnected && prev.focus) prev.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      await settle();
      observers.forEach((o) => o.takeRecords()); // the tooltips we opened and closed are not page changes
      sweeping--;
    }
  }
  const TIP_ATTRS = ['data-tooltip', 'data-tip', 'data-tippy-content', 'data-bs-original-title', 'data-original-title'];
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
      if (!collectable(text, p)) continue;
      const parent = node.parentElement || node.parentNode?.host;
      if (inOpenTip(parent)) continue; // read from its button (readTooltips)
      if (visible(parent)) out.push({ kind: 'text', text, node });
      else { const box = tipBox(parent); if (box) out.push({ kind: 'text', text, node, tip: box }); }
    }
    if (p.attrs && root.querySelectorAll) {
      const sel = '[placeholder],[alt],[title],[aria-label],input[type=submit],input[type=button],' + TIP_ATTRS.map((a) => `[${a}]`).join(',');
      for (const el of root.querySelectorAll(sel)) {
        if (out.length >= MAX_ITEMS) break;
        if (blocked(el) || !visible(el)) continue;
        for (const attr of ['placeholder', 'alt', 'title', 'aria-label', 'value', ...TIP_ATTRS]) {
          if (attr === 'value' && !/^(submit|button)$/.test(el.type || '')) continue;
          const text = clean(el.getAttribute(attr) || '');
          if (collectable(text, p)) out.push({ kind: 'attr', attr, text, el });
        }
      }
    }
    await readTooltips(root, p, out);
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
      // learned from earlier Ignore clicks (codes, versions, a page slot such as `span.user-name`): skipped like ignored terms
      if (state.learnMatch(it.text, it.el || it.node.parentElement || it.node.parentNode?.host)) { state.learnedN++; continue; }
      if (p.bugs) {
        const b = detectBug(it.text);
        if (b) { it.base = { v: 'bug', reason: b }; it.j = ''; it.len = it.text.length; keep.push(it); continue; }
      }
      if (p.hints) { const f = formatHints(it.text, p.lang); if (f.length) it.fmt = f; }
      let m = mask(it.text, p.lang, termRe);
      // On a page in another script, a one-word BrandCase title ("HomeIoT", "TrueCost") is judged as it is instead of being skipped as a brand:
      // built-in brands (WhatsApp, YouTube…) are still recognised as names, anything else is listed for a decision.
      if (p.lang !== 'en' && latinOnly(it.text) && !(termRe && termRe.test(it.text))) {
        if (!/\p{L}{2}/u.test(m.text) && /^[A-Z]?[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(it.text)) { m = { text: it.text, nameLike: true }; it.title = true; }
        // a short title that masking cut down to one word ("Home IOT" -> "Home") is judged whole: the single word left says nothing
        else if (!nonLatinTarget(p.lang) && m.removed && words(it.text) >= 2 && words(it.text) <= 4 && words(m.text) === 1 && !/\d/.test(it.text)) { it.jPart = m.text; m = { text: it.text, nameLike: true }; it.title = true; }
      }
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

  // The nearest section around a lone label: climb from its element until the other text there (the label itself left out) is enough for the
  // models to read, e.g. the other cards of a list, the rest of a form or panel. Used when a single word has no sentence around it.
  const SECTION_MIN = 80, SECTION_MAX = 600;
  function sectionFor(el, self) {
    if (!el) return null;
    let anc = el;
    for (let depth = 0; depth < 8; depth++) {
      anc = anc.parentElement;
      if (!anc || anc.tagName === 'BODY' || anc.tagName === 'HTML') return null;
      const parts = [];
      let len = 0, letters = 0;
      const tw = document.createTreeWalker(anc, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n === self || el.contains(n) || SKIP.has(n.parentElement?.tagName?.toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = tw.nextNode(); n && len < SECTION_MAX; n = tw.nextNode()) {
        const t = clean(n.nodeValue);
        if (!t) continue;
        parts.push(t); len += t.length + 2; letters += (t.match(/\p{L}/gu) || []).length;
      }
      if (letters >= SECTION_MIN) return parts.join('. ').slice(0, SECTION_MAX);
    }
    return null;
  }

  // ---------- Judging (via the background model, with a per-page verdict cache) ----------
  const ck = (t) => `${state.p.lang}|${state.p.related ? 1 : 0}|${state.p.verify ? 1 : 0}|${(state.ctx?.sources || []).join(',')}|${t}`;

  async function ensureCtx(items) {
    if (state.ctx) return;
    const longest = [...new Set(items.map((i) => i.j))].filter((t) => t.length >= 30).sort((a, b) => b.length - a.length).slice(0, 40);
    const res = await send({ type: 'tc-classify', lang: state.p.lang, related: state.p.related, verify: state.p.verify, htmlLang: document.documentElement.lang, texts: [], ctxTexts: longest });
    if (!res || res.error) throw new Error(res?.error || 'The language engine did not respond. Try again.');
    state.ctx = res.ctx; state.models = res.models;
  }

  async function classifyTexts(texts) {
    const need = [...new Set(texts)].filter((t) => !vcache.has(ck(t)));
    for (let i = 0; i < need.length; i += 300) {
      const chunk = need.slice(i, i + 300);
      const res = await send({ type: 'tc-classify', lang: state.p.lang, related: state.p.related, verify: state.p.verify, ctx: state.ctx, texts: chunk });
      if (!res || res.error) throw new Error(res?.error || 'The language engine did not respond. Try again.');
      chunk.forEach((t, k) => vcache.set(ck(t), res.verdicts[k]));
      state.models = res.models || state.models;
      await tick(); // keep the page responsive
    }
  }

  // ---------- Source-language comparison (hreflang alternates, same-origin only) ----------
  function pickSource(lang) {
    // Only an English or x-default alternate can be a "source". Any other language (e.g. the first hreflang listed) is not.
    const here = location.href.split('#')[0];
    const base = (h) => h.split('-')[0];
    const alts = [...document.querySelectorAll('link[rel~="alternate"][hreflang]')]
      .map((l) => ({ h: (l.getAttribute('hreflang') || '').toLowerCase(), href: l.href }))
      .filter((a) => a.href && a.href.split('#')[0] !== here && (a.h === 'x-default' || base(a.h) === 'en') && base(a.h) !== lang);
    const order = (a) => (a.h === 'x-default' ? 0 : 1);
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
      return { set, long: long.sort((a, b) => b.length - a.length).slice(0, 10), lang: (doc.documentElement.lang || '').toLowerCase().split('-')[0], info: { status: 'used', url: alt.href, lang: (doc.documentElement.lang || (alt.h === 'x-default' ? '' : alt.h)).toLowerCase() } };
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
    await classifyTexts([...todo.map((it) => it.j), ...todo.filter((it) => it.jPart).map((it) => it.jPart)]);
    // On a page written in another script (Hindi, Arabic, Russian…), Latin-letter text can never be in the page's language, whatever surrounds it.
    const otherScript = nonLatinTarget(state.p.lang);
    for (const it of todo) { // pass 1
      let v = vcache.get(ck(it.j));
      it.wrongScript = otherScript && latinOnly(it.j);
      // Short capitalised phrases are often product/person names: weak evidence isn't enough to flag them
      // (unless every word is plain interface vocabulary, like "Order History": that is a label, not a name).
      if (it.nameLike && v.v === 'bad' && !v.label && v.reason !== 'Looks like English text') {
        // a possible name or title: not a warning on this evidence, but listed with its votes (never silently counted as translated)
        v = { v: 'unsure', reason: it.wrongScript ? 'Name or title? Latin letters on a page in another script' : 'Name or title? Two language models read it as English', votes: v.votes, detected: v.detected };
      }
      // a lowercase account ID ("jeffemployee", "vasu.k", "user_42"): data rather than text to translate. It needs an ID's tell (digits or
      // separators, an account word, or a length no ordinary word has), so a foreign word such as "ahora" or "cancelar" is still listed.
      if ((it.wrongScript || (state.p.lang !== 'en' && latinOnly(it.j))) && v.v === 'unsure' && !v.enVocab && /^[a-z][a-z0-9._-]{4,}$/.test(it.j) && (/[0-9._-]/.test(it.j) || ACCOUNT.test(it.j) || it.j.length >= 13)) {
        v = { v: 'name', reason: 'Looks like a user name or ID', kind: 'id' };
      }
      if (it.wrongScript && v.v === 'unsure' && !v.reason) v = { ...v, reason: 'Name or title? Latin letters on a page in another script' };
      // a title kept whole ("HomeIoT", "Åbn Playground") is not hidden as a name for its shape alone; names from the built-in lists (kind) still are
      if (it.title && v.v === 'name' && !v.kind) v = { v: 'unsure', votes: v.votes };
      // judged whole, it can never come out better than before: if the whole title reads as translated, the verdict on what masking left stands
      if (it.jPart && v.v === 'ok') { v = vcache.get(ck(it.jPart)); it.title = false; }
      // Held: what two models read as English on a non-English page (English is where untranslated text comes from), and Latin letters on a page
      // in another script. Its own evidence decides: never cleared by its section, its sentence or the page average, so every copy of the same
      // text gets the same verdict. Words genuinely shared with the target language ("Status" on a German page) are not held.
      // (a short-word guard keeps the models' reading under "was"; shared vocabulary is protected only while the models are split, not when all three agree)
      const leanEn = (v.detected || v.other || v.was?.detected) === 'en' || v.enVocab;
      const ov = otherVotes(v);
      // (titles are written in title case, "Skill Scout"; a native phrase in sentence case, "Persona standard", is not held)
      const latinPage = state.p.lang !== 'en' && latinOnly(it.j), n = words(it.j);
      it.hold = it.wrongScript || (latinPage && v.v === 'unsure' && (it.title || (it.nameLike && n >= 2 && ov >= 2 && leanEn && (!v.shared || ov === 3))));
      // a single unknown capitalised word ("Wisight", "Truecost") reads like "Thema" to the models; it is held only if it sits in the same page slot
      // as held titles (see below), i.e. it is one more title in a column or a set of cards of titles
      it.titleWord = latinPage && !it.hold && v.v === 'unsure' && n === 1 && /^\p{Lu}/u.test(it.j) && !v.enVocab && !v.shared && ov >= 1 && leanEn;
      if (it.hold && v.v === 'unsure' && (!v.reason || it.title)) v = { ...v, reason: ov >= 2 && leanEn ? 'Name or title? Two language models read it as English' : 'Name or title? Could be untranslated' };
      it.base = v;
    }
    // pass 1b: titles in the same slot (same element and class: a table column of project names, a set of cards) are judged together
    if (todo.some((it) => it.titleWord)) {
      const elOf = (it) => (it.kind === 'text' ? it.node.parentElement || it.node.parentNode?.host : it.el);
      const titleSlots = new Set();
      for (const it of todo) {
        const titleish = it.hold || (it.base.v === 'bad' && it.nameLike && words(it.j) >= 2);
        if (!titleish || it.wrongScript) continue;
        const sl = slotOf(elOf(it)); if (sl) titleSlots.add(sl);
      }
      for (const it of todo) {
        if (!it.titleWord) continue;
        const sl = slotOf(elOf(it));
        if (sl && titleSlots.has(sl)) { it.hold = true; it.base = { ...it.base, reason: 'Name or title? Two language models read it as English, like the other titles here' }; }
      }
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
    // (a sentence may flag Latin letters on a page in another script, but never clear them)
    for (const [it, c] of ctxFor) { const vc = vcache.get(ck(c)); if (vc.v !== 'unsure' && !(it.hold && vc.v !== 'bad')) it.base = { ...vc, via: 'context' }; }
    // pass 2b: a lone word or label still unclear ("Empathie" alone in a card) is read with its section. If the section around it is clearly in
    // the page's language, the label is too, unless it is plain English on a non-English page or two models read it as another language.
    const secFor = new Map();
    for (const it of todo) {
      if (it.base.v !== 'unsure' || it.base.enVocab || it.base.via || it.hold) continue;
      const v = it.base.votes, other = v ? ['cld3', 'franc', 'tinyld'].filter((k) => v[k] === 'other').length : 0;
      if (other >= 2) continue;
      const raw = it.kind === 'attr' ? sectionFor(it.el, null) : sectionFor(it.node.parentElement, it.node);
      const c = raw && mask(raw, state.p.lang, state.termRe).text;
      if (c && (c.match(/\p{L}/gu) || []).length >= SECTION_MIN) secFor.set(it, c);
    }
    await classifyTexts([...new Set(secFor.values())]);
    for (const [it, c] of secFor) { if (vcache.get(ck(c))?.v === 'ok') it.base = { v: 'ok', via: 'section' }; }
    // pass 3: still unclear but identical to the source-language page → almost certainly untranslated
    const src = state.sourceInfo.status === 'used' ? state.source : null;
    if (src) {
      for (const it of todo) {
        // Identical text proves little on its own for short phrases (French/English share "active", "archive", "message"…):
        // short ones also need two of the models to read them as another language.
        const v = it.base.votes, leaning = v ? ['cld3', 'franc', 'tinyld'].filter((k) => v[k] === 'other').length : 0;
        // (one or two short words never count as backed: models readily "agree" on cognates such as "Archives")
        const shortStr = words(it.j) <= 2 && (it.j.match(/\p{L}/gu) || []).length < 16;
        const longEnough = words(it.j) >= 4, backed = leaning >= 2 && it.j.length >= 8 && !shortStr;
        if (it.base.v === 'unsure' && !it.nameLike && src.has(nk(it.text)) && (longEnough || backed)) {
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
    if (state.p.confirmedOnly && state.p.verify) {
      for (const it of state.items) if (it.base.v === 'bad' && it.base.votes && !it.base.confirmed) it.base = { v: 'unsure', reason: 'Not confirmed by a second model', votes: it.base.votes };
    }
    for (const it of state.items) {
      // (Latin letters on a page in another script are never assumed translated)
      if (it.base.v === 'unsure' && assume && !it.hold) { it.v = { v: 'ok', assumed: true }; state.assumedN++; } else it.v = it.base;
    }
    // Text the person marked as untranslated (from the Unclear list) is listed as untranslated on every check, whatever the models say.
    const marked = new Set(state.p.marked.map(nk));
    if (marked.size) {
      for (const it of state.items) {
        if (it.v.v === 'bad' || it.v.v === 'bug' || !marked.has(nk(it.text))) continue;
        if (it.v.assumed) state.assumedN--;
        it.v = { ...it.v, v: 'bad', assumed: false, marked: true, reason: 'Marked untranslated by you' };
      }
    }
  }

  // ---------- Highlighting ----------
  const winOf = (n) => (n.ownerDocument || n).defaultView || window;
  const nodeOf = (it) => it.node || it.el;

  function ensureStyle(rootNode) {
    if (styled.has(rootNode)) return;
    const doc = rootNode.nodeType === 9 ? rootNode : rootNode.ownerDocument;
    const s = doc.createElement('style');
    s.setAttribute(A_STYLE, NS);
    s.textContent = `
      ::highlight(${K.bad}){background-color:#ffd600;color:#111;text-decoration:underline wavy #d7263d}
      ::highlight(${K.unsure}){background-color:rgba(80,140,255,.28);text-decoration:underline dotted #3b6df0}
      ::highlight(${K.bug}){background-color:rgba(190,60,255,.45);color:#111;text-decoration:underline wavy #7a1fa2}
      ::highlight(${K.fmt}){text-decoration:underline dotted #0f9d8a}
      ::highlight(${K.focus}){background-color:#d7263d;color:#fff}
      [${A_FLAG}="${NS}:bad"]{outline:2px dashed #d7263d!important;outline-offset:2px!important}
      [${A_FLAG}="${NS}:unsure"]{outline:2px dotted #3b6df0!important;outline-offset:2px!important}
      [${A_FLAG}="${NS}:bug"]{outline:2px dashed #7a1fa2!important;outline-offset:2px!important}
      [${A_FLAG}="${NS}:fmt"]{outline:2px dotted #0f9d8a!important;outline-offset:2px!important}
      [${A_FOCUS}="${NS}"]{box-shadow:0 0 0 4px rgba(215,38,61,.5)!important}`;
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
    for (const win of marks.keys()) { try { Object.values(K).forEach((k) => win.CSS.highlights.delete(k)); } catch (e) { /* frame gone */ } }
    marks.clear();
    for (const root of state ? state.scope.roots : []) root.querySelectorAll?.(`[${A_FLAG}^="${NS}:"]`).forEach((el) => el.removeAttribute(A_FLAG));
  }

  // Removes whatever an older copy of this script left on the page: its highlights, its style sheet and its outlines. That copy keeps running in
  // tabs that were not reloaded after the extension was updated, can no longer be reached, and would otherwise leave marks on text that this
  // check found to be fine. Only names this extension ever used are touched; the page's own highlights are left alone.
  function purgeForeign() {
    const docs = new Set([document]), wins = new Set([window]);
    for (const r of state ? state.scope.roots : []) {
      const d = r.ownerDocument || r;
      docs.add(d); if (r.nodeType === 11) docs.add(r);
      if (d.defaultView) wins.add(d.defaultView);
    }
    for (const w of wins) {
      try { const reg = w.CSS.highlights; for (const k of [...reg.keys()]) if (MARK_KEY.test(k) && !k.startsWith(NS + '-')) reg.delete(k); } catch (e) { /* frame gone */ }
    }
    for (const d of docs) {
      // older versions' names (always someone else's) and this version's names when another copy left them
      d.querySelectorAll?.(`style#tc-style,style[data-tc-style],[data-tc-flag],[data-tc-focus],style[${A_STYLE}],[${A_FLAG}],[${A_FOCUS}]`).forEach((el) => {
        if (el.localName === 'style') { if (el.getAttribute(A_STYLE) !== NS) el.remove(); return; }
        el.removeAttribute('data-tc-flag'); el.removeAttribute('data-tc-focus');
        if (el.hasAttribute(A_FLAG) && !el.getAttribute(A_FLAG).startsWith(NS + ':')) el.removeAttribute(A_FLAG);
        if (el.hasAttribute(A_FOCUS) && el.getAttribute(A_FOCUS) !== NS) el.removeAttribute(A_FOCUS);
      });
    }
  }

  function render() {
    const p = state.p;
    resetMarks();
    purgeForeign();
    targets.clear();
    const stats = { ok: 0, bad: 0, unsure: 0, bug: 0, fmt: 0, name: 0, okN: 0, badN: 0, unsureN: 0, bugN: 0, fmtN: 0, nameN: 0, assumedN: state.assumedN, ignoredN: state.ignoredN, learnedN: state.learnedN };
    const issues = [];
    let id = 0;
    const add = (it, verdict, reason, detected, extra) => {
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
        const cur = (n.getAttribute(A_FLAG) || '').replace(NS + ':', '');
        if (!RANK[cur] || RANK[verdict] > RANK[cur]) n.setAttribute(A_FLAG, NS + ':' + verdict);
      }
      const hint = HINTS.has(verdict);
      issues.push({ id: myId, verdict, kind: it.kind, attr: it.attr, detected, votes: hint ? undefined : it.v?.votes, confirmed: !hint && !!it.v?.confirmed, marked: !hint && !!it.v?.marked, reason: reason && it.v?.via === 'context' && !hint ? reason + ' (judged from the surrounding sentence)' : reason, text: it.text.slice(0, 300), len: it.len || it.text.length, ...extra });
    };
    for (const it of state.items) {
      if (!nodeOf(it).isConnected) continue;
      const v = it.v;
      stats[v.v] += it.len; stats[v.v + 'N']++;
      if (v.v !== 'ok' && v.v !== 'name') add(it, v.v, v.reason, v.detected); // names are counted, never highlighted
      if (p.hints && it.fmt) for (const f of it.fmt) { stats.fmtN++; add(it, 'fmt', f); }
    }
    for (const win of marks.keys()) {
      const m = marks.get(win), reg = win.CSS.highlights;
      for (const k of ['bad', 'unsure', 'bug', 'fmt']) if (m[k].size) reg.set(K[k], m[k]);
    }
    const order = { bug: 0, bad: 1, unsure: 2, fmt: 3 };
    const groups = group(issues);
    groups.sort((a, b) => order[a.verdict] - order[b.verdict] || b.len - a.len);
    state.allIssues = groups.slice(0, 5000);
    for (const g of groups.slice(0, 300)) withContext(g, 12);
    const judged = stats.ok + stats.bad;
    last = {
      lang: p.lang, requested: p.requested, mode: p.mode, host: location.hostname, pageLang: document.documentElement.lang || '', stats, auto: state.auto,
      score: judged ? Math.round((stats.ok / judged) * 100) : null,
      issues: groups.slice(0, 300).map((i) => ({ ...i, text: i.text.slice(0, 160) })), truncated: Math.max(0, groups.length - 300),
      source: state.sourceInfo, models: state.models, live: !!observers.length,
    };
  }

  // ---------- Grouping: one item per identical string, mapped to every place it appears ----------
  // Same verdict and same text (case and spacing ignored); hints also need the same reason. The score is counted per occurrence (above),
  // so grouping only changes how the list is shown.
  function group(issues) {
    const by = new Map();
    for (const i of issues) {
      const k = `${i.verdict}|${HINTS.has(i.verdict) ? i.reason : ''}|${clean(i.text)}`;
      const g = by.get(k);
      if (!g) { by.set(k, { ...i, count: 1, occ: [{ id: i.id, kind: i.kind, attr: i.attr }] }); continue; }
      g.count++; g.len += i.len;
      g.occ.push({ id: i.id, kind: i.kind, attr: i.attr });
      if (g.confirmed === false && i.confirmed) { g.confirmed = true; g.votes = i.votes; } // the strongest evidence among the copies
    }
    return [...by.values()];
  }

  // Context: where each copy sits (element kind, page region, heading, text around it), for the first `limit` copies.
  function contextOf(id) {
    const t = targets.get(id);
    if (!t) return null;
    const n = nodeOf(t);
    const el = t.kind === 'text' ? n.parentElement || n.parentNode?.host : n;
    if (!el) return null;
    const ck = t.kind === 'attr' ? el : n;
    let c = ctxCache.get(ck);
    if (!c) {
      c = describe(t.kind === 'text' ? n : null, el, t.kind === 'attr' ? t.attr : undefined);
      if (t.tip && c) c = { ...c, kind: 'tooltip (shown on hover)' };
      ctxCache.set(ck, c);
    }
    return c;
  }
  function withContext(g, limit) {
    g.occ.forEach((o, k) => {
      if (k >= limit || o.where !== undefined) return;
      const c = contextOf(o.id);
      o.where = contextLine(c); o.before = c?.before || ''; o.after = c?.after || '';
      if (k === 0) { g.context = c ? { kind: c.kind, region: c.region, heading: c.heading, label: c.label, before: c.before, after: c.after, path: c.path } : null; g.slot = c?.slot || ''; }
    });
    return g;
  }

  function announce(live) {
    quiet({ type: 'tc-badge', count: last ? last.stats.badN + last.stats.bugN : 0 });
    if (live) quiet({ type: 'tc-result', result: last });
  }

  function clearAll() {
    clearTimeout(timer); firstChange = 0; dirty.clear(); unfocus();
    observers.forEach((o) => o.disconnect()); observers = []; observed = new WeakSet();
    resetMarks();
    purgeForeign();
    for (const s of styled.values()) s.remove();
    styled.clear(); targets.clear();
    state = null; last = null; ctxCache = new WeakMap();
  }

  // One "you are here" mark at a time. Each jump clears the previous one first, so a quick second click is never undone by the first click's
  // timer (that used to delete the new mark early, so stepping through copies showed nothing). The mark stays for a few seconds.
  let focused = null;
  function unfocus() {
    if (!focused) return;
    clearTimeout(focused.timer);
    try { focused.win.CSS.highlights.delete(K.focus); } catch (e) { /* frame gone */ }
    focused.el?.removeAttribute(A_FOCUS);
    focused = null;
  }
  function focusIssue(id) {
    const t = targets.get(id);
    if (!t) return false;
    const n = nodeOf(t);
    if (!n.isConnected) return false;
    unfocus();
    const el = t.kind === 'text' ? n.parentElement || n.parentNode?.host : n;
    const win = winOf(n);
    focused = { win, el: null, timer: 0 };
    const host = t.tip && !(t.tip.checkVisibility ? t.tip.checkVisibility({ visibilityProperty: true }) : t.tip.getClientRects().length) && t.tip.parentElement; // a tooltip that is closed: point at what it belongs to
    if (host) {
      host.scrollIntoView({ block: 'center', behavior: 'smooth' });
      ensureStyle(host.getRootNode());
      host.setAttribute(A_FOCUS, NS);
      focused.el = host;
    } else el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (host) { /* outlined above */ } else if (t.kind === 'text') {
      const r = n.ownerDocument.createRange();
      r.selectNodeContents(n);
      const h = new win.Highlight(r);
      h.priority = 10;
      ensureStyle(n.getRootNode());
      win.CSS.highlights.set(K.focus, h);
    } else if (el) {
      ensureStyle(el.getRootNode());
      el.setAttribute(A_FOCUS, NS);
      focused.el = el;
    }
    focused.timer = setTimeout(unfocus, 6000);
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
      issues: state.allIssues.map((g) => {
        withContext(g, Infinity);
        const sel = (id) => { const t = targets.get(id), n = t && nodeOf(t); return n ? selectorOf(t.kind === 'text' ? n.parentElement || n.parentNode?.host : n) : ''; };
        const occurrences = g.occ.map((o) => ({ selector: sel(o.id), where: o.where, before: o.before, after: o.after, kind: o.kind, attr: o.attr }));
        return { ...g, selector: occurrences[0]?.selector || '', occurrences };
      }),
    };
  }

  // ---------- "Page's own language": declared, unless the page's text is clearly in another language (see pageLanguage in the worker) ----------
  async function pageLanguage(texts, declared) {
    const long = [...new Set(texts)].filter((t) => t.length >= 30).sort((a, b) => b.length - a.length).slice(0, 80);
    let r = null;
    try { r = await send({ type: 'tc-pagelang', texts: long, declared }); } catch (e) { /* older worker */ }
    return r && 'lang' in r ? r : { lang: declared, declared, detected: '', share: 0 };
  }
  // In live mode, a change of <html lang> also counts as a page change (some apps do update it when the interface language switches).
  function watchLang() {
    const mo = new MutationObserver(() => { if (orphaned()) return retire(); dirty.add(null); langDirty = true; schedule(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    observers.push(mo);
  }

  // ---------- Live updates: re-judge only what changed ----------
  // A check runs once the page has been quiet for QUIET ms, and never later than MAX_WAIT ms after the first change: pages with a ticking
  // clock or live counters ("Zuletzt aktualisiert …", "vor 3 Sekunden") change all the time, and a plain "wait until quiet" never ran there.
  const QUIET = 250, MAX_WAIT = 800;
  function schedule() {
    const now = Date.now();
    if (!firstChange) firstChange = now;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; firstChange = 0; refresh(); }, Math.max(0, Math.min(QUIET, firstChange + MAX_WAIT - now)));
  }
  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    const mo = new MutationObserver((records) => {
      if (orphaned()) return retire();
      if (sweeping) return; // our own opening and closing of tooltips
      for (const r of records) {
        if (r.type === 'characterData') { const e = r.target.parentElement || r.target.parentNode?.host; if (e) dirty.add(e); }
        else {
          for (const n of r.addedNodes) { if (n.nodeType === 1 && !n.hasAttribute(A_STYLE)) dirty.add(n); else if (n.nodeType === 3) dirty.add(r.target); }
          if (r.removedNodes.length) dirty.add(null); // forces a re-render so highlights on removed text disappear
        }
      }
      schedule();
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    observers.push(mo);
  }

  // After the extension is reloaded or updated, this copy keeps running in the tab but can no longer reach the extension. It then stops for
  // good: no more live re-checks and no more sweeping, so it can never touch the marks of the copy that replaced it.
  const BORN_AS = (() => { try { return api.runtime?.id; } catch (e) { return undefined; } })();
  const orphaned = () => { if (!BORN_AS) return false; try { return !api.runtime?.id; } catch (e) { return true; } }; // had an extension, lost it
  function retire() {
    clearTimeout(timer); firstChange = 0; dirty.clear();
    observers.forEach((o) => o.disconnect()); observers = [];
    state = null;
  }
  async function refresh() {
    if (!state) return;
    if (orphaned()) return retire();
    if (busy) { again = true; return; }
    busy = true;
    const my = seq;
    try {
      // "Page's own language" follows the page: when the interface language was switched (text or <html lang> changed), check again in the new one
      const changedText = [...dirty].reduce((n, e) => n + (e && e.isConnected ? Math.min((e.textContent || '').length, 2000) : 0), 0);
      const recheckLang = langDirty || changedText >= 120;
      langDirty = false;
      if (state.params?.lang === 'auto' && recheckLang) {
        const texts = [...state.items.filter((it) => nodeOf(it).isConnected).map((it) => it.text), ...[...dirty].filter((e) => e && e.isConnected).map((e) => e.textContent || '')];
        const declaredNow = (document.documentElement.lang || '').toLowerCase().split(/[-_]/)[0];
        const pl = await pageLanguage(texts.flatMap((t) => t.split(/\n+/)), declaredNow);
        if (my !== seq || !state) return;
        if (pl.lang && pl.lang !== state.p.lang) {
          dirty.clear();
          const res = await scan(state.params);
          if (!res.error) announce(true);
          return;
        }
      }
      const roots = [...dirty].filter((e) => e && e.isConnected);
      dirty.clear();
      visCache = new WeakMap();
      describedIds = new Set([...document.querySelectorAll('[aria-describedby]')].flatMap((e) => e.getAttribute('aria-describedby').split(/\s+/)).filter(Boolean));
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
      if (again) { again = false; schedule(); }
    }
  }

  // ---------- Scan ----------
  async function scan(params) {
    if (!(window.CSS && CSS.highlights && window.Highlight)) return { error: 'This browser is too old for the highlight API (needs Chrome 105+).' };
    if (!document.body) return { error: 'This page has no body to scan.' };
    let lang = params.lang;
    const declared = (() => { const raw = (document.documentElement.lang || '').toLowerCase().split(/[-_]/)[0]; return { iw: 'he', in: 'id', nb: 'no', nn: 'no' }[raw] || raw; })();
    if (lang === 'auto') lang = declared; // refined below from the page's own text (the declared language can be stale)
    const my = ++seq;
    clearAll();
    visCache = new WeakMap(); blockCache = new WeakMap();
    describedIds = new Set([...document.querySelectorAll('[aria-describedby]')].flatMap((e) => e.getAttribute('aria-describedby').split(/\s+/)).filter(Boolean));
    const p = {
      lang, requested: params.lang, mode: params.mode || 'balanced', attrs: !!params.attrs, unsure: !!params.unsure,
      related: params.related !== false, ignore: params.ignore || [], hints: !!params.hints,
      bugs: params.bugs !== false, source: params.source !== false, live: params.live !== false,
      verify: params.verify !== false, confirmedOnly: !!params.confirmedOnly,
      learned: Array.isArray(params.learned) ? params.learned : [],
      marked: Array.isArray(params.marked) ? params.marked.filter((x) => typeof x === 'string') : [],
    };
    const learnedTerms = p.learned.filter((r) => r.type === 'term').map((r) => r.value);
    state = { p, params, items: [], scope: { roots: new Set() }, ctx: null, ignoredN: 0, assumedN: 0, learnedN: 0, allIssues: [], source: null, sourceInfo: { status: p.source ? 'none' : 'off' },
      termRe: compileTerms([...p.ignore, ...learnedTerms, ...siteTerms()]), learnMatch: matcher(p.learned), auto: null };
    try {
      const raw = [];
      await collectFrom(document.body, p, raw, state.scope);
      if (params.lang === 'auto') {
        state.auto = await pageLanguage(raw.map((it) => it.text), declared);
        p.lang = state.auto.lang;
        if (!p.lang) return { error: 'This page doesn’t declare its language (no lang attribute) and its text is too short to tell. Pick a language instead of “Page’s own language”.' };
      }
      const srcP = p.source ? loadSource(p) : null;
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
      if (p.live) { for (const r of state.scope.roots) observe(r); if (params.lang === 'auto') watchLang(); }
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
      const d = await api.storage.local.get(['opts', 'autoSites', 'ignore', 'learn', 'marked']);
      if (!d || !d.opts || !(d.autoSites || []).includes(location.hostname)) return;
      await new Promise((r) => setTimeout(r, 1200));
      const ig = d.ignore || {};
      const learned = d.learn && d.learn.on !== false && Array.isArray(d.learn.rules) ? d.learn.rules.filter((r) => r && (r.scope === '*' || r.scope === location.hostname)) : [];
      const mk = d.marked || {};
      await scan({ ...d.opts, live: true, ignore: [...(ig.global || []), ...((ig.sites || {})[location.hostname] || [])], learned,
        marked: [...(mk.global || []), ...((mk.sites || {})[location.hostname] || [])] });
    } catch (e) { /* storage unavailable */ }
  })();
})();
