// Language-judging engine. Pure logic (no DOM) so it can be unit-tested in Node.
import { detectAll, supportedLanguages, toISO2 } from 'tinyld/heavy';
import { EN_SINGLE, EN_FN } from './lexicon.js';
export { EN_SINGLE, EN_FN };

const TINY = new Set(supportedLanguages.map(toISO2));

export const TARGET_SCRIPTS = {
  ru: ['cyrillic'], uk: ['cyrillic'], bg: ['cyrillic'],
  ar: ['arabic'], fa: ['arabic'], ur: ['arabic'], he: ['hebrew'],
  hi: ['devanagari'], bn: ['bengali'], ta: ['tamil'], te: ['telugu'],
  th: ['thai'], el: ['greek'], ja: ['han', 'kana'], zh: ['han'], ko: ['hangul'],
};
const SAME_SCRIPT = [['ru', 'uk', 'bg', 'be', 'sr'], ['ar', 'fa', 'ur'], ['hi', 'mr']];
const SCRIPT_RE = {
  latin: /\p{Script=Latin}/gu, cyrillic: /\p{Script=Cyrillic}/gu, arabic: /\p{Script=Arabic}/gu,
  hebrew: /\p{Script=Hebrew}/gu, devanagari: /\p{Script=Devanagari}/gu, bengali: /\p{Script=Bengali}/gu,
  tamil: /\p{Script=Tamil}/gu, telugu: /\p{Script=Telugu}/gu, thai: /\p{Script=Thai}/gu,
  greek: /\p{Script=Greek}/gu, han: /\p{Script=Han}/gu,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, hangul: /\p{Script=Hangul}/gu,
};
const ALIAS = { iw: 'he', in: 'id', nb: 'no', nn: 'no', jw: 'jv', cmn: 'zh' };
const GROUPS = [['hr', 'sr', 'bs'], ['id', 'ms'], ['no', 'da']]; // closely related; treated as equivalent
export const norm = (c) => { c = String(c).toLowerCase().split(/[-_]/)[0]; return ALIAS[c] || c; };
const groupOf = (l) => GROUPS.find((g) => g.includes(l)) || [l];
// Families of closely related languages (regional neighbours that detectors often confuse).
const FAMILIES = [['es', 'pt', 'ca', 'gl'], ['da', 'no', 'sv'], ['cs', 'sk'], ['ru', 'be'], ['uk', 'be'], ['hr', 'sr', 'bs', 'sl'], ['id', 'ms'], ['nl', 'af'], ['de', 'lb'], ['fr', 'oc']];
const relatedOf = (l) => [...new Set(FAMILIES.filter((f) => f.includes(l)).flat())].filter((x) => x !== l && !groupOf(l).includes(x));
// Languages the detector names for odd strings but that are very unlikely on a real page.
const NOISE = new Set(['la', 'eo', 'rn', 'yo', 'sn', 'st', 'tn', 'zu', 'xh', 'so', 'ny', 'mg', 'lg', 'ber', 'tlh']);
// Related-language verdict: fine unless the text is long and the detector is very sure.
const relatedVerdict = (l, text, acc) => (text.length >= 80 && acc >= 0.85 ? bad(l, 'Looks like a different (related) language') : OK);

const NEUTRAL = new Set(['in', 'on', 'a', 'an', 'of', 'to']); // valid in many languages: neither prove nor disprove English
// International words that are normal on pages in any language.
const LOANWORDS = new Set('home menu email online blog login logout newsletter password app wifi ok news shop team video audio info download upload chat status test link mail web website internet'.split(' '));

const OK = { v: 'ok' };
const UNSURE = { v: 'unsure' };
const bad = (detected, reason) => ({ v: 'bad', detected, reason });

function scriptShares(text) {
  const total = (text.match(/\p{L}/gu) || []).length || 1;
  const sh = {};
  for (const [k, re] of Object.entries(SCRIPT_RE)) sh[k] = (text.match(re) || []).length / total;
  return sh;
}

// Compare the target's score with the best competing score. Short strings give weak scores,
// so "bad" needs a clear gap, and anything ambiguous returns null (resolved later by context).
function decide(sT, sO, other) {
  if (!sT && !sO) return null;
  if (!sT) return sO >= 0.15 ? bad(other, 'Detected as another language') : null;
  if (!sO) return OK;
  const r = sT / sO;
  if (r >= 1.4) return OK;
  if (sO - sT >= 0.12 && r <= 0.5) return bad(other, 'Detected as another language');
  return null;
}

function englishScore(words) {
  const nonN = words.filter((w) => !NEUTRAL.has(w));
  return { nonN, strong: nonN.filter((w) => EN_FN.has(w)).length };
}

