import { loadBg } from './harness.mjs';
import { mask } from '../src/mask.js';
import { HARD, ENGLISH } from './hardneg.mjs';
const send = loadBg();
const verbose = process.argv.includes('-v');
let falsePos = 0, total = 0, lost = 0, eTotal = 0;
const fp = [];
for (const [lang, str] of Object.entries(HARD)) {
  const list = str.split('|');
  for (const sources of [['en'], ['en', 'tr', 'de']]) {
    const texts = list.map((s) => mask(s, lang, null).text).filter((x) => /\p{L}{2}/u.test(x));
    const r = await send({ type: 'tc-classify', lang, verify: true, related: true, texts, ctxTexts: [], ctx: { sources } });
    r.verdicts.forEach((v, i) => { total++; if (v.v === 'bad') { falsePos++; fp.push(`${lang} src=${sources} "${texts[i]}" → ${v.detected} ${JSON.stringify(v.votes || {})} ${v.reason || ''}`); } });
  }
}
for (const lang of Object.keys(HARD)) {
  const texts = ENGLISH.map((s) => mask(s, lang, null).text).filter((x) => /\p{L}{2}/u.test(x));
  const r = await send({ type: 'tc-classify', lang, verify: true, related: true, texts, ctxTexts: [], ctx: { sources: ['en'] } });
  r.verdicts.forEach((v, i) => { eTotal++; if (v.v !== 'bad') { lost++; if (verbose) console.log('  missed English:', lang, texts[i], v.v); } });
}
console.log(`hard negatives: ${falsePos} false warnings out of ${total}`);
for (const f of fp) console.log('  FALSE+', f);
console.log(`English leftovers: ${eTotal - lost}/${eTotal} flagged`);
process.exit(falsePos ? 1 : 0);
