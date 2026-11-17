// Names, labels and the "two models agree" rule, end to end: the real worker (tinyld + CLD3 + franc) and a real page scan.
import { loadBg, loadNew } from './harness.mjs';
import { knownName, nameShape, isLabel } from '../src/names.js';
import { mask } from '../src/mask.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const send = loadBg();
const LANGS = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'pl', 'tr'];
const tally = (rs) => rs.reduce((m, r) => ((m[r.v] = (m[r.v] || 0) + 1), m), {});

async function run(lang, list) {
  const ms = list.map((s) => ({ s, ...mask(s, lang, null) })).filter((m) => /\p{L}{2}/u.test(m.text));
  const r = await send({ type: 'tc-classify', lang, verify: true, related: true, texts: ms.map((m) => m.text), ctxTexts: [], ctx: { sources: ['en'] } });
  return ms.map((m, i) => ({ lang, text: m.text, nameLike: m.nameLike, ...r.verdicts[i] }));
}
// What the page script does with a warning on something name-shaped (pass 1 in content.src.js)
const shown = (r) => (r.v === 'bad' && r.nameLike && !r.label && r.reason !== 'Looks like English text' ? 'unsure' : r.v);
const all = async (list) => (await Promise.all(LANGS.map((l) => run(l, list)))).flat();

// 1) the name lists ------------------------------------------------------------------------------------------------------------------
const KNOWN = { person: ['Maria Gonzalez', 'Hans Müller', 'Jane Doe', 'Anna Kowalska', 'Jean Dupont', 'Ahmed Hassan', 'Olga Petrova', 'Sakura Tanaka', 'Ludwig van Beethoven', 'Pedro Alvarez'],
  place: ['Berlin', 'New York', 'São Paulo', 'Rio de Janeiro', 'Zürich', 'Mount Everest', 'Valencia', 'Los Angeles'], brand: ['GitHub Actions', 'Acme Cloud', 'Google Cloud', 'Spotify'] };
for (const [kind, list] of Object.entries(KNOWN)) {
  const bad = list.filter((x) => knownName(x) !== kind);
  t(`built-in lists: ${kind} names are recognised`, !bad.length, JSON.stringify(bad.map((x) => [x, knownName(x)])));
}
t('built-in lists: ordinary labels are not names', ['Order History', 'Gift Cards', 'Wish List', 'Mein Konto', 'Save changes', 'Special Offers', 'Contact us'].every((x) => !knownName(x)));
t('built-in lists: a lone surname is too ambiguous to call a name', knownName('Smith') === null && knownName('Schmidt') === null);
t('built-in lists: lowercase text is never a name', knownName('maria gonzalez') === null && knownName('hans müller') === null);
t('built-in lists: a name followed by a plain word is not a name ("Maria Orders")', knownName('Maria Orders') === null);
t('shape: "Katalyst" and "Zofia Nowicka" are shaped like names, "Order History" and "Mein Konto" are not names', nameShape('Katalyst') && nameShape('Zofia Nowicka') && !nameShape('Mein Konto') && !nameShape('Order History'));
t('labels: plain interface words are a label, a name is not', isLabel('Order History') && isLabel('Wish List') && !isLabel('Lumenta Health') && !isLabel('Zofia Nowicka'));

// 2) names through the real checker --------------------------------------------------------------------------------------------------
const KNOWN_NAMES = ['Maria Gonzalez', 'John Smith', 'Hans Müller', 'Anna Kowalska', 'Jean Dupont', 'Giuseppe Verdi', 'Berlin', 'São Paulo', 'Deutsche Bank', 'Ahmed Hassan', 'Olga Petrova',
  'Jane Doe', 'Zürich', 'Elena Rossi', 'Pedro Alvarez', 'Sakura Tanaka', 'Rio de Janeiro', 'Lisa Meyer'];
let rs = await all(KNOWN_NAMES);
console.log('known names      ', rs.length, JSON.stringify(tally(rs)));
t('names: people, places and brands are never a warning and never "unclear"', rs.every((r) => r.v === 'name' || r.v === 'ok'), JSON.stringify(rs.filter((r) => r.v !== 'name' && r.v !== 'ok').map((r) => [r.lang, r.text, r.v])));
t('names: most of them get their own verdict (the rest are already read as translated)', rs.filter((r) => r.v === 'name').length >= rs.length * 0.6, JSON.stringify(tally(rs)));

