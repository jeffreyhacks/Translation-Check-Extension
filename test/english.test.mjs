// English leftovers that statistical models can't place (cognate-heavy short strings), and dates with month names.
import { loadBg } from './harness.mjs';
import { mask } from '../src/mask.js';
import { formatHints } from '../src/rules.js';
import { looksEnglish } from '../src/english.js';
import { HARD } from './hardneg.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const bg = loadBg();
const judge = async (lang, list) => {
  const texts = list.map((t) => mask(t, lang).text);
  const r = await bg({ type: 'tc-classify', lang, texts, ctxTexts: [] });
  return r.verdicts;
};

// Persona tone badges on a French page (React renders "Ton {tone}" as two text nodes, so both shapes occur)
const fr = { bad: ['Enthusiastic, decisive', 'Ton Enthusiastic, decisive', 'Aggressive, Impatient, Defensive, Professional', 'Ton Aggressive, Impatient, Defensive, Professional', 'Enthusiastic'],
  ok: ['Ton Calme', 'Ton Confus', 'Calme', 'Afficher le contexte complet', 'Communication : directe et décontractée', 'Complexité : avancée', 'Motif : Sécurité'] };
const vf = await judge('fr', [...fr.bad, ...fr.ok]);
fr.bad.forEach((t, i) => check(`fr flags "${t}"`, vf[i].v === 'bad' && vf[i].detected === 'en', JSON.stringify(vf[i])));
fr.ok.forEach((t, i) => { const v = vf[fr.bad.length + i]; check(`fr keeps "${t}"`, v.v !== 'bad', JSON.stringify(v)); });
const [imp] = await judge('fr', ['Ton Impatient']);
check('fr "Ton Impatient" is not English (impatient is a French word)', imp.v !== 'bad', JSON.stringify(imp));

// A German page: the English aria-label is flagged, German labels are not
const de = await judge('de', ['Notifications', 'Organisationsdokumente', 'Personas verwalten', 'Tour starten', 'Helles Thema', 'KI-Konfiguration', 'Impressum']);
check('de flags "Notifications"', de[0].v === 'bad' && de[0].detected === 'en', JSON.stringify(de[0]));
de.slice(1).forEach((v, i) => check(`de does not flag German label #${i + 1}`, v.v !== 'bad', JSON.stringify(v)));

// No hard negative may be called English by the dictionary rule
let fp = [];
for (const [l, s] of Object.entries(HARD)) for (const t of s.split('|')) if (looksEnglish(t, l)) fp.push(`${l}:${t}`);
check('dictionary rule: no hard negative is called English', !fp.length, fp.join(', '));

// Dates with month names are formatted values, not text
for (const [t, l] of [['10. Nov. 2026', 'de'], ['6. Nov. 2026', 'de'], ['Dienstag, 10. November 2026', 'de'], ['10 nov. 2026', 'fr'], ['Nov 10, 2026', 'fr'],
  ['10 de noviembre de 2026', 'es'], ['10 listopada 2026', 'pl'], ['10 нояб. 2026 г.', 'ru'], ['10 Kasım 2026', 'tr'], ['November 2026', 'nl']]) {
  check(`date ignored: ${l} "${t}"`, !/\p{L}{2}/u.test(mask(t, l).text), JSON.stringify(mask(t, l).text));
}
check('date inside a sentence leaves the words', mask('Erstellt am 10. Nov. 2026', 'de').text === 'Erstellt am');
check('month word without a number is kept', mask('Ventes de mars', 'fr').text === 'Ventes de mars');
check('English month on a German page is a format hint', formatHints('Fällig am Dec 3, 2026', 'de').some((h) => /English month/.test(h)));
check('shared month abbreviation is not a hint', !formatHints('10. Nov. 2026', 'de').length);

console.log(`\nenglish+dates: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
