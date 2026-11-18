// 2.0.6: grouped strings with their locations, context capture, learned ignore rules, marked-untranslated texts.
import { loadNew, loadBg, page, sleep } from './harness.mjs';
import fs from 'fs';
import { mask } from '../src/mask.js';
import { JSDOM } from 'jsdom';
import * as learn from '../src/learn.js';
import { describe, slotOf } from '../src/context.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'es', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });

// ---------- grouping + context ----------
const SHOP = page(`
  <header><nav aria-label="Main menu"><a href="#">Inicio</a> <a href="#">Productos</a> <button class="cart-btn">Add to cart</button></nav></header>
  <main>
    <section><h2>Ofertas de la semana</h2>
      <div class="card"><h3>Camiseta azul</h3><p>Algodón orgánico de alta calidad para todos los días.</p><button class="cart-btn">Add to cart</button></div>
      <div class="card"><h3>Pantalón negro</h3><p>Corte recto y tejido resistente para el trabajo diario.</p><button class="cart-btn">Add to cart</button></div>
    </section>
    <form aria-label="Boletín"><label for="em">Correo electrónico</label><input id="em" placeholder="Enter your email address"></form>
    <p>Envío gratuito en pedidos superiores a cincuenta euros en toda la península.</p>
  </main>`, 'es');
{
  const h = loadNew(SHOP);
  const r = await scan(h);
  const add = r.issues.filter((i) => i.text === 'Add to cart');
  t('grouping: three copies of "Add to cart" are one item', add.length === 1 && add[0].count === 3 && add[0].occ.length === 3, JSON.stringify(r.issues.map((i) => [i.text, i.count])));
  t('grouping: the score still counts every copy (3 untranslated occurrences + 1 placeholder)', r.stats.badN === 4, JSON.stringify(r.stats));
  t('grouping: every copy keeps its own id for jumping to it', new Set(add[0].occ.map((o) => o.id)).size === 3);
  const focusAll = await Promise.all(add[0].occ.map((o) => h.call({ type: 'focus', id: o.id })));
  t('grouping: each copy can be focused', focusAll.every((x) => x.ok));
  const o = add[0].occ;
  t('context: the first copy is a button in the navigation', /^button · Navigation “Main menu”/.test(o[0].where), o[0].where);
  t('context: the card copies name their heading and the text around them', /“Camiseta azul”/.test(o[1].where) && /orgánico de alta calidad/.test(o[1].before) && /“Pantalón negro”/.test(o[2].where), JSON.stringify(o));
  t('context: the text around a nav button stays inside the navigation', o[0].before === 'Inicio Productos' && o[0].after === '', JSON.stringify(o[0]));
  const ph = r.issues.find((i) => /email/.test(i.text));
  t('context: a placeholder names its form and field label', ph && /^placeholder · Form “Boletín” › field “Correo electrónico”/.test(ph.occ[0].where), ph && ph.occ[0].where);
  t('context: a stable slot is captured for learning', add[0].slot === 'button.cart-btn', add[0].slot);
  const ex = await h.call({ type: 'export' });
  const exAdd = ex.issues.find((i) => i.text === 'Add to cart');
  t('export: grouped item lists all three locations with selectors and context', exAdd.occurrences.length === 3 && exAdd.occurrences.every((x) => x.selector && x.where) && exAdd.selector === exAdd.occurrences[0].selector, JSON.stringify(exAdd.occurrences));
}

