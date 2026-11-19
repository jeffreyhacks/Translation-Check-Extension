// 2.0.7: OK never makes text "translated" (the score stays honest), OK on text you marked goes back to Unclear, and the card on underlined
// text is a setting.
import { loadNew, sleep } from './harness.mjs';
import fs from 'fs';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const HTML = fs.readFileSync('test/e2e/site/de-projects.html', 'utf8');
const HOST = 'knowledge-harvestor.artisanscloud.com';
const opts = { type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'balanced', source: false, live: false };
const scanWith = async (o = {}) => loadNew(HTML, { url: `https://${HOST}/admin/projects` }).call({ ...opts, ...o });

const base = await scanWith();
{
  const r = await scanWith({ ignore: ['Customer Support Hub', 'Inventory Management'] });
  t('OK on untranslated text: it leaves the Untranslated list', r.stats.badN === base.stats.badN - 2 && !r.issues.some((i) => i.text === 'Customer Support Hub'), JSON.stringify(r.stats));
  t('OK on untranslated text: the Translated count does not go up', r.stats.okN === base.stats.okN, `${base.stats.okN} -> ${r.stats.okN}`);
  t('OK on untranslated text: the percentage stays the same (it is still English)', r.score === base.score, `${base.score} -> ${r.score}`);
  t('OK on untranslated text: it is counted as ignored instead', r.stats.skipN === base.stats.skipN + 2 && r.stats.scannedN === base.stats.scannedN);
}
{
  const r = await scanWith({ ignore: ['Skill Scout', 'Hire Flow'] });
  t('OK on unclear text: Translated and the percentage stay the same', r.stats.okN === base.stats.okN && r.score === base.score && r.stats.unsureN === base.stats.unsureN - 2, JSON.stringify([base.stats, r.stats]));
}
{
  const r = await scanWith({ ignore: ['Wisight'] });
  t('OK on one name does not change its neighbours ("Wisight Mapping" stays unclear)', r.issues.some((i) => i.text === 'Wisight Mapping' && i.verdict === 'unsure') && r.stats.okN === base.stats.okN);
}
{
  const h = loadNew(HTML, { url: `https://${HOST}/admin/projects` });
  await h.call({ ...opts, ignore: ['Customer Support Hub'] });
  const ex = await h.call({ type: 'export' });
  const row = ex.issues.find((i) => i.text === 'Customer Support Hub');
  t('export: OK\'d text is Ignored with the models\' reading', row?.verdict === 'skip' && /^Ignored by you \(the models read it as not translated: Looks like English text\)/.test(row.reason), JSON.stringify(row && row.reason));
}

