-- Etlik Şehir Hastanesi - Tekerlekli Sandalye Takip Sistemi
-- Uygulama her açılışta bu dosyayı çalıştırır; tüm komutlar tekrar çalıştırılabilir (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','supervisor','staff')),
  hospital_scope TEXT,             -- NULL = tüm kampüs
  shift         TEXT,              -- Gündüz / Akşam / Gece (bilgi amaçlı)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sandalye statüleri:
--  musait         : Müsait / Boşta
--  onay_bekliyor  : Ödünç talebi personel onayı bekliyor
--  kullanimda     : Kullanımda / Teslim Edildi
--  iade_bekliyor  : İade talebi düştü, personel teslim alacak
--  arizali        : Arızalı / Bakımda
CREATE TABLE IF NOT EXISTS chairs (
  id_no      TEXT PRIMARY KEY,
  mahal      TEXT NOT NULL,
  hospital   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'musait'
             CHECK (status IN ('musait','onay_bekliyor','kullanimda','iade_bekliyor','arizali')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chairs_hospital_idx ON chairs(hospital);
CREATE INDEX IF NOT EXISTS chairs_status_idx ON chairs(status);

CREATE TABLE IF NOT EXISTS loans (
  id                 SERIAL PRIMARY KEY,
  ref_code           TEXT UNIQUE NOT NULL,
  chair_id           TEXT NOT NULL REFERENCES chairs(id_no) ON UPDATE CASCADE,
  status             TEXT NOT NULL
                     CHECK (status IN ('onay_bekliyor','kullanimda','iade_bekliyor','tamamlandi','reddedildi','iptal')),
  -- Kişisel veriler: T.C. ve telefon AES-256-GCM ile şifreli, ekranda maskeli
  full_name          TEXT NOT NULL,
  tc_enc             TEXT NOT NULL,
  tc_masked          TEXT NOT NULL,
  phone_enc          TEXT NOT NULL,
  phone_masked       TEXT NOT NULL,
  from_hospital      TEXT NOT NULL,
  from_department    TEXT NOT NULL,
  -- KVKK
  kvkk_version       TEXT NOT NULL,
  kvkk_accepted_at   TIMESTAMPTZ NOT NULL,
  kvkk_ip            TEXT,
  -- Fiziki durum
  borrow_condition_ok BOOLEAN NOT NULL,
  return_condition_ok BOOLEAN,
  return_note        TEXT,
  -- Zaman ve onay akışı
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        INTEGER REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  return_requested_at TIMESTAMPTZ,
  return_approved_by INTEGER REFERENCES users(id),
  return_approved_at TIMESTAMPTZ,
  closed_note        TEXT
);
CREATE INDEX IF NOT EXISTS loans_chair_idx ON loans(chair_id);
CREATE INDEX IF NOT EXISTS loans_status_idx ON loans(status);
CREATE INDEX IF NOT EXISTS loans_approved_at_idx ON loans(approved_at);
CREATE INDEX IF NOT EXISTS loans_return_approved_at_idx ON loans(return_approved_at);

CREATE TABLE IF NOT EXISTS fault_reports (
  id          SERIAL PRIMARY KEY,
  chair_id    TEXT NOT NULL REFERENCES chairs(id_no) ON UPDATE CASCADE,
  loan_id     INTEGER REFERENCES loans(id),
  stage       TEXT NOT NULL CHECK (stage IN ('teslim_alma','iade','personel','admin')),
  parts       TEXT[] NOT NULL DEFAULT '{}',   -- tekerlek, sirtlik, koltuk, tutamac, diger
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS faults_chair_idx ON fault_reports(chair_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  chair_id   TEXT,
  loan_id    INTEGER,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at);
