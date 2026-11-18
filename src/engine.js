// Language-judging engine. Pure logic (no DOM) so it can be unit-tested in Node.
import { detectAll, supportedLanguages, toISO2 } from 'tinyld/heavy';
import { EN_SINGLE, EN_FN, EN_WEAK } from './lexicon.js';
import { stopHits, STOP } from './stopwords.js';
import { impossible, implausible } from './alphabet.js';
import { looksEnglish, allEnglish } from './english.js';
export { EN_SINGLE, EN_FN, EN_WEAK };

const TINY = new Set(supportedLanguages.map(toISO2));

import { TARGET_SCRIPTS } from './scripts.js';
export { TARGET_SCRIPTS };
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
export const groupOf = (l) => GROUPS.find((g) => g.includes(l)) || [l];
// Families of closely related languages (regional neighbours that detectors often confuse).
const FAMILIES = [['es', 'pt', 'ca', 'gl'], ['da', 'no', 'sv'], ['cs', 'sk'], ['ru', 'be'], ['uk', 'be'], ['hr', 'sr', 'bs', 'sl'], ['id', 'ms'], ['nl', 'af'], ['de', 'lb'], ['fr', 'oc']];
export const relatedOf = (l) => [...new Set(FAMILIES.filter((f) => f.includes(l)).flat())].filter((x) => x !== l && !groupOf(l).includes(x));
// Languages the detector names for odd strings but that are very unlikely on a real page.
const NOISE = new Set(['la', 'eo', 'rn', 'yo', 'sn', 'st', 'tn', 'zu', 'xh', 'so', 'ny', 'mg', 'lg', 'ber', 'tlh']);
// Related-language verdict: fine unless the text is long and the detector is very sure.
const relatedVerdict = (l, text, acc) => (text.length >= 80 && acc >= 0.85 ? bad(l, 'Looks like a different (related) language') : OK);

const NEUTRAL = new Set(['in', 'on', 'a', 'an', 'of', 'to']); // valid in many languages: neither prove nor disprove English
// International words that are normal on pages in any language.
const LOANWORDS = new Set('home menu email online blog login logout newsletter password app wifi ok news shop team video audio info download upload chat status test link mail web website internet'.split(' '));

const OK = { v: 'ok' };
const UNSURE = { v: 'unsure' };
// An undecided verdict that keeps tinyld's own head-to-head scores, so the verifier can count tinyld as an independent voter.
const unsure = (sT, sO, other) => ({ v: 'unsure', sT, sO, other });
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
  if (!sT) return sO >= 0.15 ? { ...bad(other, 'Detected as another language'), sT, sO } : null;
  if (!sO) return OK;
  const r = sT / sO;
  if (r >= 1.4) return OK;
  if (sO - sT >= 0.12 && r <= 0.5) return { ...bad(other, 'Detected as another language'), sT, sO };
  return null;
}

// "English-only" interface words that are ordinary words of some other languages too: never English evidence on those pages.
const ALSO = { nl: new Set(['help', 'start', 'reset']), de: new Set(['start']), da: new Set(['start']), sv: new Set(['start']), no: new Set(['start']) };
function englishScore(words, lang) {
  const also = ALSO[lang];
  if (also) words = words.filter((w) => !also.has(w));
  const nonN = words.filter((w) => !NEUTRAL.has(w));
  const strong = nonN.filter((w) => EN_FN.has(w)).length;
  // fully English = every word is English; cognates (EN_WEAK) are allowed only alongside at least one strong English word
  const fully = nonN.length > 0 && strong >= 1 && nonN.every((w) => EN_FN.has(w) || EN_WEAK.has(w));
  return { nonN, strong, fully };
}


// How much of a text is clearly English wording, and how much of it is the target language's own function words.
export function englishHits(text, lang) {
  const words = text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
  const { strong } = englishScore(words, lang);
  return { strong, own: Math.max(...groupOf(lang).map((g) => stopHits(words, g))) };
}
/** Words of a short text on which the target language (or a relative) is still a real contender against `other`: a text made only of
 *  words the target does NOT claim is foreign, but "Archives actives" has French in it even though the models call it English. */
