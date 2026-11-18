# Real Chromium, 2.0.6: grouped strings with their locations, context lines, Ignore that learns, marked-untranslated texts,
# own-language switching and live-update timing. Usage: python test/e2e/v206.py
import http.server, socketserver, threading, time, json, sys, os, shutil, tempfile, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]; SITE = ROOT/'test'/'e2e'/'site'; SHOTS = ROOT/'test'/'e2e'/'shots'; SHOTS.mkdir(exist_ok=True)
os.chdir(SITE)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
threading.Thread(target=socketserver.ThreadingTCPServer(('127.0.0.1', 8799), Q).serve_forever, daemon=True).start()
EXT = tempfile.mkdtemp(prefix='tc-ext-')
for f in ['manifest.json', 'content.js', 'background.js', 'pdfcheck.js', 'popup.html', 'panel.html', 'popup.css', 'popup.js', 'learn.js']: shutil.copy(ROOT/f, EXT)
shutil.copytree(ROOT/'icons', pathlib.Path(EXT)/'icons'); shutil.copytree(ROOT/'vendor', pathlib.Path(EXT)/'vendor')
m = json.load(open(pathlib.Path(EXT)/'manifest.json')); m['host_permissions'] = ['http://127.0.0.1/*']; json.dump(m, open(pathlib.Path(EXT)/'manifest.json', 'w'))
B = 'http://127.0.0.1:8799'; URL = B + '/v206.html'
res = []
def t(n, c, x=''): res.append(bool(c)); print(('PASS  ' if c else 'FAIL  ') + n + ('' if c else '  ' + str(x)))
INIT = "window.__T=%r;const _q=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async(q)=>(q&&q.active&&q.currentWindow)?(await _q({})).filter(x=>x.url&&x.url.startsWith(window.__T)):_q(q);"

def wait_idle(pop):
    for _ in range(150):
        if pop.evaluate("()=>!document.querySelector('#scan').disabled"): break
        time.sleep(0.3)
    time.sleep(0.4)

def rows(pop):
    return pop.eval_on_selector_all('#list li', 'els => els.map(e => e.innerText.replace(/\\s+/g," "))')

def snippets(pop):  # just the flagged text of each row (rows also show their context, which mentions neighbouring text)
    return pop.eval_on_selector_all('#list li .snippet', 'els => els.map(e => e.textContent.trim())')

def set_lang(pop, code):
    pop.evaluate("c => { const s = document.querySelector('#lang'); s.value = c; s.dispatchEvent(new Event('change')); }", code)

