# Local (file://) PDF in real Chromium: the extension asks for file:///* in the click, then reads and checks the file,
# and the popup logs no "Not allowed to load local resource" error (a refused first read used to show on the extensions page).
import os, json, time, tempfile, shutil, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js']: shutil.copy(ROOT / f, EXT)
shutil.copytree(ROOT / 'icons', pathlib.Path(EXT) / 'icons'); shutil.copytree(ROOT / 'vendor', pathlib.Path(EXT) / 'vendor')
PDF = (ROOT / 'test' / 'e2e' / 'site' / 'handbook.pdf').as_uri()
res = []
def t(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS  ' if cond else 'FAIL  ') + name + ('' if cond else '  ' + str(extra)))
with sync_playwright() as p:
    prof = tempfile.mkdtemp(prefix='tc-profile-')
    def launch():
        for _ in range(4):
            c = p.chromium.launch_persistent_context(prof, executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
                args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
            for _ in range(60):
                if c.service_workers: return c
                time.sleep(0.2)
            c.close()
        raise SystemExit('extension never started')
    ctx = launch(); ext = ctx.service_workers[0].url.split('/')[2]
    ctx.new_page().goto(PDF); time.sleep(1)
    pg = ctx.new_page(); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    # stands in for the toolbar click: activeTab reveals the PDF tab's address to the popup
    pg.add_init_script("const _q=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async(q)=>{if(q&&q.active&&q.currentWindow){const all=await _q({});const t=all.find(x=>!(x.url||'').startsWith('chrome-extension:')&&!(x.pendingUrl||'').startsWith('chrome-extension:')&&x.id!==all[0].id)||all[1];return [{...t,url:'%s'}];}return _q(q);};" % PDF)
    pg.goto(f'chrome-extension://{ext}/popup.html'); pg.wait_for_selector('#langInput'); time.sleep(0.5)
    t('local pdf: tab is recognised as a PDF', pg.inner_text('#scan').strip() == 'Check PDF', pg.inner_text('#scan'))
    pg.click('#scan'); time.sleep(1)
    for _ in range(200):
        if not pg.evaluate("() => document.querySelector('#scan').disabled"): break
        time.sleep(0.3)
    chips = pg.eval_on_selector_all('#chips .chip', 'e => e.map(x => x.textContent)')
    t('local pdf: read and checked after allowing file access', pg.evaluate("() => !document.querySelector('#result').hidden") and any('PDF' in c for c in chips), pg.inner_text('#status'))
    t('local pdf: no "Not allowed to load local resource" error in the popup', not any('local resource' in e for e in errs), errs)
    ctx.close()
print(f'\nlocal pdf e2e: {sum(res)} passed, {len(res) - sum(res)} failed')
raise SystemExit(0 if all(res) else 1)
