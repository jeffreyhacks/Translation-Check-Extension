// Words that are essentially only English (not loanwords shared with other languages).
export const EN_SINGLE = new Set('submit search subscribe cart checkout settings loading cancel welcome shipping returns features pricing careers resources documentation overview please thanks sorry previous close save share follow about help delete'.split(' '));
export const EN_FN = new Set([...EN_SINGLE, ...('the and for with your you our this that from how what why when have if get started read learn view sign log out up add buy shop home click here its their them they who which were been new free more ' +
  'us customer support policy privacy shopping terms service services contact product products company frequently asked questions').split(' ')]);
