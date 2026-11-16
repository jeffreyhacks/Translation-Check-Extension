// Names are not "translated" or "untranslated": a person, a place or a brand reads the same on every page. They get a verdict of their own
// ("name") instead of being left as "can't tell". Two ways to recognise one:
//   knownName(text) - the words are in a small built-in list of given names, surnames, cities and brands (works with no model at all);
//   nameShape(text) - the text is shaped like a name (1-4 capitalised words, none of them ordinary vocabulary). A shape alone proves nothing:
//                     the verifier only accepts it when the language models cannot agree on any one language for it, which is what happens with
//                     names (each model guesses something different), unlike a real leftover, which they agree on.
import { EN_FN, EN_WEAK, EN_SINGLE } from './lexicon.js';
import { STOP } from './stopwords.js';

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const bag = (s) => new Set(s.trim().split(/\s+/).map(fold));

// Words that are ordinary vocabulary in some language (so "Smith" is a name but "Baker", "Brown" and "Mark" are left out on purpose).
const GIVEN = bag(`james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony donald steven paul andrew joshua kenneth
  kevin brian george timothy ronald edward jason jeffrey ryan jacob nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander
  patrick raymond dennis jerry tyler aaron adam nathan henry zachary douglas peter kyle noah ethan jeremy walter christian keith roger terry austin sean gerald
  carl harold dylan arthur lawrence jordan jesse bryan gabriel albert alan wayne elijah vincent ralph eugene russell philip louis oliver liam lucas leo oscar
  mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty sandra margaret ashley kimberly emily donna michelle carol amanda
  melissa deborah stephanie rebecca sharon laura cynthia kathleen amy shirley angela helen anna brenda pamela nicole emma samantha katherine christine rachel
  catherine carolyn janet maria heather diane virginia julie joyce victoria olivia kelly christina lauren joan evelyn judith megan cheryl andrea hannah
  jacqueline martha gloria teresa sara madison frances kathryn janice jean abigail alice julia judy sophia denise doris marilyn danielle beverly isabella
  theresa diana natalie charlotte marie kayla alexis lori jane lily chloe mia ella zoe nora
  hans peter klaus wolfgang ludwig friedrich wilhelm karl otto heinrich hermann jurgen gunther dieter uwe stefan andreas markus lukas jan jens sven lars bjorn mats anders erik olof magnus sofie sophie annika
  katrin petra monika sabine ursula heike renate gisela brigitte jurgen helmut horst manfred rainer reinhard torsten tobias florian matthias sebastian
  pierre jacques michel philippe francois marcel claude alain bernard gerard henri nicolas julien camille amelie elodie lea manon ines isabelle nathalie
  sylvie jeanne margaux
  juan jose carlos luis miguel pedro antonio francisco javier manuel diego alejandro fernando pablo sergio rafael jorge andres ricardo carmen ana lucia marta
  pilar isabel valentina camila dolores
  giuseppe giovanni luca marco matteo francesco alessandro paolo stefano roberto salvatore massimo giulia chiara francesca elena silvia federica alessia
  joao tiago rui nuno beatriz joana
  piotr krzysztof andrzej tomasz pawel marcin michal zofia agnieszka katarzyna malgorzata wojciech jakub
  mehmet mustafa ahmet ali hasan huseyin ibrahim ismail ayse fatma emine hatice zeynep elif
  mohammed muhammad ahmed ahmad omar umar yusuf youssef hassan hussein khalid abdullah fatima aisha layla leila amina nour
  olga ivan dmitri dmitry sergei sergey vladimir nikolai alexei natalia tatiana svetlana irina anastasia ekaterina
  wei yuki hiroshi takashi kenji sakura haruka yui akira satoshi minjun jiwoo
  giorgos nikos dimitris eleni sven henrik johan jonas niklas kristian ingrid astrid freya`);
const SURNAME = bag(`smith johnson williams jones garcia davis rodriguez martinez hernandez lopez gonzalez wilson anderson taylor moore jackson martin lee thompson
  harris sanchez clark ramirez lewis robinson walker allen torres nguyen flores adams nelson rivera campbell mitchell roberts carter doe roe
  muller mueller schmidt schneider fischer weber meyer meier wagner becker schulz hoffmann schafer hartmann schmitt werner krause lehmann neumann zimmermann kruger
  dupont dupuis durand bernard dubois petit moreau laurent lefebvre leroy roux bertrand morel fournier girard bonnet lambert fontaine rousseau
  fernandez perez gomez diaz alvarez romero moreno munoz gutierrez ruiz jimenez navarro dominguez
  rossi russo ferrari esposito bianchi romano colombo ricci marino greco bruno gallo conti deluca costa giordano mancini rizzo lombardi moretti
  silva santos oliveira souza pereira ferreira rodrigues almeida nascimento
  kowalski kowalska nowak nowicka wisniewski wisniewska wojcik kaminski lewandowski zielinski szymanski wozniak dabrowski kozlowski jankowski mazur kwiatkowski
  yilmaz kaya demir sahin celik yildiz yildirim ozturk aydin ozdemir arslan dogan kilic
  petrov petrova ivanov ivanova smirnov kuznetsov popov volkov sokolov
  hassan hussein ahmed khan singh sharma patel kumar gupta tanaka suzuki sato takahashi watanabe ito yamamoto nakamura kim park choi chen wang zhang liu
  jansen devries vandenberg bakker visser smit meijer bos mulder berg lindqvist johansson andersson karlsson nilsson eriksson larsson olsson svensson gustafsson
  hansen nielsen jensen pedersen olsen christensen larsen sorensen rasmussen jorgensen`);
