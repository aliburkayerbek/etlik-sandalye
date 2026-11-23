const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ---- Kişisel veri şifreleme (AES-256-GCM) ----
function key() {
  const hex = process.env.DATA_ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('DATA_ENCRYPTION_KEY 64 karakter hex olmalı (node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(token) {
  const [iv, tag, enc] = token.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---- Doğrulama ----
function isValidTc(tc) {
  if (!/^[1-9][0-9]{10}$/.test(tc)) return false;
  const d = tc.split('').map(Number);
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return (d10 + 10) % 10 === d[9] && d11 === d[10];
}

function normalizePhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.startsWith('90') && s.length === 12) s = s.slice(2);
  if (s.startsWith('0') && s.length === 11) s = s.slice(1);
  return /^5[0-9]{9}$/.test(s) ? s : null;
}

const maskTc = (tc) => `${tc.slice(0, 3)}******${tc.slice(-2)}`;
const maskPhone = (p) => `0${p.slice(0, 3)} *** ** ${p.slice(-2)}`;

function refCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += alphabet[b % alphabet.length];
  return s;
}

// ---- Oturum (JWT, httpOnly çerez) ----
const COOKIE = 'ets_session';

function signSession(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, scope: user.hospital_scope || null, name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function readSession(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t) return null;
  try {
    return jwt.verify(t, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });
    if (roles.length && !roles.includes(s.role)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
    req.user = s;
    next();
  };
}

module.exports = {
  encrypt, decrypt, isValidTc, normalizePhone, maskTc, maskPhone, refCode,
  COOKIE, signSession, readSession, requireRole,
};
