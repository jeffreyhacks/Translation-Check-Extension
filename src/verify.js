// Multi-layer verification. Three detectors vote independently: tinyld (with the rules around it), Google's CLD3 (WebAssembly) and franc (trigram profiles).
// Each votes for the target language, for another language, or abstains. A model only abstains when it has no real guess; a guess that is right but
// not very confident still counts, so the decision is not thrown away. Then the simple rule applies: when two models agree, that decides:
//   - two read the text as the target language  -> it is translated (a warning is withdrawn, a "can't tell" is cleared);
//   - two read it as the same other language    -> it is untranslated (a "can't tell" becomes a warning, a warning is confirmed).
// A confident dissent from the third model, or clearly English wording, stops either conclusion. Short strings are cognate-prone, so there a
// model's confidence is never treated as strong. Text shaped like a name (see names.js) that the models cannot agree on is a name, not a leftover.
import { loadModule } from 'cld3-asm/dist/cjs/index.js'; // CommonJS entry: the ESM entry breaks when bundled for browsers
import { francAll } from 'franc-min';
import { norm, groupOf, relatedOf, relabel, englishHits, plausible } from './engine.js';
import { impossible } from './alphabet.js';
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

let idP = null;
const cld3Id = () => (idP ||= loadModule({ timeout: 20000 }).then((f) => f.create(0, 1000)).catch(() => null));

/** @param cldFallback async (text) => {isReliable, languages:[{language, percentage}]} — Chrome's own detector, used if CLD3 can't load */
export function createVerifier(cldFallback = async () => null) {
  const status = { cld3: 'pending', franc: 'ready' };

  // Turns "the model named language l" into a vote. Relatives of the target count for the target (they are accepted on the page anyway);
  // languages nobody writes pages in, and languages whose letters the text doesn't have, are not a real guess.
  function place(l, text, eq, strong) {
    if (eq.target.includes(l)) return { vote: 'target', lang: l, strong };
    if (eq.related.includes(l)) return { vote: 'target', lang: l, strong: false };
    if (!plausible(l) || (l !== 'en' && impossible(text, l))) return { ...ABSTAIN, lang: l };
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
    return place(norm(lang), text, eq, isSolid && (reliable || conf >= 0.8));
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
    return behind >= (short ? 0.3 : 0.1) ? place(top, text, eq, isSolid && behind >= 0.3) : { ...ABSTAIN, lang: top };
  }

  // tinyld's own opinion. For a warning that is the engine's verdict (tinyld + the rules around it); for a "can't tell" it is tinyld's head-to-head
  // scores between the target and the best other candidate, which the engine could not call but which still lean one way.
  function tinyVote(v, eq, isSolid, text) {
    if (v.v === 'bad') return v.detected === 'en' && !isSolid && hasAccent(text) ? { ...ABSTAIN, lang: 'en' } : { vote: 'other', lang: v.detected, strong: isSolid };
    const { sT = 0, sO = 0, other } = v;
    if (sT >= 0.15 && sT >= sO) return { vote: 'target', strong: false };
    if (sO >= 0.2 && sO > sT && other) return place(norm(other), '', eq, false);
    return ABSTAIN;
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
    const tiny = tinyVote(v, eq, isSolid, text);
    const c = await cld3Vote(text, eq, isSolid), f = francVote(text, eq, isSolid);
    const all = [tiny, c, f];
    const votes = { tinyld: tiny.vote, cld3: c.vote, franc: f.vote };
    const forTarget = all.filter((x) => x.vote === 'target'), against = all.filter((x) => x.vote === 'other');
    // a confident vote the other way stops "two models agree" from deciding
    const blocked = (side) => all.some((x) => x.strong && x.vote !== 'abstain' && x.vote !== side);
    const words = text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [];
    const en = englishHits(text, lang);
    const englishWording = lang !== 'en' && en.strong >= 1 && en.own === 0; // clearly English words and none of the target language's own

    const tally = {};
    for (const x of against) tally[x.lang] = (tally[x.lang] || 0) + 1;
    const [lead, n = 0] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [];
    const agree = n >= 2 ? { lang: lead, n } : null; // two models independently name the same other language
    const hard = v.v === 'bad' && HARD.test(v.reason || '');

    if (forTarget.length >= 2 && !englishWording && !blocked('target') && !hard) {
      return { v: 'ok', reason: 'Two language models read this as the target language', votes, confirmed: true, via: 'verify' };
    }
    // Shaped like a name and the models cannot agree on any one language: that is what names look like to a detector (every model guesses something else)
    // (an English vote on a capitalised phrase of two words or more leans "English label", not "name")
    const leansEnglish = against.some((x) => x.lang === 'en') && wordsOf(text) >= 2;
    if (opts.shape && wordsOf(text) >= 2 && !agree && !forTarget.length && !hard && !leansEnglish) return { v: 'name', reason: 'Looks like a name', votes, via: 'verify' };
    if (v.v === 'bad') {
      if (forTarget.length >= 2) return { v: 'unsure', reason: 'The language models disagree', votes, via: 'verify' }; // rules or a confident model still say otherwise
      const guess = majority(against.map((x) => x.lang), v.detected);
      return { ...v, detected: relabel(words, guess), votes, confirmed: !!agree, ...(agree ? { agree } : {}) }; // function-word evidence settles the label
    }
    // "can't tell": two models that independently agree on the same other language make it a warning
    if (agree && letters(text) >= 10 && !blocked('other')) {
      return { v: 'bad', detected: relabel(words, lead), reason: 'Two language models read this as another language', votes, confirmed: true, agree, via: 'verify' };
    }
    return { ...v, votes };
  }

  return { verify, status: () => ({ ...status }) };
}
