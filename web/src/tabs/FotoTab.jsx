/* ==========================================================
   TAB 4 — DOKUMENTASI FOTO LUKA
   ----------------------------------------------------------
   Porting dari viewFoto() + photoSlot() + renderGallery() +
   refreshers.foto() + refreshPhotoMeta() + blok "Tab foto" di
   wire() pada assets/js/app.js (baris 2220-2331, 2303, 3072-3104).

   Yang perlu dijaga:

   1. Semua kolom tab ini berawalan `photos.*`, jadi FieldProvider
      otomatis menjadikannya kolom KUNJUNGAN — audit + touchVisit
      + syncAudit + terkunci saat beku. JANGAN dipaksa `visit={null}`
      (itu akan menjatuhkan kolom-kolom ini ke tabel patients dan
      menghilangkan jejaknya).

   2. `refreshPhotoMeta()` di app.js lama dipanggil dari applyControl()
      setiap ada perubahan berawalan `photos.` (baris 244). Padanannya
      di sini adalah `onDerived` yang menaikkan penghitung revisi —
      nilai turunan (ukuran berkas foto, penanda mistar) dihitung ulang
      dari model, tidak pernah disimpan ke model.

   3. Isi foto (data URL) BUKAN kolom formulir. Di app.js lama ditulis
      langsung: `v.photos[key] = r.dataUrl; Store.touchVisit(...)`.
      Kalau data URL itu diteruskan lewat ctx.write(), isi ratusan KB
      akan ikut tersimpan di v.audit lalu dikirim ke tabel audit_log,
      sedangkan openAuditHistory() merender before/after apa adanya —
      seluruh modal "Riwayat Perubahan" akan meledak jadi satu baris
      data URL. Jadi assignment langsung dipertahankan (identik dengan
      app.js lama), TETAPI jejaknya tetap ditulis — hanya dalam bentuk
      ringkas yang terbaca manusia: "(kosong)" → "182 KB".

   4. `capture="environment"` pada <input type="file"> wajib
      dipertahankan; tanpa itu tombol "Unggah Foto" tidak langsung
      membuka kamera belakang di HP.
   ========================================================== */

import { useMemo, useRef, useState } from 'react';

import {
  FieldProvider, Field, Check, useFieldCtx
} from '../core/field-binding.jsx';
import { markSaved } from '../core/save-signal.jsx';
import { Store, UI, API, Photos } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';

/* ---------- Dua slot foto: sebelum & sesudah ---------- */

const SLOTS = [
  { key: 'before', title: 'Foto Sebelum Perawatan', hint: 'Sebelum debridement / dressing' },
  { key: 'after', title: 'Foto Setelah Perawatan', hint: 'Setelah debridement / dressing' }
];

const LABEL_SLOT = { before: 'Sebelum', after: 'Sesudah' };

/* ==========================================================
   Kartu 4 — Dokumentasi Foto Luka
   ========================================================== */

/**
 * Slot foto. Padanan photoSlot() + refreshers.foto() di app.js lama.
 *
 * `meta` dihitung di luar (lihat hitungMetaFoto) supaya nilai
 * turunan benar-benar dihitung ulang setiap onDerived menaikkan
 * revisi — persis seperti refreshPhotoMeta() di aplikasi lama.
 */
