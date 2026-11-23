# Etlik Şehir Hastanesi: Tekerlekli Sandalye Emanet Sistemi (MVP)

Kampüsteki yaklaşık 1.270 tekerlekli sandalye için QR ile ödünç verme, iade, arıza kontrolü, zorunlu KVKK onayı, personel onay akışı ve raporlama.

```
 ┌──────────┐   ┌────────────────────────┐   ┌──────────────────┐   ┌─────────────┐
 │ 1. QR    │ → │ 2. Fiziki kontrol      │ → │ 3. Personel      │ → │ 4. İşlem    │
 │   Okut   │   │    + Form + KVKK onayı │   │    onaylasın     │   │    Tamam    │
 └──────────┘   └────────────────────────┘   └──────────────────┘   └─────────────┘
```

---

## 1. Mimari

```
 Hasta / refakatçi telefonu           Personel / süpervizör / admin (tablet, PC)
   │  QR → https://<alan-adı>/s?id=TS-0001      │  /giris → /personel, /admin, /etiket
   └──────────────────────┬─────────────────────┘
                          ▼
            Node.js 22 + Express (tek servis)
            • public/ : sade HTML + CSS + JS (derleme yok)
            • /api    : REST uçları, JWT (httpOnly çerez) ile oturum
            • Helmet (CSP), hız sınırlama, T.C./telefon AES-256-GCM şifreleme
                          ▼
                    PostgreSQL 16
     chairs · loans · fault_reports · users · audit_log
```

**Neden bu seçimler?**

| Karar | Gerekçe |
|---|---|
| **Node.js + Express**, framework'süz HTML/JS | Tek dil, tek servis, derleme adımı yok. Hastane BT ekibi kolay devralır; bir dosyayı düzenleyip yeniden başlatmak yeterli. |
| **PostgreSQL** | Aynı anda iki kişinin aynı sandalyeyi alamaması için satır kilidi (`SELECT … FOR UPDATE`) ve transaction gerekir. Raporlar (saat aralığı, parça bazlı arıza) SQL ile kolay. Ücretsiz bulut seçenekleri (Neon, Supabase) ve hastanede kurulabilir sürümü var. |
| **QR = URL** (`/s?id=TS-0001`) | Hasta uygulama indirmez; telefon kamerası yeter. Uygulama içi tarayıcı da (html5-qrcode) var. |
| **T.C. ve telefon şifreli + maskeli** | KVKK m.12 veri güvenliği. Personel ekranı `100******46` gösterir; veritabanı sızsa bile numaralar açık değildir. |
| **KVKK sürümü + zaman damgası + IP** | Her kayıtta hangi metnin ne zaman onaylandığı ispatlanabilir. |

**Statü makinesi**

```
 musait ──(hasta form)──▶ onay_bekliyor ──(Onayla ve Teslim Et)──▶ kullanimda
   ▲                          │ (Reddet)                                │ (hasta iade formu)
   │◀─────────────────────────┘                                         ▼
   │◀──────────(İadeyi Onayla, arıza yok)──────────────────────── iade_bekliyor
 arizali ◀──(İadeyi Onayla, arıza var / bakıma al)──────────────────────┘
   └──(Bakımdan çıkar)──▶ musait
```

**Roller:** `staff` (personel) ve `supervisor` onay verir; `hospital_scope` doluysa yalnızca o hastanenin sandalyelerini görür. `admin` her şeyi yönetir (kullanıcı, Excel, etiket, manuel müdahale).

## 2. Dosya yapısı

```
etlik-sandalye/
├── server.js                  # Uygulama girişi, güvenlik başlıkları, ilk admin
├── src/
│   ├── schema.sql             # Tablolar (her açılışta otomatik uygulanır)
│   ├── config.js              # Hastane listesi, arıza parçaları, KVKK sürümü
│   ├── db.js                  # PostgreSQL bağlantısı, transaction, audit log
│   ├── security.js            # Şifreleme, T.C. doğrulama, maskeleme, oturum
│   ├── util.js                # Mahalden hastane çıkarımı, arıza doğrulama
│   ├── reports.js             # Tüm rapor sorguları
│   └── routes/
│       ├── public.js          # QR, ödünç talebi, iade talebi (oturumsuz)
│       ├── staff.js           # Giriş, onay kuyruğu, teslim/iade onayı
│       └── admin.js           # Kullanıcı, Excel, QR etiket, arıza, rapor, dışa aktarma
├── public/
│   ├── index.html             # Ana sayfa + QR tarayıcı
│   ├── sandalye.html          # QR sonrası form (ödünç / iade)
│   ├── kvkk-metni.html        # KVKK Aydınlatma Metni
│   ├── giris.html, personel.html, admin.html, etiket.html
│   ├── css/  js/  img/
├── scripts/
│   ├── seed.js                # Önizleme için 1.270 demo sandalye + 2 kullanıcı
│   └── smoke-test.js          # Uçtan uca test (npm test)
├── .github/workflows/ci.yml   # Her push'ta testleri çalıştırır
├── render.yaml                # Render önizleme ortamı tanımı
└── .env.example
```

## 3. Yerelde çalıştırma (10 dakika)

