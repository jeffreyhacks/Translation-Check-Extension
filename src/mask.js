// Removes things that should never be "translated": numbers, durations, versions, codes,
// model/product identifiers, URLs, acronyms, brand names. What's left is the translatable text.
import { EN_FN } from './lexicon.js';
import { dateRe } from './dates.js';

const UNITS = 'ms|secs?|s|mins?|m|hrs?|h|d|w|y|b|kb|mb|gb|tb|kib|mib|gib|k|km|cm|mm|kg|g|mg|ml|l|fps|hz|khz|mhz|ghz|px|pt|em|rem|x|dpi|bpm|rpm|mbps|kbps|gbps|kw|kwh|mah|mp|v|°c|°f|°|%';
const PATTERNS = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,                       // URLs
  /\bwww\.\S+/gi,
  /\S+@\S+\.\S+/g,                                       // emails
  /\bv\d[\w.+-]*/gi,                                     // v2, v1.2.3-beta
  /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?/gi,       // 2:30, 10:30 pm, 1:02:03
  /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g,                    // 2026-11-12, 12/11/2026
  /[$€£¥₹₩₽₺₦]\s?\d[\d.,]*|\d[\d.,]*\s?[$€£¥₹₩₽₺₦]/g,    // currency
  new RegExp(`\\d[\\d.,]*\\s?(?:${UNITS})(?![\\p{L}])`, 'giu'), // 154m 32s, 5 GB, 30 fps, 50%
];
// International terms used untranslated inside sentences in almost every language.
const INTL = new Set('admin dashboard playground feedback trainee trainees coach coaching onboarding workflow chatbot bot ai api app apps cloud server software hardware online offline login logout newsletter podcast webinar workshop meeting deadline download upload link links chat blog smartphone laptop tool tools team'.split(' '));
// Names of languages (language switchers list "Turkish", "German", "Türkçe"…) are labels, never text to translate.
const NAME_CODES = 'af am ar az be bg bn bs ca cs cy da de el en es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko lt lv mk ml mn mr ms my nb ne nl no pa pl pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh zu la eo'.split(' ');
let LANG_NAMES = null;
function langNames() {
  if (LANG_NAMES) return LANG_NAMES;
  LANG_NAMES = { en: new Set(), native: new Set() };
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'language' });
    for (const c of NAME_CODES) {
      const e = en.of(c); if (e && e !== c) LANG_NAMES.en.add(e);
      try { const n = new Intl.DisplayNames([c], { type: 'language' }).of(c); if (n && n !== c) LANG_NAMES.native.add(n.toLowerCase()); } catch (err) { /* unsupported */ }
    }
  } catch (err) { /* Intl.DisplayNames unavailable */ }
  return LANG_NAMES;
}
const isLangName = (core) => { const n = langNames(); return n.en.has(core) || n.native.has(core.toLowerCase()); };

const CAPITALISES_NOUNS = new Set(['de', 'lb']);
const isCap = (c) => c.length >= 2 && /^\p{Lu}\p{Ll}/u.test(c);
const SENTENCE_END = /[.!?:;。！？]$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Technical terms that stay in English in every language's interface: allowed, so they are set aside like codes instead of ending up as
// "can't tell" ("REST API" in a "Typ" column). Matched as whole words, capitals ignored. Users add their own with Ignore.
export const TECH_TERMS = ['REST API', 'REST-API', 'RESTful', 'API', 'APIs', 'API key', 'URL', 'URLs', 'URI', 'HTTP', 'HTTPS', 'JSON', 'XML', 'YAML', 'CSV',
  'SDK', 'SSO', 'SAML', 'OAuth', 'OAuth 2.0', 'OAuth2', 'OpenID Connect', 'JWT', 'Webhook', 'Webhooks', 'GraphQL', 'gRPC', 'WebSocket', 'WebSockets', 'SOAP',
  'SQL', 'NoSQL', 'SMTP', 'IMAP', 'SFTP', 'FTP', 'SSH', 'DNS', 'CDN', 'VPN', 'LDAP', 'SCIM', 'UUID', 'CLI', 'S3', 'MFA', '2FA', 'TOTP'];

/** Compile user/site terms ("never flag") into one regex. */
export function compileTerms(terms) {
  const list = [...new Set((terms || []).map((t) => String(t).trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
}

/** @returns {{text:string, nameLike:boolean, removed:boolean}} */
export function mask(input, lang, termRe) {
  let s = input;
  if (termRe) s = s.replace(termRe, ' ');
  const dates = dateRe(lang); // "10. Nov. 2026", "Nov 10, 2026": formatted by the app, never text to translate
  if (dates) s = s.replace(dates, ' ');
  for (const re of PATTERNS) s = s.replace(re, ' ');
  const upperAll = input === input.toUpperCase() && /\s/.test(input.trim()); // SHOUTED sentences: don't treat words as acronyms

  let toks = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    if (/\/\/|^[/~]|\/.*\//.test(raw)) continue;           // paths
    for (const part of raw.split('/')) if (part) toks.push(part);
  }
  const kept = [];
  for (const raw of toks) {
    const core = raw.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
    if (!core) continue;
    if (/\d/.test(core)) continue;                          // gpt-6-luna, 4K, mp3, v2, B2B
    if (isLangName(core)) continue;                         // Turkish, German, Deutsch, Türkçe
    if (/[_@#\\]/.test(raw)) continue;                      // snake_case, @handles, #tags
    if (/\p{L}[.:]\p{L}/u.test(core)) continue;             // file.txt, example.com
    if (/\p{Ll}\p{Lu}/u.test(core)) continue;               // iPhone, YouTube, camelCase
    if (!upperAll && /^\p{Lu}{2,5}$/u.test(core) && !EN_FN.has(core.toLowerCase())) continue; // API, USB, PDF
    kept.push({ raw, core });
  }

  // International tech terms inside a sentence never count as text to translate.
  if (lang !== 'en') {
    const rest = kept.filter((k) => !INTL.has(k.core.toLowerCase()));
    if (rest.length && rest.length < kept.length) kept.splice(0, kept.length, ...rest); // only when real words remain
  }

  // Capitalised words in the middle of a sentence are usually names (not for German, which capitalises nouns).
  let list = kept;
  if (!CAPITALISES_NOUNS.has(lang) && kept.length >= 3 && kept.filter((k) => isCap(k.core)).length / kept.length <= 0.5) {
    list = kept.filter((k, i) => i === 0 || !isCap(k.core) || SENTENCE_END.test(kept[i - 1].raw));
  }

  const removed = list.length < toks.length || s !== input;
  const nameLike = (list.length >= 2 && list.length <= 3 && list.every((k) => isCap(k.core))) ||
                   (removed && list.length === 1 && isCap(list[0].core)) ||
                   (list.length === 1 && /^\p{Lu}\p{L}{3,}(?:-\p{Lu}\p{L}{3,})+$/u.test(list[0].core)); // Garmisch-Partenkirchen, Saint-Étienne
  return { text: list.map((k) => k.core).join(' '), nameLike, removed };
}