const HELD_OUT = ['Zofia Nowicka', 'Tomasz Wrona', 'Anneliese Brandt', 'Ingvar Solheim', 'Sinead Murphy', 'Rashid Al Farouq', 'Yusra Haddad', 'Lorenzo Bellandi', 'Marguerite Vasseur', 'Anton Kessler',
  'Piotr Wiśniewski', 'Elif Karaca', 'Dagmar Hoffer', 'Giulia Ferraro', 'Joaquín Ortega', 'Nils Eklund', 'Katarzyna Mazur', 'Olivier Brassard', 'Thabo Mokoena', 'Aiko Matsuda',
  'Veridian Capital', 'Quorex', 'Lumenta Health', 'Brightwave', 'Kestrel Analytics', 'Northwind Traders', 'Alderbrook', 'Pinecrest', 'Harborview', 'Westmere', 'Bellaluna', 'Cervino', 'Montefiore',
  'Saint-Étienne', 'Garmisch-Partenkirchen', 'Wolfsburg', 'Tarragona', 'Rovaniemi', 'Trondheim', 'Krasnodar'];
rs = await all(HELD_OUT);
const eff = tally(rs.map((r) => ({ v: shown(r) })));
console.log('unseen names     ', rs.length, JSON.stringify(tally(rs)), 'as shown:', JSON.stringify(eff));
t('names never seen before: none ends up as a warning (the page script keeps name-shaped warnings unclear)', !eff.bad, JSON.stringify(rs.filter((r) => shown(r) === 'bad').map((r) => [r.lang, r.text])));
t('names never seen before: a good share gets the name verdict or is read as translated, fewer are left unclear', (eff.name || 0) + (eff.ok || 0) >= rs.length * 0.5, JSON.stringify(eff));

// 3) interface labels are NOT names ------------------------------------------------------------------------------------------------
const LABELS = ['Order History', 'Gift Cards', 'Account Settings', 'Payment Methods', 'Shipping Address', 'Customer Reviews', 'Best Sellers', 'Top Rated', 'New Arrivals', 'Size Guide', 'Track Order', 'Wish List',
  'Saved Items', 'Recent Orders', 'Help Center', 'Return Policy', 'Store Locator', 'Product Details', 'Special Offers', 'Join Today'];
rs = await all(LABELS);
console.log('English labels   ', rs.length, JSON.stringify(tally(rs)));
t('labels: an English label is never taken for a name', !rs.some((r) => r.v === 'name'), JSON.stringify(rs.filter((r) => r.v === 'name').map((r) => [r.lang, r.text])));
t('labels: most English labels on a translated page are flagged (they were mostly "unclear" before)', rs.filter((r) => r.v === 'bad').length >= rs.length * 0.6, JSON.stringify(tally(rs)));
t('labels: hardly any is read as translated', (tally(rs).ok || 0) <= rs.length * 0.03, JSON.stringify(tally(rs)));

// 4) translated words that look like English must still be safe ---------------------------------------------------------------------
const TRANSLATED = {
  fr: ['Archives actives', 'Service client', 'Centre d’aide', 'Informations personnelles', 'Programme actif', 'Contact général', 'Mode sombre', 'Notifications actives', 'Page d’accueil', 'Gestion des utilisateurs', 'Équipe produit', 'Option avancée', 'Rapport mensuel', 'Statut actuel', 'Document final', 'Version mobile', 'Archives', 'Active', 'Archive', 'Message', 'Actif', 'Section'],
  de: ['Aktive Projekte', 'Mein Konto', 'Neue Version', 'Persönliche Daten', 'Allgemeine Einstellungen', 'Aktuelle Informationen', 'Neue Nachrichten', 'Weitere Optionen', 'Mobile Version', 'Zahlungsarten', 'Letzte Bestellungen', 'Beste Angebote', 'Pläne', 'Export', 'Archiv', 'Position'],
  es: ['Mi cuenta', 'Información general', 'Centro de ayuda', 'Perfil de usuario', 'Informe mensual', 'Plan activo', 'Contacto directo', 'Opciones avanzadas', 'Archivo activo', 'Página principal', 'Notificaciones recientes', 'Mensaje nuevo'],
  it: ['Il mio account', 'Informazioni generali', 'Centro assistenza', 'Profilo utente', 'Rapporto mensile', 'Piano attivo', 'Contatto diretto', 'Opzioni avanzate', 'Archivio attivo', 'Pagina principale', 'Ordini recenti', 'Messaggio nuovo'],
  pt: ['Minha conta', 'Informação geral', 'Centro de ajuda', 'Perfil de usuário', 'Relatório mensal', 'Plano ativo', 'Contato direto', 'Opções avançadas', 'Arquivo ativo', 'Página principal', 'Pedidos recentes', 'Mensagem nova'],
  nl: ['Mijn account', 'Algemene informatie', 'Helpcentrum', 'Gebruikersprofiel', 'Maandelijks rapport', 'Actief plan', 'Directe contact', 'Geavanceerde opties', 'Actief archief', 'Hoofdpagina', 'Recente bestellingen', 'Nieuw bericht', 'Privé', 'Account'],
  tr: ['Görsel', 'Sayfa', 'Aktif', 'Arşiv', 'Yönetici', 'Standart'],
  pl: ['Tryb', 'Wersja', 'Ustawienia ogólne', 'Moje konto'],
};
rs = (await Promise.all(Object.entries(TRANSLATED).map(([l, list]) => run(l, list)))).flat();
console.log('translated labels', rs.length, JSON.stringify(tally(rs)));
t('translated look-alikes: none is flagged as untranslated', !rs.some((r) => r.v === 'bad'), JSON.stringify(rs.filter((r) => r.v === 'bad').map((r) => [r.lang, r.text, r.reason])));
t('translated look-alikes: none is mistaken for a name (a German noun phrase, a French "Archives actives")', !rs.some((r) => r.v === 'name'), JSON.stringify(rs.filter((r) => r.v === 'name').map((r) => [r.lang, r.text])));

