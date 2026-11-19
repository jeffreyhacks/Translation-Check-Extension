// Short strings are where language models are least trustworthy: a single word like "Export", "Active" or "Account"
// is valid in several languages, so three models "agreeing" it is English proves nothing. Such a string may only be
// called untranslated on hard evidence (English-only wording, a different script, or being identical to the source page).
import { EN_FN } from './lexicon.js';
import { targetCompetes } from './engine.js';
export const HARD = /^(Looks like English text|Written in |Latin-script text|Identical to the source)/;
const letters = (t) => (t.match(/\p{L}/gu) || []).length;
const wordsOf = (t) => (t.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).length;

export function isShort(text) { return wordsOf(text) <= 2 && letters(text) < 16; }

// Two or more models naming the same other language is real evidence for a PHRASE, as long as nothing in it is a word the target language also
// claims ("Archives actives" is French although both models say English) and an English claim isn't resting on accented letters ("Pläne").
// One word ("Export", "Account") is never settled this way: it is valid in both languages, so agreement between models proves nothing.
function agreedPhrase(text, v, lang, related) {
  const a = v.agree;
  if (!a || a.n < 2 || wordsOf(text) < 2) return false;
  if (v.votes && Object.values(v.votes).includes('target')) return false;
  if (a.lang === 'en' && /[\u00c0-\u024f]/.test(text)) return false;
  return targetCompetes(text, lang, a.lang, related) === 0;
}

/** Downgrade a model-only warning on a short string to "can't tell" (unless it is a phrase the models agree on, see above). */
export function guardShort(text, v, lang, related = true) {
  if (!v || v.v !== 'bad' || HARD.test(v.reason || '') || !isShort(text)) return v;
  if (v.notEnglish) return v; // English check: not a word of English, and two models name the page's own language (see verify.js)
  const lower = (text.toLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []);
  if (lower.some((w) => w.length >= 3 && EN_FN.has(w))) return v; // contains an unmistakably English word ("save", "welcome", "cancel")
  if (lang && agreedPhrase(text, v, lang, related)) return v;
  return { v: 'unsure', reason: 'Short word shared by several languages', votes: v.votes, guarded: true, was: { detected: v.detected, sT: v.sT, sO: v.sO, confirmed: v.confirmed } };
}
