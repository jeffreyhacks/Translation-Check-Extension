// Words that are essentially only English (not loanwords shared with other languages).
export const EN_SINGLE = new Set('submit search subscribe cart checkout settings loading cancel welcome shipping returns features pricing careers resources documentation overview please thanks sorry previous close save share follow about help delete done apply reset next remove select show hide pending'.split(' '));
// English function/UI words: strong evidence that text is English.
export const EN_FN = new Set([...EN_SINGLE, ...('the and for with your you our this that from how what why when have if get started read learn view sign log out up add buy click here its their them they who which were been new free more ' +
  'us customer policy privacy shopping terms company frequently asked questions').split(' ')]);
// Words that are English but ALSO valid in French/German/Spanish/etc. They may sit inside an English phrase but never prove English alone.
export const EN_WEAK = new Set('contact support product products service services home shop menu team'.split(' '));
