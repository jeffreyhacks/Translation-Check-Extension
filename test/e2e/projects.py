import http.server, socketserver, threading, time, json, os, shutil, tempfile, pathlib, csv, io
from playwright.sync_api import sync_playwright
# Reported German "Projekte" list, in real Chromium with the real extension: no project name is dropped, unclear text gets an orange wavy
# underline, pointing at it shows a card with the reason and the votes, and its buttons decide (the popup follows).
ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'test' / 'e2e' / 'site'
SHOTS = ROOT / 'test' / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 8797), Q); threading.Thread(target=httpd.serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js', 'learn.js']: shutil.copy(ROOT / f, EXT)
shutil.copytree(ROOT / 'icons', pathlib.Path(EXT) / 'icons'); shutil.copytree(ROOT / 'vendor', pathlib.Path(EXT) / 'vendor')
m = json.load(open(pathlib.Path(EXT) / 'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT) / 'manifest.json', 'w'))
B = 'http://127.0.0.1:8797'
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
                args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1100, 'height': 760}, accept_downloads=True)
            for _ in range(60):
                if c.service_workers: return c, c.service_workers[0]
                time.sleep(0.2)
            print(f'(extension did not start on launch {attempt + 1}, relaunching)'); c.close()
        raise SystemExit('extension never started')
    ctx, sw = launch()
    ext_id = sw.url.split('/')[2]
    page = ctx.new_page(); page.goto(B + '/de-projects.html'); page.bring_to_front()
    pop = ctx.new_page(); pop.add_init_script(INIT % (B + '/de-projects.html')); pop.goto(f'chrome-extension://{ext_id}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.4)
    def run():
        pop.click('#scan'); time.sleep(0.8)
        end = time.time() + 90
        while time.time() < end and pop.evaluate("() => document.querySelector('#scan').disabled"): time.sleep(0.3)
        time.sleep(0.3)
    run()
    t('e2e projects: "Mark unclear text" is on by default', pop.evaluate("() => document.querySelector('#unsure').checked"))
    pop.click('#tabUnsure')
    un = pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    for x in ['Smart Service Analytics', 'Testproj123', 'Solan → Bhayla Manufacturing Transition']:
        t(f'e2e projects: "{x}" is listed as unclear', any(r.startswith(x) for r in un), un)
    cov = pop.inner_text('#coverage'); print('   coverage:', cov)
    t('e2e projects: the coverage line is shown', 'scanned' in cov and 'unclear' in cov, cov)
    hl = page.evaluate("(() => { const k = [...CSS.highlights.keys()].find(k => /-unsure$/.test(k)); return k ? [...CSS.highlights.get(k)].map(r => r.toString().trim()) : []; })()")
    t('e2e projects: unclear names are marked on the page', 'Smart Service Analytics' in hl and 'Testproj123' in hl, hl)
    # pixel check: every unclear name in the column really shows an orange wavy line (Chrome drops highlight underlines on some rows when the
    # line thickness is left to the browser and the highlight has no background)
    from PIL import Image
    page.locator('td div', has_text='Session Management').first.scroll_into_view_if_needed(); time.sleep(0.3)
    full = str(SHOTS) + '/page-projects.png'; page.screenshot(path=full); shot = Image.open(full).convert('RGB')
    def orange(name):
        b = page.locator('td div', has_text=name).first.bounding_box()
        crop = shot.crop((int(b['x']), int(b['y']), int(b['x'] + b['width']), int(b['y'] + b['height'] + 6)))
        return sum(1 for px in crop.getdata() if px[0] > 200 and 60 < px[1] < 160 and px[2] < 90)
    counts = {n: orange(n) for n in ['Truecost', 'Session Management', 'Smart Service Analytics', 'Wisight Mapping', 'TrueCost', 'Knowledge Capture Pilot', 'Testproj123']}
    print('   orange pixels:', counts)
    t('e2e projects: every unclear name has a visible orange underline (pixels)', all(v >= 15 for v in counts.values()), counts)
    cell = page.locator('td div', has_text='Smart Service Analytics').first
    cell.scroll_into_view_if_needed(); box = cell.bounding_box()
    page.mouse.move(box['x'] + 5, box['y'] + box['height'] / 2); time.sleep(0.2)
    page.mouse.move(box['x'] + 25, box['y'] + box['height'] / 2); time.sleep(0.5)
    card = page.evaluate("(() => { const h = [...document.documentElement.children].find(e => e.shadowRoot); return h ? h.shadowRoot.textContent : ''; })()")
    t('e2e projects: pointing at an unclear name shows the card with the reason and the votes', 'Unclear' in card and 'Name or title' in card and '/3 models' in card, card)
    page.screenshot(path=str(SHOTS) + '/page-projects-card.png', clip={'x': 0, 'y': max(0, box['y'] - 200), 'width': 900, 'height': 360})
    page.locator('button', has_text='Not translated').click(); time.sleep(2.5)
    marked = page.evaluate("(() => { const k = [...CSS.highlights.keys()].find(k => /-bad$/.test(k)); return k ? [...CSS.highlights.get(k)].map(r => r.toString().trim()) : []; })()")
    t('e2e projects: "Not translated" turns the underline into an untranslated highlight', 'Smart Service Analytics' in marked, marked)
    pop.click('#tabBad'); time.sleep(0.3)
    bad = pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    t('e2e projects: the popup follows the decision made on the page', any(r.startswith('Smart Service Analytics') for r in bad), bad)
    pop.screenshot(path=str(SHOTS) + '/popup-projects.png')
    # 2.0.7: OK only closes the card; Ignore is the separate action, and Restore brings the text back
    nums = lambda: pop.evaluate("() => [...document.querySelectorAll('.stats b')].map(b => b.textContent).join('/') + ' ' + document.querySelector('#score').textContent + ' ' + document.querySelector('#coverage').textContent")
    def press(name, label):
        c = page.locator('td div', has_text=name).first; c.scroll_into_view_if_needed(); b = c.bounding_box()
        page.mouse.move(b['x'] + 3, b['y'] + b['height'] / 2); time.sleep(0.2); page.mouse.move(b['x'] + 15, b['y'] + b['height'] / 2); time.sleep(0.6)
        page.locator('button', has_text=label).first.click(); time.sleep(2.5)
    marks = lambda kind: page.evaluate("(k) => { const key = [...CSS.highlights.keys()].find(x => x.endsWith('-' + k)); return key ? [...CSS.highlights.get(key)].map(r => r.toString().trim()) : []; }", kind)
    page.mouse.move(800, 700); time.sleep(0.6)
    before = nums()
    press('Customer Support Hub', 'OK'); press('Skill Scout', 'OK')
    t('e2e projects: OK changes nothing (counts, percentage)', nums() == before, [before, nums()])
    t('e2e projects: after OK the words keep their red / orange underlines', 'Customer Support Hub' in marks('bad') and 'Skill Scout' in marks('unsure'))
    t('e2e projects: OK closes the card', not page.evaluate("[...document.documentElement.children].some(e => e.shadowRoot)"))
    press('Customer Support Hub', 'Ignore')
    pop.click('#tabSkip'); time.sleep(0.3)
    ig = pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    t('e2e projects: Ignore moves it to the Ignored tab', ig and ig[0].startswith('Customer Support Hub') and 'Restore' in ig[0], ig[:3])
    pop.locator('#list li .restore-btn').first.click(); time.sleep(3)
    pop.click('#tabBad'); time.sleep(0.3)
    bad = pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    t('e2e projects: Restore puts it back in Untranslated, with its underline', any(r.startswith('Customer Support Hub') for r in bad) and 'Customer Support Hub' in marks('bad'), bad)
    t('e2e projects: after Ignore and Restore the counts are as before', nums() == before, [before, nums()])
    ctx.close()
print(f'\nprojects e2e: {sum(res)} passed, {len(res) - sum(res)} failed')
raise SystemExit(0 if all(res) else 1)
