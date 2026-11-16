# Real Chromium: marks left on a page by an OLDER copy of the extension (the old script keeps running in tabs that were not reloaded
# after the extension was updated) must not survive a new check. Usage: python test/e2e/ghost.py
import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib, io
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]; SITE = ROOT/'test'/'e2e'/'site'; SHOTS = ROOT/'test'/'e2e'/'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
threading.Thread(target=socketserver.ThreadingTCPServer(('127.0.0.1', 8797), Q).serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js']: shutil.copy(ROOT/f, EXT)
shutil.copytree(ROOT/'icons', pathlib.Path(EXT)/'icons'); shutil.copytree(ROOT/'vendor', pathlib.Path(EXT)/'vendor')
m = json.load(open(pathlib.Path(EXT)/'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT)/'manifest.json', 'w'))
B = 'http://127.0.0.1:8797'
res = []
def t(n, c, x=''): res.append(bool(c)); print(('PASS  ' if c else 'FAIL  ') + n + ('' if c else '  ' + str(x)))
INIT = "window.__T=%r;const _q=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async(q)=>(q&&q.active&&q.currentWindow)?(await _q({})).filter(x=>x.url&&x.url.startsWith(window.__T)):_q(q);"

# What the previous versions put on a page: highlights under the names tc-bad / tc-unsure, a <style id="tc-style">, and data-tc-flag outlines.
# Planted from the page's own JS world, i.e. a world the new content script does not own, exactly like an orphaned old script.
# The MutationObserver imitates the old script's live mode, which re-asserts its highlights whenever the page changes.
GHOST = """() => {
  const st = document.createElement('style'); st.id = 'tc-style';
  st.textContent = '::highlight(tc-bad){background-color:rgba(255,214,0,.7);color:#111;text-decoration:underline wavy #d7263d}'
    + '::highlight(tc-unsure){background-color:rgba(80,140,255,.28);text-decoration:underline dotted #3b6df0}'
    + '[data-tc-flag="bad"]{outline:2px dashed #d7263d!important;outline-offset:2px!important}';
  document.head.append(st);
  const rng = (el) => { const r = document.createRange(); r.selectNodeContents(el.firstChild); return r; };
  const p = document.querySelector('p'), h = document.querySelector('h1');
  const bad = new Highlight(rng(p)), unsure = new Highlight(rng(h));
  CSS.highlights.set('tc-bad', bad); CSS.highlights.set('tc-unsure', unsure);
  h.setAttribute('data-tc-flag', 'bad');
  new MutationObserver(() => { CSS.highlights.set('tc-bad', bad); CSS.highlights.set('tc-unsure', unsure); }).observe(document.body, { childList: true, subtree: true, characterData: true });
}"""
def yellow(pg, sel):
    """Number of 'untranslated-highlight yellow' pixels inside the element, from a real screenshot."""
    from PIL import Image
    box = pg.eval_on_selector(sel, 'e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }')
    im = Image.open(io.BytesIO(pg.screenshot(clip=box))).convert('RGB')
    px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
    return sum(1 for (r, g, b) in px if r >= 235 and 195 <= g <= 238 and b <= 120)

with sync_playwright() as p:
    for attempt in range(4):                         # Chromium sometimes starts without loading the extension in this sandbox
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-prof-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
            args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 900, 'height': 640})
        sw = None
        for _ in range(60):
            if ctx.service_workers: sw = ctx.service_workers[0]; break
            time.sleep(0.2)
        if sw: break
        print(f'(extension did not start on launch {attempt + 1}, relaunching)'); ctx.close()
    if not sw: sys.exit('extension never started')
    ext = sw.url.split('/')[2]
    es = ctx.new_page(); es.goto(B + '/es.html'); es.bring_to_front()
    t('setup: a clean page has no yellow before anything is planted', yellow(es, 'p') == 0, yellow(es, 'p'))
    es.evaluate(GHOST); time.sleep(0.3)
    before = yellow(es, 'p')
    t('setup: the planted old-version highlight is visibly yellow', before > 200, before)
    es.screenshot(path=str(SHOTS/'ghost-before.png'))

    pop = ctx.new_page(); pop.add_init_script(INIT % (B + '/es.html')); pop.goto(f'chrome-extension://{ext}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.5)
    pop.click('#scan'); time.sleep(1)
    for _ in range(100):
        if pop.evaluate("()=>!document.querySelector('#scan').disabled"): break
        time.sleep(0.3)
    time.sleep(0.5)
    t('scan: this clean page is reported as 100%, nothing untranslated', pop.inner_text('#score') == '100%' and pop.inner_text('#nBad') == '0', pop.inner_text('#score') + ' ' + pop.inner_text('#nBad'))
    es.bring_to_front(); time.sleep(0.4)
    after = yellow(es, 'p')
    t('scan: the leftover yellow highlight is gone after a new check', after == 0, after)
    t('scan: the leftover outline on the heading is gone', es.evaluate("getComputedStyle(document.querySelector('h1')).outlineStyle") == 'none')
    es.evaluate("document.body.insertAdjacentHTML('beforeend', '<p id=other>Gracias por su visita.</p>')"); time.sleep(2.5)
    t('live: the old script re-asserting its highlight after a page change does not bring the yellow back', yellow(es, 'p') == 0, yellow(es, 'p'))
    es.screenshot(path=str(SHOTS/'ghost-after.png'))

    # ...and real warnings still show
    es.evaluate("document.body.insertAdjacentHTML('beforeend', '<p id=late>Our new model is shipping this week with free delivery for everyone.</p>')"); time.sleep(3)
    t('real warnings still highlight: English text added to the Spanish page is yellow', yellow(es, '#late') > 150, yellow(es, '#late'))
    t('real warnings do not light up the Spanish paragraph next to it', yellow(es, 'p') == 0, yellow(es, 'p'))
    es.screenshot(path=str(SHOTS/'ghost-real-warning.png'))
    pop.bring_to_front(); pop.click('#clear'); time.sleep(0.6); es.bring_to_front(); time.sleep(0.3)
    t('Clear removes every highlight, including the English one', yellow(es, '#late') == 0 and yellow(es, 'p') == 0, (yellow(es, '#late'), yellow(es, 'p')))
    ctx.close()
print(f'\nghost e2e: {sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