// 5) the "two models agree" rule on short strings ----------------------------------------------------------------------------------
const one = async (lang, text) => (await run(lang, [text]))[0];
let v = await one('de', 'Order History');
t('two models agree on a two-word English label -> untranslated, said to be confirmed', v.v === 'bad' && v.confirmed === true, JSON.stringify(v));
v = await one('de', 'Export');
t('one word valid in both languages ("Export") is never settled by models agreeing', v.v !== 'bad', JSON.stringify(v));
v = await one('nl', 'Account');
t('...nor "Account" in Dutch', v.v !== 'bad', JSON.stringify(v));
v = await one('fr', 'Archives actives');
t('a phrase with a word the target language also claims ("Archives actives") is not flagged', v.v !== 'bad', JSON.stringify(v));
v = await one('de', 'Pläne');
t('English "agreement" resting on accented letters ("Pläne") does not count', v.v !== 'bad', JSON.stringify(v));
v = await one('de', 'Eliminar todo');
t('two models agree a short phrase is Spanish on a German page -> untranslated, labelled Spanish', v.v === 'bad' && v.detected === 'es', JSON.stringify(v));
v = await one('es', 'Mi cuenta');
t('two models agree a short phrase IS the target language -> translated', v.v === 'ok', JSON.stringify(v));
v = await one('de', 'Mein Konto');
t('a German label is not flagged on a German page', v.v === 'ok' || v.v === 'unsure', JSON.stringify(v));

// 6) a real page ---------------------------------------------------------------------------------------------------------------------
const PAGE = `<html lang="fr"><body><h1>Gestion des comptes</h1><p>Gérez vos scénarios, vos personas et la configuration du système pour toute votre équipe.</p>
<p>Chaque session est enregistrée automatiquement et vous pouvez consulter les rapports à tout moment.</p>
<ul><li>Maria Gonzalez</li><li>Hans Müller</li><li>Zürich</li><li>New York</li><li>GitHub Actions</li><li>Jean Dupont</li></ul>
<p>Merci pour votre visite, nous serons ravis de vous accueillir de nouveau très bientôt.</p></body></html>`;
const h = loadNew(PAGE);
const r = await h.call({ type: 'scan', lang: 'fr', attrs: true, unsure: true, mode: 'strict', source: false, live: false });
t('page: names are counted, not highlighted', r.stats.nameN >= 1 && !r.issues.some((i) => /Maria|Müller|Zürich|New York|Dupont/.test(i.text)), JSON.stringify({ stats: r.stats, issues: r.issues.map((i) => i.text) }));
t('page: names do not lower the score or add warnings', r.score === 100 && r.stats.badN === 0, JSON.stringify({ score: r.score, bad: r.stats.badN }));
t('page: names are not counted as "unclear" either', r.stats.unsureN === 0, JSON.stringify(r.stats));

// Persona names on a Malaysian app (single first names, Malay names, a title + name), on French and on German pages
{
  const people = ['Lou', 'Alex', 'Alex Rivera', 'Rosli', 'Senior Commander Rosli', 'Priya', 'Siti', 'Nurul Huda', 'Aisha Rahman', 'Ahmad Faiz'];
  for (const lang of ['fr', 'de']) {
    const res = await send({ type: 'tc-classify', lang, texts: people.map((x) => mask(x, lang).text), ctxTexts: [] });
    const left = people.filter((x, i) => res.verdicts[i].v !== 'name' && res.verdicts[i].v !== 'ok');
    t(`persona names (${lang}): none is left unclear or flagged`, !left.length, JSON.stringify(left));
  }
  for (const w of ['Will', 'Grace', 'Hope']) t(`name list: the English word "${w}" is not a known name`, !knownName(w));
}

console.log(`\nnames: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
