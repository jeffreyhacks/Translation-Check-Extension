import http.server, socketserver, threading, time, json, os, shutil, tempfile, pathlib, csv, io
from playwright.sync_api import sync_playwright
# 2.0.7: every visible text in the popup (with results, settings open, every tab) meets WCAG AA contrast (4.5:1; 3:1 for large text)
# in both the light and the dark theme, measured on the real rendered colours.
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
m = json.load(open(pathlib.Path(EXT) / 'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT) / 'manifest.json', 'w'))
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
    pop.click('#scan'); time.sleep(0.8)
    end = time.time() + 90
    while time.time() < end and pop.evaluate("() => document.querySelector('#scan').disabled"): time.sleep(0.3)
    time.sleep(0.3)
    AUDIT = """() => {
      const rgb = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const mix = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0) stack.push(c); if (c.a >= 1) break; }
        let out = { r: 255, g: 255, b: 255, a: 1 }; if (!stack.length || stack[stack.length - 1].a < 1) out = matchMedia('(prefers-color-scheme: dark)').matches ? { r: 18, g: 24, b: 42, a: 1 } : out;
        for (const c of stack.reverse()) out = mix(c, out); return out; };
      const bad = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.nodeValue.trim(); const el = n.parentElement;
        if (!t || !el || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        if (el.closest('button:disabled,[aria-disabled=true]')) continue;            // WCAG: inactive controls are exempt
        const cs = getComputedStyle(el); const fg = mix(rgb(cs.color), bgOf(el)); const bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize), boldish = parseInt(cs.fontWeight) >= 700;
        const need = size >= 24 || (boldish && size >= 18.66) ? 3 : 4.5;
        if (ratio < need) bad.push(`${t.slice(0, 30)} (${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className}) ${ratio.toFixed(2)}`);
      }
      return bad;
    }"""
    for scheme in ['dark', 'light']:
        pop.emulate_media(color_scheme=scheme); time.sleep(0.3)
        problems = []
        for tab in ['#tabBad', '#tabUnsure', '#tabSkip']:
            pop.click(tab); time.sleep(0.2); problems += pop.evaluate(AUDIT)
        pop.click('#settingsBtn'); time.sleep(0.2); problems += pop.evaluate(AUDIT); pop.click('#settingsBtn'); time.sleep(0.2)
        problems = sorted(set(problems))
        pop.screenshot(path=str(SHOTS) + f'/popup-contrast-{scheme}.png')
        t(f'e2e contrast ({scheme}): every visible text meets WCAG AA', not problems, problems[:25])
    ctx.close()
print(f'\ncontrast e2e: {sum(res)} passed, {len(res) - sum(res)} failed')
raise SystemExit(0 if all(res) else 1)
