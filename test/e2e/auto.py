# Real Chromium, UNMODIFIED manifest (no test host permissions): the "Check this site automatically" switch must get past Chrome's manifest check
# for permissions.request. Chrome shows its own permission prompt after that, which a headless browser cannot answer. Usage: python test/e2e/auto.py
import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]; SITE = ROOT/'test'/'e2e'/'site'
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
threading.Thread(target=socketserver.ThreadingTCPServer(('127.0.0.1', 8799), Q).serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js', 'learn.js']: shutil.copy(ROOT/f, EXT)
shutil.copytree(ROOT/'icons', pathlib.Path(EXT)/'icons'); shutil.copytree(ROOT/'vendor', pathlib.Path(EXT)/'vendor')
B = 'http://127.0.0.1:8799'
SHOTS = ROOT/'test'/'e2e'/'shots'; SHOTS.mkdir(exist_ok=True)
# second copy of the extension with the test-only host permission (stands in for a granted permission, so no prompt is needed)
EXT2 = tempfile.mkdtemp(prefix='tc-ext2-'); shutil.copytree(EXT, EXT2, dirs_exist_ok=True)
m = json.load(open(pathlib.Path(EXT2)/'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT2)/'manifest.json', 'w'))
res = []
def t(n, c, x=''): res.append(bool(c)); print(('PASS  ' if c else 'FAIL  ') + n + ('' if c else '  ' + str(x)))
# Without host permissions Chrome hides a tab's URL from a popup that is opened as a plain tab (in real use "activeTab" provides it after the toolbar click),
# so the popup is told the active tab's URL directly. Everything else, including permissions.request, is the real thing.
INIT = "window.__T=%r;chrome.tabs.query=async(q)=>(q&&q.active&&q.currentWindow)?[{id:1,url:window.__T}]:[];"
def launch(p, ext_dir):
    for attempt in range(4):
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-prof-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
            args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={ext_dir}', f'--load-extension={ext_dir}'], viewport={'width': 900, 'height': 640})
        sw = None
        for _ in range(60):
            if ctx.service_workers: sw = ctx.service_workers[0]; break
            time.sleep(0.2)
        if sw: return ctx, sw
        print(f'(extension did not start on launch {attempt + 1}, relaunching)'); ctx.close()
    sys.exit('extension never started')
def popup(ctx, sw, url):
    pop = ctx.new_page(); pop.add_init_script(INIT % url); pop.goto(f'chrome-extension://{sw.url.split("/")[2]}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.5); return pop
with sync_playwright() as p:
    # ---- A. unmodified manifest: Chrome's own permission validation ----
    ctx, sw = launch(p, EXT)
    es = ctx.new_page(); es.goto(B + '/es.html'); es.bring_to_front()
    pop = popup(ctx, sw, B + '/es.html')
    pop.click('#settingsBtn'); time.sleep(0.3)
    t('setup: the switch is enabled for an http(s) page', not pop.is_disabled('#auto'))
    pop.click('label.opt:has(#auto) i'); time.sleep(3)                      # a real click = a real user gesture
    st = pop.inner_text('#status')
    t('the permission request passes Chrome\'s manifest check (no "Only permissions specified in the manifest" error)', 'manifest' not in st.lower(), st)
    t('no error message at all is shown for turning the switch on', not st.strip() or 'could not' not in st.lower(), st)
    for scheme in ('dark', 'light'):                                         # the logo must read the same in both themes
        pop.emulate_media(color_scheme=scheme); time.sleep(0.3)
        pop.locator('.logo').screenshot(path=str(SHOTS/f'logo-{scheme}.png'))
        from PIL import Image
        im = Image.open(str(SHOTS/f'logo-{scheme}.png')).convert('RGB'); px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
        white = sum(1 for (r, g, b) in px if r > 235 and g > 235 and b > 235); yel = sum(1 for (r, g, b) in px if r > 220 and 180 < g < 235 and b < 90)
        t(f'logo ({scheme}): white lines and the yellow bar are visible on the tile', white > 8 and yel > 8, (white, yel))
    pop.emulate_media(color_scheme='dark'); time.sleep(0.2); pop.screenshot(path=str(SHOTS/'popup-dark-header.png'), clip={'x': 0, 'y': 0, 'width': 420, 'height': 120})
    ctx.close()
    # ---- B. permission already held: the whole path, switch -> worker registers the script -> a new tab is checked on its own ----
    ctx, sw = launch(p, EXT2)
    pop = popup(ctx, sw, B + '/de.html')
    pop.click('#settingsBtn'); time.sleep(0.3); pop.click('label.opt:has(#auto) i'); time.sleep(2)
    t('switch on: no error is shown', 'could not' not in pop.inner_text('#status').lower(), pop.inner_text('#status'))
    reg = sw.evaluate("async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => ({id: s.id, matches: s.matches, persist: s.persistAcrossSessions}))")
    t('switch on: the background worker registered the page script for this site', any(r['id'] == 'auto-127.0.0.1' and r['persist'] for r in reg), reg)
    de = ctx.new_page(); de.goto(B + '/de.html'); de.bring_to_front(); time.sleep(5)
    marks = de.evaluate("[...CSS.highlights.keys()].filter(k => /^tc-[a-z0-9]{6}-(bad|unsure|bug)$/.test(k)).length")
    t('a page opened later is checked automatically, with no click on the toolbar', marks >= 1, marks)
    pop.bring_to_front(); pop.click('label.opt:has(#auto) i'); time.sleep(2)
    reg2 = sw.evaluate("async () => (await chrome.scripting.getRegisteredContentScripts()).map(s => s.id)")
    t('switch off: the registration is removed', 'auto-127.0.0.1' not in reg2, reg2)
    ctx.close()
print(f'\nauto-check e2e: {sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
