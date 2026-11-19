import { loadNew, sleep, page } from './harness.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const scan = (h, o = {}) => h.call({ type: 'scan', lang: 'es', attrs: true, unsure: true, mode: 'balanced', source: false, live: false, ...o });
const hasMark = (w, kind) => [...w.CSS.highlights._m.keys()].some((k) => new RegExp(`^tc2-[a-z0-9]{6}-${kind}$`).test(k)); // this copy's own marks
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
  t('bug: highlight registered', hasMark(h.w, 'bug'));
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
  t('shadow DOM: style injected into shadow root', !!sr.querySelector('style[data-tc2-style]'));
  await h.call({ type: 'clear' });
  t('shadow DOM: clear removes injected style', !sr.querySelector('style[data-tc2-style]'));
}
// 3. Same-origin iframe ----------------------------------------------------------
{
  const h = loadNew(page(SP + `<iframe id="f"></iframe>`, 'es'));
  const f = h.w.document.getElementById('f'), fw = f.contentWindow;
  fw.Element.prototype.checkVisibility = () => true;
  fw.CSS = { highlights: { _m: new Map(), set(k, v) { this._m.set(k, v); }, delete(k) { this._m.delete(k); }, keys() { return this._m.keys(); } } };
  fw.Highlight = class { constructor(...r) { this.s = new Set(r); } add(r) { this.s.add(r); } get size() { return this.s.size; } };
  f.contentDocument.body.innerHTML = `<p>Free shipping on all orders over fifty dollars today.</p><p>Gracias por su compra en nuestra tienda.</p>`;
  const r = await scan(h);
  t('iframe: English text in same-origin frame flagged', r.issues.some((i) => i.verdict === 'bad' && /Free shipping/.test(i.text)), JSON.stringify(r.issues.map((i) => i.text)));
  t('iframe: highlight registered in the frame\'s own window', hasMark(fw, 'bad'));
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
  t('clear: no stray attributes', !h.w.document.querySelector('[data-tc-flag],[data-tc2-flag]'));
}
// 8. Format hints ----------------------------------------------------------------
{
  const h = loadNew(page(`<p>Gesamtzahl der Nutzer weltweit: 1,234,567</p><p>Preis nur €49.99 im Angebot</p><p>Lieferung am 25/11/2026 garantiert</p><p>Vielen Dank für Ihre Bestellung bei uns.</p>`, 'de'));
  const on = await scan(h, { lang: 'de', hints: true });
  t('hints: number, price and date hints produced', on.issues.filter((i) => i.verdict === 'fmt').length === 3, JSON.stringify(on.issues.filter((i) => i.verdict === 'fmt').map((i) => i.reason)));
  t('hints: do not affect the score', on.stats.badN === 0 && on.score === 100, JSON.stringify(on.stats));
  const off = await scan(h, { lang: 'de', hints: false });
  // number and price hints need Format hints; date and time formats are checked on every scan
  const offFmt = off.issues.filter((i) => i.verdict === 'fmt').map((i) => i.reason);
  t('hints: number and price hints are off by default, date hints are always on', offFmt.length === 1 && /^Date written with/.test(offFmt[0]), JSON.stringify(offFmt));
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
// 10b. "Page's own language" + the German page from the bug report -----------------------------------------
{
  const h = loadNew(page(SP, 'es'));
  const r = await scan(h, { lang: 'auto' });
  t('auto language: resolves to the page\'s lang attribute', r.lang === 'es' && r.requested === 'auto', JSON.stringify([r.lang, r.requested]));
  const none = await scan(loadNew('<html><body><p>Hola mundo, esto es una prueba</p></body></html>'), { lang: 'auto' });
  t('auto language: clear error when the page declares no language', typeof none.error === 'string' && /declare/i.test(none.error));
  const DE = `<h1>Globale Sitzungsverlauf</h1><p>Verwalten Sie Szenarien, Personas, Rubriken und Systemkonfiguration</p><p>Erstellen und verwalten Sie Schulungsszenarien</p>
    <p>Inhalte im Admin Playground validieren</p><table><tr><td>Anfrage zu Versand-/Lieferverzögerungen</td><td>12. Nov. 2026</td><td>1/1 Abgeschlossen</td></tr>
    <tr><td>Beschwerde über fehlerhaftes Gerät</td><td>3. Nov. 2026</td><td>0/7 Abgeschlossen</td></tr><tr><td>Umgang mit Preiswiderstand</td><td>29. Okt. 2026</td></tr></table>
    <button>Bericht anzeigen</button><a>Fragen Sie den Leitfaden</a><p>Versuche ein Szenario, eine Persona und ein Bewertungsraster zusammen, bevor du die Trainees zuweist.</p>`;
  const right = await scan(loadNew(page(DE, 'de')), { lang: 'de' });
  t('German page, target German: no false positives', right.stats.badN === 0 && right.score === 100, JSON.stringify(right.issues.map((i) => i.text)));
  const wrongT = await scan(loadNew(page(DE, 'de')), { lang: 'en' });
  t('German page, target English: flagged as German (banner case)', wrongT.stats.badN >= 6 && wrongT.issues.filter((i) => i.verdict === 'bad').every((i) => i.detected === 'de'), JSON.stringify(wrongT.issues.map((i) => i.detected)));
}
// 10c. False-positive regressions: cognates, short words, misleading labels, source comparison ----------------
{
  const FRP = `<h2>Gestion des projets</h2><p>Ici vous pouvez gérer vos projets, inviter des membres et consulter les statistiques de votre équipe.</p>
    <div><button>Active</button><button>Archive</button><button>Contact actif</button><button>Statut</button><button>Mobile</button><button>Export</button><button>Account</button></div>
    <ul><li>Projet Alpha <span>Active</span></li><li>Projet Beta <span>Archive</span></li></ul>`;
  const alt = '<link rel="alternate" hreflang="tr" href="https://www.acmecloud.io/tr/"><link rel="alternate" hreflang="de" href="https://www.acmecloud.io/de/"><link rel="alternate" hreflang="en" href="https://www.acmecloud.io/en/">';
  const SHELL = '<html lang="en"><body><button>Active</button><button>Archive</button><button>Export</button><button>Messages</button><p>Manage your projects here.</p></body></html>';
  const fm = { 'https://www.acmecloud.io/en/': SHELL, 'https://www.acmecloud.io/tr/': SHELL, 'https://www.acmecloud.io/de/': SHELL };
  for (const mode of ['balanced', 'strict']) {
    const r = await scan(loadNew(page(FRP, 'fr', alt), { fetchMap: fm }), { lang: 'fr', mode, source: true });
    t(`false positives (${mode}): French cognates (Active, Archive, Contact actif, Statut, Mobile, Export, Account) are never "untranslated"`, r.stats.badN === 0, JSON.stringify(r.issues.filter((i) => i.verdict === 'bad').map((i) => [i.text, i.detected])));
  }
  const DE = `<p>Ändert Menüs, Schaltflächen und den Text auf dem Bildschirm. Ändert nicht die Sprache der <b>Antworten</b>.</p><p>Verwalten Sie Ihre Projekte und laden Sie Mitglieder ein, um gemeinsam zu arbeiten.</p><button>Aktiv</button><button>Archiv</button>`;
  const hreflangTr = '<link rel="alternate" hreflang="tr" href="https://www.acmecloud.io/tr/"><link rel="alternate" hreflang="fr" href="https://www.acmecloud.io/fr/">';
  const asTarget = await scan(loadNew(page(DE, 'de', hreflangTr), { fetchMap: fm }), { lang: 'de', source: true });
  t('false positives: a German page checked as German has no warnings even with Turkish/French alternates listed', asTarget.stats.badN === 0, JSON.stringify(asTarget.issues));
  t('source comparison never uses a non-English alternate (hreflang "tr" first) as the source', asTarget.source.status === 'none', JSON.stringify(asTarget.source));
  const wrong = await scan(loadNew(page(DE, 'de', hreflangTr), { fetchMap: fm }), { lang: 'fr' });
  const labels = wrong.issues.filter((i) => i.verdict === 'bad').map((i) => i.detected);
  t('labels: German text on a French target is labelled German — never Turkish', labels.length >= 1 && labels.every((l) => l === 'de'), JSON.stringify(labels));
  const cog = loadNew(page(`<p>Bienvenue dans notre boutique en ligne, vous y trouverez tout pour la maison et la famille.</p><button>Messages</button><button>Standard</button><button>Document</button>`, 'fr', alt), { fetchMap: fm });
  const rc = await scan(cog, { lang: 'fr', mode: 'strict', source: true });
  t('source comparison: short words identical in both languages (Messages, Standard, Document) are not "untranslated"', rc.stats.badN === 0, JSON.stringify(rc.issues.filter((i) => i.verdict === 'bad')));
  const real = await scan(loadNew(page(`<p>Bienvenue dans notre boutique en ligne, vous y trouverez tout pour la maison et la famille.</p><button>Save changes</button><p>Welcome back to your dashboard, here is everything new.</p>`, 'fr', alt), { fetchMap: fm }), { lang: 'fr', source: true });
  t('recall kept: real English ("Save changes", a sentence) is still flagged on that French page', real.issues.filter((i) => i.verdict === 'bad').length >= 2, JSON.stringify(real.issues.map((i) => [i.verdict, i.text])));
}
// 11. Big page stays quick ---------------------------------------------------------
{
  const body = Array.from({ length: 4000 }, (_, i) => `<p>${i % 4 === 0 ? 'Our best sellers number ' + i + ' are shipping this week with free delivery' : 'Envío gratis en todos los pedidos superiores a cincuenta euros número ' + i}</p>`).join('');
  const h = loadNew(page(body, 'es'));
  const t0 = Date.now(); const r = await scan(h); const ms = Date.now() - t0;
  t(`big page: 4000 paragraphs checked in ${ms} ms`, !r.error && r.stats.badN >= 900 && ms < 15000, `badN=${r.stats?.badN} ms=${ms}`);
}
// 10d. Marks left behind by an older copy of the extension (still running in a tab that was not reloaded after an update) ----------------
{
  const plant = (h) => { // what versions up to 2.1.2 put on a page, planted from outside this script
    const d = h.w.document, hl = h.w.CSS.highlights, p = d.querySelector('p');
    const st = d.createElement('style'); st.id = 'tc-style'; st.textContent = '::highlight(tc-bad){background:yellow}'; d.head.append(st);
    const r = d.createRange(); r.selectNodeContents(p);
    hl.set('tc-bad', new h.w.Highlight(r)); hl.set('tc-unsure', new h.w.Highlight(r)); hl.set('search-hit', new h.w.Highlight(r)); // the last one is the page's own
    p.setAttribute('data-tc-flag', 'bad'); d.querySelector('h1').setAttribute('data-tc-focus', '');
  };
  const left = (h) => ({ keys: [...h.w.CSS.highlights._m.keys()].filter((k) => /^tc-/.test(k)), style: h.w.document.querySelectorAll('style#tc-style').length, flag: h.w.document.querySelectorAll('[data-tc-flag="bad"]').length, focus: h.w.document.querySelectorAll('[data-tc-focus=""]').length });
  const html = page(`<h1>Bienvenidos a la tienda</h1>` + SP, 'es');
  {
    const h = loadNew(html); plant(h);
    const r = await scan(h, { live: true });
    const l = left(h);
    t('stale marks: a clean page is reported 100% yet the old highlights are removed', r.score === 100 && !l.keys.length && !l.style && !l.flag && !l.focus, JSON.stringify({ score: r.score, ...l }));
    t('stale marks: the page\'s own highlights are left alone', h.w.CSS.highlights._m.has('search-hit'));
    plant(h); h.w.document.body.insertAdjacentHTML('beforeend', '<p>Gracias por su visita a nuestra tienda.</p>'); await sleep(1600); // the old script re-asserting its marks when the page changes
    const l2 = left(h);
    t('stale marks: removed again on the next live refresh', !l2.keys.length && !l2.style && !l2.flag, JSON.stringify(l2));
  }
  {
    const h = loadNew(html); plant(h);
    await scan(h); plant(h); await h.call({ type: 'clear' });
    const l = left(h);
    t('stale marks: Clear removes them too', !l.keys.length && !l.style && !l.flag && !l.focus, JSON.stringify(l));
  }
  {
    const h = loadNew(html); // a previous copy of THIS version: random private names
    const d = h.w.document, old = d.createElement('style'); old.setAttribute('data-tc-style', 'a1b2c3'); d.head.append(old);
    const r = d.createRange(); r.selectNodeContents(d.querySelector('p')); h.w.CSS.highlights.set('tc-a1b2c3-bad', new h.w.Highlight(r)); d.querySelector('h1').setAttribute('data-tc-flag', 'a1b2c3:bad');
    d.body.insertAdjacentHTML('beforeend', '<p>Our new model is shipping this week with free delivery for everyone.</p>');
    const res = await scan(h);
    const keys = [...h.w.CSS.highlights._m.keys()];
    t('stale marks: an earlier copy of this version is removed while the current marks stay', res.issues.some((i) => i.verdict === 'bad') && hasMark(h.w, 'bad') && !keys.includes('tc-a1b2c3-bad')
      && !d.querySelector('style[data-tc-style]') && d.querySelectorAll('style[data-tc2-style]').length === 1 && !d.querySelector('[data-tc-flag="a1b2c3:bad"]'), JSON.stringify(keys));
    const own = d.querySelector('style[data-tc2-style]').getAttribute('data-tc2-style');
    t('stale marks: this check\'s highlights are styled by its own style sheet', keys.some((k) => k.startsWith(own + '-bad')), own + ' ' + JSON.stringify(keys));
  }
}

console.log(`\nfeatures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