// the card: OK on text you marked undoes the mark (back to Unclear, orange underline); the setting switches the card off
const card = (d) => [...d.documentElement.children].find((e) => e.shadowRoot);
const point = async (h, text) => {
  const d = h.w.document, cell = [...d.querySelectorAll('td div')].find((e) => e.textContent === text);
  d.caretRangeFromPoint = () => { const r = d.createRange(); r.setStart(cell.firstChild, 1); return r; };
  cell.dispatchEvent(new h.w.MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 40 }));
  await sleep(80);
  return card(d);
};
{
  const store = { marked: { global: [], sites: { [HOST]: ['Smart Service Analytics'] } } };
  const h = loadNew(HTML, { url: `https://${HOST}/admin/projects`, storage: store, extra: (w) => {
    w.chrome.storage.local.set = async (o) => Object.assign(store, o);
    w.Range.prototype.getClientRects = () => [{ left: 0, right: 1000, top: 0, bottom: 1000 }];
  } });
  const r = await h.call({ ...opts, marked: ['Smart Service Analytics'] });
  t('setup: the marked text is untranslated', r.issues.find((i) => i.text === 'Smart Service Analytics')?.marked);
  const c = await point(h, 'Smart Service Analytics');
  const btns = c ? [...c.shadowRoot.querySelectorAll('button')] : [];
  t('card on marked text: Unmark, Ignore and OK', btns.map((b) => b.textContent).join() === 'Unmark,Ignore,OK', btns.map((b) => b.textContent).join());
  const before = (await h.call({ type: 'status' })).result;
  btns.find((b) => b.textContent === 'OK').click(); await sleep(400);
  const same = (await h.call({ type: 'status' })).result;
  t('card: OK only closes the card (same tab, same counts, nothing saved)', !card(h.w.document) && JSON.stringify(same.stats) === JSON.stringify(before.stats) && same.issues.find((i) => i.text === 'Smart Service Analytics')?.marked && !store.ignore, JSON.stringify(same.stats));
  const c2 = await point(h, 'Smart Service Analytics');
  [...c2.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'Unmark').click(); await sleep(400);
  const st = (await h.call({ type: 'status' })).result;
  const it = st.issues.find((i) => i.text === 'Smart Service Analytics');
  t('card on marked text: Unmark moves it back to Unclear', it?.verdict === 'unsure' && !it.marked, JSON.stringify(it));
  t('card on marked text: it is not on the ignore list, and Translated did not go up', !(store.ignore?.sites?.[HOST] || []).length && !store.marked.sites[HOST].length && st.stats.okN === base.stats.okN, JSON.stringify([store, st.stats.okN]));
  const style = [...h.w.document.querySelectorAll('style')].map((s) => s.textContent).join('');
  t('card on marked text: its orange wavy underline is back', [...h.w.CSS.highlights._m.entries()].some(([k, v]) => /-unsure$/.test(k) && [...v.s].some((rg) => rg.startContainer?.textContent === 'Smart Service Analytics' || rg.toString?.() === 'Smart Service Analytics')) && /wavy #e8590c/.test(style));
}
// reported: OK on a red (untranslated) or orange (unclear) word must not unmark it or move it to Ignored
{
  const store = {};
  const h = loadNew(HTML, { url: `https://${HOST}/admin/projects`, storage: store, extra: (w) => {
    w.chrome.storage.local.set = async (o) => Object.assign(store, o);
    w.Range.prototype.getClientRects = () => [{ left: 0, right: 1000, top: 0, bottom: 1000 }];
  } });
  const r0 = await h.call(opts);
  const hl = () => Object.fromEntries([...h.w.CSS.highlights._m.entries()].map(([k, v]) => [k.replace(/^tc2-\w+-/, ''), [...v.s].map((rg) => rg.startContainer.textContent || rg.startContainer.nodeValue)]));
  for (const [word, tab] of [['Customer Support Hub', 'bad'], ['Skill Scout', 'unsure']]) {
    const c = await point(h, word);
    [...c.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'OK').click(); await sleep(400);
    const r = (await h.call({ type: 'status' })).result;
    t(`OK on "${word}": the card closes`, !card(h.w.document));
    t(`OK on "${word}": it stays in its tab (${tab}) and keeps its underline`, r.issues.find((i) => i.text === word)?.verdict === tab && (hl()[tab] || []).some((x) => x && x.includes(word)), JSON.stringify(hl()[tab]));
    t(`OK on "${word}": the counts don't change and nothing is saved`, JSON.stringify(r.stats) === JSON.stringify(r0.stats) && !store.ignore && !store.marked, JSON.stringify([r0.stats, r.stats, store]));
  }
  // Ignore is the separate, labelled action; Restore brings it back
  const c = await point(h, 'Customer Support Hub');
  [...c.shadowRoot.querySelectorAll('button')].find((b) => b.textContent === 'Ignore').click(); await sleep(400);
  const r1 = (await h.call({ type: 'status' })).result;
  const ig = (r1.ignored || []).find((i) => i.text === 'Customer Support Hub');
  t('Ignore: the text moves to the Ignored tab, first, marked as yours, with the tab it came from', ig && ig.byUser && ig.was === 'bad' && r1.ignored[0].byUser && !r1.issues.some((i) => i.text === 'Customer Support Hub'), JSON.stringify(ig));
  t('Ignore: the percentage stays the same', r1.score === r0.score, `${r0.score} -> ${r1.score}`);
  const r2 = await h.call({ ...opts, ignore: [] }); // what Restore does: the text is off the ignore list, then the page is checked again
  t('Restore: back in Untranslated, with the same counts as before', r2.issues.find((i) => i.text === 'Customer Support Hub')?.verdict === 'bad' && JSON.stringify(r2.stats) === JSON.stringify(r0.stats));
}
{
  const h = loadNew(HTML, { url: `https://${HOST}/admin/projects`, extra: (w) => { w.Range.prototype.getClientRects = () => [{ left: 0, right: 1000, top: 0, bottom: 1000 }]; } });
  await h.call({ ...opts, hoverCard: false });
  t('setting off: pointing at underlined text shows no card', !(await point(h, 'Skill Scout')));
  await h.call({ type: 'tc-hovercard', on: true });
  t('setting switched on from the popup: the card shows, without checking again', !!(await point(h, 'Skill Scout')));
  await h.call({ type: 'tc-hovercard', on: false });
  t('setting switched off again: the open card closes and no new one appears', !card(h.w.document) && !(await point(h, 'Hire Flow')));
}

console.log(`\n2.0.7: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
