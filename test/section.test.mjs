// A lone word with no sentence around it ("Empathie" alone in a card) is read with its section: cleared when the section is clearly in the
// page's language, but never when it is plain English on a non-English page or when models read it as another language.
import { loadNew, page } from './harness.mjs';
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };
const card = (h, d) => `<div class="card"><div><span>${h}</span></div><p>${d}</p></div>`;
const body = `<section><h2>Bewertungskriterien</h2>
 ${card('Professionalität', 'Bewertet, wie sachlich und respektvoll der Mitarbeiter mit dem Kunden spricht und ob er die Vorgaben des Unternehmens einhält.')}
 ${card('Empathie', 'Zeigt, ob der Mitarbeiter auf die Gefühle des Kunden eingeht und Verständnis für seine Situation zeigt.')}
 ${card('Settings', 'Hier können Sie die Einstellungen für Ihr Konto ändern und Ihre Benachrichtigungen verwalten.')}
 ${card('Guardar cambios', 'Speichert alle Änderungen, die Sie an diesem Formular vorgenommen haben, und schließt das Fenster.')}
</section>`;
const { call } = loadNew(page(body, 'de'));
const r = await call({ type: 'scan', lang: 'de', mode: 'strict', attrs: true, unsure: true });
const by = (x) => r.issues.find((i) => i.text === x);
t('section: "Empathie" next to German text is not unclear', !by('Empathie'), JSON.stringify(by('Empathie')));
t('section: "Professionalität" next to German text is not unclear', !by('Professionalität'), JSON.stringify(by('Professionalität')));
t('section: English "Settings" in the same German section is still flagged', by('Settings')?.verdict === 'bad', JSON.stringify(by('Settings')));
t('section: Spanish "Guardar cambios" is not cleared by its German section', !!by('Guardar cambios'), JSON.stringify(r.issues.map((i) => i.text)));
// no section text: a lone word in an otherwise empty page stays unclear
const lone = loadNew(page('<div><span>Empathie</span></div>', 'de'));
const r2 = await lone.call({ type: 'scan', lang: 'de', mode: 'strict', attrs: true, unsure: true });
t('section: without enough text around it, a lone word stays unclear', r2.issues.some((i) => i.text === 'Empathie' && i.verdict === 'unsure'), JSON.stringify(r2.issues));
console.log(`\nsection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
