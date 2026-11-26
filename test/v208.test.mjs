// 2.0.8 (reported: a French rubrics page whose report listed 98 "Ignored" rows and no findings): the language is checked before any learned
// rule, learned rules are narrow and tied to their language, the scan waits for a page that is still changing, context is read again when the
// text changes, better reasons for skipped text, one tooltip counted once, and wording hints (one label written two ways, word-for-word calques).
import { loadNew, page, sleep } from './harness.mjs';
import { JSDOM } from 'jsdom';
import * as learn from '../src/learn.js';
import { slotOf } from '../src/context.js';
import { variants, calques } from '../src/wording.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'fr', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });
const HOST = 'www.acmecloud.io';

// The reported page, in short: Tailwind classes everywhere, French interface, rubric criteria partly left in English and German.
const criterion = (text, pts, cls = 'text-sm font-medium') => `<div class="flex items-center justify-between"><span class="${cls}">${text}</span><span class="text-xs text-muted-foreground">${pts} pt.</span></div>`;
const RUBRICS = (cls) => page(`
  <header><a href="/"><img src="logo.png" alt="arena"></a>
    <button class="flex items-center gap-2" title="Start the tour" data-tooltip="Start the tour"><span class="text-sm">TA</span></button></header>
  <main>
    <h1 class="text-2xl font-bold">Grilles d'évaluation</h1>
    <p class="text-sm text-muted-foreground">Gérez vos grilles d'évaluation et les critères de notation de vos jeux de rôle commerciaux.</p>
    <div class="rubric-card rounded-lg border p-4">
      <h3 class="text-lg font-semibold">Modèle de vente consultative</h3>
      ${criterion('Découverte des besoins du client', 25, cls)}
      ${criterion('Transparent pricing and purity', 20, cls)}
      ${criterion('Gezielte Informationsabfrage', 10, cls)}
      ${criterion('Identification des points de douleur et des besoins', 5, cls)}
      ${criterion('Wisight', 5, cls)}
      <button class="inline-flex text-sm">Afficher la grille d'évaluation</button>
    </div>
    <button class="inline-flex text-sm"><span>Manuel de l'utilisateur</span></button>
    <p class="text-xs">Nouveau ? Ouvrez le Manuel utilisateur pour une orientation rapide sur la plateforme.</p>
  </main>`, 'fr', '<title>Arena — AI Role Play Platform</title>');
const texts = (list) => list.map((i) => i.text);
const has = (list, re) => list.some((i) => re.test(i.text));

// ---------- 1. the language comes first: layout-class rules learned before 2.0.8 hide nothing ----------
{
  // what the report's rules looked like: slots made of layout classes, matched on any container further up
  const old = [{ type: 'slot', scope: HOST, value: 'span.text-sm.font-medium' }, { type: 'slot', scope: HOST, value: 'div.flex.items-center' }, { type: 'slot', scope: HOST, value: 'button.inline-flex.text-sm' }];
  const r = await scan(loadNew(RUBRICS()), { learned: old });
  t('language first: English criteria are findings despite the old rules', has(r.issues.filter((i) => i.verdict === 'bad'), /^Transparent pricing/), JSON.stringify(r.issues.map((i) => [i.verdict, i.text])));
  // tinyld weighs a two-word label only against French and English; CLD3 and franc don't read it as French, so it is listed for review
  const gz = r.issues.find((i) => /^Gezielte/.test(i.text));
  t('language first: the German label is listed (needs review), never hidden', gz && (gz.verdict === 'bad' || (gz.verdict === 'unsure' && /^Needs review/.test(gz.reason))), JSON.stringify(gz));
  t('language first: French text is translated, not listed anywhere', !has([...r.issues.filter((i) => i.verdict !== 'fmt'), ...r.ignored], /Découverte des besoins|Afficher la grille/), JSON.stringify(texts(r.ignored)));
  t('language first: layout-class slots are not applied at all', r.stats.learnedN === 0 && !r.ignored.some((i) => /learned/.test(i.reason)), JSON.stringify(r.ignored.map((i) => [i.text, i.reason])));
  t('language first: French text counts in the score as translated (it used to be left out)', r.stats.okN >= 4 && r.score >= 50, JSON.stringify(r.stats));
}

