# Real Chromium: names get their own verdict (counted, never highlighted), while English interface labels beside them are still flagged.
# Usage: python test/e2e/names.py
import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib, io
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]; SITE = ROOT/'test'/'e2e'/'site'; SHOTS = ROOT/'test'/'e2e'/'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
threading.Thread(target=socketserver.ThreadingTCPServer(('127.0.0.1', 8798), Q).serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js']: shutil.copy(ROOT/f, EXT)
shutil.copytree(ROOT/'icons', pathlib.Path(EXT)/'icons'); shutil.copytree(ROOT/'vendor', pathlib.Path(EXT)/'vendor')
m = json.load(open(pathlib.Path(EXT)/'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT)/'manifest.json', 'w'))
B = 'http://127.0.0.1:8798'
res = []
def t(n, c, x=''): res.append(bool(c)); print(('PASS  ' if c else 'FAIL  ') + n + ('' if c else '  ' + str(x)))
INIT = "window.__T=%r;const _q=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async(q)=>(q&&q.active&&q.currentWindow)?(await _q({})).filter(x=>x.url&&x.url.startsWith(window.__T)):_q(q);"
def yellow(pg, sel):
    from PIL import Image
    box = pg.eval_on_selector(sel, 'e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }')
    im = Image.open(io.BytesIO(pg.screenshot(clip=box))).convert('RGB')
    px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
    return sum(1 for (r, g, b) in px if r >= 235 and 195 <= g <= 238 and b <= 120)

with sync_playwright() as p:
    for attempt in range(4):                         # Chromium sometimes starts without loading the extension in this sandbox
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-prof-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
            args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 900, 'height': 700})
        sw = None
        for _ in range(60):
            if ctx.service_workers: sw = ctx.service_workers[0]; break
            time.sleep(0.2)
        if sw: break
        print(f'(extension did not start on launch {attempt + 1}, relaunching)'); ctx.close()
    if not sw: sys.exit('extension never started')
    ext = sw.url.split('/')[2]
    pg = ctx.new_page(); pg.goto(B + '/fr-names.html'); pg.bring_to_front()
    pop = ctx.new_page(); pop.add_init_script(INIT % (B + '/fr-names.html')); pop.goto(f'chrome-extension://{ext}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.5)
    pop.click('#scan'); time.sleep(1)
    for _ in range(150):
        if pop.evaluate("()=>!document.querySelector('#scan').disabled"): break
        time.sleep(0.3)
    time.sleep(0.5)
    chips = pop.eval_on_selector_all('#chips .chip', 'els => els.map(e => e.textContent.trim())')
    print('chips:', chips, ' bad:', pop.inner_text('#nBad'), ' unclear:', pop.inner_text('#nUnsure'), ' score:', pop.inner_text('#score'))
    t('popup: a "names" chip is shown', any('name' in c for c in chips), chips)
    pop.screenshot(path=str(SHOTS/'names-popup.png'))
    rows = pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    t('popup: the English labels are listed as untranslated', any('Top Rated' in r for r in rows) and any('Gift Cards' in r for r in rows), rows)
    t('popup: no name is listed as untranslated', not any(n in ' '.join(rows) for n in ['Maria', 'Müller', 'Zürich', 'Dupont', 'Janeiro']), rows)
    t('popup: nothing is left "unclear"', pop.inner_text('#nUnsure') == '0', pop.inner_text('#nUnsure'))
    pg.bring_to_front(); time.sleep(0.5)
    names = [yellow(pg, f'#n{i}') for i in range(1, 6)]
    t('page: no name is highlighted', all(n == 0 for n in names), names)
    t('page: the English labels are highlighted', yellow(pg, '#en1') > 150 and yellow(pg, '#en2') > 150, (yellow(pg, '#en1'), yellow(pg, '#en2')))
    t('page: the French label is not', yellow(pg, '#fr1') == 0, yellow(pg, '#fr1'))
    pg.screenshot(path=str(SHOTS/'names-page.png'))
    ctx.close()
print(f'\nnames e2e: {sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
