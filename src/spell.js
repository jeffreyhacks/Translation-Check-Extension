// Spelling and spacing hints. Precision over recall: each rule is narrow, and nothing here changes whether text counts as translated.
//   - repeated word            "the the", "Save save"                            any language written with spaces
//   - missing space after , ; : ! ? or .   "Save,cancel" "done.Next"            any language written with spaces
//   - run-together words       "Addto cart", "Clickhere", "Signupfor"           English (needs the dictionary)
//   - likely typo              "Recieve", "adress", "succesful"                 English (needs the dictionary)
// Typos are only reported for lowercase words (or the first word of a sentence-length text) that the dictionary does not know even as a
// plural, ending, prefix or compound, and that are one edit away from a word it does know. Capitalised words are names more often than not.
import { EN_WORDS } from './wordlists.js';
import { englishLike } from './english.js';
import { STOP } from './stopwords.js';

let E = null;
const en = () => (E ||= new Set(EN_WORDS.split(' ')));

// Scripts written without spaces between words: none of the spacing rules apply.
const NO_SPACES = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my']);
// Doubled words that are correct English ("had had", "that that") or common in other languages ("nous nous", "dass dass" is not, but rare).
const DOUBLE_OK = new Set(['had', 'that', 'is', 'do', 'bye', 'no', 'yes', 'very', 'so', 'nous', 'vous', 'ha', 'la', 'na', 'bla', 'tut', 'go', 'hip', 'knock', 'pom', 'now', 'well', 'there', 'chop', 'buy', 'quick', 'more']);
// Function words: a run-together join with one of them is almost never a real compound ("addto", "clickhere").
const FN = new Set(['the', 'to', 'of', 'and', 'or', 'for', 'with', 'your', 'our', 'my', 'you', 'we', 'is', 'are', 'be', 'by', 'at', 'from', 'this',
  'that', 'here', 'more', 'now', 'all', 'an', 'it', 'me', 'not', 'new', 'its', 'has', 'have', 'will', 'can', 'please']);
// Known closed compounds / brand words the dictionary may lack but that are written as one word on purpose.
const CLOSED = new Set(['login', 'logout', 'signup', 'signin', 'checkout', 'setup', 'backup', 'popup', 'dropdown', 'username', 'homepage', 'webpage',
  'website', 'inbox', 'online', 'offline', 'onboarding', 'offboarding', 'overview', 'workflow', 'workspace', 'dashboard', 'timeline', 'keyword',
  'password', 'passcode', 'checkbox', 'textbox', 'toolbar', 'sidebar', 'navbar', 'hashtag', 'download', 'upload', 'update', 'upgrade', 'startup',
  'thankyou', 'forall', 'anytime', 'anymore', 'anyway', 'everyday', 'maybe', 'cannot', 'into', 'onto', 'upon', 'within', 'without', 'itself',
  'yourself', 'ourselves', 'myself', 'herein', 'hereby', 'therein', 'thereof', 'forthe', 'nowhere', 'nonetheless', 'notwithstanding']);
// Common misspellings the edit-distance rule can't rank well (more than one edit, or several candidates).
const KNOWN = { recieve: 'receive', recieved: 'received', seperate: 'separate', occured: 'occurred', occurence: 'occurrence', untill: 'until',
  wich: 'which', adress: 'address', adresses: 'addresses', succesful: 'successful', succesfully: 'successfully', sucessful: 'successful',
  accomodate: 'accommodate', acheive: 'achieve', begining: 'beginning', beleive: 'believe', calender: 'calendar', definately: 'definitely',
  enviroment: 'environment', existance: 'existence', goverment: 'government', independant: 'independent', neccessary: 'necessary',
  noticable: 'noticeable', occassion: 'occasion', persue: 'pursue', posession: 'possession', prefered: 'preferred', priviledge: 'privilege',
  publically: 'publicly', recomend: 'recommend', reccomend: 'recommend', refered: 'referred', relevent: 'relevant', resturant: 'restaurant',
  succesfull: 'successful', tommorow: 'tomorrow', tommorrow: 'tomorrow', truely: 'truly', wierd: 'weird', paramter: 'parameter',
  langauge: 'language', lenght: 'length', widht: 'width', heigth: 'height', availabe: 'available', avaliable: 'available', informations: 'information',
  settigns: 'settings', setings: 'settings', sumary: 'summary', summery: 'summary', mesage: 'message', messsage: 'message', pasword: 'password',
  acount: 'account', accout: 'account', adminstrator: 'administrator', scenerio: 'scenario', scenerios: 'scenarios', critera: 'criteria',
  evaulation: 'evaluation', evalution: 'evaluation', simluation: 'simulation', confguration: 'configuration', configuraton: 'configuration' };

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** Dictionary words one edit (delete, swap, change, insert) away. */
function nearby(w, dict) {
  const out = new Set();
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b) { const d = a + b.slice(1); if (dict.has(d)) out.add(d); }
    if (b.length > 1) { const s = a + b[1] + b[0] + b.slice(2); if (dict.has(s)) out.add(s); }
    for (const c of LETTERS) {
      if (b) { const r = a + c + b.slice(1); if (r !== w && dict.has(r)) out.add(r); }
      const ins = a + c + b; if (dict.has(ins)) out.add(ins);
    }
  }
  return [...out];
}

