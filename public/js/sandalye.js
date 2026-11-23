// QR okutulduktan sonra açılan hasta/refakatçi ekranı: /s?id=TS-0001
const chairId = (new URLSearchParams(location.search).get('id') || '').trim().toUpperCase();
let meta, chair, borrowFault, returnFault;

renderSteps($('#steps'), 2);

async function init() {
  if (!chairId) { $('#chairCard').innerHTML = '<div class="alert err">QR kod geçersiz. <a href="/">Ana sayfaya dönün</a>.</div>'; return; }
  try {
    [meta, chair] = await Promise.all([api('/api/meta'), api('/api/chairs/' + encodeURIComponent(chairId))]);
  } catch (e) {
    $('#chairCard').innerHTML = `<div class="alert err">${esc(e.message)}</div><a class="btn sec" href="/">Başka QR okut</a>`;
    return;
  }
  $('#chairCard').innerHTML = `
    <div class="chair"><div class="ic">${ICONS.chair}</div>
      <div><div class="id">${esc(chair.idNo)}</div><div><b>Tanımlı Mahal:</b> ${esc(chair.mahal)}</div>
      <div style="margin-top:4px">${badge(chair.status)}</div></div></div>`;

  if (chair.action === 'borrow') setupBorrow();
  else if (chair.action === 'return') setupReturn();
  else if (chair.action === 'wait') {
    renderSteps($('#steps'), 3);
    toast($('#msg'), 'Bu sandalye için bekleyen bir işlem var. Görevli personel onayladığında işlem tamamlanacaktır.', 'info');
  } else {
    toast($('#msg'), 'Bu sandalye şu anda arızalı / bakımda olduğu için verilemiyor. Lütfen en yakın danışmaya başvurun.', 'warn');
  }
}

function setupBorrow() {
  const f = $('#borrowForm');
  f.classList.remove('hidden');
  $('#fromHospital').innerHTML = '<option value="">Seçin…</option>' +
    meta.hospitals.map((h) => `<option ${h === chair.hospital ? 'selected' : ''}>${esc(h)}</option>`).join('');
  borrowFault = mountFaultPicker($('#faultBorrow'));

  const kvkk = $('#kvkkOk');
  kvkk.addEventListener('change', () => { $('#borrowBtn').disabled = !kvkk.checked; });
  $('#tc').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11); });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fault = borrowFault.value();
    const errs = [];
    if ($('#fullName').value.trim().split(/\s+/).length < 2) errs.push('Ad ve soyadı yazın.');
    if ($('#tc').value.length !== 11) errs.push('T.C. Kimlik No 11 haneli olmalı.');
    if ($('#phone').value.replace(/\D/g, '').length < 10) errs.push('Telefon numarasını yazın.');
    if (!$('#fromHospital').value) errs.push('Geldiğiniz hastaneyi seçin.');
    if (!$('#fromDepartment').value.trim()) errs.push('Bölüm / poliklinik / servisi yazın.');
    if (!fault) errs.push('Sandalyede arıza olup olmadığını seçin.');
    else if (fault.has && !fault.parts.length) errs.push('Arızalı parçayı işaretleyin.');
    if (!kvkk.checked) errs.push('KVKK onayı zorunludur.');
    if (errs.length) return toast($('#formMsg'), errs.join(' '));

    $('#borrowBtn').disabled = true;
    try {
      const r = await api('/api/loans', { method: 'POST', body: {
        chairId, fullName: $('#fullName').value, tc: $('#tc').value, phone: $('#phone').value,
        fromHospital: $('#fromHospital').value, fromDepartment: $('#fromDepartment').value,
        fault, kvkkAccepted: true, kvkkVersion: meta.kvkkVersion,
      } });
      finish(f, r, 'Talebiniz alındı', 'Görevli personel kontrol edip <b>“Onayla ve Teslim Et”</b> dediğinde sandalye size teslim edilir. Bu ekranı görevliye gösterebilirsiniz.');
    } catch (err) {
      toast($('#formMsg'), err.message);
      $('#borrowBtn').disabled = false;
    }
  });

  // KVKK modal
  $('[data-kvkk]').addEventListener('click', async (e) => {
    e.preventDefault();
    const dlg = $('#kvkkDlg');
    dlg.showModal();
    if (!dlg.dataset.loaded) { $('#kvkkBody').innerHTML = await (await fetch('/kvkk-metni.html')).text(); dlg.dataset.loaded = 1; }
  });
  $('[data-close]').addEventListener('click', () => $('#kvkkDlg').close());
  $('#kvkkAccept').addEventListener('click', () => { kvkk.checked = true; kvkk.dispatchEvent(new Event('change')); $('#kvkkDlg').close(); });
}

function setupReturn() {
  renderSteps($('#steps'), 2, ['QR Okut', 'Kontrol ve Teslim Notu', 'Personel Teslim Alsın', 'İşlem Tamam']);
  const f = $('#returnForm');
  f.classList.remove('hidden');
  returnFault = mountFaultPicker($('#faultReturn'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fault = returnFault.value();
    if (!fault) return toast($('#returnMsg'), 'Sandalyede arıza olup olmadığını seçin.');
    if (fault.has && !fault.parts.length) return toast($('#returnMsg'), 'Arızalı parçayı işaretleyin.');
    const btn = $('button', f); btn.disabled = true;
    try {
      const r = await api('/api/returns', { method: 'POST', body: { chairId, fault, note: $('#returnNote').value } });
      finish(f, r, 'İade talebiniz düştü', 'Lütfen sandalyeyi görevli personele veya <b>' + esc(chair.mahal) + '</b> noktasına teslim edin. Görevli <b>“İadeyi Onayla”</b> dediğinde işlem tamamlanır.');
    } catch (err) { toast($('#returnMsg'), err.message); btn.disabled = false; }
  });
}

function finish(form, r, title, text) {
  form.classList.add('hidden');
  toast($('#msg'), '');
  renderSteps($('#steps'), 3, chair.action === 'return' ? ['QR Okut', 'Kontrol ve Teslim Notu', 'Personel Teslim Alsın', 'İşlem Tamam'] : undefined);
  const d = $('#done');
  d.classList.remove('hidden');
  d.innerHTML = `<div class="big-ok"><div class="ic">${ICONS.check}</div><h2>${title}</h2>
    <div class="muted">Takip kodu</div><div class="ref">${esc(r.refCode)}</div><p>${text}</p></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

init();