// ---------- learned rules are applied on the page ----------
{
  const html = page(`<main><h1>Catálogo de productos</h1><p>Consulte nuestra selección completa de herramientas profesionales para el taller.</p>
    <ul><li><span class="sku">AB-1001</span> Martillo de carpintero</li><li><span class="sku">ZX-2002</span> Destornillador de precisión</li><li><span class="sku">QQ-3003</span> Llave inglesa ajustable</li>
    <li><span class="user-name">Jonathan Whitfield</span> ha comprado</li><li><span class="user-name">Rebecca Thornton</span> ha comprado</li></ul>
    <p>Version v2.4.1</p><button>Save changes</button></main>`, 'es');
  const base = await scan(loadNew(html));
  const sl = await scan(loadNew(html), { learned: [{ type: 'slot', scope: 'www.acmecloud.io', value: 'span.user-name' }, { type: 'shape', scope: '*', value: 'code' }, { type: 'term', scope: '*', value: 'Save changes' }] });
  const has = (r, re) => r.issues.some((i) => re.test(i.text));
  t('learned: slot rule skips text in that slot', !has(sl, /Whitfield|Thornton/) && sl.stats.learnedN >= 2, JSON.stringify({ base: base.issues.map((i) => i.text), sl: sl.issues.map((i) => i.text), n: sl.stats.learnedN }));
  t('learned: term rule works like an ignored term', has(base, /Save changes/) && !has(sl, /Save changes/));
  const texts = (r) => new Set(r.issues.map((i) => i.text));
  t('learned: nothing else changes (no new warnings; only the skipped names and term are gone)', [...texts(sl)].every((x) => texts(base).has(x)) && sl.stats.badN <= base.stats.badN && sl.stats.okN >= base.stats.okN - 2, JSON.stringify([base.stats, sl.stats]));
  const none = await scan(loadNew(html), { learned: [] });
  t('learned: without rules the result is exactly as before', JSON.stringify(none.stats) === JSON.stringify(base.stats));
}

// ---------- learning logic ----------
{
  let m = learn.emptyMemory();
  const ig = (text, host, slot = '') => { const r = learn.record(m, { text, host, slot }); m = r.mem; return r.learned; };
  t('learn: two codes are not enough', !ig('SKU-1001', 'shop.a').length && !ig('SKU-2002', 'shop.a').length);
  const l3 = ig('INV-77/2024', 'shop.a');
  t('learn: the third code on a site learns a "codes" rule for that site', l3.length === 1 && l3[0].type === 'shape' && l3[0].value === 'code' && l3[0].scope === 'shop.a', JSON.stringify(l3));
  t('learn: the same text ignored again is one example, not two', (() => { let mm = learn.emptyMemory(); for (const x of ['Foo-1', 'foo-1', 'FOO-1']) mm = learn.record(mm, { text: x, host: 'a' }).mem; return !mm.rules.length; })());
  const sl = [ig('Jonathan Whitfield', 'shop.a', 'span.user-name'), ig('Rebecca Thornton', 'shop.a', 'span.user-name'), ig('Ana Ruiz', 'shop.a', 'span.user-name')];
  t('learn: three texts in the same slot learn a slot rule', !sl[0].length && !sl[1].length && sl[2].some((r) => r.type === 'slot' && r.value === 'span.user-name'));
  t('learn: broad shapes are never learned (capitalised words, names)', !m.rules.some((r) => r.type === 'shape' && !learn.SHAPES[r.value]) && learn.shapeOf('Settings') === '' && learn.shapeOf('Order History') === '' && learn.shapeOf('Jonathan Whitfield') === '');
  const g = [ig('Acme Rocket', 'shop.a'), ig('Acme Rocket', 'shop.b')];
  t('learn: the same text ignored on two sites becomes an all-sites term', !g[0].length && g[1].some((r) => r.type === 'term' && r.scope === '*'));
  const code = m.rules.find((r) => r.type === 'shape');
  m = learn.reject(m, code);
  for (const x of ['ZZ-1', 'ZZ-2', 'ZZ-3', 'ZZ-4']) ig(x, 'shop.a');
  t('learn: a removed rule is not learned again', !m.rules.some((r) => r.type === 'shape' && r.value === 'code' && r.scope === 'shop.a'));
  t('learn: rules apply only on their site (plus all-sites ones)', learn.rulesFor(m, 'shop.a').some((r) => r.type === 'slot') && !learn.rulesFor(m, 'other.site').some((r) => r.type === 'slot') && learn.rulesFor(m, 'other.site').some((r) => r.scope === '*'));
  m = { ...m, on: false };
  t('learn: switched off, nothing is recorded', !learn.record(m, { text: 'QQ-1', host: 'x' }).mem.history.some((h) => h.text === 'QQ-1'));
  t('learn: bad stored data is cleaned, not trusted', learn.loadMemory({ rules: [{ type: 'slot', scope: 'a', value: 'x"]);alert(1)//' }, { type: 'eval', scope: 'a', value: 'x' }, null], history: 'no' }).rules.length === 0);
  const mt = learn.matcher([{ type: 'shape', value: 'version' }, { type: 'slot', value: 'span.user-name' }]);
  const d = new JSDOM('<span class="user-name"><b>Ana</b></span><span>Hola</span>').window.document;
  t('learn: matcher finds shapes and slots', mt('v2.4.1', null) && mt('Ana', d.querySelector('b')) && !mt('Hola', d.querySelectorAll('span')[1]) && !mt('Version 2', null));
}

