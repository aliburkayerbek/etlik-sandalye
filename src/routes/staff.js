// Personel / süpervizör tarafı: giriş, onay kuyruğu, teslim ve iade onayları.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool, tx, audit } = require('../db');
const { COOKIE, signSession, requireRole } = require('../security');
const { parseFault, clean } = require('../util');
const { httpErr, sendErr } = require('./public');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Çok fazla hatalı giriş. 15 dakika sonra deneyin.' } });

router.post('/auth/login', loginLimiter, async (req, res) => {
  const username = clean(req.body?.username, 60).toLowerCase();
  const password = String(req.body?.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const u = rows[0];
  if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  res.cookie(COOKIE, signSession(u), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 * 1000,
  });
  await audit(pool, { userId: u.id, action: 'giris' });
  res.json({ ok: true, role: u.role, name: u.full_name });
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/auth/me', requireRole(), (req, res) => {
  res.json({ id: req.user.uid, role: req.user.role, name: req.user.name, scope: req.user.scope });
});

const staffOnly = requireRole('staff', 'supervisor', 'admin');

// Kullanıcının hastane kapsamına göre filtre
function scopeFilter(user, params, alias = 'c') {
  if (!user.scope) return '';
  params.push(user.scope);
  return ` AND ${alias}.hospital = $${params.length}`;
}

router.get('/staff/queue', staffOnly, async (req, res) => {
  const params = [];
  const scope = scopeFilter(req.user, params);
  const { rows } = await pool.query(
    `SELECT l.id, l.ref_code, l.chair_id, l.status, l.full_name, l.tc_masked, l.phone_masked,
            l.from_hospital, l.from_department, l.borrow_condition_ok, l.return_condition_ok, l.return_note,
            l.requested_at, l.return_requested_at, c.mahal, c.hospital,
            (SELECT json_agg(json_build_object('stage', f.stage, 'parts', f.parts, 'note', f.note) ORDER BY f.id)
               FROM fault_reports f WHERE f.loan_id = l.id) AS faults
       FROM loans l JOIN chairs c ON c.id_no = l.chair_id
      WHERE l.status IN ('onay_bekliyor','iade_bekliyor') ${scope}
      ORDER BY COALESCE(l.return_requested_at, l.requested_at)`,
    params
  );
  res.json(rows);
});

router.get('/staff/active', staffOnly, async (req, res) => {
  const params = [];
  const scope = scopeFilter(req.user, params);
  const { rows } = await pool.query(
    `SELECT l.id, l.ref_code, l.chair_id, l.full_name, l.phone_masked, l.from_hospital, l.from_department,
            l.approved_at, c.mahal, c.hospital
       FROM loans l JOIN chairs c ON c.id_no = l.chair_id
      WHERE l.status = 'kullanimda' ${scope} ORDER BY l.approved_at`,
    params
  );
  res.json(rows);
});

// Kampüs / hastane bazlı doluluk özeti (infografik kartlar için)
router.get('/staff/summary', staffOnly, async (req, res) => {
  const params = [];
  const scope = scopeFilter(req.user, params);
  const { rows } = await pool.query(
    `SELECT c.hospital, c.status, count(*)::int AS n FROM chairs c WHERE c.active ${scope} GROUP BY 1,2`, params
  );
  res.json(rows);
});

async function loadLoanForUpdate(db, id, user) {
  const { rows } = await db.query(
    `SELECT l.*, c.hospital FROM loans l JOIN chairs c ON c.id_no=l.chair_id WHERE l.id=$1 FOR UPDATE OF l, c`, [id]
  );
  const l = rows[0];
  if (!l) throw httpErr(404, 'Kayıt bulunamadı.');
  if (user.scope && user.scope !== l.hospital) throw httpErr(403, 'Bu hastane için yetkiniz yok.');
  return l;
}

