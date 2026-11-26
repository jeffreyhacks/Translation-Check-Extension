// Translation Check — page-side scanner (injected on demand via activeTab, or automatically on opted-in sites).
// Language judgement happens in the background worker (one shared model); this script only collects,
// masks, highlights and reports.
import { mask, compileTerms, TECH_TERMS, UNITS } from './mask.js';
import { detectBug, formatHints, dateStyle } from './rules.js';
import { describe, contextLine, slotOf, kindOf } from './context.js';
import { isStatusValue, isStatusSlot } from './status.js';
import { matcher, forLang } from './learn.js';
import { nonLatinTarget, latinOnly } from './scripts.js';
import { variants, calques } from './wording.js';

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
  const words = (s) => (s.match(/\p{L}[\p{L}\p{M}]*/gu) || []).length;
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
        // (the same text already read from one of its attributes, a title or data-tooltip, is the same tooltip: listed once)
        if (text && collectable(text, p) && !attrSeen(e, text)) { out.push({ kind: 'attr', attr: 'tooltip', text, el: e }); seeAttr(e, text); }
      }
    } finally {
      try { if (prev && prev !== doc.body && prev.isConnected && prev.focus) prev.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      await settle();
      observers.forEach((o) => o.takeRecords()); // the tooltips we opened and closed are not page changes
      sweeping--;
    }
  }
  const TIP_ATTRS = ['data-tooltip', 'data-tip', 'data-tippy-content', 'data-bs-original-title', 'data-original-title'];
  let attrTexts = new WeakMap(); // element -> texts already collected from its attributes and tooltips (reset with each check)
  const attrSeen = (el, t) => !!attrTexts.get(el)?.has(t);
  const seeAttr = (el, t) => { let set = attrTexts.get(el); if (!set) attrTexts.set(el, (set = new Set())); set.add(t); };
  const collectable = (t, p) => t.length >= 2 && !URLISH.test(t) && (/\p{L}/u.test(t) || /[{%]/.test(t) || (p.hints ? /\d/ : /\d[/.:-]\d/).test(t)); // (dates and times are always checked)
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
      // one text per element once: title="Start the tour" and data-tooltip="Start the tour" on the same button are one tooltip, not two copies
      const sel = '[placeholder],[alt],[title],[aria-label],input[type=submit],input[type=button],' + TIP_ATTRS.map((a) => `[${a}]`).join(',');
      for (const el of root.querySelectorAll(sel)) {
        if (out.length >= MAX_ITEMS) break;
        if (blocked(el) || !visible(el)) continue;
        for (const attr of ['placeholder', 'alt', 'title', 'aria-label', 'value', ...TIP_ATTRS]) {
          if (attr === 'value' && !/^(submit|button)$/.test(el.type || '')) continue;
          const text = clean(el.getAttribute(attr) || '');
          if (collectable(text, p) && !attrSeen(el, text)) { out.push({ kind: 'attr', attr, text, el }); seeAttr(el, text); }
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
    // The product's name from the page title ("Arena — AI Role Play Platform"), but only when the logo says the same: a part of the title that is
    // also the alt text of the logo or home link ("arena"). A title part alone could be the page's heading ("Paramètres — Arena"), which must
    // still be checked.
    try {
      const all = (document.title || '').split(/\s+[—–|·-]\s+|:\s+/).map((x) => x.trim());
      const parts = all.filter((x) => x.length >= 2 && x.length <= 30 && x.split(/\s+/).length <= 3);
      if (all.length > 1) {
        const logos = [...document.querySelectorAll('header img[alt], nav img[alt], a[href="/"] img[alt], img[class*="logo" i][alt], [class*="logo" i] img[alt], a[href="/"][aria-label]')]
          .map((e) => clean(e.getAttribute('alt') || e.getAttribute('aria-label') || '').toLowerCase()).filter(Boolean);
        for (const x of parts) if (logos.includes(x.toLowerCase())) t.add(x);
      }
    } catch (e) { /* no title */ }
    return [...t];
  }

  // Broken-string detection + masking of untranslatable values; returns items worth judging.
  function prepare(raw, p, termRe) {
    const keep = [];
    let ign = 0;
    for (const it of raw) {
      // Learned from earlier Ignore clicks (codes, versions, a page slot such as `span.user-name`). The language is checked first, always:
      // the text is judged like any other, and the rule is applied afterwards (see finalize) only to text the models could not place.
      // Text read as the page's language is simply translated; text read as another language stays a finding, whatever the rule says.
      if (!state.okSet.has(nk(it.text))) { const r = state.learnedTerms.get(nk(it.text)) || state.learnMatch(it.text, it.el || it.node.parentElement || it.node.parentNode?.host); if (r) it.learned = r; }
      // a language menu's own code ("hi", "HI", "IN HI"): the target's or the page's language code, alone on a button, link or menu item
      if (langCodeLabel(it, p)) { it.base = { v: 'skip', reason: 'Language code (language menu)' }; it.j = ''; it.len = 0; keep.push(it); continue; }
      if (p.bugs) {
        const b = detectBug(it.text);
        if (b) { it.base = { v: 'bug', reason: b }; it.j = ''; it.len = it.text.length; keep.push(it); continue; }
      }
      // dates and times are checked on every scan; number and price formats only with Format hints on
      { const f = formatHints(it.text, p.lang, { numbers: p.hints, dates: true }); if (f.length) it.fmt = f; }
      { const w = calques(it.text, p.lang); if (w.length) it.wording = w; } // word-for-word translations of English terms (see wording.js)
      // Text you OK'd (Ignore in the popup, OK on the page) as a whole is still judged, so it can be listed as "OK'd by you" with what the models
      // read, and so English you accepted still counts against the score: OK never turns untranslated text into translated text.
      // (Ignored terms inside longer text are still masked there, as before.)
      if (state.okSet.has(nk(it.text))) it.accepted = true;
      let m = mask(it.text, p.lang, it.accepted ? state.baseRe : termRe);
      // On a page in another script, a one-word BrandCase title ("HomeIoT", "TrueCost") is judged as it is instead of being skipped as a brand:
      // built-in brands (WhatsApp, YouTube…) are still recognised as names, anything else is listed for a decision.
      if (p.lang !== 'en' && latinOnly(it.text) && !(termRe && termRe.test(it.text))) {
        if (!/\p{L}\p{M}*\p{L}/u.test(m.text) && /^[A-Z]?[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(it.text)) { m = { text: it.text, nameLike: true }; it.title = true; }
        // a short title that masking cut down to one word ("Home IOT" -> "Home") is judged whole: the single word left says nothing
        else if (!nonLatinTarget(p.lang) && m.removed && words(it.text) >= 2 && words(it.text) <= 4 && words(m.text) === 1 && !/\d/.test(it.text)) { it.jPart = m.text; m = { text: it.text, nameLike: true }; it.title = true; }
      }
      if (!/\p{L}\p{M}*\p{L}/u.test(m.text)) {
        if (it.fmt || dateStyle(it.text)) { it.base = { v: 'skip', reason: 'Date or time (its format is checked under Format)' }; it.j = ''; it.len = 0; it.dateOnly = true; keep.push(it); continue; }
        // nothing left to judge (a code, an ID, a technical term, an ignored term): an Ignored item with the reason, never a silent drop
        if (/\p{L}/u.test(it.text)) { ign++; it.base = { v: 'skip', reason: skipReason(it.text, p, it.accepted) }; it.j = ''; it.len = 0; keep.push(it); }
        continue;
      }
      it.j = m.text; it.nameLike = m.nameLike; it.len = m.text.length;
      keep.push(it);
    }
    return { keep, ign };
  }

  // Lowercase or uppercase only, so a Title-case word ("Hi", "No") on a button is still judged as a word.
  function langCodeLabel(it, p) {
    const t = it.text.trim();
    if (!/^(?:[a-z]{2,3}|[A-Z]{2,3}(?:[\s_|/-]+[A-Z]{2,3})?|[a-z]{2,3}(?:[_-][A-Za-z]{2})?)$/.test(t)) return false;
    const own = new Set([p.lang, (document.documentElement.lang || '').toLowerCase().split('-')[0]].filter(Boolean));
    if (!t.toLowerCase().split(/[\s_|/-]+/).some((c) => own.has(c))) return false;
    const el = it.el || it.node?.parentElement || it.node?.parentNode?.host;
    return !!el?.closest?.('button, a, option, select, summary, [role=button], [role=menuitem], [role=option], [role=tab], [aria-haspopup]');
  }

  // A number with its unit or a usual abbreviation ("15 pt.", "30 min", "2 h", "5 GB"): normal in every language, not a code.
  const UNIT_ONLY = new RegExp(`^[~≈±+−-]?\\d[\\d\\s.,]*\\s?(${UNITS}|pts|points?)(\\.)?$`, 'iu');
  // Why text was set aside before judging (the masks only remove; this names what removed it).
  function skipReason(text, p, accepted) {
    const hit = (re) => { if (!re) return false; re.lastIndex = 0; return re.test(text); };
    if (!accepted && hit(state.userRe)) return 'On your ignore list';
    if (hit(state.techRe)) return 'Technical term (allowed in every language)';
    if (hit(state.siteRe)) return 'Name of this site or app';
    const unit = text.match(UNIT_ONLY);
    if (unit) return `Number with a unit or abbreviation (“${unit[1]}${unit[2] || ''}”)`;
    if (/\p{L}/u.test(text) && /\d/.test(text)) return 'Code, number or ID (letters mixed with digits)';
    return 'Code, abbreviation or symbol';
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
    const elOf = (it) => (it.kind === 'text' ? it.node.parentElement || it.node.parentNode?.host : it.el);
    for (const it of todo) { // pass 1
      let v = vcache.get(ck(it.j));
      it.wrongScript = otherScript && latinOnly(it.j);
      const latinTarget = !otherScript && state.p.lang !== 'en' && latinOnly(it.j);
      // A status value in a badge or table cell ("Valid", "Completed", "In progress") is data from the app; spelled in English on a page in another
      // language it is untranslated, even when the models can't place one short word or the word list knows it as a loanword (see status.js).
      if (latinTarget && v.v !== 'bad' && v.v !== 'bug' && it.kind === 'text' && isStatusValue(it.text, state.p.lang) && isStatusSlot(elOf(it))) {
        v = { ...v, v: 'bad', detected: 'en', reason: 'English status value', confirmed: otherVotes(v) >= 2 || !!v.enVocab, status: true };
      }
      // An English label on a tab, button, menu item, option or column header ("Knowledge Intelligence", "Document Repo") is interface text, not a
      // product name, even when it is written in Title Case: two models read it as English and at least one of its words is an English dictionary word.
      const ctl = latinTarget && !v.status && CONTROL.has(kindOf(elOf(it), it.kind === 'attr' ? it.attr : undefined));
      if (ctl && (v.v === 'bad' || v.v === 'unsure') && words(it.j) >= 2 && words(it.j) <= 5 && otherVotes(v) >= 2 && (v.enWords || 0) >= 1 &&
          (v.detected || v.other || v.was?.detected || v.lean) === 'en') {
        v = { ...v, v: 'bad', detected: 'en', reason: 'English interface label (two language models read it as English)', confirmed: true, label: true, control: true };
      }
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
      // every unclear text says why: no model could place it, a phrase written like a title, or models that disagree
      // (a word of both languages, by the target language's own word list: "Notifications", "Actions" on a French page)
      if (v.v === 'unsure' && !v.reason && v.shared && latinPage) v = { ...v, reason: `Spelled the same in English and ${langName(state.p.lang)}` };
      if (v.v === 'unsure' && !v.reason) {
        const vs = v.votes, none = !vs || ['tinyld', 'cld3', 'franc'].every((k) => vs[k] !== 'other' && vs[k] !== 'target');
        v = { ...v, reason: none ? 'Detection failed: no language model could place it' : latinPage && n >= 2 && titleCase(it.j) ? 'Name or title? Could be untranslated' : 'The language models disagree' };
      }
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
    peers();
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
      if (words(it.j) > 2) continue; // only a lone word or short label is read with its section; a longer phrase has its own evidence
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

  const langName = (l) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(l) || l; } catch (e) { return l; } };
  const titleCase = (t) => { const ws = t.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []; return ws.length > 0 && ws.filter((w) => /^\p{Lu}/u.test(w)).length >= Math.ceil(ws.length * 0.6); };

  // Items of the same kind in the same list are judged consistently: a table column, or a repeated slot (same element and class). When most of
  // the column is names or titles that are flagged or held for a decision, the others there that are still unclear are held too (never assumed
  // translated or cleared by their section), and a code-like name that masking emptied ("Testproj123") is listed as unclear instead of skipped.
  // Text the models read as the target language keeps its verdict. Nothing here is site-specific: it only uses the page's own structure.
  let tableIds = new WeakMap(), tableN = 0;
  function peerKey(el) {
    for (let e = el, k = 0; e && e.nodeType === 1 && k < 4; e = e.parentElement, k++) {
      if (e.tagName === 'TD' || /^(cell|gridcell)$/.test(e.getAttribute('role') || '')) {
        const table = e.closest('table,[role=table],[role=grid]'), row = e.parentElement;
        if (!table || !row || row.closest('thead')) return '';
        if (!tableIds.has(table)) tableIds.set(table, ++tableN);
        return `col:${tableIds.get(table)}:${[...row.children].indexOf(e)}`;
      }
    }
    const sl = slotOf(el);
    return sl ? 'slot:' + sl : '';
  }
  function peers() {
    if (nonLatinTarget(state.p.lang) || state.p.lang === 'en') return;
    const groups = new Map();
    for (const it of state.items) {
      if (it.kind !== 'text' || !it.base || !nodeOf(it).isConnected || !latinOnly(it.text)) continue;
      const k = peerKey(it.node.parentElement || it.node.parentNode?.host);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    for (const list of groups.values()) {
      if (list.length < 3) continue;
      const titleish = list.filter((it) => (it.base.v === 'bad' && !it.base.status && !it.base.marked) || it.hold).length;
      if (titleish < 2 || titleish < list.length * 0.4) continue;
      for (const it of list) {
        if (it.base.v === 'unsure' && !it.hold) {
          it.hold = true;
          it.base = { ...it.base, reason: /^Name or title/.test(it.base.reason || '') ? it.base.reason : 'Name or title? Like the other names in this column or list', peers: true };
        } else if (it.base.v === 'skip' && /^Code/.test(it.base.reason) && (it.text.match(/\p{L}/gu) || []).length >= 3) {
          it.hold = true; it.j = it.text; it.len = it.text.length;
          it.base = { v: 'unsure', reason: 'Name or code? It sits with names in the same column or list', peers: true };
        }
      }
    }
  }

  // Interface controls whose text is a label, never a name or title.
  const CONTROL = new Set(['tab', 'button', 'menu item', 'option', 'table header']);

  const ruleWords = (r) => (r.type === 'slot' ? `text in ${r.value}` : r.type === 'shape' ? `${r.value}s` : `“${r.value}”`);

  // Page-level tendency: if the page is clearly translated, unclear short strings almost certainly are too.
  function finalize() {
    let okC = 0, badC = 0;
    for (const it of state.items) { if (it.base.v === 'ok') okC += it.len; else if (it.base.v === 'bad') badC += it.len; }
    const tendency = okC + badC ? okC / (okC + badC) : null;
    const assume = state.p.mode === 'relaxed' || (state.p.mode === 'balanced' && tendency !== null && tendency >= 0.6);
    state.assumedN = 0;
    if (state.p.confirmedOnly && state.p.verify) {
      // "Shows only warnings that at least two models back": an unconfirmed warning is hidden from the lists (it used to move to Unclear,
      // where it was still shown) and is never assumed translated; it stays counted, under Ignored with its reason, so nothing is dropped silently
      for (const it of state.items) if (it.base.v === 'bad' && it.base.votes && !it.base.confirmed) it.base = { v: 'skip', reason: 'Not confirmed by a second model (Confirmed warnings only is on)', votes: it.base.votes, unconfirmed: true };
    }
    // Rules learned from Ignore clicks set aside only what the models could not place (unclear, or a possible name). Never text read as the
    // target language (that is translated and not listed at all) and never text read as another language (that stays a finding).
    state.learnedN = 0;
    for (const it of state.items) {
      if (it.base?.learned) { state.learnedN++; continue; } // set aside on an earlier pass (a live re-check runs this again)
      if (!it.learned || !it.base || (it.base.v !== 'unsure' && it.base.v !== 'name')) continue;
      state.learnedN++;
      const was = it.base.v;
      it.base = { v: 'skip', reason: `Ignored by a rule learned from your Ignore clicks (${ruleWords(it.learned)}; the models read it as ${was === 'name' ? 'a name' : 'unclear'})`, learned: true, was, votes: it.base.votes, detected: it.base.detected };
    }
    for (const it of state.items) {
      // (Latin letters on a page in another script are never assumed translated)
      // Balanced assumes only very short unclear text (one or two short words) is translated; a longer phrase that stays unclear is listed,
      // never counted as translated without evidence ("Smart Service Analytics" used to disappear this way). Relaxed assumes everything.
      const shortOne = words(it.j) <= 2 && (it.j.match(/\p{L}/gu) || []).length < 16;
      if (it.base.v === 'unsure' && assume && !it.hold && (state.p.mode === 'relaxed' || shortOne)) { it.v = { v: 'ok', assumed: true }; state.assumedN++; } else it.v = it.base;
    }
    // Text the person marked as untranslated (from the Unclear list) is listed as untranslated on every check, whatever the models say.
    const marked = new Set(state.p.marked.map(nk));
    if (marked.size) {
      for (const it of state.items) {
        if (it.v.v === 'bad' || it.v.v === 'bug' || !marked.has(nk(it.text))) continue;
        if (it.v.assumed) state.assumedN--;
        // the models' own reading is kept next to the person's mark, so the export still shows what they decided and why
        const modelReason = it.v.assumed ? 'Unclear; assumed translated because the rest of the page is' : it.v.reason || (it.v.v === 'ok' ? 'Read as the target language' : it.v.v === 'name' ? 'Looks like a name' : 'Too short or ambiguous to judge');
        it.v = { ...it.v, v: 'bad', assumed: false, marked: true, reason: 'Marked untranslated by you', modelReason, modelVerdict: it.v.assumed ? 'unsure' : it.v.v };
      }
    }
    // Text you OK'd: Ignored, with the models' reading kept. Untranslated text you accepted still counts against the score (see render).
    for (const it of state.items) {
      if (!it.accepted || it.v.v === 'bug' || it.v.v === 'ok') continue; // (text in the page's language stays translated)
      if (it.v.assumed) state.assumedN--;
      const was = it.v.assumed ? 'unsure' : it.v.v;
      const what = { bad: 'not translated', unsure: 'unclear', ok: 'translated', name: 'a name', skip: 'a code or ID' }[was] || was;
      const why = was === 'skip' && it.v.reason ? `Ignored by you (already set aside: ${it.v.reason})` : `Ignored by you (the models read it as ${what}${it.v.reason && !it.v.assumed && was !== 'skip' ? ': ' + it.v.reason : ''})`;
      it.v = { v: 'skip', reason: why, accepted: true, was, votes: it.v.votes, detected: it.v.detected };
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
      ::highlight(${K.unsure}){background-color:rgba(232,89,12,.02);text-decoration:underline wavy #e8590c 1px}
      ::highlight(${K.bug}){background-color:rgba(190,60,255,.45);color:#111;text-decoration:underline wavy #7a1fa2}
      ::highlight(${K.fmt}){text-decoration:underline dotted #0f9d8a}
      ::highlight(${K.focus}){background-color:#d7263d;color:#fff}
      [${A_FLAG}="${NS}:bad"]{outline:2px dashed #d7263d!important;outline-offset:2px!important}
      [${A_FLAG}="${NS}:unsure"]{outline:2px dotted #e8590c!important;outline-offset:2px!important}
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
    targets.clear(); hoverOf = new WeakMap(); hideCard(true);
    const stats = { ok: 0, bad: 0, unsure: 0, bug: 0, fmt: 0, name: 0, skip: 0, okN: 0, badN: 0, unsureN: 0, bugN: 0, fmtN: 0, nameN: 0, skipN: 0, assumedN: state.assumedN, ignoredN: state.ignoredN, learnedN: state.learnedN };
    const issues = [], ignored = [];
    let id = 0;
    // Ignored text (names, codes, technical terms, ignored terms) is never highlighted, but it is listed with its reason in the export, so every
    // text item the check found ends up in exactly one category.
    const addIgnored = (it, reason) => {
      const myId = ++id;
      targets.set(myId, it);
      // byUser: on your ignore list (Ignore in the popup or on the page), so it can be restored; was: its tab before you ignored it
      const byUser = !!it.v?.accepted || /^On your ignore list/.test(reason || '');
      ignored.push({ id: myId, verdict: 'skip', kind: it.kind, attr: it.attr, reason, text: it.text.slice(0, 300), len: it.text.length, votes: it.v?.votes, byUser, was: it.v?.was, detected: it.v?.detected, unconfirmed: !!it.v?.unconfirmed, learned: !!it.v?.learned });
    };
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
      if ((verdict === 'bad' || verdict === 'unsure') && (verdict === 'bad' || p.unsure)) hoverOf.set(n, myId);
      issues.push({ id: myId, verdict, kind: it.kind, attr: it.attr, detected, votes: hint ? undefined : it.v?.votes, confirmed: !hint && !!it.v?.confirmed, marked: !hint && !!it.v?.marked, modelReason: hint ? undefined : it.v?.modelReason, reason: reason && it.v?.via === 'context' && !hint ? reason + ' (judged from the surrounding sentence)' : reason, text: it.text.slice(0, 300), len: it.len || it.text.length, ...extra });
    };
    // dates written in more than one way on the same page ("13/11/2026" and "13.11.2026", or "Nov 13, 2026" and "13 Nov 2026")
    const styles = new Set(state.items.filter((it) => nodeOf(it).isConnected).map((it) => dateStyle(it.text)).filter(Boolean));
    const numeric = [...styles].filter((x) => x.startsWith('numeric'));
    const mixedDates = numeric.length > 1 || (styles.has('month name, month first') && styles.has('month name, day first'))
      ? `Dates on this page are written in different formats (${[...styles].join('; ')})` : '';
    // the same label written two ways on this page ("Manuel de l'utilisateur" and "Manuel utilisateur"), among text read as the page's language
    const okTexts = state.items.filter((it) => nodeOf(it).isConnected && (it.v.v === 'ok' || it.v.v === 'unsure')).map((it) => it.text);
    const twoWays = variants(okTexts, p.lang);
    for (const it of state.items) {
      if (!nodeOf(it).isConnected) continue;
      const v = it.v;
      stats[v.v] += it.len; stats[v.v + 'N']++;
      // the language the models leaned to, when no verdict names one ("Document Repo": two models said English, but it stayed unclear)
      if (v.v === 'name') addIgnored(it, v.kind === 'id' ? 'User name or ID' : v.reason || 'Looks like a name'); // names are counted, never highlighted
      else if (v.v === 'skip') addIgnored(it, v.reason);
      else if (v.v !== 'ok') add(it, v.v, v.reason, v.detected || v.lean || v.was?.detected || v.other);
      const inLang = v.v === 'ok' || v.v === 'unsure';
      const fmt = [...(it.fmt || []), ...(mixedDates && dateStyle(it.text) ? [mixedDates] : []),
        ...(inLang && it.wording ? it.wording : []),
        ...(inLang && twoWays.has(it.text) ? [`Wording: written two ways on this page, “${it.text}” and “${twoWays.get(it.text)}”`] : [])];
      for (const f of fmt) { stats.fmtN++; add(it, 'fmt', f); }
    }
    for (const win of marks.keys()) {
      const m = marks.get(win), reg = win.CSS.highlights;
      for (const k of ['bad', 'unsure', 'bug', 'fmt']) if (m[k].size) reg.set(K[k], m[k]);
    }
    const order = { bug: 0, bad: 1, unsure: 2, fmt: 3 };
    const groups = group(issues);
    groups.sort((a, b) => order[a.verdict] - order[b.verdict] || b.len - a.len);
    state.allIssues = groups.slice(0, 5000);
    state.allIgnored = group(ignored).slice(0, 5000);
    issueById = new Map(issues.map((i) => [i.id, i]));
    // "skipped" chip: codes, technical terms and ignored terms actually set aside in the end (not dates, not rules learned from Ignore)
    stats.ignoredN = state.items.filter((it) => it.v.v === 'skip' && !it.dateOnly && !it.v.unconfirmed && !/learned/.test(it.v.reason || '') && nodeOf(it).isConnected).length;
    // warnings hidden by "Confirmed warnings only": their own chip, so the hidden count is visible
    stats.unconfirmedN = state.items.filter((it) => it.v.v === 'skip' && it.v.unconfirmed && nodeOf(it).isConnected).length;
    stats.scannedN = stats.okN + stats.badN + stats.unsureN + stats.bugN + stats.nameN + stats.skipN; // every text item, in exactly one category
    for (const g of groups.slice(0, 300)) withContext(g, 12);
    // English you OK'd is still English on the page: it stays in the score (as not translated), it just isn't listed as a problem any more
    const acceptedItems = state.items.filter((it) => it.v.accepted && it.v.was === 'bad' && nodeOf(it).isConnected);
    const acceptedBad = acceptedItems.reduce((n, it) => n + it.len, 0);
    // shown next to the score, so a score below 100% with 0 untranslated says why (it is listed in the Ignored tab)
    stats.acceptedN = acceptedItems.length;
    const judged = stats.ok + stats.bad + acceptedBad;
    // 100% only when nothing counts as not translated: a little leftover English must not round up to 100%
    const pct = judged ? Math.round((stats.ok / judged) * 100) : null;
    last = {
      lang: p.lang, requested: p.requested, mode: p.mode, host: location.hostname, pageLang: document.documentElement.lang || '', stats, auto: state.auto,
      score: pct === 100 && stats.bad + acceptedBad > 0 ? 99 : pct,
      issues: groups.slice(0, 300).map((i) => ({ ...i, text: i.text.slice(0, 160) })), truncated: Math.max(0, groups.length - 300),
      // the Ignored tab: what you ignored first (it can be restored), then names, codes, technical terms and dates, each with its reason
      ignored: [...state.allIgnored].sort((a, b) => (b.byUser ? 1 : 0) - (a.byUser ? 1 : 0)).slice(0, 300).map((g) => ({ ...withContext(g, 12), text: g.text.slice(0, 160) })),
      source: state.sourceInfo, models: state.models, live: p.live && !!observers.length,
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
    clearTimeout(timer); clearTimeout(lateTimer); firstChange = 0; dirty.clear(); unfocus(); hideCard(true);
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
    // the full path up to the nearest id (or the document root), so every copy can be found again (no depth limit that cut paths off mid-way)
    while (n && n.nodeType === 1 && parts.length < 60) {
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

  // ---------- Pictures for the report: bring one finding into view and say where it is on the screen ----------
  // The popup takes the screenshot (only it can) and crops it around the rectangle given here, in CSS pixels of the top window.
  let snapScroll = null; // where the window and every scrolled box were before the pictures (first value wins), to put them back
  function rememberScroll(el) {
    for (let e = el; e; e = e.parentElement || e.getRootNode?.().host || e.ownerDocument?.defaultView?.frameElement) {
      if (!snapScroll.boxes.has(e) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)) snapScroll.boxes.set(e, [e.scrollLeft, e.scrollTop]);
      const w = e.ownerDocument?.defaultView;
      if (w && !snapScroll.wins.has(w)) snapScroll.wins.set(w, [w.scrollX, w.scrollY]);
    }
  }
  function snapPrep(id) {
    const t = targets.get(id);
    if (!t) return { ok: false, why: 'gone' };
    const n = nodeOf(t);
    if (!n || !n.isConnected) return { ok: false, why: 'gone' };
    if (!snapScroll) snapScroll = { boxes: new Map(), wins: new Map([[window, [window.scrollX, window.scrollY]]]) };
    unfocus(); hideCard(true);
    const el = t.kind === 'text' ? n.parentElement || n.parentNode?.host : n;
    const tipHost = t.tip && !(t.tip.checkVisibility ? t.tip.checkVisibility({ visibilityProperty: true }) : t.tip.getClientRects().length) && t.tip.parentElement; // a closed tooltip: picture what it belongs to
    const box = tipHost || el;
    if (!box) return { ok: false, why: 'hidden' };
    rememberScroll(box);
    box.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    let r;
    if (!tipHost && t.kind === 'text') { try { const range = n.ownerDocument.createRange(); range.selectNodeContents(n); r = range.getBoundingClientRect(); } catch (e) { /* no layout */ } }
    if (!r || !r.width || !r.height) r = box.getBoundingClientRect();
    if (!r.width || !r.height) return { ok: false, why: 'hidden' };
    let x = r.left, y = r.top;
    for (let w = winOf(n); w && w !== window && w.frameElement; w = w.parent) { const f = w.frameElement.getBoundingClientRect(); x += f.left + w.frameElement.clientLeft; y += f.top + w.frameElement.clientTop; } // same-origin frames
    const vw = window.innerWidth, vh = window.innerHeight;
    if (x + r.width <= 0 || y + r.height <= 0 || x >= vw || y >= vh) return { ok: false, why: 'hidden' };
    return { ok: true, rect: { x, y, w: r.width, h: r.height }, vw, vh, dpr: window.devicePixelRatio || 1, tooltip: !!tipHost };
  }
  function snapDone() {
    if (snapScroll) {
      for (const [e, [x, y]] of snapScroll.boxes) { try { e.scrollLeft = x; e.scrollTop = y; } catch (err) { /* gone */ } }
      for (const [w, [x, y]] of snapScroll.wins) { try { w.scrollTo({ left: x, top: y, behavior: 'instant' }); } catch (err) { /* frame gone, or no layout */ } }
      snapScroll = null;
    }
    return { ok: true };
  }

  // Before exporting, the page is brought up to date: changes still waiting for the live re-check are checked now, and so is text that
  // changed since it was checked (an app that swapped in its translations after the check). Then the context of every row is read again,
  // in the same moment, so the text, the text around it and the pictures that follow describe the same state of the page.
  async function exportData() {
    if (!state) return { issues: [] };
    const stale = state.items.filter((it) => it.kind === 'text' && it.node.isConnected && clean(it.node.nodeValue || '') !== it.text);
    if (stale.length || dirty.size || timer) {
      clearTimeout(timer); timer = 0; firstChange = 0;
      for (const it of stale) dirty.add(it.node.parentElement || it.node.parentNode?.host || null);
      for (let k = 0; busy && k < 100; k++) await new Promise((r) => setTimeout(r, 50));
      await refresh();
      for (let k = 0; busy && k < 100; k++) await new Promise((r) => setTimeout(r, 50));
      if (!state) return { issues: [] };
    }
    ctxCache = new WeakMap(); blockCache = new WeakMap();
    for (const g of [...state.allIssues, ...(state.allIgnored || [])]) for (const o of g.occ) delete o.where;
    return {
      url: location.href, title: document.title, lang: state.p.lang, generated: new Date().toISOString(), source: state.sourceInfo,
      issues: [...state.allIssues, ...(state.allIgnored || [])].map((g) => {
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

  // ---------- Hover card on marked text: why it was marked, how the models voted, and a decision ----------
  // Pointing at underlined text (orange: unclear, red: untranslated) shows a small card. "Not translated" marks an unclear text as untranslated,
  // "OK" puts it on this site's ignore list, the same lists as the popup's buttons (the popup picks the change up from storage).
  let hoverOf = new WeakMap(), issueById = new Map(), card = null, cardTimer = 0, moveQueued = false, lastMove = null;
  function hideCard(now) {
    clearTimeout(cardTimer);
    const go = () => { if (card) { card.host.remove(); card = null; } };
    if (now) go(); else cardTimer = setTimeout(go, 350);
  }
  function hoverTarget(x, y, target) {
    const flagged = target && target.closest && target.closest(`[${A_FLAG}^="${NS}:"]`);
    if (flagged && hoverOf.has(flagged)) return hoverOf.get(flagged);
    const doc = document;
    let n = null;
    try {
      if (doc.caretPositionFromPoint) { const cp = doc.caretPositionFromPoint(x, y); n = cp && cp.offsetNode; }
      else if (doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(x, y); n = r && r.startContainer; }
    } catch (e) { /* no caret API */ }
    if (!n || n.nodeType !== 3 || !hoverOf.has(n)) return null;
    const r = doc.createRange(); r.selectNodeContents(n);
    return [...r.getClientRects()].some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) ? hoverOf.get(n) : null;
  }
  function onMove(e) {
    lastMove = e;
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      const ev = lastMove;
      if (!state || !ev || !state.p.hoverCard) { if (card) hideCard(true); return; }
      if (card && card.host.contains(ev.target)) { clearTimeout(cardTimer); return; } // on the card itself
      const id = hoverTarget(ev.clientX, ev.clientY, ev.target);
      if (id && (!card || card.id !== id)) showCard(id, ev.clientX, ev.clientY);
      else if (id) clearTimeout(cardTimer);
      else if (card) hideCard(false);
    });
  }
  const agreeText = (i) => { const n = i.votes ? ['tinyld', 'cld3', 'franc'].filter((k) => i.votes[k] === 'other').length : null; return n == null ? '' : `${n}/3 models read another language${i.confirmed ? ' (confirmed)' : ''}`; };
  function showCard(id, x, y) {
    const i = issueById.get(id), t = targets.get(id);
    if (!i || !t) return;
    hideCard(true);
    const host = document.createElement('div');
    host.setAttribute(A_STYLE, NS); // never collected or treated as a page change
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0';
    const root = host.attachShadow({ mode: 'open' });
    const color = i.verdict === 'bad' ? '#d7263d' : '#e8590c';
    root.innerHTML = `<style>
      .c{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#14213d;background:#fff;border:1px solid rgba(20,33,61,.12);border-radius:10px;
         box-shadow:0 8px 24px rgba(0,0,0,.12);padding:12px;max-width:300px}
      .h{display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px}.h::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:${color}}
      .r{margin:0}.m{color:#566176;font-size:12px;margin-top:4px}.m:empty{display:none}
      .b{display:flex;gap:8px;margin-top:12px}button{font:inherit;font-size:12px;font-weight:500;height:28px;border:1px solid rgba(20,33,61,.14);background:#fff;color:#14213d;border-radius:6px;padding:0 10px;cursor:pointer;transition:background-color .15s}
      button:hover{background:#f3f5f9}button:focus-visible{outline:2px solid #3b6df0;outline-offset:2px}button.p{background:#14213d;border-color:#14213d;color:#fff}button.p:hover{background:#24335a}button.ok{margin-left:auto}</style>
      <div class="c" role="dialog" aria-label="Translation Check"><div class="h"></div><div class="r"></div><div class="m"></div><div class="b"></div></div>`;
    root.querySelector('.h').textContent = i.marked ? 'Not translated (marked by you)' : i.verdict === 'bad' ? 'Not translated' : 'Unclear';
    root.querySelector('.r').textContent = i.reason || 'Too short or ambiguous to judge';
    root.querySelector('.m').textContent = agreeText(i);
    const btns = root.querySelector('.b');
    const btn = (label, cls, title, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.title = title; b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideCard(true); fn(); }); btns.append(b); };
    const text = t.text;
    // OK only closes the card: the text keeps its underline, its tab and its counts. Changing its status takes a button that says so.
    if (i.marked) btn('Unmark', '', 'Undo your mark: back to what the language models said (Unclear)', () => decide('unmark', text));
    else if (i.verdict === 'unsure') btn('Not translated', 'p', 'List it as untranslated on every check of this site', () => decide('mark', text));
    btn('Ignore', '', 'Stop flagging it on this site: it moves to the Ignored tab (restore it there). Untranslated text still counts against the score', () => decide('ignore', text));
    btn('OK', 'ok', 'Close this card. Nothing changes', () => {});
    host.addEventListener('mouseleave', () => hideCard(false));
    document.documentElement.appendChild(host);
    const box = root.querySelector('.c').getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    host.style.left = Math.max(4, Math.min(x + 12, vw - box.width - 8)) + 'px';
    host.style.top = (y + 18 + box.height > vh - 4 ? Math.max(4, y - box.height - 12) : y + 18) + 'px';
    card = { host, id };
  }
  // The decision is saved in the same lists the popup uses (latest decision wins), then the page is checked again with them.
  async function decide(kind, text) {
    if (!state) return;
    const host = location.hostname, k = nk(text);
    let d = {};
    try { d = await api.storage.local.get(['ignore', 'marked']); } catch (e) { /* storage unavailable: still apply to this check */ }
    const ig = { global: [], sites: {}, ...(d.ignore || {}) }, mk = { global: [], sites: {}, ...(d.marked || {}) };
    const drop = (o) => { o.global = (o.global || []).filter((x) => nk(x) !== k); for (const h of Object.keys(o.sites || {})) o.sites[h] = o.sites[h].filter((x) => nk(x) !== k); };
    drop(mk); if (kind !== 'unmark') drop(ig);
    const into = (o) => { const l = host ? (o.sites[host] = o.sites[host] || []) : o.global; l.push(text); };
    if (kind === 'mark') into(mk);
    if (kind === 'ignore') into(ig);
    try { await api.storage.local.set({ ignore: ig, marked: mk }); } catch (e) { /* see above */ }
    const lists = (o) => [...(o.global || []), ...((o.sites || {})[host] || [])];
    const res = await scan({ ...state.params, ignore: lists(ig), marked: lists(mk) });
    if (!res.error) announce(true);
  }
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('scroll', () => { if (card) hideCard(true); }, { passive: true, capture: true });

  // ---------- Live updates: re-judge only what changed ----------
  // A check runs once the page has been quiet for QUIET ms, and never later than MAX_WAIT ms after the first change: pages with a ticking
  // clock or live counters ("Zuletzt aktualisiert …", "vor 3 Sekunden") change all the time, and a plain "wait until quiet" never ran there.
  const QUIET = 250, MAX_WAIT = 800, LATE_MS = 5000;
  let lateTimer = 0;
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
      // the text around an item and its sentence are read again: a cached context from before the change would describe the page as it was
      visCache = new WeakMap(); ctxCache = new WeakMap(); blockCache = new WeakMap(); attrTexts = new WeakMap();
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

  // Terms and rules for a check in p.lang. Rules learned from Ignore clicks are tied to the language they were learned for. A learned term
  // (the same text ignored on two sites) is applied to the whole text after judging, like the other learned rules, never masked beforehand.
  function termState(p) {
    const learned = p.learned.filter((r) => r && forLang(r, p.lang));
    return {
      learnedTerms: new Map(learned.filter((r) => r.type === 'term').map((r) => [nk(r.value), r])),
      termRe: compileTerms([...p.ignore, ...siteTerms(), ...TECH_TERMS]), learnMatch: matcher(learned, p.lang),
      userRe: compileTerms(p.ignore), baseRe: compileTerms([...siteTerms(), ...TECH_TERMS]), techRe: compileTerms(TECH_TERMS), siteRe: compileTerms(siteTerms()),
    };
  }

  // Wait until the page has stopped changing before reading it: an app that is still rendering or translating (text swapped in after the first
  // paint) would otherwise be read half in one state and half in the other. Waits for SETTLE_QUIET ms without a change, at most SETTLE_MAX ms.
  // A page that is not changing is read at once (after a short look, SETTLE_PROBE ms, when this copy of the script has only just started).
  const SETTLE_QUIET = 400, SETTLE_MAX = 3000, SETTLE_PROBE = 120;
  let lastPageChange = 0;
  const bornAt = Date.now();
  try {
    const ours = (r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.hasAttribute?.(A_STYLE));
    new MutationObserver((records) => { if (!sweeping && records.some((r) => !ours(r))) lastPageChange = Date.now(); })
      .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) { /* no observer */ }
  async function settlePage(settle) {
    if (settle === false) return;
    const start = Date.now();
    if (start - bornAt < SETTLE_PROBE) await new Promise((r) => setTimeout(r, SETTLE_PROBE - (start - bornAt)));
    while (lastPageChange && Date.now() - lastPageChange < SETTLE_QUIET && Date.now() - start < SETTLE_MAX) {
      await new Promise((r) => setTimeout(r, Math.min(100, SETTLE_QUIET - (Date.now() - lastPageChange)) + 5));
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
    visCache = new WeakMap(); blockCache = new WeakMap(); attrTexts = new WeakMap();
    describedIds = new Set([...document.querySelectorAll('[aria-describedby]')].flatMap((e) => e.getAttribute('aria-describedby').split(/\s+/)).filter(Boolean));
    const p = {
      lang, requested: params.lang, mode: params.mode || 'balanced', attrs: !!params.attrs, unsure: !!params.unsure,
      related: params.related !== false, ignore: params.ignore || [], hints: !!params.hints,
      bugs: params.bugs !== false, source: params.source !== false, live: params.live !== false,
      verify: params.verify !== false, confirmedOnly: !!params.confirmedOnly,
      learned: Array.isArray(params.learned) ? params.learned : [],
      marked: Array.isArray(params.marked) ? params.marked.filter((x) => typeof x === 'string') : [],
      hoverCard: params.hoverCard !== false, // the card on underlined text (Settings › On the page)
    };
    state = { p, params, items: [], scope: { roots: new Set() }, ctx: null, ignoredN: 0, assumedN: 0, learnedN: 0, allIssues: [], source: null, sourceInfo: { status: p.source ? 'none' : 'off' },
      auto: null, okSet: new Set(p.ignore.map(nk)), ...termState(p) };
    try {
      await settlePage(params.settle);
      if (my !== seq || !state) return { error: 'A newer check replaced this one.' };
      const raw = [];
      await collectFrom(document.body, p, raw, state.scope);
      if (params.lang === 'auto') {
        state.auto = await pageLanguage(raw.map((it) => it.text), declared);
        p.lang = state.auto.lang;
        if (!p.lang) return { error: 'This page doesn’t declare its language (no lang attribute) and its text is too short to tell. Pick a language instead of “Page’s own language”.' };
        Object.assign(state, termState(p)); // learned rules belong to a language: only now is it known
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
      else {
        // Live updates off: text that arrives just after the check (table rows and status badges loaded from the server) is still picked up
        // for a few seconds, then the page is left alone.
        for (const r of state.scope.roots) observe(r);
        lateTimer = setTimeout(() => { if (state && !state.p.live) { observers.forEach((o) => o.disconnect()); observers = []; observed = new WeakSet(); } }, LATE_MS);
      }
      last.live = p.live && !!observers.length;
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
      case 'export': exportData().then(reply, (e) => reply({ error: String(e), issues: [] })); return true;
      case 'tc-snap': { // answered once the page has painted after scrolling, so the screenshot shows it
        const r = snapPrep(msg.id);
        const frame = (f) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));
        if (!r.ok) { reply(r); break; }
        frame(() => frame(() => setTimeout(() => reply(r), 30)));
        return true;
      }
      case 'tc-snap-done': reply(snapDone()); break;
      case 'tc-hovercard': if (state) { state.p.hoverCard = !!msg.on; state.params = { ...state.params, hoverCard: !!msg.on }; if (!msg.on) hideCard(true); } reply({ ok: true }); break;
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
