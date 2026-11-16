// Multi-layer verification. The primary model (tinyld + rules) proposes a verdict; two independent
// detectors — Google's CLD3 (WebAssembly) and franc (trigram profiles) — then cast their own votes.
// A warning is only trusted when the models don't contradict it; two models that agree on a different
// language can also promote a "can't tell" to a warning.
import { loadModule } from 'cld3-asm/dist/cjs/index.js'; // CommonJS entry: the ESM entry breaks when bundled for browsers
import { francAll } from 'franc-min';
import { norm, groupOf, relatedOf } from './engine.js';

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

  async function cld3Vote(text, eq) {
    const id = await cld3Id();
    let lang, ok;
    if (id) {
      status.cld3 = 'wasm';
      const r = id.findLanguage(text.slice(0, 1000));
      lang = r && r.language; ok = r && lang !== 'und' && (r.is_reliable || r.probability >= 0.8);
    } else {
      const d = await cldFallback(text.slice(0, 1000));
      status.cld3 = d ? 'chrome' : 'off';
      const top = d && d.languages && d.languages[0];
      lang = top && top.language; ok = d && d.isReliable && top && lang !== 'und';
    }
    if (!ok || !lang) return { vote: 'abstain' };
    const l = norm(lang);
    if (eq.target.includes(l)) return { vote: 'target', lang: l };
    if (eq.related.includes(l)) return { vote: 'abstain', lang: l }; // close relatives never count against the page
    return { vote: 'other', lang: l };
  }

  function francVote(text, eq) {
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < 6) return { vote: 'abstain' };
    const all = francAll(text, { minLength: 6 });
    if (!all.length || all[0][0] === 'und') return { vote: 'abstain' };
    const short = letters < 14; // franc is weak on very short strings: demand a much bigger lead
    const langOf = (code) => ISO3[code];
    const top = langOf(all[0][0]);
    if (!top) return { vote: 'abstain' };
    const best = (pred) => all.reduce((m, [c, sc]) => (pred(langOf(c)) ? Math.max(m, sc) : m), 0);
    const near = [...eq.target, ...eq.related];
    if (eq.target.includes(top)) { // lead over the best non-target language
      return 1 - best((l) => l && !near.includes(l)) >= (short ? 0.25 : 0.08) ? { vote: 'target', lang: top } : { vote: 'abstain' };
    }
    if (eq.related.includes(top)) return { vote: 'abstain', lang: top };
    // another language is on top: how far is the target (or its relatives) behind?
    return 1 - best((l) => near.includes(l)) >= (short ? 0.4 : 0.15) ? { vote: 'other', lang: top } : { vote: 'abstain' };
  }

  const majority = (langs, fallback) => {
    const c = {};
    for (const l of langs) if (l) c[l] = (c[l] || 0) + 1;
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return best && (best[1] > 1 || !fallback) ? best[0] : fallback;
  };

  /** Returns the verdict, possibly overturned/confirmed/promoted, annotated with `votes`. */
  async function verify(text, lang, v, related = true) {
    if (v.v !== 'bad' && v.v !== 'unsure') return v;
    const eq = { target: groupOf(lang), related: related ? relatedOf(lang) : [] };
    const [c, f] = [await cld3Vote(text, eq), francVote(text, eq)];
    const tiny = v.v === 'bad' ? { vote: 'other', lang: v.detected } : { vote: 'abstain' };
    const votes = { tinyld: tiny.vote, cld3: c.vote, franc: f.vote };
    const all = [tiny, c, f];
    const against = all.filter((x) => x.vote === 'other'), forTarget = all.filter((x) => x.vote === 'target');

    if (v.v === 'bad') {
      // Two independent models read it as the target language: the warning is probably wrong. (A single dissenting vote is not enough.)
      if (forTarget.length >= 2) {
        return { v: 'unsure', reason: 'The language models disagree', votes, via: 'verify' };
      }
      return { ...v, detected: majority(against.map((x) => x.lang), v.detected), votes, confirmed: against.length >= 2 };
    }
    // "can't tell": two models that independently agree on the same other language make it a warning
    if (c.vote === 'other' && f.vote === 'other' && c.lang === f.lang) {
      return { v: 'bad', detected: c.lang, reason: 'CLD3 and franc both read this as another language', votes, confirmed: true, via: 'verify' };
    }
    return { ...v, votes };
  }

  return { verify, status: () => ({ ...status }) };
}
