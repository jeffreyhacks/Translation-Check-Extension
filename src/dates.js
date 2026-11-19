// Dates written with month names ("10. Nov. 2026", "10 nov. 2026", "Nov 10, 2026", "10 de noviembre de 2026"). They are formatted by the app,
// not translated by a person, and a lone "Nov" after the digits are masked is a short word no model can place, so they used to end up as
// "can't tell". Month and weekday names come from Intl for the page's language and for English (code often formats dates in its default locale).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();

function names(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const months = new Set(), days = new Set();
  try {
    for (let m = 0; m < 12; m++) {
      const d = new Date(2026, m, 15);
      for (const month of ['long', 'short']) {
        months.add(new Intl.DateTimeFormat(lang, { month }).format(d));
        const part = new Intl.DateTimeFormat(lang, { day: 'numeric', month }).formatToParts(d).find((p) => p.type === 'month'); // genitive: "listopada"
        if (part) months.add(part.value);
      }
    }
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 10, 9 + i);
      for (const weekday of ['long', 'short']) days.add(new Intl.DateTimeFormat(lang, { weekday }).format(d));
    }
  } catch (e) { /* unknown locale */ }
  const clean = (set) => [...set].map((s) => s.replace(/\.$/, '').trim()).filter((s) => s && !/\d/.test(s));
  const out = { months: clean(months), days: clean(days) };
  cache.set(lang, out);
  return out;
}

const reCache = new Map();
/** One regex that matches dates with a month name in `lang` or in English. */
export function dateRe(lang) {
  const key = String(lang || 'en').toLowerCase();
  if (reCache.has(key)) return reCache.get(key);
  const a = names(key), b = key === 'en' ? { months: [], days: [] } : names('en');
  const alt = (list) => [...new Set(list)].sort((x, y) => y.length - x.length).map(esc).join('|');
  const months = alt([...a.months, ...b.months]), days = alt([...a.days, ...b.days]);
  let re = null;
  if (months) {
    const M = `(?:${months})\\.?`;
    const W = days ? `(?:(?:${days})\\.?,?\\s+)?` : '';
    const D = '\\d{1,2}(?:\\.|st|nd|rd|th|er|º)?';
    const Y = "(?:\\d{4}|'\\d{2})(?:\\s?(?:г\\.|г|年))?";
    const forms = [
      `${W}${D}\\s*(?:de\\s+)?${M}(?:,?\\s*(?:de\\s+)?${Y})?`, // 10. Nov. 2026 · 10 nov. 2026 · 10 de noviembre de 2026 · 10 listopada
      `${W}${M}\\s+${D}(?:,?\\s*${Y})?`,                      // Nov 10, 2026 · Tuesday, November 10
      `${M}\\s+${Y}`,                                        // Nov 2026
    ];
    re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
  }
  reCache.set(key, re);
  return re;
}

/** Month names used in `text` that are English and not also a month name of `lang` ("Nov" is German too, "November" is Dutch too). */
export function englishMonths(text, lang) {
  const base = String(lang || '').toLowerCase().split(/[-_]/)[0];
  if (!base || base === 'en') return [];
  const re = dateRe(base);
  if (!re) return [];
  const own = new Set(names(base).months.map((m) => m.toLowerCase()));
  const en = new Set(names('en').months.map((m) => m.toLowerCase()));
  const out = [];
  for (const m of text.matchAll(re)) {
    for (const w of m[0].match(/\p{L}[\p{L}\p{M}]*/gu) || []) { const k = w.toLowerCase(); if (en.has(k) && !own.has(k)) out.push(w); }
  }
  return [...new Set(out)];
}
