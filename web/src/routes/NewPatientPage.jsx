/* Formulir tambah pasien.
 *
 * Mengikuti alur app.js lama persis:
 *     const p = Store.addPatient(nama);
 *     isi p.identity.*  →  Store.touch(p)  →  Store.access('buat', …)
 *
 * Pasien BELUM ada di Store saat formulir ini dibuka, jadi kolomnya TIDAK
 * memakai FieldProvider — semuanya state lokal yang dilepas ke model
 * setelah pasien terbentuk.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, UI } from '../lib/index.js';
import { Callout } from '../components/ui.jsx';

/* Pilihan disalin apa adanya dari app.js lama. */
const OPSI_JANS = ['L', 'P'];
const OPSI_HUB = ['Diri Sendiri', 'Suami / Istri', 'Anak', 'Orang Tua', 'Saudara', 'Lainnya'];
const OPSI_KOMORBID = ['Diabetes Mellitus', 'Hipertensi', 'Gagal Ginjal', 'Gagal Jantung',
  'Asma / COPD', 'Hepatitis', 'Kanker', 'Lainnya'];
const OPSI_PEKERJAAN = ['Pensiunan', 'Wiraswasta', 'Karyawan Swasta', 'ASN', 'Guru', 'Ibu Rumah Tangga',
  'Petani', 'Buruh', 'Lainnya'];

