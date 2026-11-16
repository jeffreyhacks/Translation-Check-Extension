// High-frequency function words per language. Independent evidence used to double-check the statistical model:
// a sentence full of German function words is German, whatever a trigram model guesses for one odd compound word.
const L = (s) => new Set(s.split(' '));
export const STOP = {
  en: L('the and of to in is that for with this are you your we our it be have not or as at by from'),
  de: L('der die das und ist sie ich nicht mit für von zu den dem ein eine auf im es wir ihr bei oder auch nach über du dich uns zum zur einen einer des sind wird'),
  es: L('el la los las de que y en un una por con para es se del al su no más como pero sus le lo muy sin sobre'),
  fr: L('le la les des du et en un une est pour que qui dans par sur avec au aux ce ne pas vous nous votre vos ses son plus'),
  it: L('il lo la le di che e in un una per con non è sono del della dei gli nel alla più come anche suo'),
  pt: L('o a os as de que e em um uma para com não é do da dos das se por mais como seu sua nos na no'),
  nl: L('de het een en van in is dat op te voor met zijn niet aan ook er maar je uw wij ons bij naar'),
  sv: L('och att det i en som är på för med av inte den har ett om till du vi ni kan'),
  da: L('og at det i en til er på for med af ikke den har et om du vi kan'),
  no: L('og at det i en til er på for med av ikke den har et om du vi kan'),
  pl: L('i w na z do nie się że jest to jak po od za dla przez oraz lub czy'),
  tr: L('ve bir bu için ile da de çok daha gibi ama en olarak veya mi'),
  id: L('dan yang di ke dari untuk dengan ini itu adalah pada tidak atau akan dalam'),
  ru: L('и в не на что я с он как это по но из к у за от для или ли'),
};
export const stopHits = (words, lang) => { const s = STOP[lang]; return s ? words.filter((w) => s.has(w)).length : 0; };