function SlotFoto({ visit, slot, meta, beku, onUnggah, onHapus }) {
  const { key, title, hint } = slot;
  const fileRef = useRef(null);
  /* srcOf() menerima dua bentuk sekaligus:
     - data URL lama (data lama & berkas cadangan versi lama)
     - rujukan { id, ... } yang menunjuk ke /api/photos  */
  const src = Photos.srcOf(visit.photos && visit.photos[key]);
  const adaMistaring = meta.ruler;

  /* wire(): pick.addEventListener('click', () => file.click()) */
  function pilih() {
    if (fileRef.current) fileRef.current.click();
  }

  return (
    <div className="photo-slot">
      <div className="photo-slot__label">📷 {title}</div>

      {/* frame.onclick = src ? () => UI.lightbox(src, cap) : null */}
      <div
        className="photo-slot__frame"
        id={`frame-${key}`}
        style={src ? undefined : { cursor: 'default' }}
        onClick={
          src
            ? () => UI.lightbox(src, `${LABEL_SLOT[key]} — ${UI.fmtDateTime(visit.date, visit.time)}`)
            : undefined
        }
      >
        {src
          ? <img src={src} alt={title} />
          : <span className="photo-slot__placeholder">🖼</span>}
      </div>

      {/*
       * capture="environment" → HP membuka kamera belakang langsung.
       * Sengaja disembunyikan; tombol "Unggah Foto" yang memanggil .click()
       * supaya experience desktop tetap memakai pemilih berkas.
       */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        id={`file-${key}`}
        ref={fileRef}
        className="hidden"
        disabled={beku}
        onChange={e => {
          const f = e.target.files && e.target.files[0];
          e.target.value = '';          // agar berkas sama bisa dipilih ulang
          onUnggah(key, f);
        }}
      />

      <div className="btn-group">
        <button
          className="btn btn--sm btn--primary"
          id={`pick-${key}`}
          disabled={beku}
          title={beku ? 'Kunjungan dibekuan' : undefined}
          onClick={pilih}
        >Unggah Foto</button>
        <button
          className="btn btn--sm btn--danger"
          id={`clear-${key}`}
          disabled={beku}
          title={beku ? 'Kunjungan dibekuan' : undefined}
          onClick={() => onHapus(key)}
        >Hapus</button>
      </div>

      {/*
       * meta-${key}: di app.js lama isinya awalanya `hint`, lalu
       * refreshers.foto() menimpanya dengan ukuran berkas + penanda
       * mistar. Yang ditampilkan di sini adalah hasil akhir itu;
       * teks petunjuknya disimpan sebagai title.
       */}
      <div className="photo-slot__meta" id={`meta-${key}`} title={hint}>
        <span>{meta.bytes[key] ? Photos.humanSize(meta.bytes[key]) : 'belum ada foto'}</span>
        <span>{adaMistaring ? '📏 mistar' : ''}</span>
      </div>
    </div>
  );
}

function KartuFoto({ visit, meta, beku, onUnggah, onHapus }) {
  return (
    <div className="card">
      <div className="card__head"><span className="num">4</span><h2>Dokumentasi Foto Luka</h2></div>
      <div className="card__body">

        <Callout>
          <strong>Standar Dokumentasi</strong>
          Ambil foto dengan <b>jarak &amp; sudut konsisten</b>, sertakan <b>mistar luka</b> pada bidang yang sama,
          dan gunakan pencahayaan seragam setiap kunjungan agar perbandingan valid.
        </Callout>

        <div className="photo-grid" style={{ marginTop: 16 }}>
          {SLOTS.map(s => (
            <SlotFoto
              key={s.key}
              visit={visit}
              slot={s}
              meta={meta}
              beku={beku}
              onUnggah={onUnggah}
              onHapus={onHapus}
            />
          ))}
        </div>

        <div className="form-row form-row--2" style={{ marginTop: 16 }}>
          <div className="field">
            <label className="field__label">Mistaring / Skala Rujukan</label>
            <div className="chips">
              <Check path="photos.ruler" label="Mistar luka terlihat" />
              <Check path="photos.rulerNote" label="Label anatomi / orientasi" />
            </div>
          </div>
          <Field
            path="photos.catatan"
            label="Catatan Foto"
            placeholder="Kondisi,SV, alat, dan catatan teknis"
          />
        </div>

      </div>
    </div>
  );
}

/* ==========================================================
   Galeri per kunjungan
   ========================================================== */

/** Padanan renderGallery() di app.js lama (kunjungan terbaru di atas). */
function KartuGaleri({ patient }) {
  const kebalik = (patient.visits || []).slice().reverse();

  return (
    <div className="card">
      <div className="card__head">
        <h2>Galeri Per Kunjungan</h2>
        <Badge tone="muted">riwayat foto</Badge>
      </div>
      <div className="card__body card__body--flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Sebelum</th>
                <th style={{ width: 90 }}>Sesudah</th>
                <th>Tanggal</th>
                <th>Catatan</th>
                <th className="num-cell">Skor</th>
              </tr>
            </thead>
            <tbody id="gallery-body">
              {kebalik.length ? kebalik.map(v => {
                const p = v.photos || {};
                const cap = UI.fmtDateTime(v.date, v.time);

                const thumb = k => {
                  const s = Photos.srcOf(p[k]);
                  return s
                    ? (
                      <img
                        className="photo-thumb"
                        src={s}
                        alt={`Foto ${LABEL_SLOT[k].toLowerCase()}`}
                        title={`Perbesar — ${cap}`}
                        onClick={() => UI.lightbox(s, cap)}
                      />
                    )
                    : <div className="photo-none">—</div>;
                };

                return (
                  <tr key={v.id}>
                    <td>{thumb('before')}</td>
                    <td>{thumb('after')}</td>
                    <td style={{ fontSize: 12.5 }}>{cap}</td>
                    <td style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                      {p.catatan || '-'}
                      {p.ruler ? ' ' : null}
                      {p.ruler ? <Badge tone="primary">mistar</Badge> : null}
                    </td>
                    <td className="num-cell">
                      {v.winner && v.winner.total != null ? <strong>{v.winner.total}</strong> : '—'}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--c-text-muted)', padding: 24 }}>
                    Belum ada kunjungan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   Isi tab (harus di dalam <FieldProvider>)
   ========================================================== */

/**
 * Nilai turunan tab foto — padanan refreshers.foto() / refreshPhotoMeta().
 * Tidak ada yang ditulis ke model; semuanya dibaca ulang dari `visit`.
 */
function hitungMetaFoto(visit) {
  const p = (visit && visit.photos) || {};
  return {
    bytes: { before: Photos.sizeOf(p.before), after: Photos.sizeOf(p.after) },
    ruler: !!p.ruler
  };
}

function IsiFoto({ patient, visit, rev, setRev }) {
  const ctx = useFieldCtx();

  const meta = useMemo(() => hitungMetaFoto(visit), [visit, rev]);

  /*
   * Tulis foto ke model + jejak audit ringkas.
   * Lihat catatan panjang di kepala berkas soal kenapa tidak lewat ctx.write().
   *
   * `nilai` sekarang berupa RUJUKAN { id, mime, width, height, size } atau
   * null — bukan lagi data URL, karena binernya disimpan server sebagai BLOB.
   * Photos.sizeOf() menerima keduanya, jadi jejak audit tetap terbaca manusia.
   */
  function tulisFoto(key, nilai) {
    const v = visit;
    if (!v) return false;

    if (ctx.frozen) {
      UI.toast('Kunjungan ini dibekuan. Buka bekuan dulu untuk mengubah.', 'warn');
      return false;
    }

    if (!v.photos) v.photos = { before: null, after: null, catatan: '', ruler: false, rulerNote: '' };

    const lama = v.photos[key] || null;
    const ket = d => (d ? Photos.humanSize(Photos.sizeOf(d)) : '(kosong)');

    v.photos[key] = nilai;

    Store.appendAudit(patient.id, v.id, {
      key: `photos.${key}`,
      label: `Foto ${LABEL_SLOT[key]}`,
      before: ket(lama),
      after: ket(nilai),
      risky: false,
      oleh: Store.currentUserName() || 'Tanpa nama'
    });
    Store.touchVisit(patient.id, v.id);       // isi kunjungan
    Store.syncAudit(patient.id, v.id, true); // jejak audit ke audit_log
    markSaved();

    // refreshPhotoMeta() di app.js lama dipanggil tepat di titik ini:
    // metadata turunan (ukuran berkas, penanda mistar) dihitung ulang.
    setRev(n => n + 1);
    return true;
  }

  /* wire(): file.addEventListener('change', ...) */
  async function unggah(key, file) {
    if (!file) return;

    UI.toast('Memproses foto...', 'muted', 1200);
    try {
      // Photos.fromInput() membaca input.files lalu bersihin sendiri;
      // karena kita sudah mengambil File-nya di onChange, cukup
      // compressAdaptive() — sama seperti wire() di app.js lama.
      // Hasilnya kini membawa `blob` (biner mentah), bukan hanya data URL.
      const r = await Photos.compressAdaptive(file);

      /* Dikirim sebagai BINER, bukan base64: server menyimpannya sebagai
         BLOB dan mengembalikan rujukan ringan yang masuk ke model. */
      const hasil = await API.uploadPhoto({
        visitId: visit.id, kind: key, blob: r.blob, width: r.width, height: r.height
      });

      /* Simpan data URL hasil kompresi ke cache cetak. Di sini data URL-nya
         sudah tersedia tanpa perlu meminta ulang ke server — dan di sinilah
         satu-satunya tempat asal mula foto itu diketahui. */
      window.FOTO_CACHE = window.FOTO_CACHE || {};
      window.FOTO_CACHE[hasil.photo.id] = r.dataUrl;

      if (!tulisFoto(key, hasil.photo)) return;

      UI.toast(
        `Foto ${LABEL_SLOT[key].toLowerCase()} tersimpan (${Photos.humanSize(hasil.photo.size)})`,
        'ok'
      );
    } catch (err) {
      UI.toast((err && err.message) || 'Gagal memproses foto', 'danger');
    }
  }

  /* wire(): clr.addEventListener('click', ...) — ditambah konfirmasi */
  async function hapus(key) {
    const v = visit;
    const lama = v && v.photos && v.photos[key];
    if (!lama) {
      UI.toast(`Belum ada foto ${LABEL_SLOT[key].toLowerCase()} untuk dihapus`, 'muted', 1600);
      return;
    }

    const ok = await UI.confirm(
      `Hapus foto ${LABEL_SLOT[key].toLowerCase()} kunjungan ini?\n\n` +
      'Foto akan hilang dari rekam medis dan tidak dapat dikembalikan.',
      { title: 'Hapus Foto', okText: 'Hapus Foto' }
    );
    if (!ok) return;

    /* Biner foto dibuang di server lebih dulu supaya tidak meninggalkan
       BLOB yatim di basis data. Kalau langkah ini gagal, rujukan di model
       tetap dibuang — jangan sampai foto "hantu" yang tidak bisa dibuka
       tertinggal di rekam medis. */
    if (lama && lama.id) {
      try { await API.deletePhoto(lama.id); } catch (e) { /* diabaikan */ }
    }

    if (!tulisFoto(key, null)) return;
    UI.toast('Foto dihapus', 'muted', 1500);
  }

  if (!visit) {
    return (
      <EmptyState icon="📋" title="Belum ada kunjungan aktif">
        Buat kunjungan terlebih dahulu untuk mengisi bagian ini.
      </EmptyState>
    );
  }

  return (
    <>
      <KartuFoto
        visit={visit}
        meta={meta}
        beku={ctx.frozen}
        onUnggah={unggah}
        onHapus={hapus}
      />
      <KartuGaleri patient={patient} />
    </>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function FotoTab({ patient, visit }) {
  /* Padanan refreshPhotoMeta(): dipanggil setiap kolom photos.* berubah. */
  const [rev, setRev] = useState(0);

  function onDerived() {
    setRev(n => n + 1);
  }

  if (!patient) {
    return (
      <EmptyState icon="🔎" title="Pasien tidak ditemukan">
        Data pasien tidak dapat dimuat.
      </EmptyState>
    );
  }

  return (
    /*
     * visit diteruskan apa adanya: seluruh kolom tab ini (photos.*)
     * adalah kolom kunjungan, sama seperti data-vbind di app.js lama.
     * Audit + lock saat beku datang gratis dari FieldProvider.
     */
    <FieldProvider patient={patient} visit={visit} onDerived={onDerived}>
      <div id="form-foto">
        <IsiFoto patient={patient} visit={visit} rev={rev} setRev={setRev} />
      </div>
    </FieldProvider>
  );
}