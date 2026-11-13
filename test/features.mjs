import { loadNew, sleep, page } from './harness.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'es', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });
const SP = `<p>Bienvenidos a nuestra tienda, aquí encontrarás todo lo que necesitas para tu hogar y tu familia.</p><p>Envío gratis en todos los pedidos superiores a cincuenta euros.</p>`;

// 1. Broken text -------------------------------------------------------------
{
  const h = loadNew(page(SP + `<span>checkout.button.save</span><span>Hola {{name}}</span><span>%s artículos</span><span>undefined</span><span>ERR_NOT_FOUND</span><p>Guardar cambios</p><p>docs.example.com</p>`, 'es'));
  const r = await scan(h);
  const bugs = r.issues.filter((i) => i.verdict === 'bug');
  t('bug: 5 broken strings found', bugs.length === 5, JSON.stringify(bugs.map((b) => b.text)));
  t('bug: domain name not flagged', !r.issues.some((i) => i.text === 'docs.example.com'));
  t('bug: broken strings excluded from score', r.score === 100, 'score ' + r.score);
  t('bug: badge counts broken text', h.bgCalls.badges.at(-1) === 5, JSON.stringify(h.bgCalls.badges));
  t('bug: highlight registered', h.w.CSS.highlights._m.has('tc-bug'));
  const off = await scan(h, { bugs: false });
  t('bug: can be switched off', !off.issues.some((i) => i.verdict === 'bug'));
}
// 2. Shadow DOM ----------------------------------------------------------------
{
  const h = loadNew(page(SP + `<div id="host"></div>`, 'es'));
  const sr = h.w.document.getElementById('host').attachShadow({ mode: 'open' });
  sr.innerHTML = `<p>Our best sellers are shipping this week with free delivery.</p><button>Add to cart</button><p>Todos los derechos reservados por la empresa.</p>`;
  const r = await scan(h);
  t('shadow DOM: English text inside shadow root flagged', r.issues.filter((i) => i.verdict === 'bad').length === 2, JSON.stringify(r.issues.map((i) => i.text)));
  t('shadow DOM: style injected into shadow root', !!sr.querySelector('#tc-style'));
  await h.call({ type: 'clear' });
  t('shadow DOM: clear removes injected style', !sr.querySelector('#tc-style'));
}
// 3. Same-origin iframe ----------------------------------------------------------
{
  const h = loadNew(page(SP + `<iframe id="f"></iframe>`, 'es'));
  const f = h.w.document.getElementById('f'), fw = f.contentWindow;
  fw.Element.prototype.checkVisibility = () => true;
  fw.CSS = { highlights: { _m: new Map(), set(k, v) { this._m.set(k, v); }, delete(k) { this._m.delete(k); } } };
  fw.Highlight = class { constructor(...r) { this.s = new Set(r); } add(r) { this.s.add(r); } get size() { return this.s.size; } };
  f.contentDocument.body.innerHTML = `<p>Free shipping on all orders over fifty dollars today.</p><p>Gracias por su compra en nuestra tienda.</p>`;
  const r = await scan(h);
  t('iframe: English text in same-origin frame flagged', r.issues.some((i) => i.verdict === 'bad' && /Free shipping/.test(i.text)), JSON.stringify(r.issues.map((i) => i.text)));
  t('iframe: highlight registered in the frame\'s own window', fw.CSS.highlights._m.has('tc-bad'));
}
// 4. Live updates ----------------------------------------------------------------
{
  const h = loadNew(page(SP + `<div id="box"></div>`, 'es'));
  const r0 = await scan(h, { live: true });
  t('live: observing after scan', r0.live === true);
  const before = h.bgCalls.results;
  const box = h.w.document.getElementById('box');
  box.innerHTML = '<p id="np">Our new model is shipping this week with free delivery for everyone.</p>';
  await sleep(1600);
  t('live: new English text detected without rescanning the page', h.bgCalls.results > before && h.bgCalls.lastResult.issues.some((i) => /new model/.test(i.text)), 'results=' + h.bgCalls.results);
  box.innerHTML = '';
  await sleep(1600);
  t('live: removed text disappears from results', !h.bgCalls.lastResult.issues.some((i) => /new model/.test(i.text)));
  t('live: badge updated to 0', h.bgCalls.badges.at(-1) === 0, JSON.stringify(h.bgCalls.badges));
  box.textContent = 'Texto traducido correctamente en español para todos los usuarios.';
  await sleep(1600);
  t('live: translated text added later is judged ok', !h.bgCalls.lastResult.issues.some((i) => /Texto traducido/.test(i.text)));
}
// 5. Verdict cache ---------------------------------------------------------------
{
  const h = loadNew(page(SP + `<p>Our best sellers are shipping this week.</p><button>Add to cart</button>`, 'es'));
  await scan(h); const first = h.bgCalls.classify;
  await scan(h); const second = h.bgCalls.classify - first;
  t('cache: second scan needs far fewer engine calls', second < first && second <= 1, `first=${first} second=${second}`);
}
// 6. Source-language comparison ---------------------------------------------------
{
  const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';
  const FR = `<p>Bienvenue dans notre boutique en ligne, vous y trouverez tout pour la maison et la famille.</p><p>Livraison gratuite pour toute commande supérieure à cinquante euros.</p><p>Nous livrons partout en France sous trois jours ouvrés.</p><p>${LOREM}</p>`;
  const html = page(FR, 'fr', '<link rel="alternate" hreflang="en" href="https://www.acmecloud.io/en/"><link rel="alternate" hreflang="fr" href="https://www.acmecloud.io/fr/">');
  const EN = `<html lang="en"><body><p>Welcome to our online shop where you will find everything for home and family.</p><p>${LOREM}</p></body></html>`;
  const without = await scan(loadNew(html, { fetchMap: { 'https://www.acmecloud.io/en/': EN } }), { lang: 'fr', mode: 'strict' });
  const withS = await scan(loadNew(html, { fetchMap: { 'https://www.acmecloud.io/en/': EN } }), { lang: 'fr', mode: 'strict', source: true });
  const lw = (r) => r.issues.find((i) => i.text === LOREM);
  t('source: without it the text is only "can\'t tell"', lw(without)?.verdict === 'unsure', JSON.stringify(lw(without)));
  t('source: identical-to-source text is flagged', lw(withS)?.verdict === 'bad' && /source-language/.test(lw(withS).reason), JSON.stringify(lw(withS)));
  t('source: reports which page was used', withS.source.status === 'used' && withS.source.lang === 'en');
  const down = await scan(loadNew(html, { fetchMap: {} }), { lang: 'fr', mode: 'strict', source: true });
  t('source: unreachable page is handled quietly', down.source.status === 'unavailable' && lw(down)?.verdict === 'unsure');
  const sameLang = `<html lang="fr"><body><p>${LOREM}</p><p>Bienvenue dans notre boutique en ligne.</p></body></html>`;
  const same = await scan(loadNew(html, { fetchMap: { 'https://www.acmecloud.io/en/': sameLang } }), { lang: 'fr', mode: 'strict', source: true });
  t('source: page that is already in the target language is ignored', same.source.status === 'same-language' && lw(same)?.verdict === 'unsure', JSON.stringify(same.source));
}
// 7. Export + focus + clear + badge ---------------------------------------------
{
  const h = loadNew(page(SP + `<ul id="menu"><li>Add to cart</li><li>Sign in</li></ul><span>checkout.button.save</span>`, 'es'));
  const r = await scan(h);
  const ex = await h.call({ type: 'export' });
  t('export: every issue has a CSS selector', ex.issues.length === r.issues.length && ex.issues.every((i) => i.selector), JSON.stringify(ex.issues.map((i) => i.selector)));
  t('export: selectors point at the right element', ex.issues.some((i) => i.selector.includes('#menu') && i.selector.includes('li')));
  t('focus: returns ok for a valid issue', (await h.call({ type: 'focus', id: r.issues[0].id })).ok === true);
  t('focus: returns false for an unknown issue', (await h.call({ type: 'focus', id: 9999 })).ok === false);
  await h.call({ type: 'clear' });
  t('clear: highlights removed', h.w.CSS.highlights._m.size === 0);
  t('clear: badge reset', h.bgCalls.badges.at(-1) === 0);
  t('clear: no stray attributes', !h.w.document.querySelector('[data-tc-flag]'));
}
// 8. Format hints ----------------------------------------------------------------
{
  const h = loadNew(page(`<p>Gesamtzahl der Nutzer weltweit: 1,234,567</p><p>Preis nur €49.99 im Angebot</p><p>Lieferung am 25/11/2026 garantiert</p><p>Vielen Dank für Ihre Bestellung bei uns.</p>`, 'de'));
  const on = await scan(h, { lang: 'de', hints: true });
  t('hints: number, price and date hints produced', on.issues.filter((i) => i.verdict === 'fmt').length === 3, JSON.stringify(on.issues.filter((i) => i.verdict === 'fmt').map((i) => i.reason)));
  t('hints: do not affect the score', on.stats.badN === 0 && on.score === 100, JSON.stringify(on.stats));
  const off = await scan(h, { lang: 'de', hints: false });
  t('hints: off by default', !off.issues.some((i) => i.verdict === 'fmt'));
}
// 9. Auto-check on opted-in sites -------------------------------------------------
{
  const html = page(SP + `<p>Our best sellers are shipping this week with free delivery.</p>`, 'es');
  const on = loadNew(html, { storage: { opts: { lang: 'es', attrs: true, unsure: true }, autoSites: ['www.acmecloud.io'] } });
  await sleep(2200);
  const s = await on.call({ type: 'status' });
  t('auto: opted-in site is checked automatically', s.result && s.result.issues.some((i) => /best sellers/.test(i.text)), JSON.stringify(s.result && s.result.stats));
  const off = loadNew(html, { storage: { opts: { lang: 'es' }, autoSites: ['other.com'] } });
  await sleep(2200);
  t('auto: other sites are left alone', (await off.call({ type: 'status' })).result == null);
}
// 10. Engine unavailable -----------------------------------------------------------
{
  const h = loadNew(page(SP, 'es'));
  h.w.chrome.runtime.sendMessage = () => Promise.resolve(undefined);
  const r = await scan(h);
  t('failure: unreachable engine gives a clear error, not a crash', typeof r.error === 'string' && /engine/i.test(r.error), JSON.stringify(r).slice(0, 100));
}
// 11. Big page stays quick ---------------------------------------------------------
{
  const body = Array.from({ length: 4000 }, (_, i) => `<p>${i % 4 === 0 ? 'Our best sellers number ' + i + ' are shipping this week with free delivery' : 'Envío gratis en todos los pedidos superiores a cincuenta euros número ' + i}</p>`).join('');
  const h = loadNew(page(body, 'es'));
  const t0 = Date.now(); const r = await scan(h); const ms = Date.now() - t0;
  t(`big page: 4000 paragraphs checked in ${ms} ms`, !r.error && r.stats.badN >= 900 && ms < 15000, `badN=${r.stats?.badN} ms=${ms}`);
}
console.log(`\nfeatures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