const PLACE = bag(`london paris berlin madrid rome roma lisbon lisboa amsterdam brussels bruxelles vienna wien zurich zuerich geneva geneve bern munich munchen hamburg
  frankfurt cologne koln stuttgart dusseldorf dresden leipzig hannover nuremberg nurnberg barcelona valencia seville sevilla bilbao malaga milan milano naples napoli
  turin torino florence firenze venice venezia bologna genoa genova palermo marseille lyon toulouse nantes strasbourg bordeaux lille rotterdam utrecht antwerp
  antwerpen ghent gent bruges copenhagen kobenhavn stockholm gothenburg goteborg malmo oslo bergen helsinki warsaw warszawa krakow gdansk wroclaw poznan prague praha
  budapest bucharest athens athina istanbul ankara izmir antalya moscow kyiv kiev minsk riga tallinn vilnius dublin edinburgh glasgow manchester liverpool
  birmingham leeds bristol cardiff belfast boston chicago houston dallas seattle denver atlanta miami toronto vancouver montreal ottawa calgary sydney melbourne
  brisbane perth auckland wellington tokyo osaka kyoto seoul beijing shanghai shenzhen singapore bangkok jakarta manila hanoi mumbai delhi bangalore kolkata
  chennai karachi lahore dhaka dubai doha riyadh cairo casablanca marrakech tunis algiers lagos nairobi johannesburg accra lima bogota santiago caracas havana
  brasilia montevideo quito tehran baghdad beirut amman jerusalem
  everest kilimanjaro matterhorn alps alpen alpes pyrenees himalaya sahara amazon danube donau rhine rhein thames seine tiber
  catalonia cataluna bavaria bayern tuscany toscana provence normandy andalusia andalucia lombardy lombardia sicily sicilia sardinia sardegna`);
const PLACE_PHRASES = ['new york', 'los angeles', 'san francisco', 'hong kong', 'buenos aires', 'new delhi', 'cape town', 'abu dhabi', 'rio de janeiro', 'sao paulo',
  'new orleans', 'las vegas', 'tel aviv', 'kuala lumpur', 'ho chi minh', 'mexico city', 'salt lake city', 'san diego', 'san jose', 'san antonio', 'santa monica', 'santa cruz'];
const BRAND = bag(`google apple microsoft amazon facebook meta instagram whatsapp youtube linkedin twitter tiktok snapchat pinterest reddit netflix spotify paypal stripe github
  gitlab bitbucket slack zoom dropbox notion figma openai anthropic claude chatgpt gemini copilot nvidia intel samsung sony tesla uber airbnb ebay shopify wordpress
  salesforce oracle adobe cisco docker kubernetes linux ubuntu android chrome firefox safari mozilla yahoo bing duckduckgo wikipedia telegram discord twitch steam
  playstation xbox nintendo ikea nike adidas puma zara lidl aldi tesco carrefour siemens bosch volkswagen mercedes porsche toyota honda nissan hyundai renault peugeot
  citroen fiat ferrari lamborghini nestle unilever shell paypal visa mastercard klarna revolut trello asana jira confluence atlassian cloudflare vercel netlify heroku
  digitalocean`);
const COMPANY = bag('cloud labs lab studio studios bank group systems technologies technology solutions software holdings partners ventures capital media digital park airlines airways motors foods');
// People's names have lowercase particles inside them: "Rio de Janeiro", "Ludwig van Beethoven", "Ahmed bin Rashid".
const PARTICLE = bag('de da di do dos das del della degli van von der den la le el al bin ibn ben bint af av ter');

