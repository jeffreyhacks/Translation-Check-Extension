import { createEngine } from '../src/engine.js';
import { mask } from '../src/mask.js';
const e = createEngine();
let pass = 0, fail = 0;
const check = async (lang, text, exp, ctx = { sources: ['en'], related: true }) => {
  const m = mask(text, lang, null); const v = m.text ? await e.classify(m.text, lang, ctx) : { v: 'ignored' };
  const ok = exp === 'ok' ? (v.v === 'ok' || (v.v === 'unsure' && text.split(/\s+/).length <= 2) || v.v === 'ignored') : v.v === exp; if (ok) pass++; else { fail++; console.log('FAIL', lang, exp, '->', v.v, v.detected || '', '|', text.slice(0, 60)); }
};
// Real UI strings from the screenshot: all must pass on a German page
for (const s of ['Verwalten Sie Szenarien, Personas, Rubriken und Systemkonfiguration','Versuche ein Szenario, eine Persona und ein Bewertungsraster zusammen, bevor du die Trainees zuweist.','Erstellen und verwalten Sie Schulungsszenarien','Anfrage zu Versand-/Lieferverzögerungen','Beschwerde über fehlerhaftes Gerät','Umgang mit Preiswiderstand','Playground öffnen','Globale Sitzungsverlauf','Bericht anzeigen','Fragen Sie den Leitfaden','Alle Szenarien','Standard-Persona','Gesprächssprache','Tour starten','Inhalte im Admin Playground validieren','Verwalten Sie Ihre Trainings und analysieren Sie die Ergebnisse Ihrer Teilnehmer.','Konfigurieren Sie Bewertungsraster und Szenarien für Ihre Trainees.','Abgeschlossen','Neues Szenario erstellen','Persona auswählen und Gespräch starten'])
  await check('de', s, 'ok');
// Genuinely untranslated / wrong-language text on a German page must still be caught
for (const s of ['Manage scenarios, personas, rubrics and system configuration','Create and manage training scenarios for your team','Sign in','Add to cart','View report','Ask the guide','Gérez les scénarios, les personas et la configuration du système','Administra escenarios, personas y la configuración del sistema','Gestisci scenari, personas e configurazione del sistema','Beheer scenario\'s, persona\'s en systeemconfiguratie'])
  await check('de', s, 'bad');
// Same idea on other targets
await check('fr', 'Gérez vos scénarios, vos personas et la configuration du système', 'ok');
await check('fr', 'Verwalten Sie Szenarien, Personas und Systemkonfiguration', 'bad');
await check('es', 'Administra escenarios, personas y la configuración del sistema', 'ok');
await check('es', 'Create and manage training scenarios for your team', 'bad');
console.log(`german/second-opinion: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
