import { englishMonths } from './dates.js';
// Rules that don't need a language model: leaked translation keys / broken placeholders,
// and number/date formatting hints. Pure functions, easy to unit-test.

const TLD = new Set('com org net io co uk dev app ai edu gov info me us de fr es it nl ru cn jp in br au ca ke za ng eu tv xyz tech cloud online store site page'.split(' '));

const LEAK = [
  [/\{\{[^{}]{1,80}\}\}/, 'Unfilled template placeholder'],
  [/\$\{[^{}]{1,80}\}/, 'Unfilled template placeholder'],
  [/(?<![\w{])\{\d{1,2}\}(?![\w}])/, 'Unfilled {0}-style placeholder'],
  [/(?<!\d)%(?:\d+\$)?[sd@](?![\p{L}\d])/u, 'Unfilled %s-style placeholder'],
  [/%\{\w+\}|%\(\w+\)s/, 'Unfilled %{name}-style placeholder'],
  [/__MSG_\w+__/, 'Unresolved extension message'],
  [/\[object Object\]/, 'Object printed as text'],
  [/\b(?:translation[ _]missing|missing[ _]translation|MISSING_TRANSLATION)\b/i, 'Missing-translation marker'],
  [/\[missing\s+["'`][^"'`]+["'`]\s+translation\]/i, 'Missing-translation marker'],
];

/** @returns {string|null} a reason if the text looks like a broken/leaked string */
export function detectBug(text) {
  const t = text.trim();
  if (!t || t.length > 400) return null;
  for (const [re, why] of LEAK) if (re.test(t)) return why;
  if (/^(?:null|undefined|NaN)$/.test(t)) return `Value "${t}" shown to users`;
  if (/\b(?:undefined|NaN)\b/.test(t) && t.split(/\s+/).length <= 8) return 'Value "undefined"/"NaN" shown to users';
  if (/\s/.test(t) || t.length < 5 || t.length > 80 || /^(?:https?|mailto|tel|ftp|file):/i.test(t)) return null;
  const last = t.split('.').pop().toLowerCase();
  if (/^[A-Za-z][\w-]+(?::[A-Za-z][\w-]+)?(?:\.[A-Za-z][\w-]+){2,}$/.test(t) && !TLD.has(last) && !/^www\./i.test(t)) return 'Looks like a translation key';
  if (/^[a-z][\w-]+:[a-z][\w-]*(?:\.[a-z][\w-]+)+$/.test(t)) return 'Looks like a translation key';
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(t)) return 'Looks like a translation key';
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}$/.test(t)) return 'Looks like a translation key';
  return null;
}

const cache = new Map();
// Month names in English, for the US date order check ("Nov 13, 2026"). Built from Intl so abbreviations match what apps print.
const EN_MONTHS = (() => {
  const out = new Set();
  try { for (let m = 0; m < 12; m++) for (const month of ['long', 'short']) out.add(new Intl.DateTimeFormat('en', { month }).format(new Date(2026, m, 15)).replace(/\.$/, '')); } catch (e) { /* no Intl */ }
  out.add('Sept');
  return [...out].sort((a, b) => b.length - a.length);
})();
const US_DATE = new RegExp(`(?<![\\p{L}\\d])(?:${EN_MONTHS.join('|')})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,\\s*\\d{4}(?!\\d)`, 'u');
const TIME_12H = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AaPp]\.?[Mm]\.?)(?![\p{L}])/u;
function localeInfo(lang) {
  if (cache.has(lang)) return cache.get(lang);
  let info = null;
  try {
    const nf = new Intl.NumberFormat(lang).formatToParts(1234567.5);
    const df = new Intl.DateTimeFormat(lang, { dateStyle: 'short' }).formatToParts(new Date(2026, 10, 25));
    const md = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(new Date(2026, 10, 25)).map((p) => p.type);
    info = {
      monthFirst: md.indexOf('month') < md.indexOf('day'),
      h12: new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions().hour12 === true,
      dec: nf.find((p) => p.type === 'decimal')?.value,
      grp: nf.find((p) => p.type === 'group')?.value,
      dsep: (df.find((p) => p.type === 'literal')?.value || '/').trim()[0] || '/',
    };
  } catch (e) { /* unknown locale */ }
  cache.set(lang, info);
  return info;
}
const nice = (c) => (c === ',' ? 'comma' : c === '.' ? 'period' : /\s/.test(c) ? 'space' : c);

/** @returns {string[]} low-confidence hints about number/date/currency formatting for `lang`.
 *  `numbers: false` leaves out the number and price checks (dates and times are checked on every scan; numbers only with Format hints on). */
export function formatHints(text, lang, { numbers = true, dates = true } = {}) {
  const L = localeInfo(lang);
  if (!L || text.length > 300) return [];
  const out = [];
  if (numbers) numberHints(text, lang, L, out);
  if (dates) dateHints(text, lang, L, out);
  return out;
}

function numberHints(text, lang, L, out) {
  if (L.grp && L.grp !== ',' && (/\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?/.test(text) || /\d{1,3}(?:,\d{3})+\.\d{1,2}\b/.test(text))) {
    out.push(`Number uses a comma as thousands separator; ${lang} uses a ${nice(L.grp)}`);
  }
  if (L.dec === ',' && (/[€$£]\s?\d+\.\d{2}\b/.test(text) || /\b\d+\.\d{2}\s?[€$£]/.test(text))) {
    out.push(`Price uses a period as decimal separator; ${lang} uses a comma`);
  }
  if (L.dec === '.' && (/[€$£]\s?\d+,\d{2}\b/.test(text) || /\b\d+,\d{2}\s?[€$£]/.test(text))) {
    out.push(`Price uses a comma as decimal separator; ${lang} uses a period`);
  }
}

function dateHints(text, lang, L, out) {
  const base = String(lang).toLowerCase().split(/[-_]/)[0];
  const em = englishMonths(text, lang);
  if (em.length) out.push(`Date uses an English month name (${em.join(', ')})`);
  const d = text.match(/\b\d{1,2}([/.-])\d{1,2}\1\d{4}\b/);
  if (d && d[1] !== L.dsep) out.push(`Date written with "${d[1]}"; ${lang} usually uses "${L.dsep}"`);
  // "Nov 13, 2026": English month-day-year order, on a page whose language puts the day first ("13. Nov. 2026")
  if (base !== 'en' && !L.monthFirst && US_DATE.test(text)) out.push(`Date in English order (month day, year); ${lang} puts the day first`);
  // "08:38 PM": 12-hour clock on a page whose language uses the 24-hour clock ("20:38")
  if (base !== 'en' && !L.h12 && TIME_12H.test(text)) out.push(`Time uses the 12-hour clock (AM/PM); ${lang} uses the 24-hour clock`);
}

/** How a date in `text` is written, to spot pages that mix formats: 'numeric /', 'numeric .', 'numeric -', 'ISO', 'month name, month first',
 *  'month name, day first', or '' when there is no date. */
export function dateStyle(text) {
  if (/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/.test(text)) return 'ISO';
  const d = text.match(/(?<!\d)\d{1,2}([/.-])\d{1,2}\1\d{2,4}(?!\d)/);
  if (d) return 'numeric ' + d[1];
  if (US_DATE.test(text)) return 'month name, month first';
  const MON = EN_MONTHS.join('|');
  if (new RegExp(`(?<!\\d)\\d{1,2}\\.?\\s*(?:${MON}|\\p{L}{3,9})\\.?\\s+\\d{4}(?!\\d)`, 'u').test(text)) return 'month name, day first';
  return '';
}
