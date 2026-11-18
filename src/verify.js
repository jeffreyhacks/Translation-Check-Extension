// Multi-layer verification. Three detectors vote independently: tinyld (with the rules around it), Google's CLD3 (WebAssembly) and franc (trigram profiles).
// Each votes for the target language, for another language, or abstains. A model only abstains when it has no real guess; a guess that is right but
// not very confident still counts, so the decision is not thrown away. Then the simple rule applies: when two models agree, that decides:
//   - two read the text as the target language  -> it is translated (a warning is withdrawn, a "can't tell" is cleared);
//   - two read it as the same other language    -> it is untranslated (a "can't tell" becomes a warning, a warning is confirmed).
// A confident dissent from the third model, or clearly English wording, stops either conclusion. Short strings are cognate-prone, so there a
// model's confidence is never treated as strong. Text shaped like a name (see names.js) that the models cannot agree on is a name, not a leftover.
import { loadModule } from 'cld3-asm/dist/cjs/index.js'; // CommonJS entry: the ESM entry breaks when bundled for browsers
import { francAll } from 'franc-min'; // open-ended vote: the 82 big languages, which keeps short English from being read as Norwegian
import { francAll as francFull } from 'franc'; // head-to-head only: franc-min has no Danish, Norwegian, Finnish, Slovak..., so it can't be asked about them
import { detectAll, supportedLanguages, toISO2 } from 'tinyld/heavy';
import { norm, groupOf, relatedOf, relabel, englishHits, plausible, TARGET_SCRIPTS } from './engine.js';
import { englishLike, allEnglish, sharedEntirely } from './english.js';
import { implausible } from './alphabet.js';
import { HARD } from './guard.js';

