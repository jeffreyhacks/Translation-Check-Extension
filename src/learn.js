// Learning from Ignore clicks. Every Ignore is remembered with what the text looked like (its "shape") and where it sat (its "slot").
// When the same kind of thing is ignored again and again, a rule is learned so the next ones are skipped automatically:
//   - the same text ignored on 2+ sites          -> ignore it on all sites
//   - 3+ different texts of one narrow shape      -> ignore that shape on the site (product codes, versions, @handles, BrandCase…)
//   - 3+ different texts in the same page slot    -> ignore text in that slot on the site (`span.user-name`, `[data-testid="sku"]`)
// Deliberately never learned: broad shapes such as "a capitalised word" or "two capitalised words", which would also hide genuinely
// untranslated labels ("Settings", "Order History"). A rule the user removes is remembered as rejected and is not learned again.
// Pure functions: the popup records and learns, the page script only applies the rules it is given.
//
// Since 2.0.8 a rule is narrow on purpose:
//   - it belongs to the target language it was learned for (`lang`), and only applies when that language is checked;
//   - a slot is matched on the text's own element, never on a container further up, and a slot made of layout classes (`span.text-sm`,
//     `div.flex`: Tailwind, Bootstrap and the like) is never learned or applied, because it covers most of a page;
//   - it never decides alone: the page script judges every text first, and a rule only sets aside text the models could not place.
//     Text read as the target language stays translated (it is not listed), text read as another language stays a finding.

export const MIN_EXAMPLES = 3;
const MAX_HISTORY = 400;

