/* Daftar pasien aktif + ringkasan statistik. */

import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { Store, UI, Charts, PrintDoc } from '../lib/index.js';
import { Badge } from '../components/ui.jsx';

export default function PatientListPage() {
  const { patients } = useData();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';

  /* Kotak cari milik halaman ini, bukan header.
     Alasannya: di ponsel kotak header disembunyikan supaya navbar cukup
     satu baris — dan kalau tidak ada gantinya di sini, pencarian akan
     hilang total di perangkat yang paling membutuhkannya. */
  function cari(e) {
    const v = e.target.value;
    const p = new URLSearchParams(params);
    if (v) p.set('q', v); else p.delete('q');
    setParams(p, { replace: true });
  }

  const s = Store.stats();
  const list = Store.search(q);

  function cetakDaftar() {
    Store.access('cetak', null, `Cetak daftar pasien aktif (${list.length} baris)`);
    PrintDoc.print({});
  }

  return (
    <main className="view" id="view-list">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Daftar Pasien</h1>
          <p className="page-head__sub">Kelola data pasien, dokumentasi luka, dan monitor perkembangan perawatan.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={cetakDaftar} title="Cetak seluruh daftar pasien aktif">Cetak Daftar Pasien</button>
          <button className="btn btn--primary" onClick={() => nav('/pasien-baru')}>+ Tambah Pasien</button>
        </div>
      </div>

      {/* Pencarian — SEBELUM kartu statistik, bukan di atas kartu "Daftar
          Pasien Aktif". Alasannya terukur: pada 390px keempat kartu
          statistik memakan 437px vertikal, sehingga kotak yang diletakkan
          tepat di atas kartu daftar jatuh di y=654 — jauh di bawah lipatan
          layar 844px. Di y=200 kotak ini masih terlihat; di y=654 sudah
          tidak, dan perawat harus menggulir untuk menemukannya. */}
      <div className="search-inline">
        <input
          type="search"
          value={q}
          onChange={cari}
          placeholder="Cari nama, no. RM, NIK, atau telepon…"
          aria-label="Cari pasien"
        />
      </div>

      <div className="grid grid--4" style={{ marginBottom: 20 }}>
        <div className="stat stat--primary">
          <div className="stat__label">Pasien Aktif</div>
          <div className="stat__value">{s.patients}</div>
          <div className="stat__foot">{s.visits} kunjungan tercatat</div>
        </div>
        <div className="stat">
          <div className="stat__label">Tren Membaik</div>
          <div className="stat__value" style={{ color: 'var(--c-ok)' }}>{s.healing}</div>
          <div className="stat__foot">pasien dengan skor turun</div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">Tanda Infeksi</div>
          <div className="stat__value">{s.infected}</div>
          <div className="stat__foot">pada kunjungan terakhir</div>
        </div>
        <div className="stat">
          <div className="stat__label">Kunjungan Berskor</div>
          <div className="stat__value">{s.scored}</div>
          <div className="stat__foot">dari {s.visits} total kunjungan</div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Daftar Pasien Aktif</h2>
          <span className="badge badge--muted">{list.length} pasien{q ? ' (difilter)' : ''}</span>
        </div>
        <div className="card__body" id="patient-table-host">
          {list.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Nama / No. RM</th><th>JK / Umur</th><th>Komorbid</th>
                    <th className="num-cell">Kunjungan</th><th>Terakhir</th>
                    <th>Skor Terakhir</th><th>Tren</th><th>Status Luka</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(p => <Row key={p.id} p={p} onOpen={() => nav(`/p/${p.id}`)} />)}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>{q ? 'Tidak ada pasien yang cocok' : 'Belum ada pasien'}</h3>
              <p>{q ? 'Coba kata kunci lain.' : 'Mulai dengan menambahkan pasien pertama.'}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ p, onOpen }) {
  const s = Store.summarize(p);
  const band = s.lastBand || null;

  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      <td>
        <strong>{p.identity.nama || '(Tanpa Nama)'}</strong>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{p.mrNumber}</div>
      </td>
      <td style={{ fontSize: 12.5 }}>{p.identity.jenisKelamin || '—'} · {UI.hitungUmur(p.identity.tglLahir) ?? '—'} th</td>
      <td style={{ fontSize: 12.5 }}>{UI.joinList(p.identity.komorbid, ', ', '—')}</td>
      <td className="num-cell">{s.total}</td>
      <td>{s.lastVisitDate ? UI.fmtDate(s.lastVisitDate) : <span style={{ color: 'var(--c-text-muted)' }}>—</span>}</td>
      <td>
        {s.lastScore !== null
          ? <><strong style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{s.lastScore}</strong>{' '}{band ? <Badge tone={band.tone}>{band.short}</Badge> : null}</>
          : <Badge tone="muted">Belum dinilai</Badge>}
      </td>
      <td><Badge tone={s.trend.tone}>{s.trend.text}</Badge></td>
      <td>{s.infectionSigns > 0 ? <Badge tone="danger">{s.infectionSigns} tanda</Badge> : (s.total ? <Badge tone="ok">Normal</Badge> : '—')}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Spark values={s.scored.map(x => x.score)} />
      </td>
    </tr>
  );
}

/* Sparkline digambar lewat ref karena Charts bekerja pada <canvas>. */
function Spark({ values }) {
  return (
    <canvas
      ref={el => { if (el) Charts.sparkline(el, values, { width: 72, height: 28, color: '#0f766e' }); }}
      width="72" height="28" className="spark"
    />
  );
}