import { createEngine } from '../src/engine.js';
const e = createEngine();
// [target, translated-strings..., ] ; and English leftovers that must be flagged
const good = {
  es: ['Añadir al carrito','Iniciar sesión','Contacto','Inicio','Buscar','Mi cuenta','Política de privacidad','Más información','Suscríbete','Enviar','Ayuda','Productos','Sobre nosotros','Envío gratis','Cerrar sesión','Guardar','Cancelar','Siguiente','Nombre','Correo electrónico','Contraseña','Blog','Menú','Newsletter','Comprar ahora'],
  fr: ['Panier','Se connecter','Accueil','Contact','Rechercher','Mon compte','À propos','Politique de confidentialité','En savoir plus','Ajouter au panier','Envoyer','Aide','Livraison gratuite','Menu','Se déconnecter','Enregistrer','Annuler','Suivant','Nom','Mot de passe'],
  de: ['Warenkorb','Anmelden','Startseite','Kontakt','Suchen','Mein Konto','Über uns','Datenschutz','Mehr erfahren','In den Warenkorb','Senden','Hilfe','Kostenloser Versand','Abmelden','Speichern','Abbrechen','Weiter','Name','Passwort','Impressum'],
  pt: ['Carrinho','Entrar','Início','Contato','Pesquisar','Minha conta','Sobre nós','Política de privacidade','Saiba mais','Adicionar ao carrinho','Enviar','Ajuda','Frete grátis','Sair','Salvar','Cancelar','Próximo','Senha'],
  it: ['Carrello','Accedi','Home','Contatti','Cerca','Il mio account','Chi siamo','Informativa sulla privacy','Scopri di più','Aggiungi al carrello','Invia','Aiuto','Spedizione gratuita','Esci','Salva','Annulla','Avanti','Password'],
  nl: ['Winkelwagen','Inloggen','Contact','Zoeken','Mijn account','Over ons','Meer informatie','In winkelwagen','Verzenden','Hulp','Gratis verzending','Uitloggen','Opslaan','Annuleren','Volgende','Wachtwoord'],
  tr: ['Sepet','Giriş yap','Ana sayfa','İletişim','Ara','Hesabım','Hakkımızda','Gizlilik politikası','Daha fazla bilgi','Sepete ekle','Gönder','Yardım','Ücretsiz kargo','Çıkış yap','Kaydet','İptal','Sonraki','Şifre'],
  pl: ['Koszyk','Zaloguj się','Strona główna','Kontakt','Szukaj','Moje konto','O nas','Polityka prywatności','Dowiedz się więcej','Dodaj do koszyka','Wyślij','Pomoc','Darmowa dostawa','Wyloguj się','Zapisz','Anuluj','Dalej','Hasło'],
  id: ['Keranjang belanja','Masuk','Beranda','Kontak','Cari','Akun saya','Tentang kami','Kebijakan privasi','Pelajari lebih lanjut','Tambah ke keranjang','Kirim','Bantuan','Gratis ongkir','Keluar','Simpan','Batal','Berikutnya','Kata sandi'],
  sv: ['Varukorg','Logga in','Hem','Kontakt','Sök','Mitt konto','Om oss','Integritetspolicy','Läs mer','Lägg i varukorgen','Skicka','Hjälp','Fri frakt','Logga ut','Spara','Avbryt','Nästa','Lösenord'],
  ru: ['Корзина','Войти','Главная','Контакты','Поиск','Мой аккаунт','О нас','Политика конфиденциальности','Узнать больше','Добавить в корзину','Отправить','Помощь','Бесплатная доставка','Выйти','Сохранить','Отмена','Далее','Пароль'],
  ja: ['カート','ログイン','ホーム','お問い合わせ','検索','マイアカウント','会社概要','プライバシーポリシー','詳細を見る','カートに追加','送信','ヘルプ','送料無料'],
};
const english = ['Sign in','Add to cart','Contact us','Privacy policy','Terms of service','Learn more','Read more','Free shipping on all orders','Get started','Search','Subscribe to our newsletter','Your cart is empty','Shopping cart','Welcome back','Forgot your password?','Home','Help','About us','Log out','Submit','Checkout','Download now','Our products and services','Frequently asked questions','Customer support'];
const sourceLangs = {};
let g = 0, gN = 0, unsure = 0, wrongBad = [], e0 = 0, eN = 0, eMissed = [];
for (const [lang, list] of Object.entries(good)) {
  for (const t of list) {
    const v = await e.classify(t, lang, { sources: ['en'] });
    gN++;
    if (v.v === 'ok') g++; else if (v.v === 'unsure') unsure++; else wrongBad.push(`${lang}: ${t} -> ${v.detected}`);
  }
  for (const t of english) {
    const v = await e.classify(t, lang, { sources: ['en'] });
    eN++;
    if (v.v === 'bad') e0++; else eMissed.push(`${lang}: ${t} (${v.v})`);
  }
}
console.log(`Translated strings: ${g}/${gN} ok, ${unsure} unsure, ${wrongBad.length} wrongly flagged`);
console.log(wrongBad.join('\n'));
console.log(`English strings flagged: ${e0}/${eN}  (missed ${eMissed.length})`);
console.log(eMissed.slice(0, 25).join('\n'));