const letters = (t) => (t.match(/\p{L}/gu) || []).length;
const wordsOf = (t) => (t.match(/\p{L}[\p{L}'’-]*/gu) || []).length;
const solid = (t) => letters(t) >= 20 && wordsOf(t) >= 3; // long enough for a model's own confidence to mean something
const ABSTAIN = { vote: 'abstain' };
const hasAccent = (t) => /[\u00c0-\u024f]/.test(t); // letters English words (almost) never use: é ä ö ü ñ ç ø ł ş ...

// franc speaks ISO 639-3; map to the 2-letter codes used everywhere else. Unmapped codes => the vote abstains.
const ISO3 = Object.fromEntries(('eng:en spa:es fra:fr deu:de ita:it por:pt nld:nl swe:sv dan:da nob:no nno:no fin:fi pol:pl ces:cs slk:sk hun:hu ron:ro bul:bg hrv:hr ' +
  'ell:el tur:tr rus:ru ukr:uk arb:ar arz:ar pes:fa prs:fa heb:he urd:ur hin:hi ben:bn tam:ta tel:te tha:th vie:vi ind:id zsm:ms zlm:ms swh:sw jpn:ja kor:ko cmn:zh ' +
  'yue:zh cat:ca bel:be srp:sr bos:bs slv:sl afr:af ltz:lb glg:gl oci:oc mar:mr guj:gu kan:kn mal:ml pan:pa mya:my khm:km sin:si npi:ne nep:ne amh:am uzn:uz kaz:kk ' +
  'azj:az tgl:tl lit:lt lav:lv est:et isl:is mkd:mk sqi:sq hye:hy kat:ka eus:eu jav:jv sun:su').split(' ').map((x) => x.split(':')));

const TO3 = {};
for (const [k, v] of Object.entries(ISO3)) (TO3[v] ||= []).push(k);
const TINY = new Set(supportedLanguages.map(toISO2));
// Same language or a close neighbour (da/no/sv, hr/sr/bs, es/pt...): models often name a neighbour, and that still says the same thing.
const kin = (a, b) => !!a && !!b && (a === b || groupOf(a).includes(b) || relatedOf(a).includes(b));

let idP = null;
const cld3Id = () => (idP ||= loadModule({ timeout: 20000 }).then((f) => f.create(0, 1000)).catch(() => null));

/** @param cldFallback async (text) => {isReliable, languages:[{language, percentage}]} — Chrome's own detector, used if CLD3 can't load */
export function createVerifier(cldFallback = async () => null) {
  const status = { cld3: 'pending', franc: 'ready' };

  // Turns "the model named language l" into a vote. Relatives of the target count for the target (they are accepted on the page anyway);
  // languages nobody writes pages in, and languages whose letters the text doesn't have, are not a real guess.
  function place(l, text, eq, strong) {
    if (l === 'en' && !strong && text && hasAccent(text)) return { ...ABSTAIN, lang: l }; // "Fortsæt", "Pläne" are not English, whichever side English is on
    if (eq.target.includes(l)) return { vote: 'target', lang: l, strong };
    if (eq.related.includes(l)) return { vote: 'target', lang: l, strong: false };
    if (!plausible(l) || (l !== 'en' && implausible(text, l))) return { ...ABSTAIN, lang: l };
    if (l === 'en' && !strong && hasAccent(text)) return { ...ABSTAIN, lang: l }; // "Pläne", "Privé", "Görsel" are not English, whatever a model says
    return { vote: 'other', lang: l, strong };
  }

  async function cld3Vote(text, eq, isSolid) {
    const id = await cld3Id();
    let lang, conf, reliable;
    if (id) {
      status.cld3 = 'wasm';
      const r = id.findLanguage(text.slice(0, 1000));
      lang = r && r.language; conf = r ? r.probability : 0; reliable = !!(r && r.is_reliable);
    } else {
      const d = await cldFallback(text.slice(0, 1000));
      status.cld3 = d ? 'chrome' : 'off';
      const top = d && d.languages && d.languages[0];
      lang = top && top.language; conf = top ? (top.percentage || 0) / 100 : 0; reliable = !!(d && d.isReliable);
    }
    if (!lang || lang === 'und' || conf < 0.3) return ABSTAIN;
    const p = place(norm(lang), text, eq, isSolid && (reliable || conf >= 0.8));
    return reliable && conf >= 0.8 ? { ...p, sure: true } : p; // a confident read even on a short string (only used with dictionary evidence)
  }

  function francVote(text, eq, isSolid) {
    const lt = letters(text);
    if (lt < 3) return ABSTAIN;
    const all = francAll(text, { minLength: 3 });
    if (!all.length || all[0][0] === 'und') return ABSTAIN;
    const short = lt < 14; // franc is weak on very short strings: demand a bigger lead
    const langOf = (code) => ISO3[code];
    const top = langOf(all[0][0]);
    if (!top) return ABSTAIN;
    const best = (pred) => all.reduce((m, [c, sc]) => (pred(langOf(c)) ? Math.max(m, sc) : m), 0);
    const near = [...eq.target, ...eq.related];
    if (eq.target.includes(top) || eq.related.includes(top)) { // lead over the best language that is neither the target nor a relative
      const lead = 1 - best((l) => l && !near.includes(l));
      return lead >= (short ? 0.15 : 0.04) ? place(top, text, eq, isSolid && lead >= 0.15) : { ...ABSTAIN, lang: top };
    }
    const behind = 1 - best((l) => near.includes(l)); // how far the target (or its relatives) is behind
    return behind >= (short ? 0.3 : 0.1) ? { ...place(top, text, eq, isSolid && behind >= 0.3), ...(behind >= 0.3 ? { sure: true } : {}) } : { ...ABSTAIN, lang: top };
  }

  // tinyld's own opinion. For a warning that is the engine's verdict (tinyld + the rules around it); for a "can't tell" it is tinyld's head-to-head
  // scores between the target and the best other candidate, which the engine could not call but which still lean one way.
  function tinyVote(v, eq, isSolid, text) {
    if (v.v === 'bad') return v.detected === 'en' && !isSolid && hasAccent(text) ? { ...ABSTAIN, lang: 'en' } : { vote: 'other', lang: v.detected, strong: isSolid, sure: true };
    const { sT = 0, sO = 0, other } = v;
    if (sT >= 0.15 && sT >= sO) return { vote: 'target', strong: false };
    if (sO >= 0.2 && sO > sT && other) return place(norm(other), '', eq, false);
    return ABSTAIN;
  }

  // Head-to-head: a model that abstained is asked again with only two choices, the target language and the language the rest of the page is in
  // (a Danish page checked as English: "English or Danish?"). Open-ended, a short string scatters over 80 languages and the model gives up;
  // narrowed to the two that matter it usually has a clear answer. It still abstains when the two are close. A duel vote is never strong.
  function duel(model, text, eq, sources) {
    const target = eq.target, rivals = sources.filter((l) => !eq.target.includes(l) && !eq.related.includes(l));
    if (!rivals.length || letters(text) < 3) return null;
    let ranked = [];
    if (model === 'tinyld') {
      const only = [...target, ...rivals].filter((l) => TINY.has(l));
      ranked = detectAll(text, { only }).map((r) => [norm(r.lang), r.accuracy]);
      if (!ranked.length || ranked[0][1] < 0.05) return null;
    } else {
      const only = [...target, ...rivals].flatMap((l) => TO3[l] || []);
      if (only.length < 2) return null;
      ranked = francFull(text, { minLength: 3, only }).map(([c, sc]) => [ISO3[c], sc]).filter(([l]) => l);
      if (!ranked.length) return null;
    }
    const [top, sc] = ranked[0];
    const second = ranked.find(([l]) => !kin(l, top));
    if (second && second[1] > sc * (model === 'tinyld' ? 0.6 : 0.7)) return null; // too close to call
    const isTarget = target.some((t) => kin(t, top));
    if (isTarget) return { vote: 'target', lang: top, strong: false, duel: true };
    const l = rivals.find((r) => kin(r, top)) || top;
    return place(l, text, eq, false).vote === 'other' ? { vote: 'other', lang: l, strong: false, duel: true } : null;
  }

  const majority = (langs, fallback) => {
    const c = {};
    for (const l of langs) if (l) c[l] = (c[l] || 0) + 1;
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return best && (best[1] > 1 || !fallback) ? best[0] : fallback;
  };

  /** Returns the verdict, possibly overturned / cleared / confirmed / promoted, annotated with `votes`. */
  async function verify(text, lang, v, related = true, opts = {}) {
    if (v.v !== 'bad' && v.v !== 'unsure') return v;
    const eq = { target: groupOf(lang), related: related ? relatedOf(lang) : [] };
    const isSolid = solid(text);
    let tiny = tinyVote(v, eq, isSolid, text);
    let c = await cld3Vote(text, eq, isSolid), f = francVote(text, eq, isSolid);
    // English page whose word is not in the English dictionary: a head-to-head "English" is a model's weak guess against the dictionary, so it doesn't count
    const enLike = lang === 'en' && englishLike(text); // every word is English, counting plurals, endings and compounds the dictionary lacks
    const dictMiss = lang === 'en' && !enLike;
    const sources = (opts.sources || []).map(norm);
    // Re-ask a model that abstained, or that named a third language unrelated to both the target and the page (Welsh, Mongolian... for one Danish
    // word). A re-asked "other" vote may only become the page's language; it is never turned into a vote for the target, so this can't hide an issue.
    // A guess another model backs ("Eliminar todo": Spanish from all three) is real evidence and is kept as it is.
    const first = [tiny, c, f];
    const backed = (x) => first.some((y) => y !== x && y.vote === 'other' && kin(x.lang, y.lang));
    // A head-to-head answer is weak, so it only ever backs up the dictionary: "other" counts only where the dictionary says the text isn't English,
    // "target" only where it doesn't contradict that. ("Coachable moments" is English although a head-to-head against French says French.)
    const usable = (d) => d && (d.vote === 'other' ? dictMiss : !dictMiss);
    const reask = (x, model) => {
      if (!sources.length) return x;
      if (x.vote === 'abstain') {
        const d = duel(model, text, eq, sources);
        return usable(d) ? d : x;
      }
      if (x.vote === 'other' && dictMiss && !x.strong && !backed(x) && !sources.some((l) => kin(l, x.lang))) {
        const d = duel(model, text, eq, sources);
        return d && d.vote === 'other' ? d : x;
      }
      return x;
    };
    tiny = reask(tiny, 'tinyld'); f = reask(f, 'franc');
    const all = [tiny, c, f];
    const votes = { tinyld: tiny.vote, cld3: c.vote, franc: f.vote };
    const duels = ['tinyld', 'cld3', 'franc'].filter((k, i) => all[i].duel);
    if (duels.length) votes.duel = duels;
    const forTarget = all.filter((x) => x.vote === 'target'), against = all.filter((x) => x.vote === 'other');
    // a confident vote the other way stops "two models agree" from deciding
    const blocked = (side) => all.some((x) => x.strong && x.vote !== 'abstain' && x.vote !== side);
    const words = text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
    const en = englishHits(text, lang);
    const englishWording = lang !== 'en' && en.strong >= 1 && en.own === 0; // clearly English words and none of the target language's own

    // Agreement counts neighbours as the same answer: CLD3 says Norwegian where tinyld says Danish for the same Danish word.
    // The label is the page's own language when the agreeing models point at it, otherwise the most named one.
    // Whole families (da/no/sv, es/pt) count together only around the page's own other language; elsewhere only true equivalents do (da = no),
    // or Portuguese from one model and Spanish from another would "agree" on a Danish page.
    const same = (a, b) => a === b || groupOf(a).includes(b) || (kin(a, b) && sources.some((l) => kin(l, a) && kin(l, b)));
    let agree = null;
    for (const x of against) {
      const n = against.filter((y) => same(x.lang, y.lang)).length;
      if (n >= 2 && (!agree || n > agree.n)) agree = { lang: x.lang, n };
    }
    // Two head-to-head answers alone are not an agreement: on a made-up word ("Katalyst") both lean to the page's language. At least one model must
    // name it unprompted, or the text must have letters English doesn't use.
    // A single plain word (brands and coined names look like this) needs that unprompted vote to be a confident one.
    if (agree && !hasAccent(text)) {
      const own = against.filter((y) => same(agree.lang, y.lang) && !y.duel);
      if (!own.length || (wordsOf(text) === 1 && against.some((y) => y.duel) && !own.some((y) => y.sure))) agree = null;
    }
    if (agree) {
      const cluster = against.filter((y) => same(agree.lang, y.lang)).map((y) => y.lang);
      agree.lang = sources.find((l) => cluster.some((y) => kin(l, y))) || majority(cluster, cluster[0]);
    }
    // English check, a word that is not English (not even as a plural, ending or compound), and one model confidently names the page's own language:
    // the dictionary is the second, independent piece of evidence. Head-to-head and low-confidence guesses never qualify.
    if (!agree && dictMiss && !forTarget.length) {
      const sure = against.find((x) => x.sure && !x.duel && sources.some((l) => kin(l, x.lang)));
      if (sure && (hasAccent(text) || letters(text) >= 4)) agree = { lang: sources.find((l) => kin(l, sure.lang)), n: 2, dictionary: true };
    }
    const lead = agree && agree.lang;
    const hard = v.v === 'bad' && HARD.test(v.reason || '');

    if (forTarget.length >= 2 && !englishWording && !blocked('target') && !hard) {
      return { v: 'ok', reason: 'Two language models read this as the target language', votes, confirmed: true, via: 'verify' };
    }
    // English check, every word is English (counting "integrations", "roleplay", "KPIs") and no two models name one other language: English.
    if (enLike && !agree && !blocked('target') && !hard) {
      return { v: 'ok', reason: 'English words, and the language models don’t agree on any other language', votes, via: 'verify' };
    }
    // Shaped like a name and the models cannot agree on any one language: that is what names look like to a detector (every model guesses something else)
    // (an English vote on a capitalised phrase of two words or more leans "English label", not "name")
    const leansEnglish = against.some((x) => x.lang === 'en') && wordsOf(text) >= 2;
    if (opts.shape && wordsOf(text) >= 2 && !agree && !forTarget.length && !hard && !leansEnglish) return { v: 'name', reason: 'Looks like a name', votes, via: 'verify' };
    // Not an English word on an English check, and two models place it in the page's own language (or it has letters English doesn't use: æ ø å ä ö ü ...).
    // That is hard evidence even for one short word ("Hjem", "Træning"): the dictionary says it isn't English, the models say what it is.
    const notEnglish = dictMiss && !!agree && agree.n > forTarget.length && !forTarget.some((x) => x.strong) && letters(text) >= 3 && (hasAccent(text) || sources.some((l) => kin(l, agree.lang)));
    if (v.v === 'bad') {
      if (forTarget.length >= 2) return { v: 'unsure', reason: 'The language models disagree', votes, via: 'verify' }; // rules or a confident model still say otherwise
      // Hard evidence (clear English wording, a wrong script) settles the label; the models only have to agree that it isn't the target.
      // So a hard warning counts as confirmed when no model reads the target and two read another language, even if they name different ones
      // (two short English words: tinyld "English", CLD3 "French", franc "Spanish"), or when it is English wording in the wrong script.
      const nonLatinPage = !(TARGET_SCRIPTS[lang] || ['latin']).includes('latin');
      const latinOnly = (text.match(/\p{L}/gu) || []).every((c) => /\p{Script=Latin}/u.test(c));
      const wrongScript = hard && v.detected === 'en' && nonLatinPage && latinOnly;
      const hardBacked = hard && !forTarget.length && (against.length >= 2 || wrongScript);
      // English wording keeps its English label ("Review Pending" is not Indonesian because two models guessed so), unless every word is
      // also a word of the language the models agree on, by that language's word list ("Service client" stays French).
      const englishWording = hard && v.detected === 'en' && v.reason === 'Looks like English text' && allEnglish(text) && !(agree && sharedEntirely(text, agree.lang));
      const guess = englishWording ? 'en' : agree ? agree.lang : hard && v.detected === 'en' ? 'en' : majority(against.map((x) => x.lang), v.detected);
      return { ...v, detected: relabel(words, guess), votes, confirmed: !!agree || hardBacked, ...(agree ? { agree } : {}), ...(notEnglish ? { notEnglish } : {}) }; // function-word evidence settles the label
    }
    // "can't tell": two models that independently agree on the same other language make it a warning
    if (agree && (letters(text) >= 10 || notEnglish) && !blocked('other')) {
      return { v: 'bad', detected: relabel(words, lead), reason: notEnglish ? 'Not an English word; two language models read it as another language' : 'Two language models read this as another language', votes, confirmed: true, agree, via: 'verify', ...(notEnglish ? { notEnglish } : {}) };
    }
    return { ...v, votes };
  }

  return { verify, status: () => ({ ...status }) };
}
