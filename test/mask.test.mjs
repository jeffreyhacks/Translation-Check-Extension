import { mask, compileTerms } from '../src/mask.js';
import { createEngine } from '../src/engine.js';
const e = createEngine();
const re = compileTerms(['Acme Cloud', 'Luna']);
const cases = [
  // [text, lang, expected residue ('' = ignored)]
  ['154m 32s','es',''],['1h 2m 3s','ja',''],['2:30','de',''],['10:30 PM','fr',''],['gpt-6-luna','es',''],['GPT-6','ja',''],
  ['v2.1.0','es',''],['5 GB','pt',''],['€49.99','fr',''],['2026-11-12','es',''],['50%','es',''],['user_name','es',''],['example.com','es',''],
  ['https://x.ai/docs','es',''],['hello@x.ai','es',''],['iPhone','es',''],['API','es',''],['4K','es',''],['#launch','es',''],['@claude','es',''],
  ['Tiempo de reproducción 154m 32s','es','Tiempo de reproducción'],
  ['Usa gpt-6-luna para chatear','es','Usa para chatear'],
  ['Descarga Acme Cloud ahora','es','Descarga ahora'],
  ['Prueba YouTube y Spotify hoy','es','Prueba y hoy'],
  ['Modelo: Claude Opus 5.5','es','Modelo Claude Opus'],
];
let ok = 0;
for (const [t, l, exp] of cases) { const r = mask(t, l, re).text; const pass = r === exp; if (pass) ok++; else console.log('FAIL', JSON.stringify(t), '->', JSON.stringify(r), 'expected', JSON.stringify(exp)); }
console.log(`mask: ${ok}/${cases.length}`);
// things that MUST still be judged (and flagged)
for (const [t, l] of [['Add To Cart','es'],['Watch time 154m 32s','es'],['Try gpt-6-luna for free today','es'],['Shopping Cart','de'],['Free delivery 2h','ja']]) {
  const m = mask(t, l, re); const v = m.text ? await e.classify(m.text, l, { sources: ['en'], related: true }) : { v: 'ignored' };
  console.log(`${v.v.padEnd(8)} "${t}" -> "${m.text}" nameLike=${m.nameLike}`);
}
// related languages
for (const [t, l, exp] of [['Contato','es','ok'],['Início','es','ok'],['Kontakt oss','da','ok'],['Domov','cs','ok'],['Pridať do košíka','cs','ok'],
  ['Adicionar ao carrinho','es','ok'],['A entrega é gratuita para todas as encomendas superiores a cinquenta euros em todo o país.','es','ok']]) {
  const v = await e.classify(t, l, { sources: ['en'], related: true }); console.log(v.v===exp?'PASS':'FAIL', l, `"${t.slice(0,40)}" ->`, v.v, v.detected||'');
}