// ---------- context helpers ----------
{
  const d = new JSDOM(`<div class="css-1x2y3z sc-AxjAm"><span class="jsx-123456">A</span></div><p data-testid="price-label">B</p><span>C</span><div class="product-title"><em>D</em></div>`).window.document;
  t('context: generated class names are not used as slots', slotOf(d.querySelector('span.jsx-123456')) === '');
  t('context: test ids and readable classes are', slotOf(d.querySelector('p')) === '[data-testid="price-label"]' && slotOf(d.querySelector('div.product-title')) === 'div.product-title');
  t('context: a class further up is not used (it would cover a whole card)', slotOf(d.querySelector('em')) === '');
  t('context: a bare element has no slot', slotOf(d.querySelectorAll('span')[1]) === '');
  t('context: never throws on odd input', describe(null, d.body).kind === 'text');
}

// ---------- spelling, layout and the stretch test were removed: old saved settings that still ask for them change nothing ----------
{
  const html = page(`<main><h1>Welcome to the dashboard</h1><p>Recieve weekly updates about your the the team performance.</p><button>Addto cart</button></main>`, 'en');
  const r = await scan(loadNew(html), { lang: 'en', spell: true, layout: true });
  t('removed: no spelling or layout items, and the score is unchanged', !r.issues.some((i) => i.verdict === 'spell' || i.verdict === 'layout') && r.score === 100 && !('spellN' in r.stats) && !('layoutN' in r.stats), JSON.stringify([r.issues.map((i) => i.verdict), r.stats]));
}

// ---------- reported: 3/3 models said "not Hindi" but it was listed under Unclear ("Not confirmed by a second model") ----------
{
  const bg = loadBg();
  // as the page script does: text that masking empties (brand-style words such as "WhatsApp") is skipped, never judged
  const judge = async (lang, raw) => { const m = mask(raw, lang, null).text; if (!/\p{L}{2}/u.test(m)) return { v: 'skipped' }; return (await bg({ type: 'tc-classify', lang, related: true, verify: true, ctxTexts: [], texts: [m] })).verdicts[0]; };
  for (const [lang, raw] of [['hi', 'technical • impatient'], ['hi', 'casual • calm'], ['ar', 'friendly • curious'], ['ru', 'Save changes'], ['ja', 'casual • calm'], ['zh', 'Export the report']]) {
    const v = await judge(lang, raw);
    t(`script+dictionary: "${raw}" on a ${lang} page is untranslated English and confirmed`, v.v === 'bad' && v.detected === 'en' && v.confirmed, JSON.stringify(v));
  }
  for (const raw of ['Google', 'Apple Music', 'WhatsApp', 'Rahul Sharma', 'Katalyst Arena', 'Microsoft Teams', 'YouTube']) {
    const v = await judge('hi', raw);
    t(`script+dictionary: name/brand "${raw}" on a Hindi page is not flagged`, v.v !== 'bad', JSON.stringify(v));
  }
  t('script+dictionary: Hindi text on a Hindi page is fine', (await judge('hi', 'सत्र विवरण')).v === 'ok');
  const fr = await judge('fr', 'Service client');
  t('labels unchanged: "Service client" keeps its French label', fr.detected !== 'en' || fr.v !== 'bad', JSON.stringify(fr));
  const html = page(Array.from({ length: 8 }, (_, k) => `<div class="card"><h3>सत्र विवरण ${k + 1}</h3><dl><dt>ग्राहक प्रकार</dt><dd>technical • impatient</dd><dt>उद्देश्य</dt><dd>आपकी भूमिका निर्दिष्ट नहीं है, कृपया ग्राहक के साथ बातचीत शुरू करें।</dd></dl></div>`).join(''), 'hi');
  const r = await scan(loadNew(html), { lang: 'hi', confirmedOnly: true });
  const ti = r.issues.find((i) => i.text === 'technical • impatient');
  t('confirmed-only: the reported case is untranslated (×8), not unclear', ti && ti.verdict === 'bad' && ti.count === 8 && ti.confirmed && !r.issues.some((i) => i.verdict === 'unsure'), JSON.stringify(r.issues.map((i) => [i.verdict, i.text, i.reason])));
}

