// Admin paneli uçları: kullanıcılar, envanter, Excel yükleme, QR etiket, arızalar, raporlar.
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { pool, tx, audit } = require('../db');
const { requireRole } = require('../security');
const { HOSPITALS, CHAIR_STATUS } = require('../config');
const { hospitalFromMahal, normalizeChairId, parseFault, clean } = require('../util');
const { httpErr, sendErr } = require('./public');
const { REPORTS } = require('../reports');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const adminOnly = requireRole('admin');
const supervisorUp = requireRole('admin', 'supervisor');

/* ---------------- Kullanıcılar ---------------- */
router.get('/users', adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, full_name, role, hospital_scope, shift, active, created_at FROM users ORDER BY active DESC, role, full_name'
  );
  res.json(rows);
});

function userInput(b, isNew) {
  const u = {
    username: clean(b.username, 60).toLowerCase(),
    full_name: clean(b.full_name, 100),
    role: b.role,
    hospital_scope: b.hospital_scope && HOSPITALS.includes(b.hospital_scope) ? b.hospital_scope : null,
    shift: clean(b.shift, 40) || null,
    password: b.password ? String(b.password) : null,
  };
  if (!/^[a-z0-9._-]{3,60}$/.test(u.username)) return { error: 'Kullanıcı adı 3-60 karakter; harf, rakam, nokta, tire.' };
  if (u.full_name.length < 3) return { error: 'Ad soyad girin.' };
  if (!['admin', 'supervisor', 'staff'].includes(u.role)) return { error: 'Geçersiz rol.' };
  if ((isNew || u.password) && (!u.password || u.password.length < 8)) return { error: 'Şifre en az 8 karakter olmalı.' };
  return u;
}

router.post('/users', adminOnly, async (req, res) => {
  const u = userInput(req.body || {}, true);
  if (u.error) return res.status(400).json({ error: u.error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role, hospital_scope, shift) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [u.username, u.full_name, await bcrypt.hash(u.password, 10), u.role, u.hospital_scope, u.shift]
    );
    await audit(pool, { userId: req.user.uid, action: 'kullanici_ekle', detail: { id: rows[0].id, username: u.username } });
    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu kullanıcı adı zaten var.' });
    sendErr(res, e);
  }
});

router.put('/users/:id', adminOnly, async (req, res) => {
  const u = userInput(req.body || {}, false);
  if (u.error) return res.status(400).json({ error: u.error });
  const active = req.body.active !== false;
  if (Number(req.params.id) === req.user.uid && (!active || u.role !== 'admin')) {
    return res.status(400).json({ error: 'Kendi admin hesabınızı pasife alamaz veya rolünü düşüremezsiniz.' });
  }
  try {
    await pool.query(
      `UPDATE users SET username=$2, full_name=$3, role=$4, hospital_scope=$5, shift=$6, active=$7
         ${u.password ? ', password_hash=$8' : ''} WHERE id=$1`,
      [req.params.id, u.username, u.full_name, u.role, u.hospital_scope, u.shift, active,
        ...(u.password ? [await bcrypt.hash(u.password, 10)] : [])]
    );
    await audit(pool, { userId: req.user.uid, action: 'kullanici_guncelle', detail: { id: req.params.id, active } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu kullanıcı adı zaten var.' });
    sendErr(res, e);
  }
});

/* ---------------- Sandalyeler ---------------- */
router.get('/chairs', supervisorUp, async (req, res) => {
  const params = [];
  const where = ['TRUE'];
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(c.id_no ILIKE $${params.length} OR c.mahal ILIKE $${params.length})`); }
  if (req.query.hospital) { params.push(req.query.hospital); where.push(`c.hospital=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`c.status=$${params.length}`); }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT c.*, count(*) OVER()::int AS total,
            (SELECT count(*)::int FROM fault_reports f WHERE f.chair_id=c.id_no AND f.resolved_at IS NULL) AS open_faults
       FROM chairs c WHERE ${where.join(' AND ')} ORDER BY c.id_no LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ total: rows[0]?.total || 0, rows });
});

