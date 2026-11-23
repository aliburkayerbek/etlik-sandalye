// DEMO yönlendirici: çok sayfalı siteyi tek sayfada çalıştırır.
const DEMO = { path: '/', search: '', kvkk: KVKK_HTML, print() { demoNotice('Yazdırma bu önizleme penceresinde kapalı. Gerçek sistemde bu ekran A4 etiket çıktısı verir (sayfa başına 21 etiket).'); } };
Object.defineProperty(DEMO, 'href', { set(v) { setTimeout(() => nav(v)); } });
let demoTimers = [];
const demoSetInterval = (f, ms) => { const id = setInterval(f, ms); demoTimers.push(id); return id; };
const demoAlert = (m) => demoNotice(m);
const demoConfirm = (m) => !/arızalı\/bakıma/.test(m);
const demoPrompt = () => 'Demo: talep reddedildi';
function demoNotice(msg) {
  let el = document.getElementById('demoNotice');
  if (!el) { el = document.createElement('div'); el.id = 'demoNotice'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 5000);
}
const ROUTES = { '/': 'index', '/s': 'sandalye', '/giris': 'giris', '/personel': 'personel', '/admin': 'admin', '/etiket': 'etiket' };
function nav(url) {
  const u = new URL(url, 'https://demo.local');
  DEMO.path = u.pathname; DEMO.search = u.search;
  demoTimers.forEach(clearInterval); demoTimers = [];
  const key = ROUTES[u.pathname] || 'index';
  document.body.innerHTML = DEMO_BAR + TEMPLATES[key];
  bindBar();
  window.scrollTo(0, 0);
  try { location.hash = key === 'index' ? '' : key; } catch {}
  PAGES[key]();
}
function bindBar() {
  const go = () => { const v = document.getElementById('demoId').value.trim(); nav('/s?id=' + encodeURIComponent(v || 'TS-0001')); };
  document.getElementById('demoScan').onclick = go;
  document.getElementById('demoId').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.getElementById('demoReset').onclick = () => { resetDemo(); nav('/'); demoNotice('Demo verisi ilk haline döndü.'); };
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#') && href !== '#') return;
  if (href === '#') return;
  if (!href.startsWith('/')) return;
  e.preventDefault();
  if (href.startsWith('/api/')) return demoNotice('Dosya indirme bu önizlemede kapalı. Gerçek sistemde bu buton Excel (.xlsx) veya CSV dosyası indirir.');
  nav(href);
}, true);
api = (url, opts = {}) => demoApi(url, opts);
logout = async () => { await api('/api/auth/logout', { method: 'POST' }); nav('/giris'); };
const startKey = Object.entries(ROUTES).find(([, k]) => k === location.hash.slice(1));
nav(startKey ? startKey[0] : '/');
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.status) e.preventDefault(); });