// ---------- reported: stepping through copies quickly lost the page highlight ----------
{
  const html = page('<main>' + Array.from({ length: 4 }, (_, k) => `<p id="p${k}">Add to cart</p><p>Texto traducido al español número ${k} para la prueba de navegación.</p>`).join('') + '</main>', 'es');
  const h = loadNew(html);
  const r = await scan(h);
  const g = r.issues.find((i) => i.text === 'Add to cart');
  const reg = h.w.CSS.highlights._m;
  const focusKey = () => [...reg.keys()].find((k) => /-focus$/.test(k));
  for (const o of g.occ) await h.call({ type: 'focus', id: o.id }); // four quick clicks
  const hl = reg.get(focusKey());
  const node = hl && [...hl.s][0].startContainer;
  t('focus: after quick clicks the last copy is marked', !!hl && (node.id === 'p3' || node.parentElement?.id === 'p3' || node.parentNode?.id === 'p3'), String(node?.nodeName));
  await sleep(2500); // the old code's first timer (2.2 s) deleted the newest mark here
  t('focus: an earlier click\'s timer does not wipe the newest mark', !!focusKey());
  await sleep(4000);
  t('focus: the mark goes away by itself after a few seconds', !focusKey());
}

// ---------- reported: German dashboard and sessions: titles hidden by their section or the page average; one of three "Skill Scout" copies listed ----------
{
  const d = await scan(loadNew(fs.readFileSync('test/e2e/site/de-dashboard.html', 'utf8')), { lang: 'de' });
  const by = (r, x) => r.issues.find((i) => i.text === x);
  t('de dashboard: all three "Skill Scout" copies are listed together', by(d, 'Skill Scout')?.count === 3, JSON.stringify(by(d, 'Skill Scout')));
  { // marked untranslated by the user: every copy is listed as untranslated, case-insensitive, and the score follows
    const m = await scan(loadNew(fs.readFileSync('test/e2e/site/de-dashboard.html', 'utf8')), { lang: 'de', marked: ['truecost', 'Hire Flow'] });
    const tc = m.issues.find((i) => i.text === 'Truecost'), hf = m.issues.find((i) => i.text === 'Hire Flow');
    t('marked: "Truecost" and "Hire Flow" move to untranslated (every copy), with the reason shown', tc?.verdict === 'bad' && tc.count === 2 && tc.marked && hf?.verdict === 'bad' && hf.count === 2 && /Marked untranslated by you/.test(tc.reason), JSON.stringify(m.issues.map((i) => [i.verdict, i.text, i.count])));
    t('marked: no copy is left under unclear', !m.issues.some((i) => i.verdict === 'unsure' && /^(Truecost|Hire Flow)$/.test(i.text)));
    t('marked: the score counts every copy as untranslated (Truecost ×2, TrueCost ×1, Hire Flow ×2)', m.stats.badN === d.stats.badN + 5 && m.stats.unsureN === d.stats.unsureN - 5 && m.issues.find((i) => i.text === 'TrueCost')?.verdict === 'bad', JSON.stringify([m.stats, d.stats]));
    t('marked: other items are unchanged', m.issues.find((i) => i.text === 'Skill Scout')?.verdict === d.issues.find((i) => i.text === 'Skill Scout')?.verdict);
  }
  t('de dashboard: "Truecost" (×2) and "TrueCost" (×1) are separate rows, each spelling shown as written', by(d, 'Truecost')?.count === 2 && by(d, 'TrueCost')?.count === 1 && by(d, 'TrueCost')?.occ.length === 1, JSON.stringify(d.issues.map((i) => [i.verdict, i.text, i.count])));
  t('de dashboard: "Hire Flow", "Wisight", "Truecost" are listed (every copy)', by(d, 'Hire Flow')?.count === 2 && by(d, 'Wisight')?.count === 2 && by(d, 'Truecost')?.count === 2, JSON.stringify(d.issues.map((i) => [i.verdict, i.text, i.count])));
  const s2 = await scan(loadNew(fs.readFileSync('test/e2e/site/de-sessions.html', 'utf8')), { lang: 'de' });
  const want = ['HomeIoT', 'Home IOT', 'Wisight Mapping', 'Wisight Sytems Developer', 'Inventory Management', 'Trucost', 'TrueCost', 'Wisight Development', 'Payment Platform Migration'];
  t('de sessions: every English session title is listed (untranslated or unclear)', want.every((x) => by(s2, x)), want.filter((x) => !by(s2, x)).join(', '));
  t('de sessions: German text is not flagged', !s2.issues.some((i) => /Sitzung|beantwortet|Ausstehend|Abgeschlossen/.test(i.text)), JSON.stringify(s2.issues.map((i) => i.text)));
}