router.post('/chairs', adminOnly, async (req, res) => {
  const id = normalizeChairId(req.body?.id_no);
  const mahal = clean(req.body?.mahal, 200);
  if (!id || !mahal) return res.status(400).json({ error: 'ID No ve Tanımlı Mahal zorunlu.' });
  try {
    await pool.query('INSERT INTO chairs (id_no, mahal, hospital) VALUES ($1,$2,$3)', [id, mahal, hospitalFromMahal(mahal)]);
    await audit(pool, { userId: req.user.uid, action: 'sandalye_ekle', chairId: id });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu ID No zaten kayıtlı.' });
    sendErr(res, e);
  }
});

router.put('/chairs/:id', adminOnly, async (req, res) => {
  const mahal = clean(req.body?.mahal, 200);
  const active = req.body?.active !== false;
  if (!mahal) return res.status(400).json({ error: 'Tanımlı Mahal zorunlu.' });
  const r = await pool.query('UPDATE chairs SET mahal=$2, hospital=$3, active=$4, updated_at=now() WHERE id_no=$1',
    [normalizeChairId(req.params.id), mahal, hospitalFromMahal(mahal), active]);
  if (!r.rowCount) return res.status(404).json({ error: 'Sandalye bulunamadı.' });
  await audit(pool, { userId: req.user.uid, action: 'sandalye_guncelle', chairId: req.params.id });
  res.json({ ok: true });
});

