// Reported: German "Projekte" list. "Smart Service Analytics", "Testproj123" and "Solan → Bhayla Manufacturing Transition" got no result at all
// (assumed translated, cleared by their section, or masked away as a code), unclear text was not marked on the page, and there was no way to see
// that every item was checked.
import { loadNew, page, sleep } from './harness.mjs';
import fs from 'fs';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });
const HTML = fs.readFileSync('test/e2e/site/de-projects.html', 'utf8');
const NAMES = ['Truecost', 'Testproj123', 'Customer Support Hub', 'Skill Scout', 'HomeIoT Manager', 'Wisight', 'Hire Flow', 'Session Management',
  'Riverside Cold-Chain Hub Migration', 'Payment Platform Migration', 'Smart Service Analytics', 'Inventory Management', 'Wisight Mapping',
  'Product Requirements Document', 'TrueCost', 'Knowledge Capture Pilot', 'incoming inspection process at plant PB01', 'Solan → Bhayla Manufacturing Transition'];

{
  const h = loadNew(HTML, { url: 'https://knowledge-harvestor.artisanscloud.com/admin/projects' });
  const r = await scan(h);
  const by = (x) => r.issues.find((i) => i.text === x);
  const list = JSON.stringify(r.issues.map((i) => [i.verdict, i.text, i.reason]));
  for (const x of ['Smart Service Analytics', 'Testproj123', 'Solan → Bhayla Manufacturing Transition']) {
    t(`projects: "${x}" gets a result (unclear, with a reason)`, by(x)?.verdict === 'unsure' && !!by(x).reason, list);
  }
  t('projects: every project name in the column is either untranslated or unclear', NAMES.every((x) => ['bad', 'unsure'].includes(by(x)?.verdict)), JSON.stringify(NAMES.filter((x) => !by(x))));
  t('projects: "Testproj123" says why ("Name or code?")', /^Name or code/.test(by('Testproj123')?.reason || ''));
  t('projects: every unclear item has a reason', r.issues.filter((i) => i.verdict === 'unsure').every((i) => i.reason), list);
  const s = r.stats;
  t('coverage: the counts add up to the number of text items scanned', s.scannedN === s.okN + s.badN + s.unsureN + s.bugN + s.nameN + s.skipN && s.scannedN > 40, JSON.stringify(s));
  t('coverage: the German interface text is still translated', !r.issues.some((i) => /Verwalten Sie|Ausstehend|Abgeschlossen|Projekte/.test(i.text)), list);
  const ex = await h.call({ type: 'export' });
  const ign = ex.issues.filter((i) => i.verdict === 'skip');
  t('export: ignored items are exported with a reason (dates here)', ign.length && ign.every((i) => i.reason && i.selector), JSON.stringify(ign.slice(0, 3)));
  t('export: ignored + listed occurrences match the coverage count minus translated text',
    ex.issues.reduce((n, i) => n + (i.verdict === 'fmt' ? 0 : i.count), 0) === s.scannedN - s.okN, JSON.stringify([ex.issues.length, s]));
}

// generic: codes in a column of codes stay ignored (no flood of unclear items); German names in a column are not touched
{
  const html = page(`<main><h1>Artikelliste</h1><p>Hier finden Sie alle Artikel im Lager mit ihrer Nummer und ihrem aktuellen Bestand.</p><table>
    <tr><th>Nummer</th><th>Artikel</th></tr>
    <tr><td>AB-1001</td><td>Schraubenschlüssel</td></tr><tr><td>ZX-2002</td><td>Hammer aus Stahl</td></tr><tr><td>QQ-3003</td><td>Wasserwaage</td></tr><tr><td>KL-4004</td><td>Schleifpapier</td></tr></table></main>`, 'de');
  const r = await scan(loadNew(html));
  t('generic: a column of article codes is ignored, not unclear', !r.issues.some((i) => /\d{4}/.test(i.text)) && r.stats.ignoredN >= 4, JSON.stringify([r.issues.map((i) => i.text), r.stats]));
}
// generic: the same on a French page, other markup (a list of cards instead of a table)
{
  const card = (x) => `<li class="project-card"><h3 class="project-title">${x}</h3><p>Créé par l’équipe produit</p></li>`;
  const html = page(`<main><h1>Mes projets</h1><p>Retrouvez ici tous les projets de votre organisation et leur avancement.</p><ul>${['Customer Support Hub', 'Inventory Management', 'Payment Platform Migration', 'Smart Service Analytics', 'Proj42x'].map(card).join('')}</ul></main>`, 'fr');
  const r = await scan(loadNew(html), { lang: 'fr' });
  const by = (x) => r.issues.find((i) => i.text === x);
  t('generic: on a French list of cards, "Smart Service Analytics" and "Proj42x" are not silently dropped', ['bad', 'unsure'].includes(by('Smart Service Analytics')?.verdict) && by('Proj42x')?.verdict === 'unsure', JSON.stringify(r.issues.map((i) => [i.verdict, i.text])));
}

