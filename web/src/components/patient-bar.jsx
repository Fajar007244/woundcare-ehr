/* Bar identitas pasien + pemilih kunjungan.
 *
 * Markup-nya disalin apa adanya dari renderPatientBar() dan
 * renderVisitPicker() di assets/js/app.js:
 *
 *   .patient-bar          → tombol kembali, avatar, info, btn-group, aksi
 *   .patient-bar__avatar  → anak LANGSUNG .patient-bar (bukan di dalam __info)
 *   .patient-bar__info    → .patient-bar__name (div) + .patient-bar__meta
 *   .btn-group            → Riwayat Akses + badge skor + badge tren
 *   .patient-bar__actions → + Kunjungan Baru, Cetak Rekam Medis
 *
 * Pemilih kunjungan (Kunjungan aktif, Riwayat, Bekuan, Duplikasi, Hapus,
 * dan indikator "Siap / Tersimpan otomatis") ada di sini juga — bukan di
 * patient-bar. Versi React sebelumnya menaruh Bekuan dan SaveState di
 * patient-bar, sehingga urutannya tidak sama.
 */

import { Store, UI, PrintDoc } from '../lib/index.js';
import { useData } from '../core/data.jsx';
import { SaveState } from '../core/save-signal.jsx';
import { Badge } from '../components/ui.jsx';

const isAdmin = () => {
  const u = Store.user;
  return !!(u && u.peran === 'Admin');
};

/* ---------------- Bar identitas ---------------- */

export function PatientBar({ patient, visit, onBack, onNewVisit, onOpenAccessLog }) {
  const s = Store.summarize(patient);
  const id = patient.identity;

  return (
    <div className="patient-bar" id="patient-bar">
      <button className="btn btn--sm btn--ghost" onClick={onBack} title="Kembali ke daftar">← Daftar</button>

      <div className="patient-bar__avatar">{UI.initials(id.nama)}</div>

      <div className="patient-bar__info">
        <div className="patient-bar__name">{id.nama || '(Tanpa Nama)'}</div>
        {/* Dibangun sebagai satu string: JSX memangkas spasi di antara
            ekspresi pada baris berbeda, sehingga "· L" jadi "·L".
            No. RM tetap monospace, jadi dikisahkan dari sisanya. */}
        <div className="patient-bar__meta">
          <span style={{ fontFamily: 'var(--font-mono)' }}>{patient.mrNumber}</span>
          {' · '}
          {[
            id.jenisKelamin || '?',
            `${UI.hitungUmur(id.tglLahir) ?? '?'} th`,
            `${s.total} kunjungan`,
            s.lastVisitDate ? `terakhir ${UI.fmtDate(s.lastVisitDate)}` : ''
          ].filter(Boolean).join(' · ')}
          {/* Jejak akses dipisah supaya bisa disembunyikan di ponsel.
              Di layar lebar teksnya persis sama seperti sebelumnya; di
              ponsel disembunyikan karena information yang sama sudah ada
              di tombol "Riwayat Akses" satu baris di bawahnya, dan
             meta yang memanjang membuat bar tumbuh 3-4 baris. */}
          {patient.lastAccess ? (
            <span className="patient-bar__access">{' · '}dibuka {patient.lastAccess.oleh}, {UI.fmtDate(String(patient.lastAccess.pada).slice(0, 10))}</span>
          ) : null}
        </div>
      </div>

      <div className="btn-group">
        {isAdmin() ? (
          <button className="btn btn--sm" onClick={onOpenAccessLog} title="Riwayat akses rekam medis ini">
            Riwayat Akses
          </button>
        ) : null}
        {s.lastScore !== null
          ? <Badge tone={s.lastBand.tone}>Skor {s.lastScore} · {s.lastBand.short}</Badge>
          : <Badge tone="muted">Belum dinilai</Badge>}
        <Badge tone={s.trend.tone}>{s.trend.text}</Badge>
      </div>

      <div className="patient-bar__actions">
        <button className="btn btn--sm btn--primary" onClick={onNewVisit}>+ Kunjungan Baru</button>
        <button className="btn btn--sm" onClick={() => {
          Store.access('cetak', patient, 'Cetak rekam medis');
          PrintDoc.print({ patientId: patient.id, visitId: visit && visit.id, range: 'all' });
        }}>Cetak Rekam Medis</button>
      </div>
    </div>
  );
}

/* ---------------- Pemilih kunjungan ---------------- */

/* #visit-picker di aplikasi lama adalah <div id="visit-picker"> telanjang —
   tanpa kelas .card. Verified via getComputedStyle: border 0px. Isi di
   dalamnya tetap .card__body, sama seperti hasil renderVisitPicker().
   Karena tidak ada kelas, jarak antar-bagian datang dari margin-bottom
   milik .patient-bar dan .tabs, bukan dari #visit-picker. */
export function VisitPicker({ patient, visit, onPick, onNewVisit, onToggleFreeze, onDuplicate, onDelete, onOpenAudit }) {
  const visits = patient.visits;

  if (!visits.length) {
    /* Kasus kosong juga tidak dibungkus .card__body di app.js lama. */
    return (
      <div id="visit-picker">
        <div className="callout callout--warn">
          <strong>Belum ada kunjungan</strong>
          Klinis belum dapat dinilai. Buat kunjungan pertama untuk mulai mengisi pengkajian, foto, dan skor WINNER.
        </div>
        <button className="btn btn--primary" style={{ marginTop: 12 }} onClick={onNewVisit}>
          + Buat Kunjungan Pertama
        </button>
      </div>
    );
  }

  const jumlahAudit = visit ? (visit.audit || []).length : 0;

  return (
    <div id="visit-picker">
      <div className="card__body" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 320px', maxWidth: 420 }}>
            <span className="field__label">Kunjungan aktif</span>
            <select value={visit ? visit.id : ''} onChange={e => onPick(e.target.value)}>
              {visits.slice().reverse().map(v => {
                const sc = v.winner && v.winner.total;
                const n = (v.audit || []).length;
                const tanda = [v.frozen ? '❄ bekuan' : '', n ? `${n} perubahan` : ''].filter(Boolean).join(' · ');
                return (
                  <option key={v.id} value={v.id}>
                    {UI.fmtDateTime(v.date, v.time)}
                    {sc ? ` — skor ${sc}` : ' — belum dinilai'}
                    {tanda ? ' · ' + tanda : ''}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button className="btn btn--sm" onClick={onOpenAudit} title="Lihat riwayat perubahan">
              Riwayat{jumlahAudit ? <span className="mini-badge">{jumlahAudit}</span> : null}
            </button>
            <button className="btn btn--sm" onClick={onToggleFreeze}
                    title="Bekukan agar data tidak bisa diubah">
              {visit && visit.frozen ? '❄ Buka Bekuan' : '❄ Bekuan'}
            </button>
            <button className="btn btn--sm" onClick={onDuplicate}
                    title="Duplikasi kunjungan ini untuk pengisian cepat">Duplikasi</button>
            {isAdmin() ? (
              <button className="btn btn--sm btn--danger" onClick={onDelete}>Hapus Kunjungan</button>
            ) : null}
          </div>

          {/* margin-top ikut app.js lama agar sejajar dengan bar tombol */}
          <SaveState style={{ marginTop: 22 }} />
        </div>
      </div>
    </div>
  );
}