import http.server, socketserver, threading, time, json, os, shutil, tempfile, pathlib, csv, io
from playwright.sync_api import sync_playwright
# Reported German "Connectors" page, in real Chromium with the real extension: status badges, tab labels, technical terms, date formats,
# and the CSV export (one line per row, no blank fields, every location).
ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / 'test' / 'e2e' / 'site'
SHOTS = ROOT / 'test' / 'e2e' / 'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 8796), Q); threading.Thread(target=httpd.serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js', 'learn.js']: shutil.copy(ROOT / f, EXT)
shutil.copytree(ROOT / 'icons', pathlib.Path(EXT) / 'icons'); shutil.copytree(ROOT / 'vendor', pathlib.Path(EXT) / 'vendor')
m = json.load(open(pathlib.Path(EXT) / 'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT) / 'manifest.json', 'w'))
B = 'http://127.0.0.1:8796'
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
    page = ctx.new_page(); page.goto(B + '/de-connectors.html'); page.bring_to_front()
    pop = ctx.new_page(); pop.add_init_script(INIT % (B + '/de-connectors.html')); pop.goto(f'chrome-extension://{ext_id}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.4)
    pop.click('#scan'); time.sleep(0.8)
    end = time.time() + 90
    while time.time() < end and pop.evaluate("() => document.querySelector('#scan').disabled"): time.sleep(0.3)
    time.sleep(0.3)
    rows = lambda: pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')
    bad = rows(); print('   untranslated:', [x[:60] for x in bad])
    for word in ['Valid', 'Completed', 'Knowledge Intelligence', 'Document Repo', 'Connectors']:
        t(f'e2e connectors: "{word}" is listed as untranslated', any(x.startswith(word) or (' ' + word + ' ') in (' ' + x + ' ') for x in bad), bad)
    pop.click('#tabUnsure'); un = rows()
    t('e2e connectors: "REST API" is not listed as unclear', not any(x.startswith('REST API') for x in un + bad), un)
    t('e2e connectors: the Format tab is shown without turning Format hints on', pop.is_visible('#tabFmt'))
    pop.click('#tabFmt'); fm = rows(); print('   format:', [x[:80] for x in fm])
    t('e2e connectors: date order and 12-hour time are hinted', any('English order' in x for x in fm) and any('12-hour clock' in x for x in fm), fm)
    pop.click('#tabBad'); pop.screenshot(path=str(SHOTS) + '/popup-connectors.png'); page.screenshot(path=str(SHOTS) + '/page-connectors.png')
    hl = page.evaluate("(() => { const k = [...CSS.highlights.keys()].find(k => /-bad$/.test(k)); return k ? [...CSS.highlights.get(k)].map(r => r.toString().trim()) : []; })()")
    t('e2e connectors: the badges are highlighted on the page', 'Valid' in hl and 'Completed' in hl, hl)
    with pop.expect_download() as dl:
        pop.click('#expCsv')
    text = open(dl.value.path(), encoding='utf-8-sig', newline='').read()
    recs = list(csv.reader(io.StringIO(text)))
    head, body = recs[0], recs[1:]
    col = lambda r, n: r[head.index(n)]
    t('e2e connectors: CSV has one line per row', text.count('\r\n') == len(recs) - 1 and '\n' not in text.replace('\r\n', ''), repr(text[:200]))
    t('e2e connectors: no blank fields in the CSV', all(all(c != '' for c in r) for r in body), [r for r in body if '' in r])
    con = next(r for r in body if col(r, 'text') == 'Connectors')
    t('e2e connectors: "Connectors" lists both locations', col(con, 'occurrences') == '2' and len(col(con, 'context').split(' | ')) == 2 and len(col(con, 'all locations').split(' | ')) == 2, con)
    t('e2e connectors: selectors start at #root', all(col(r, 'selector').startswith('#root') for r in body), [col(r, 'selector') for r in body])
    ctx.close()
print(f'\nconnectors e2e: {sum(res)} passed, {len(res) - sum(res)} failed')
raise SystemExit(0 if all(res) else 1)