// ---------- 2. a narrow rule only sets aside what the models could not place ----------
{
  const rule = { type: 'slot', scope: HOST, value: 'span.criterion-name' };
  const r = await scan(loadNew(RUBRICS('criterion-name text-sm')), { learned: [rule] });
  const ign = (re) => r.ignored.find((i) => re.test(i.text));
  t('narrow rule: an unclear word in its slot is ignored, with the rule and the models’ reading', ign(/^Wisight$/) && /learned.*span\.criterion-name.*unclear/.test(ign(/^Wisight$/).reason), JSON.stringify(r.ignored.map((i) => [i.text, i.reason])));
  t('narrow rule: English in the same slot stays a finding', r.issues.some((i) => i.verdict === 'bad' && /^Transparent pricing/.test(i.text)));
  t('narrow rule: French in the same slot is translated, not ignored', !ign(/Découverte des besoins/) && !has(r.issues, /Découverte des besoins/));
  const de = await scan(loadNew(RUBRICS('criterion-name text-sm')), { mode: 'strict', learned: [{ ...rule, lang: 'de' }] });
  t('rules belong to a language: a rule learned on German pages does nothing on a French check', !de.ignored.some((i) => /learned/.test(i.reason)) && has(de.issues, /^Wisight$/), JSON.stringify(de.ignored.map((i) => [i.text, i.reason])));
  const fr = await scan(loadNew(RUBRICS('criterion-name text-sm')), { learned: [{ ...rule, lang: 'fr' }] });
  t('rules belong to a language: the same rule learned on French pages applies', fr.ignored.some((i) => /^Wisight$/.test(i.text) && /learned/.test(i.reason)));
  const term = await scan(loadNew(RUBRICS()), { learned: [{ type: 'term', scope: '*', value: 'Transparent pricing and purity' }, { type: 'term', scope: '*', value: 'Wisight' }] });
  t('learned term: English is never hidden by it', term.issues.some((i) => i.verdict === 'bad' && /^Transparent pricing/.test(i.text)));
  t('learned term: an unclear text is set aside by it', term.ignored.some((i) => i.text === 'Wisight' && /learned/.test(i.reason)), JSON.stringify(term.ignored.map((i) => [i.text, i.reason])));
}

// ---------- 3. better reasons, one tooltip once ----------
{
  const r = await scan(loadNew(RUBRICS()));
  const pts = r.ignored.find((i) => /^\d+ pt\.$/.test(i.text));
  t('reasons: "25 pt." is a number with a unit, not a code', pts && /^Number with a unit or abbreviation \(“pt\.”\)/.test(pts.reason), pts && pts.reason);
  const logo = r.ignored.find((i) => i.text === 'arena');
  t('reasons: the logo’s "arena" is the name of the site (from the title and the logo)', logo && /Name of this site or app/.test(logo.reason), JSON.stringify(logo || r.issues.find((i) => i.text === 'arena')));
  const tip = r.issues.find((i) => i.text === 'Start the tour');
  t('tooltips: the same text in title and data-tooltip is one tooltip, not two copies', tip && tip.count === 1, tip && JSON.stringify(tip.occ));
  // a heading such as "Paramètres" in the title is not taken for the site's name (the logo doesn't say it)
  const set = await scan(loadNew(page('<header><img alt="arena" src="l.png"></header><main><h1>Settings</h1><p>Modifiez vos préférences de compte et vos notifications ici.</p></main>', 'fr', '<title>Settings — Arena</title>')));
  t('reasons: a page heading in the title is still checked', set.issues.some((i) => i.text === 'Settings'), JSON.stringify(set.issues.map((i) => i.text)));
}

