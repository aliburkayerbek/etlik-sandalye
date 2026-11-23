(async () => {
  const meta = await api('/api/meta');
  await api('/api/auth/me');
  $('#hospital').innerHTML += meta.hospitals.map((h) => `<option>${esc(h)}</option>`).join('');
  $('#gen').onclick = async () => {
    $('#gen').disabled = true;
    $('#info').textContent = 'Etiketler hazırlanıyor…';
    try {
      const p = new URLSearchParams({ hospital: $('#hospital').value, ids: $('#ids').value });
      const labels = await api('/api/admin/labels?' + p);
      const pages = [];
      for (let i = 0; i < labels.length; i += 21) pages.push(labels.slice(i, i + 21));
      $('#sheet').innerHTML = pages.map((pg) => `<div class="page">${pg.map((l) => `
        <div class="label"><div class="qr">${l.svg}</div><div class="txt">
          <div class="org">ETLİK ŞEHİR HASTANESİ</div><div class="id">${esc(l.idNo)}</div>
          <div class="mahal">${esc(l.mahal)}</div><div class="hint">Ödünç almak / iade etmek için okutun</div></div></div>`).join('')}</div>`).join('');
      $('#info').textContent = `${labels.length} etiket, ${pages.length} sayfa hazır.`;
      $('#print').disabled = !labels.length;
    } catch (e) { $('#info').textContent = e.message; }
    $('#gen').disabled = false;
  };
  $('#print').onclick = () => window.print();
})();
