import { createEngine } from '../src/engine.js';
const e = createEngine();
const cases = [
 ['es','Envío gratis en pedidos superiores a 50 €. Devoluciones sencillas en 30 días.','ok'],
 ['es','Free shipping on orders over $50. Easy returns within 30 days.','bad'],
 ['es','Kostenloser Versand ab 50 Euro. Einfache Rückgabe innerhalb von 30 Tagen.','bad'],
 ['es','Livraison gratuite pour toute commande supérieure à 50 €.','bad'],
 ['en','Livraison gratuite pour toute commande supérieure à 50 €.','bad'],
 ['en','Bienvenido','bad'],
 ['en','Welcome to our store, where everything ships free.','ok'],
 ['ja','Free shipping on all orders over $50','bad'],
 ['ja','全品送料無料。ご注文はこちらから。','ok'],
 ['ja','Nike','unsure'],
 ['ru','Бесплатная доставка при заказе от 50 долларов','ok'],
 ['ru','Безкоштовна доставка при замовленні від 50 доларів','bad'],
 ['uk','Бесплатная доставка при заказе от 50 долларов','bad'],
 ['ar','مرحبا بكم في متجرنا','ok'],
 ['ar','Welcome to our store','bad'],
 ['zh','ご注文ありがとうございます。またお越しください。','bad'],
 ['zh','感谢您的订单,欢迎再次光临','ok'],
 ['de','Added to your cart','bad'],
 ['fr','Lorem ipsum dolor sit amet, consectetur adipiscing elit','bad'],
];
let pass=0;
for (const [lang,t,exp] of cases){ const v=await e.classify(t,lang,{sources:['en']}); const ok = v.v===exp; if(ok)pass++; console.log(ok?'PASS':'FAIL',lang,JSON.stringify(t).slice(0,60),'->',v.v,v.detected||'', exp!==v.v?`(expected ${exp})`:''); }
console.log(pass+'/'+cases.length);