// Everyday interface and shop vocabulary. A capitalised phrase made of these is a label ("Track Order", "Wish List"), not a name; so is a possessive
// plus a noun in any language ("Mein Konto", "Mon compte", "Mi cuenta"). Words that are ALSO common names (mark, will, bill, rose) are left out.
const LABELS = bag(`account accounts order orders history gift gifts card cards wish wishlist list lists track tracking recent best seller sellers store stores locator
  payment payments method methods address addresses customer customers review reviews top rated rating ratings size sizes guide guides saved items item special offers offer
  join today product products detail details help center centre return returns policy policies delivery cart basket checkout coupon coupons discount deals deal sale sales
  brand brands category categories collection collections catalog catalogue gallery news blog article articles story stories event events photo photos image images
  video videos download downloads upload profile profiles setting settings option options preference preferences notification notifications message messages inbox
  report reports summary overview dashboard analytics activity status users user member members team teams group groups role roles permission permissions billing
  invoice invoices plan plans pricing price prices feature features integration integrations security privacy terms conditions sitemap about contact careers jobs
  press partners partner support faq faqs resources documentation docs tutorial tutorials guide pricing popular featured latest trending related similar recommended
  recently viewed compare comparison filter filters sort search results result clear apply reset back next previous continue finish complete confirm cancel close open
  edit delete remove add create new update upgrade manage view show hide more less all none other others general advanced basic custom default personal public private
  mein meine meinen meiner meines ihre ihren ihrem ihrer unsere unser unseren dein deine alle weitere weiteren mehr neue neuen
  mon ma mes ton ta tes notre nos votre vos leur leurs tous toutes plus
  mi mis tu tus nuestro nuestra nuestros nuestras todos todas mas
  mio mia miei mie tuo tua nostro nostra nostri tutti tutte piu meu minha meus minhas seu sua nosso nossa todos
  mijn jouw uw ons onze alle meer min mitt din ditt vår vara alla mer mój moja moje twój wszystkie
  benim senin bizim tüm daha`);
// Everything that is ordinary vocabulary in any of the supported languages: a word like this is never evidence of a name.
const ORDINARY = new Set([...EN_FN, ...EN_WEAK, ...EN_SINGLE, ...LABELS]);
for (const s of Object.values(STOP)) for (const w of s) ORDINARY.add(fold(w));

const CAP = /^\p{Lu}[\p{L}\p{M}'’.-]*$/u;
const tokens = (text) => text.trim().split(/\s+/).filter(Boolean);
const partsOf = (tok) => fold(tok).split(/['’.-]+/).filter(Boolean);
const isLexical = (tok) => partsOf(tok).some((p) => p.length >= 2 && ORDINARY.has(p)) || ORDINARY.has(fold(tok));

/** "person" | "place" | "brand" | null. Needs no model: the words are in the built-in lists. */
export function knownName(text) {
  const toks = tokens(text);
  if (!toks.length || toks.length > 5) return null;
  const folded = fold(toks.join(' '));
  if (PLACE_PHRASES.includes(folded.replace(/[.,]/g, ''))) return 'place';
  const core = toks.filter((t) => !PARTICLE.has(fold(t)) || CAP.test(t));
  if (!core.length || core.length > 4 || !core.every((t) => CAP.test(t))) return null; // names are written with capitals
  if (toks.some((t) => /\d/.test(t))) return null;
  const kinds = core.map((t) => {
    const p = partsOf(t);
    if (!p.length) return null;
    if (p.some((x) => BRAND.has(x))) return 'brand';
    if (p.some((x) => PLACE.has(x))) return 'place';
    if (p.some((x) => GIVEN.has(x))) return 'given';
    if (p.some((x) => SURNAME.has(x))) return 'surname';
    if (p.some((x) => COMPANY.has(x))) return 'company';
    return null;
  });
  const known = kinds.filter(Boolean);
  if (!known.length) return null;
  const unknownOK = core.filter((t, i) => !kinds[i]).every((t) => !isLexical(t) && partsOf(t).join('').length >= 3);
  if (!unknownOK) return null;
  if (kinds.includes('given') || kinds.includes('surname')) {
    // "Maria Gonzalez", "Hans Müller", "Jane Doe"; a lone surname is too ambiguous, a lone given name is fine
    if (kinds.every((k) => k !== 'brand' && k !== 'place' && k !== 'company')) return core.length === 1 && kinds[0] === 'surname' ? null : 'person';
  }
  if (kinds.includes('brand') || kinds.includes('company')) return 'brand';
  if (kinds.includes('place')) return 'place';
  return null;
}

/** True when the text is shaped like a name: 1-4 capitalised words, none of them ordinary vocabulary of any supported language. */
export function nameShape(text) {
  const toks = tokens(text);
  if (!toks.length || toks.length > 4) return false;
  const core = toks.filter((t) => !PARTICLE.has(fold(t)) || CAP.test(t));
  if (!core.length || !core.every((t) => CAP.test(t) && !/^\p{Lu}{2,}$/u.test(t))) return false;
  if (core.some((t) => partsOf(t).join('').length < 3 || isLexical(t))) return false;
  return core.length > 1 || partsOf(core[0]).join('').length >= 4;
}

/** True when every word is ordinary interface vocabulary ("Order History", "Wish List"): such a phrase is a label, whatever it looks like. */
export function isLabel(text) {
  const toks = tokens(text).filter((t) => !PARTICLE.has(fold(t)));
  return toks.length > 0 && toks.every((t) => partsOf(t).length > 0 && partsOf(t).every((p) => p.length < 2 || ORDINARY.has(p)));
}
