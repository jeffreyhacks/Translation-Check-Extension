// Checks a PDF the browser has open. pdf.js extracts the text; blocks go through the same masking,
// broken-text rules, multi-model judgement and page-level logic as web pages.
// Dependencies (pdf.js, messaging) are injected so this runs in the popup AND in Node tests.
import { mask, compileTerms } from './mask.js';
import { detectBug } from './rules.js';

const MAX_PAGES = 300, MAX_BLOCKS = 6000;
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const usable = (t) => /\p{L}{2}/u.test(t);

/** Turn one page's positioned text items into paragraphs (lines grouped by spacing and font size). */
export function pageBlocks(items) {
  const blocks = [];
  let lines = [], line = null;
  const flushBlock = () => {
    if (!lines.length) return;
    let text = '';
    for (const l of lines) { // re-join words hyphenated across a line break
      if (text.endsWith('-') && /^\p{Ll}/u.test(l)) text = text.slice(0, -1) + l; else text += (text ? ' ' : '') + l;
    }
    text = clean(text);
    // very long blocks are split on sentence ends so each unit stays judgeable
    if (text.length > 700) { for (const part of text.match(/[^.!?。]+[.!?。]*\s*/g) || [text]) blocks.push(clean(part)); }
    else blocks.push(text);
    lines = [];
  };
  let prev = null; // {y, h} of the previous line
  const flushLine = () => {
    if (!line) return;
    const t = clean(line.text);
    if (t) {
      const gap = prev ? Math.abs(prev.y - line.y) : 0;
      const bigGap = prev && gap > 1.8 * Math.max(prev.h, line.h);
      const sizeChange = prev && Math.abs(prev.h - line.h) / Math.max(prev.h, line.h, 1) > 0.25;
      if (bigGap || sizeChange) flushBlock();
      lines.push(t);
      prev = { y: line.y, h: line.h };
    }
    line = null;
  };
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform ? it.transform[5] : 0, h = it.height || (it.transform ? Math.abs(it.transform[3]) : 10) || 10;
    if (line && Math.abs(line.y - y) > Math.max(2, 0.6 * h)) flushLine();
    if (!line) line = { text: '', y, h };
    line.text += it.str + (it.hasEOL ? ' ' : '');
    if (it.hasEOL) flushLine();
  }
  flushLine(); flushBlock();
  return blocks;
}

/**
 * @param {{pdfjs:object, data:Uint8Array, params:object, send:(msg:object)=>Promise<any>, onProgress?:(p:{stage:string,page?:number,pages?:number})=>void}} o
 */
