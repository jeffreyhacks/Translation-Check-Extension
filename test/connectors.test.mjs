// Reported: German "Connectors" tab of a project (knowledge-harvestor). English status badges and an English date were missed, clear English tab
// labels were only "Name or title?", "REST API" was "can't tell", and the export had blanks, one-line context and cut-off selectors.
import { loadNew, page, sleep } from './harness.mjs';
import fs from 'fs';
import { formatHints, dateStyle } from '../src/rules.js';
import { isStatusValue } from '../src/status.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });
const URL = 'https://knowledge-harvestor.artisanscloud.com/admin/projectsessions/3808aa8a/connectors';
const HTML = fs.readFileSync('test/e2e/site/de-connectors.html', 'utf8');

{
  const h = loadNew(HTML, { url: URL });
  const r = await scan(h);
  const by = (x, v) => r.issues.find((i) => i.text === x && (!v || i.verdict === v));
  const list = JSON.stringify(r.issues.map((i) => [i.verdict, i.text, i.reason]));
  // status values
  t('connectors: "Valid" in the Status badge is untranslated', by('Valid')?.verdict === 'bad' && by('Valid').reason === 'English status value' && by('Valid').detected === 'en', list);
  t('connectors: "Completed" in the sync-status badge is untranslated', by('Completed')?.verdict === 'bad', list);
  t('connectors: status values are confirmed (all three models read English)', by('Valid')?.confirmed && by('Completed')?.confirmed);
  // Title Case labels on tabs
  t('connectors: "Knowledge Intelligence" tab is untranslated without a manual mark', by('Knowledge Intelligence')?.verdict === 'bad' && by('Knowledge Intelligence').confirmed, list);
  t('connectors: "Document Repo" tab (with its "(7)" count) is untranslated, labelled English', by('Document Repo')?.verdict === 'bad' && by('Document Repo').detected === 'en', list);
  t('connectors: "Connectors" (tab and heading) is one item with two copies', by('Connectors')?.verdict === 'bad' && by('Connectors').count === 2);
  // technical terms
  t('connectors: "REST API" is an allowed technical term, not "can\'t tell"', !r.issues.some((i) => /REST API/.test(i.text)) && r.stats.ignoredN >= 1, list);
  // dates and times (checked without Format hints)
  const fmt = r.issues.filter((i) => i.verdict === 'fmt').map((i) => i.reason);
  t('connectors: "Nov 13, 2026" gets a date-order hint on a German page', fmt.some((x) => /English order/.test(x)), JSON.stringify(fmt));
  t('connectors: "08:38 PM" gets a 12-hour-clock hint', fmt.some((x) => /12-hour clock/.test(x)), JSON.stringify(fmt));
  t('connectors: "13/11/2026" in the table gets a separator hint', fmt.some((x) => /Date written with "\/"/.test(x)), JSON.stringify(fmt));
  t('connectors: format hints still don\'t change the score', r.stats.unsureN === 0 && r.issues.filter((i) => i.verdict === 'bad').length === 6, list);
  // context
  t('connectors: badges are reported as badges, with their column', /^badge · Table › column “Status”/.test(by('Valid').occ[0].where), by('Valid').occ[0].where);

  const ex = await h.call({ type: 'export' });
  const e = (x) => ex.issues.find((i) => i.text === x);
  const con = e('Connectors');
  t('export: both copies of "Connectors" have a location (tab and heading)', con.occurrences.length === 2 && /^tab/.test(con.occurrences[0].where) && /^heading/.test(con.occurrences[1].where), JSON.stringify(con.occurrences));
  t('export: every selector starts at #root, however deep the element is', ex.issues.every((i) => i.occurrences.every((o) => o.selector.startsWith('#root > '))), JSON.stringify(ex.issues.map((i) => i.occurrences.map((o) => o.selector))));
  t('export: a value alone in its cell has the rest of the row as surrounding text', /3rdpartyauditinspectionrec/.test(e('Valid').occurrences[0].before) && /Completed/.test(e('Valid').occurrences[0].after), JSON.stringify(e('Valid').occurrences[0]));
  t('export: the "Document Repo" row names a detected language', e('Document Repo').detected === 'en');
}

