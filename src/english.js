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
/** Every word of the text is also a word of `lang` (from its word list); false when there is no list for `lang`. */
export const sharedEntirely = (text, lang) => { const set = sharedWith(lang); const w = text.toLowerCase().match(/\p{L}[\p{L}\p{M}]*/gu) || []; return !!set && w.length > 0 && w.every((x) => set.has(x)); };

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
  for (const raw of text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []) {
    const w = raw.toLowerCase();
    if (stop && stop.has(w)) { own++; continue; }
    if (lang === 'nl' && /[a-z]['’]s$/.test(w)) { own++; continue; } // Dutch plural "persona's", "menu's", "scenario's" (English uses 's for possessives, rare in labels)
    if (w.length < 3 || NEUTRAL.has(w)) continue;
    if (/[^a-z'’-]/.test(w)) { own++; continue; } // accented or non-ASCII letters: not English wording
    const parts = w.split(/['’-]/).filter(Boolean);
    if (!parts.every((p) => E.has(p) || p.length < 3)) { own++; continue; }
    const shared = S ? parts.some((p) => S.has(p)) : !tinyPrefersEnglish(w, lang);
    if (shared) shr++; else { n++; hits.push(raw); }
  }
  return { en: n, own, shared: shr, hits };
}

/** True when every word of the text is everyday English (or neutral), with at least one real word: "Command Center", "Rubrics",
 *  "Analyzing conversation transcript". On an English page that settles it, where the models can't agree on two or three words. */
const EN_SHORT = new Set('a i an am as at be by do go he if in is it me my no of oh ok on or so to up us we'.split(' ')); // "de", "la", "le" are not English
export function allEnglish(text) {
  const E = en(), stop = STOP.en;
  let real = 0;
  for (const raw of text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []) {
    const w = raw.toLowerCase();
    const parts = w.split(/['’-]/).filter(Boolean);
    if (stop.has(w) || NEUTRAL.has(w)) { real++; continue; }
    if (parts.every((p) => E.has(p) || EN_SHORT.has(p))) { if (w.length >= 3) real++; continue; }
    return false;
  }
  return real > 0;
}

// (no -er/-ers: that is the Danish/Norwegian/Swedish plural, "Personaer", "Rapporter"; English -er words such as "trainer" are in the dictionary already)
// English morphology for words the dictionary lists only in their base form: plurals and endings ("integrations", "personas", "coachable"),
// prefixes ("reskilling", "upskilling") and closed compounds of two English words ("roleplay", "autosave", "datetime", "signout").
const SUFFIXES = ['s', 'es', 'ing', 'ings', 'ed', 'able', 'ability', 'ly', 'ness', 'ment', 'ments', 'ful', 'less', 'ize', 'ized', 'ization', 'ise', 'ised'];
const PREFIXES = ['re', 'un', 'up', 'pre', 'co', 'de', 'sub', 'non', 'self', 'auto', 'micro', 'multi', 'over', 'out', 'under', 'inter', 'mis', 'post'];
function enBase(w, E) {
  if (E.has(w)) return true;
  for (const suf of SUFFIXES) {
    if (w.length - suf.length < 3 || !w.endsWith(suf)) continue;
    const b = w.slice(0, -suf.length);
    if (E.has(b) || E.has(b + 'e') || (b.length >= 4 && b[b.length - 1] === b[b.length - 2] && E.has(b.slice(0, -1))) || (b.endsWith('i') && E.has(b.slice(0, -1) + 'y'))) return true;
  }
  return false;
}
const PARTICLES = new Set(['up', 'in', 'on', 'out', 'off']);
function enWord(w, E) {
  if (enBase(w, E)) return true;
  for (const p of PREFIXES) if (w.length - p.length >= 4 && w.startsWith(p) && enBase(w.slice(p.length), E)) return true;
  // two English words joined, each 4+ letters ("roleplay", "datetime"), or a word and a particle ("signup", "signout"). Shorter halves match
  // too much Danish: "rap|porter" (Rapporter), "for|handling" (Forhandling).
  for (let i = 4; i <= w.length - 2; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (E.has(a) && (b.length >= 4 ? enBase(b, E) : PARTICLES.has(b))) return true;
  }
  return false;
}
/** Like allEnglish, but also accepts derived and compound English words and acronyms ("KPIs", "SSO", "CSAT"). Weaker evidence than allEnglish
 *  (a Danish word can split into two English ones: "for|handling"), so it is only used where the models are also consulted. */
export function englishLike(text) {
  const E = en(), stop = STOP.en;
  let real = 0;
  for (const raw of text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []) {
    if (/^[A-Z]{2,6}s?$/.test(raw)) continue; // acronym: no language
    const w = raw.toLowerCase();
    if (/[^a-z'’-]/.test(w)) return false;
    const parts = w.split(/['’-]/).filter(Boolean);
    if (stop.has(w) || NEUTRAL.has(w)) { real++; continue; }
    if (parts.every((p) => EN_SHORT.has(p) || NEUTRAL.has(p) || enWord(p, E))) { if (w.length >= 3) real++; continue; }
    return false;
  }
  return real > 0;
}

/** True when the text is English wording on a non-English page: English-only words, none of the target's own, and English-only words make up
 *  at least half of what is left. A single word must be long and the target must have a word list (short words are cognate-prone). */
export function looksEnglish(text, lang) {
  if (lang === 'en') return false;
  const { en: n, own, shared: s } = englishWords(text, lang);
  if (!n || own) return false;
  if (n + s === 1) { // one word: also needs tinyld to clearly prefer English for it ("Navigation", "Administrator" are German too)
    const w = text.match(/\p{L}[\p{L}\p{M}'’-]*/gu).find((x) => x.length >= 3 && !NEUTRAL.has(x.toLowerCase()));
    return hasWordList(lang) && w.length >= 9 && tinyPrefersEnglish(w.toLowerCase(), lang);
  }
  return n / (n + s) >= 0.5 && (hasWordList(lang) || n >= 2);
}
