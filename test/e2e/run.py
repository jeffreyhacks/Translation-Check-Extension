import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'test' / 'e2e' / 'site'
SHOTS = ROOT / 'test' / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True; httpd = socketserver.TCPServer(('127.0.0.1', 8791), Q); threading.Thread(target=httpd.serve_forever, daemon=True).start()
# Test copy of the extension. The ONLY difference from the real one: host permissions for the local test server,
# which stand in for the user's toolbar click ("activeTab"); a headless browser can't click the toolbar.
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js']: shutil.copy(ROOT / f, EXT)
shutil.copytree(ROOT / 'icons', pathlib.Path(EXT) / 'icons'); shutil.copytree(ROOT / 'vendor', pathlib.Path(EXT) / 'vendor')
m = json.load(open(pathlib.Path(EXT) / 'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT) / 'manifest.json', 'w'))
B = 'http://127.0.0.1:8791'
res = []
def t(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS  ' if cond else 'FAIL  ') + name + ('' if cond else '  ' + str(extra)))
INIT = """
window.__T = %r;
const _q = chrome.tabs.query.bind(chrome.tabs);
chrome.tabs.query = async (q) => (q && q.active && q.currentWindow) ? (await _q({})).filter((x) => x.url && x.url.startsWith(window.__T)) : _q(q);
"""
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-profile-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
        args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1100, 'height': 760})
    sw = None
    for _ in range(60):
        if ctx.service_workers: sw = ctx.service_workers[0]; break
        time.sleep(0.2)
    ext_id = sw.url.split('/')[2]
    def popup_for(prefix, file='popup.html'):
        pg = ctx.new_page(); pg.add_init_script(INIT % prefix); pg.goto(f'chrome-extension://{ext_id}/{file}'); pg.wait_for_selector('#lang'); time.sleep(0.4); return pg
    def wait_idle(pg, timeout=90000, need_result=True):
        time.sleep(0.6)                                   # let the click start the scan (button disables while it runs)
        end = time.time() + timeout / 1000
        while time.time() < end:
            if pg.evaluate("() => !document.querySelector('#scan').disabled"): time.sleep(0.3); return
            time.sleep(0.3)
        raise TimeoutError('scan did not finish')
    def run(pg, timeout=90000):
        pg.click('#scan'); time.sleep(0.2); wait_idle(pg, timeout)
    def set_lang(pg, v):
        pg.select_option('#lang', v); time.sleep(0.2)
    def chips(pg): return pg.eval_on_selector_all('#chips .chip', 'els => els.map(e => e.textContent)')
    def rows(pg): return pg.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')

    # ---------- 1. German page, target = page's own language (auto) ----------
    de = ctx.new_page(); de.goto(B + '/de.html'); de.bring_to_front()
    pop = popup_for(B + '/de.html')
    run(pop)
    st = pop.inner_text('#status')
    t('e2e: scan of a real page completes without error', pop.is_visible('#result') and not st, st)
    t('e2e: "auto" resolved to the page language (German)', 'de' in chips(pop)[0], chips(pop))
    cx = ' | '.join(chips(pop))
    t('e2e: all three models active — CLD3 WebAssembly loads under the real extension security policy', '3 models' in cx, cx)
    bad = pop.eval_on_selector_all('#tabBad .n', 'e=>e[0].textContent')
    r = rows(pop)
    print('   untranslated rows:', [x[:70] for x in r])
    t('e2e: real German sentences from the bug report are NOT flagged', not any(k in ' '.join(r) for k in ['Erstellen und verwalten', 'Verwalten Sie Szenarien', 'Anfrage zu Versand', 'Beschwerde über', 'Umgang mit Preiswiderstand', 'Admin Playground', 'Bewertungsraster']), r)
    t('e2e: the genuine English leftovers ARE flagged', any('best sellers' in x for x in r) and any('Sign in' in x or 'Add to cart' in x for x in r), r)
    t('e2e: the English placeholder attribute is flagged', any('Enter your email' in x for x in r), r)
    t('e2e: 154m 32s / model name / version are not flagged', not any(k in ' '.join(r) for k in ['154m', 'gpt-6', 'v2.1']), r)
    t('e2e: confirmed warnings show the model-agreement dots', pop.locator('#list .pips').count() >= 2 and pop.locator('#list .pips .check').count() >= 1)
    pop.click('#tabBug'); br = rows(pop)
    t('e2e: the leaked translation key is under "Broken"', any('checkout.button.save' in x for x in br), br)
    pop.click('#tabBad')
    hl = de.evaluate("[...['tc-bad','tc-bug','tc-focus']].map(k => CSS.highlights.has(k)).join()")
    t('e2e: real CSS highlights are registered on the page', hl.startswith('true,true'), hl)
    pop.screenshot(path=str(SHOTS) + '/popup-de-ok.png')
    de.screenshot(path=str(SHOTS) + '/page-de-highlights.png')
    # navigate with next, check page reacts
    pop.click('#next'); time.sleep(0.5)
    t('e2e: "next" focuses an issue on the page (focus highlight)', de.evaluate("CSS.highlights.has('tc-focus')"))
    # ---------- 2. wrong target -> banner ----------
    set_lang(pop, 'en'); run(pop)
    t('e2e: wrong target (English on a German page) shows the short banner', pop.is_visible('#mismatch') and 'German' in pop.inner_text('#mismatchText'), pop.inner_text('#result')[:200])
    pop.screenshot(path=str(SHOTS) + '/popup-de-wrong-target.png')
    pop.click('#mismatchFix'); time.sleep(0.3); wait_idle(pop, 60000, False)
    t('e2e: one click on the banner switches to German and re-checks', pop.input_value('#lang') == 'de' and pop.is_hidden('#mismatch'), pop.input_value('#lang'))
    set_lang(pop, 'auto')
    # ---------- 3. confirmed-only + ignore list ----------
    pop.click('#settingsBtn'); pop.click('label.sw:has(#confirmed)'); run(pop)
    t('e2e: "confirmed only" still reports the clear English leftovers', any('best sellers' in x for x in rows(pop)), rows(pop))
    pop.click('label.sw:has(#confirmed)')
    pop.screenshot(path=str(SHOTS) + '/popup-settings.png')
    pop.click('#settingsBtn')
    # ignore button
    n_before = pop.locator('#list .ignore-btn').count()
    if n_before:
        first = pop.locator('#list li').first.inner_text().replace('\n', ' ')
        pop.locator('#list .ignore-btn').first.click(); time.sleep(0.3); wait_idle(pop, 60000, False); time.sleep(0.4)
        t('e2e: Ignore removes that text on the re-check', pop.locator('#list .ignore-btn').count() < n_before or first not in ' '.join(rows(pop)))
    # ---------- 4. Spanish page, wrong data + live updates ----------
    es = ctx.new_page(); es.goto(B + '/es.html'); es.bring_to_front()
    pop2 = popup_for(B + '/es.html'); run(pop2)
    t('e2e: clean Spanish page scores 100%', pop2.inner_text('#score') == '100%', pop2.inner_text('#score'))
    es.evaluate("document.body.insertAdjacentHTML('beforeend', '<p id=late>Our new model is shipping this week with free delivery for everyone.</p>')")
    time.sleep(2.5)
    pop2.bring_to_front(); time.sleep(0.5)
    live_rows = rows(pop2)
    t('e2e: live mode catches text added after the check (real MutationObserver)', any('new model' in x for x in live_rows) or int(pop2.inner_text('#nBad')) >= 1, live_rows)
    badge = sw.evaluate("async () => { const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1:8791/es.html' }); return chrome.action.getBadgeText({ tabId: t.id }); }")
    t('e2e: toolbar badge shows the warning count (set by the worker)', badge == '1', repr(badge))
    pop2.screenshot(path=str(SHOTS) + '/popup-es-live.png')
    # ---------- 5. PDF in the browser viewer ----------
    pdf = ctx.new_page(); pdf.goto(B + '/handbook.pdf'); time.sleep(1.5)
    pop3 = popup_for(B + '/handbook.pdf')
    t('e2e: PDF tab is recognised (button says "Check PDF")', pop3.inner_text('#scanLabel') == 'Check PDF')
    run(pop3, 120000)
    st = pop3.inner_text('#status')
    pr = rows(pop3)
    t('e2e: PDF is downloaded, parsed by pdf.js (worker under extension policy) and checked', pop3.is_visible('#result') and not st, st)
    t('e2e: the English paragraph in the PDF is flagged with its page', any('scoring rubric' in x and 'p.1' in x for x in pr), pr)
    t('e2e: PDF chips show page count', any('PDF' in c for c in chips(pop3)), chips(pop3))
    pop3.screenshot(path=str(SHOTS) + '/popup-pdf.png')
    pop3.locator('#list li > button').first.click(); time.sleep(1.0)
    t('e2e: clicking a PDF issue jumps to the page in the viewer', '#page=1' in pdf.url, pdf.url)
    # clean PDF
    pdf2 = ctx.new_page(); pdf2.goto(B + '/guia.pdf'); time.sleep(1.0)
    pop4 = popup_for(B + '/guia.pdf'); run(pop4, 120000)
    t('e2e: clean Spanish PDF scores 100%', pop4.inner_text('#score') == '100%', pop4.inner_text('#score') + ' ' + pop4.inner_text('#status'))
    # ---------- 6. side panel page renders ----------
    pan = popup_for(B + '/de.html', 'panel.html'); run(pan)
    t('e2e: side-panel page works too', pan.is_visible('#result'))
    pan.screenshot(path=str(SHOTS) + '/panel.png')
    ctx.close()
print(f"\nend-to-end: {sum(res)} passed, {len(res)-sum(res)} failed"); sys.exit(0 if all(res) else 1)
