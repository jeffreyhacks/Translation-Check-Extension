// Where a string sits on the page, in words a translator understands: what it is (button, heading, menu item…), which part of the page
// (navigation, a dialog, a form…), the heading it belongs under, and the text right before and after it. Also a stable "slot" signature
// (e.g. `span.user-name`) used to learn ignore rules from repeated Ignore clicks. Read-only: nothing on the page is changed.

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const ROLE_OF_TAG = {
  BUTTON: 'button', A: 'link', LABEL: 'label', LEGEND: 'group label', CAPTION: 'table caption', TH: 'table header', TD: 'table cell',
  LI: 'list item', OPTION: 'option', SUMMARY: 'disclosure', DT: 'term', DD: 'definition', FIGCAPTION: 'caption', TITLE: 'page title',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', P: 'paragraph', BLOCKQUOTE: 'quote',
};
const ARIA_ROLE = { button: 'button', link: 'link', menuitem: 'menu item', menuitemcheckbox: 'menu item', menuitemradio: 'menu item', tab: 'tab',
  option: 'option', heading: 'heading', columnheader: 'table header', rowheader: 'table header', cell: 'table cell', gridcell: 'table cell',
  checkbox: 'checkbox', radio: 'radio button', switch: 'switch', tooltip: 'tooltip', alert: 'alert', status: 'status message', treeitem: 'tree item' };
const ATTR_ROLE = { placeholder: 'placeholder', alt: 'image alt text', title: 'tooltip', 'aria-label': 'accessible label', value: 'button',
  tooltip: 'tooltip', 'data-tooltip': 'tooltip', 'data-tip': 'tooltip', 'data-tippy-content': 'tooltip', 'data-bs-original-title': 'tooltip', 'data-original-title': 'tooltip' };
const LANDMARK = { HEADER: 'Header', NAV: 'Navigation', MAIN: 'Main', FOOTER: 'Footer', ASIDE: 'Sidebar', FORM: 'Form', DIALOG: 'Dialog', TABLE: 'Table' };
const ARIA_LANDMARK = { banner: 'Header', navigation: 'Navigation', main: 'Main', contentinfo: 'Footer', complementary: 'Sidebar', form: 'Form',
  dialog: 'Dialog', alertdialog: 'Dialog', search: 'Search', menu: 'Menu', menubar: 'Menu', tablist: 'Tabs', toolbar: 'Toolbar', grid: 'Table', table: 'Table' };
const HEADING = 'h1,h2,h3,h4,h5,h6,[role=heading]';

const parentOf = (n) => n.parentElement || n.parentNode?.host || null; // steps out of open shadow roots
const roleAttr = (el) => (el.getAttribute?.('role') || '').toLowerCase();

/** What kind of element this is, in plain words ("button", "menu item", "placeholder"). */
export function kindOf(el, attr) {
  if (attr) return ATTR_ROLE[attr] || attr;
  for (let e = el, k = 0; e && e.nodeType === 1 && k < 4; e = parentOf(e), k++) {
    const r = ARIA_ROLE[roleAttr(e)] || ROLE_OF_TAG[e.tagName];
    if (r && r !== 'paragraph' && r !== 'list item') return r;
    if (r && k === 0) return r; // a paragraph or list item only when the text sits right in it
  }
  return 'text';
}

function nameOf(el) {
  const l = clean(el.getAttribute?.('aria-label'));
  if (l) return l;
  const by = el.getAttribute?.('aria-labelledby');
  if (by) { const t = clean(by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || '').join(' ')); if (t) return t; }
  const h = el.querySelector?.(HEADING);
  return h ? clean(h.textContent) : '';
}

/** The page region: "Navigation", "Dialog “Edit persona”"… (closest landmark, innermost first). */
export function regionOf(el) {
  for (let e = el; e && e.nodeType === 1; e = parentOf(e)) {
    const r = ARIA_LANDMARK[roleAttr(e)] || LANDMARK[e.tagName];
    if (!r) continue;
    // containers are named by their label or heading; page landmarks only by an explicit label (a nav's heading is usually its first link)
    const n = cut(r === 'Table' || r === 'Form' || r === 'Dialog' || r === 'Menu' || r === 'Tabs' ? nameOf(e) : clean(e.getAttribute('aria-label')), 40);
    return n ? `${r} “${n}”` : r;
  }
  return '';
}

/** The heading the text belongs under: the nearest heading before it inside its card, section or panel (not the text itself). */
export function headingOf(el) {
  let child = el;
  for (let anc = parentOf(el), depth = 0; anc && anc.nodeType === 1 && depth < 7; child = anc, anc = parentOf(anc), depth++) {
    if (anc.tagName === 'BODY') break;
    let best = null;
    for (const h of anc.querySelectorAll?.(HEADING) || []) {
      if (h === el || h.contains(el) || el.contains(h)) continue;
      // only headings before the text count (a heading after it belongs to the next block)
      if (!(h.compareDocumentPosition(child) & 4)) break;
      // ...and only a heading whose own container holds the text: not the title of the neighbouring card
      const p1 = parentOf(h), p2 = p1 && parentOf(p1);
      // (or one level up when the heading sits in a small wrapper that holds little more than the heading: <div class="card-header"><h3>…)
      const wrapper = p1 && p1.children.length <= 2 && clean(p1.textContent).length <= clean(h.textContent).length + 12; // heading + a badge, not a card
      if ((p1 && p1.contains(el)) || (wrapper && p2 && p2.contains(el))) best = h;
    }
    if (best) { const t = clean(best.textContent); if (t) return cut(t, 60); }
  }
  return '';
}

