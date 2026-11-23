// Admin paneli (tek sayfa, sekmeli).
let meta, me;
const PARTS = { tekerlek: 'Tekerlek', sirtlik: 'Sırtlık', koltuk: 'Koltuk', tutamac: 'Tutamaç', diger: 'Diğer' };
const view = () => $('#view');
const hospitalOptions = (sel = '', empty = 'Tüm hastaneler') =>
  `<option value="">${empty}</option>` + meta.hospitals.map((h) => `<option ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
const statusOptions = (sel = '') => '<option value="">Tüm durumlar</option>' +
  Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

function dialog(title, body, buttons) {
  const d = $('#dlg');
  $('#dlgTitle').textContent = title;
  $('#dlgBody').innerHTML = body;
  $('#dlgFoot').innerHTML = '';
  [{ label: 'Vazgeç', cls: 'ghost', onClick: () => d.close() }, ...buttons].forEach((b) => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.addEventListener('click', async () => {
      try { el.disabled = true; await b.onClick(); } catch (e) { toast($('#dlgMsg') || $('#dlgBody'), e.message); } finally { el.disabled = false; }
    });
    $('#dlgFoot').appendChild(el);
  });
  d.showModal();
  return d;
}

function bars(rows, labelKey, valueKey, cls = 's-one') {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return `<div class="bars">${rows.map((r) => `<div class="bar"><div class="lb"><span>${esc(r[labelKey])}</span><span>${r[valueKey]}</span></div>
    <div class="track"><span class="${cls}" style="width:${(r[valueKey] / max) * 100}%"></span></div></div>`).join('') || '<p class="muted">Veri yok.</p>'}</div>`;
}

/* ---------- Özet (infografik) ---------- */
async function ozet() {
  const [sum, parts, chairs] = await Promise.all([
    api('/api/staff/summary'),
    api('/api/admin/reports/ariza_parca?from=' + daysAgo(30)),
    api('/api/admin/reports/ariza_sandalye?from=' + daysAgo(30)),
  ]);
  const tot = {}, byH = {};
  sum.forEach((r) => {
    tot[r.status] = (tot[r.status] || 0) + r.n;
    byH[r.hospital] = byH[r.hospital] || { total: 0 };
    byH[r.hospital][r.status] = r.n; byH[r.hospital].total += r.n;
  });
  const all = Object.values(tot).reduce((a, b) => a + b, 0);
  const order = ['musait', 'onay_bekliyor', 'kullanimda', 'iade_bekliyor', 'arizali'];
  view().innerHTML = `
    <div class="stats"><div class="stat"><div class="v">${all}</div><div class="l">Toplam sandalye</div></div>
      ${order.map((s) => `<div class="stat ${s}"><div class="v">${tot[s] || 0}</div><div class="l">${STATUS[s]}</div></div>`).join('')}</div>
    <div class="card"><h2>Hastane bazlı doluluk</h2><div class="bars">
      ${Object.entries(byH).sort((a, b) => b[1].total - a[1].total).map(([h, v]) => `
        <div class="bar"><div class="lb"><span>${esc(h)}</span><span>${v.total} sandalye · %${Math.round(((v.kullanimda || 0) / v.total) * 100)} kullanımda</span></div>
        <div class="track">${order.map((s) => v[s] ? `<span class="s-${s}" title="${STATUS[s]}: ${v[s]}" style="width:${(v[s] / v.total) * 100}%"></span>` : '').join('')}</div></div>`).join('') || '<p class="muted">Henüz sandalye yok. Excel Yükle sekmesinden başlayın.</p>'}
      </div><div class="legend">${order.map((s) => `<span><i class="s-${s}"></i>${STATUS[s]}</span>`).join('')}</div></div>
    <div class="grid2">
      <div class="card"><h2>En çok arızalanan parça (30 gün)</h2>${bars(parts.rows, 'parca', 'adet', 's-arizali')}</div>
      <div class="card"><h2>En çok arıza bildirilen sandalyeler (30 gün)</h2>
        ${bars(chairs.rows.slice(0, 8).map((r) => ({ ...r, l: `${r.id_no} · ${r.mahal}` })), 'l', 'bildirim', 's-arizali')}</div>
    </div>`;
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/* ---------- Sandalyeler ---------- */
let chairQ = { q: '', hospital: '', status: '', offset: 0 };
async function sandalyeler() {
  const p = new URLSearchParams({ ...chairQ, limit: 100 });
  const data = await api('/api/admin/chairs?' + p);
  view().innerHTML = `<div class="card"><div class="toolbar">
      <input type="search" id="cq" placeholder="ID No / mahal ara" value="${esc(chairQ.q)}">
      <select id="ch">${hospitalOptions(chairQ.hospital)}</select><select id="cs">${statusOptions(chairQ.status)}</select>
      <button class="btn sm" id="cf">Filtrele</button>${me.role === 'admin' ? '<button class="btn sm navy" id="cnew">+ Yeni sandalye</button>' : ''}
      <span class="muted">${data.total} kayıt</span></div>
    <div class="tablewrap"><table class="t"><tr><th>ID No</th><th>Tanımlı Mahal</th><th>Hastane</th><th>Durum</th><th>Açık arıza</th><th></th></tr>
    ${data.rows.map((c) => `<tr class="${c.active ? '' : 'muted'}"><td><b>${esc(c.id_no)}</b>${c.active ? '' : ' (pasif)'}</td><td>${esc(c.mahal)}</td><td>${esc(c.hospital)}</td>
      <td>${badge(c.status)}</td><td>${c.open_faults || ''}</td><td style="white-space:nowrap">
      ${me.role === 'admin' ? `<button class="btn sm ghost" data-edit="${esc(c.id_no)}">Düzenle</button>` : ''}
      ${c.status === 'arizali' ? `<button class="btn sm ok" data-fix="${esc(c.id_no)}">Bakımdan çıkar</button>`
        : c.status === 'musait' ? `<button class="btn sm bad" data-break="${esc(c.id_no)}">Bakıma al</button>` : ''}</td></tr>`).join('')}</table></div>
    <div class="toolbar" style="margin-top:10px">${chairQ.offset > 0 ? '<button class="btn sm ghost" id="prev">← Önceki</button>' : ''}
      ${chairQ.offset + 100 < data.total ? '<button class="btn sm ghost" id="next">Sonraki →</button>' : ''}</div></div>`;

  const apply = () => { chairQ = { q: $('#cq').value, hospital: $('#ch').value, status: $('#cs').value, offset: 0 }; sandalyeler(); };
  $('#cf').onclick = apply; $('#cq').onkeydown = (e) => e.key === 'Enter' && apply();
  if ($('#prev')) $('#prev').onclick = () => { chairQ.offset -= 100; sandalyeler(); };
  if ($('#next')) $('#next').onclick = () => { chairQ.offset += 100; sandalyeler(); };
  if ($('#cnew')) $('#cnew').onclick = () => chairDialog();
  view().onclick = (e) => {
    const t = e.target;
    if (t.dataset.edit) chairDialog(data.rows.find((c) => c.id_no === t.dataset.edit));
    if (t.dataset.fix) api(`/api/admin/chairs/${encodeURIComponent(t.dataset.fix)}/status`, { method: 'POST', body: { status: 'musait' } }).then(sandalyeler).catch((er) => alert(er.message));
    if (t.dataset.break) breakDialog(t.dataset.break);
  };
}

function chairDialog(c) {
  dialog(c ? `Sandalye düzenle: ${c.id_no}` : 'Yeni sandalye', `
    <label class="f">ID No</label><input type="text" id="did" value="${esc(c?.id_no || '')}" ${c ? 'disabled' : ''} placeholder="TS-1271">
    <label class="f">Tanımlı Mahal</label><input type="text" id="dm" value="${esc(c?.mahal || '')}" placeholder="Kalp Damar Hastanesi - Ana Giriş Danışma">
    <p class="muted">Biçim: <b>Hastane Adı - Yer</b>. Hastane bilgisi bu metinden otomatik çıkarılır.</p>
    ${c ? `<label style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="dact" ${c.active ? 'checked' : ''}> Aktif (pasif sandalyenin QR'ı çalışmaz)</label>` : ''}<div id="dlgMsg"></div>`,
  [{ label: 'Kaydet', onClick: async () => {
    if (c) await api(`/api/admin/chairs/${encodeURIComponent(c.id_no)}`, { method: 'PUT', body: { mahal: $('#dm').value, active: $('#dact').checked } });
    else await api('/api/admin/chairs', { method: 'POST', body: { id_no: $('#did').value, mahal: $('#dm').value } });
    $('#dlg').close(); sandalyeler();
  } }]);
}

function breakDialog(id) {
  dialog(`${id} → Arızalı / Bakımda`, '<div id="fp"></div><div id="dlgMsg"></div>', [{ label: 'Bakıma al', cls: 'bad', onClick: async () => {
    const f = picker.value();
    if (!f || !f.has) throw new Error('Arıza Var seçip parçayı işaretleyin.');
    await api(`/api/admin/chairs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'arizali', fault: f } });
    $('#dlg').close(); sandalyeler();
  } }]);
  const picker = mountFaultPicker($('#fp'));
}