// "Onayla ve Teslim Et"
router.post('/staff/loans/:id/approve', staffOnly, async (req, res) => {
  try {
    await tx(async (db) => {
      const l = await loadLoanForUpdate(db, req.params.id, req.user);
      if (l.status !== 'onay_bekliyor') throw httpErr(409, 'Bu talep artık onay beklemiyor.');
      await db.query("UPDATE loans SET status='kullanimda', approved_by=$2, approved_at=now() WHERE id=$1", [l.id, req.user.uid]);
      await db.query("UPDATE chairs SET status='kullanimda', updated_at=now() WHERE id_no=$1", [l.chair_id]);
      await audit(db, { userId: req.user.uid, action: 'teslim_onay', chairId: l.chair_id, loanId: l.id });
    });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// Talebi reddet (sandalye verilmedi)
router.post('/staff/loans/:id/reject', staffOnly, async (req, res) => {
  const reason = clean(req.body?.reason, 300) || null;
  const toFaulty = req.body?.markFaulty === true;
  try {
    await tx(async (db) => {
      const l = await loadLoanForUpdate(db, req.params.id, req.user);
      if (l.status !== 'onay_bekliyor') throw httpErr(409, 'Bu talep artık onay beklemiyor.');
      await db.query("UPDATE loans SET status='reddedildi', approved_by=$2, approved_at=now(), closed_note=$3 WHERE id=$1",
        [l.id, req.user.uid, reason]);
      await db.query('UPDATE chairs SET status=$2, updated_at=now() WHERE id_no=$1', [l.chair_id, toFaulty ? 'arizali' : 'musait']);
      await audit(db, { userId: req.user.uid, action: 'talep_red', chairId: l.chair_id, loanId: l.id, detail: { reason, toFaulty } });
    });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

// "İadeyi Onayla (Teslim Al)"  body: { fault?: {has, parts, note}, markFaulty?: bool }
router.post('/staff/loans/:id/approve-return', staffOnly, async (req, res) => {
  const staffFault = req.body?.fault ? parseFault(req.body.fault) : { has: false };
  if (staffFault.error) return res.status(400).json({ error: staffFault.error });
  try {
    const newStatus = await tx(async (db) => {
      const l = await loadLoanForUpdate(db, req.params.id, req.user);
      if (l.status !== 'iade_bekliyor') throw httpErr(409, 'Bu kayıt iade beklemiyor.');
      if (staffFault.has) {
        await db.query("INSERT INTO fault_reports (chair_id, loan_id, stage, parts, note) VALUES ($1,$2,'personel',$3,$4)",
          [l.chair_id, l.id, staffFault.parts, staffFault.note]);
      }
      // Hasta ya da personel arıza bildirdiyse veya personel açıkça işaretlediyse "Arızalı / Kontrol Gerekli"
      const anyFault = staffFault.has || l.return_condition_ok === false || req.body?.markFaulty === true;
      const status = anyFault && req.body?.markFaulty !== false ? 'arizali' : 'musait';
      await db.query("UPDATE loans SET status='tamamlandi', return_approved_by=$2, return_approved_at=now() WHERE id=$1", [l.id, req.user.uid]);
      await db.query('UPDATE chairs SET status=$2, updated_at=now() WHERE id_no=$1', [l.chair_id, status]);
      await audit(db, { userId: req.user.uid, action: 'iade_onay', chairId: l.chair_id, loanId: l.id, detail: { status } });
      return status;
    });
    res.json({ ok: true, chairStatus: newStatus });
  } catch (e) { sendErr(res, e); }
});

// Personel, sandalye hasta elindeyken iade QR'ı okutulmadan teslim alırsa (ör. hasta ayrıldı)
router.post('/staff/loans/:id/force-return', staffOnly, async (req, res) => {
  try {
    await tx(async (db) => {
      const l = await loadLoanForUpdate(db, req.params.id, req.user);
      if (l.status !== 'kullanimda') throw httpErr(409, 'Kayıt kullanımda değil.');
      await db.query(`UPDATE loans SET status='tamamlandi', return_requested_at=now(), return_condition_ok=true,
        return_approved_by=$2, return_approved_at=now(), closed_note='Personel tarafından doğrudan teslim alındı' WHERE id=$1`,
        [l.id, req.user.uid]);
      await db.query("UPDATE chairs SET status='musait', updated_at=now() WHERE id_no=$1", [l.chair_id]);
      await audit(db, { userId: req.user.uid, action: 'iade_onay', chairId: l.chair_id, loanId: l.id, detail: { forced: true } });
    });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e); }
});

module.exports = { router, scopeFilter };
