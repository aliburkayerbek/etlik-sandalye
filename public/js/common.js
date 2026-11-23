// Ortak yardımcılar: API çağrısı, ikonlar, adım infografiği, biçimlendirme.
const ICONS = {
  qr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  form: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  staff: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><path d="M16 11l1.5 1.5L20 10"/></svg>',
  done: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  chair: '<svg viewBox="0 0 24 24"><circle cx="9" cy="18" r="4"/><circle cx="18" cy="20" r="1.5"/><path d="M6 3h2l1 8h7l2 5M9 11V7h6"/></svg>',
  tekerlek: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/></svg>',
  sirtlik: '<svg viewBox="0 0 24 24"><path d="M7 3v13M17 3v13M7 5h10M7 9h10M7 13h10M5 21l2-5M19 21l-2-5"/></svg>',
  koltuk: '<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="6" rx="2"/><path d="M6 15v5M18 15v5"/></svg>',
  tutamac: '<svg viewBox="0 0 24 24"><path d="M4 6h6v4M10 10v10M14 20V10M14 10V6h6"/></svg>',
  diger: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
};

const STATUS = {
  musait: 'Müsait / Boşta', onay_bekliyor: 'Onay Bekliyor', kullanimda: 'Kullanımda',
  iade_bekliyor: 'İade Bekliyor', arizali: 'Arızalı / Bakımda',
};
const PART_HINT = { tekerlek: 'ön/arka, fren, dönme', sirtlik: 'sırt dayanağı', koltuk: 'oturma minderi', tutamac: 'itme kolu', diger: 'kısa not yazın' };

async function api(url, opts = {}) {
  const o = { headers: {}, credentials: 'same-origin', ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(url, o);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !url.includes('/auth/login') && !location.pathname.startsWith('/s')) {
    location.href = '/giris?next=' + encodeURIComponent(location.pathname);
    throw new Error('Oturum gerekli');
  }
  if (!r.ok) throw new Error((data && data.error) || 'İşlem başarısız.');
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (d) => (d ? new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? `${m} dk önce` : `${Math.floor(m / 60)} sa ${m % 60} dk önce`; };
const badge = (s) => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;

// 1. QR Okut -> 2. Kontrol & Form + KVKK -> 3. Personel Onayı -> 4. Tamam
function renderSteps(el, active, labels) {
  const L = labels || ['QR Okut', 'Kontrol, Form ve KVKK', 'Personel Onaylasın', 'İşlem Tamam'];
  const ic = [ICONS.qr, ICONS.form, ICONS.staff, ICONS.done];
  el.innerHTML = L.map((t, i) => {
    const n = i + 1;
    const cls = n < active ? 'done' : n === active ? 'active' : '';
    return `<div class="step ${cls}"><span class="n">${n}</span><div class="ic">${n < active ? ICONS.check : ic[i]}</div>${t}</div>`;
  }).join('');
}

function toast(el, msg, type = 'err') {
  el.innerHTML = msg ? `<div class="alert ${type}">${esc(msg)}</div>` : '';
  if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function logout() { await api('/api/auth/logout', { method: 'POST' }); location.href = '/giris'; }
