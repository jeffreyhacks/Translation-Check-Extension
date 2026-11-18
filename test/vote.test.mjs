// Models must vote, not abstain: a Danish page checked as English (the case that left 49 of 73 strings "unclear"), English jargon that the
// dictionary only knows in its base form, and the guarantees that nothing else changes (Danish checked as Danish, mixed French/German pages).
import { build } from 'esbuild';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
const S = (f) => JSON.stringify(path.resolve('src', f));
fs.writeFileSync(path.join(TMP, 'entry.js'), `export { createEngine } from ${S('engine.js')}; export { createVerifier } from ${S('verify.js')}; export { guardShort } from ${S('guard.js')}; export { knownName, nameShape } from ${S('names.js')}; export { mask } from ${S('mask.js')}; export { englishLike } from ${S('english.js')}; export { implausible } from ${S('alphabet.js')};`);
await build({ entryPoints: [path.join(TMP, 'entry.js')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'node.cjs'), logLevel: 'error' });
const m = require(path.join(TMP, 'node.cjs'));
const engine = m.createEngine(), verifier = m.createVerifier();
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

// the same pipeline as background.js
async function judge(text, lang, sources) {
  const c = { sources, related: true };
  const s = m.mask(text, lang).text;
  let v = await engine.classify(s, lang, c);
  if (v.v !== 'ok' && m.knownName(s)) return { v: 'name' };
  v = await verifier.verify(s, lang, v, true, { shape: lang !== 'de' && m.nameShape(s), sources });
  return m.guardShort(s, v, lang, true);
}
const tally = async (texts, lang, sources) => { const n = {}; for (const x of texts) { const v = await judge(x, lang, sources); n[v.v] = (n[v.v] || 0) + 1; } return n; };

const DA = ['Velkommen tilbage, admin', 'Administrer scenarier, personas, rubrikker og systemkonfiguration', 'Opret session', 'Scenarier', 'Personaer', 'Rubrikker',
  'Scenarieskabeloner', 'Opret og administrer træningsscenarier', 'Byg kundesimuleringsprofiler', 'Definer evalueringskriterier', 'Administrer scenarier',
  'Administrer rubrikker', 'Valider indhold i Admin Playground', 'Åbn Playground', 'Samtalesprog', 'Hjem', 'Brugere', 'Indstillinger', 'Integrationer', 'Nøgler',
  'Rapporter', 'Gem ændringer', 'Annuller', 'Slet', 'Rediger', 'Søg', 'Kundeservice', 'Forhandling', 'Klagehåndtering', 'Hjælp', 'Træning', 'Tilbage', 'Fortsæt',
  'Kommentarer', 'Ingen data', 'Næste', 'Forrige', 'Tildel'];

// 1) Danish page checked as English: two models agreeing (Norwegian from CLD3 counts with Danish from tinyld) + the dictionary decide
let n = await tally(DA, 'en', ['da']);
t('Danish page as English: most strings are untranslated, few stay unclear', (n.bad || 0) >= 32 && (n.unsure || 0) <= 9 && !n.ok, JSON.stringify(n));
for (const w of ['Hjem', 'Indstillinger', 'Træning', 'Administrer scenarier', 'Brugere']) {
  const v = await judge(w, 'en', ['da']);
  t(`"${w}" on a Danish page checked as English -> untranslated, labelled Danish`, v.v === 'bad' && ['da', 'no'].includes(v.detected), JSON.stringify(v));
}
// Danish plurals in -er are not English words ("Personaer", "Rapporter"), and never become "translated"
for (const w of ['Personaer', 'Rapporter', 'Integrationer']) {
  const v = await judge(w, 'en', ['da']);
  t(`"${w}" is never read as English`, v.v !== 'ok', JSON.stringify(v));
}

// 2) the same strings checked as Danish: unchanged, nothing is newly flagged
n = await tally(DA, 'da', []);
t('Danish page as Danish: at most one warning', (n.bad || 0) <= 1, JSON.stringify(n));
t('"Administrer personas" on a Danish page is not a warning (es and pt do not "agree" on a Danish page)', (await judge('Administrer personas', 'da', [])).v !== 'bad');

// 3) English jargon: never flagged, even when the rest of the page is Danish, and mostly read as English
const JARGON = ['Webhooks', 'Signup', 'Roleplay', 'Upskilling', 'Leaderboard', 'Microlearning', 'Analytics', 'Workspace', 'Personas', 'Integrations', 'Autosave',
  'Datetime', 'Reskilling', 'Starserve', 'Katalyst', 'Coachable moments', 'AI Roleplay Trainer', 'Manage scenarios, personas, rubrics and system configuration',
  'Microsoft Teams', 'KPIs', 'CSAT score', 'Gamification', 'Signout', 'Re-run', 'Playbooks', 'Follow-ups'];
