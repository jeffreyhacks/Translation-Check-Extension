import { HARD, ENGLISH } from './hardneg.mjs';
export const LONG = {
  es: ['Bienvenidos a nuestra tienda en línea, aquí encontrarás todo lo que necesitas.','Envío gratis en todos los pedidos superiores a cincuenta euros.','Gestiona tus escenarios y la configuración del sistema'],
  fr: ['Bienvenue dans notre boutique en ligne, vous y trouverez tout pour la maison.','Livraison gratuite pour toute commande supérieure à cinquante euros.','Gérez vos scénarios et la configuration du système','Mode actif du projet','Gestion des documents actifs','Contrôle des accès et des rôles','Test de performance du réseau'],
  de: ['Willkommen in unserem Online-Shop, hier finden Sie alles für Ihr Zuhause.','Kostenloser Versand ab fünfzig Euro. Einfache Rückgabe innerhalb von 30 Tagen.','Erstellen und verwalten Sie Schulungsszenarien','Beschwerde über fehlerhaftes Gerät','Anfrage zu Versand-/Lieferverzögerungen','Aktive Projekte und Status des Projekts','Export und Import von Dokumenten','Plan und Preise im Überblick'],
  it: ['Benvenuti nel nostro negozio online, qui trovi tutto per la casa.','Spedizione gratuita per ordini superiori a cinquanta euro.'],
  pt: ['Bem-vindo à nossa loja online, aqui você encontra tudo para a casa.','Frete grátis para pedidos acima de cinquenta euros.'],
  tr: ['Çevrimiçi mağazamıza hoş geldiniz, ihtiyacınız olan her şey burada.','Elli euro üzerindeki siparişlerde ücretsiz kargo.'],
  ru: ['Добро пожаловать в наш интернет-магазин, здесь есть всё для дома.','Бесплатная доставка при заказе от пятидесяти евро.'],
  ja: ['オンラインストアへようこそ。必要なものがすべて揃っています。','50ユーロ以上のご注文は送料無料です。'],
};
export const LONG_EN = ['Welcome to our online store, where you will find everything for your home.','Free shipping on all orders over fifty euros, with easy returns within thirty days.'];
export function corpus() {
  const out = [];
  for (const [lang, str] of Object.entries(HARD)) for (const t of str.split('|')) out.push([lang, t, 'hard']);
  for (const lang of Object.keys(HARD)) for (const t of ENGLISH) out.push([lang, t, 'english']);
  for (const [lang, list] of Object.entries(LONG)) for (const t of list) out.push([lang, t, 'long-ok']);
  for (const lang of Object.keys(LONG)) for (const t of LONG_EN) out.push([lang, t, 'long-english']);
  return out;
}