// on the page: orange wavy underline for unclear text, and a card on hover with the reason, the votes and a decision
{
  const store = {}, sets = [];
  const h = loadNew(HTML, { url: 'https://knowledge-harvestor.artisanscloud.com/admin/projects', storage: store, extra: (w) => {
    w.chrome.storage.local.set = async (o) => { sets.push(o); Object.assign(store, o); };
    w.Range.prototype.getClientRects = () => [{ left: 0, right: 1000, top: 0, bottom: 1000 }];
  } });
  await scan(h);
  const d = h.w.document;
  const style = [...d.querySelectorAll('style')].map((s) => s.textContent).join('');
  t('page: unclear text has an orange wavy underline (no yellow highlight)', /-unsure\)\{background-color:rgba\(232,89,12,\.02\);text-decoration:underline wavy #e8590c 1px\}/.test(style), style.slice(0, 400));
  t('page: untranslated text keeps the yellow highlight and red wavy underline', /-bad\)\{background-color:#ffd600;color:#111;text-decoration:underline wavy #d7263d\}/.test(style));
  const cell = [...d.querySelectorAll('td div')].find((e) => e.textContent === 'Smart Service Analytics');
  d.caretRangeFromPoint = () => { const r = d.createRange(); r.setStart(cell.firstChild, 2); return r; };
  cell.dispatchEvent(new h.w.MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 }));
  await sleep(80);
  const host = [...d.documentElement.children].find((e) => e.shadowRoot);
  const txt = host?.shadowRoot.textContent || '';
  t('hover: a card shows "Unclear", the reason and the model agreement', /Unclear/.test(txt) && /Name or title\? Could be untranslated/.test(txt) && /\d\/3 models/.test(txt), txt);
  const buttons = host ? [...host.shadowRoot.querySelectorAll('button')].map((b) => b.textContent) : [];
  t('hover: the card offers "Not translated" and "OK"', buttons.join() === 'Not translated,OK', buttons.join());
  host.shadowRoot.querySelector('button').click();
  await sleep(400);
  t('hover: "Not translated" saves the text in the marked list for this site', sets.length && store.marked.sites['knowledge-harvestor.artisanscloud.com'].includes('Smart Service Analytics'), JSON.stringify(store));
  const st = await h.call({ type: 'status' });
  const sm = st.result.issues.find((i) => i.text === 'Smart Service Analytics');
  t('hover: the page is checked again and the text is now untranslated (marked)', sm?.verdict === 'bad' && sm.marked, JSON.stringify(sm));
  // OK: ignore list, and gone from the results
  const cell2 = [...d.querySelectorAll('td div')].find((e) => e.textContent === 'Testproj123');
  d.caretRangeFromPoint = () => { const r = d.createRange(); r.setStart(cell2.firstChild, 1); return r; };
  cell2.dispatchEvent(new h.w.MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 60 }));
  await sleep(80);
  const host2 = [...d.documentElement.children].find((e) => e.shadowRoot);
  [...host2.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
  await sleep(400);
  const st2 = await h.call({ type: 'status' });
  t('hover: "OK" puts the text on this site\'s ignore list and it is no longer listed', store.ignore.sites['knowledge-harvestor.artisanscloud.com'].includes('Testproj123') && !st2.result.issues.some((i) => i.text === 'Testproj123'), JSON.stringify(store.ignore));
  t('hover: the earlier mark is kept', st2.result.issues.find((i) => i.text === 'Smart Service Analytics')?.marked);
  const ex = await h.call({ type: 'export' });
  t('export: the OK\'d text is listed as ignored, with the reason', ex.issues.some((i) => i.text === 'Testproj123' && i.verdict === 'skip' && /^OK’d by you \(the models read it as unclear/.test(i.reason)), JSON.stringify(ex.issues.filter((i) => i.verdict === 'skip').map((i) => [i.text, i.reason])));
}
// with "Mark unclear text" off, unclear text is not underlined and has no card
{
  const h = loadNew(HTML, { extra: (w) => { w.Range.prototype.getClientRects = () => [{ left: 0, right: 1000, top: 0, bottom: 1000 }]; } });
  await scan(h, { unsure: false });
  const d = h.w.document;
  const cell = [...d.querySelectorAll('td div')].find((e) => e.textContent === 'Smart Service Analytics');
  d.caretRangeFromPoint = () => { const r = d.createRange(); r.setStart(cell.firstChild, 2); return r; };
  cell.dispatchEvent(new h.w.MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 50 }));
  await sleep(80);
  t('hover: no card for unclear text when unclear marks are off', ![...d.documentElement.children].some((e) => e.shadowRoot));
}

console.log(`\nprojects: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
