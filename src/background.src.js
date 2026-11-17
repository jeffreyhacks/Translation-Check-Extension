// Service worker: hosts the language model once for the whole browser (instead of once per tab),
// and sets the toolbar badge.
import { createEngine } from './engine.js';
import { createVerifier } from './verify.js';
import { guardShort } from './guard.js';
import { knownName, nameShape, isLabel } from './names.js';

const api = globalThis.chrome;
const CAPITALISES = new Set(['de', 'lb']); // German capitalises every noun, so a capitalised phrase there says nothing about names
const SCRIPT = /^(Written in |Latin-script text|Identical to the source)/; // a name spelled in another script is still a different script on the page

function cld(text) { // browser's built-in detector, used for languages the bundled model lacks
  return new Promise((resolve) => {
    try {
      const p = api.i18n.detectLanguage(text, resolve);
      if (p && typeof p.then === 'function') p.then(resolve, () => resolve(null));
    } catch (e) { resolve(null); }
  });
}
const engine = createEngine(cld);
const verifier = createVerifier(cld);

async function classify({ lang, texts = [], ctxTexts = [], htmlLang, related, ctx, verify }) {
  const c = ctx ? { ...ctx } : engine.pageContext(ctxTexts, lang, htmlLang);
  c.related = related !== false;
  const verdicts = new Array(texts.length);
  let i = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (i < texts.length) {
      const k = i++;
      let v = await engine.classify(texts[k], lang, c);
      const kind = v.v !== 'ok' && !SCRIPT.test(v.reason || '') && knownName(texts[k]); // a person, place or brand: not something to translate
      if (kind) { verdicts[k] = { v: 'name', reason: 'Looks like a name', kind }; continue; }
      if (verify !== false) v = await verifier.verify(texts[k], lang, v, c.related, { shape: !CAPITALISES.has(lang) && nameShape(texts[k]) });
      v = guardShort(texts[k], v, lang, c.related);
      verdicts[k] = v.v === 'bad' && isLabel(texts[k]) ? { ...v, label: true } : v; // a warning on plain interface words is not a name, whatever its capitals say
    }
  }));
  return { verdicts, ctx: { sources: c.sources }, models: verifier.status() };
}

// ---------- Sites checked automatically ----------
// The popup saves the site list and asks Chrome for the site's permission. Chrome's permission prompt can close the popup, so the page script
// is registered here, whenever the list or the granted permissions change, instead of in the popup.
let syncing = Promise.resolve();
const syncAuto = () => (syncing = syncing.then(doSyncAuto, doSyncAuto));
async function doSyncAuto() {
  try {
    const { autoSites = [] } = await api.storage.local.get('autoSites');
    const existing = await api.scripting.getRegisteredContentScripts();
    const wanted = new Map();
    for (const host of autoSites) {
      const matches = [];
      for (const scheme of ['http', 'https']) {
        const origin = `${scheme}://${host}/*`;
        try { if (await api.permissions.contains({ origins: [origin] })) matches.push(origin); } catch (e) { /* not a valid host */ }
      }
      if (matches.length) wanted.set('auto-' + host, matches);
    }
    const stale = existing.filter((x) => x.id.startsWith('auto-') && !wanted.has(x.id)).map((x) => x.id);
    if (stale.length) await api.scripting.unregisterContentScripts({ ids: stale });
    for (const [id, matches] of wanted) {
      const cur = existing.find((x) => x.id === id);
      if (cur && cur.matches.join() === matches.join()) continue;
      if (cur) await api.scripting.unregisterContentScripts({ ids: [id] });
      await api.scripting.registerContentScripts([{ id, matches, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
    }
  } catch (e) { /* tried again on the next change */ }
}
api.permissions?.onAdded?.addListener(syncAuto);
api.permissions?.onRemoved?.addListener(syncAuto);
api.storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.autoSites) syncAuto(); });
api.runtime.onStartup?.addListener(syncAuto);
api.runtime.onInstalled?.addListener(syncAuto);

api.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type === 'tc-inject') { // the popup can't inject the page script itself in some browsers (Vivaldi); the worker always can
    api.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['content.js'] })
      .then(() => send({ ok: true }), (e) => send({ error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg?.type === 'tc-sync-auto') {
    syncAuto().then(() => send({ ok: true }));
    return true;
  }
  if (msg?.type === 'tc-classify') {
    classify(msg).then(send, (e) => send({ error: String(e) }));
    return true;
  }
  if (msg?.type === 'tc-dominant') { // language of a document that doesn't declare one (PDFs)
    send({ lang: engine.dominant(msg.texts || []) });
    return false;
  }
  if (msg?.type === 'tc-badge' && sender.tab?.id != null) {
    const n = msg.count | 0;
    api.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#d7263d' });
    api.action.setBadgeText({ tabId: sender.tab.id, text: n > 0 ? (n > 99 ? '99+' : String(n)) : '' });
    send({ ok: true });
  }
  return false;
});