1. **Node.js 22** ve **PostgreSQL 16** kurun (veya Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sandalye postgres:16`).
2. `cp .env.example .env` yapın ve doldurun (yerelde `DATABASE_SSL=false`). Anahtarları üretmek için:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # DATA_ENCRYPTION_KEY
   ```
3. ```bash
   npm install
   npm test          # uçtan uca test, "Tüm testler geçti" görmelisiniz
   npm run seed      # isteğe bağlı: demo veri
   npm run dev
   ```
4. `http://localhost:3000` → ana sayfa, `/s?id=TS-0001` → QR ekranı, `/giris` → admin.

> Telefon kamerası yalnızca **HTTPS** veya `localhost` üzerinde açılır. Telefonla test için aşağıdaki önizleme ortamını kullanın.

## 4. GitHub'a yükleme

1. github.com → **New repository** → ad: `etlik-sandalye-takip`, **Private** seçin (README eklemeyin).
2. Proje klasöründe:
   ```bash
   git init
   git add .
   git commit -m "MVP: QR emanet, arıza kontrolü, KVKK onayı, raporlar"
   git branch -M main
   git remote add origin https://github.com/<KULLANICI_ADINIZ>/etlik-sandalye-takip.git
   git push -u origin main
   ```
3. `.env` dosyası `.gitignore` içinde, GitHub'a **gitmez**. Gizli değerler yalnızca hosting panelinde tutulur.
4. **Actions** sekmesinde CI otomatik çalışır; yeşil tik her push'ta testlerin geçtiğini gösterir.
5. Önerilen akış: `main` = önizleme ortamı. Yeni özellikler için ayrı dal açıp Pull Request ile birleştirin.

## 5. Ücretsiz önizleme ortamı (Render + Neon)

| Bileşen | Servis | Ücret |
|---|---|---|
| Uygulama | Render Web Service (Free) | 0 TL; 15 dk işlem olmazsa uyur, ilk istek ~30-50 sn sürer |
| Veritabanı | Neon PostgreSQL (Free) | 0 TL; 0,5 GB yeter (1.270 sandalye + on binlerce hareket) |

**Adımlar**

1. **Neon:** neon.tech → GitHub ile giriş → *Create project* → bölge: **Frankfurt (eu-central-1)** → *Connection string*'i kopyalayın (`postgresql://…?sslmode=require`).
2. **Render:** render.com → GitHub ile giriş → **New → Blueprint** → reponuzu seçin. `render.yaml` okunur.
3. İstenen ortam değişkenlerini girin:
   - `DATABASE_URL` = Neon adresi
   - `DATA_ENCRYPTION_KEY` = 64 hex (üretin ve **parola yöneticisinde saklayın**)
   - `ADMIN_PASSWORD` = güçlü bir şifre
   - `PUBLIC_BASE_URL` = `https://<servis-adı>.onrender.com` (ilk deploy sonrası adres belli olunca girin)
4. **Apply** → birkaç dakika sonra `https://<servis-adı>.onrender.com/healthz` → `ok`.
5. `/giris` → `admin` → **Excel Yükle** → şablonu indirip birkaç satırla deneyin → **QR Etiket Yazdır** → telefonla okutun.
6. Her `git push` sonrası Render otomatik yeniden yayınlar.

Alternatifler: Railway (deneme kredisi ile uygulama + PostgreSQL tek yerde), Supabase (veritabanı için Neon yerine).

## 6. ⚠ Canlıya geçmeden önce (önemli)

- **Önizlemede gerçek hasta verisi kullanmayın.** Render ve Neon sunucuları yurt dışındadır (Frankfurt). KVKK m.9'a göre kişisel verinin yurt dışına aktarımı ayrı şartlara tabidir. Önizlemede yalnızca test isimleri ve test T.C. numaraları kullanın.
- **Canlı ortam önerisi:** Hastanenin kendi sunucusu veya Sağlık Bakanlığı / Türkiye'de yerleşik bir bulut sağlayıcı. Uygulama tek bir Node.js servisi + PostgreSQL olduğundan taşıması kolaydır: aynı repo, aynı ortam değişkenleri.
- **KVKK metni** (`public/kvkk-metni.html`): taslaktır. Hastane KVKK birimi / hukuk müşaviri onaylamalı (veri sorumlusu unvanı, saklama süresi, başvuru kanalları). Metni değiştirince `src/config.js` → `KVKK_VERSION` değerini artırın.
- **Hastane listesi** (`src/config.js` → `HOSPITALS`): kampüsteki resmi hastane adlarıyla teyit edin. Excel'deki `Tanımlı Mahal` değerleri **"Hastane Adı - Yer"** biçiminde başlamalı (örn. `Kalp Damar Hastanesi - Ana Giriş Danışma`); hastane bilgisi buradan otomatik çıkarılır.
- **QR etiketlerini** kalıcı alan adı belli olduktan sonra basın (`PUBLIC_BASE_URL`). Alan adı değişirse etiketlerin yeniden basılması gerekir.
- `DATA_ENCRYPTION_KEY` kaybolursa şifreli T.C./telefon verileri okunamaz. Yedekleyin.
- Saklama süresi dolan kayıtların silinmesi/anonimleştirilmesi için zamanlanmış görev (bir sonraki aşama).

## 7. Sonraki aşama önerileri

- Onay bekleyen talep X dakikayı geçerse personele sesli/görsel uyarı
- SMS ile "sandalyeyi iade etmeyi unutmayın" hatırlatması (İYS/KVKK uyumlu)
- Saklama süresi dolan kişisel verilerin otomatik anonimleştirilmesi
- Hastane SSO / Active Directory ile personel girişi
