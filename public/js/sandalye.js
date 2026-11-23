// QR okutulduktan sonra açılan hasta/refakatçi ekranı: /s?id=TS-0001
const chairId = (new URLSearchParams(location.search).get('id') || '').trim().toUpperCase();
let meta, chair, borrowFault, returnFault, mode = 'take';

async function init() {
  if (!chairId) { $('#chairCard').innerHTML = '<div class="alert err">QR kod geçersiz. <a href="/">Ana sayfaya dönün</a>.</div>'; $('#chairCard').removeAttribute('aria-busy'); return; }
  try {
    [meta, chair] = await Promise.all([api('/api/meta'), api('/api/chairs/' + encodeURIComponent(chairId))]);
  } catch (e) {
    $('#chairCard').innerHTML = `<div class="alert err">${esc(e.message)}</div><a class="btn sec" href="/">Başka QR okut</a>`;
    $('#chairCard').removeAttribute('aria-busy');
    return;
  }
  $('#chairCard').removeAttribute('aria-busy');
  $('#chairCard').innerHTML = `
    <div class="chair"><div class="ic" aria-hidden="true">${ICONS.chair}</div>
      <div><div class="id">${esc(chair.idNo)}</div><div><b>Sandalyenin yeri:</b> ${esc(chair.mahal)}</div>
      <div style="margin-top:4px">${hastaBadge(chair.status)}</div></div></div>`;

  if (chair.action === 'borrow') setupBorrow();
  else if (chair.action === 'return') setupReturn();
  else if (chair.action === 'wait') {
    setBanner('wait', 'Bu sandalye için bir işlem sürüyor', 'Bu işlemi siz başlattıysanız görevliye takip kodunuzu gösterin. Değilse başka bir sandalye seçin.');
  } else {
    setBanner('bad', 'Bu sandalye şu an verilemiyor', 'Sandalye bozuk. Lütfen başka bir sandalye seçin veya en yakın danışmadaki görevliye başvurun.');
  }
}

function setBanner(kind, title, sub) {
  const b = $('#banner');
  b.className = 'banner ' + kind;
  b.innerHTML = `<h2 class="bt">${title}</h2><span>${sub}</span>`;
  document.title = title + (chair ? ' | ' + chair.idNo : '') + ' | Etlik Şehir Hastanesi';
}

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Alan bazlı doğrulama: hatalı alan işaretlenir, ilk hatalıya odaklanılır
function checkFields() {
  const rules = [
    ['fullName', (v) => v.trim().split(/\s+/).length >= 2, 'Adınızı ve soyadınızı yazın.'],
    ['tc', (v) => v.length === 11, 'T.C. Kimlik Numarası 11 haneli olmalı.'],
    ['phone', (v) => v.replace(/\D/g, '').length >= 10, 'Telefon numaranızı yazın.'],
    ['fromHospital', (v) => !!v, 'Hangi hastaneden geldiğinizi seçin.'],
    ['fromDepartment', (v) => !!v.trim(), 'Hangi bölüme gittiğinizi yazın.'],
  ];
  let first = null;
  for (const [id, ok, msg] of rules) {
    const el = $('#' + id), err = $('#' + id + '-err');
    const bad = !ok(el.value);
    el.setAttribute('aria-invalid', bad ? 'true' : 'false');
    err.textContent = bad ? msg : '';
    if (bad && !first) first = el;
  }
  return first;
}