// ---------- 4. wording hints ----------
{
  const r = await scan(loadNew(RUBRICS()));
  const fmt = r.issues.filter((i) => i.verdict === 'fmt');
  t('wording: "points de douleur" is flagged as a word-for-word "pain points"', fmt.some((i) => /points de douleur/.test(i.text) && /pain points/.test(i.reason)), JSON.stringify(fmt.map((i) => [i.text, i.reason])));
  t('wording: "Manuel de l’utilisateur" and "Manuel utilisateur" are the same thing written two ways', fmt.some((i) => /Manuel de l'utilisateur/.test(i.text) && /written two ways/.test(i.reason) && /Manuel utilisateur/.test(i.reason)));
  t('wording: hints never count against the score or the untranslated count', r.stats.badN === r.issues.filter((i) => i.verdict === 'bad').reduce((n, i) => n + i.count, 0));
  t('wording unit: capitals alone are not two ways', !variants(['Gestion des objections', 'gestion des objections'], 'fr').size);
  t('wording unit: different words are not two ways', !variants(['Découverte des besoins', 'Découverte des besoins des clients', 'Évaluation des besoins'], 'fr').size);
  t('wording unit: a shorter label inside a sentence is found', variants(['Manuel utilisateur', 'Ouvrez le Manuel de l’utilisateur ici'], 'fr').get('Manuel utilisateur') === 'Manuel de l’utilisateur');
  t('wording unit: "établissement de rapport" (rapport building)', /rapport building/.test(calques('Ouverture et établissement de rapport', 'fr')[0] || ''));
  t('wording unit: nothing on ordinary French', !calques('Établir un ordre du jour clair et écouter le client', 'fr').length);
}

// ---------- 5. a page still changing: wait for it, and read the context again ----------
{
  // the app swaps its translations in after the first paint (React updates the same text nodes)
  const html = page(`<main><h1>Grilles d'évaluation</h1><p>Gérez vos grilles d'évaluation et les critères de notation de vos jeux de rôle.</p>
    <div class="card"><span id="a">Discovering the family's needs</span> <span>15 pt.</span> <span id="b">Transparent pricing and purity</span> <span>20 pt.</span></div></main>`, 'fr');
  const swap = (h) => { h.w.document.getElementById('a').firstChild.nodeValue = 'Découvrir les besoins de la famille'; h.w.document.getElementById('b').firstChild.nodeValue = 'Tarification transparente et pureté'; };
  const h = loadNew(html);
  setTimeout(() => { h.w.document.querySelector('h1').firstChild.nodeValue = "Grilles d'évaluation (2)"; }, 40);
  setTimeout(() => swap(h), 180);
  const r = await scan(h);
  t('stable page: the check waits until the page stops changing, then reads the final text', !has(r.issues, /Discovering|Transparent/) && r.stats.badN === 0, JSON.stringify(r.issues.map((i) => i.text)));

  // the swap happens after the check: the export brings the rows up to date and reads their context again, in the same moment
  const h2 = loadNew(html);
  const before = await scan(h2);
  t('export: before the swap, the English criteria are findings', has(before.issues, /Discovering/) && has(before.issues, /Transparent/));
  const pts0 = (await h2.call({ type: 'export' })).issues.find((i) => i.text === '15 pt.');
  t('export: the context first shows the English neighbours', pts0 && /Discovering/.test(pts0.occurrences[0].before), JSON.stringify(pts0 && pts0.occurrences));
  swap(h2);
  const ex = await h2.call({ type: 'export' });
  const pts = ex.issues.find((i) => i.text === '15 pt.');
  t('export: text that changed since the check is checked again (no stale English rows)', !has(ex.issues, /Discovering|Transparent/), JSON.stringify(texts(ex.issues)));
  t('export: the context is read again, so text and context match', pts && /Découvrir les besoins/.test(pts.occurrences[0].before) && !/Discovering|Transparent/.test(JSON.stringify(ex.issues.map((i) => i.occurrences))), JSON.stringify(pts && pts.occurrences));
}

// ---------- 6. learning logic ----------
{
  t('slots: layout classes alone are never usable', !learn.slotUsable('span.text-sm.font-medium') && !learn.slotUsable('div.flex.items-center') && !learn.slotUsable('button.btn') && !learn.slotUsable('span.md:text-lg'));
  t('slots: a class that names the slot is', learn.slotUsable('span.user-name') && learn.slotUsable('span.criterion-name.text-sm') && learn.slotUsable('[data-testid="sku"]'));
  const d = new JSDOM('<span class="text-sm font-medium criterion-name">A</span><div class="flex gap-2"><span class="text-xs">B</span></div>').window.document;
  t('slots: the class that names the slot comes first', slotOf(d.querySelector('span')) === 'span.criterion-name.text-sm', slotOf(d.querySelector('span')));
  const m0 = learn.loadMemory({ rules: [{ type: 'slot', scope: 'a', value: 'span.text-sm.font-medium' }, { type: 'slot', scope: 'a', value: 'span.user-name' }] });
  t('slots: stored layout-class rules from before are dropped on load', m0.rules.length === 1 && m0.rules[0].value === 'span.user-name', JSON.stringify(m0.rules));
  let m = learn.emptyMemory();
  for (const x of ['Ana', 'Bob', 'Cy']) m = learn.record(m, { text: x, host: 'a', slot: 'span.text-sm', lang: 'fr' }).mem;
  t('learn: three Ignores in a layout-class slot learn nothing', !m.rules.length, JSON.stringify(m.rules));
  m = learn.emptyMemory();
  m = learn.record(m, { text: 'Ana', host: 'a', slot: 'span.user-name', lang: 'fr' }).mem;
  m = learn.record(m, { text: 'Bob', host: 'a', slot: 'span.user-name', lang: 'de' }).mem;
  let r = learn.record(m, { text: 'Cy', host: 'a', slot: 'span.user-name', lang: 'fr' });
  t('learn: Ignores made in different languages don’t add up', !r.learned.length, JSON.stringify(r.learned));
  r = learn.record(r.mem, { text: 'Dee', host: 'a', slot: 'span.user-name', lang: 'fr-FR' });
  t('learn: the rule carries the language it was learned for', r.learned.length === 1 && r.learned[0].lang === 'fr', JSON.stringify(r.learned));
  t('learn: rulesFor keeps the language, and the description says it', learn.rulesFor(r.mem, 'a')[0].lang === 'fr' && /fr pages/.test(learn.describeRule(r.learned[0], 'a')));
  const dd = new JSDOM('<div class="rubric-card"><span class="x-title">Inside</span></div><span class="user-name"><b>Ana</b></span>').window.document;
  const mt = learn.matcher([{ type: 'slot', value: 'div.rubric-card' }, { type: 'slot', value: 'span.user-name' }], 'fr');
  t('matcher: a slot never covers text in a container further down', !mt('Inside', dd.querySelector('.x-title')));
  t('matcher: a bare inline wrapper inside the slot still matches', !!mt('Ana', dd.querySelector('b')));
  t('matcher: rules for another language are left out', !learn.matcher([{ type: 'shape', value: 'version', lang: 'de' }], 'fr')('v2.4.1', null) && !!learn.matcher([{ type: 'shape', value: 'version' }], 'fr')('v2.4.1', null));
}

console.log(`\n2.0.8: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