/** cld: async (text) => {isReliable, languages:[{language, percentage}]} | null  (browser's built-in detector) */
export function createEngine(cld = async () => null) {
  // Which other languages are present on this page? Used to narrow the comparison.
  function pageContext(longTexts, lang, htmlLang) {
    const group = groupOf(lang);
    const tally = {};
    let total = 0;
    for (const t of longTexts.slice(0, 40)) {
      if (t.length < 30) continue;
      const top = detectAll(t)[0];
      if (top && top.accuracy >= 0.5) { tally[top.lang] = (tally[top.lang] || 0) + t.length; total += t.length; }
    }
    const sources = Object.entries(tally)
      .filter(([l, n]) => !group.includes(l) && n / total >= 0.15)
      .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => l);
    const h = htmlLang && norm(htmlLang);
    if (h && !group.includes(h) && TINY.has(h) && !sources.includes(h)) sources.push(h);
    return { sources };
  }

  function sameScript(text, lang, sh, ctx) {
    if (lang === 'zh' && sh.kana > 0.1) return bad('ja', 'Japanese text');
    const grp = SAME_SCRIPT.find((g) => g.includes(lang));
    if (!grp || text.length < 15) return OK;
    const top = detectAll(text, { only: grp.filter((l) => TINY.has(l)) })[0];
    if (top && top.accuracy >= 0.6 && norm(top.lang) !== lang) {
      return ctx?.related !== false && relatedOf(lang).includes(norm(top.lang)) ? relatedVerdict(top.lang, text, top.accuracy) : bad(top.lang, 'Detected as another language');
    }
    return OK;
  }

  async function latin(text, lang, ctx, nonLatinTarget) {
    const words = text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
    const group = groupOf(lang);
    const rel = ctx?.related === false ? [] : relatedOf(lang);
    const eq = [...group, ...rel]; // counts as "the target" when judging short text
    const tinyOK = group.some((g) => TINY.has(g));
    let sT = 0, sO = 0, other = '';

    if (words.length === 1 && LOANWORDS.has(words[0])) return OK;
    if (lang !== 'en') { // text made up entirely of English-only UI wording
      const { nonN, strong } = englishScore(words);
      if (nonN.length && strong === nonN.length && (nonN.length >= 2 || words.length >= 2 || EN_SINGLE.has(nonN[0]))) return bad('en', 'Looks like English text');
    }

    if (tinyOK) {
      if (text.length >= 20 && words.length >= 3) { // enough text for an open-ended guess
        const t = detectAll(text)[0];
        if (t && t.accuracy >= 0.55 && !NOISE.has(t.lang)) {
          const l = norm(t.lang);
          if (group.includes(l)) return OK;
          if (rel.includes(l)) return relatedVerdict(l, text, t.accuracy);
          return bad(l, 'Detected as another language');
        }
      }
      const extra = lang === 'en' ? ['es', 'fr', 'de'] : ['en'];
      const cand = [...new Set([...eq, ...extra, ...(ctx?.sources || [])])].filter((l) => TINY.has(l)).slice(0, 9);
      for (const r of detectAll(text, { only: cand })) {
        const l = norm(r.lang);
        if (eq.includes(l)) sT = Math.max(sT, r.accuracy);
        else if (r.accuracy > sO && !NOISE.has(l)) { sO = r.accuracy; other = l; }
      }
    } else { // target not covered by the library (e.g. Catalan, Swahili): use the browser's detector
      const d = await cld(text.slice(0, 1000));
      if (d && d.isReliable) {
        for (const r of d.languages || []) {
          const l = norm(r.language), p = r.percentage / 100;
          if (eq.includes(l)) sT = Math.max(sT, p);
          else if (p > sO) { sO = p; other = l; }
        }
      }
    }

    const v = decide(sT, sO, other);
    if (v) return v;

    if (lang !== 'en') { // ambiguous: lean on English wording if at least half the words are clearly English
      const { nonN, strong } = englishScore(words);
      if (strong >= 1 && strong / nonN.length >= 0.5 && nonN.length >= 2) return bad('en', 'Looks like English text');
    }
    if (nonLatinTarget && words.length >= 4) return bad('latin', 'Latin-script text on a non-Latin page');
    return UNSURE;
  }

  async function classify(text, lang, ctx) {
    const tScripts = TARGET_SCRIPTS[lang] || ['latin'];
    const nonLatin = !tScripts.includes('latin');
    const sh = scriptShares(text);
    const inTarget = tScripts.reduce((a, s) => a + (sh[s] || 0), 0);
    if (inTarget >= 0.5) return nonLatin ? sameScript(text, lang, sh, ctx) : latin(text, lang, ctx, false);
    if (nonLatin && sh.latin >= 0.5) return latin(text, lang, ctx, true);
    const dom = Object.entries(sh).sort((a, b) => b[1] - a[1])[0][0];
    return bad(dom, `Written in ${dom} script`);
  }

  return { classify, pageContext };
}
