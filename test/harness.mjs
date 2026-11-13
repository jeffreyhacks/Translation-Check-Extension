import { JSDOM } from 'jsdom';
import fs from 'fs';

function stubHighlight(w) {
  w.Element.prototype.checkVisibility = () => true;
  w.Element.prototype.scrollIntoView = function () {};
  w.CSS = { highlights: { _m: new Map(), set(k, v) { this._m.set(k, v); }, delete(k) { this._m.delete(k); } } };
  w.Highlight = class { constructor(...r) { this.s = new Set(r); this.priority = 0; } add(r) { this.s.add(r); } get size() { return this.s.size; } };
}

/** Old (v1.2.0) build: model bundled inside content.js */
export function loadOld(html, { url = 'https://www.acmecloud.io/app' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const w = dom.window; let listener;
  stubHighlight(w);
  w.chrome = { i18n: { detectLanguage: (t, cb) => cb(null) }, runtime: { onMessage: { addListener: (f) => (listener = f) } } };
  w.eval(fs.readFileSync('/home/claude/baseline/content-v1.2.0.js', 'utf8'));
  return { w, call: (msg) => new Promise((r) => listener(msg, null, r)) };
}

/** New build: tiny content script + shared background worker */
export function loadNew(html, { url = 'https://www.acmecloud.io/app', fetchMap = {}, storage = {}, extra } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const w = dom.window; let contentListener; let bgListener;
  const bgCalls = { classify: 0, badges: [], results: 0 }, badge = { text: '' };
  const bgChrome = {
    i18n: { detectLanguage: (t, cb) => cb(null) },
    action: { setBadgeText: ({ text }) => { badge.text = text; }, setBadgeBackgroundColor() {} },
    runtime: { onMessage: { addListener: (f) => (bgListener = f) } },
  };
  globalThis.chrome = bgChrome;
  new Function(fs.readFileSync('background.js', 'utf8'))();
  stubHighlight(w);
  w.fetch = async (u) => {
    const body = fetchMap[u.split('#')[0]];
    if (body == null) throw new Error('network');
    return { ok: true, text: async () => body };
  };
  w.chrome = {
    i18n: { detectLanguage: (t, cb) => cb(null) },
    storage: { local: { get: async (keys) => storage } },
    runtime: {
      onMessage: { addListener: (f) => (contentListener = f) },
      sendMessage: (msg) => new Promise((resolve) => {
        if (msg.type === 'tc-classify') bgCalls.classify++;
        if (msg.type === 'tc-badge') bgCalls.badges.push(msg.count);
        if (msg.type === 'tc-result') { bgCalls.results++; bgCalls.lastResult = msg.result; }
        const ret = bgListener(msg, { tab: { id: 1 } }, resolve);
        if (ret !== true) setTimeout(() => resolve(undefined), 0);
      }),
    },
  };
  if (extra) extra(w);
  w.eval(fs.readFileSync('content.js', 'utf8'));
  return { w, bgCalls, badge, call: (msg) => new Promise((r) => contentListener(msg, null, r)) };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const page = (body, lang, head = '') => `<html lang="${lang}"><head><meta property="og:site_name" content="Acme Cloud">${head}</head><body>${body}</body></html>`;
