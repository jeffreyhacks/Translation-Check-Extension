// Dictionary evidence for English wording. Statistical models are close to useless on two or three words ("Enthusiastic, decisive" came back as
// Serbian, Spanish and "can't tell"), but a word that is everyday English and NOT a word of the target language is hard evidence:
// "decisive" is not French, while "impatient", "service" or "menu" are, so those stay neutral. Lists are built by scripts/wordlists.mjs.
import { detectAll, supportedLanguages, toISO2 } from 'tinyld/heavy';
import { EN_WORDS, SHARED } from './wordlists.js';
import { STOP } from './stopwords.js';

const TINY = new Set(supportedLanguages.map(toISO2));
let EN = null;
const shared = {};
const en = () => (EN ||= new Set(EN_WORDS.split(' ')));
const sharedWith = (lang) => (lang in SHARED ? (shared[lang] ||= new Set(SHARED[lang].split(' '))) : null);
export const hasWordList = (lang) => lang in SHARED;

// International words that are normal on pages in any language: neither English nor the target.
const NEUTRAL = new Set(('home menu email online blog login logout newsletter password app apps wifi news shop team video audio info download upload chat status ' +
  'test link links mail web website internet admin dashboard playground feedback trainee trainees coach coaching onboarding workflow chatbot bot api cloud server ' +
  'software hardware offline podcast webinar workshop meeting deadline smartphone laptop tool tools design marketing export import style cookie cookies ' +
  'manager management business startup support contact service services premium standard pro plus tour administrator moderator navigation information version position editor monitor ' +
  'sponsor partner interface internet intranet').split(' '));

// With no word list for the target (Swedish, Polish, Turkish...), a word counts as English-only only if tinyld also clearly prefers English for it.
function tinyPrefersEnglish(w, lang) {
  if (!TINY.has(lang)) return false;
  let sT = 0, sO = 0;
  for (const r of detectAll(w, { only: [lang, 'en'] })) { if (toISO2(r.lang) === lang) sT = r.accuracy; else sO = r.accuracy; }
  return sO > 0 && sT < sO * 0.5;
}

/** Counts the words of `text` that are English-only (`en`), the target language's own (`own`), and shared or neutral (`shared`). */
export function englishWords(text, lang) {
  const E = en(), S = sharedWith(lang), stop = STOP[lang];
  let n = 0, own = 0, shr = 0;
  const hits = [];
  for (const raw of text.match(/\p{L}[\p{L}'’-]*/gu) || []) {
    const w = raw.toLowerCase();
    if (stop && stop.has(w)) { own++; continue; }
    if (w.length < 3 || NEUTRAL.has(w)) continue;
    if (/[^a-z'’-]/.test(w)) { own++; continue; } // accented or non-ASCII letters: not English wording
    const parts = w.split(/['’-]/).filter(Boolean);
    if (!parts.every((p) => E.has(p) || p.length < 3)) { own++; continue; }
    const shared = S ? parts.some((p) => S.has(p)) : !tinyPrefersEnglish(w, lang);
    if (shared) shr++; else { n++; hits.push(raw); }
  }
  return { en: n, own, shared: shr, hits };
}

/** True when the text is English wording on a non-English page: English-only words, none of the target's own, and English-only words make up
 *  at least half of what is left. A single word must be long and the target must have a word list (short words are cognate-prone). */
export function looksEnglish(text, lang) {
  if (lang === 'en') return false;
  const { en: n, own, shared: s } = englishWords(text, lang);
  if (!n || own) return false;
  if (n + s === 1) { // one word: also needs tinyld to clearly prefer English for it ("Navigation", "Administrator" are German too)
    const w = text.match(/\p{L}[\p{L}'’-]*/gu).find((x) => x.length >= 3 && !NEUTRAL.has(x.toLowerCase()));
    return hasWordList(lang) && w.length >= 9 && tinyPrefersEnglish(w.toLowerCase(), lang);
  }
  return n / (n + s) >= 0.5 && (hasWordList(lang) || n >= 2);
}