// marked text keeps the models' reading
{
  const h = loadNew(fs.readFileSync('test/e2e/site/de-sessions.html', 'utf8'));
  const r = await scan(h, { marked: ['Wisight Mapping'] });
  const ex = await h.call({ type: 'export' });
  const m = ex.issues.find((i) => i.marked);
  t('marked: the models\' reason is kept next to "Marked untranslated by you"', m && m.reason === 'Marked untranslated by you' && m.modelReason && m.modelReason !== m.reason, JSON.stringify(m && { reason: m.reason, model: m.modelReason, verdicts: r.issues.map((i) => i.text) }));
}

// status values: where they count and where they don't
{
  const mk = (lang, body) => loadNew(page(`<main><h1>${lang === 'fr' ? 'Liste des connecteurs' : 'Liste der Verbindungen'}</h1><p>${lang === 'fr' ? 'Voici les sources de données reliées à ce projet et leur état actuel.' : 'Hier sehen Sie die Datenquellen dieses Projekts und ihren aktuellen Zustand.'}</p>${body}</main>`, lang));
  const fr = await scan(mk('fr', '<table><tr><th>Nom</th><th>Statut</th></tr><tr><td>Salesforce</td><td><span class="badge">Active</span></td></tr></table>'), { lang: 'fr' });
  t('status: "Active" on a French page is French, not an English status', !fr.issues.some((i) => i.text === 'Active' && i.verdict === 'bad'), JSON.stringify(fr.issues.map((i) => [i.verdict, i.text])));
  const de = await scan(mk('de', '<table><tr><th>Name</th><th>Status</th></tr><tr><td>Lager</td><td><span class="badge">Online</span></td></tr><tr><td>Archiv</td><td><span class="badge">In progress</span></td></tr></table>'));
  t('status: "Online" is the German word too', !de.issues.some((i) => i.text === 'Online' && i.verdict === 'bad'), JSON.stringify(de.issues.map((i) => [i.verdict, i.text])));
  t('status: a two-word value ("In progress") is untranslated', de.issues.some((i) => i.text === 'In progress' && i.verdict === 'bad'), JSON.stringify(de.issues.map((i) => [i.verdict, i.text])));
  t('status: helper ignores English pages and unknown words', !isStatusValue('Valid', 'en') && !isStatusValue('Gültig', 'de') && isStatusValue('Completed', 'de') && !isStatusValue('Error', 'es'));
}

// text that arrives after the check (table rows loaded from the server) is picked up even with live updates off
{
  const h = loadNew(page(`<main><h1>Verbindungen</h1><p>Hier sehen Sie die Datenquellen dieses Projekts und ihren aktuellen Zustand.</p><table><tbody id="rows"></tbody></table></main>`, 'de'));
  const r = await scan(h);
  t('late: nothing to report before the rows arrive', !r.issues.some((i) => i.verdict === 'bad'));
  h.w.document.getElementById('rows').innerHTML = '<tr><td>Lager</td><td><span class="badge">Completed</span></td></tr>';
  await sleep(900);
  const s = await h.call({ type: 'status' });
  t('late: a badge added just after the check is listed', s.result.issues.some((i) => i.text === 'Completed' && i.verdict === 'bad'), JSON.stringify(s.result.issues.map((i) => i.text)));
  t('late: the result does not claim live updates are on', s.result.live === false);
}

// dates
t('dates: US order on a French page', formatHints('Créé le Nov 13, 2026', 'fr', { numbers: false }).some((x) => /English order/.test(x)));
t('dates: day-first German date is fine', !formatHints('Erstellt am 13. Nov. 2026, 20:38', 'de', { numbers: false }).length);
t('dates: 12-hour time is fine on an English page', !formatHints('Created Nov 13, 2026, 08:38 PM', 'en').length);
t('dates: styles are told apart', dateStyle('13/11/2026') === 'numeric /' && dateStyle('13.11.2026') === 'numeric .' && dateStyle('Nov 13, 2026') === 'month name, month first' && dateStyle('2026-11-13') === 'ISO');
{
  const r = await scan(loadNew(page(`<main><h1>Verlauf</h1><p>Hier sehen Sie alle Synchronisierungen dieses Projekts der letzten Wochen.</p><table><tr><td>13/11/2026</td></tr><tr><td>14.11.2026</td></tr></table></main>`, 'de')));
  const fmt = r.issues.filter((i) => i.verdict === 'fmt').map((i) => i.reason);
  t('dates: two date formats on one page get a "different formats" hint', fmt.some((x) => /different formats/.test(x)), JSON.stringify(fmt));
}

console.log(`\nconnectors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