/* ---------- Excel yükleme ---------- */
function yukle() {
  view().innerHTML = `<div class="card"><h2>Excel ile toplu sandalye yükleme</h2>
    <div class="steps" style="grid-template-columns:repeat(3,1fr)">
      <div class="step active"><div class="ic">${ICONS.form}</div>1. Şablonu indir ve doldur</div>
      <div class="step"><div class="ic">${ICONS.qr}</div>2. Yükle ve önizle</div>
      <div class="step"><div class="ic">${ICONS.done}</div>3. Onayla, kaydet</div></div>
    <p>Sütun başlıkları birebir <b>ID No</b> ve <b>Tanımlı Mahal</b> olmalı. Örnek: <code>TS-0001</code> · <code>Kalp Damar Hastanesi - Ana Giriş Danışma</code></p>
    <a class="btn sec" href="/api/admin/chairs/template">⬇ Örnek şablonu indir (.xlsx)</a>
    <div class="toolbar" style="margin-top:16px">
      <input type="file" id="file" accept=".xlsx,.xls,.csv">
      <select id="mode"><option value="upsert">Yeni ekle + mevcutları güncelle</option><option value="insert">Yalnızca yeni ekle</option></select>
      <button class="btn" id="prev">Önizle</button></div>
    <div id="res"></div></div>`;
  const send = async (dry) => {
    const f = $('#file').files[0];
    if (!f) return toast($('#res'), 'Dosya seçin.');
    const fd = new FormData(); fd.append('file', f);
    return api(`/api/admin/chairs/import?mode=${$('#mode').value}${dry ? '&dryRun=1' : ''}`, { method: 'POST', body: fd });
  };
  $('#prev').onclick = async () => {
    try {
      const r = await send(true);
      if (!r) return;
      $('#res').innerHTML = `
        <div class="stats" style="margin-top:12px">
          <div class="stat"><div class="v">${r.totalRows}</div><div class="l">Satır</div></div>
          <div class="stat musait"><div class="v">${r.insert}</div><div class="l">Yeni eklenecek</div></div>
          <div class="stat kullanimda"><div class="v">${r.update}</div><div class="l">Güncellenecek</div></div>
          <div class="stat arizali"><div class="v">${r.warnings.length}</div><div class="l">Uyarı</div></div></div>
        ${r.warnings.length ? `<div class="alert warn"><b>Hatalı / boş satır uyarıları</b><ul style="margin:6px 0 0;padding-left:18px">${r.warnings.slice(0, 100).map((w) => `<li>Satır ${w.row}${w.id ? ' (' + esc(w.id) + ')' : ''}: ${esc(w.message)}</li>`).join('')}</ul></div>` : '<div class="alert ok">Dosyada hata bulunmadı.</div>'}
        <table class="t"><tr><th>ID No</th><th>Tanımlı Mahal</th><th>Hastane</th></tr>${r.preview.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.mahal)}</td><td>${esc(p.hospital)}</td></tr>`).join('')}</table>
        <p class="muted">İlk 10 satır gösteriliyor.</p>
        <button class="btn ok lg" id="commit" ${r.insert + r.update ? '' : 'disabled'}>✓ Onayla ve ${r.insert + r.update} kaydı yükle</button>`;
      $('#commit').onclick = async () => {
        const c = await send(false);
        $('#res').innerHTML = `<div class="alert ok">Yükleme tamamlandı: ${c.insert} yeni, ${c.update} güncellendi. <a href="/etiket" target="_blank">QR etiketlerini yazdır →</a></div>`;
      };
    } catch (e) { toast($('#res'), e.message); }
  };
}

/* ---------- Hareketler ---------- */
async function hareketler() {
  const rows = await api('/api/admin/movements');
  view().innerHTML = `<div class="card"><h2>Aktif hareketler (${rows.length})</h2><p class="muted">Onay bekleyen, kullanımdaki ve iade bekleyen tüm kayıtlar. 15 sn'de bir yenilenir.</p>
    <div class="tablewrap"><table class="t"><tr><th>ID No</th><th>Tanımlı Mahal</th><th>Durum</th><th>Kişi</th><th>Gittiği yer</th><th>Talep</th><th>Onaylayan</th><th></th></tr>
    ${rows.map((r) => `<tr><td><b>${esc(r.chair_id)}</b><br><span class="muted">${esc(r.ref_code)}</span></td><td>${esc(r.mahal)}</td><td>${badge(r.status)}</td>
      <td>${esc(r.full_name)}<br><span class="muted">${esc(r.phone_masked)}</span></td><td>${esc(r.from_hospital)} / ${esc(r.from_department)}</td>
      <td>${fmt(r.requested_at)}<br><span class="muted">${ago(r.requested_at)}</span></td><td>${esc(r.approved_by_name || '-')}</td>
      <td>${me.role === 'admin' ? `<button class="btn sm ghost" data-cancel="${r.id}">Müdahale</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
  view().onclick = (e) => {
    const id = e.target.dataset.cancel;
    if (!id) return;
    dialog('Manuel müdahale: kaydı kapat', `<p>Kayıt iptal edilir ve sandalye seçtiğiniz statüye alınır.</p>
      <select id="cst"><option value="musait">Sandalye elimizde ve sağlam → Müsait</option><option value="arizali">Sandalye arızalı / kayıp → Arızalı</option></select>
      <label class="f">Not</label><input type="text" id="cnote" placeholder="Örn: Hasta taburcu oldu, sandalye serviste bulundu"><div id="dlgMsg"></div>`,
    [{ label: 'Kaydı kapat', cls: 'bad', onClick: async () => {
      await api(`/api/admin/movements/${id}/cancel`, { method: 'POST', body: { chairStatus: $('#cst').value, note: $('#cnote').value } });
      $('#dlg').close(); hareketler();
    } }]);
  };
}

/* ---------- Arızalar ---------- */
let faultOpen = true;
async function arizalar() {
  const rows = await api('/api/admin/faults?open=' + (faultOpen ? 1 : 0));
  const stage = { teslim_alma: 'Teslim almada', iade: 'İadede', personel: 'Personel', admin: 'Admin' };
  view().innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0">Arıza bildirimleri</h2>
      <label><input type="checkbox" id="fo" ${faultOpen ? 'checked' : ''}> Yalnızca açık olanlar</label></div>
    <div class="tablewrap"><table class="t"><tr><th>Tarih</th><th>ID No</th><th>Tanımlı Mahal</th><th>Aşama</th><th>Parçalar</th><th>Not</th><th>Sandalye</th><th></th></tr>
    ${rows.map((f) => `<tr><td>${fmt(f.created_at)}</td><td><b>${esc(f.chair_id)}</b></td><td>${esc(f.mahal)}</td><td>${stage[f.stage]}</td>
      <td>${f.parts.map((p) => PARTS[p]).join(', ')}</td><td>${esc(f.note || '')}</td><td>${badge(f.chair_status)}</td>
      <td>${f.resolved_at ? '<span class="muted">Kapandı</span>' : `<button class="btn sm ok" data-res="${f.id}">Giderildi</button>
        ${f.chair_status === 'musait' ? `<button class="btn sm bad" data-brk="${esc(f.chair_id)}">Bakıma al</button>` : ''}`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Kayıt yok.</td></tr>'}</table></div></div>`;
  $('#fo').onchange = (e) => { faultOpen = e.target.checked; arizalar(); };
  view().onclick = async (e) => {
    if (e.target.dataset.res) { await api(`/api/admin/faults/${e.target.dataset.res}/resolve`, { method: 'POST' }); arizalar(); }
    if (e.target.dataset.brk) { await api(`/api/admin/chairs/${encodeURIComponent(e.target.dataset.brk)}/status`, { method: 'POST', body: { status: 'arizali' } }).catch((er) => alert(er.message)); arizalar(); }
  };
}

/* ---------- Raporlar ---------- */
const REPORT_LIST = {
  personel: 'Personel işlem sayıları (saat aralığı)', durum: 'Anlık sandalye durumu', ariza_parca: 'Arıza: parça bazında',
  ariza_sandalye: 'Arıza: sandalye bazında', kullanim: 'Kullanım yoğunluğu',
};
let rq = { key: 'personel', from: daysAgo(7), to: daysAgo(0), by: 'hastane', hospital: '', status: '' };
async function raporlar() {
  const p = new URLSearchParams(rq);
  const rep = await api(`/api/admin/reports/${rq.key}?` + p);
  const numCol = { personel: 'toplam', ariza_parca: 'adet', ariza_sandalye: 'bildirim', kullanim: 'odunc' }[rq.key];
  const lblCol = { personel: null, ariza_parca: 'parca', ariza_sandalye: 'id_no', kullanim: 'grup' }[rq.key];
  let chart = '';
  if (rq.key === 'personel') {
    const agg = {};
    rep.rows.forEach((r) => { agg[r.personel] = (agg[r.personel] || 0) + r.toplam; });
    chart = bars(Object.entries(agg).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v), 'k', 'v');
  } else if (lblCol) chart = bars(rep.rows.slice(0, 12), lblCol, numCol, rq.key.startsWith('ariza') ? 's-arizali' : 's-one');

  view().innerHTML = `<div class="card"><div class="toolbar">
      <select id="rk">${Object.entries(REPORT_LIST).map(([k, v]) => `<option value="${k}" ${k === rq.key ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${rq.key !== 'durum' ? `<label>Başlangıç<br><input type="date" id="rf" value="${rq.from}"></label><label>Bitiş<br><input type="date" id="rt" value="${rq.to}"></label>` : ''}
      ${rq.key === 'kullanim' ? `<select id="rb"><option value="hastane">Hastane bazlı</option><option value="mahal">Tanımlı Mahal bazlı</option><option value="bolum">Gidilen bölüm bazlı</option></select>` : ''}
      ${rq.key === 'durum' ? `<select id="rh">${hospitalOptions(rq.hospital)}</select><select id="rs">${statusOptions(rq.status)}</select>` : ''}
      <button class="btn sm" id="rgo">Göster</button>
      <a class="btn sm sec" href="/api/admin/reports/${rq.key}?${p}&format=xlsx">⬇ Excel</a><a class="btn sm ghost" href="/api/admin/reports/${rq.key}?${p}&format=csv">⬇ CSV</a></div>
    <h2>${esc(rep.title)}</h2>${chart ? `<div style="margin-bottom:16px">${chart}</div>` : ''}
    <div class="tablewrap"><table class="t"><tr>${rep.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>
    ${rep.rows.map((r) => `<tr>${rep.columns.map((c) => `<td>${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${rep.columns.length}" class="muted">Bu aralıkta veri yok.</td></tr>`}</table></div></div>`;
  if ($('#rb')) $('#rb').value = rq.by;
  $('#rk').onchange = (e) => { rq.key = e.target.value; raporlar(); };
  $('#rgo').onclick = () => {
    if ($('#rf')) { rq.from = $('#rf').value; rq.to = $('#rt').value; }
    if ($('#rb')) rq.by = $('#rb').value;
    if ($('#rh')) { rq.hospital = $('#rh').value; rq.status = $('#rs').value; }
    raporlar();
  };
}

/* ---------- Kullanıcılar ---------- */
async function kullanicilar() {
  const rows = await api('/api/admin/users');
  const roleL = { admin: 'Admin', supervisor: 'Süpervizör', staff: 'Personel' };
  view().innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0">Kullanıcılar</h2><button class="btn sm navy" id="unew">+ Kullanıcı ekle</button></div>
    <table class="t"><tr><th>Ad Soyad</th><th>Kullanıcı adı</th><th>Rol</th><th>Hastane kapsamı</th><th>Vardiya</th><th>Durum</th><th></th></tr>
    ${rows.map((u) => `<tr class="${u.active ? '' : 'muted'}"><td><b>${esc(u.full_name)}</b></td><td>${esc(u.username)}</td><td>${roleL[u.role]}</td>
      <td>${esc(u.hospital_scope || 'Tüm kampüs')}</td><td>${esc(u.shift || '-')}</td><td>${u.active ? 'Aktif' : 'Pasif'}</td>
      <td><button class="btn sm ghost" data-u="${u.id}">Düzenle</button></td></tr>`).join('')}</table></div>`;
  $('#unew').onclick = () => userDialog();
  view().onclick = (e) => { if (e.target.dataset.u) userDialog(rows.find((u) => u.id == e.target.dataset.u)); };
}

function userDialog(u) {
  dialog(u ? 'Kullanıcı düzenle' : 'Yeni kullanıcı', `
    <label class="f">Ad Soyad</label><input type="text" id="un" value="${esc(u?.full_name || '')}">
    <label class="f">Kullanıcı adı</label><input type="text" id="uu" value="${esc(u?.username || '')}" autocapitalize="none">
    <div class="row2"><div><label class="f">Rol</label><select id="ur"><option value="staff">Personel</option><option value="supervisor">Süpervizör</option><option value="admin">Admin</option></select></div>
      <div><label class="f">Vardiya</label><select id="us"><option value="">-</option><option>Gündüz</option><option>Akşam</option><option>Gece</option></select></div></div>
    <label class="f">Hastane kapsamı (yalnızca bu hastanenin taleplerini görür)</label><select id="uh">${hospitalOptions(u?.hospital_scope || '', 'Tüm kampüs')}</select>
    <label class="f">${u ? 'Yeni şifre (değiştirmeyecekseniz boş bırakın)' : 'Şifre (en az 8 karakter)'}</label><input type="password" id="up" autocomplete="new-password">
    ${u ? `<label style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="ua" ${u.active ? 'checked' : ''}> Aktif</label>` : ''}<div id="dlgMsg"></div>`,
  [{ label: 'Kaydet', onClick: async () => {
    const body = { full_name: $('#un').value, username: $('#uu').value, role: $('#ur').value, shift: $('#us').value,
      hospital_scope: $('#uh').value, password: $('#up').value || undefined, active: u ? $('#ua').checked : true };
    await api(u ? `/api/admin/users/${u.id}` : '/api/admin/users', { method: u ? 'PUT' : 'POST', body });
    $('#dlg').close(); kullanicilar();
  } }]);
  if (u) { $('#ur').value = u.role; $('#us').value = u.shift || ''; }
}

/* ---------- Sekme yönetimi ---------- */
const VIEWS = { ozet, sandalyeler, yukle, hareketler, arizalar, raporlar, kullanicilar };
let current = 'ozet';
async function show(name) {
  current = name;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  view().onclick = null;
  try { await VIEWS[name](); } catch (e) { if (view()) view().innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
$('#logout').addEventListener('click', logout);

(async () => {
  me = await api('/api/auth/me');
  if (!['admin', 'supervisor'].includes(me.role)) { location.href = '/personel'; return; }
  if (me.role !== 'admin') $$('[data-tab=yukle],[data-tab=kullanicilar]').forEach((b) => b.remove());
  meta = await api('/api/meta');
  $('#who').textContent = me.name;
  show('ozet');
  setInterval(() => { if (current === 'hareketler' && !$('#dlg').open) hareketler().catch(() => {}); }, 15000);
})();
