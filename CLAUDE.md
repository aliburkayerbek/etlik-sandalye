# Etlik Şehir Hastanesi: Tekerlekli Sandalye Emanet Sistemi

QR ile tekerlekli sandalye ödünç/iade, arıza kontrolü, zorunlu KVKK onayı, personel onay akışı ve raporlama. Yaklaşık 1.270 sandalye, Etlik Şehir Hastanesi kampüsü. Arayüz dili Türkçe; kullanıcıya görünen tüm metinler Türkçe kalmalı.

## Komutlar
- `npm install`: bağımlılıklar (`xlsx` SheetJS CDN'den iner; internet gerekir)
- `npm run dev`: http://localhost:3000 (`.env` gerekir, bkz. `.env.example`)
- `npm test`: uçtan uca duman testi (`scripts/smoke-test.js`); her değişiklikten sonra çalıştır
- `npm run seed`: 1.270 demo sandalye + demo kullanıcılar (yalnızca yerel/önizleme)
- `npm run build:demo`: `demo/etlik-demo.html` tek dosyalık tarayıcı demosunu yeniden üretir

## Mimari
- `server.js`: Express girişi, Helmet CSP (satır içi script YOK; JS `public/js/` altında), ilk admin oluşturma
- `src/schema.sql`: her açılışta uygulanır, idempotent olmalı (`IF NOT EXISTS`). Kolon eklerken `ALTER TABLE … ADD COLUMN IF NOT EXISTS` kullan
- `src/routes/public.js`: oturumsuz hasta uçları (QR, ödünç, iade); `staff.js`: giriş + onaylar; `admin.js`: yönetim, Excel, etiket, raporlar
- `src/reports.js`: raporlar `{title, columns, rows}` döner; aynı çıktı ekran + Excel/CSV için kullanılır
- `public/`: framework'süz HTML/CSS/JS. Ortak yardımcılar `public/js/common.js` (`api`, `$`, `esc`, `renderSteps`, `badge`)

## Kurallar
- Sandalye statüleri: `musait → onay_bekliyor → kullanimda → iade_bekliyor → musait | arizali`. Statü değiştiren her işlem `tx()` içinde ve `SELECT … FOR UPDATE` ile yapılmalı
- Statü değiştiren her işlem `audit()` ile kaydedilir
- T.C. ve telefon yalnızca `encrypt()` ile saklanır, ekranda maskeli (`tc_masked`, `phone_masked`) gösterilir. Açık T.C. hiçbir API yanıtına, loga veya dışa aktarmaya girmez
- KVKK metni (`public/kvkk-metni.html`) değişirse `src/config.js` → `KVKK_VERSION` artırılır
- Excel sütun başlıkları birebir `ID No` ve `Tanımlı Mahal`. Hastane, mahalin başındaki hastane adından çıkarılır (`hospitalFromMahal`)
- Kullanıcı metni HTML'e basılırken her zaman `esc()` kullanılır
- Personel `hospital_scope` doluysa yalnızca o hastaneyi görür; yeni staff uçlarında `scopeFilter` / `loadLoanForUpdate` kullan

## Demo (`demo/`)
`demo/mock-api.js` sunucu kurallarının tarayıcıdaki kopyasıdır. API'de kural değiştirirsen mock'u da güncelle ve `npm run build:demo` çalıştır.