/** For form fields: the visible label text. */
function fieldLabel(el) {
  if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return '';
  const doc = el.ownerDocument;
  if (el.id) { try { const l = doc.querySelector(`label[for="${el.id.replace(/["\\]/g, '\\$&')}"]`); if (l) return cut(clean(l.textContent), 40); } catch (e) { /* odd id */ } }
  const l = el.closest('label');
  return l ? cut(clean(l.textContent), 40) : '';
}

/** Up to `n` characters of the text just before and just after a text node, within its block. */
// Containers whose text belongs together; the text around a string is never taken from beyond one of these.
const STOP = /^(HEADER|NAV|MAIN|FOOTER|ASIDE|SECTION|ARTICLE|FORM|DIALOG|LI|TD|TH|TR|UL|OL|TABLE|BODY|FIELDSET|DETAILS)$/;
export function around(node, el, n = 50) {
  const host = node || el;
  let block = parentOf(host);
  for (let k = 0; block && k < 2 && !STOP.test(block.tagName) && !/^(card|panel|tile|item)/i.test(block.className || '') && clean(block.textContent).length < (clean(host.textContent || '').length + 20); k++) {
    const up = parentOf(block);
    if (!up || up.tagName === 'BODY') break;
    block = up;
  }
  if (!block || !block.ownerDocument) return { before: '', after: '' };
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, 4);
  const texts = [];
  let at = -1;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const s = clean(t.nodeValue);
    if (!s) continue;
    if (t === node || (!node && el && el.contains(t))) { if (at < 0) at = texts.length; continue; }
    texts.push({ s, before: at < 0 });
  }
  if (at < 0 && !node) at = texts.length;
  const before = clean(texts.filter((x) => x.before).map((x) => x.s).join(' '));
  const after = clean(texts.filter((x) => !x.before).map((x) => x.s).join(' '));
  // cut at word boundaries
  const tail = (x) => { if (x.length <= n) return x; const t = x.slice(-n); const sp = t.indexOf(' '); return '…' + (sp > 0 && sp < 15 ? t.slice(sp + 1) : t); };
  const head = (x) => { if (x.length <= n) return x; const h = x.slice(0, n); const sp = h.lastIndexOf(' '); return (sp > n - 15 ? h.slice(0, sp) : h) + '…'; };
  return { before: tail(before), after: head(after) };
}

// Class names that are generated by build tools (css-1x2y3z, sc-AxjAm, jsx-123, _3fXc_) say nothing stable about the slot.
const HASHY = /^(css|sc|jsx|emotion|styled|chakra|mui|tw|svelte|astro|ng|v)-|\d{3,}|^_|[A-Z].*[a-z].*[A-Z].*\d|^[a-z]{1,2}\d|__[a-z0-9]{5,}$/;
const STABLE_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'itemprop', 'data-field', 'name'];

/** A selector for the "slot" this text fills, stable across pages (`span.user-name`, `[data-testid="persona-name"]`), or '' if the element
 *  has nothing specific (a bare `span` would match far too much to learn from). */
export function slotOf(el) {
  if (!el || el.nodeType !== 1) return '';
  // a test id on the element or its parent; classes only on the element itself (a class further up, such as `div.card`, would cover the whole card)
  for (let e = el, k = 0; e && e.nodeType === 1 && k < 2; e = parentOf(e), k++) {
    for (const a of STABLE_ATTRS) {
      const v = e.getAttribute(a);
      if (v && v.length <= 40 && !/\d{3,}/.test(v) && /^[\w:.-]+$/.test(v)) return `[${a}="${v}"]`;
    }
  }
  const cls = [...(el.classList || [])].filter((c) => c.length >= 3 && c.length <= 32 && !HASHY.test(c) && /^[a-z][\w-]*$/i.test(c));
  return cls.length ? el.tagName.toLowerCase() + cls.slice(0, 2).map((c) => '.' + c).join('') : '';
}

/**
 * Everything a translator needs to place a string.
 * @param {Node|null} node the text node (null for attributes)
 * @param {Element} el the element it belongs to
 * @param {string} [attr] attribute name for placeholder/alt/title/aria-label
 */
export function describe(node, el, attr) {
  try {
    const kind = kindOf(el, attr);
    const region = regionOf(el);
    const heading = kind === 'heading' ? '' : headingOf(el);
    const label = attr ? fieldLabel(el) : '';
    const near = attr ? { before: '', after: '' } : around(node, el);
    const path = [region, heading && `“${heading}”`, label && `field “${label}”`].filter(Boolean).join(' › ');
    return { kind, region, heading, label, before: near.before, after: near.after, path, slot: slotOf(el) };
  } catch (e) {
    return { kind: attr || 'text', region: '', heading: '', label: '', before: '', after: '', path: '', slot: '' };
  }
}

/** One short line for lists: "button · Navigation › “Settings”". */
export const contextLine = (c) => (c ? [c.kind, c.path].filter(Boolean).join(' · ') : '');
