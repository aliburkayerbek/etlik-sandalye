// Kurum ve iş kuralı sabitleri. Hastane listesini kampüs yönetimiyle teyit ederek güncelleyin.
const HOSPITALS = [
  'Genel Hastane',
  'Kalp Damar Hastanesi',
  'Onkoloji Hastanesi',
  'Nöroloji - Ortopedi Hastanesi',
  'Kadın Doğum Hastanesi',
  'Çocuk Hastanesi',
  'Fizik Tedavi ve Rehabilitasyon Hastanesi',
  'Yüksek Güvenlikli Adli Psikiyatri Hastanesi',
];

const FAULT_PARTS = {
  tekerlek: 'Tekerlek',
  sirtlik: 'Sırtlık',
  koltuk: 'Koltuk',
  tutamac: 'Tutamaç',
  diger: 'Diğer',
};

const CHAIR_STATUS = {
  musait: 'Müsait / Boşta',
  onay_bekliyor: 'Onay Bekliyor',
  kullanimda: 'Kullanımda / Teslim Edildi',
  iade_bekliyor: 'İade Bekliyor',
  arizali: 'Arızalı / Bakımda',
};

// KVKK metninde değişiklik yaptığınızda sürümü artırın; her kayıt hangi sürümü onayladığını saklar.
const KVKK_VERSION = 'v1.0-2026-11';

module.exports = {
  ORG_NAME: 'Etlik Şehir Hastanesi',
  HOSPITALS,
  FAULT_PARTS,
  CHAIR_STATUS,
  KVKK_VERSION,
};
