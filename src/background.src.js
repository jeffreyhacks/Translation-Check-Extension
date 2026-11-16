// Service worker: hosts the language model once for the whole browser (instead of once per tab),
// and sets the toolbar badge.
import { createEngine } from './engine.js';
import { createVerifier } from './verify.js';

const api = globalThis.chrome;

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
      if (verify !== false) v = await verifier.verify(texts[k], lang, v, c.related);
      verdicts[k] = v;
    }
  }));
  return { verdicts, ctx: { sources: c.sources }, models: verifier.status() };
}

api.runtime.onMessage.addListener((msg, sender, send) => {
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
