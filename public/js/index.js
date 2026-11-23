renderSteps($('#steps'), 1);

// QR içeriği ya tam URL (…/s?id=TS-0001) ya da yalnızca ID olabilir
function idFromText(text) {
  try { const u = new URL(text); return u.searchParams.get('id') || ''; } catch { return text.trim(); }
}
const go = (id) => { if (id) location.href = '/s?id=' + encodeURIComponent(id.trim().toUpperCase()); };

$('#goBtn').addEventListener('click', () => go($('#manual').value));
$('#manual').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target.value); });

let scanner;
$('#scanBtn').addEventListener('click', async () => {
  const reader = $('#reader');
  reader.classList.remove('hidden');
  try {
    scanner = scanner || new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, async (text) => {
      await scanner.stop();
      go(idFromText(text));
    });
    $('#scanBtn').classList.add('hidden');
  } catch (e) {
    reader.classList.add('hidden');
    toast($('#msg'), 'Kamera açılamadı. Tarayıcıya kamera izni verin veya telefonunuzun kamera uygulamasıyla QR kodu okutun.');
  }
});
