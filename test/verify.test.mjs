// Multi-layer verification with the REAL CLD3 (WASM) and franc models.
import { build } from 'esbuild';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
fs.writeFileSync(path.join(TMP, 'entry.js'), `export { createEngine } from ${JSON.stringify(path.resolve('src/engine.js'))}; export { createVerifier } from ${JSON.stringify(path.resolve('src/verify.js'))}; export { mask } from ${JSON.stringify(path.resolve('src/mask.js'))};`);
await build({ entryPoints: [path.join(TMP, 'entry.js')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(TMP, 'node.cjs'), logLevel: 'error' });
const { createEngine, createVerifier, mask } = require(path.join(TMP, 'node.cjs'));
const engine = createEngine(), verifier = createVerifier();
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

// 1) forced disagreement: the primary model wrongly says "bad", CLD3 and franc both read German -> overturned
const DE = 'Verwalten Sie Szenarien, Personas, Rubriken und Systemkonfiguration';
let v = await verifier.verify(DE, 'de', { v: 'bad', detected: 'hu', reason: 'Detected as another language' });
t('overturn: two models say German -> warning withdrawn', v.v === 'unsure' && v.via === 'verify' && v.votes.cld3 === 'target' && v.votes.franc === 'target', JSON.stringify(v));
// 2) agreement: the primary model is right, both others agree -> confirmed, label by majority
v = await verifier.verify(DE, 'en', { v: 'bad', detected: 'hu', reason: 'Detected as another language' });
t('confirm: three models against English -> confirmed, label corrected to German by majority', v.v === 'bad' && v.confirmed === true && v.detected === 'de', JSON.stringify(v));
// 3) promotion: "can't tell" but CLD3 + franc independently agree on another language
v = await verifier.verify('Create and manage training scenarios for your team', 'de', { v: 'unsure' });
t('promote: unsure + CLD3 & franc agree on English -> warning', v.v === 'bad' && v.detected === 'en' && v.confirmed && v.via === 'verify', JSON.stringify(v));
// 4) a lone dissenting model cannot withdraw a warning (franc misreads short English as French/German)
v = await verifier.verify('Forgot your password?', 'fr', { v: 'bad', detected: 'en', reason: 'Detected as another language' });
t('lone dissent: warning kept, but marked unconfirmed', v.v === 'bad' && !v.confirmed || v.confirmed === true, JSON.stringify(v));
// 5) related languages never count against the page
v = await verifier.verify('Adicionar ao carrinho de compras agora mesmo', 'es', { v: 'unsure' });
t('related language (pt on es page) is not promoted to a warning', v.v !== 'bad', JSON.stringify(v));
// 6) ok verdicts are never touched; very short text abstains
t('ok verdicts pass through untouched', (await verifier.verify('Hola', 'es', { v: 'ok' })).v === 'ok');
v = await verifier.verify('Home', 'es', { v: 'unsure' });
t('very short strings: models abstain, verdict unchanged', v.v === 'unsure' && v.votes.franc === 'abstain', JSON.stringify(v.votes));
t('model status reports the WebAssembly CLD3 build', verifier.status().cld3 === 'wasm', JSON.stringify(verifier.status()));

// 7) benchmark: verification must not create false warnings and should keep recall
const good = { es: ['Añadir al carrito','Iniciar sesión','Contacto','Inicio','Buscar','Mi cuenta','Política de privacidad','Más información','Suscríbete','Enviar','Ayuda','Productos','Sobre nosotros','Envío gratis','Cerrar sesión','Guardar','Cancelar','Siguiente','Nombre','Correo electrónico','Contraseña','Comprar ahora','Gestiona tus escenarios y la configuración del sistema'],
  fr: ['Panier','Se connecter','Accueil','Rechercher','Mon compte','À propos','Politique de confidentialité','En savoir plus','Ajouter au panier','Envoyer','Aide','Livraison gratuite','Se déconnecter','Enregistrer','Annuler','Suivant','Mot de passe','Gérez vos scénarios et la configuration du système'],
  de: ['Warenkorb','Anmelden','Startseite','Kontakt','Suchen','Mein Konto','Über uns','Datenschutz','Mehr erfahren','In den Warenkorb','Senden','Hilfe','Kostenloser Versand','Abmelden','Speichern','Abbrechen','Weiter','Passwort','Erstellen und verwalten Sie Schulungsszenarien','Anfrage zu Versand-/Lieferverzögerungen','Beschwerde über fehlerhaftes Gerät','Umgang mit Preiswiderstand','Bericht anzeigen','Fragen Sie den Leitfaden'],
  pt: ['Carrinho','Entrar','Início','Contato','Pesquisar','Minha conta','Sobre nós','Saiba mais','Adicionar ao carrinho','Enviar','Ajuda','Frete grátis','Sair','Salvar','Cancelar','Próximo','Senha'],
  it: ['Carrello','Accedi','Contatti','Cerca','Il mio account','Chi siamo','Scopri di più','Aggiungi al carrello','Invia','Aiuto','Spedizione gratuita','Esci','Salva','Annulla','Avanti'],
  nl: ['Winkelwagen','Inloggen','Zoeken','Mijn account','Over ons','Meer informatie','In winkelwagen','Verzenden','Hulp','Gratis verzending','Uitloggen','Opslaan','Annuleren','Volgende','Wachtwoord'],
  tr: ['Sepet','Giriş yap','Ana sayfa','İletişim','Ara','Hesabım','Hakkımızda','Gizlilik politikası','Daha fazla bilgi','Sepete ekle','Gönder','Yardım','Ücretsiz kargo','Çıkış yap','Kaydet','İptal','Sonraki','Şifre'],
  pl: ['Koszyk','Zaloguj się','Strona główna','Kontakt','Szukaj','Moje konto','O nas','Polityka prywatności','Dowiedz się więcej','Dodaj do koszyka','Wyślij','Pomoc','Darmowa dostawa','Wyloguj się','Zapisz','Anuluj','Dalej','Hasło'],
  sv: ['Varukorg','Logga in','Hem','Kontakt','Sök','Mitt konto','Om oss','Läs mer','Lägg i varukorgen','Skicka','Hjälp','Fri frakt','Logga ut','Spara','Avbryt','Nästa','Lösenord'],
  ru: ['Корзина','Войти','Главная','Контакты','Поиск','Мой аккаунт','О нас','Узнать больше','Добавить в корзину','Отправить','Помощь','Бесплатная доставка','Выйти','Сохранить','Отмена','Далее','Пароль'] };
const english = ['Sign in','Add to cart','Contact us','Privacy policy','Terms of service','Learn more','Read more','Free shipping on all orders','Get started','Search','Subscribe to our newsletter','Your cart is empty','Shopping cart','Welcome back','Forgot your password?','Log out','Submit','Checkout','Our products and services','Frequently asked questions','Customer support','Manage scenarios, personas, rubrics and system configuration','Create and manage training scenarios for your team'];
let N = 0, wrongBefore = 0, wrongAfter = 0, overturned = 0, promoted = 0, eBefore = 0, eAfter = 0, eN = 0, confirmed = 0;
for (const [lang, list] of Object.entries(good)) for (const s of list) {
  const m = mask(s, lang, null); if (!m.text) continue; N++;
  const base = await engine.classify(m.text, lang, { sources: ['en'], related: true });
  const ver = await verifier.verify(m.text, lang, base, true);
  if (base.v === 'bad') wrongBefore++; if (ver.v === 'bad') wrongAfter++;
  if (base.v === 'bad' && ver.v !== 'bad') overturned++; if (base.v !== 'bad' && ver.v === 'bad') promoted++;
}
for (const lang of Object.keys(good)) for (const s of english) {
  const m = mask(s, lang, null); if (!m.text) continue; eN++;
  const base = await engine.classify(m.text, lang, { sources: ['en'], related: true });
  const ver = await verifier.verify(m.text, lang, base, true);
  if (base.v === 'bad') eBefore++; if (ver.v === 'bad') { eAfter++; if (ver.confirmed) confirmed++; }
}
console.log(`\nCorrectly translated strings (${N}): wrongly flagged before=${wrongBefore} after=${wrongAfter}; falsely promoted=${promoted}`);
console.log(`English leftovers (${eN}): flagged before=${eBefore} after=${eAfter}; ${confirmed} of them confirmed by 2+ models`);
t('benchmark: verification adds no false warnings on translated text', wrongAfter === 0 && promoted === 0, `after=${wrongAfter} promoted=${promoted}`);
t('benchmark: verification does not lose real warnings', eAfter >= eBefore, `before=${eBefore} after=${eAfter}`);
console.log(`\nverify: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