export default function NewPatientPage() {
  const nav = useNavigate();
  const today = Store.today();
  const [f, setF] = useState({
    nama: '', nik: '', jk: '', lahir: '', alamat: '', telp: '',
    pekerjaan: '', masuk: today, dpj: '',
    kontakNama: '', kontakHub: '', kontakTelp: '',
    tanpaAlergi: false, alergiObat: '', alergiDress: '',
    komorbid: [], komorbidLain: ''
  });

  const set = k => e => setF({ ...f, [k]: e.target.value });
  const setCek = k => e => setF({ ...f, [k]: e.target.checked });

  function toggleKomorbid(v) {
    setF({ ...f, komorbid: f.komorbid.indexOf(v) >= 0
      ? f.komorbid.filter(x => x !== v)
      : f.komorbid.concat([v]) });
  }

  function nikBersih(v) {
    return String(v).replace(/\D/g, '').slice(0, 16);
  }

  const adaAlergi = !!(f.alergiObat.trim() || f.alergiDress.trim()) && !f.tanpaAlergi;
  const mrPreview = `Nomor rekam medis otomatis: RM-${new Date().getFullYear()}-${String(Store.activePatients().length + 1).padStart(4, '0')}`;

  function simpan() {
    const nama = f.nama.trim();
    if (!nama) { UI.toast('Nama pasien wajib diisi', 'danger'); return; }
    if (f.nik && f.nik.length !== 16) { UI.toast('NIK harus 16 digit', 'warn'); return; }

    const p = Store.addPatient(nama);
    const id = p.identity;
    id.nik = f.nik.trim();
    id.jenisKelamin = f.jk;
    id.tglLahir = f.lahir;
    id.alamat = f.alamat.trim();
    id.telepon = f.telp.trim();
    id.pekerjaan = f.pekerjaan;
    id.tanggalMasuk = f.masuk || today;
    id.dpj = f.dpj.trim();
    id.kontakNama = f.kontakNama.trim();
    id.kontakHubungan = f.kontakHub;
    id.kontakTelepon = f.kontakTelp.trim();
    id.alergi = {
      tidakAda: f.tanpaAlergi,
      obat: f.alergiObat.trim(),
      dressing: f.alergiDress.trim(),
      latex: '', lain: ''
    };
    id.komorbid = f.komorbid.slice();
    id.komorbidLain = f.komorbidLain.trim();

    Store.touch(p);
    Store.access('buat', p, 'Pasien baru dibuat');
    UI.toast(`Pasien ${p.mrNumber} disimpan`, 'ok');
    nav(`/p/${p.id}`);
  }

  return (
    <main className="view">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Tambah Pasien Baru</h1>
          <p className="page-head__sub">Data dasar pasien. Kunjungan pertama dibuat setelah ini.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>← Kembali</button>
        </div>
      </div>

      <Seksi judul="Identitas">
        <div className="form-row form-row--3">
          <div style={{ gridColumn: 'span 2' }}>
            <Txt label="Nama Lengkap *" value={f.nama} onChange={set('nama')} placeholder="Nama lengkap sesuai KTP" />
            <div className="field__hint" style={{ fontFamily: 'var(--font-mono)' }}>{mrPreview}</div>
          </div>
          <Txt label="NIK" value={f.nik} onChange={e => setF({ ...f, nik: nikBersih(e.target.value) })} placeholder="16 digit NIK" inputMode="numeric" />
          <Pilih label="Jenis Kelamin" value={f.jk} onChange={set('jk')} options={OPSI_JANS} placeholder="— Pilih —" />
          <Txt label="Tanggal Lahir" type="date" value={f.lahir} onChange={set('lahir')} />
          <Txt label="Umur" value={UI.hitungUmur(f.lahir) ?? '—'} readOnly hint="Dihitung otomatis" />
          <div style={{ gridColumn: '1/-1' }}>
            <Area label="Alamat" value={f.alamat} onChange={set('alamat')} placeholder="Alamat lengkap sesuai domisili" />
          </div>
          <Txt label="No. HP / WhatsApp" type="tel" value={f.telp} onChange={set('telp')} placeholder="08xxxxxxxxxx" />
          <Pilih label="Pekerjaan" value={f.pekerjaan} onChange={set('pekerjaan')} options={OPSI_PEKERJAAN} placeholder="— Pilih —" />
          <Txt label="Tanggal Masuk" type="date" value={f.masuk} onChange={set('masuk')} />
          <Txt label="Dokter Penanggung Jawab" value={f.dpj} onChange={set('dpj')} placeholder="Nama dokter penanggung jawab" />
        </div>
      </Seksi>

      <Seksi judul="Kontak Darurat">
        <div className="form-row form-row--3">
          <Txt label="Nama Kontak" value={f.kontakNama} onChange={set('kontakNama')} placeholder="Nama orang yang bisa dihubungi" />
          <Pilih label="Hubungan" value={f.kontakHub} onChange={set('kontakHub')} options={OPSI_HUB} placeholder="— Pilih —" />
          <Txt label="No. HP Kontak" type="tel" value={f.kontakTelp} onChange={set('kontakTelp')} placeholder="08xxxxxxxxxx" />
        </div>
      </Seksi>

      <Seksi judul="Riwayat Alergi">
        <label className="chip" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={f.tanpaAlergi} onChange={setCek('tanpaAlergi')} />
          <span className="chip__dot"></span>
          <span>Tidak ada riwayat alergi</span>
        </label>
        <div className="form-row form-row--2">
          <Txt label="Alergi Obat" value={f.alergiObat} onChange={set('alergiObat')} placeholder="contoh: Penisilin, Sulfa" />
          <Txt label="Alergi Dressing / Lateks" value={f.alergiDress} onChange={set('alergiDress')} placeholder="contoh: Karet, Gam, Perekat" />
        </div>
        {adaAlergi ? (
          <Callout tone="danger">
            <strong>Peringatan Alergi</strong>
            Alergi ini akan tercetak pada setiap formulir.
          </Callout>
        ) : null}
      </Seksi>

      <Seksi judul="Riwayat Komorbid">
        <div className="chips">
          {OPSI_KOMORBID.map(k => (
            <label key={k} className="chip">
              <input type="checkbox" checked={f.komorbid.indexOf(k) >= 0} onChange={() => toggleKomorbid(k)} />
              <span className="chip__dot"></span>
              <span>{k}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Txt label="Komorbid Lainnya" value={f.komorbidLain} onChange={set('komorbidLain')} placeholder='Bila memilih "Lainnya"' />
        </div>
        <div className="field__hint" style={{ marginTop: 8 }}>
          Diabetes menjadi faktor risiko utama untuk penyembuhan luka yang lambat.
        </div>
      </Seksi>

      <div className="btn-group">
        <button className="btn btn--primary" onClick={simpan}>Simpan</button>
        <button className="btn" onClick={() => nav('/')}>Batal</button>
      </div>
    </main>
  );
}

/* ---------- potongan kecil ---------- */

function Seksi({ judul, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__body">{children}</div>
    </div>
  );
}

function Txt({ label, value, onChange, type = 'text', hint, placeholder, readOnly, inputMode }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <input type={type} value={value} placeholder={placeholder} readOnly={readOnly}
             inputMode={inputMode} onChange={onChange} />
      {hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

function Area({ label, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <textarea rows={2} value={value} placeholder={placeholder} onChange={onChange} />
    </div>
  );
}

function Pilih({ label, value, onChange, options, placeholder }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <select value={value} onChange={onChange}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}