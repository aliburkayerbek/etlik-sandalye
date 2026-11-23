const { HOSPITALS, FAULT_PARTS } = require('./config');

// "Kalp Damar Hastanesi - Ana Giriş Danışma" -> "Kalp Damar Hastanesi"
function hospitalFromMahal(mahal) {
  const m = String(mahal || '').trim();
  const lower = m.toLocaleLowerCase('tr');
  const match = [...HOSPITALS]
    .sort((a, b) => b.length - a.length)
    .find((h) => lower.startsWith(h.toLocaleLowerCase('tr')));
  if (match) return match;
  const first = m.split(' - ')[0].trim();
  return first || 'Tanımsız';
}

function normalizeChairId(id) {
  return String(id || '').trim().toUpperCase();
}

// İstemciden gelen arıza bilgisini doğrular: { has: bool, parts: [...], note: '' }
function parseFault(f) {
  if (!f || typeof f.has !== 'boolean') return { error: 'Sandalyede arıza olup olmadığını seçin.' };
  if (!f.has) return { has: false, parts: [], note: null };
  const parts = Array.isArray(f.parts) ? [...new Set(f.parts.filter((p) => FAULT_PARTS[p]))] : [];
  const note = String(f.note || '').trim().slice(0, 500) || null;
  if (!parts.length) return { error: 'Arızalı parçayı en az bir tane işaretleyin.' };
  if (parts.includes('diger') && !note) return { error: '"Diğer" seçildiğinde kısa arıza notu yazın.' };
  return { has: true, parts, note };
}

const clean = (s, max = 120) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);

module.exports = { hospitalFromMahal, normalizeChairId, parseFault, clean };
