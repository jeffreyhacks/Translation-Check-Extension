// Letter inventories of Latin-script languages. A language is IMPOSSIBLE for a text if the text contains a
// non-ASCII letter that language's alphabet doesn't have (e.g. "ä" never occurs in Turkish). This guards against
// several models agreeing on the same wrong guess, which happens a lot on short fragments.
const A = (s) => new Set([...s]);
const ALPHA = {
  de: A('äöüß'), tr: A('çğıöşüâîû'), fr: A('àâæçéèêëîïôœùûüÿ'), es: A('áéíñóúü'), pt: A('áâãàçéêíóôõúü'),
  it: A('àèéìíîòóùú'), nl: A('ëïéèêáóöüíúô'), sv: A('åäöé'), da: A('æøåé'), no: A('æøåéèêóò'),
  fi: A('äöåšž'), pl: A('ąćęłńóśźż'), cs: A('áčďéěíňóřšťúůýž'), sk: A('áäčďéíĺľňóôŕšťúýž'),
  hu: A('áéíóöőúüű'), ro: A('ăâîșțşţ'), hr: A('čćđšž'), sl: A('čšž'), ca: A('àçéèíïóòúü'),
  id: A(''), ms: A(''), sw: A(''), en: A(''),
};
const FAMILY = { sr: 'hr', bs: 'hr' };

/** @returns {boolean} true if `lang` cannot have produced `text` */
export function impossible(text, lang) {
  const set = ALPHA[FAMILY[lang] || lang];
  if (!set) return false; // unknown language: no opinion
  for (const ch of text.normalize('NFC').toLowerCase()) {
    if (ch.charCodeAt(0) > 127 && /\p{L}/u.test(ch) && !set.has(ch) && /\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

// The reverse check: languages whose words almost all carry their own marks. 15+ letters of plain a-z is not Czech, Polish, Slovak, Hungarian...
// (tinyld calls Dutch compounds such as "Systeemconfiguratie" Czech). Languages often written without marks (hr, sl, ro on old keyboards) are left out.
const MARKED = { cs: /[áčďéěíňóřšťúůýž]/, sk: /[áäčďéíĺľňóôŕšťúýž]/, pl: /[ąćęłńóśźż]/, hu: /[áéíóöőúüű]/, tr: /[çğıöşü]/, lv: /[āčēģīķļņšūž]/, lt: /[ąčęėįšųūž]/,
  is: /[áðéíóúýþæö]/, vi: /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/ };
/** @returns {boolean} true if `lang` cannot have produced `text`: letters it lacks, or a long text without any of the marks it always has */
export function implausible(text, lang) {
  if (impossible(text, lang)) return true;
  const re = MARKED[lang];
  if (!re) return false;
  const t = text.normalize('NFC').toLowerCase();
  return (t.match(/\p{L}/gu) || []).length >= 15 && !re.test(t);
}
