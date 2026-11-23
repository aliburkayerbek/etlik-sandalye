// "Sandalyede bozukluk var mı?" bileşeni. Hem alma hem geri bırakma formunda kullanılır.
let faultUid = 0;
function mountFaultPicker(root) {
  const uid = ++faultUid;
  const parts = ['tekerlek', 'sirtlik', 'koltuk', 'tutamac', 'diger'];
  const names = { tekerlek: 'Tekerlek', sirtlik: 'Arka dayanak', koltuk: 'Oturma yeri', tutamac: 'Tutma kolu', diger: 'Başka yer' };
  root.innerHTML = `
    <fieldset><legend class="f">Sandalyede bozukluk var mı? *</legend>
    <div class="choice">
      <label data-v="no"><input type="radio" name="fault${uid}" value="no"><span>Hayır, sağlam</span><br><small class="muted">Sorun görmedim</small></label>
      <label data-v="yes"><input type="radio" name="fault${uid}" value="yes"><span>Evet, bozuk</span><br><small class="muted">Neresi bozuk, seçeceğim</small></label>
    </div></fieldset>
    <div class="fault-detail hidden">
      <fieldset><legend class="f">Bozuk olan yer(ler)</legend>
      <div class="parts">${parts.map((p) => `
        <label data-p="${p}"><input type="checkbox" value="${p}">${ICONS[p]}${names[p]}<small>${PART_HINT[p]}</small></label>`).join('')}
      </div></fieldset>
      <label class="f" for="fnote${uid}">Kısaca anlatın</label>
      <textarea id="fnote${uid}" maxlength="500" placeholder="Örn: sol arka tekerlek fren tutmuyor"></textarea>
    </div>`;
  const detail = $('.fault-detail', root);
  $$('input[type=radio]', root).forEach((r) => r.addEventListener('change', () => {
    $$('.choice label', root).forEach((x) => x.classList.remove('on-ok', 'on-bad'));
    r.closest('label').classList.add(r.value === 'no' ? 'on-ok' : 'on-bad');
    detail.classList.toggle('hidden', r.value !== 'yes');
  }));
  $$('.parts input', root).forEach((i) => i.addEventListener('change', () => i.closest('label').classList.toggle('on', i.checked)));

  return {
    value() {
      const sel = $('input[type=radio]:checked', root);
      if (!sel) return null;
      if (sel.value === 'no') return { has: false };
      return { has: true, parts: $$('.parts input:checked', root).map((i) => i.value), note: $('textarea', root).value.trim() };
    },
  };
}
