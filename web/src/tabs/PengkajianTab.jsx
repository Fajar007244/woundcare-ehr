/* ==========================================================
   TAB 3 — PENGKAJIAN LUKA
   ----------------------------------------------------------
   Porting dari viewPengkajian() + refreshArea() +
   refreshTissueSum() + refreshNrs() + refreshInfection() +
   refreshers.pengkajian di assets/js/app.js
   (baris 2020-2214 dan 3044-3070).

   Struktur, label, opsi dropdown, dan teks turunan disalin
   apa adanya. Yang perlu dijaga:

   1. Semua kolom di sini adalah kolom KUNJUNGAN. Di app.js lama
      semuanya memakai data-vbind, jadi audit + touchVisit
      + syncAudit tetap jalan lewat FieldProvider, dan otomatis
      terkunci saat kunjungan dibekukan. Jangan dipaksa
      `visit={null}` — itu membuat kolom-kolom ini jatuh
      ke tabel patients dan hilang jejaknya.

      Pengecualian satu: `perawat`. Prefix-nya tidak ada di
      VISIT_PREFIX sehingga default-nya 'patient', padahal di
      app.js lama kolom ini jelas milik kunjungan
      (defaultVisit() di store.js menginisialisasinya di visit).
      Jadi prop scope="visit" dipasang eksplisit di situ — itu
      jalur resmi yang disediakan FieldProvider, bukan patch.

   2. Empat nilai turunan (luas luka, jumlah jaringan, level
      NRS, peringatan infeksi) TIDAK disimpan ke model. Di app.js
      lama semuanya dihitung ulang oleh refresh*(); di sini
      juga dihitung ulang dari model, lalu di-cache dengan useMemo
      memakai penghitung versi yang dinaikkan onDerived — padanan
      refreshDerived(path).

   3. Tombol "Normalisasi ke 100%" dan "Kosongkan" di app.js lama
      menulis langsung ke model (setPath), sehingga jejaknya
      hilang. Di sini keduanya menulis lewat ctx.write() supaya
      audit tetap tercatat.
   ========================================================== */

import { useMemo, useState } from 'react';

import {
  FieldProvider, Field, Check, ChipGroup, Row,
  useBound, useFieldCtx
} from '../core/field-binding.jsx';
import { Scales, UI } from '../lib/index.js';
import { Callout, EmptyState } from '../components/ui.jsx';

/* ---------- Opsi klinis: salinan OPT.* di app.js lama ---------- */

const ETIOLOGI = ['Diabetes Mellitus (Diabetic Foot Ulcer)', 'Dekubitus', 'Luka Bakar',
  'Venous Ulcer', 'Arterial Ulcer', 'Trauma / Post-Op', 'Lainnya'];

const SISI = ['Kanan', 'Kiri', 'Tengah / Bilateral'];

/* Tiga daftar di bawah disalin dari formulir RM. 03.1 PENGKAJIAN LUKA
   (Wocare Center, Bogor) — urutannya menentukan skor 1..5 pada WINNER. */
const TEPI = [
  'Samar, tidak jelas terlihat',
  'Batas tepi terlihat, menyatu dengan dasar luka',
  'Jelas, tidak menyatu dengan dasar luka',
  'Jelas, tidak menyatu dengan dasar luka, tebal',
  'Jelas, fibrotik, parut tebal / hiperkeratotik'
];

const EKS_JUMLAH = ['Kering', 'Moist', 'Sedikit', 'Sedang', 'Banyak'];

const EKS_TIPE = ['Bloody', 'Serosanguineous', 'Serous', 'Purulent'];

const BAU = ['Tidak Berbau', 'Berbau Ringan', 'Sangat Berbau'];

const TIME = ['Kalor', 'Dolor', 'Rubor', 'Tumor', 'Functio Laesa'];

const ISKEMIA = ['Tidak ada', 'Ragu-ragu', 'Ya (kaki dingin, pucat, tidak berkeringat)'];

/* Opsi inline di selectField() app.js lama untuk arah gua. */
const ARAH_JAM = ['00 – 03', '03 – 06', '06 – 09', '09 – 12',
  '12 – 15', '15 – 18', '18 – 21', '21 – 00'];

