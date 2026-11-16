# Real Chromium: language picker + dark/light contrast audit. Usage: python test/e2e/picker.py
import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]; SITE = ROOT/'test'/'e2e'/'site'; SHOTS = ROOT/'test'/'e2e'/'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True  # threaded: Chromium keeps idle sockets open, which would block a single-threaded server
threading.Thread(target=socketserver.ThreadingTCPServer(('127.0.0.1', 8793), Q).serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json','content.js','background.js','pdfcheck.js','popup.html','panel.html','popup.css','popup.js']: shutil.copy(ROOT/f, EXT)
shutil.copytree(ROOT/'icons', pathlib.Path(EXT)/'icons'); shutil.copytree(ROOT/'vendor', pathlib.Path(EXT)/'vendor')
m = json.load(open(pathlib.Path(EXT)/'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT)/'manifest.json','w'))
B = 'http://127.0.0.1:8793'
res = []
def t(n, c, x=''): res.append(bool(c)); print(('PASS  ' if c else 'FAIL  ') + n + ('' if c else '  ' + str(x)))
INIT = "window.__T=%r;const _q=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async(q)=>(q&&q.active&&q.currentWindow)?(await _q({})).filter(x=>x.url&&x.url.startsWith(window.__T)):_q(q);"
AUDIT = """() => {
  const lin=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};
  const lum=r=>0.2126*lin(r[0])+0.7152*lin(r[1])+0.0722*lin(r[2]);
  const parse=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).map(parseFloat);return{c:p.slice(0,3),a:p.length>3?p[3]:1}};
  const bgOf=el=>{for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0.6)return c.c}return[255,255,255]};
  const bad=[];
  for(const el of document.querySelectorAll('body *')){
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||el.closest('[hidden]')||el.closest('svg'))continue;
    const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    const field=(el.tagName==='INPUT'&&el.type==='text'&&el.value);
    if(!own&&!field)continue;
    const fg=parse(cs.color);if(!fg)continue;
    const a=lum(fg.c),b=lum(bgOf(el));const r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const sz=parseFloat(cs.fontSize),large=sz>=24||(sz>=18.66&&parseInt(cs.fontWeight)>=700);
    if(r<(large?3:4.5))bad.push(((el.textContent||el.value).trim().slice(0,28))+' ['+r.toFixed(2)+']');
  }return bad;}"""
with sync_playwright() as p:
    for attempt in range(4):                         # Chromium sometimes starts without loading the extension in this sandbox: relaunch instead of failing
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-prof-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
            args=['--headless=new','--no-sandbox',f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'], viewport={'width':420,'height':620})
        sw = None
        for _ in range(60):
            if ctx.service_workers: sw = ctx.service_workers[0]; break
            time.sleep(0.2)
        if sw: break
        print(f'(extension did not start on launch {attempt + 1}, relaunching)'); ctx.close()
    if not sw: sys.exit('extension never started')
    ext = sw.url.split('/')[2]
    de = ctx.new_page(); de.goto(B+'/de.html')
    pg = ctx.new_page(); pg.add_init_script(INIT % (B+'/de.html')); pg.goto(f'chrome-extension://{ext}/popup.html'); pg.wait_for_selector('#langInput'); time.sleep(0.5)
    pg.click('#scan'); time.sleep(1); 
    for _ in range(100):
        if pg.evaluate("()=>!document.querySelector('#scan').disabled"): break
        time.sleep(0.3)
    time.sleep(0.5)
    for scheme in ('dark','light'):
        pg.emulate_media(color_scheme=scheme); time.sleep(0.3)
        pg.click('#langInput'); time.sleep(0.3)
        t(f'{scheme}: list opens with all languages', pg.locator('#langList li').count() >= 40)
        pg.screenshot(path=str(SHOTS/f'picker-open-{scheme}.png'))
        t(f'{scheme}: list text meets WCAG contrast', not pg.evaluate(AUDIT), pg.evaluate(AUDIT))
        pg.fill('#langInput','deu'); time.sleep(0.2)
        t(f'{scheme}: typing "deu" shows German first', pg.locator('#langList li').first.inner_text().startswith('German'))
        pg.screenshot(path=str(SHOTS/f'picker-search-{scheme}.png'))
        pg.fill('#langInput','espanol'); pg.keyboard.press('Enter'); time.sleep(0.3)
        t(f'{scheme}: Enter picks Spanish', pg.input_value('#langInput') == 'Spanish (español)', pg.input_value('#langInput'))
        pg.click('#langInput'); pg.fill('#langInput','deu'); pg.keyboard.press('Enter'); time.sleep(0.3)
        t(f'{scheme}: whole popup meets WCAG contrast', not pg.evaluate(AUDIT), pg.evaluate(AUDIT))
        pg.click('#settingsBtn'); time.sleep(0.3)
        t(f'{scheme}: settings drawer meets WCAG contrast', not pg.evaluate(AUDIT), pg.evaluate(AUDIT))
        pg.screenshot(path=str(SHOTS/f'settings-{scheme}.png')); pg.click('#settingsBtn')
    ctx.close()
print(f'\npicker e2e: {sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