const known = (w) => en().has(w) || CLOSED.has(w) || englishLike(w); // englishLike also knows neutral words (email, login, app…) and stopwords

const word = (w) => en().has(w) || STOP.en.has(w);
function runTogether(w) {
  // only the plain dictionary here: the compound rule in englishLike would accept "click|here" as a compound
  if (w.length < 5 || en().has(w) || CLOSED.has(w)) return null;
  for (let i = 2; i <= w.length - 2; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (!word(a) || !word(b)) continue;
    if ((FN.has(a) && b.length >= 3) || (FN.has(b) && a.length >= 3)) return `${a} ${b}`;
  }
  return null;
}

/**
 * Spelling and spacing hints for one text.
 * @param {string} text masked text (numbers, codes and ignored terms already removed)
 * @param {string} lang target language
 * @returns {{type: string, word: string, fix?: string, reason: string}[]}
 */
export function spellHints(text, lang) {
  const out = [];
  if (!text || NO_SPACES.has(lang)) return out;
  const seen = new Set();
  const push = (h) => { const k = h.type + '|' + h.word.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(h); } };

  // repeated word
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])(\p{L}{2,})\s+(\1)(?![\p{L}\p{N}])/giu)) {
    if (m[1].toLowerCase() !== m[2].toLowerCase() || DOUBLE_OK.has(m[1].toLowerCase())) continue;
    push({ type: 'repeat', word: `${m[1]} ${m[2]}`, fix: m[1], reason: `Repeated word: “${m[1]} ${m[2]}”` });
  }
  // missing space after punctuation: between two words, the second at least 3 letters ("e.g.", "i.e.", "Node.js", decimals are not)
  for (const m of text.matchAll(/(?<![\p{L}.])(\p{L}\p{Ll}+)([,;!?])(\p{L}{3,})/gu)) {
    if (lang === 'fr' && m[2] !== ',') continue; // French puts a (thin) space before ; ! ? — the after-space check is still valid for commas
    push({ type: 'space', word: m[0], fix: `${m[1]}${m[2]} ${m[3]}`, reason: `Missing space after “${m[2]}”: “${m[0]}”` });
  }
  for (const m of text.matchAll(/(?<![\p{L}.])(\p{L}\p{Ll}+)\.(\p{Lu}\p{Ll}{2,})(?![\p{L}.])/gu)) {
    push({ type: 'space', word: m[0], fix: `${m[1]}. ${m[2]}`, reason: `Missing space after “.”: “${m[0]}”` });
  }
  if (lang !== 'en') return out;

  const tokens = [...text.matchAll(/(?<![\p{L}\p{N}'’_@#/.-])(\p{L}+)(?![\p{L}\p{N}'’_/-])/gu)].map((m) => m[1]);
  const sentence = tokens.length >= 4;
  tokens.forEach((tok, i) => {
    if (!/^[a-z]+$/i.test(tok)) return; // other alphabets and accented words are not judged against an English dictionary
    const lower = tok.toLowerCase();
    const capital = tok[0] !== lower[0];
    if (/[A-Z]/.test(tok.slice(1))) return; // BrandCase, ACRONYMS
    // run-together words: a join with a function word is never a name, capitalised or not ("Addto", "Clickhere")
    const joined = runTogether(lower);
    if (joined) { const shown = capital ? joined[0].toUpperCase() + joined.slice(1) : joined; push({ type: 'join', word: tok, fix: shown, reason: `Missing space: “${tok}” → “${shown}”` }); return; }
    // typos
    if (lower.length < 5 || known(lower)) return;
    let fix = KNOWN[lower];
    if (!fix && capital && !(i === 0 && sentence)) return; // capitalised words are names more often than typos (unless a known misspelling)
    if (!fix) {
      const near = nearby(lower, en()).filter((c) => c.length >= 4);
      if (near.length !== 1) return; // no candidate, or several: not sure enough which word was meant
      fix = near[0];
    }
    const shown = capital ? fix[0].toUpperCase() + fix.slice(1) : fix;
    push({ type: 'typo', word: tok, fix: shown, reason: `Possible typo: “${tok}” → “${shown}”` });
  });
  return out;
}