// Narrow shapes only. Each one is a regex over the whole (whitespace-normalised) text.
export const SHAPES = {
  code: { re: /^(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9]+(?:[-_./#][A-Za-z0-9]+)+$/, label: 'codes like' }, // SKU-1234, AB/12/C, INV_2024_01
  version: { re: /^v?\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?$/i, label: 'version numbers like' },
  acronym: { re: /^[A-Z]{2,6}s?$/, label: 'abbreviations like' },
  brandcase: { re: /^[A-Z]?[a-z]+(?:[A-Z][a-z0-9]+)+$/, label: 'brand-style names like' }, // HubSpot, iPhone, LinkedIn, macOS
  handle: { re: /^[@#][\w.-]{2,}$/, label: '@handles and #tags like' },
  trademark: { re: /[®™©]/, label: 'trademarked names like' },
  ident: { re: /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/, label: 'identifiers like' }, // user_name, beta-flag
};

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();

/** The narrow shape of a text, or '' when it has none worth learning from. */
export function shapeOf(text) {
  const t = norm(text);
  if (!t || t.length > 60) return '';
  for (const [k, s] of Object.entries(SHAPES)) if (s.re.test(t)) return k;
  return '';
}

export const emptyMemory = () => ({ on: true, history: [], rules: [], rejected: [] });

/** Fills in what an older or partial stored value lacks. */
export function loadMemory(m) {
  const d = emptyMemory();
  if (!m || typeof m !== 'object') return d;
  return {
    on: m.on !== false,
    history: Array.isArray(m.history) ? m.history.filter((h) => h && typeof h.text === 'string').slice(-MAX_HISTORY) : [],
    rules: Array.isArray(m.rules) ? m.rules.filter(validRule) : [],
    rejected: Array.isArray(m.rejected) ? m.rejected.filter((r) => typeof r === 'string') : [],
  };
}

// The only selector forms slotOf() produces: `tag.class.class` or `[attr="value"]`. Anything else in stored data is not trusted.
const SLOT_RE = /^(?:[a-z][a-z0-9]*(?:\.[A-Za-z][\w-]*){1,2}|\[[a-z-]+="[\w:.-]+"\])$/;

// Layout and utility classes (Tailwind, Bootstrap, UnoCSS…) and generic names say nothing about what a text is: `span.text-sm` or
// `button.btn` is half of a page. A class slot needs at least one class that is not one of these.
const UTILITY = new RegExp('^(?:' + [
  'flex', 'grid', 'block', 'inline', 'contents', 'hidden', 'visible', 'invisible', 'truncate', 'relative', 'absolute', 'fixed', 'sticky', 'static',
  'container', 'isolate', 'group', 'peer', 'grow', 'shrink', 'underline', 'uppercase', 'lowercase', 'capitalize', 'italic', 'antialiased',
  'sr-only', 'clearfix', 'transition', 'transform', 'filter', 'border', 'rounded', 'shadow', 'ring', 'outline', 'resize', 'table', 'clear',
  '(?:items|justify|content|self|place|gap|space|divide|order|col|row|basis|grow|shrink|float|object|overflow|overscroll|inset|top|right|bottom|left|z|p[xytrblse]?|m[xytrblse]?|-m[xytrblse]?|w|h|size|min|max|text|font|leading|tracking|line-clamp|whitespace|break|bg|from|via|to|fill|stroke|border|rounded|shadow|ring|outline|opacity|cursor|select|pointer-events|transition|duration|delay|ease|animate|translate|scale|rotate|skew|origin|aspect|columns|decoration|indent|align|list|accent|caret|scroll|snap|touch|will|sm|md|lg|xl|2xl|dark|hover|focus|active|disabled|first|last|odd|even|d|fw|fs|lh|me|ms|pe|ps|g|gx|gy|offset|order|flex|grid|inline|display|position|text-bg|link|bg-opacity|text-opacity|border-opacity|ratio|vstack|hstack)-.*',
  'btn', 'button', 'link', 'label', 'text', 'title', 'subtitle', 'icon', 'wrapper', 'container', 'content', 'inner', 'outer', 'item', 'items',
  'row', 'col', 'cell', 'active', 'disabled', 'selected', 'open', 'show', 'fade', 'small', 'large', 'muted', 'primary', 'secondary', 'body',
  'header', 'footer', 'main', 'span', 'div', 'name', 'value', 'badge', 'tag', 'chip', 'pill', 'card', 'list', 'nav', 'menu',
].join('|') + ')$', 'i');
export const utilityClass = (c) => UTILITY.test(c);
/** True when a slot selector is specific enough to learn from: a test id, or at least one class that is not a layout/utility class. */
export function slotUsable(v) {
  if (typeof v !== 'string' || !SLOT_RE.test(v)) return false;
  if (v.startsWith('[')) return true;
  return v.split('.').slice(1).some((c) => !utilityClass(c));
}
const ruleId = (r) => `${r.type}|${r.scope}|${r.value}${r.lang ? '|' + r.lang : ''}`;
const langOf = (l) => String(l || '').toLowerCase().split(/[-_]/)[0].replace(/[^a-z]/g, '').slice(0, 3);
function validRule(r) {
  if (!r || !['term', 'shape', 'slot'].includes(r.type) || typeof r.value !== 'string' || !r.value || typeof r.scope !== 'string') return false;
  if (r.type === 'shape' && !SHAPES[r.value]) return false;
  if (r.type === 'slot' && !slotUsable(r.value)) return false; // only the selector forms slotOf() produces, and never a layout class
  if (r.lang !== undefined && (typeof r.lang !== 'string' || !/^[a-z]{0,3}$/.test(r.lang))) return false;
  return true;
}

/**
 * Remember one Ignore click and learn whatever it completes.
 * @param {object} mem memory from loadMemory()
 * @param {{text: string, host: string, slot?: string, lang?: string}} ev (lang: the target language that was checked)
 * @returns {{mem: object, learned: object[]}} new memory (the input is not changed) and the rules this click created
 */
export function record(mem, ev) {
  const m = loadMemory(mem);
  const text = norm(ev.text);
  if (!text || !m.on) return { mem: m, learned: [] };
  const entry = { text, host: ev.host || '', slot: slotUsable(ev.slot) ? ev.slot : '', shape: shapeOf(text), lang: langOf(ev.lang), at: Date.now() };
  m.history = [...m.history.filter((h) => !(key(h.text) === key(text) && h.host === entry.host && (h.lang || '') === entry.lang)), entry].slice(-MAX_HISTORY);
  const learned = [];
  for (const r of candidates(m.history, entry)) {
    const id = ruleId(r);
    if (m.rejected.includes(id) || m.rules.some((x) => ruleId(x) === id)) continue;
    m.rules.push(r); learned.push(r);
  }
  return { mem: m, learned };
}

function candidates(all, e) {
  const out = [];
  // only Ignores made while checking the same target language count together (an older entry without a language counts with any)
  const history = all.filter((h) => !h.lang || !e.lang || h.lang === e.lang);
  const lang = e.lang ? { lang: e.lang } : {};
  const distinct = (list) => [...new Map(list.map((h) => [key(h.text), h.text])).values()];
  // 1) the same text ignored on two or more sites: it is a term everywhere
  const sites = new Set(history.filter((h) => key(h.text) === key(e.text)).map((h) => h.host).filter(Boolean));
  if (sites.size >= 2) out.push({ type: 'term', scope: '*', value: e.text, ...lang, examples: [e.text], sites: sites.size, at: Date.now() });
  // 2) a narrow shape, three different examples on this site (or on any sites, for a rule everywhere)
  if (e.shape) {
    const here = distinct(history.filter((h) => h.shape === e.shape && h.host === e.host));
    if (here.length >= MIN_EXAMPLES) out.push({ type: 'shape', scope: e.host, value: e.shape, ...lang, examples: here.slice(-3), at: Date.now() });
    const all = history.filter((h) => h.shape === e.shape);
    const allSites = new Set(all.map((h) => h.host));
    if (allSites.size >= 2 && distinct(all).length >= MIN_EXAMPLES + 1) out.push({ type: 'shape', scope: '*', value: e.shape, ...lang, examples: distinct(all).slice(-3), at: Date.now() });
  }
  // 3) the same slot on this site, three different texts
  if (e.slot && e.host && slotUsable(e.slot)) {
    const here = distinct(history.filter((h) => h.slot === e.slot && h.host === e.host));
    if (here.length >= MIN_EXAMPLES) out.push({ type: 'slot', scope: e.host, value: e.slot, ...lang, examples: here.slice(-3), at: Date.now() });
  }
  return out;
}

/** Remove a rule and never learn it again. */
export function reject(mem, rule) {
  const m = loadMemory(mem);
  const id = ruleId(rule);
  m.rules = m.rules.filter((r) => ruleId(r) !== id);
  if (!m.rejected.includes(id)) m.rejected.push(id);
  return m;
}

/** The rules that apply on a site (its own and the all-sites ones). Each keeps its language; the page applies only those for the language it checks. */
export const rulesFor = (mem, host) => loadMemory(mem).rules.filter((r) => r.scope === '*' || r.scope === host).map(({ type, scope, value, lang }) => ({ type, scope, value, ...(lang ? { lang } : {}) }));

/** True when a rule applies to a check in `lang` (a rule from before 2.0.8 has no language and applies to any). */
export const forLang = (r, lang) => !r.lang || !lang || r.lang === langOf(lang);

/** A plain-language description: "codes like SKU-1234, AB-77 on this site". */
export function describeRule(r, host) {
  const where = (r.scope === '*' ? 'on all sites' : r.scope === host ? 'on this site' : `on ${r.scope}`) + (r.lang ? ` (${r.lang} pages)` : '');
  const ex = (r.examples || []).slice(0, 2).map((x) => `“${x}”`).join(', ');
  if (r.type === 'term') return `“${r.value}” ${where}`;
  if (r.type === 'shape') return `${SHAPES[r.value].label} ${ex || r.value} ${where}`;
  return `text in ${r.value}${ex ? ` (${ex})` : ''} ${where}`;
}

/**
 * Applies rules on the page. Returns a function (text, element) => rule|null.
 * Term rules are not handled here: they join the ignore terms (masking), like hand-entered terms.
 * `lang`: the language being checked; rules learned for another language are left out.
 * A slot matches the text's own element (a test id also on its parent, where slotOf() reads it), never any container further up:
 * `el.closest()` used to let a slot such as `div.flex` cover every text inside every such box.
 */
const BARE_INLINE = /^(B|STRONG|EM|I|U|SMALL|MARK|SPAN)$/i;
export function matcher(rules, lang) {
  const mine = (rules || []).filter((r) => r && forLang(r, lang));
  const shapes = mine.filter((r) => r.type === 'shape' && SHAPES[r.value]).map((r) => [SHAPES[r.value].re, r]);
  const slots = mine.filter((r) => r.type === 'slot' && slotUsable(r.value));
  if (!shapes.length && !slots.length) return () => null;
  return (text, el) => {
    const t = norm(text);
    for (const [re, r] of shapes) if (re.test(t)) return r;
    if (el && el.matches) {
      for (const r of slots) {
        try {
          if (el.matches(r.value)) return r;
          // one step up only for a test id (slotOf() reads it on the parent too) or through a bare inline wrapper (`<span class="user-name"><b>Ana`)
          const up = el.parentElement;
          if (up && (r.value.startsWith('[') || (BARE_INLINE.test(el.tagName) && !el.classList.length)) && up.matches(r.value)) return r;
        } catch (e) { /* bad selector */ }
      }
    }
    return null;
  };
}
