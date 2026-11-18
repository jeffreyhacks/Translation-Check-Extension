// Service worker: hosts the language model once for the whole browser (instead of once per tab),
// and sets the toolbar badge.
import { createEngine, norm, groupOf } from './engine.js';
import { createVerifier } from './verify.js';
import { guardShort } from './guard.js';
import { knownName, nameShape, isLabel } from './names.js';
import { allEnglish, sharedEntirely } from './english.js';
import { nonLatinTarget, latinOnly } from './scripts.js';

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
      if (verify !== false) v = await verifier.verify(texts[k], lang, v, c.related, { shape: !CAPITALISES.has(lang) && nameShape(texts[k]), sources: c.sources || [] });
      v = guardShort(texts[k], v, lang, c.related);
      // On a page in another script, Latin text that merely looks like a name (models disagree, every word capitalised) is listed for a decision
      // ("Wisight Sytems Developer"), not silently counted as a name. Names from the built-in lists were already taken out above.
      if (v.v === 'name' && nonLatinTarget(lang) && latinOnly(texts[k])) v = { v: 'unsure', reason: 'Name or title? Latin letters on a page in another script', votes: v.votes };
      // an unclear text made only of English words must not be cleared later by its section's verdict on a non-English page
      if (v.v === 'unsure' && lang !== 'en' && allEnglish(texts[k])) v = { ...v, enVocab: true };
      // every word also a word of the target language (by its word list: "Status", "Export" on a German page): genuinely shared vocabulary
      if (v.v === 'unsure' && lang !== 'en' && sharedEntirely(texts[k], lang)) v = { ...v, shared: true };
      verdicts[k] = v.v === 'bad' && isLabel(texts[k]) ? { ...v, label: true } : v; // a warning on plain interface words is not a name, whatever its capitals say
    }
  }));
  return { verdicts, ctx: { sources: c.sources }, models: verifier.status() };
}

// "Page's own language". Many apps switch the interface language without updating <html lang>, which then keeps saying "en".
// English is where untranslated text comes from, so the two directions differ:
//   - the page declares English (or nothing) but most of its longer text is another language (50%+): it is a translation in progress,
//     check it in that language (its English leftovers are what the check is for);
//   - the page declares another language: keep it, even if much of the page is still English (that English is the untranslated part),
//     unless the declared language is essentially absent (under 10%) and another one clearly dominates (60%+): a stale lang attribute.
function pageLanguage(texts, declaredRaw) {
  const declared = declaredRaw ? norm(declaredRaw) : '';
  const { tally, total } = engine.shares(texts);
  const g = (l) => groupOf(l)[0];
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const topOther = ranked.find(([l]) => l !== 'en');
  const declaredShare = declared ? Object.entries(tally).filter(([l]) => g(l) === g(declared)).reduce((a, [, v]) => a + v, 0) : 0;
  let lang = declared;
  if (total >= 60) {
    if ((!declared || declared === 'en') && topOther && topOther[1] >= 0.5) lang = topOther[0];
    else if (declared && declared !== 'en' && top && declaredShare < 0.1 && top[1] >= 0.6 && g(top[0]) !== g(declared)) lang = top[0];
  }
  if (!lang && top && total >= 60 && top[1] >= 0.4) lang = top[0]; // no lang attribute: the page's own text, when there is enough of it
  return { lang, declared, detected: top ? top[0] : '', share: top ? Math.round(top[1] * 100) : 0, declaredShare: Math.round(declaredShare * 100) };
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
  if (msg?.type === 'tc-pagelang') { // "Page's own language": the declared language, unless the page's text is clearly in another one
    send(pageLanguage(msg.texts || [], msg.declared || ''));
    return false;
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
