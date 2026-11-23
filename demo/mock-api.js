// DEMO: Sunucunun yerine tarayıcıda çalışan sahte API. Kurallar src/routes/*.js ile aynıdır.
const DEMO_HOSPITALS = ['Genel Hastane', 'Kalp Damar Hastanesi', 'Onkoloji Hastanesi', 'Nöroloji - Ortopedi Hastanesi',
  'Kadın Doğum Hastanesi', 'Çocuk Hastanesi', 'Fizik Tedavi ve Rehabilitasyon Hastanesi', 'Yüksek Güvenlikli Adli Psikiyatri Hastanesi'];
const DEMO_PARTS = { tekerlek: 'Tekerlek', sirtlik: 'Sırtlık', koltuk: 'Koltuk', tutamac: 'Tutamaç', diger: 'Diğer' };
const KVKK_V = 'v1.0-2026-11';
const KEY = 'etlik-sandalye-demo-v1';
let DB;

const now = () => new Date().toISOString();
const hospitalFromMahal = (m) => {
  const l = String(m || '').trim().toLocaleLowerCase('tr');
  const h = [...DEMO_HOSPITALS].sort((a, b) => b.length - a.length).find((x) => l.startsWith(x.toLocaleLowerCase('tr')));
  return h || String(m).split(' - ')[0].trim() || 'Tanımsız';
};
const normId = (s) => String(s || '').trim().toUpperCase();
const clean = (s, n = 120) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, n);
function isValidTc(tc) {
  if (!/^[1-9][0-9]{10}$/.test(tc)) return false;
  const d = tc.split('').map(Number);
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  return (d10 + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}
function normPhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.startsWith('90') && s.length === 12) s = s.slice(2);
  if (s.startsWith('0') && s.length === 11) s = s.slice(1);
  return /^5[0-9]{9}$/.test(s) ? s : null;
}
const maskTc = (t) => `${t.slice(0, 3)}******${t.slice(-2)}`;
const maskPhone = (p) => `0${p.slice(0, 3)} *** ** ${p.slice(-2)}`;
const ref = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
function parseFault(f) {
  if (!f || typeof f.has !== 'boolean') return { error: 'Sandalyede arıza olup olmadığını seçin.' };
  if (!f.has) return { has: false, parts: [], note: null };
  const parts = [...new Set((f.parts || []).filter((p) => DEMO_PARTS[p]))];
  const note = clean(f.note, 500) || null;
  if (!parts.length) return { error: 'Arızalı parçayı en az bir tane işaretleyin.' };
  if (parts.includes('diger') && !note) return { error: '"Diğer" seçildiğinde kısa arıza notu yazın.' };
  return { has: true, parts, note };
}
class HttpErr extends Error { constructor(s, m) { super(m); this.status = s; } }
const fail = (s, m) => { throw new HttpErr(s, m); };

