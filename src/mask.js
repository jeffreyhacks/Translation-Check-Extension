// Removes things that should never be "translated": numbers, durations, versions, codes,
// model/product identifiers, URLs, acronyms, brand names. What's left is the translatable text.
import { EN_FN } from './lexicon.js';

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
const CAPITALISES_NOUNS = new Set(['de', 'lb']);
const isCap = (c) => c.length >= 2 && /^\p{Lu}\p{Ll}/u.test(c);
const SENTENCE_END = /[.!?:;。！？]$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile user/site terms ("never flag") into one regex. */
export function compileTerms(terms) {
  const list = [...new Set((terms || []).map((t) => String(t).trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** @returns {{text:string, nameLike:boolean, removed:boolean}} */
export function mask(input, lang, termRe) {
  let s = input;
  if (termRe) s = s.replace(termRe, ' ');
  for (const re of PATTERNS) s = s.replace(re, ' ');
  const upperAll = input === input.toUpperCase() && /\s/.test(input.trim()); // SHOUTED sentences: don't treat words as acronyms

  let toks = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    if (/\/\/|^[/~]|\/.*\//.test(raw)) continue;           // paths
    for (const part of raw.split('/')) if (part) toks.push(part);
  }
  const kept = [];
  for (const raw of toks) {
    const core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!core) continue;
    if (/\d/.test(core)) continue;                          // gpt-6-luna, 4K, mp3, v2, B2B
    if (/[_@#\\]/.test(raw)) continue;                      // snake_case, @handles, #tags
    if (/\p{L}[.:]\p{L}/u.test(core)) continue;             // file.txt, example.com
    if (/\p{Ll}\p{Lu}/u.test(core)) continue;               // iPhone, YouTube, camelCase
    if (!upperAll && /^\p{Lu}{2,5}$/u.test(core) && !EN_FN.has(core.toLowerCase())) continue; // API, USB, PDF
    kept.push({ raw, core });
  }

  // Capitalised words in the middle of a sentence are usually names (not for German, which capitalises nouns).
  let list = kept;
  if (!CAPITALISES_NOUNS.has(lang) && kept.length >= 3 && kept.filter((k) => isCap(k.core)).length / kept.length <= 0.5) {
    list = kept.filter((k, i) => i === 0 || !isCap(k.core) || SENTENCE_END.test(kept[i - 1].raw));
  }

  const removed = list.length < toks.length || s !== input;
  const nameLike = (list.length >= 2 && list.length <= 3 && list.every((k) => isCap(k.core))) ||
                   (removed && list.length === 1 && isCap(list[0].core));
  return { text: list.map((k) => k.core).join(' '), nameLike, removed };
}
