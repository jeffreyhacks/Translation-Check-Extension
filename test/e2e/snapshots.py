import http.server, socketserver, threading, time, json, os, shutil, tempfile, pathlib, re, base64
from playwright.sync_api import sync_playwright
# Report pictures, in real Chromium with the real extension: each finding in the downloaded report has a picture cropped from a real
# screenshot of the page, with the text boxed in its colour, and the page is scrolled back to where it was.
ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'test' / 'e2e' / 'site'
SHOTS = ROOT / 'test' / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 8798), Q); threading.Thread(target=httpd.serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js', 'learn.js']: shutil.copy(ROOT / f, EXT)
shutil.copytree(ROOT / 'icons', pathlib.Path(EXT) / 'icons'); shutil.copytree(ROOT / 'vendor', pathlib.Path(EXT) / 'vendor')
# the test copy stands in for the toolbar click (activeTab) with a host permission
m = json.load(open(pathlib.Path(EXT) / 'manifest.json')); m['host_permissions'] = ['<all_urls>']; json.dump(m, open(pathlib.Path(EXT) / 'manifest.json', 'w'))
B = 'http://127.0.0.1:8798'
res = []
def t(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS  ' if cond else 'FAIL  ') + name + ('' if cond else '  ' + str(extra)))
INIT = """
window.__T = %r;
const _q = chrome.tabs.query.bind(chrome.tabs);
chrome.tabs.query = async (q) => (q && q.active && q.currentWindow) ? (await _q({})).filter((x) => x.url && x.url.startsWith(window.__T)) : _q(q);
"""
with sync_playwright() as p:
    def launch():
        for attempt in range(4):
            c = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-profile-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
                args=['--headless=new', '--no-sandbox', '--window-size=1000,460', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], no_viewport=True, accept_downloads=True)  # a real short window: the page scrolls
            for _ in range(60):
                if c.service_workers: return c, c.service_workers[0]
                time.sleep(0.2)
            print(f'(extension did not start on launch {attempt + 1}, relaunching)'); c.close()
        raise SystemExit('extension never started')
    ctx, sw = launch()
    ext_id = sw.url.split('/')[2]
    page = ctx.new_page(); page.goto(B + '/de-projects.html')
    pop = ctx.new_page(); pop.add_init_script(INIT % (B + '/de-projects.html')); pop.goto(f'chrome-extension://{ext_id}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.4)
    page.bring_to_front(); time.sleep(0.5)  # the checked page is the visible tab (screenshots are of the visible tab)
    pop.evaluate("() => document.querySelector('#scan').click()"); time.sleep(0.8)
    end = time.time() + 90
    while time.time() < end and pop.evaluate("() => document.querySelector('#scan').disabled"): time.sleep(0.3)
    page.evaluate("() => window.scrollTo(0, 120)"); time.sleep(0.2)
    # the window and every box that scrolls on its own (this page scrolls its list inside a box)
    SCROLLS = "() => [window.scrollY, ...[...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4).map((e) => e.scrollTop)]"
    page.evaluate("() => [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4).forEach((e) => { e.scrollTop = 37; })")
    before = page.evaluate(SCROLLS); print('   scroll positions before:', before, 'window', page.evaluate("() => [innerWidth, innerHeight]"))
    with pop.expect_download(timeout=120000) as dl:
        pop.evaluate("() => document.querySelector('#expHtml').click()")
    path = dl.value.path(); html = open(path, encoding='utf-8').read()
    shutil.copy(path, SHOTS / 'report-with-pictures.html')
    imgs = re.findall(r'<img src="data:image/jpeg;base64,([^"]+)"', html)
    rows = html.count('<tr>') - 1
    findings = len(re.findall(r'<tr><td>(?:Not translated|Can’t tell|Broken text|Format hint)</td>', html))
    print(f'   {rows} rows, {findings} findings, {len(imgs)} pictures; status: {pop.inner_text("#status")}')
    t('e2e pictures: the report has an "On the page" column', '<th>On the page</th>' in html)
    t('e2e pictures: a picture for the findings on screen', len(imgs) >= max(1, findings - 3), (len(imgs), findings))
    from PIL import Image
    import io
    for n, b in enumerate(imgs[:6]): Image.open(io.BytesIO(base64.b64decode(b))).save(SHOTS / f'finding-{n + 1}.png')
    im = Image.open(io.BytesIO(base64.b64decode(imgs[0]))).convert('RGB') if imgs else None
    def has(col, img):
        px = list(img.get_flattened_data()) if hasattr(img, 'get_flattened_data') else img.getdata(); return sum(1 for r, g, b in px if abs(r - col[0]) < 40 and abs(g - col[1]) < 40 and abs(b - col[2]) < 40)
    def boxed_whole(b):  # the box (red for untranslated, orange for unclear) is closed: both of its sides are vertical lines that stop short of the picture's edges
        g = Image.open(io.BytesIO(base64.b64decode(b))).convert('RGB'); W, H = g.size  # (the page's own wavy underlines are horizontal, so they don't count)
        col = lambda p: p[0] > 170 and p[2] < 110 and (p[1] < 90 or 110 < p[1] < 170)
        sides = []
        for x in range(W):
            run = start = best = None; best = (0, 0, 0)
            for y in range(H):
                if col(g.getpixel((x, y))):
                    if run is None: run, start = 0, y
                    run += 1
                    if run > best[0]: best = (run, start, y)
                else: run = None
            if best[0] >= 10: sides.append(best)
        return len(sides) >= 2 and all(b0 > 0 and b1 < H - 1 for _, b0, b1 in sides)
    t('e2e pictures: every finding is boxed whole (not cut off at the edge of the picture)', all(boxed_whole(b) for b in imgs), [n for n, b in enumerate(imgs) if not boxed_whole(b)])
    t('e2e pictures: the finding is boxed in its colour', im and (has((215, 38, 61), im) > 60 or has((240, 138, 36), im) > 60))
    t('e2e pictures: pictures are a readable size (not the whole page, not a sliver)', im and 300 <= im.width <= 800 and im.height >= 40, im and im.size)
    def black(b):
        g = Image.open(io.BytesIO(base64.b64decode(b))).convert('L'); px = list(g.get_flattened_data()) if hasattr(g, 'get_flattened_data') else list(g.getdata())
        return sum(1 for v in px if v < 12) / len(px)
    t('e2e pictures: no picture has an unpainted (black) area, even right after scrolling', all(black(b) < 0.05 for b in imgs), [round(black(b), 2) for b in imgs])
    t('e2e pictures: the page is scrolled back to where it was', page.evaluate(SCROLLS) == before, (before, page.evaluate(SCROLLS)))
    t('e2e pictures: the popup says how many pictures', 'picture' in pop.inner_text('#status'), pop.inner_text('#status'))
    ctx.close()
print(f'\nsnapshots e2e: {sum(res)} passed, {len(res) - sum(res)} failed')
raise SystemExit(0 if all(res) else 1)