/* ---------- TISSUE_META: salinan utuh dari app.js lama ---------- */

const TISSUE_META = {
  nekrotik:  { label: 'Nekrotik (Hitam)',      color: '#3f3f46', short: 'Nekrotik' },
  slough:    { label: 'Slough (Kuning/Hijau)', color: '#ca8a04', short: 'Slough' },
  granulasi: { label: 'Granulasi (Merah)',    color: '#dc2626', short: 'Granulasi' },
  epitel:    { label: 'Epitelisasi (Pink)',   color: '#f9a8d4', short: 'Epitelisasi' }
};

/** selectField() di app.js lama selalu diawali pilihan kosong. */
function pilihan(options, placeholder = '— Pilih —') {
  return [{ v: '', t: placeholder }].concat(options.map(o => ({ v: o, t: o })));
}

/* ---------- Nilai turunan ---------- */

/**
 * Padanan refreshArea() + refreshTissueSum() + refreshNrs() +
 * refreshInfection() digabung jadi satu fungsi.
 *
 * Semuanya membaca dari visit.wound; tidak ada yang menulis
 * ke model — persis seperti di app.js lama.
 */
function hitungTurunan(visit) {
  const w = (visit && visit.wound) || {};

  const jaringan = w.jaringan || {};
  const sum = Scales.tissueSum(jaringan) || 0;

  const n = Number(w.nrs) || 0;
  const level = n === 0 ? 'tidak' : n <= 3 ? 'ringan' : n <= 6 ? 'sedang' : 'berat';

  const time = Array.isArray(w.time) ? w.time : [];

  return {
    area: Scales.areaCm2(w.ukuran),      // refreshArea()
    jaringan,
    sum,                                // refreshTissueSum()
    nrs: n,                             // refreshNrs()
    level,
    levelLabel: { tidak: 'Tidak nyeri', ringan: 'Nyeri ringan', sedang: 'Nyeri sedang', berat: 'Nyeri berat' }[level],
    jumlahTime: time.length             // refreshInfection()
  };
}

/* ---------- Kartu 3 — Pengkajian Luka ---------- */

/** Kolom turunan "Luas Luka" — isi dari refreshArea(). */
function KolomLuas({ area }) {
  return (
    <div className="field">
      <label className="field__label">Luas Luka</label>
      <div
        id="area-display"
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700,
          padding: '7px 10px', background: 'var(--c-primary-soft)',
          color: 'var(--c-primary-dark)', borderRadius: 'var(--r-sm)'
        }}
      >
        {area === null ? '— cm²' : `${area} cm²`}
      </div>
      <div className="field__hint">Dihitung dari panjang × lebar</div>
    </div>
  );
}

/* ---------- Kartu 3b — Tipe Jaringan Dasar Luka ---------- */

/** Satu kolom persentase jaringan, dengan kotak warna pembeda. */
function KolomJaringan({ kunci }) {
  const meta = TISSUE_META[kunci];
  const { value, change, disabled } = useBound(`wound.jaringan.${kunci}`, meta.label, { mode: 'number' });
  const v = value === null || value === undefined ? '' : value;

  return (
    <div className="field">
      <label className="field__label" htmlFor={`f-wound.jaringan.${kunci}`}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: 3,
            background: meta.color, marginRight: 6, verticalAlign: 0
          }}
        ></span>
        {meta.label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id={`f-wound.jaringan.${kunci}`}
          type="number"
          min="0"
          max="100"
          step="1"
          placeholder="0"
          style={{ flex: 1 }}
          disabled={disabled}
          value={v}
          onChange={e => change(e.target.value)}
        />
        <span style={{ fontWeight: 700 }}>%</span>
      </div>
    </div>
  );
}

