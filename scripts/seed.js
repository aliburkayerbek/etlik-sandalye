// Önizleme ortamı için DEMO veri: 1.270 sandalye + 1 süpervizör + 1 personel.
// Gerçek envanteri admin panelinden Excel ile yükleyin; bu betiği canlı veritabanında çalıştırmayın.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { pool, migrate } = require('../src/db');
const { HOSPITALS } = require('../src/config');
const { hospitalFromMahal } = require('../src/util');

const SPOTS = ['Ana Giriş Danışma', 'Acil Giriş', 'Poliklinik Bekleme', 'Otopark Girişi', 'Asansör Holü', 'Kan Alma'];

(async () => {
  await migrate();
  const total = 1270;
  for (let i = 1; i <= total; i++) {
    const h = HOSPITALS[i % HOSPITALS.length];
    const mahal = `${h} - ${SPOTS[i % SPOTS.length]}`;
    const id = 'TS-' + String(i).padStart(4, '0');
    await pool.query('INSERT INTO chairs (id_no, mahal, hospital) VALUES ($1,$2,$3) ON CONFLICT (id_no) DO NOTHING',
      [id, mahal, hospitalFromMahal(mahal)]);
  }
  const pw = await bcrypt.hash('Demo12345', 10);
  await pool.query(`INSERT INTO users (username, full_name, password_hash, role, hospital_scope, shift) VALUES
    ('supervizor1','Demo Süpervizör',$1,'supervisor',NULL,'Gündüz'),
    ('kalp.personel','Demo Personel (Kalp Damar)',$1,'staff','Kalp Damar Hastanesi','Gündüz')
    ON CONFLICT (username) DO NOTHING`, [pw]);
  console.log(`Demo veri hazır: ${total} sandalye. Kullanıcılar: supervizor1 / kalp.personel (şifre: Demo12345)`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
