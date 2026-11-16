// The background worker registers the page script for "check this site automatically" (the popup can be closed by Chrome's permission prompt).
import { runWorker } from './harness.mjs';
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function worker({ autoSites = [], granted = [], scripts = [] } = {}) {
  const st = { autoSites, granted: new Set(granted), scripts: [...scripts], calls: { register: 0, unregister: 0 } };
  const L = { added: [], removed: [], changed: [], message: null, startup: [], installed: [] };
  runWorker({
    i18n: { detectLanguage: (t, cb) => cb(null) }, action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    runtime: { onMessage: { addListener: (f) => (L.message = f) }, onStartup: { addListener: (f) => L.startup.push(f) }, onInstalled: { addListener: (f) => L.installed.push(f) } },
    storage: { local: { get: async () => ({ autoSites: st.autoSites }) }, onChanged: { addListener: (f) => L.changed.push(f) } },
    permissions: { contains: async ({ origins }) => { if (origins.some((o) => /\s/.test(o))) throw new Error('Invalid value for origin pattern'); return origins.every((o) => st.granted.has(o)); },
      onAdded: { addListener: (f) => L.added.push(f) }, onRemoved: { addListener: (f) => L.removed.push(f) } },
    scripting: {
      getRegisteredContentScripts: async () => st.scripts.map((x) => ({ ...x })),
      registerContentScripts: async (a) => { st.calls.register++; st.scripts.push(...a.map((x) => ({ ...x }))); },
      unregisterContentScripts: async ({ ids }) => { st.calls.unregister++; st.scripts = st.scripts.filter((x) => !ids.includes(x.id)); },
    },
  });
  const sync = () => new Promise((res) => L.message({ type: 'tc-sync-auto' }, {}, res));
  return { st, L, sync };
}

{
  const w = worker({ autoSites: ['shop.example.com'], granted: ['https://shop.example.com/*'] });
  await w.sync();
  const s = w.st.scripts[0];
  t('auto: a saved, permitted site gets the page script registered, for the granted scheme only', w.st.scripts.length === 1 && s.id === 'auto-shop.example.com' && s.matches.join() === 'https://shop.example.com/*' && s.js[0] === 'content.js' && s.persistAcrossSessions === true && s.runAt === 'document_idle', JSON.stringify(w.st.scripts));
  await w.sync();
  t('auto: syncing again changes nothing', w.st.calls.register === 1 && w.st.calls.unregister === 0, JSON.stringify(w.st.calls));
  w.st.granted.add('http://shop.example.com/*'); await w.sync();
  t('auto: a newly granted scheme is added to the same registration', w.st.scripts.length === 1 && w.st.scripts[0].matches.join() === 'http://shop.example.com/*,https://shop.example.com/*', JSON.stringify(w.st.scripts));
}
{
  const w = worker({ autoSites: ['shop.example.com'] });
  await w.sync();
  t('auto: a saved site without the permission is not registered (e.g. the prompt was refused)', w.st.scripts.length === 0);
  w.st.granted.add('https://shop.example.com/*'); w.L.added.forEach((f) => f({ origins: ['https://shop.example.com/*'] })); await sleep(40);
  t('auto: the permission arriving later registers it, even if the popup is long gone', w.st.scripts.length === 1);
  w.st.granted.clear(); w.L.removed.forEach((f) => f({})); await sleep(40);
  t('auto: taking the permission away in Chrome unregisters it', w.st.scripts.length === 0);
}
{
  const w = worker({ autoSites: ['a.example.com', 'b.example.com'], granted: ['https://a.example.com/*', 'https://b.example.com/*'], scripts: [{ id: 'unrelated', matches: ['https://x/*'], js: ['x.js'] }] });
  await w.sync();
  t('auto: two sites, two registrations; scripts that are not ours are never touched', w.st.scripts.map((x) => x.id).sort().join() === 'auto-a.example.com,auto-b.example.com,unrelated', JSON.stringify(w.st.scripts.map((x) => x.id)));
  w.st.autoSites = ['b.example.com']; w.L.changed.forEach((f) => f({ autoSites: {} }, 'local')); await sleep(40);
  t('auto: removing a site from the list unregisters only that site', w.st.scripts.map((x) => x.id).sort().join() === 'auto-b.example.com,unrelated', JSON.stringify(w.st.scripts.map((x) => x.id)));
  const before = w.st.calls.register; w.L.changed.forEach((f) => f({ opts: {} }, 'local')); w.L.changed.forEach((f) => f({ autoSites: {} }, 'sync')); await sleep(40);
  t('auto: unrelated storage changes do not trigger a sync', w.st.calls.register === before && w.st.scripts.length === 2);
}
{
  const w = worker({ autoSites: ['bad host', 'ok.example.com'], granted: ['https://ok.example.com/*'] });
  await w.sync();
  t('auto: one invalid entry does not stop the others', w.st.scripts.map((x) => x.id).join() === 'auto-ok.example.com', JSON.stringify(w.st.scripts.map((x) => x.id)));
  const s = worker({ autoSites: ['ok.example.com'], granted: ['https://ok.example.com/*'] });
  s.L.startup.forEach((f) => f()); s.L.installed.forEach((f) => f({})); await sleep(60);
  t('auto: registrations are restored on browser start and after an update', s.st.scripts.length === 1 && s.st.calls.register === 1, JSON.stringify(s.st.calls));
}
console.log(`\nauto-check worker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