export function targetCompetes(text, lang, other, related = true) {
  const eq = [...groupOf(lang), ...(related ? relatedOf(lang) : [])];
  const only = [...new Set([...eq, other])].filter((l) => TINY.has(l));
  if (!only.length || !other) return 0;
  let n = 0;
  for (const w of text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || []) {
    let sT = 0, sO = 0;
    for (const r of detectAll(w, { only })) { const l = norm(r.lang); if (eq.includes(l)) sT = Math.max(sT, r.accuracy); else if (l === other) sO = r.accuracy; }
    if (sT > 0 && sT >= sO * 0.7) n++;
  }
  return n;
}
// Languages a real page is plausibly written in. A model naming anything else (Corsican for "Impostazioni generali", Luxembourgish for "Hans Müller")
// is guessing, so its vote does not count.
const LIKELY = new Set('en es fr de it pt nl sv da no fi pl cs sk hu ro bg hr el tr ru uk ar fa he ur hi bn ta te th vi id ms sw ja ko zh ca sr bs sl lt lv et is be mk sq hy ka eu gl af cy ga mt mr gu kn ml pa ne si km lo my mn az kk uz'.split(' '));
export const plausible = (l) => LIKELY.has(l);
const letterCount = (t) => (t.match(/\p{L}/gu) || []).length;
// Latin-script languages most pages are written in: the shortlist to re-ask when a model's label can't be right ("Czech" for plain-ASCII Dutch).
const LATIN_COMMON = 'en es fr de it pt nl sv da no fi pl cs sk hu ro hr sl tr id ms vi ca'.split(' ');

// Name the language by function words when they clearly disagree with the model's guess (e.g. German reported as Hungarian).
export function relabel(words, guess) {
  let best = guess, hits = stopHits(words, guess);
  for (const l of Object.keys(STOP)) { const h = stopHits(words, l); if (h >= 2 && h > hits) { best = l; hits = h; } }
  return best;
}