/** Batang proporsi — isi dari refreshTissueSum(). */
function TissueBar({ jaringan }) {
  const bagian = Scales.TISSUE_KEYS
    .map(k => ({ k, v: Number(jaringan && jaringan[k]) || 0 }))
    .filter(x => x.v > 0);

  return (
    <div
      id="tissue-bar"
      style={{
        display: 'flex', height: 26, borderRadius: 'var(--r-sm)', overflow: 'hidden',
        border: '1px solid var(--c-border)', background: 'var(--c-surface-2)'
      }}
    >
      {bagian.length ? bagian.map(x => (
        <div
          key={x.k}
          title={`${TISSUE_META[x.k].label}: ${x.v}%`}
          style={{
            width: `${Math.min(100, x.v)}%`, background: TISSUE_META[x.k].color,
            display: 'grid', placeItems: 'center', color: '#fff',
            fontSize: 10.5, fontWeight: 700
          }}
        >
          {x.v}%
        </div>
      )) : (
        <div style={{ width: '100%', display: 'grid', placeItems: 'center', color: 'var(--c-text-muted)', fontSize: 11.5 }}>
          Belum diisi
        </div>
      )}
    </div>
  );
}

/** Keterangan total jaringan — isi dari refreshTissueSum(). */
function TissueSum({ sum }) {
  if (sum === 0) return <div id="tissue-sum" className="field__hint">Isi keempat persentase jaringan dasar luka.</div>;

  if (sum === 100) {
    return (
      <div id="tissue-sum" className="field__hint">
        <b style={{ color: 'var(--c-ok)' }}>✓ Total tepat 100%</b>
      </div>
    );
  }

  return (
    <div id="tissue-sum" className="field__hint">
      Total{' '}
      <b style={{ color: sum > 100 ? 'var(--c-danger)' : 'var(--c-warn)' }}>{sum}%</b>
      {' '}— {sum > 100 ? 'melebihi' : 'kurang dari'} 100%. Gunakan &quot;Normalisasi&quot;.
    </div>
  );
}