export async function analyzePdf({ pdfjs, data, params, send, onProgress = () => {} }) {
  const p = {
    lang: params.lang, mode: params.mode || 'balanced', related: params.related !== false, verify: params.verify !== false,
    bugs: params.bugs !== false, confirmedOnly: !!params.confirmedOnly, ignore: params.ignore || [],
  };
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const pages = Math.min(doc.numPages, MAX_PAGES);

  // 1. extract paragraphs; identical blocks (running headers/footers) are judged once and remember every page
  const byText = new Map(), blocks = [];
  for (let n = 1; n <= pages && blocks.length < MAX_BLOCKS; n++) {
    onProgress({ stage: 'read', page: n, pages });
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    for (const text of pageBlocks(tc.items)) {
      if (!/\p{L}/u.test(text)) continue;
      const key = text.replace(/\d+/g, '#'); // running headers/footers differ only by page number
      const seen = byText.get(key);
      if (seen) { if (!seen.pages.includes(n)) seen.pages.push(n); continue; }
      const b = { text, pages: [n] };
      byText.set(key, b); blocks.push(b);
    }
    page.cleanup?.();
  }
  let metaLang = '';
  try { metaLang = (((await doc.getMetadata()).info || {}).Language || '').toLowerCase().split(/[-_]/)[0]; } catch (e) { /* no metadata */ }
  await doc.destroy?.();
  if (!blocks.length) return { error: 'No selectable text found. This PDF may be a scan (images only), which can’t be checked without OCR.' };

  // 2. target language ("auto" = the PDF's declared language, else the language most of it is written in)
  let lang = p.lang;
  if (lang === 'auto') {
    lang = metaLang || (await send({ type: 'tc-dominant', texts: blocks.map((b) => b.text).filter((t) => t.length >= 30).sort((a, b) => b.length - a.length) }))?.lang;
    if (!lang) return { error: 'Couldn’t tell which language this PDF is in. Pick a language instead of “auto”.' };
  }

  // 3. mask untranslatables, spot broken strings
  onProgress({ stage: 'judge' });
  const termRe = compileTerms(p.ignore);
  const items = [];
  let ignoredN = 0;
  for (const b of blocks) {
    if (p.bugs) { const bug = detectBug(b.text); if (bug) { items.push({ ...b, j: '', len: b.text.length, base: { v: 'bug', reason: bug } }); continue; } }
    const m = mask(b.text, lang, termRe);
    if (!usable(m.text)) { ignoredN++; continue; }
    items.push({ ...b, j: m.text, nameLike: m.nameLike, len: m.text.length });
  }

  // 4. judge through the shared multi-model worker
  const todo = items.filter((i) => !i.base);
  const longest = [...new Set(todo.map((i) => i.j))].filter((t) => t.length >= 30).sort((a, b) => b.length - a.length).slice(0, 40);
  const first = await send({ type: 'tc-classify', lang, related: p.related, verify: p.verify, htmlLang: metaLang, texts: [], ctxTexts: longest });
  if (!first || first.error) return { error: first?.error || 'The language engine did not respond. Try again.' };
  const ctx = first.ctx;
  let models = first.models;
  const verdict = new Map();
  const uniq = [...new Set(todo.map((i) => i.j))];
  for (let i = 0; i < uniq.length; i += 300) {
    const chunk = uniq.slice(i, i + 300);
    const res = await send({ type: 'tc-classify', lang, related: p.related, verify: p.verify, ctx, texts: chunk });
    if (!res || res.error) return { error: res?.error || 'The language engine did not respond. Try again.' };
    chunk.forEach((t, k) => verdict.set(t, res.verdicts[k]));
    models = res.models || models;
    onProgress({ stage: 'judge', done: Math.min(i + 300, uniq.length), total: uniq.length });
  }
  for (const it of todo) {
    let v = verdict.get(it.j);
    if (it.nameLike && v.v === 'bad' && v.reason !== 'Looks like English text') v = { v: 'unsure' };
    if (p.confirmedOnly && p.verify && v.v === 'bad' && v.votes && !v.confirmed) v = { v: 'unsure', reason: 'Not confirmed by a second model', votes: v.votes };
    it.base = v;
  }

  // 5. page-level tendency: a clearly translated document gets the benefit of the doubt on unclear short strings
  let okC = 0, badC = 0;
  for (const it of items) { if (it.base.v === 'ok') okC += it.len; else if (it.base.v === 'bad') badC += it.len; }
  const tendency = okC + badC ? okC / (okC + badC) : null;
  const assume = p.mode === 'relaxed' || (p.mode === 'balanced' && tendency !== null && tendency >= 0.6);
  const stats = { ok: 0, bad: 0, unsure: 0, bug: 0, fmt: 0, okN: 0, badN: 0, unsureN: 0, bugN: 0, fmtN: 0, assumedN: 0, ignoredN };
  const issues = [];
  let id = 0;
  for (const it of items) {
    let v = it.base;
    if (v.v === 'unsure' && assume) { v = { v: 'ok', assumed: true }; stats.assumedN++; }
    stats[v.v] += it.len; stats[v.v + 'N']++;
    if (v.v === 'ok') continue;
    issues.push({ id: ++id, verdict: v.v, kind: 'pdf', page: it.pages[0], pages: it.pages, text: it.text.slice(0, 300), len: it.len || it.text.length,
      detected: v.detected, reason: v.reason, votes: v.votes, confirmed: !!v.confirmed });
  }
  const order = { bug: 0, bad: 1, unsure: 2 };
  issues.sort((a, b) => order[a.verdict] - order[b.verdict] || b.len - a.len);
  const judged = stats.ok + stats.bad;
  return {
    kind: 'pdf', lang, requested: p.lang, mode: p.mode, pageLang: metaLang, stats, score: judged ? (stats.bad && stats.ok / judged >= 0.995 ? 99 : Math.round((stats.ok / judged) * 100)) : null, // 100% only with nothing untranslated
    issues: issues.slice(0, 300), allIssues: issues, truncated: Math.max(0, issues.length - 300), source: { status: 'pdf', pages }, models, live: false,
  };
}