function setupBorrow() {
  mode = 'take';
  setBanner('take', 'Bu sandalyeyi ALIYORSUNUZ', 'Aşağıdaki bilgileri doldurun. Görevli onaylayınca sandalyeyi götürebilirsiniz.');
  renderSteps($('#steps'), 2, 'take');
  const f = $('#borrowForm');
  f.classList.remove('hidden');
  $('#fromHospital').innerHTML = '<option value="">Seçin…</option>' +
    meta.hospitals.map((h) => `<option ${h === chair.hospital ? 'selected' : ''}>${esc(h)}</option>`).join('');
  borrowFault = mountFaultPicker($('#faultBorrow'));

  const kvkk = $('#kvkkOk');
  $('#tc').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11); });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    toast($('#formMsg'), '');
    const firstBad = checkFields();
    const fault = borrowFault.value();
    const extra = [];
    if (!fault) extra.push('Sandalyede bozukluk olup olmadığını seçin.');
    else if (fault.has && !fault.parts.length) extra.push('Bozuk olan yeri işaretleyin.');
    kvkk.setAttribute('aria-invalid', kvkk.checked ? 'false' : 'true');
    $('#kvkk-err').textContent = kvkk.checked ? '' : 'Devam etmek için bu kutuyu işaretleyin.';
    if (!kvkk.checked) extra.push('Devam etmek için onay kutusunu işaretleyin.');
    if (firstBad || extra.length) {
      toast($('#formMsg'), firstBad ? 'Formda eksik veya hatalı alan var. ' + extra.join(' ') : extra.join(' '));
      if (firstBad) firstBad.focus();
      return;
    }

    $('#borrowBtn').disabled = true;
    try {
      const r = await api('/api/loans', { method: 'POST', body: {
        chairId, fullName: $('#fullName').value, tc: $('#tc').value, phone: $('#phone').value,
        fromHospital: $('#fromHospital').value, fromDepartment: $('#fromDepartment').value,
        fault, kvkkAccepted: true, kvkkVersion: meta.kvkkVersion,
      } });
      finish(f, r, 'Kaydınız alındı');
    } catch (err) {
      toast($('#formMsg'), err.message);
      $('#borrowBtn').disabled = false;
    }
  });

  // KVKK modal
  $('[data-kvkk]').addEventListener('click', async () => {
    const dlg = $('#kvkkDlg');
    dlg.showModal();
    if (!dlg.dataset.loaded) {
      try {
        const r = await fetch('/kvkk-metni.html');
        if (!r.ok) throw new Error('yüklenemedi');
        $('#kvkkBody').innerHTML = await r.text(); dlg.dataset.loaded = 1;
      } catch (err) { $('#kvkkBody').textContent = 'Metin yüklenemedi. Lütfen görevliye başvurun.'; }
    }
  });
  $('[data-close]').addEventListener('click', () => $('#kvkkDlg').close());
  $('#kvkkAccept').addEventListener('click', () => {
    kvkk.checked = true; kvkk.setAttribute('aria-invalid', 'false'); $('#kvkk-err').textContent = '';
    $('#kvkkDlg').close(); kvkk.focus();
  });
}

function setupReturn() {
  mode = 'give';
  setBanner('give', 'Bu sandalyeyi GERİ BIRAKIYORSUNUZ', 'Sandalyeyi kullanmayı bitirdiniz. Aşağıdaki soruyu cevaplayın, sonra sandalyeyi görevliye bırakın.');
  renderSteps($('#steps'), 2, 'give');
  const f = $('#returnForm');
  f.classList.remove('hidden');
  returnFault = mountFaultPicker($('#faultReturn'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fault = returnFault.value();
    if (!fault) return toast($('#returnMsg'), 'Sandalyede bozukluk olup olmadığını seçin.');
    if (fault.has && !fault.parts.length) return toast($('#returnMsg'), 'Bozuk olan yeri işaretleyin.');
    const btn = $('button', f); btn.disabled = true;
    try {
      const r = await api('/api/returns', { method: 'POST', body: { chairId, fault, note: $('#returnNote').value } });
      finish(f, r, 'Teşekkürler, bilgi alındı');
    } catch (err) { toast($('#returnMsg'), err.message); btn.disabled = false; }
  });
}

// Bitiş ekranı. Almak akışında yeşil tik YOK: önce görevliye gidilmesi gerekir.
function finish(form, r, title) {
  form.classList.add('hidden');
  toast($('#msg'), '');
  renderSteps($('#steps'), 3, mode);
  const d = $('#done');
  d.classList.remove('hidden');
  const code = `<div class="muted">Görevliye bu kodu gösterin</div><div class="ref">${esc(r.refCode)}</div>`;
  if (mode === 'take') {
    d.innerHTML = `<div class="big-ok"><div class="ic wait" aria-hidden="true">${ICONS.wait}</div><h2 tabindex="-1" id="doneTitle">${title}</h2>${code}
      <div class="next"><b>ŞİMDİ:</b> Bir görevliye gidin ve bu ekranı gösterin.</div>
      <div class="stop"><span aria-hidden="true">✋</span> Görevli “onaylandı” demeden sandalyeyi GÖTÜRMEYİN.</div></div>`;
  } else {
    d.innerHTML = `<div class="big-ok"><div class="ic" aria-hidden="true">${ICONS.check}</div><h2 tabindex="-1" id="doneTitle">${title}</h2>${code}
      <div class="next"><b>ŞİMDİ:</b> Sandalyeyi bir görevliye ya da <b>${esc(chair.mahal)}</b> noktasına bırakın.</div>
      <p>Görevli sandalyeye bakınca iş tamam.</p></div>`;
  }
  $('#doneTitle').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
}

init();