// Arızalı / Bakımda yönetimi: { status: 'arizali'|'musait', fault?: {...} }
router.post('/chairs/:id/status', supervisorUp, async (req, res) => {
  const id = normalizeChairId(req.params.id);
  const status = req.body?.status;
  if (!['arizali', 'musait'].includes(status)) return res.status(400).json({ error: 'Statü yalnızca Arızalı veya Müsait yapılabilir.' });
  const fault = req.body?.fault ? parseFault(req.body.fault) : { has: false };
  if (fault.error) return res.status(400).json({ error: fault.error });
  try {
    await tx(async (db) => {
      const { rows } = await db.query('SELECT status FROM chairs WHERE id_no=$1 FOR UPDATE', [id]);
      if (!rows[0]) throw httpErr(404, 'Sandalye bulunamadı.');
      if (['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(rows[0].status)) {
        throw httpErr(409, 'Sandalyenin açık bir ödünç kaydı var. Önce Hareketler bölümünden kapatın.');
      }
      if (fault.has) {
        await db.query("INSERT INTO fault_reports (chair_id, stage, parts, note) VALUES ($1,'admin',$2,$3)", [id, fault.parts, fault.note]);
      }
      if (status === 'musait') {
        await db.query('UPDATE fault_reports SET resolved_at=now(), resolved_by=$2 WHERE chair_id=$1 AND resolved_at IS NULL', [id, req.user.uid]);
      }
      await db.query('UPDATE chairs SET status=$2, updated_at=now() WHERE id_no=$1', [id, status]);
      await audit(db, { userId: req.user.uid, action: status === 'arizali' ? 'bakima_al' : 'bakimdan_cikar', chairId: id });
    });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

/* ---------------- Excel yükleme ---------------- */
const COL_ID = 'ID No';
const COL_MAHAL = 'Tanımlı Mahal';

router.get('/chairs/template', adminOnly, (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    [COL_ID, COL_MAHAL],
    ['TS-0001', 'Kalp Damar Hastanesi - Ana Giriş Danışma'],
    ['TS-0002', 'Genel Hastane - Acil Giriş'],
    ['TS-0003', 'Onkoloji Hastanesi - Poliklinik Bekleme'],
  ]);
  ws['!cols'] = [{ wch: 12 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sandalyeler');
  sendWorkbook(res, wb, 'sandalye-yukleme-sablonu.xlsx');
});

// ?dryRun=1 önizleme; mode=upsert (ekle+güncelle) | insert (yalnızca yeni ekle)
router.post('/chairs/import', adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya seçin.' });
  if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Yalnızca .xlsx, .xls veya .csv yükleyin.' });
  const dryRun = req.query.dryRun === '1';
  const mode = req.query.mode === 'insert' ? 'insert' : 'upsert';

  let raw;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', codepage: 65001, raw: false });
    raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: true });
  } catch {
    return res.status(400).json({ error: 'Dosya okunamadı. Şablonu kullanarak tekrar deneyin.' });
  }
  const header = (raw[0] || []).map((h) => String(h).trim());
  const iId = header.indexOf(COL_ID);
  const iMahal = header.indexOf(COL_MAHAL);
  if (iId < 0 || iMahal < 0) {
    return res.status(400).json({ error: `Sütun başlıkları birebir "${COL_ID}" ve "${COL_MAHAL}" olmalı. Bulunan: ${header.join(', ') || '(boş)'}` });
  }

  const warnings = [];
  const seen = new Map();
  for (let r = 1; r < raw.length; r++) {
    const rowNo = r + 1;
    const id = normalizeChairId(raw[r][iId]);
    const mahal = clean(raw[r][iMahal], 200);
    if (!id && !mahal) { if (r < raw.length - 1) warnings.push({ row: rowNo, message: 'Boş satır atlandı.' }); continue; }
    if (!id) { warnings.push({ row: rowNo, message: 'ID No boş, satır atlandı.' }); continue; }
    if (!mahal) { warnings.push({ row: rowNo, id, message: 'Tanımlı Mahal boş, satır atlandı.' }); continue; }
    if (id.length > 40) { warnings.push({ row: rowNo, id, message: 'ID No 40 karakterden uzun, atlandı.' }); continue; }
    if (seen.has(id)) warnings.push({ row: rowNo, id, message: `Dosyada tekrar eden ID (satır ${seen.get(id).row}); son satır geçerli.` });
    seen.set(id, { row: rowNo, id, mahal, hospital: hospitalFromMahal(mahal) });
  }
  const items = [...seen.values()];
  const unknownHospital = items.filter((i) => !HOSPITALS.includes(i.hospital));
  unknownHospital.slice(0, 50).forEach((i) =>
    warnings.push({ row: i.row, id: i.id, message: `Hastane adı tanınmadı ("${i.hospital}"). Mahal "Hastane Adı - Yer" biçiminde olmalı.` }));

  const existing = new Set(
    (await pool.query('SELECT id_no FROM chairs WHERE id_no = ANY($1)', [items.map((i) => i.id)])).rows.map((r) => r.id_no)
  );
  const toInsert = items.filter((i) => !existing.has(i.id));
  const toUpdate = mode === 'upsert' ? items.filter((i) => existing.has(i.id)) : [];
  const skipped = mode === 'insert' ? items.filter((i) => existing.has(i.id)).length : 0;
  const summary = { totalRows: raw.length - 1, valid: items.length, insert: toInsert.length, update: toUpdate.length, skippedExisting: skipped, warnings };

  if (dryRun) return res.json({ dryRun: true, ...summary, preview: items.slice(0, 10) });

  await tx(async (db) => {
    for (const i of toInsert) {
      await db.query('INSERT INTO chairs (id_no, mahal, hospital) VALUES ($1,$2,$3)', [i.id, i.mahal, i.hospital]);
    }
    for (const i of toUpdate) {
      await db.query('UPDATE chairs SET mahal=$2, hospital=$3, active=true, updated_at=now() WHERE id_no=$1', [i.id, i.mahal, i.hospital]);
    }
    await audit(db, { userId: req.user.uid, action: 'excel_yukleme', detail: { file: req.file.originalname, insert: toInsert.length, update: toUpdate.length } });
  });
  res.json({ dryRun: false, ...summary });
});

