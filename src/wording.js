// Wording hints: things a language check can't see, because the text IS in the target language. Two kinds, both deterministic and local:
//   - consistency: the same label written two ways on one page ("Manuel de l'utilisateur" on the button, "Manuel utilisateur" in its tooltip);
//   - known word-for-word translations (calques) of English business terms that read oddly or mean something else ("points de douleur" for
//     "pain points", "rapport" for "rapport building": in French "rapport" means "report").
// They are hints (listed under Format, never in the score). They are not a translation-quality review: judging whether a translation is
// right needs the source text and a translation model, which this extension doesn't have (nothing leaves the browser).
// Pure functions, no DOM.

// Little words that join the words of a label and that translators add or drop freely ("de l'", "of the").
const LINK = {
  fr: 'de du des d l la le les un une et à au aux en pour par sur',
  en: 'of the a an and to for in on by with',
  de: 'der die das des dem den von und für zum zur im am ein eine einer eines',
  es: 'de del la el los las y para al en un una por con',
  it: 'di del della dei degli delle il lo la le gli l e per al alla un una in con',
  pt: 'de do da dos das o a os as e para ao em um uma por com',
  nl: 'de het een van en voor in op met',
};
const linkSet = new Map();
const linksOf = (lang) => { if (!linkSet.has(lang)) linkSet.set(lang, new Set((LINK[lang] || LINK.en).split(' '))); return linkSet.get(lang); };
const base = (l) => String(l || '').toLowerCase().split(/[-_]/)[0];
const tokens = (t) => [...t.matchAll(/\p{L}[\p{L}\p{M}]*/gu)].map((m) => ({ w: m[0].toLowerCase(), at: m.index, end: m.index + m[0].length }));
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Labels written two ways on the same page. A label (two to five words, up to 40 characters) is compared with every other text: where the same
 * meaningful words appear in the same order with different little words between them, the label is written two ways.
 * Capitals alone are not counted ("Gestion des objections" and "gestion des objections").
 * @param {string[]} texts every text on the page (labels, tooltips, sentences)
 * @returns {Map<string, string>} label -> the other way it is written
 */
export function variants(texts, lang) {
  const L = base(lang), link = linksOf(L);
  const uniq = [...new Set(texts.map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 3000);
  const toks = uniq.map(tokens);
  // where each meaningful word occurs: word -> [text index, token index]
  const index = new Map();
  toks.forEach((ts, i) => ts.forEach((x, k) => { if (!link.has(x.w)) { if (!index.has(x.w)) index.set(x.w, []); index.get(x.w).push([i, k]); } }));
  const out = new Map();
  uniq.forEach((label, i) => {
    const ts = toks[i];
    if (label.length > 40 || ts.length < 2 || ts.length > 5) return;
    const key = ts.filter((x) => !link.has(x.w)).map((x) => x.w);
    if (key.length < 2) return;
    const own = norm(label.slice(ts[0].at, ts[ts.length - 1].end));
    for (const [j, k] of index.get(key[0]) || []) {
      if (j === i) continue;
      const other = toks[j];
      let q = k, n = 0, last = k;
      while (q < other.length && n < key.length) {
        if (other[q].w === key[n]) { n++; last = q; q++; } else if (link.has(other[q].w) && q - last <= 3) q++; else break;
      }
      if (n < key.length) continue;
      const theirs = uniq[j].slice(other[k].at, other[last].end);
      if (norm(theirs) !== own) { out.set(label, theirs); break; }
    }
  });
  // a label without little words ("Manuel utilisateur") is matched from the other side: it is the "other way" of a label that has them
  for (const [a, b] of [...out]) if (!out.has(b) && uniq.includes(b)) out.set(b, a);
  return out;
}

// Known calques: [pattern, the English it copies, what is usually said instead]. Kept short and certain; a word that can be right is not listed.
// Patterns are whole words in any script (\b would not see a word boundary before "é").
const W = (src, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{M}])(?:${src})(?![\\p{L}\\p{M}])`, flags);
const CALQUES = {
  fr: [
    [W('points? de douleur'), 'pain points', '« points sensibles », « difficultés » ou « problèmes »'],
    [W('(?:établissement|établir|construction|construire|création|créer)\\s+(?:de|du|un|le)\\s+rapports?'), 'rapport building', '« créer un lien », « établir une relation de confiance » (« rapport » veut dire « report » en français)'],
    [W('communication exécutive'), 'executive communication', '« communication avec la direction » ou « communication de dirigeant »'],
    [W('(?:définition|définir|fixation|fixer)\\s+(?:de\\s+)?l[\'’]agenda'), 'agenda setting', '« ordre du jour » (un « agenda » est un carnet de rendez-vous)'],
    [W('adresser\\s+(?:un|le|les|des|ce|ces|vos|nos)\\s+(?:problèmes?|questions?|besoins?|enjeux|préoccupations?)'), 'address an issue', '« traiter », « résoudre » ou « répondre à »'],
    [W('faire du sens'), 'make sense', '« avoir du sens »'],
  ],
  de: [
    [W('Schmerzpunkte?n?', 'u'), 'pain points', '„Problembereiche“, „Herausforderungen“ oder „Schwachstellen“'],
  ],
  es: [
    [W('puntos de dolor'), 'pain points', '«puntos débiles», «problemas» o «dificultades»'],
    [W('aplicar (?:a|para) (?:un|el|este|ese) (?:trabajo|puesto|empleo)'), 'apply for a job', '«solicitar» o «postularse a»'],
  ],
};

/** Word-for-word translations of English terms found in a text, as hints ("Possible word-for-word translation of “pain points” …"). */
export function calques(text, lang) {
  const out = [];
  for (const [re, en, better] of CALQUES[base(lang)] || []) {
    const m = String(text || '').match(re);
    if (m) out.push(`Wording: “${m[0]}” looks like a word-for-word translation of “${en}”; usually ${better}`);
  }
  return out;
}