for (const src of [[], ['da'], ['no'], ['sv'], ['fi'], ['pl'], ['de'], ['fr'], ['es']]) {
  const r = []; for (const x of JARGON) { const v = await judge(x, 'en', src); if (v.v === 'bad') r.push(x); }
  t(`English jargon on an English check (page source ${src.join() || 'none'}): nothing flagged`, !r.length, r.join(', '));
}
n = await tally(JARGON, 'en', []);
t('English jargon: at most 7 of 26 left unclear', (n.unsure || 0) <= 7, JSON.stringify(n));
for (const w of ['Integrations', 'Analytics', 'Manage scenarios, personas, rubrics and system configuration', 'AI Roleplay Trainer'])
  t(`"${w}" on an English page -> translated`, (await judge(w, 'en', [])).v === 'ok');

// 4) English morphology
t('englishLike: plurals, prefixes, compounds, acronyms', ['integrations', 'Reskilling', 'roleplay', 'Datetime', 'Signup', 'KPIs and NPS'].every((x) => m.englishLike(x)));
t('englishLike: Danish -er plurals and short splits are not English', !['Personaer', 'Rapporter', 'Forhandling', 'Annuller', 'Integrationer'].some((x) => m.englishLike(x)));

// 5) mixed pages are judged exactly as before: real leftovers are still found with their real language
const DE = ['Einstellungen', 'Änderungen speichern', 'Abbrechen', 'Willkommen zurück, Admin', 'Bewertungskriterien festlegen', 'Systemkonfiguration', 'Empathie'];
const EN = ['Save changes', 'Welcome back, admin', 'Define evaluation criteria', 'Recent sessions', 'Enthusiastic, decisive', 'Order History', 'Average score'];
n = await tally(DE, 'de', ['en']);
t('German strings on a German page (English source): none flagged', !n.bad, JSON.stringify(n));
n = await tally(EN, 'de', ['en']);
t('English leftovers on a German page: all flagged', n.bad === EN.length, JSON.stringify(n));
let v = await judge('Eliminar todo', 'de', ['en']);
t('a backed guess is kept: "Eliminar todo" on a German page stays Spanish, not relabelled to the page source', v.v === 'bad' && v.detected === 'es', JSON.stringify(v));
v = await verifier.verify('Home', 'es', { v: 'unsure' });
t('very short strings: franc still abstains on its open guess', v.v === 'unsure' && v.votes.franc === 'abstain', JSON.stringify(v.votes));

// 6) Dutch: checked as English it is untranslated; checked as Dutch nothing is flagged (no "Czech" for plain-ASCII Dutch, no "English" for 's plurals or "Help")
const NL = ['Welkom terug, admin', "Beheer scenario's, persona's, rubrieken en systeemconfiguratie", 'Sessie aanmaken', 'Rubrieken', "Maak en beheer trainingsscenario's",
  'Bouw klantsimulatieprofielen', 'Definieer beoordelingscriteria', "Persona's", 'Gebruikers', 'Instellingen', 'Integraties', 'Wijzigingen opslaan', 'Annuleren',
  'Verwijderen', 'Bewerken', 'Zoeken', 'Klantenservice', 'Onderhandeling', 'Uitloggen', 'Profiel', 'Systeemconfiguratie', 'Beoordelingscriteria', 'Opslaan',
  'Sluiten', 'Volgende', 'Vorige', 'Terug', 'Doorgaan', 'Help', 'Geen gegevens', 'Opmerkingen'];
n = await tally(NL, 'nl', []);
t('Dutch page as Dutch: nothing flagged', !n.bad, JSON.stringify(n));
n = await tally(NL, 'en', ['nl']);
t('Dutch page as English: most strings untranslated, none translated except shared words', (n.bad || 0) >= 24 && (n.ok || 0) <= 2, JSON.stringify(n));
for (const w of ['Systeemconfiguratie', "Beheer scenario's, persona's, rubrieken en systeemconfiguratie"]) {
  const v = await judge(w, 'nl', []);
  t(`"${w.slice(0, 30)}" on a Dutch page is not Czech`, v.v !== 'bad', JSON.stringify(v));
}
t('"Persona\'s" and "Help" on a Dutch page are not English', (await judge("Persona's", 'nl', [])).v !== 'bad' && (await judge('Help', 'nl', [])).v !== 'bad');
const { implausible } = m;
t('implausible: 15+ plain letters is not Czech/Polish; real Czech is', implausible('Systeemconfiguratie', 'cs') && implausible('Beheer scenario rubrieken', 'pl') && !implausible('Nastavení systému a konfigurace', 'cs'));

console.log(`\nvoting: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