with sync_playwright() as p:
    for attempt in range(4):
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='tc-prof-'), executable_path=os.environ.get('CHROME') or p.chromium.executable_path, headless=False,
            args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 900, 'height': 900})
        sw = None
        for _ in range(60):
            if ctx.service_workers: sw = ctx.service_workers[0]; break
            time.sleep(0.2)
        if sw: break
        print(f'(extension did not start on launch {attempt + 1}, relaunching)'); ctx.close()
    if not sw: sys.exit('extension never started')
    ext = sw.url.split('/')[2]
    errors = []
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.goto(URL); pg.bring_to_front()
    original = pg.evaluate('() => document.body.innerHTML')
    pop = ctx.new_page(); pop.on('pageerror', lambda e: errors.append('popup: ' + str(e)))
    pop.add_init_script(INIT % URL); pop.goto(f'chrome-extension://{ext}/popup.html'); pop.wait_for_selector('#langInput'); time.sleep(0.5)

    # ---- English check: a translated page scores 100%; spelling, layout and the stretch test are gone
    set_lang(pop, 'en'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    t('en: the page counts as fully translated', pop.inner_text('#score') == '100%', pop.inner_text('#score'))
    t('removed: no spelling or layout tabs and no +35% button', pop.locator('#tabSpell').count() == 0 and pop.locator('#tabLayout').count() == 0 and pop.locator('#stretch').count() == 0)
    t('en: checking leaves the page HTML untouched', pg.evaluate('() => document.body.innerHTML') == original)

    # ---- Spanish check: everything English is untranslated; repeated strings grouped, with context
    set_lang(pop, 'es'); pop.click('#tabBad'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    bad = rows(pop)
    add = [r for r in bad if r.startswith('Add to cart')]
    t('group: "Add to cart" is one row marked ×3', len(add) == 1 and '×3' in add[0], bad)
    t('group: untranslated count still counts every copy', int(pop.inner_text('#nBad')) >= len(bad) + 2, (pop.inner_text('#nBad'), len(bad)))
    t('context: the row shows the element and its card heading', 'button · Main' in add[0] and '“Blue shirt”' in add[0], add[0])
    idx = next(i for i, r in enumerate(bad) if r.startswith('Add to cart'))
    sel = f'#list li:nth-child({idx + 1}) > button'
    pop.click(sel); time.sleep(0.6)
    y1 = pg.evaluate("() => [...document.querySelectorAll('button.cart')].map(b => b.getBoundingClientRect().top)")
    second = pop.inner_text(f'#list li:nth-child({idx + 1})')
    pop.click(sel); time.sleep(0.6)
    t('group: clicking again moves to the next copy (2 of 3, next card)', '2 of 3' in pop.inner_text(f'#list li:nth-child({idx + 1})') and '“Black trousers”' in pop.inner_text(f'#list li:nth-child({idx + 1})'), pop.inner_text(f'#list li:nth-child({idx + 1})'))
    pop.screenshot(path=str(SHOTS/'v206-grouped.png'))

    # ---- learning: ignore three product names in the same slot -> the fourth is skipped automatically
    for name in ['Blue shirt', 'Black trousers', 'Grey jacket']:
        r = rows(pop); i = next(k for k, x in enumerate(r) if x.startswith(name))
        pop.click(f'#list li:nth-child({i + 1}) .ignore-btn'); time.sleep(0.4); wait_idle(pop)
    note = pop.inner_text('#learnText') if pop.is_visible('#learnNote') else ''
    t('learn: the third Ignore in the same slot learns a rule and says so', 'span.pname' in note, note)
    after = ' '.join(rows(pop)); sn = snippets(pop)
    t('learn: the fourth product name (never ignored by hand) is skipped automatically', 'Red scarf' not in sn, sn)
    chips = pop.eval_on_selector_all('#chips .chip', 'els => els.map(e => e.textContent.trim())')
    t('learn: an "auto-ignored" chip counts it', any('auto-ignored' in c for c in chips), chips)
    t('learn: other English text is still flagged', 'Add to cart' in after and 'Organic cotton' in after, after)
    pop.screenshot(path=str(SHOTS/'v206-learned.png'))
    pop.click('#learnUndo'); time.sleep(0.5); wait_idle(pop)
    t('learn: Undo brings the skipped name back', 'Red scarf' in snippets(pop), snippets(pop))

    # ---- export: CSV has the new columns and all three locations
    with pop.expect_download() as dl: pop.click('#expCsv')
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    t('export: CSV has occurrences and context columns', '"occurrences","context","surrounding text","all locations"' in csv.splitlines()[0])
    line = next((l for l in csv.splitlines() if l.startswith('"Not translated","Add to cart"')), '')
    t('export: the grouped row lists 3 occurrences', ',"3",' in line, line[:200])

    # context must not borrow the heading of a neighbouring card
    pop.click('#tabBad'); time.sleep(0.2)
    exp = next((r for r in rows(pop) if r.startswith('Export the report')), '')
    t('context: a button after the cards is not labelled with the last card\'s heading', exp and '“Red scarf”' not in exp, exp)
    pg.bring_to_front(); time.sleep(0.3); pg.screenshot(path=str(SHOTS/'v206-page.png'))

    # ---- Hindi page, "Confirmed warnings only" on: short English traits repeated in persona cards (the reported case)
    HI = B + '/hi-traits.html'
    pg.goto(HI); pg.bring_to_front(); time.sleep(0.3)
    pop.evaluate("u => { window.__T = u; }", HI)
    set_lang(pop, 'hi'); pop.evaluate("() => { const c = document.querySelector('#confirmed'); c.checked = true; c.dispatchEvent(new Event('change')); }")
    pop.click('#tabBad'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    bad = rows(pop)
    ti = [r for r in bad if r.startswith('technical • impatient')]
    t('hindi: "technical • impatient" (3/3 models) is untranslated, not unclear', len(ti) == 1 and '×8' in ti[0] and 'English' in ti[0], bad)
    t('hindi: "casual • calm" too', any(r.startswith('casual • calm') and '×3' in r for r in bad), bad)
    t('hindi: both are confirmed even with "Confirmed warnings only" on', pop.inner_text('#nUnsure') == '0' and 'Not confirmed' not in ' '.join(bad), (pop.inner_text('#nUnsure'), bad))
    t('hindi: the Hindi text itself is not flagged', not any('सत्र' in x or 'भूमिका' in x for x in snippets(pop)), snippets(pop))
    i = next(k for k, r in enumerate(bad) if r.startswith('technical'))
    row = f'#list li:nth-child({i + 1})'
    pop.click(f'{row} > button'); time.sleep(0.5)
    t('nav: the selected group shows "Copy 1 of 8" with previous/next', 'Copy 1 of 8' in pop.inner_text(row) and pop.is_visible(f'{row} .occ-prev'))
    def focused_card():
        return pg.evaluate("() => { const r = [...document.querySelectorAll('dd.trait')].map(e => [e.id, Math.abs(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2 - innerHeight / 2)]); r.sort((a, b) => a[1] - b[1]); return r[0][0]; }")
    def red_px(sel):
        from PIL import Image; import io
        box = pg.eval_on_selector(sel, 'e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: Math.max(r.width, 1), height: Math.max(r.height, 1)}; }')
        if box['y'] + box['height'] <= 0 or box['y'] >= pg.viewport_size['height']: return 0  # scrolled out of view: nothing to see
        im = Image.open(io.BytesIO(pg.screenshot(clip=box))).convert('RGB')
        px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
        return sum(1 for (r, g, b) in px if r >= 190 and g <= 80 and b <= 90)
    # rapid clicks: next, next, next (within the old 2.2 s timer), then back once -> copy 3, and its mark must be on the page
    for _ in range(3): pop.click(f'{row} .occ-next'); time.sleep(0.35)
    pop.click(f'{row} .occ-prev'); time.sleep(1.2)
    t('nav: previous goes back a copy (1 → 4 → back to 3)', 'Copy 3 of 8' in pop.inner_text(row), pop.inner_text(row))
    pg.bring_to_front(); time.sleep(0.6)
    cur = focused_card()
    t('page: the page scrolled to copy 3', cur == 't2', cur)
    t('page: copy 3 is marked on the page after rapid clicking (not wiped by an old timer)', red_px('#t2') > 150, red_px('#t2'))
    # (the other copies keep their normal untranslated look: yellow with a thin red wavy underline, far fewer red pixels than the solid mark)
    t('page: only one copy is marked at a time', all(red_px(x) < red_px('#t2') / 3 for x in ('#t0', '#t1', '#t3')), (red_px('#t0'), red_px('#t1'), red_px('#t2'), red_px('#t3')))
    pg.screenshot(path=str(SHOTS/'v206-hi-focus.png'))
    pop.bring_to_front()
    # leave the group and come back: it resumes at copy 3
    j = next(k for k, r in enumerate(rows(pop)) if r.startswith('casual'))
    pop.click(f'#list li:nth-child({j + 1}) > button'); time.sleep(0.4)
    i = next(k for k, r in enumerate(rows(pop)) if r.startswith('technical'))
    pop.click(f'#list li:nth-child({i + 1}) > button'); time.sleep(0.4)
    t('nav: coming back to a group resumes where you left it', 'Copy 3 of 8' in pop.inner_text(f'#list li:nth-child({i + 1})'), pop.inner_text(f'#list li:nth-child({i + 1})'))
    pop.screenshot(path=str(SHOTS/'v206-hi-popup.png'))
    pop.evaluate("() => { const c = document.querySelector('#confirmed'); c.checked = false; c.dispatchEvent(new Event('change')); }")

    # ---- reported: a copy of the previous version left in the tab (extension reloaded, tab not) erased every new highlight on each live update.
    # This plants exactly what 2.0.5's live mode does on every page change (sweep "tc-…" marks and style sheets that are not its own).
    OLD_SWEEP = """(() => { const MINE = 'tc-zz9zz9'; const KEY = /^tc-(?:[a-z0-9]{6}-)?(?:bad|unsure|bug|fmt|focus)$/;
      new MutationObserver(() => { for (const k of [...CSS.highlights.keys()]) if (KEY.test(k) && !k.startsWith(MINE + '-')) CSS.highlights.delete(k);
        document.querySelectorAll('style#tc-style,style[data-tc-style],[data-tc-flag],[data-tc-focus]').forEach((el) => { if (el.localName === 'style') { if (el.getAttribute('data-tc-style') !== MINE) el.remove(); return; }
          if (!(el.getAttribute('data-tc-flag') || '').startsWith(MINE + ':')) el.removeAttribute('data-tc-flag'); }); }).observe(document.body, { childList: true, subtree: true, characterData: true }); })()"""
    S = B + '/hi-sessions.html'
    pg.goto(S); pg.evaluate(OLD_SWEEP); pg.bring_to_front()
    pop.evaluate("u => { window.__T = u; }", S); set_lang(pop, 'hi'); pop.click('#tabBad'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    pg.bring_to_front(); time.sleep(0.3)
    pg.evaluate("() => { const p = document.createElement('p'); p.textContent = 'नया अपडेट'; document.querySelector('main').append(p); }")  # live data arrives
    time.sleep(2.5)
    def gold(text):  # the untranslated highlight (solid yellow) under a title, from a real screenshot
        from PIL import Image; import io
        box = pg.evaluate("t => { const e = [...document.querySelectorAll('.title,.st')].find(x => x.textContent.trim() === t); e.scrollIntoView({block: 'center'}); const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }", text)
        time.sleep(0.2); im = Image.open(io.BytesIO(pg.screenshot(clip=box))).convert('RGB')
        px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
        return sum(1 for (r, g, b) in px if r >= 235 and 195 <= g <= 230 and b <= 60)
    hl = {t: gold(t) for t in ['Payment Platform Migration', 'Review Pending']}
    t('stale copy: highlights survive an older copy sweeping marks on a live page update', all(v > 150 for v in hl.values()), hl)
    pg.screenshot(path=str(SHOTS/'v206-stale-copy.png'))
    sn = snippets(pop)
    t('hindi table: plain English titles are untranslated; "Review Pending" is labelled English', 'Payment Platform Migration' in sn and 'English' in next(r for r in rows(pop) if r.startswith('Review Pending')), rows(pop))
    pop.click('#tabUnsure'); time.sleep(0.2); un = snippets(pop)
    t('hindi table: titles that may be names are listed as unclear, not counted as translated', all(x in un for x in ['Wisight Mapping', 'Wisight Sytems Developer', 'Wisight Development', 'Trucost']), un)
    t('hindi table: user IDs are not listed (counted as names)', not any(x in un + sn for x in ['jeffemployee', 'vasuemployee', 'jeffadmin']), un + sn)
    pop.click('#tabBad'); time.sleep(0.2); sn = snippets(pop)
    t('hindi table: "Inventory Management" and "Home IOT" are untranslated', 'Inventory Management' in sn and 'Home IOT' in sn, sn)
    pop.click('#tabUnsure'); time.sleep(0.2); un = snippets(pop)
    t('hindi table: BrandCase titles ("HomeIoT", "TrueCost") are listed, not skipped', 'HomeIoT' in un and 'TrueCost' in un, un)
    tips = pop.eval_on_selector_all('#list li > button:first-child', 'els => els.map(e => e.title)')
    t('tooltips are short (the reason only, no surrounding text)', all('\n' not in x and len(x) < 90 for x in tips), tips)
    t('no script errors on the page or in the popup', not errors, errors)
    # ---- "Page's own language" follows the page: <html lang="en"> never changes, the app swaps its interface text from Hindi to English
    A = B + '/app-switch.html'
    pg.goto(A); pg.bring_to_front()
    pop.evaluate("u => { window.__T = u; }", A); set_lang(pop, 'auto'); pop.click('#tabBad'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    chips = pop.eval_on_selector_all('#chips .chip', 'els => els.map(e => e.textContent.trim())')
    t('own language: a page that says English but shows Hindi is checked as Hindi', 'Hindi' in chips and any('Page says English' in c for c in chips), chips)
    t('own language: no "wrong target" banner, Hindi text is not flagged', not pop.is_visible('#mismatch') and not any('सत्र' in x for x in snippets(pop)), (pop.is_visible('#mismatch'), snippets(pop)[:5]))
    pg.bring_to_front(); pg.click('#uiLang'); time.sleep(3.5)   # the user switches the app to English; no click in the extension
    pop.bring_to_front(); time.sleep(0.3)
    chips = pop.eval_on_selector_all('#chips .chip', 'els => els.map(e => e.textContent.trim())')
    t('own language: switching the app to English re-checks as English by itself', 'English' in chips and not any('Page says' in c for c in chips), chips)
    t('own language: and the English page has no untranslated text', pop.inner_text('#nBad') == '0', (pop.inner_text('#nBad'), snippets(pop)[:6]))
    pop.screenshot(path=str(SHOTS/'v206-own-language.png'))
    # ---- German dashboard: every copy of a project title is listed (cards and both tables), titles in the same column judged together
    D = B + '/de-dashboard.html'
    pg.goto(D); pg.bring_to_front()
    pop.evaluate("u => { window.__T = u; }", D); set_lang(pop, 'de'); pop.click('#tabUnsure'); pop.click('#scan'); time.sleep(1); wait_idle(pop)
    pop.click('#tabUnsure'); time.sleep(0.2); un = rows(pop)
    sk = next((r for r in un if r.startswith('Skill Scout')), '')
    t('de dashboard: all three "Skill Scout" copies are one listed item (×3)', '×3' in sk, un)
    t('de dashboard: "Hire Flow", "Wisight" and "Truecost" are listed', all(any(r.startswith(x) for r in un) for x in ['Hire Flow', 'Wisight', 'Truecost']), un)
    t('de dashboard: "TrueCost" is its own row next to "Truecost"', any(r.startswith('TrueCost') for r in un) and any(r.startswith('Truecost') for r in un), un)
    t('de dashboard: German text is not listed', not any(x in ' '.join(snippets(pop)) for x in ['Projektgesundheit', 'Aktualisiert', 'Kritisch', 'Übersicht']), snippets(pop))
    # ---- Unclear → "Untranslated": the person decides; it moves to Untranslated, is highlighted, and stays there on the next check
    n_bad = int(pop.inner_text('#nBad'))
    pop.screenshot(path=str(SHOTS/'v206-mark.png'))
    idx = next(i for i, r in enumerate(rows(pop)) if r.startswith('Truecost'))
    pop.click(f'#list li:nth-child({idx + 1}) .mark-btn'); time.sleep(0.4); wait_idle(pop)
    t('mark: "Truecost" leaves Unclear', not any(r.startswith('Truecost') for r in rows(pop)), rows(pop))
    pop.click('#tabBad'); time.sleep(0.2); bad = rows(pop)
    t('mark: and is listed under Untranslated (both copies, every spelling)', any(r.startswith('Truecost') and '×2' in r and 'Marked untranslated by you' in r for r in bad) and any(r.startswith('TrueCost') for r in bad) and int(pop.inner_text('#nBad')) > n_bad, bad)
    hl = pg.evaluate("() => { for (const [k, h] of CSS.highlights) if (/-bad$/.test(k)) return [...h].map(r => r.toString()); return []; }")
    t('mark: the copies are highlighted as untranslated on the page', hl.count('Truecost') == 2 and 'TrueCost' in hl, hl)
    pop.click('#scan'); time.sleep(1); wait_idle(pop); pop.click('#tabBad'); time.sleep(0.2)
    t('mark: still untranslated on a fresh check', any(r.startswith('Truecost') for r in rows(pop)), rows(pop))
    idx = next(i for i, r in enumerate(rows(pop)) if r.startswith('Truecost'))
    pop.click(f'#list li:nth-child({idx + 1}) .mark-btn'); time.sleep(0.4); wait_idle(pop)   # Unmark
    pop.click('#tabUnsure'); time.sleep(0.2)
    t('mark: Unmark puts it back under Unclear', any(r.startswith('Truecost') for r in rows(pop)), rows(pop))
    # ---- Live updates: new text is checked within a second, also while a clock on the page ticks every 0.4 s
    L = B + '/de-live.html'
    pg.goto(L); pg.bring_to_front()
    pop.evaluate("u => { window.__T = u; }", L); set_lang(pop, 'auto')
    pop.evaluate("() => { for (const id of ['unsure', 'live']) { const c = document.getElementById(id); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); } } }")
    pop.click('#scan'); time.sleep(1); wait_idle(pop); pg.bring_to_front(); time.sleep(1.2)
    HL = "t => { for (const [k, h] of CSS.highlights) if (/-(bad|unsure)$/.test(k)) for (const r of h) if (r.toString() === t) return true; return false; }"
    def shown_after(txt):
        pg.evaluate("t => window.addRow(t)", txt); t0 = time.time()
        while time.time() - t0 < 5:
            if pg.evaluate(HL, txt): return time.time() - t0
            time.sleep(0.02)
        return None
    tick = [shown_after(f'Customer onboarding has not started yet {k}') for k in range(3)]
    t('live: with a ticking clock, new English text is highlighted within 1 s (it used to wait until the page went quiet)', all(x is not None and x < 1.0 for x in tick), tick)
    pg.evaluate("() => window.stopTick()"); time.sleep(1)
    quiet = [shown_after(f'Quarterly revenue forecast is not ready {k}') for k in range(3)]
    t('live: on a quiet page within 0.6 s (was 0.7 s of waiting)', all(x is not None and x < 0.6 for x in quiet), quiet)
    t('live: the clock text itself is not listed', not any('Zuletzt aktualisiert' in x for x in snippets(pop)), snippets(pop)[:8])
    pg.goto(URL); time.sleep(0.3)
    ctx.close()
print(f'\n2.0.6 e2e: {sum(res)} passed, {len(res)-sum(res)} failed'); sys.exit(0 if all(res) else 1)
