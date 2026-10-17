/* ==========================================================
   TAB 1 — DATA PASIEN
   ----------------------------------------------------------
   Porting dari viewIdentitas() + refreshers.identitas() +
   wire() di assets/js/app.js (baris 1840-1926 & 3003-3011).

   Struktur, label, opsi dropdown, dan placeholder disalin
   apa adanya. Tiga hal yang perlu dijaga:

   1. Field / Check / ChipGroup menulis ke model lewat FieldProvider,
      jadi audit + "Tersimpan otomatis" tetap jalan.
   2. NIK butuh sanitasi "digit saja, maksimal 16" yang tidak
      bisa dinyatakan oleh <Field>, jadi kontrol itu memakai
      useBound() — hook milik Field itu sendiri, tetap lewat
      ctx.write() sehingga auditnya tidak hilang.
   3. Kolom yang hanya dibaca (No. RM, Umur) tidak pernah menulis,
      jadi tidak perlu binding sama sekali.

   Peringatan Alergi mengikuti refreshAlergi() di app.js lama:
   muncul hanya bila ada alergi tercatat DAN "Tidak ada riwayat
   alergi" tidak dicentang. Bedanya, kolom `lain` ikut dihitung —
   lihat komentar panjang di dalam KartuAlergi().
   ========================================================== */

import { FieldProvider, Field, Check, ChipGroup, Row, useBound } from '../core/field-binding.jsx';
import { Store, UI } from '../lib/index.js';
import { Callout } from '../components/ui.jsx';

/* ---------- Opsi klinis: salinan OPT.* di app.js lama ---------- */

const JANS = ['L', 'P'];

const HUBUNGAN = ['Diri Sendiri', 'Suami / Istri', 'Anak', 'Orang Tua', 'Saudara', 'Lainnya'];

const KOMORBID = ['Diabetes Mellitus', 'Hipertensi', 'Gagal Ginjal', 'Gagal Jantung',
  'Asma / COPD', 'Hepatitis', 'Kanker', 'Lainnya'];

/** selectField() di app.js lama selalu diawali pilihan kosong. */
function pilihan(options) {
  return [{ v: '', t: '— Pilih —' }].concat(options.map(o => ({ v: o, t: o })));
}

/* ---------- Kolom khusus ---------- */

