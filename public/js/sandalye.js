// QR okutulduktan sonra açılan hasta/refakatçi ekranı: /s?id=TS-0001
const chairId = (new URLSearchParams(location.search).get('id') || '').trim().toUpperCase();
let meta, chair, borrowFault, returnFault;

renderSteps($('#steps'), 2, STEP_LABELS.take);

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
    renderSteps($('#steps'), 3, STEP_LABELS.take);
    setBanner('wait', 'Görevli bu sandalyeyi kontrol ediyor', 'Bu sandalye için bir işlem başlatılmış. Görevli onaylayınca işlem tamamlanır. Lütfen görevliye başvurun.');
  } else {
    $('#steps').classList.add('hidden');
    setBanner('bad', 'Bu sandalye şu an verilemiyor', 'Sandalye bakımda. Lütfen başka bir sandalye seçin veya en yakın danışmadaki görevliye başvurun.');
  }
}

function setBanner(kind, title, sub) {
  const b = $('#banner');
  b.className = 'banner ' + kind;
  b.innerHTML = `<b>${title}</b><span>${sub}</span>`;
}

function setupBorrow() {
  setBanner('take', 'Bu sandalyeyi ALIYORSUNUZ', 'Aşağıdaki bilgileri doldurun. Görevli onaylayınca sandalyeyi götürebilirsiniz.');
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
      finish(f, r, 'Talebiniz alındı', 'Şimdi bir görevliye gidin ve bu ekranı gösterin. Görevli onaylayınca sandalyeyi götürebilirsiniz. <b>Onaydan önce sandalyeyi götürmeyin.</b>');
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
  setBanner('give', 'Bu sandalyeyi GERİ BIRAKIYORSUNUZ', 'Sandalyeyi kullanmayı bitirdiniz. Aşağıdaki soruyu cevaplayın, sonra sandalyeyi görevliye bırakın.');
  renderSteps($('#steps'), 2, STEP_LABELS.give);
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
      finish(f, r, 'Teşekkürler, bildirimi aldık', 'Şimdi sandalyeyi bir görevliye ya da <b>' + esc(chair.mahal) + '</b> noktasına bırakın. Görevli kontrol edince işlem biter.');
    } catch (err) { toast($('#returnMsg'), err.message); btn.disabled = false; }
  });
}

function finish(form, r, title, text) {
  form.classList.add('hidden');
  toast($('#msg'), '');
  renderSteps($('#steps'), 3, chair.action === 'return' ? STEP_LABELS.give : STEP_LABELS.take);
  const d = $('#done');
  d.classList.remove('hidden');
  d.innerHTML = `<div class="big-ok"><div class="ic">${ICONS.check}</div><h2>${title}</h2>
    <div class="muted">Takip kodu</div><div class="ref">${esc(r.refCode)}</div><p>${text}</p></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

init();