/* ---------- Örnek veri ---------- */
function seed() {
  let r = 42; const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const spots = ['Ana Giriş Danışma', 'Acil Giriş', 'Poliklinik Bekleme', 'Otopark Girişi', 'Asansör Holü', 'Kan Alma'];
  const db = { chairs: {}, loans: [], faults: [], users: [], audit: [], seq: { loan: 0, fault: 0, user: 0 }, session: null };
  for (let i = 1; i <= 1270; i++) {
    const mahal = `${DEMO_HOSPITALS[i % 8]} - ${spots[i % 6]}`;
    const id = 'TS-' + String(i).padStart(4, '0');
    db.chairs[id] = { id_no: id, mahal, hospital: hospitalFromMahal(mahal), status: 'musait', active: true, updated_at: now() };
  }
  const U = (username, full_name, role, hospital_scope, shift) => db.users.push({ id: ++db.seq.user, username, full_name, role, hospital_scope, shift, active: true, password: 'demo1234', created_at: now() });
  U('admin', 'Sistem Yöneticisi', 'admin', null, null);
  U('supervizor1', 'Elif Kaya (Süpervizör)', 'supervisor', null, 'Gündüz');
  U('kalp.personel', 'Murat Şahin', 'staff', 'Kalp Damar Hastanesi', 'Gündüz');
  U('genel.personel', 'Zeynep Arslan', 'staff', 'Genel Hastane', 'Akşam');
  U('onko.personel', 'Ali Çelik', 'staff', 'Onkoloji Hastanesi', 'Gündüz');
  const names = ['Ayşe Yılmaz', 'Mehmet Demir', 'Fatma Öztürk', 'Hasan Aydın', 'Emine Koç', 'Mustafa Kurt', 'Hatice Polat', 'İbrahim Doğan', 'Zehra Aksoy', 'Osman Erdem'];
  const deps = ['Kardiyoloji Polikliniği', 'Ortopedi Polikliniği', 'Radyoloji', 'Kan Alma', 'Dahiliye Servisi', 'Nöroloji Polikliniği', 'Fizik Tedavi', 'Onkoloji Günübirlik'];
  const partSets = [['tekerlek'], ['tekerlek'], ['tekerlek', 'tutamac'], ['sirtlik'], ['koltuk'], ['tutamac'], ['tekerlek', 'koltuk']];
  const ids = Object.keys(db.chairs);
  const mkLoan = (chair, reqAt, status) => {
    const uid = 2 + Math.floor(rnd() * 4);
    const l = { id: ++db.seq.loan, ref_code: ref(), chair_id: chair, status, full_name: pick(names), tc_masked: maskTc('10000000146'),
      phone_masked: maskPhone('53' + String(10000000 + Math.floor(rnd() * 89999999))), from_hospital: db.chairs[chair].hospital, from_department: pick(deps),
      kvkk_version: KVKK_V, kvkk_accepted_at: reqAt, borrow_condition_ok: true, return_condition_ok: null, return_note: null,
      requested_at: reqAt, approved_by: null, approved_at: null, return_requested_at: null, return_approved_by: null, return_approved_at: null };
    if (status !== 'onay_bekliyor') { l.approved_by = uid; l.approved_at = new Date(Date.parse(reqAt) + 3 * 60000).toISOString(); }
    db.loans.push(l); return l;
  };
  const used = new Set();
  const freeChair = () => { let c; do c = pick(ids); while (used.has(c)); used.add(c); return c; };
  for (let k = 0; k < 140; k++) { // geçmiş 7 gün
    const day = Math.floor(rnd() * 7), hour = 7 + Math.floor(rnd() * 15);
    const t = new Date(); t.setDate(t.getDate() - day - 1); t.setHours(hour, Math.floor(rnd() * 60), 0, 0);
    const c = pick(ids); const l = mkLoan(c, t.toISOString(), 'tamamlandi');
    const back = new Date(Date.parse(l.approved_at) + (20 + rnd() * 160) * 60000).toISOString();
    l.return_requested_at = back; l.return_approved_at = back; l.return_approved_by = 2 + Math.floor(rnd() * 4);
    l.return_condition_ok = rnd() > 0.15;
    if (!l.return_condition_ok) db.faults.push({ id: ++db.seq.fault, chair_id: c, loan_id: l.id, stage: 'iade', parts: pick(partSets), note: null, created_at: back, resolved_at: back });
  }
  const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  for (let k = 0; k < 24; k++) { const c = freeChair(); mkLoan(c, minsAgo(10 + k * 9), 'kullanimda'); db.chairs[c].status = 'kullanimda'; }
  for (let k = 0; k < 4; k++) { const c = freeChair(); const l = mkLoan(c, minsAgo(90 + k * 20), 'iade_bekliyor'); l.return_requested_at = minsAgo(2 + k * 3); l.return_condition_ok = k !== 1; l.return_note = k === 0 ? 'Danışmaya bıraktım' : null; db.chairs[c].status = 'iade_bekliyor';
    if (k === 1) db.faults.push({ id: ++db.seq.fault, chair_id: c, loan_id: l.id, stage: 'iade', parts: ['tekerlek'], note: 'Sağ ön tekerlek dönmüyor', created_at: l.return_requested_at, resolved_at: null }); }
  for (let k = 0; k < 3; k++) { const c = freeChair(); mkLoan(c, minsAgo(1 + k * 2), 'onay_bekliyor'); db.chairs[c].status = 'onay_bekliyor'; }
  for (let k = 0; k < 7; k++) { const c = freeChair(); db.chairs[c].status = 'arizali';
    db.faults.push({ id: ++db.seq.fault, chair_id: c, loan_id: null, stage: k % 2 ? 'teslim_alma' : 'personel', parts: pick(partSets), note: k === 0 ? 'Fren tutmuyor' : null, created_at: minsAgo(60 * (k + 2)), resolved_at: null }); }
  return db;
}
function load() { try { DB = JSON.parse(localStorage.getItem(KEY)); } catch { DB = null; } if (!DB) { DB = seed(); save(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }
function resetDemo() { DB = seed(); save(); }

/* ---------- Yardımcılar ---------- */
const me = () => { const u = DB.users.find((x) => x.id === DB.session && x.active); return u; };
function need(...roles) {
  const u = me(); if (!u) fail(401, 'Oturum açmanız gerekiyor.');
  if (roles.length && !roles.includes(u.role)) fail(403, 'Bu işlem için yetkiniz yok.');
  return u;
}
const inScope = (u, c) => !u.hospital_scope || u.hospital_scope === c.hospital;
const loanFaults = (l) => { const f = DB.faults.filter((x) => x.loan_id === l.id).map((x) => ({ stage: x.stage, parts: x.parts, note: x.note })); return f.length ? f : null; };
function getLoan(id, u) {
  const l = DB.loans.find((x) => x.id === Number(id)); if (!l) fail(404, 'Kayıt bulunamadı.');
  if (!inScope(u, DB.chairs[l.chair_id])) fail(403, 'Bu hastane için yetkiniz yok.');
  return l;
}
const setChair = (id, s) => { DB.chairs[id].status = s; DB.chairs[id].updated_at = now(); };
const addFault = (chair_id, loan_id, stage, f) => DB.faults.push({ id: ++DB.seq.fault, chair_id, loan_id, stage, parts: f.parts, note: f.note, created_at: now(), resolved_at: null });
const userName = (id) => DB.users.find((u) => u.id === id)?.full_name;

function range(q) {
  const to = q.to ? new Date(q.to + 'T23:59:59') : new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00') : new Date(to - 7 * 864e5);
  return [from.getTime(), to.getTime()];
}
const inR = (t, [a, b]) => t && Date.parse(t) >= a && Date.parse(t) <= b;
const pad = (n) => String(n).padStart(2, '0');
const trDate = (t) => new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const REPORTS = {
  personel(q) {
    const R = range(q), g = {};
    const add = (uid, t, tip) => { const u = DB.users.find((x) => x.id === uid); if (!u) return; const h = new Date(t).getHours();
      const k = u.id + '|' + h; g[k] = g[k] || { personel: u.full_name, rol: u.role, kapsam: u.hospital_scope || 'Tüm kampüs', saat_araligi: `${pad(h)}:00-${pad((h + 1) % 24)}:00`, teslim: 0, iade: 0, toplam: 0 };
      g[k][tip]++; g[k].toplam++; };
    DB.loans.forEach((l) => { if (l.approved_by && l.status !== 'reddedildi' && inR(l.approved_at, R)) add(l.approved_by, l.approved_at, 'teslim');
      if (l.return_approved_by && inR(l.return_approved_at, R)) add(l.return_approved_by, l.return_approved_at, 'iade'); });
    return { title: 'Personel İşlem Raporu (saat aralığı bazında)', columns: [['personel', 'Personel'], ['rol', 'Rol'], ['kapsam', 'Kapsam'], ['saat_araligi', 'Saat Aralığı'], ['teslim', 'Teslim'], ['iade', 'İade'], ['toplam', 'Toplam']],
      rows: Object.values(g).sort((a, b) => a.personel.localeCompare(b.personel, 'tr') || a.saat_araligi.localeCompare(b.saat_araligi)) };
  },
  durum(q) {
    const st = { musait: 'Müsait / Boşta', onay_bekliyor: 'Onay Bekliyor', kullanimda: 'Kullanımda / Teslim Edildi', iade_bekliyor: 'İade Bekliyor', arizali: 'Arızalı / Bakımda' };
    const rows = Object.values(DB.chairs).filter((c) => c.active && (!q.hospital || c.hospital === q.hospital) && (!q.status || c.status === q.status))
      .map((c) => { const l = [...DB.loans].reverse().find((x) => x.chair_id === c.id_no && ['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(x.status));
        return { id_no: c.id_no, mahal: c.mahal, hospital: c.hospital, durum: st[c.status], kullanim_bolumu: l?.from_department || '', son_degisiklik: trDate(c.updated_at) }; });
    return { title: 'Anlık Sandalye Durum Raporu', columns: [['id_no', 'ID No'], ['mahal', 'Tanımlı Mahal'], ['hospital', 'Hastane'], ['durum', 'Durum'], ['kullanim_bolumu', 'Kullanıldığı Bölüm'], ['son_degisiklik', 'Son Değişiklik']], rows };
  },
  ariza_parca(q) {
    const R = range(q), g = {};
    DB.faults.filter((f) => inR(f.created_at, R)).forEach((f) => f.parts.forEach((p) => {
      g[p] = g[p] || { parca: DEMO_PARTS[p], adet: 0, teslim_almada: 0, iadede: 0, personel_admin: 0 };
      g[p].adet++; g[p][f.stage === 'teslim_alma' ? 'teslim_almada' : f.stage === 'iade' ? 'iadede' : 'personel_admin']++; }));
    return { title: 'Arıza Raporu - Parça Bazında', columns: [['parca', 'Parça'], ['adet', 'Toplam Bildirim'], ['teslim_almada', 'Teslim Almada'], ['iadede', 'İadede'], ['personel_admin', 'Personel/Admin']],
      rows: Object.values(g).sort((a, b) => b.adet - a.adet) };
  },
  ariza_sandalye(q) {
    const R = range(q), g = {};
    DB.faults.filter((f) => inR(f.created_at, R)).forEach((f) => { const c = DB.chairs[f.chair_id];
      const x = g[f.chair_id] = g[f.chair_id] || { id_no: c.id_no, mahal: c.mahal, hospital: c.hospital, bildirim: 0, p: new Set(), acik: 0, t: 0 };
      x.bildirim++; f.parts.forEach((p) => x.p.add(DEMO_PARTS[p])); if (!f.resolved_at) x.acik++; x.t = Math.max(x.t, Date.parse(f.created_at)); });
    const rows = Object.values(g).sort((a, b) => b.bildirim - a.bildirim || b.t - a.t).map(({ p, t, ...x }) => ({ ...x, parcalar: [...p].join(', '), son_bildirim: trDate(t) }));
    return { title: 'Arıza Raporu - Sandalye Bazında', columns: [['id_no', 'ID No'], ['mahal', 'Tanımlı Mahal'], ['hospital', 'Hastane'], ['bildirim', 'Bildirim'], ['parcalar', 'Parçalar'], ['acik', 'Açık Arıza'], ['son_bildirim', 'Son Bildirim']], rows };
  },
  kullanim(q) {
    const R = range(q), g = {};
    const label = { hastane: 'Sandalyenin Hastanesi', mahal: 'Tanımlı Mahal', bolum: 'Gidilen Hastane / Bölüm' }[q.by] || 'Sandalyenin Hastanesi';
    DB.loans.filter((l) => inR(l.approved_at, R) && ['kullanimda', 'iade_bekliyor', 'tamamlandi'].includes(l.status)).forEach((l) => {
      const c = DB.chairs[l.chair_id]; const k = q.by === 'mahal' ? c.mahal : q.by === 'bolum' ? `${l.from_hospital} / ${l.from_department}` : c.hospital;
      g[k] = g[k] || { grup: k, odunc: 0, s: 0 }; g[k].odunc++; g[k].s += ((l.return_approved_at ? Date.parse(l.return_approved_at) : Date.now()) - Date.parse(l.approved_at)) / 60000; });
    return { title: `Kullanım Yoğunluğu - ${label}`, columns: [['grup', label], ['odunc', 'Ödünç Sayısı'], ['ort_sure_dk', 'Ort. Kullanım (dk)']],
      rows: Object.values(g).sort((a, b) => b.odunc - a.odunc).map((x) => ({ grup: x.grup, odunc: x.odunc, ort_sure_dk: Math.round(x.s / x.odunc) })) };
  },
};

/* ---------- Uçlar ---------- */
async function route(method, path, q, b) {
  let m;
  if (path === '/api/meta') return { org: 'Etlik Şehir Hastanesi', hospitals: DEMO_HOSPITALS, faultParts: DEMO_PARTS, kvkkVersion: KVKK_V };
  if ((m = path.match(/^\/api\/chairs\/(.+)$/))) {
    const c = DB.chairs[normId(decodeURIComponent(m[1]))];
    if (!c || !c.active) fail(404, `${normId(decodeURIComponent(m[1]))} numaralı sandalye bulunamadı. Lütfen danışmaya başvurun.`);
    return { idNo: c.id_no, mahal: c.mahal, hospital: c.hospital, status: c.status,
      action: { musait: 'borrow', kullanimda: 'return', onay_bekliyor: 'wait', iade_bekliyor: 'wait', arizali: 'unavailable' }[c.status] };
  }
  if (path === '/api/loans' && method === 'POST') {
    const id = normId(b.chairId), fullName = clean(b.fullName, 100), tc = String(b.tc || '').replace(/\D/g, ''), phone = normPhone(b.phone);
    const fh = clean(b.fromHospital, 100), fd = clean(b.fromDepartment, 120), f = parseFault(b.fault), e = [];
    if (fullName.split(' ').length < 2) e.push('Ad ve soyadı birlikte yazın.');
    if (!isValidTc(tc)) e.push('T.C. Kimlik No geçersiz.');
    if (!phone) e.push('Telefon numarası 05XX XXX XX XX biçiminde olmalı.');
    if (!DEMO_HOSPITALS.includes(fh)) e.push('Geldiğiniz hastaneyi seçin.');
    if (fd.length < 2) e.push('Geldiğiniz bölüm / poliklinik / servisi yazın.');
    if (f.error) e.push(f.error);
    if (b.kvkkAccepted !== true || b.kvkkVersion !== KVKK_V) e.push('KVKK Aydınlatma Metni onayı zorunludur.');
    if (e.length) fail(400, e.join(' '));
    const c = DB.chairs[id]; if (!c) fail(404, 'Sandalye bulunamadı.');
    if (c.status !== 'musait') fail(409, 'Bu sandalye şu anda ödünç verilemez. Lütfen danışmaya başvurun.');
    const l = { id: ++DB.seq.loan, ref_code: ref(), chair_id: id, status: 'onay_bekliyor', full_name: fullName, tc_masked: maskTc(tc), phone_masked: maskPhone(phone),
      from_hospital: fh, from_department: fd, kvkk_version: KVKK_V, kvkk_accepted_at: now(), borrow_condition_ok: !f.has, return_condition_ok: null, return_note: null,
      requested_at: now(), approved_by: null, approved_at: null, return_requested_at: null, return_approved_by: null, return_approved_at: null };
    DB.loans.push(l); if (f.has) addFault(id, l.id, 'teslim_alma', f); setChair(id, 'onay_bekliyor');
    return { ok: true, refCode: l.ref_code };
  }
  if (path === '/api/returns' && method === 'POST') {
    const id = normId(b.chairId), f = parseFault(b.fault); if (f.error) fail(400, f.error);
    const c = DB.chairs[id]; if (!c) fail(404, 'Sandalye bulunamadı.');
    if (c.status !== 'kullanimda') fail(409, 'Bu sandalye için açık bir ödünç kaydı yok.');
    const l = [...DB.loans].reverse().find((x) => x.chair_id === id && x.status === 'kullanimda');
    Object.assign(l, { status: 'iade_bekliyor', return_requested_at: now(), return_condition_ok: !f.has, return_note: clean(b.note, 500) || null });
    if (f.has) addFault(id, l.id, 'iade', f); setChair(id, 'iade_bekliyor');
    return { ok: true, refCode: l.ref_code };
  }
  if (path === '/api/auth/login') {
    const u = DB.users.find((x) => x.username === clean(b.username, 60).toLowerCase());
    if (!u || !u.active || u.password !== String(b.password)) fail(401, 'Kullanıcı adı veya şifre hatalı.');
    DB.session = u.id; return { ok: true, role: u.role, name: u.full_name };
  }
  if (path === '/api/auth/logout') { DB.session = null; return { ok: true }; }
  if (path === '/api/auth/me') { const u = need(); return { id: u.id, role: u.role, name: u.full_name, scope: u.hospital_scope }; }

  if (path.startsWith('/api/staff/')) {
    const u = need('staff', 'supervisor', 'admin');
    const vis = (l) => inScope(u, DB.chairs[l.chair_id]);
    const withChair = (l) => ({ ...l, mahal: DB.chairs[l.chair_id].mahal, hospital: DB.chairs[l.chair_id].hospital });
    if (path === '/api/staff/queue') return DB.loans.filter((l) => ['onay_bekliyor', 'iade_bekliyor'].includes(l.status) && vis(l))
      .map((l) => ({ ...withChair(l), faults: loanFaults(l) })).sort((a, z) => Date.parse(a.return_requested_at || a.requested_at) - Date.parse(z.return_requested_at || z.requested_at));
    if (path === '/api/staff/active') return DB.loans.filter((l) => l.status === 'kullanimda' && vis(l)).map(withChair).sort((a, z) => Date.parse(a.approved_at) - Date.parse(z.approved_at));
    if (path === '/api/staff/summary') { const g = {}; Object.values(DB.chairs).filter((c) => c.active && inScope(u, c)).forEach((c) => { const k = c.hospital + '|' + c.status; g[k] = g[k] || { hospital: c.hospital, status: c.status, n: 0 }; g[k].n++; }); return Object.values(g); }
    if ((m = path.match(/^\/api\/staff\/loans\/(\d+)\/([a-z-]+)$/))) {
      const l = getLoan(m[1], u), act = m[2];
      if (act === 'approve') { if (l.status !== 'onay_bekliyor') fail(409, 'Bu talep artık onay beklemiyor.'); Object.assign(l, { status: 'kullanimda', approved_by: u.id, approved_at: now() }); setChair(l.chair_id, 'kullanimda'); }
      else if (act === 'reject') { if (l.status !== 'onay_bekliyor') fail(409, 'Bu talep artık onay beklemiyor.'); Object.assign(l, { status: 'reddedildi', approved_by: u.id, approved_at: now(), closed_note: b.reason }); setChair(l.chair_id, b.markFaulty ? 'arizali' : 'musait'); }
      else if (act === 'approve-return') { if (l.status !== 'iade_bekliyor') fail(409, 'Bu kayıt iade beklemiyor.');
        const s = (l.return_condition_ok === false || b.markFaulty === true) && b.markFaulty !== false ? 'arizali' : 'musait';
        Object.assign(l, { status: 'tamamlandi', return_approved_by: u.id, return_approved_at: now() }); setChair(l.chair_id, s); return { ok: true, chairStatus: s }; }
      else if (act === 'force-return') { if (l.status !== 'kullanimda') fail(409, 'Kayıt kullanımda değil.');
        Object.assign(l, { status: 'tamamlandi', return_requested_at: now(), return_condition_ok: true, return_approved_by: u.id, return_approved_at: now() }); setChair(l.chair_id, 'musait'); }
      return { ok: true };
    }
  }

  if (path.startsWith('/api/admin/')) {
    const p = path.slice(10);
    if (p === '/users' && method === 'GET') { need('admin'); return DB.users.map(({ password, ...x }) => x); }
    if ((m = p.match(/^\/users(?:\/(\d+))?$/))) {
      const a = need('admin'), isNew = !m[1];
      const x = { username: clean(b.username, 60).toLowerCase(), full_name: clean(b.full_name, 100), role: b.role, hospital_scope: DEMO_HOSPITALS.includes(b.hospital_scope) ? b.hospital_scope : null, shift: b.shift || null };
      if (!/^[a-z0-9._-]{3,60}$/.test(x.username)) fail(400, 'Kullanıcı adı 3-60 karakter; harf, rakam, nokta, tire.');
      if (x.full_name.length < 3) fail(400, 'Ad soyad girin.');
      if ((isNew || b.password) && String(b.password || '').length < 8) fail(400, 'Şifre en az 8 karakter olmalı.');
      if (DB.users.some((y) => y.username === x.username && y.id !== Number(m[1]))) fail(409, 'Bu kullanıcı adı zaten var.');
      if (isNew) { DB.users.push({ id: ++DB.seq.user, ...x, active: true, password: b.password, created_at: now() }); return { ok: true }; }
      if (Number(m[1]) === a.id && (b.active === false || x.role !== 'admin')) fail(400, 'Kendi admin hesabınızı pasife alamaz veya rolünü düşüremezsiniz.');
      Object.assign(DB.users.find((y) => y.id === Number(m[1])), x, { active: b.active !== false }, b.password ? { password: b.password } : {});
      return { ok: true };
    }
    if (p === '/chairs' && method === 'GET') {
      need('admin', 'supervisor'); const s = String(q.q || '').toLocaleLowerCase('tr');
      const all = Object.values(DB.chairs).filter((c) => (!s || (c.id_no + ' ' + c.mahal).toLocaleLowerCase('tr').includes(s)) && (!q.hospital || c.hospital === q.hospital) && (!q.status || c.status === q.status))
        .sort((a, z) => a.id_no.localeCompare(z.id_no));
      const off = Number(q.offset) || 0;
      return { total: all.length, rows: all.slice(off, off + 100).map((c) => ({ ...c, open_faults: DB.faults.filter((f) => f.chair_id === c.id_no && !f.resolved_at).length })) };
    }
    if (p === '/chairs' && method === 'POST') {
      need('admin'); const id = normId(b.id_no), mahal = clean(b.mahal, 200);
      if (!id || !mahal) fail(400, 'ID No ve Tanımlı Mahal zorunlu.'); if (DB.chairs[id]) fail(409, 'Bu ID No zaten kayıtlı.');
      DB.chairs[id] = { id_no: id, mahal, hospital: hospitalFromMahal(mahal), status: 'musait', active: true, updated_at: now() }; return { ok: true };
    }
    if ((m = p.match(/^\/chairs\/([^/]+)\/status$/))) {
      const u = need('admin', 'supervisor'); const id = normId(decodeURIComponent(m[1])), c = DB.chairs[id]; if (!c) fail(404, 'Sandalye bulunamadı.');
      if (!['arizali', 'musait'].includes(b.status)) fail(400, 'Geçersiz statü.');
      if (['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(c.status)) fail(409, 'Sandalyenin açık bir ödünç kaydı var. Önce Hareketler bölümünden kapatın.');
      if (b.fault) { const f = parseFault(b.fault); if (f.error) fail(400, f.error); if (f.has) addFault(id, null, 'admin', f); }
      if (b.status === 'musait') DB.faults.filter((f) => f.chair_id === id && !f.resolved_at).forEach((f) => { f.resolved_at = now(); f.resolved_by = u.id; });
      setChair(id, b.status); return { ok: true };
    }
    if ((m = p.match(/^\/chairs\/([^/]+)$/)) && method === 'PUT') {
      need('admin'); const c = DB.chairs[normId(decodeURIComponent(m[1]))]; if (!c) fail(404, 'Sandalye bulunamadı.');
      const mahal = clean(b.mahal, 200); if (!mahal) fail(400, 'Tanımlı Mahal zorunlu.');
      Object.assign(c, { mahal, hospital: hospitalFromMahal(mahal), active: b.active !== false, updated_at: now() }); return { ok: true };
    }
    if (p === '/chairs/import') {
      need('admin'); const file = b.get('file');
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) fail(400, 'Yalnızca .xlsx, .xls veya .csv yükleyin.');
      let raw; try { const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: true }); }
      catch { fail(400, 'Dosya okunamadı. Şablonu kullanarak tekrar deneyin.'); }
      const h = (raw[0] || []).map((x) => String(x).trim()), iI = h.indexOf('ID No'), iM = h.indexOf('Tanımlı Mahal');
      if (iI < 0 || iM < 0) fail(400, `Sütun başlıkları birebir "ID No" ve "Tanımlı Mahal" olmalı. Bulunan: ${h.join(', ') || '(boş)'}`);
      const warnings = [], seen = new Map();
      for (let r = 1; r < raw.length; r++) {
        const row = r + 1, id = normId(raw[r][iI]), mahal = clean(raw[r][iM], 200);
        if (!id && !mahal) { if (r < raw.length - 1) warnings.push({ row, message: 'Boş satır atlandı.' }); continue; }
        if (!id) { warnings.push({ row, message: 'ID No boş, satır atlandı.' }); continue; }
        if (!mahal) { warnings.push({ row, id, message: 'Tanımlı Mahal boş, satır atlandı.' }); continue; }
        if (seen.has(id)) warnings.push({ row, id, message: `Dosyada tekrar eden ID (satır ${seen.get(id).row}); son satır geçerli.` });
        seen.set(id, { row, id, mahal, hospital: hospitalFromMahal(mahal) });
      }
      const items = [...seen.values()];
      items.filter((i) => !DEMO_HOSPITALS.includes(i.hospital)).forEach((i) => warnings.push({ row: i.row, id: i.id, message: `Hastane adı tanınmadı ("${i.hospital}"). Mahal "Hastane Adı - Yer" biçiminde olmalı.` }));
      const ins = items.filter((i) => !DB.chairs[i.id]), upd = q.mode === 'insert' ? [] : items.filter((i) => DB.chairs[i.id]);
      const sum = { totalRows: raw.length - 1, valid: items.length, insert: ins.length, update: upd.length, warnings };
      if (q.dryRun === '1') return { dryRun: true, ...sum, preview: items.slice(0, 10) };
      ins.forEach((i) => { DB.chairs[i.id] = { id_no: i.id, mahal: i.mahal, hospital: i.hospital, status: 'musait', active: true, updated_at: now() }; });
      upd.forEach((i) => Object.assign(DB.chairs[i.id], { mahal: i.mahal, hospital: i.hospital, active: true, updated_at: now() }));
      return { dryRun: false, ...sum };
    }
    if (p === '/labels') {
      need('admin', 'supervisor'); const ids = q.ids ? String(q.ids).split(/[,\s]+/).filter(Boolean).map(normId) : null;
      return Object.values(DB.chairs).filter((c) => c.active && (!q.hospital || c.hospital === q.hospital) && (!ids || ids.includes(c.id_no))).sort((a, z) => a.id_no.localeCompare(z.id_no)).slice(0, 2000)
        .map((c) => { const url = `https://etlik-sandalye.onrender.com/s?id=${encodeURIComponent(c.id_no)}`; const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
          return { idNo: c.id_no, mahal: c.mahal, hospital: c.hospital, url, svg: qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true }) }; });
    }
    if (p === '/movements') { need('admin', 'supervisor'); return DB.loans.filter((l) => ['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(l.status))
      .map((l) => ({ ...l, mahal: DB.chairs[l.chair_id].mahal, hospital: DB.chairs[l.chair_id].hospital, approved_by_name: userName(l.approved_by) })).sort((a, z) => Date.parse(a.requested_at) - Date.parse(z.requested_at)); }
    if ((m = p.match(/^\/movements\/(\d+)\/cancel$/))) {
      need('admin'); const l = DB.loans.find((x) => x.id === Number(m[1])); if (!l) fail(404, 'Kayıt bulunamadı.');
      if (!['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(l.status)) fail(409, 'Kayıt zaten kapalı.');
      Object.assign(l, { status: 'iptal', closed_note: b.note }); setChair(l.chair_id, b.chairStatus === 'arizali' ? 'arizali' : 'musait'); return { ok: true };
    }
    if (p === '/faults') { need('admin', 'supervisor'); return DB.faults.filter((f) => q.open === '0' || !f.resolved_at).sort((a, z) => Date.parse(z.created_at) - Date.parse(a.created_at)).slice(0, 500)
      .map((f) => ({ ...f, mahal: DB.chairs[f.chair_id].mahal, hospital: DB.chairs[f.chair_id].hospital, chair_status: DB.chairs[f.chair_id].status })); }
    if ((m = p.match(/^\/faults\/(\d+)\/resolve$/))) { const u = need('admin', 'supervisor'); const f = DB.faults.find((x) => x.id === Number(m[1])); if (f && !f.resolved_at) { f.resolved_at = now(); f.resolved_by = u.id; } return { ok: true }; }
    if ((m = p.match(/^\/reports\/([a-z_]+)$/))) {
      need('admin', 'supervisor'); const fn = REPORTS[m[1]]; if (!fn) fail(404, 'Rapor bulunamadı.');
      const r = fn(q); return { title: r.title, columns: r.columns.map(([key, label]) => ({ key, label })), rows: r.rows };
    }
  }
  fail(404, 'Bulunamadı');
}

async function demoApi(url, opts = {}) {
  const u = new URL(url, 'https://demo.local'), q = Object.fromEntries(u.searchParams), method = (opts.method || 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 120));
  load(); // başka sekmede yapılan değişiklikleri al
  try { const res = await route(method, u.pathname, q, opts.body || {}); save(); return JSON.parse(JSON.stringify(res)); }
  catch (e) {
    if (e.status === 401 && !url.includes('/auth/login')) { DEMO.href = '/giris?next=' + encodeURIComponent(DEMO.path); }
    throw e;
  }
}
load();