/* ---------------- QR etiketleri ---------------- */
router.get('/labels', supervisorUp, async (req, res) => {
  const params = [];
  const where = ['active'];
  if (req.query.hospital) { params.push(req.query.hospital); where.push(`hospital=$${params.length}`); }
  if (req.query.ids) {
    params.push(String(req.query.ids).split(/[,\s]+/).filter(Boolean).map(normalizeChairId));
    where.push(`id_no = ANY($${params.length})`);
  }
  const { rows } = await pool.query(`SELECT id_no, mahal, hospital FROM chairs WHERE ${where.join(' AND ')} ORDER BY id_no LIMIT 2000`, params);
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const out = [];
  for (const c of rows) {
    const url = `${base}/s?id=${encodeURIComponent(c.id_no)}`;
    out.push({ idNo: c.id_no, mahal: c.mahal, hospital: c.hospital, url,
      svg: await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }) });
  }
  res.json(out);
});

/* ---------------- Hareketler & arızalar ---------------- */
router.get('/movements', supervisorUp, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.ref_code, l.chair_id, l.status, l.full_name, l.phone_masked, l.from_hospital, l.from_department,
            l.requested_at, l.approved_at, l.return_requested_at, c.mahal, c.hospital, u.full_name AS approved_by_name
       FROM loans l JOIN chairs c ON c.id_no=l.chair_id LEFT JOIN users u ON u.id=l.approved_by
      WHERE l.status IN ('onay_bekliyor','kullanimda','iade_bekliyor')
      ORDER BY l.requested_at`
  );
  res.json(rows);
});

// Manuel müdahale: açık kaydı iptal et ve sandalyeyi istenen statüye al
router.post('/movements/:id/cancel', adminOnly, async (req, res) => {
  const chairStatus = req.body?.chairStatus === 'arizali' ? 'arizali' : 'musait';
  const note = clean(req.body?.note, 300) || 'Admin tarafından iptal edildi';
  try {
    await tx(async (db) => {
      const { rows } = await db.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [req.params.id]);
      const l = rows[0];
      if (!l) throw httpErr(404, 'Kayıt bulunamadı.');
      if (!['onay_bekliyor', 'kullanimda', 'iade_bekliyor'].includes(l.status)) throw httpErr(409, 'Kayıt zaten kapalı.');
      await db.query("UPDATE loans SET status='iptal', closed_note=$2 WHERE id=$1", [l.id, note]);
      await db.query('UPDATE chairs SET status=$2, updated_at=now() WHERE id_no=$1', [l.chair_id, chairStatus]);
      await audit(db, { userId: req.user.uid, action: 'admin_iptal', chairId: l.chair_id, loanId: l.id, detail: { note, chairStatus } });
    });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

router.get('/faults', supervisorUp, async (req, res) => {
  const open = req.query.open !== '0';
  const { rows } = await pool.query(
    `SELECT f.*, c.mahal, c.hospital, c.status AS chair_status FROM fault_reports f JOIN chairs c ON c.id_no=f.chair_id
      ${open ? 'WHERE f.resolved_at IS NULL' : ''} ORDER BY f.created_at DESC LIMIT 500`
  );
  res.json(rows);
});

router.post('/faults/:id/resolve', supervisorUp, async (req, res) => {
  await pool.query('UPDATE fault_reports SET resolved_at=now(), resolved_by=$2 WHERE id=$1 AND resolved_at IS NULL', [req.params.id, req.user.uid]);
  await audit(pool, { userId: req.user.uid, action: 'ariza_kapat', detail: { faultId: req.params.id } });
  res.json({ ok: true });
});

/* ---------------- Raporlar ---------------- */
router.get('/reports/:key', supervisorUp, async (req, res) => {
  const fn = REPORTS[req.params.key];
  if (!fn) return res.status(404).json({ error: 'Rapor bulunamadı.' });
  const rep = await fn(req.query);
  if (!req.query.format) return res.json(rep);

  const aoa = [rep.columns.map((c) => c.label), ...rep.rows.map((r) => rep.columns.map((c) => r[c.key] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `etlik-sh-${req.params.key}-${stamp}`;
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send('﻿' + XLSX.utils.sheet_to_csv(ws, { FS: ';' }));
  }
  ws['!cols'] = rep.columns.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rapor');
  sendWorkbook(res, wb, `${name}.xlsx`);
});

function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

module.exports = { router, CHAIR_STATUS };