/** Nomor rekam medis: readonly, gaya monospace. */
function KolomBaca({ label, value, hint = '', mono = false }) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <input
        type="text"
        readOnly
        value={value}
        style={mono ? { fontFamily: 'var(--font-mono)', background: 'var(--c-surface-2)' } : undefined}
      />
      {hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

/**
 * NIK — input dengan sanitasi.
 * wire() di app.js lama: nikInput.value = value.replace(/\D/g,'').slice(0,16)
 */
function KolomNik() {
  const { value, change, disabled } = useBound('identity.nik', 'NIK');
  const v = value === null || value === undefined ? '' : value;

  return (
    <div className="field">
      <label className="field__label" htmlFor="f-identity.nik">NIK</label>
      <input
        id="f-identity.nik"
        type="text"
        inputMode="numeric"
        placeholder="16 digit"
        disabled={disabled}
        value={v}
        onChange={e => change(e.target.value.replace(/\D/g, '').slice(0, 16))}
      />
    </div>
  );
}

/* ---------- Kartu 1 — Data Pasien ---------- */

function KartuPasien({ patient }) {
  const umur = UI.hitungUmur(patient.identity.tglLahir) ?? '';
  return (
    <div className="card">
      <div className="card__head"><span className="num">1</span><h2>Data Pasien</h2></div>
      <div className="card__body">

        <Row n={4}>
          <KolomBaca label="No. Rekam Medis" value={patient.mrNumber} mono />
          <KolomNik />
          <Field path="identity.tglLahir" label="Tanggal Lahir" type="date" />
          <KolomBaca label="Umur" value={umur} hint="Dihitung otomatis" />
        </Row>

        <Row n={2}>
          <div style={{ gridColumn: '1/-1' }}>
            <Field path="identity.nama" label="Nama Lengkap" placeholder="Sesuai KTP" required />
          </div>

          <ChipGroup path="identity.jenisKelamin" label="Jenis Kelamin" options={JANS} kind="radio" />

          <Field path="identity.tanggalMasuk" label="Tanggal Masuk" type="date" />

          <div style={{ gridColumn: '1/-1' }}>
            <Field
              path="identity.alamat"
              label="Alamat"
              rows={2}
              placeholder="Alamat lengkap sesuai domisili"
            />
          </div>

          <Field path="identity.telepon" label="No. HP / WhatsApp" type="tel" placeholder="08xxxxxxxxxx" />
          <Field path="identity.pekerjaan" label="Pekerjaan" />
        </Row>

      </div>
    </div>
  );
}

/* ---------- Kartu 1b — Kontak Darurat ---------- */

function KartuKontak() {
  return (
    <div className="card">
      <div className="card__head"><span className="num">1b</span><h2>Kontak Darurat</h2></div>
      <div className="card__body">
        <Row n={3}>
          <Field path="identity.kontakNama" label="Nama Kontak" />
          <Field
            path="identity.kontakHubungan"
            label="Hubungan"
            options={pilihan(HUBUNGAN)}
          />
          <Field path="identity.kontakTelepon" label="No. HP Kontak" type="tel" />
        </Row>
      </div>
    </div>
  );
}

/* ---------- Kartu 1c — Riwayat Alergi ---------- */

function KartuAlergi({ patient }) {
  const a = patient.identity.alergi || {};

  /*
   * refreshAlergi() di app.js lama:
   *   const ada = fAlergiObat.value.trim() || fAlergiDress.value.trim();
   *   allergyWarn.hidden = !ada || fTanpaAlergi.checked;
   *
   * Kolom "Lainnya" ikut dihitung di sini: kartu ini punya tiga
   * kolom alergi (obat / dressing / lain), jadi kalau hanya "lain"
   * yang terisi, pasien tetap harus melihat peringatan ini.
   */
  const ada = [a.obat, a.dressing, a.lain].some(x => String(x || '').trim() !== '');
  const tampilPeringatan = ada && !a.tidakAda;

  return (
    <div className="card">
      <div className="card__head"><span className="num">1c</span><h2>Riwayat Alergi</h2></div>
      <div className="card__body">

        <div style={{ marginBottom: 12 }}>
          <Check path="identity.alergi.tidakAda" label="Tidak ada riwayat alergi" />
        </div>

        <Row n={3}>
          <Field
            path="identity.alergi.obat"
            label="Alergi Obat"
            placeholder="contoh: Penisilin, Sulfa"
          />
          <Field
            path="identity.alergi.dressing"
            label="Alergi Dressing / Lateks"
            placeholder="contoh: Karet, Gam"
          />
          <Field path="identity.alergi.lain" label="Lainnya" />
        </Row>

        {tampilPeringatan ? (
          <Callout tone="danger">
            <strong>⚠ Peringatan Alergi</strong>
            Status ini akan tampil di kop setiap halaman cetak dan harus dikonfirmasi sebelum pemberian dressing atau antibiotik.
          </Callout>
        ) : null}

      </div>
    </div>
  );
}

/* ---------- Kartu 1d — Riwayat Komorbid ---------- */

function KartuKomorbid() {
  return (
    <div className="card">
      <div className="card__head"><span className="num">1d</span><h2>Riwayat Komorbid</h2></div>
      <div className="card__body">
        <ChipGroup
          path="identity.komorbid"
          label="Komorbid"
          options={KOMORBID}
          hint="Pilih lebih dari satu. Diabetes menjadi faktor risiko utama delayed healing."
        />

        <div style={{ marginTop: 12 }}>
          <Field
            path="identity.komorbidLain"
            label="Komorbid Lainnya"
            placeholder='Sebutkan bila memilih "Lainnya"'
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <Row n={2}>
            <Field path="identity.dpj" label="Dokter Penanggung Jawab" />
            <Field
              path="identity.penanggungJawab"
              label="Penanggung Jawab Pasien"
              placeholder="Nama di Boothort"
            />
          </Row>
        </div>

        <Field path="identity.catatan" label="Catatan Tambahan" />
      </div>
    </div>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function IdentitasTab({ patient, visit }) {
  /**
   * Dipanggil FieldProvider setiap ada nilai yang benar-benar berubah.
   * Padanan touch() di app.js lama: kolom identitas disimpan pada tabel
   * `patients`, jadi harus lewat Store.touch() — bukan touchVisit() seperti
   * kolom kunjungan.
   *
   * Indikator "Tersimpan otomatis" tidak diurus di sini. Ia menyala dari
   * markSaved() yang dipanggil field-binding.jsx, lalu dibaca oleh SaveState
   * di #visit-picker — sama seperti app.js lama yang juga hanya punya satu.
   */
  function onDerived() {
    Store.touch(patient);
  }

  if (!patient) {
    return (
      <div className="empty-state">
        <h3>Pasien tidak ditemukan</h3>
        <p>Data pasien tidak dapat dimuat.</p>
      </div>
    );
  }

  return (
    /*
     * visit sengaja dipasang null: seluruh kolom di tab ini adalah kolom
     * pasien (identity.*), bukan kolom kunjungan. Di app.js lama kolom
     * ini memakai data-bind sehingga menulis ke patients, tidak pernah
     * masuk audit kunjungan dan tetap bisa diedit walau kunjungan beku.
     * FieldProvider membaca `visit || patient`, jadi visit=null-lah
     * yang membuat tab ini menulis ke patients — sama seperti dulu.
     */
    <FieldProvider patient={patient} visit={null} onDerived={onDerived}>
      <div id="form-identitas">
        {/* Indikator "Siap / Tersimpan otomatis" TIDAK di sini. Di app.js lama
            hanya ada satu, di #visit-picker (baris 1499). Dua moniker membuat
            dua baris "Siap" muncul di tempat berbeda. */}
        <KartuPasien patient={patient} />
        <KartuKontak />
        <KartuAlergi patient={patient} />
        <KartuKomorbid />
      </div>
    </FieldProvider>
  );
}