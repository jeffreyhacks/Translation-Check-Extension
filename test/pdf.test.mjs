import { createRequire } from 'module';
import fs from 'fs';
import { analyzePdf, pageBlocks } from '../src/pdfcheck.js';
import { loadBg } from './harness.mjs';
const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const send = loadBg();
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const run = (file, params, onProgress) => analyzePdf({ pdfjs, data: new Uint8Array(fs.readFileSync('test/fixtures/' + file)), params, send, onProgress });

// paragraph building
const it = (str, y, h = 11, eol = false) => ({ str, transform: [h, 0, 0, h, 60, y], height: h, hasEOL: eol });
{
  const b = pageBlocks([it('Verwalten Sie Szenarien und Sys-', 700, 11, true), it('temkonfiguration für Ihr Team.', 686, 11, true), it('Neuer Absatz beginnt hier.', 640, 11, true)]);
  t('blocks: hyphenated word is re-joined across lines', b[0] === 'Verwalten Sie Szenarien und Systemkonfiguration für Ihr Team.', JSON.stringify(b));
  t('blocks: a large vertical gap starts a new paragraph', b.length === 2 && b[1] === 'Neuer Absatz beginnt hier.', JSON.stringify(b));
  const h = pageBlocks([it('Handbuch', 780, 20, true), it('Dies ist ein Absatz.', 740, 11, true)]);
  t('blocks: a heading is its own block', h.length === 2, JSON.stringify(h));
  t('blocks: words on one baseline stay on one line', pageBlocks([it('Hello ', 700), it('world', 700.5)])[0] === 'Hello world');
}
// German manual with one English paragraph
const steps = [];
const r = await run('de-mixed.pdf', { lang: 'auto' }, (e) => steps.push(e.stage));
t('pdf: language auto-detected as German', r.lang === 'de' && r.requested === 'auto', JSON.stringify([r.lang, r.requested, r.error]));
t('pdf: reports 2 pages', r.source.pages === 2);
const bad = r.issues.filter((i) => i.verdict === 'bad');
t('pdf: the English paragraph is flagged, on page 1', bad.length === 1 && /configure the scoring rubric/.test(bad[0].text) && bad[0].page === 1, JSON.stringify(bad.map((b) => [b.page, b.text.slice(0, 40)])));
t('pdf: German paragraphs are not flagged', !r.issues.some((i) => /Verwalten Sie|Beschwerden|Preiswiderstand|Sitzungsverlauf/.test(i.text) && i.verdict === 'bad'));
t('pdf: the flagged paragraph was checked by the models', bad[0].votes && bad[0].detected === 'en', JSON.stringify(bad[0]));

t('pdf: version/duration values are not judged', !r.issues.some((i) => /154m|v2\.1\.0/.test(i.text) && i.verdict === 'bad'));
t('pdf: progress is reported', steps.includes('read') && steps.includes('judge'));
t('pdf: score is sensible', r.score > 60 && r.score < 100, 'score ' + r.score);
// the same document against the wrong target (the "banner" case)
const wrong = await run('de-mixed.pdf', { lang: 'en' });
t('pdf: German text flagged when English is the target', wrong.stats.badN >= 5 && wrong.issues.filter((i) => i.verdict === 'bad').every((i) => i.detected === 'de' || i.detected === 'en'), JSON.stringify(wrong.stats));
const foot = wrong.issues.filter((i) => /Vertraulich/.test(i.text));
t('pdf: a repeated footer is listed once and remembers both pages', foot.length === 1 && foot[0].pages.join() === '1,2', JSON.stringify(foot.map((f) => [f.text, f.pages])));
// clean document
const clean = await run('es-clean.pdf', { lang: 'es' });
t('pdf: fully Spanish document has no warnings', clean.stats.badN === 0 && clean.score === 100, JSON.stringify(clean.stats));
// leaked keys / placeholders
const keys = await run('keys.pdf', { lang: 'es' });
t('pdf: leaked translation keys and placeholders are found', keys.issues.filter((i) => i.verdict === 'bug').length === 2, JSON.stringify(keys.issues.map((i) => [i.verdict, i.text])));
// no text layer
const scan = await run('scan-only.pdf', { lang: 'es' });
t('pdf: image-only PDF gives a clear message', /No selectable text/.test(scan.error || ''), JSON.stringify(scan));
// confirmed only + ignore list
const ign = await run('de-mixed.pdf', { lang: 'de', ignore: ['This section explains how to configure the scoring rubric and how to invite new participants to a training session', 'Please read it carefully before you start'] });
t('pdf: ignore list applies', !ign.issues.some((i) => i.verdict === 'bad' && /scoring rubric/.test(i.text)));
console.log(`\npdf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