function KartuJaringan({ jaringan, sum }) {
  const ctx = useFieldCtx();

  /*
   * btn-normalize-tissue di app.js lama:
   *   sum = Scales.tissueSum(...);  kalau 0 → toast & bail
   *   v.wound.jaringan = Scales.normalizeTissue(v.wound.jaringan)
   *   Store.touchVisit(...); hydrate(...); refreshTissueSum()
   *
   * Bedanya di sini: assignment langsung diganti ctx.write() per
   * kolom supaya normalisasi ikut masuk audit, dan hydrate()
   * tidak diperlukan karena React yang menggambar ulang.
   */
  async function normalisasi() {
    const sekarang = ctx.read('wound.jaringan') || {};
    const total = Scales.tissueSum(sekarang);

    if (!total) {
      UI.toast('Isi persentase jaringan terlebih dahulu', 'warn');
      return;
    }

    const out = Scales.normalizeTissue(sekarang);
    for (const k of Scales.TISSUE_KEYS) {
      const ok = await ctx.write(`wound.jaringan.${k}`, String(out[k]), {
        label: TISSUE_META[k].label,
        mode: 'number',
        before: ctx.read(`wound.jaringan.${k}`)
      });
      if (!ok) return;      // dibekukan atau dibatalkan konfirmasi berisiko
    }

    UI.toast('Persentase dinormalisasi ke 100%', 'ok');
  }

  /* btn-clear-tissue di app.js lama: setiap key dibikin ''. */
  async function kosongkan() {
    for (const k of Scales.TISSUE_KEYS) {
      const ok = await ctx.write(`wound.jaringan.${k}`, '', {
        label: TISSUE_META[k].label,
        mode: 'number',
        before: ctx.read(`wound.jaringan.${k}`)
      });
      if (!ok) return;
    }
  }

  return (
    <div className="card">
      <div className="card__head"><span className="num">3b</span><h2>Tipe Jaringan Dasar Luka</h2></div>
      <div className="card__body">

        <div className="form-row form-row--4">
          {Scales.TISSUE_KEYS.map(k => <KolomJaringan key={k} kunci={k} />)}
        </div>

        <TissueBar jaringan={jaringan} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <TissueSum sum={sum} />
          <div className="btn-group">
            <button
              className="btn btn--sm"
              id="btn-normalize-tissue"
              disabled={ctx.frozen}
              title={ctx.frozen ? 'Kunjungan dibekukan' : undefined}
              onClick={normalisasi}
            >
              Normalisasi ke 100%
            </button>
            <button
              className="btn btn--sm btn--ghost"
              id="btn-clear-tissue"
              disabled={ctx.frozen}
              title={ctx.frozen ? 'Kunjungan dibekukan' : undefined}
              onClick={kosongkan}
            >
              Kosongkan
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ---------- Kartu 3c — Eksudat, Bau, Infeksi & Nyeri ---------- */

/** Penggeser NRS 0–10..Range tidak punya padanan di <Field>. */
function SkorNyeri({ nilai, level, label }) {
  const { value, change, disabled } = useBound('wound.nrs', 'Skala Nyeri (NRS 0–10)', { mode: 'number' });
  const v = value === null || value === undefined ? 0 : Number(value) || 0;

  return (
    <div className="range-wrap">
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        id="nrs-range"
        disabled={disabled}
        value={v}
        onChange={e => change(e.target.value)}
      />
      <div className="range-val" id="nrs-val" data-level={level} title={label}>
        {nilai} / 10
      </div>
    </div>
  );
}

function KartuNyeriInfeksi({ turunan }) {
  return (
    <div className="card">
      <div className="card__head"><span className="num">3c</span><h2>Eksudat, Bau, Infeksi &amp; Nyeri</h2></div>
      <div className="card__body">

        <Row n={2}>
          <ChipGroup path="wound.eksudat.jumlah" label="Jumlah Eksudat" options={EKS_JUMLAH} kind="radio" />
          <ChipGroup path="wound.eksudat.tipe" label="Tipe Eksudat" options={EKS_TIPE} kind="radio" />
        </Row>

        <div className="form-row form-row--2" style={{ marginTop: 14 }}>
          <ChipGroup path="wound.bau" label="Bau Luka" options={BAU} kind="radio" />
          <ChipGroup path="wound.iskemia" label="Iskemia / Perfusi" options={ISKEMIA} kind="radio" />
        </div>

        <fieldset style={{ margin: '16px 0' }}>
          <legend>Tanda-tanda Infeksi (TIME)</legend>
          <ChipGroup path="wound.time" label="" options={TIME} />

          {/* refreshInfection(): node tersembunyi selama tanda TIME < 2 */}
          {turunan.jumlahTime >= 2 ? (
            <div style={{ marginTop: 10 }}>
              <Callout tone="danger">
                <strong>⚠ Gejala Infeksi Terdeteksi</strong>
                Minimal 2 tanda TIME positif disertai (atau lebih)+ menunjukkan kemungkinan infeksi luka.
                Pertimbangkan kultur luka, review antibiotik, dan rujukan bila tidak membaik dalam 48 jam.
              </Callout>
            </div>
          ) : null}
        </fieldset>

        <fieldset style={{ margin: '16px 0', padding: 14, border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
          <legend>Skala Nyeri (NRS 0–10)</legend>
          <SkorNyeri nilai={turunan.nrs} level={turunan.level} label={turunan.levelLabel} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>
            <span>0 = Tidak nyeri</span><span>5 = Sedang</span><span>10 = Sangat nyeri</span>
          </div>
        </fieldset>

        {/* app.js lama menulis rows="3" ke sebuah <input> (atributnya
            tidak ada artinya di situ); di sini dipakai rows pada
            textarea agar isinya bisa mehrere baris seperti maksudnya. */}
        <Field path="wound.catatan" label="Catatan Klinis" rows={3} />

        <Field
          path="perawat"
          label="Perawat Penanggung Jawab"
          placeholder="Ns. Nama, S.Kep"
          scope="visit"
        />

      </div>
    </div>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function PengkajianTab({ patient, visit }) {
  /*
   * Penghitung versi per kelompok turunan — padanan refreshDerived()
   * di app.js lama. Dipakai sebagai dependensi useMemo supaya nilai
   * turunan benar-benar dihitung ulang hanya ketika kelompoknya berubah,
   * persis seperti refreshArea/refreshTissueSum/refreshNrs/
   * refreshInfection yang dipanggil sesuai awalan path.
   */
  const [rev, setRev] = useState({ jaringan: 0, ukuran: 0, nrs: 0, time: 0 });

  function onDerived(path) {
    const p = String(path || '');
    setRev(r => {
      const n = Object.assign({}, r);
      let kena = false;
      if (p.startsWith('wound.jaringan')) { n.jaringan += 1; kena = true; }
      if (p.startsWith('wound.ukuran'))  { n.ukuran  += 1; kena = true; }
      if (/nrs$/.test(p))                { n.nrs     += 1; kena = true; }
      if (p.startsWith('wound.time'))    { n.time    += 1; kena = true; }
      return kena ? n : r;
    });
  }

  const turunan = useMemo(
    () => hitungTurunan(visit),
    [visit, rev.jaringan, rev.ukuran, rev.nrs, rev.time]
  );

  if (!patient) {
    return (
      <EmptyState icon="🔎" title="Pasien tidak ditemukan">
        Data pasien tidak dapat dimuat.
      </EmptyState>
    );
  }

  if (!visit) {
    return (
      <EmptyState icon="📋" title="Belum ada kunjungan">
        Pengkajian luka dicatat per kunjungan. Tambahkan kunjungan baru terlebih dahulu
        memakai tombol &quot;+ Kunjungan Baru&quot; di bagian atas.
      </EmptyState>
    );
  }

  return (
    /* visit sengaja diteruskan apa adanya: seluruh kolom tab ini
     * (wound.*, date, time, perawat) adalah kolom kunjungan, sama
     * seperti data-vbind di app.js lama. Audit + lock saat beku
     * datang gratis dari FieldProvider. */
    <FieldProvider patient={patient} visit={visit} onDerived={onDerived}>
      <div id="form-pengkajian">

        <div className="card">
          <div className="card__head"><span className="num">3</span><h2>Pengkajian Luka</h2></div>
          <div className="card__body">

            <div className="form-row form-row--4" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
              <Field path="date" label="Tanggal Kunjungan" type="date" />
              <Field path="time" label="Jam" type="time" />
            </div>

            <fieldset style={{ marginBottom: 16 }}>
              <ChipGroup path="wound.etiologi" label="Etiologi Luka" options={ETIOLOGI} />
              <div style={{ marginTop: 10 }}>
                <Field
                  path="wound.etiologiLain"
                  label="Etiologi Lainnya"
                  placeholder="Bila memilih Lainnya"
                />
              </div>
            </fieldset>

            <Row n={2}>
              <Field
                path="wound.lokasi"
                label="Lokasi Luka"
                placeholder="contoh: Telapak kaki kanan, plantar aspect"
              />
              <ChipGroup path="wound.lokasiSisi" label="Sisi" options={SISI} kind="radio" />
            </Row>

            <fieldset style={{ margin: '16px 0', padding: 14, border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
              <legend>Ukuran Luka</legend>
              <div className="form-row form-row--4">
                <Field path="wound.ukuran.panjang" label="Panjang (cm)" type="number" step="0.1" min="0" />
                <Field path="wound.ukuran.lebar" label="Lebar (cm)" type="number" step="0.1" min="0" />
                <Field path="wound.ukuran.kedalaman" label="Kedalaman (cm)" type="number" step="0.1" min="0" />
                <KolomLuas area={turunan.area} />
              </div>
            </fieldset>

            <fieldset style={{ margin: '16px 0', padding: 14, border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
              <legend>Gua / Tunnelling</legend>
              <div style={{ marginBottom: 12 }}>
                <Check path="wound.undermining.ada" label="Terdapat gua / undermining" />
              </div>
              <Row n={3}>
                <Field
                  path="wound.undermining.arahJam"
                  label="Arah (jam)"
                  options={pilihan(ARAH_JAM, '— Arah —')}
                />
                <Field
                  path="wound.undermining.kedalaman"
                  label="Kedalaman Gua (cm)"
                  type="number"
                  step="0.1"
                  min="0"
                />
                <Field
                  path="wound.undermining.lokasi"
                  label="Lokasi Gua"
                  placeholder="contoh: seluruh keliling"
                />
              </Row>
            </fieldset>

            <fieldset style={{ margin: '16px 0' }}>
              <ChipGroup path="wound.tepi" label="Tepi Luka" options={TEPI} />
            </fieldset>

          </div>
        </div>

        <KartuJaringan jaringan={turunan.jaringan} sum={turunan.sum} />

        <KartuNyeriInfeksi turunan={turunan} />

      </div>
    </FieldProvider>
  );
}