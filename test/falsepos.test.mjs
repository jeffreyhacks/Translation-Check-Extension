// False positives reported from real pages, plus guards that real problems are still caught.
import { loadBg, loadNew, page } from './harness.mjs';
import { impossible } from '../src/alphabet.js';
const send = loadBg();
let pass = 0, fail = 0;
const t = (n, c, x = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const judge = async (lang, text, sources = ['en']) => (await send({ type: 'tc-classify', lang, verify: true, ctx: { sources }, texts: [text] })).verdicts[0];

// 1. German text labelled Turkish (two models shared the same wrong guess)
for (const s of ['Ändert Menüs, Schaltflächen und den Text auf dem Bildschirm. Ändert nicht die Sprache der', 'Ändert Menüs', 'Ändert nicht die Sprache der']) {
  const v = await judge('de', s, ['tr', 'en']);
  t(`german fragment not flagged even when Turkish is a page language: "${s.slice(0, 30)}"`, v.v !== 'bad', JSON.stringify(v));
}
t('alphabet: ä is impossible in Turkish, fine in German', impossible('Ändert', 'tr') && !impossible('Ändert', 'de'));
t('alphabet: ñ is impossible in French', impossible('niño', 'fr') && !impossible('niño', 'es'));
t('alphabet: unknown languages give no opinion', !impossible('Ändert', 'xx'));
// 2. real foreign text is still caught
t('real Turkish on a German page is still flagged', (await judge('de', 'Sepete ekle ve alışverişe devam et')).v === 'bad');
t('real English on a German page is still flagged', (await judge('de', 'Manage scenarios, personas and system configuration')).v === 'bad');
t('real French on a German page is still flagged', (await judge('de', 'Gérez les scénarios, les personas et la configuration du système')).v === 'bad');

// 3. French/English cognates with source comparison on
const FR = `<h1>Gestion des comptes</h1><p>Gérez vos scénarios, vos personas et la configuration du système pour toute votre équipe.</p>
<p>Chaque session est enregistrée automatiquement et vous pouvez consulter les rapports à tout moment.</p>
<table><tr><td>Active</td><td>Archive</td></tr><tr><td>Active archive</td><td>Archives</td></tr><tr><td>Message</td><td>Section</td></tr></table>
<button>Active</button><button>Archive</button><p>Learn more about our products and services for your team</p>`;
const EN = '<html lang="en"><body><p>Active</p><p>Archive</p><p>Active archive</p><p>Archives</p><p>Message</p><p>Section</p><p>Learn more about our products and services for your team</p></body></html>';
const h = loadNew(page(FR, 'fr', '<link rel="alternate" hreflang="en" href="https://www.acmecloud.io/en/">'), { fetchMap: { 'https://www.acmecloud.io/en/': EN } });
const r = await h.call({ type: 'scan', lang: 'fr', attrs: true, unsure: true, mode: 'balanced', source: true, live: false });
const bad = r.issues.filter((i) => i.verdict === 'bad').map((i) => i.text);
t('cognates "active", "archive", "Active archive", "Archives", "Message" are not untranslated', !bad.some((x) => /^(Active|Archive|Active archive|Archives|Message|Section)$/.test(x)), JSON.stringify(bad));
t('a genuinely English sentence IS still flagged, with the source page as evidence', bad.some((x) => /Learn more about our products/.test(x)), JSON.stringify(bad));
// 4. language names in a language switcher
const sw = loadNew(page(`<p>Willkommen im Shop, hier finden Sie alles für Ihr Zuhause und Ihre Familie.</p><ul><li>English</li><li>Turkish</li><li>German</li><li>Türkçe</li><li>Español</li><li>Français</li></ul>`, 'de'));
const rs = await sw.call({ type: 'scan', lang: 'de', attrs: true, unsure: true, mode: 'strict', source: false, live: false });
t('language switcher entries (English, Turkish, German, Türkçe, Español…) are ignored', rs.issues.length === 0 && rs.score === 100, JSON.stringify(rs.issues.map((i) => i.text)));
console.log(`\nfalse-positive guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
