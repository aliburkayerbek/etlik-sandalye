import re, json, base64, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
P = ROOT / 'public'
B = ROOT / 'demo'
logo = 'data:image/svg+xml;base64,' + base64.b64encode((P/'img/logo.svg').read_bytes()).decode()

def fix_js(s):
    s = s.replace('location.href =', 'DEMO.href =').replace('location.search', 'DEMO.search').replace('location.pathname', 'DEMO.path')
    s = s.replace('window.print()', 'DEMO.print()').replace("(await (await fetch('/kvkk-metni.html')).text())", 'DEMO.kvkk')
    s = s.replace("await (await fetch('/kvkk-metni.html')).text()", 'DEMO.kvkk')
    return s

templates, pages = {}, {}
for key in ['index', 'sandalye', 'giris', 'personel', 'admin', 'etiket']:
    html = (P/f'{key}.html').read_text()
    body = html.split('<body>', 1)[1].split('<script', 1)[0]
    body = body.replace('/img/logo.svg', logo)
    templates[key] = body
    js = (P/f'js/{key}.js').read_text()
    pages[key] = fix_js(js)

templates['giris'] = templates['giris'].replace('</form></main>', '''</form>
<div class="card login demo-users"><h2>Demo kullanıcıları</h2><p class="muted">Şifre hepsinde: <b>demo1234</b></p>
<dl class="kv"><dt>admin</dt><dd>Admin: her şey</dd><dt>supervizor1</dt><dd>Süpervizör: tüm kampüs</dd>
<dt>kalp.personel</dt><dd>Personel: yalnızca Kalp Damar</dd></dl></div></main>''')
templates['index'] = templates['index'].replace('placeholder="TS-0001"', 'placeholder="TS-0001 (1–1270 arası)"')

bar = '''<div class="demobar"><b>DEMO</b><span class="dtxt">Örnek veri · kayıtlar yalnızca bu tarayıcıda</span>
<span class="dqr"><input id="demoId" type="text" placeholder="QR simülasyonu: TS-0001" autocapitalize="characters"><button id="demoScan">QR okut</button></span>
<a href="/">Hasta</a><a href="/personel">Personel</a><a href="/admin">Admin</a><button id="demoReset">Sıfırla</button></div>'''

demo_css = '''
.demobar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:7px 12px;background:#fff6dc;border-bottom:1px solid #ecd9a0;font-size:13.5px;color:#5a4410}
.demobar b{background:#b7791f;color:#fff;padding:2px 8px;border-radius:6px;letter-spacing:.5px}
.demobar a,.demobar button{color:#12355b;font-weight:700;text-decoration:none;background:#fff;border:1px solid #ecd9a0;border-radius:8px;padding:6px 10px;font:inherit;font-weight:700;cursor:pointer;min-height:34px;display:inline-flex;align-items:center}
.demobar .dqr{display:flex;gap:4px}.demobar input{width:190px;padding:6px 8px;font-size:16px;border:1px solid #ecd9a0;border-radius:8px}
.demobar .dtxt{margin-right:auto}
@media(max-width:700px){.demobar .dtxt{display:none}.demobar .dqr{order:9;width:100%}.demobar input{flex:1;width:auto}}
#demoNotice{position:fixed;left:50%;bottom:20px;transform:translate(-50%,30px);opacity:0;pointer-events:none;background:#12355b;color:#fff;padding:12px 16px;border-radius:12px;max-width:min(520px,92vw);font-size:14.5px;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:.25s;z-index:99}
#demoNotice.on{opacity:1;transform:translate(-50%,0)}
.demo-users{margin-top:0}
@media print{.demobar{display:none}}
'''
css = (P/'css/style.css').read_text() + (P/'css/etiket.css').read_text() + demo_css
kvkk = (P/'kvkk-metni.html').read_text()
pages_js = 'const PAGES = {\n' + ',\n'.join(
    f'{json.dumps(k)}: function(){{ (function(setInterval, alert, confirm, prompt){{\n{v}\n}})(demoSetInterval, demoAlert, demoConfirm, demoPrompt); }}'
    for k, v in pages.items()) + '};'
common = fix_js((P/'js/common.js').read_text())
fault = (P/'js/fault-picker.js').read_text()
xlsx = (ROOT / 'node_modules/xlsx/dist/xlsx.full.min.js').read_text()
qr = (ROOT/'node_modules/qrcode-generator/qrcode.js').read_text()
safe = lambda s: s.replace('</script', '<\\/script')
out = f'''<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Etlik ŞH Sandalye Demo</title><meta name="color-scheme" content="light"><style>{css}</style></head><body>
<script>{safe(xlsx)}</script><script>{safe(qr)}</script>
<script>
const KVKK_HTML = {json.dumps(kvkk)};
const TEMPLATES = {json.dumps(templates, ensure_ascii=False)};
const DEMO_BAR = {json.dumps(bar, ensure_ascii=False)};
</script>
<script>{safe(common)}
{safe(fault)}
{safe((B/'mock-api.js').read_text())}
{safe(pages_js)}
{safe((B/'runtime.js').read_text())}</script></body></html>'''
out = out.replace('\ufffd', '\\uFFFD')
(B/'etlik-demo.html').write_text(out)
print(len(out)//1024, 'KB')
