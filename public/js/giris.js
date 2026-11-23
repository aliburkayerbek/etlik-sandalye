$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : r.role === 'admin' ? '/admin' : '/personel';
  } catch (err) { toast($('#msg'), err.message); }
});