// ---------- a copy whose extension was reloaded stops for good (it can no longer touch the new copy's marks) ----------
{
  const html = page('<main><p>Texto traducido al español para la prueba de copias antiguas.</p><p id="x">Guardar cambios</p></main>', 'es');
  const h = loadNew(html, { extra: (w) => { w.chrome.runtime.id = 'ext-1'; } }); // a real content script starts with its extension's id
  await scan(h, { live: true });
  h.w.chrome.runtime.id = undefined; // extension reloaded: this copy is orphaned
  const p = h.w.document.createElement('p'); p.textContent = 'Add to cart now'; h.w.document.querySelector('main').append(p);
  await sleep(1200);
  t('orphaned copy: no more live re-checks after the extension was reloaded', h.bgCalls.results === 0, String(h.bgCalls.results));
}

// ---------- reported: Hindi sessions table: titles missing from both lists, "Review Pending" labelled Indonesian, IDs cluttering ----------
{
  const r = await scan(loadNew(fs.readFileSync('test/e2e/site/hi-sessions.html', 'utf8')), { lang: 'hi' });
  const by = (x) => r.issues.find((i) => i.text === x);
  t('hi table: "Review Pending" is labelled English (its wording), not Indonesian', by('Review Pending')?.detected === 'en', JSON.stringify(by('Review Pending')));
  t('hi table: titles that may be names are listed as unclear, with a reason', ['Wisight Mapping', 'Wisight Sytems Developer', 'Wisight Development', 'Trucost', 'HomeIoT', 'TrueCost'].every((x) => by(x)?.verdict === 'unsure' && /Name or title/.test(by(x).reason)), JSON.stringify(r.issues.map((i) => [i.verdict, i.text])));
  t('hi table: English titles made of dictionary words are untranslated ("Inventory Management", "Home IOT")', by('Inventory Management')?.verdict === 'bad' && by('Home IOT')?.verdict === 'bad', JSON.stringify([by('Inventory Management'), by('Home IOT')]));
  t('hi table: plain English stays untranslated', by('Payment Platform Migration')?.verdict === 'bad' && by('AI/ML Engineer Knowledge Capture – Document Test')?.count === 2);
  t('hi table: Latin text is never "assumed translated" on a page in another script', r.stats.assumedN === 0, JSON.stringify(r.stats));
  t('hi table: account IDs are counted as names, not listed', !r.issues.some((i) => /employee|jeffadmin/.test(i.text) && i.verdict !== 'bad') && r.stats.nameN >= 5, JSON.stringify(r.stats));
  const w = await scan(loadNew(page('<main><p>यहाँ आपके सभी प्रशिक्षण सत्र और उनकी स्थिति दिखाई देती है।</p><p>ahora</p><p>cancelar</p><p>jeffadmin</p></main>', 'hi')), { lang: 'hi' });
  t('hi page: foreign words ("ahora", "cancelar") are still listed; only real IDs count as names', ['ahora', 'cancelar'].every((x) => w.issues.some((i) => i.text === x)) && !w.issues.some((i) => i.text === 'jeffadmin'), JSON.stringify(w.issues.map((i) => i.text)));
  const es = await scan(loadNew(page('<main><p>Texto traducido al español para la prueba de títulos en inglés.</p><p>Inventory Management</p><p>Wisight Mapping</p></main>', 'es')), { lang: 'es' });
  t('latin pages: English titles on a Spanish page are listed, never assumed translated', ['Inventory Management', 'Wisight Mapping'].every((x) => es.issues.some((i) => i.text === x)), JSON.stringify(es.issues.map((i) => [i.verdict, i.text])));
}

console.log(`\n2.0.6 features: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
