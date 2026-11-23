// Hasta / refakatçi tarafı: QR okutulduktan sonra çağrılan, oturum gerektirmeyen uçlar.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool, tx, audit } = require('../db');
const { HOSPITALS, FAULT_PARTS, CHAIR_STATUS, KVKK_VERSION, ORG_NAME } = require('../config');
const { encrypt, isValidTc, normalizePhone, maskTc, maskPhone, refCode } = require('../security');
const { normalizeChairId, parseFault, clean } = require('../util');

const router = express.Router();
const writeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' } });

router.get('/meta', (req, res) => {
  res.json({ org: ORG_NAME, hospitals: HOSPITALS, faultParts: FAULT_PARTS, statuses: CHAIR_STATUS, kvkkVersion: KVKK_VERSION });
});

router.get('/chairs/:id', async (req, res) => {
  const id = normalizeChairId(req.params.id);
  const { rows } = await pool.query('SELECT id_no, mahal, hospital, status, active FROM chairs WHERE id_no=$1', [id]);
  const c = rows[0];
  if (!c || !c.active) return res.status(404).json({ error: `${id} numaralı sandalye bulunamadı. Lütfen danışmaya başvurun.` });
  const action = { musait: 'borrow', kullanimda: 'return', onay_bekliyor: 'wait', iade_bekliyor: 'wait', arizali: 'unavailable' }[c.status];
  res.json({ idNo: c.id_no, mahal: c.mahal, hospital: c.hospital, status: c.status, statusLabel: CHAIR_STATUS[c.status], action });
});

// 1) Ödünç alma talebi
router.post('/loans', writeLimiter, async (req, res) => {
  const b = req.body || {};
  const chairId = normalizeChairId(b.chairId);
  const fullName = clean(b.fullName, 100);
  const tc = String(b.tc || '').replace(/\D/g, '');
  const phone = normalizePhone(b.phone);
  const fromHospital = clean(b.fromHospital, 100);
  const fromDepartment = clean(b.fromDepartment, 120);
  const fault = parseFault(b.fault);

  const errors = [];
  if (fullName.split(' ').length < 2) errors.push('Ad ve soyadı birlikte yazın.');
  if (!isValidTc(tc)) errors.push('T.C. Kimlik No geçersiz.');
  if (!phone) errors.push('Telefon numarası 05XX XXX XX XX biçiminde olmalı.');
  if (!HOSPITALS.includes(fromHospital)) errors.push('Geldiğiniz hastaneyi seçin.');
  if (fromDepartment.length < 2) errors.push('Geldiğiniz bölüm / poliklinik / servisi yazın.');
  if (fault.error) errors.push(fault.error);
  if (b.kvkkAccepted !== true || b.kvkkVersion !== KVKK_VERSION) errors.push('KVKK Aydınlatma Metni onayı zorunludur.');
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

  try {
    const result = await tx(async (db) => {
      const { rows } = await db.query('SELECT status, active FROM chairs WHERE id_no=$1 FOR UPDATE', [chairId]);
      if (!rows[0] || !rows[0].active) throw httpErr(404, 'Sandalye bulunamadı.');
      if (rows[0].status !== 'musait') throw httpErr(409, 'Bu sandalye şu anda ödünç verilemez. Lütfen danışmaya başvurun.');

      const ref = refCode();
      const ins = await db.query(
        `INSERT INTO loans (ref_code, chair_id, status, full_name, tc_enc, tc_masked, phone_enc, phone_masked,
           from_hospital, from_department, kvkk_version, kvkk_accepted_at, kvkk_ip, borrow_condition_ok)
         VALUES ($1,$2,'onay_bekliyor',$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12) RETURNING id`,
        [ref, chairId, fullName, encrypt(tc), maskTc(tc), encrypt(phone), maskPhone(phone),
          fromHospital, fromDepartment, KVKK_VERSION, req.ip, !fault.has]
      );
      const loanId = ins.rows[0].id;
      if (fault.has) {
        await db.query('INSERT INTO fault_reports (chair_id, loan_id, stage, parts, note) VALUES ($1,$2,$3,$4,$5)',
          [chairId, loanId, 'teslim_alma', fault.parts, fault.note]);
      }
      await db.query("UPDATE chairs SET status='onay_bekliyor', updated_at=now() WHERE id_no=$1", [chairId]);
      await audit(db, { action: 'odunc_talebi', chairId, loanId, detail: { fault: fault.has ? fault.parts : null } });
      return { ref, loanId };
    });
    res.status(201).json({ ok: true, refCode: result.ref, message: 'Talebiniz alındı. Görevli personel onayladığında sandalye size teslim edilecektir.' });
  } catch (e) {
    sendErr(res, e);
  }
});

// 2) İade talebi (aynı QR tekrar okutulur)
router.post('/returns', writeLimiter, async (req, res) => {
  const b = req.body || {};
  const chairId = normalizeChairId(b.chairId);
  const fault = parseFault(b.fault);
  const note = clean(b.note, 500) || null;
  if (fault.error) return res.status(400).json({ error: fault.error });

  try {
    const result = await tx(async (db) => {
      const { rows } = await db.query('SELECT status FROM chairs WHERE id_no=$1 FOR UPDATE', [chairId]);
      if (!rows[0]) throw httpErr(404, 'Sandalye bulunamadı.');
      if (rows[0].status !== 'kullanimda') throw httpErr(409, 'Bu sandalye için açık bir ödünç kaydı yok.');
      const loan = await db.query("SELECT id, ref_code FROM loans WHERE chair_id=$1 AND status='kullanimda' ORDER BY id DESC LIMIT 1", [chairId]);
      if (!loan.rows[0]) throw httpErr(409, 'Açık ödünç kaydı bulunamadı. Lütfen personele başvurun.');
      const loanId = loan.rows[0].id;

      await db.query(
        `UPDATE loans SET status='iade_bekliyor', return_requested_at=now(), return_condition_ok=$2, return_note=$3 WHERE id=$1`,
        [loanId, !fault.has, note]
      );
      if (fault.has) {
        await db.query('INSERT INTO fault_reports (chair_id, loan_id, stage, parts, note) VALUES ($1,$2,$3,$4,$5)',
          [chairId, loanId, 'iade', fault.parts, fault.note]);
      }
      await db.query("UPDATE chairs SET status='iade_bekliyor', updated_at=now() WHERE id_no=$1", [chairId]);
      await audit(db, { action: 'iade_talebi', chairId, loanId, detail: { fault: fault.has ? fault.parts : null } });
      return loan.rows[0].ref_code;
    });
    res.status(201).json({ ok: true, refCode: result, message: 'İade talebiniz düştü. Lütfen sandalyeyi görevli personele teslim edin.' });
  } catch (e) {
    sendErr(res, e);
  }
});

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function sendErr(res, e) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
}

module.exports = { router, httpErr, sendErr };