// Second opinion before accusing a sentence of being in another language: the target must LOSE a head-to-head
// against that language, and the sentence must not be full of the target language's function words.
function confirmedOther(text, words, group, other) {
  const duel = detectAll(text, { only: [...group.filter((g) => TINY.has(g)), other] });
  let sT = 0, sL = 0;
  for (const r of duel) { if (group.includes(norm(r.lang))) sT = Math.max(sT, r.accuracy); else if (norm(r.lang) === other) sL = r.accuracy; }
  if (sT >= sL && sT > 0) return false;                       // target wins the duel
  const own = Math.max(...group.map((g) => stopHits(words, g)));
  if (own >= 2 && own > stopHits(words, other)) return false;   // clearly target-language function words
  return true;
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
      if (top && top.accuracy >= 0.5) {
        const l = norm(top.lang);
        const words = t.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
        const real = group.includes(l) || implausible(t, l) || !confirmedOther(t, words, group, l) ? group[0] : l; // unconfirmed or letter-implausible guesses count as the target
        tally[real] = (tally[real] || 0) + t.length; total += t.length;
      }
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
    // English page: if every word is in the English dictionary, the text is English, whatever the models make of a few words
    if (lang === 'en' && allEnglish(text)) return OK;
    // Non-Latin page (Hindi, Arabic, Russian, Chinese…) and short Latin-script text made only of English dictionary words ("technical • impatient"):
    // two independent hard facts (wrong script, English words), so the models' scattered guesses on two words don't matter. Names and brands
    // are left to the usual checks: a phrase where every word is capitalised ("Apple Music") only counts when it is plain interface wording.
    if (nonLatinTarget && words.length <= 3 && letterCount(text) >= 4 && allEnglish(text)) {
      const raw = text.match(/\p{L}[\p{L}'’-]*/gu) || [];
      const lower = raw.filter((w) => w[0] === w[0].toLowerCase()).length;
      if (lower >= 1 || raw.every((w) => EN_SINGLE.has(w.toLowerCase()) || EN_FN.has(w.toLowerCase()))) return bad('en', 'Looks like English text');
    }
    if (lang !== 'en') { // text made up entirely of English-only UI wording
      const { nonN, fully } = englishScore(words, lang);
      if (fully && (nonN.length >= 2 || words.length >= 2 || EN_SINGLE.has(nonN[0]))) return bad('en', 'Looks like English text');
      // everyday English words that are not words of the target language ("Enthusiastic, decisive" on a French page)
      if (words.length <= 12 && looksEnglish(text, lang)) return bad('en', 'Looks like English text');
    }

    if (tinyOK) {
      if (text.length >= 20 && words.length >= 3) { // enough text for an open-ended guess
        const t = detectAll(text)[0];
        if (t && t.accuracy >= 0.55 && !NOISE.has(t.lang)) {
          const l = norm(t.lang);
          if (group.includes(l)) return OK;
          if (rel.includes(l)) return relatedVerdict(l, text, t.accuracy);
          return confirmedOther(text, words, group, l) ? bad(relabel(words, l), 'Detected as another language') : OK;
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

    // Short text with clearly English wording and none of the target language's function words: trust the wording
    // over a weak statistical tie (e.g. French "Save changes" scores as a near-cognate of French).
    if (lang !== 'en' && words.length >= 2 && words.length <= 4) {
      const { nonN, strong } = englishScore(words, lang);
      if (strong >= 1 && strong / nonN.length >= 0.5 && Math.max(...group.map((g) => stopHits(words, g))) === 0) return bad('en', 'Looks like English text');
    }
    const v = decide(sT, sO, other);
    if (v) return v;
    // ambiguous scores: clear function words of another language and none of the target's are decisive
    if (tinyOK && other && sO > sT && words.length >= 4 && stopHits(words, other) >= 1 && Math.max(...group.map((g) => stopHits(words, g))) === 0) {
      return bad(other, 'Detected as another language');
    }

    if (lang !== 'en') { // ambiguous: lean on English wording if at least half the words are clearly English
      const { nonN, strong } = englishScore(words, lang);
      if (strong >= 1 && strong / nonN.length >= 0.5 && nonN.length >= 2) return bad('en', 'Looks like English text');
    }
    if (nonLatinTarget && words.length >= 4) return bad('latin', 'Latin-script text on a non-Latin page');
    return unsure(sT, sO, other);
  }

  async function classifyRaw(text, lang, ctx) {
    const tScripts = TARGET_SCRIPTS[lang] || ['latin'];
    const nonLatin = !tScripts.includes('latin');
    const sh = scriptShares(text);
    const inTarget = tScripts.reduce((a, s) => a + (sh[s] || 0), 0);
    if (inTarget >= 0.5) return nonLatin ? sameScript(text, lang, sh, ctx) : latin(text, lang, ctx, false);
    if (nonLatin && sh.latin >= 0.5) return latin(text, lang, ctx, true);
    const dom = Object.entries(sh).sort((a, b) => b[1] - a[1])[0][0];
    return bad(dom, `Written in ${dom} script`);
  }

  // A claim of "this is language L" is dropped when the text has letters L doesn't have (English claims are exempt).
  async function classify(text, lang, ctx) {
    const v = await classifyRaw(text, lang, ctx);
    if (v.v === 'bad' && v.detected && v.detected !== 'en' && implausible(text, norm(v.detected))) {
      // letters it lacks: drop the claim. Plain a-z with none of its marks ("Czech" for Dutch compounds): name the next plausible language instead,
      // and keep the warning only if that language really beats the target head-to-head.
      if (!impossible(text, norm(v.detected))) {
        const group = groupOf(lang), words = text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
        const pool = [...new Set([...group, ...LATIN_COMMON])].filter((l) => l !== norm(v.detected) && TINY.has(l) && !implausible(text, l));
        const alt = detectAll(text, { only: pool }).map((r) => norm(r.lang)).find((l) => !group.includes(l) && !relatedOf(lang).includes(l) && plausible(l));
        if (alt && confirmedOther(text, words, group, alt)) return { ...v, detected: relabel(words, alt) };
      }
      return { v: 'unsure', reason: 'Letters don’t fit the detected language' };
    }
    return v;
  }

  function dominant(texts) {
    const tally = {};
    let total = 0;
    for (const t of texts.slice(0, 60)) {
      if (t.length < 30) continue;
      const top = detectAll(t)[0];
      if (top && top.accuracy >= 0.5 && !NOISE.has(top.lang)) { const l = norm(top.lang); tally[l] = (tally[l] || 0) + t.length; total += t.length; }
    }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] / total >= 0.4 ? best[0] : null;
  }

  return { classify, pageContext, dominant };
}
