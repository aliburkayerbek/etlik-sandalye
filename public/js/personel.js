// Personel / süpervizör ekranı: onay kuyruğu, kullanımdaki sandalyeler, doluluk kartları.
let tab = 'queue', queue = [], active = [], me;
const PARTS = { tekerlek: 'Tekerlek', sirtlik: 'Sırtlık', koltuk: 'Koltuk', tutamac: 'Tutamaç', diger: 'Diğer' };

async function load() {
  [queue, active] = await Promise.all([api('/api/staff/queue'), api('/api/staff/active')]);
  const sum = await api('/api/staff/summary');
  const tot = {};
  sum.forEach((r) => { tot[r.status] = (tot[r.status] || 0) + r.n; });
  $('#stats').innerHTML = Object.keys(STATUS).map((s) =>
    `<div class="stat ${s}"><div class="v">${tot[s] || 0}</div><div class="l">${STATUS[s]}</div></div>`).join('');
  $('#qn').textContent = queue.length ? `(${queue.length})` : '';
  $('#an').textContent = active.length ? `(${active.length})` : '';
  $('#refreshed').textContent = 'Güncellendi: ' + new Date().toLocaleTimeString('tr-TR');
  render();
}

const faultText = (faults) => (faults || []).map((f) =>
  `<div class="alert warn" style="margin:0">⚠ ${f.stage === 'iade' ? 'İadede' : 'Teslim almada'} bildirilen arıza: <b>${f.parts.map((p) => PARTS[p]).join(', ')}</b>${f.note ? ' — ' + esc(f.note) : ''}</div>`).join('');

function render() {
  const q = $('#filter').value.trim().toLocaleLowerCase('tr');
  const match = (x) => !q || (x.chair_id + ' ' + x.full_name + ' ' + x.mahal).toLocaleLowerCase('tr').includes(q);
  const list = $('#list');
  if (tab === 'queue') {
    const items = queue.filter(match);
    list.innerHTML = items.length ? items.map((x) => {
      const ret = x.status === 'iade_bekliyor';
      return `<div class="qitem ${ret ? 'ret' : 'bor'}">
        <div class="hd"><b>${esc(x.chair_id)}</b>${badge(x.status)}<span class="muted">${ago(ret ? x.return_requested_at : x.requested_at)}</span></div>
        <dl class="kv"><dt>Tanımlı Mahal</dt><dd>${esc(x.mahal)}</dd><dt>Ad Soyad</dt><dd>${esc(x.full_name)}</dd>
          <dt>T.C. / Telefon</dt><dd>${esc(x.tc_masked)} · ${esc(x.phone_masked)}</dd>
          <dt>Geldiği yer</dt><dd>${esc(x.from_hospital)} / ${esc(x.from_department)}</dd>
          ${ret && x.return_note ? `<dt>Teslim notu</dt><dd>${esc(x.return_note)}</dd>` : ''}
          <dt>Takip kodu</dt><dd>${esc(x.ref_code)}</dd></dl>
        ${faultText(x.faults)}
        <div class="acts">${ret
          ? `<label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" data-faulty="${x.id}" ${x.return_condition_ok === false ? 'checked' : ''}> Arızalı / Kontrol Gerekli olarak işaretle</label>
             <button class="btn ok" data-act="approve-return" data-id="${x.id}">✓ İadeyi Onayla (Teslim Al)</button>`
          : `<button class="btn ok" data-act="approve" data-id="${x.id}">✓ Onayla ve Teslim Et</button>
             <button class="btn ghost" data-act="reject" data-id="${x.id}">Reddet</button>`}</div></div>`;
    }).join('') : '<p class="muted">Bekleyen işlem yok. 🎉</p>';
  } else {
    const items = active.filter(match);
    list.innerHTML = items.length ? `<div class="tablewrap"><table class="t"><tr><th>ID No</th><th>Tanımlı Mahal</th><th>Kişi</th><th>Gittiği yer</th><th>Teslim</th><th></th></tr>
      ${items.map((x) => `<tr><td><b>${esc(x.chair_id)}</b></td><td>${esc(x.mahal)}</td><td>${esc(x.full_name)}<br><span class="muted">${esc(x.phone_masked)}</span></td>
        <td>${esc(x.from_hospital)} / ${esc(x.from_department)}</td><td>${fmt(x.approved_at)}<br><span class="muted">${ago(x.approved_at)}</span></td>
        <td><button class="btn sm sec" data-act="force-return" data-id="${x.id}">Doğrudan teslim al</button></td></tr>`).join('')}</table></div>`
      : '<p class="muted">Kullanımda sandalye yok.</p>';
  }
}

$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  let body = {};
  if (act === 'reject') {
    const reason = prompt('Red nedeni (ör. sandalye yerinde yok, kimlik uyuşmadı):');
    if (reason === null) return;
    body = { reason, markFaulty: confirm('Sandalye arızalı/bakıma alınsın mı?') };
  }
  if (act === 'approve-return') body = { markFaulty: !!$(`[data-faulty="${id}"]`)?.checked };
  if (act === 'force-return' && !confirm('Sandalye QR iadesi yapılmadan teslim alındı olarak kapatılsın mı?')) return;
  b.disabled = true;
  try { await api(`/api/staff/loans/${id}/${act}`, { method: 'POST', body }); await load(); }
  catch (err) { alert(err.message); b.disabled = false; }
});

$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  tab = b.dataset.tab; render();
}));
$('#filter').addEventListener('input', render);
$('#logout').addEventListener('click', logout);

(async () => {
  me = await api('/api/auth/me');
  $('#who').textContent = me.name + (me.scope ? ' · ' + me.scope : '');
  if (me.role === 'admin') $('#adminLink').classList.remove('hidden');
  await load();
  setInterval(() => load().catch(() => {}), 15000);
})();
