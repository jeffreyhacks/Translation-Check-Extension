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
