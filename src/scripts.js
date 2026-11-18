// Languages whose pages are written in a script other than Latin. Shared by the language engine and the page script.
export const TARGET_SCRIPTS = {
  ru: ['cyrillic'], uk: ['cyrillic'], bg: ['cyrillic'],
  ar: ['arabic'], fa: ['arabic'], ur: ['arabic'], he: ['hebrew'],
  hi: ['devanagari'], bn: ['bengali'], ta: ['tamil'], te: ['telugu'],
  th: ['thai'], el: ['greek'], ja: ['han', 'kana'], zh: ['han'], ko: ['hangul'],
};

/** True when pages in `lang` are not written in Latin letters (so Latin-letter text there can never be in that language). */
export const nonLatinTarget = (lang) => !!TARGET_SCRIPTS[lang] && !TARGET_SCRIPTS[lang].includes('latin');
/** True when every letter of the text is a Latin letter (and there is at least one). */
export const latinOnly = (text) => { const l = text.match(/\p{L}/gu) || []; return l.length > 0 && l.every((c) => /\p{Script=Latin}/u.test(c)); };
