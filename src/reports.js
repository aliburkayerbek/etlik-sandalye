// Rapor sorguları. Her rapor { title, columns:[{key,label}], rows:[...] } döner;
// aynı çıktı hem ekranda tablo/infografik hem de Excel/CSV dışa aktarma için kullanılır.
const { pool } = require('./db');
const { CHAIR_STATUS, FAULT_PARTS } = require('./config');

function range(q) {
  const to = q.to ? new Date(q.to + 'T23:59:59+03:00') : new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00+03:00') : new Date(to.getTime() - 7 * 864e5);
  return [from.toISOString(), to.toISOString()];
}

const TZ = "'Europe/Istanbul'";

const REPORTS = {
  // Hangi personel, hangi saat aralığında kaç teslim / iade yaptı
  personel: async (q) => {
    const [from, to] = range(q);
    const { rows } = await pool.query(
      `WITH ev AS (
         SELECT approved_by AS uid, approved_at AS t, 'teslim' AS tip FROM loans
          WHERE approved_at BETWEEN $1 AND $2 AND status <> 'reddedildi' AND approved_by IS NOT NULL
         UNION ALL
         SELECT return_approved_by, return_approved_at, 'iade' FROM loans
          WHERE return_approved_at BETWEEN $1 AND $2 AND return_approved_by IS NOT NULL)
       SELECT u.full_name AS personel, u.role AS rol, COALESCE(u.hospital_scope,'Tüm kampüs') AS kapsam,
              lpad(extract(hour FROM ev.t AT TIME ZONE ${TZ})::text,2,'0') || ':00-' ||
              lpad(((extract(hour FROM ev.t AT TIME ZONE ${TZ})::int + 1) % 24)::text,2,'0') || ':00' AS saat_araligi,
              count(*) FILTER (WHERE tip='teslim')::int AS teslim,
              count(*) FILTER (WHERE tip='iade')::int AS iade,
              count(*)::int AS toplam
         FROM ev JOIN users u ON u.id = ev.uid
        GROUP BY 1,2,3,4 ORDER BY 1,4`,
      [from, to]
    );
    return {
      title: 'Personel İşlem Raporu (saat aralığı bazında)',
      columns: [
        { key: 'personel', label: 'Personel' }, { key: 'rol', label: 'Rol' }, { key: 'kapsam', label: 'Kapsam' },
        { key: 'saat_araligi', label: 'Saat Aralığı' }, { key: 'teslim', label: 'Teslim' },
        { key: 'iade', label: 'İade' }, { key: 'toplam', label: 'Toplam' },
      ],
      rows,
    };
  },

  // Şu an hangi sandalye hangi durumda
  durum: async (q) => {
    const params = [];
    let where = 'WHERE c.active';
    if (q.hospital) { params.push(q.hospital); where += ` AND c.hospital=$${params.length}`; }
    if (q.status) { params.push(q.status); where += ` AND c.status=$${params.length}`; }
    const { rows } = await pool.query(
      `SELECT c.id_no, c.mahal, c.hospital, c.status,
              to_char(c.updated_at AT TIME ZONE ${TZ}, 'DD.MM.YYYY HH24:MI') AS son_degisiklik,
              l.from_department AS kullanim_bolumu
         FROM chairs c
         LEFT JOIN LATERAL (SELECT from_department FROM loans
                             WHERE chair_id=c.id_no AND status IN ('onay_bekliyor','kullanimda','iade_bekliyor')
                             ORDER BY id DESC LIMIT 1) l ON true
         ${where} ORDER BY c.id_no`,
      params
    );
    rows.forEach((r) => { r.durum = CHAIR_STATUS[r.status]; delete r.status; });
    return {
      title: 'Anlık Sandalye Durum Raporu',
      columns: [
        { key: 'id_no', label: 'ID No' }, { key: 'mahal', label: 'Tanımlı Mahal' }, { key: 'hospital', label: 'Hastane' },
        { key: 'durum', label: 'Durum' }, { key: 'kullanim_bolumu', label: 'Kullanıldığı Bölüm' },
        { key: 'son_degisiklik', label: 'Son Değişiklik' },
      ],
      rows,
    };
  },

  // En çok hangi parçada arıza bildirildi
  ariza_parca: async (q) => {
    const [from, to] = range(q);
    const { rows } = await pool.query(
      `SELECT p AS parca, count(*)::int AS adet,
              count(*) FILTER (WHERE stage='teslim_alma')::int AS teslim_almada,
              count(*) FILTER (WHERE stage='iade')::int AS iadede,
              count(*) FILTER (WHERE stage IN ('personel','admin'))::int AS personel_admin
         FROM fault_reports, unnest(parts) p
        WHERE created_at BETWEEN $1 AND $2 GROUP BY p ORDER BY adet DESC`,
      [from, to]
    );
    rows.forEach((r) => { r.parca = FAULT_PARTS[r.parca] || r.parca; });
    return {
      title: 'Arıza Raporu - Parça Bazında',
      columns: [
        { key: 'parca', label: 'Parça' }, { key: 'adet', label: 'Toplam Bildirim' },
        { key: 'teslim_almada', label: 'Teslim Almada' }, { key: 'iadede', label: 'İadede' },
        { key: 'personel_admin', label: 'Personel/Admin' },
      ],
      rows,
    };
  },

  // Hangi sandalyede (ID No / Tanımlı Mahal) arıza bildirildi
  ariza_sandalye: async (q) => {
    const [from, to] = range(q);
    const { rows } = await pool.query(
      `SELECT f.chair_id AS id_no, c.mahal, c.hospital, count(DISTINCT f.id)::int AS bildirim,
              string_agg(DISTINCT p, ', ') AS parcalar,
              count(DISTINCT f.id) FILTER (WHERE f.resolved_at IS NULL)::int AS acik,
              to_char(max(f.created_at) AT TIME ZONE ${TZ}, 'DD.MM.YYYY HH24:MI') AS son_bildirim
         FROM fault_reports f JOIN chairs c ON c.id_no=f.chair_id
         LEFT JOIN LATERAL unnest(f.parts) p ON true
        WHERE f.created_at BETWEEN $1 AND $2
        GROUP BY 1,2,3 ORDER BY bildirim DESC, son_bildirim DESC`,
      [from, to]
    );
    rows.forEach((r) => {
      r.parcalar = (r.parcalar || '').split(', ').filter(Boolean).map((k) => FAULT_PARTS[k] || k).join(', ');
    });
    return {
      title: 'Arıza Raporu - Sandalye Bazında',
      columns: [
        { key: 'id_no', label: 'ID No' }, { key: 'mahal', label: 'Tanımlı Mahal' }, { key: 'hospital', label: 'Hastane' },
        { key: 'bildirim', label: 'Bildirim' }, { key: 'parcalar', label: 'Parçalar' },
        { key: 'acik', label: 'Açık Arıza' }, { key: 'son_bildirim', label: 'Son Bildirim' },
      ],
      rows,
    };
  },

  // Hastane / Tanımlı Mahal / gidilen bölüm bazlı kullanım yoğunluğu
  kullanim: async (q) => {
    const [from, to] = range(q);
    const by = { hastane: 'c.hospital', mahal: 'c.mahal', bolum: "l.from_hospital || ' / ' || l.from_department" }[q.by] || 'c.hospital';
    const label = { hastane: 'Sandalyenin Hastanesi', mahal: 'Tanımlı Mahal', bolum: 'Gidilen Hastane / Bölüm' }[q.by] || 'Sandalyenin Hastanesi';
    const { rows } = await pool.query(
      `SELECT ${by} AS grup, count(*)::int AS odunc,
              round(avg(extract(epoch FROM (COALESCE(l.return_approved_at, now()) - l.approved_at))/60)::numeric, 0)::int AS ort_sure_dk
         FROM loans l JOIN chairs c ON c.id_no=l.chair_id
        WHERE l.approved_at BETWEEN $1 AND $2 AND l.status IN ('kullanimda','iade_bekliyor','tamamlandi')
        GROUP BY 1 ORDER BY odunc DESC`,
      [from, to]
    );
    return {
      title: `Kullanım Yoğunluğu - ${label}`,
      columns: [{ key: 'grup', label }, { key: 'odunc', label: 'Ödünç Sayısı' }, { key: 'ort_sure_dk', label: 'Ort. Kullanım (dk)' }],
      rows,
    };
  },
};

module.exports = { REPORTS };
