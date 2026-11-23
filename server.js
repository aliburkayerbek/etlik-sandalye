require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool, migrate } = require('./src/db');
const publicApi = require('./src/routes/public');
const staffApi = require('./src/routes/staff');
const adminApi = require('./src/routes/admin');

for (const k of ['DATABASE_URL', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY']) {
  if (!process.env[k]) { console.error(`Eksik ortam değişkeni: ${k} (.env.example dosyasına bakın)`); process.exit(1); }
}

const app = express();
app.set('trust proxy', 1); // Render / Railway gibi proxy arkasında doğru IP için
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"], // html5-qrcode kendi stilini satır içi ekliyor
      scriptSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Kısa QR adresi: /s?id=TS-0001
app.get('/s', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sandalye.html')));
app.get('/vendor/html5-qrcode.min.js', (req, res) => res.sendFile(require.resolve('html5-qrcode/html5-qrcode.min.js')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', publicApi.router);
app.use('/api', staffApi.router);
app.use('/api/admin', adminApi.router);
app.get('/healthz', async (req, res) => { await pool.query('SELECT 1'); res.send('ok'); });

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
});

async function ensureAdmin() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin'");
  if (rows[0].n > 0) return;
  const u = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const p = process.env.ADMIN_PASSWORD;
  if (!p || p.length < 8) { console.warn('Admin yok: ADMIN_PASSWORD (en az 8 karakter) tanımlayıp yeniden başlatın.'); return; }
  await pool.query("INSERT INTO users (username, full_name, password_hash, role) VALUES ($1,'Sistem Yöneticisi',$2,'admin')",
    [u, await bcrypt.hash(p, 10)]);
  console.log(`İlk admin oluşturuldu: ${u}`);
}

const port = process.env.PORT || 3000;
migrate()
  .then(ensureAdmin)
  .then(() => app.listen(port, () => console.log(`Etlik Şehir Hastanesi Sandalye Takip: http://localhost:${port}`)))
  .catch((e) => { console.error('Başlatma hatası:', e); process.exit(1); });

module.exports = app;
