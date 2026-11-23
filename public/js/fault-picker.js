// "Sandalyede arıza var mı?" bileşeni. Hem ödünç alma hem iade formunda kullanılır.
function mountFaultPicker(root) {
  const parts = ['tekerlek', 'sirtlik', 'koltuk', 'tutamac', 'diger'];
  const names = { tekerlek: 'Tekerlek', sirtlik: 'Sırtlık', koltuk: 'Koltuk', tutamac: 'Tutamaç', diger: 'Diğer' };
  root.innerHTML = `
    <label class="f">Sandalyede bozukluk var mı? *</label>
    <div class="choice">
      <label data-v="no"><input type="radio" name="fault" value="no">✓ Hayır, sağlam<br><small class="muted">Sorun görmedim</small></label>
      <label data-v="yes"><input type="radio" name="fault" value="yes">⚠ Evet, bozuk<br><small class="muted">Neresi bozuk, seçeceğim</small></label>
    </div>
    <div class="fault-detail hidden">
      <div class="parts">${parts.map((p) => `
        <label data-p="${p}"><input type="checkbox" value="${p}">${ICONS[p]}${names[p]}<small>${PART_HINT[p]}</small></label>`).join('')}
      </div>
      <label class="f">Kısaca anlatın</label>
      <textarea maxlength="500" placeholder="Örn: sol arka tekerlek fren tutmuyor"></textarea>
    </div>`;
  const detail = $('.fault-detail', root);
  $$('.choice label', root).forEach((l) => l.addEventListener('click', () => {
    $$('.choice label', root).forEach((x) => x.classList.remove('on-ok', 'on-bad'));
    l.classList.add(l.dataset.v === 'no' ? 'on-ok' : 'on-bad');
    $('input', l).checked = true;
    detail.classList.toggle('hidden', l.dataset.v !== 'yes');
  }));
  $$('.parts label', root).forEach((l) => $('input', l).addEventListener('change', (e) => l.classList.toggle('on', e.target.checked)));

  return {
    value() {
      const sel = $('input[name=fault]:checked', root);
      if (!sel) return null;
      if (sel.value === 'no') return { has: false };
      return { has: true, parts: $$('.parts input:checked', root).map((i) => i.value), note: $('textarea', root).value.trim() };
    },
  };
}
