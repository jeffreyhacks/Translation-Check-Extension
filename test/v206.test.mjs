// 2.0.6: grouped strings with their locations, context capture, learned ignore rules, spelling/spacing hints, layout check and stretch test.
// jsdom has no layout engine, so layout is measured here with stubbed boxes; test/e2e/layout.py checks it in real Chrome.
import { loadNew, page, sleep } from './harness.mjs';
import { JSDOM } from 'jsdom';
import * as learn from '../src/learn.js';
import { describe, slotOf } from '../src/context.js';
import { spellHints } from '../src/spell.js';
import { layoutProblem, stretchText } from '../src/layout.js';

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

// ---------- spelling / spacing ----------
{
  const hits = { 'Recieve updates from the team': 'typo', 'Save the the changes': 'repeat', 'Addto cart': 'join', 'Cancel,save or close': 'space', 'Done.Next step is review': 'space', 'Your session was succesful': 'typo' };
  for (const [s, type] of Object.entries(hits)) t(`spell: "${s}" -> ${type}`, spellHints(s, 'en').some((h) => h.type === type), JSON.stringify(spellHints(s, 'en')));
  const clean = ['Node.js, e.g. version 3.5', 'Welcome back, admin', 'Sign up for our newsletter', 'Roleplay trainer for HubSpot and Salesforce teams', 'Upskilling coachable reps',
    'Manage scenarios, personas, rubrics and system configuration', 'Had had enough', 'Login with SSO', 'Onboarding checklist', 'Katalyst Arena dashboard', 'Leaderboards'];
  t('spell: clean English gets no hints', clean.every((s) => !spellHints(s, 'en').length), JSON.stringify(clean.map((s) => spellHints(s, 'en'))));
  t('spell: other languages only get the spacing rules, never typos', !spellHints('Änderungen speichern', 'de').length && !spellHints('Velkommen tilbage', 'da').length && spellHints('Guardar,cancelar', 'es').some((h) => h.type === 'space'));
  t('spell: no-space scripts are skipped', !spellHints('設定を保存,設定', 'ja').length);
}
{
  const html = page(`<main><h1>Welcome to the dashboard</h1><p>Recieve weekly updates about your the the team performance.</p><button>Addto cart</button><p>Contact Maria Müller for help.</p></main>`, 'en');
  const r = await scan(loadNew(html), { lang: 'en' });
  const sp = r.issues.filter((i) => i.verdict === 'spell');
  t('page: spelling hints are found on translated text', sp.length >= 3 && sp.some((i) => i.fix === 'Receive') && sp.some((i) => i.hint === 'join'), JSON.stringify(sp.map((i) => [i.reason, i.fix])));
  t('page: spelling hints never change the score', r.score === 100 && r.stats.badN === 0, JSON.stringify(r.stats));
  const off = await scan(loadNew(html), { lang: 'en', spell: false });
  t('page: spelling can be switched off', !off.issues.some((i) => i.verdict === 'spell') && off.score === r.score);
  const es = await scan(loadNew(SHOP));
  t('page: untranslated text gets no spelling hints (it is already a warning)', !es.issues.some((i) => i.verdict === 'spell'));
}

// ---------- layout (stubbed boxes) ----------
{
  const w = new JSDOM(`<div id="box"><span id="s">A very long label that does not fit</span></div><div id="sc"><span id="t">Scrollable text here</span></div>`).window;
  const box = w.document.getElementById('box'), sc = w.document.getElementById('sc');
  const style = { box: { display: 'block', overflowX: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis' }, sc: { display: 'block', overflowX: 'auto', overflowY: 'hidden', textOverflow: 'clip' } };
  const real = w.getComputedStyle.bind(w);
  w.getComputedStyle = (e) => (e.id === 'box' ? style.box : e.id === 'sc' ? style.sc : { ...real(e), display: e.tagName === 'SPAN' ? 'inline' : 'block' });
  for (const [e, wd] of [[box, 100], [sc, 100]]) {
    Object.defineProperty(e, 'clientWidth', { get: () => wd }); Object.defineProperty(e, 'clientHeight', { get: () => 20 });
    e.getBoundingClientRect = () => ({ left: 0, top: 0, right: wd, bottom: 20, width: wd, height: 20 });
  }
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 180, bottom: 18, width: 180, height: 18 });
  const p = layoutProblem(w.document.getElementById('s').firstChild);
  t('layout: text wider than a clipping box is "cut off with …"', p && p.kind === 'clip' && p.ellipsis && p.px === 80, JSON.stringify(p));
  t('layout: a scroll area is never flagged', layoutProblem(w.document.getElementById('t').firstChild) === null);
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 90, bottom: 18, width: 90, height: 18 });
  t('layout: text that fits is fine', layoutProblem(w.document.getElementById('s').firstChild) === null);
  w.Range.prototype.getBoundingClientRect = () => ({ left: 300, top: 0, right: 480, bottom: 18, width: 180, height: 18 });
  t('layout: text entirely outside a clipping box (hidden slide) is not "cut"', layoutProblem(w.document.getElementById('s').firstChild) === null);
  t('layout: stretch keeps word breaks and lengthens by the percentage', stretchText('Save changes', 35) === 'Savesa changescha' && stretchText('OK', 35) === 'OKo');
}
{
  const html = page(`<main><p>Texto completamente traducido al español para la prueba.</p><button>Guardar cambios</button></main>`, 'es');
  const h = loadNew(html);
  await scan(h, { live: true });
  const before = h.w.document.body.innerHTML;
  const r = await h.call({ type: 'stretch', pct: 35 });
  await sleep(900);
  t('stretch: the page text is exactly restored', h.w.document.body.innerHTML === before);
  t('stretch: returns a full result (nothing breaks without a layout engine)', r && r.stats && r.stretched === 35 && r.stretchFound === 0, JSON.stringify(r && { s: r.stretched, f: r.stretchFound }));
  t('stretch: live mode does not re-check because of the test', h.bgCalls.results === 0, String(h.bgCalls.results));
  t('stretch: without a check first it says so', (await loadNew(html).call({ type: 'stretch', pct: 35 })).error === 'Run a check first.');
}

console.log(`\n2.0.6 features: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
