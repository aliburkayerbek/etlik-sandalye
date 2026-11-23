// Uçtan uca duman testi: sunucuyu başlatır, ödünç → onay → iade (arızalı) → iade onayı → raporlar akışını dener.
// Kullanım: .env doluyken `npm test`. Test kayıtları "TEST-" önekiyle oluşturulur ve sonda silinir.
require('dotenv').config({ quiet: true });
process.env.PORT = process.env.TEST_PORT || '3999';
process.env.NODE_ENV = 'test';
const XLSX = require('xlsx');
const { pool } = require('../src/db');

const base = `http://localhost:${process.env.PORT}`;
let cookie = '';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };

async function call(path, { method = 'GET', body, form } = {}) {
  const headers = { cookie };
  let payload;
  if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers, body: payload });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer(), ct };
}

async function cleanup() {
  await pool.query("DELETE FROM fault_reports WHERE chair_id LIKE 'TEST-%'");
  await pool.query("DELETE FROM loans WHERE chair_id LIKE 'TEST-%'");
  await pool.query("DELETE FROM chairs WHERE id_no LIKE 'TEST-%'");
}

(async () => {
  require('../server');
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  await cleanup();

  let r = await call('/api/auth/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD } });
  ok(r.status === 200, 'Admin girişi');

  // Excel yükleme (1 boş satır + 1 eksik mahal uyarısı beklenir)
  const ws = XLSX.utils.aoa_to_sheet([['ID No', 'Tanımlı Mahal'], ['TEST-0001', 'Kalp Damar Hastanesi - Ana Giriş Danışma'],
    ['', ''], ['TEST-0002', ''], ['test-0003', 'Nöroloji - Ortopedi Hastanesi - Acil Giriş']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
  const mk = () => { const f = new FormData(); f.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'test.xlsx'); return f; };
  r = await call('/api/admin/chairs/import?dryRun=1', { method: 'POST', form: mk() });
  ok(r.status === 200 && r.data.insert === 2 && r.data.warnings.length === 2, `Excel önizleme: ${r.data.insert} yeni, ${r.data.warnings?.length} uyarı`);
  r = await call('/api/admin/chairs/import', { method: 'POST', form: mk() });
  ok(r.data.insert === 2, 'Excel yükleme kaydedildi');
  const c3 = (await pool.query("SELECT hospital FROM chairs WHERE id_no='TEST-0003'")).rows[0];
  ok(c3 && c3.hospital === 'Nöroloji - Ortopedi Hastanesi', 'Mahalden hastane çıkarımı (tireli hastane adı)');

  r = await call('/api/chairs/test-0001');
  ok(r.data.action === 'borrow' && r.data.mahal.includes('Kalp Damar'), 'QR ile sandalye ve Tanımlı Mahal okundu');

  const form = { chairId: 'TEST-0001', fullName: 'Ayşe Yılmaz', tc: '10000000146', phone: '0532 111 22 33',
    fromHospital: 'Kalp Damar Hastanesi', fromDepartment: 'Kardiyoloji Polikliniği', fault: { has: false }, kvkkVersion: 'v1.0-2026-11' };
  r = await call('/api/loans', { method: 'POST', body: { ...form, kvkkAccepted: false } });
  ok(r.status === 400 && /KVKK/.test(r.data.error), 'KVKK onaysız form reddedildi');
  r = await call('/api/loans', { method: 'POST', body: { ...form, tc: '12345678901', kvkkAccepted: true } });
  ok(r.status === 400 && /T\.C\./.test(r.data.error), 'Geçersiz T.C. reddedildi');
  r = await call('/api/loans', { method: 'POST', body: { ...form, fault: { has: true, parts: [] }, kvkkAccepted: true } });
  ok(r.status === 400, 'Arıza Var seçilip parça seçilmezse reddedildi');
  r = await call('/api/loans', { method: 'POST', body: { ...form, kvkkAccepted: true } });
  ok(r.status === 201 && r.data.refCode, `Ödünç talebi oluştu (${r.data.refCode})`);
  r = await call('/api/loans', { method: 'POST', body: { ...form, kvkkAccepted: true } });
  ok(r.status === 409, 'Aynı sandalyeye ikinci talep engellendi');

  const loan = (await pool.query("SELECT * FROM loans WHERE chair_id='TEST-0001' ORDER BY id DESC LIMIT 1")).rows[0];
  ok(loan.kvkk_version === 'v1.0-2026-11' && loan.kvkk_accepted_at && !loan.tc_enc.includes('10000000146'), 'KVKK zaman damgası/sürüm kaydı ve T.C. şifreli');

  r = await call('/api/staff/queue');
  ok(r.data.some((x) => x.id === loan.id && x.tc_masked === '100******46'), 'Personel kuyruğunda maskeli görünüyor');
  r = await call(`/api/staff/loans/${loan.id}/approve`, { method: 'POST', body: {} });
  ok(r.status === 200, '"Onayla ve Teslim Et"');
  ok((await call('/api/chairs/TEST-0001')).data.status === 'kullanimda', 'Sandalye Kullanımda');

  r = await call('/api/returns', { method: 'POST', body: { chairId: 'TEST-0001', fault: { has: true, parts: ['tekerlek', 'tutamac'], note: 'Fren tutmuyor' }, note: 'Danışmaya bıraktım' } });
  ok(r.status === 201, 'İade talebi (arızalı) düştü');
  r = await call(`/api/staff/loans/${loan.id}/approve-return`, { method: 'POST', body: { markFaulty: true } });
  ok(r.data.chairStatus === 'arizali', 'İade onayı → Arızalı / Kontrol Gerekli');

  r = await call('/api/admin/reports/ariza_parca');
  ok(r.data.rows.some((x) => x.parca === 'Tekerlek'), 'Arıza parça raporu');
  r = await call('/api/admin/reports/personel');
  ok(r.data.rows.some((x) => x.teslim >= 1 && x.iade >= 1), 'Personel saat aralığı raporu');
  r = await call('/api/admin/reports/kullanim?by=bolum');
  ok(r.data.rows.length >= 1, 'Bölüm bazlı kullanım raporu');
  r = await call('/api/admin/reports/durum?format=xlsx');
  ok(r.status === 200 && r.ct.includes('spreadsheet'), 'Excel dışa aktarma');
  r = await call('/api/admin/labels?ids=TEST-0001,TEST-0003');
  ok(r.data.length === 2 && r.data[0].svg.startsWith('<svg'), 'QR etiket üretimi');
  r = await call('/api/admin/chairs/TEST-0001/status', { method: 'POST', body: { status: 'musait' } });
  ok(r.status === 200, 'Bakımdan çıkarıldı');

  await cleanup();
  await pool.query("DELETE FROM audit_log WHERE chair_id LIKE 'TEST-%'");
  console.log(failed ? `\n${failed} test başarısız` : '\nTüm testler geçti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
