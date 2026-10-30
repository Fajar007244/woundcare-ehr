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

   4. Input berkas SENGAJA tanpa `capture`. Bila `capture="environment"`
      dipasang, HP langsung membuka kamera belakang dan galeri tidak bisa
      dipilih. Tanpa itu, menekan "Unggah Foto" memunculkan menu bawaan
      sistem (Kamera / Galeri / Berkas), jadi kedua jalur tersedia.
      Kompresi di Photos.compressAdaptive() menjaga ukurannya tetap kecil
      (foto 12 MP terukur -> 178 KB), sehingga batas 3 MB di server tidak
      pernah terlanggar.
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
  /* Semua foto slot ini — bentuk baru photos[key+'List']; bentuk lama
     photos[key] (satu foto) diangkat menjadi daftar oleh Photos.list(). */
  const daftar = Photos.list(visit.photos, key);
  const jumlah = daftar.length;
  const adaMistaring = meta.ruler;

  /* wire(): pick.addEventListener('click', () => file.click()) */
  function pilih() {
    if (fileRef.current) fileRef.current.click();
  }

  return (
    <div className="photo-slot">
      <div className="photo-slot__label">
        📷 {title}
        {jumlah ? <span className="photo-slot__count">{jumlah}</span> : null}
      </div>

      {/* frame: kosong → placeholder; ada foto → deret thumbnail, tiap foto
          bisa diperbesar dan dihapus satu per satu. */}
      <div
        className={`photo-slot__frame${jumlah ? ' photo-slot__frame--multi' : ''}`}
        id={`frame-${key}`}
        style={jumlah ? undefined : { cursor: 'default' }}
      >
        {jumlah ? daftar.map((p, i) => {
          const s = Photos.srcOf(p);
          if (!s) return null;
          const cap = `${LABEL_SLOT[key]} ${i + 1}/${jumlah} — ${UI.fmtDateTime(visit.date, visit.time)}`;
          return (
            <div className="photo-thumb-wrap" key={(p && p.id) || i}>
              <img
                className="photo-thumb"
                src={s}
                alt={`${title} ${i + 1}`}
                title={`Perbesar — ${cap}`}
                onClick={() => UI.lightbox(s, cap)}
              />
              <button
                type="button"
                className="photo-thumb__del"
                disabled={beku}
                title={beku ? 'Kunjungan dibekuan' : 'Hapus foto ini'}
                aria-label={`Hapus foto ${i + 1} ${LABEL_SLOT[key]}`}
                onClick={() => onHapus(key, i)}
              >×</button>
            </div>
          );
        }) : <span className="photo-slot__placeholder">🖼</span>}
      </div>

      {/*
       * Sengaja TANPA `capture`: dengan capture, HP langsung membuka kamera
       * belakang dan galeri tidak bisa dipilih. Tanpa itu, menekan
       * "Unggah Foto" memunculkan menu bawaan sistem (Kamera / Galeri /
       * Berkas). Input disembunyikan; tombol yang memanggil .click().
       */}
      <input
        type="file"
        accept="image/*"
        multiple
        id={`file-${key}`}
        ref={fileRef}
        className="hidden"
        disabled={beku}
        onChange={e => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';          // agar berkas sama bisa dipilih ulang
          if (files.length) onUnggah(key, files);
        }}
      />

      <div className="btn-group">
        <button
          className="btn btn--sm btn--primary"
          id={`pick-${key}`}
          disabled={beku}
          title={beku ? 'Kunjungan dibekuan' : 'Pilih satu atau banyak foto'}
          onClick={pilih}
        >+ Unggah Foto</button>
      </div>

      {/*
       * meta-${key}: di app.js lama isinya awalanya `hint`, lalu
       * refreshers.foto() menimpanya dengan ukuran berkas + penanda
       * mistar. Yang ditampilkan di sini adalah hasil akhir itu;
       * teks petunjuknya disimpan sebagai title.
       */}
      <div className="photo-slot__meta" id={`meta-${key}`} title={hint}>
        <span>{jumlah ? `${jumlah} foto · ${Photos.humanSize(meta.bytes[key])}` : 'belum ada foto'}</span>
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
                  const daftar = Photos.list(p, k);
                  const s = Photos.srcOf(daftar[0]);
                  if (!s) return <div className="photo-none">—</div>;
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <img
                        className="photo-thumb"
                        src={s}
                        alt={`Foto ${LABEL_SLOT[k].toLowerCase()}`}
                        title={`Perbesar — ${cap}`}
                        onClick={() => UI.lightbox(s, cap)}
                      />
                      {daftar.length > 1 ? <Badge tone="primary">+{daftar.length - 1}</Badge> : null}
                    </span>
                  );
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
  const total = k => Photos.list(p, k).reduce((a, r) => a + Photos.sizeOf(r), 0);
  return {
    bytes: { before: total('before'), after: total('after') },
    ruler: !!p.ruler
  };
}

function IsiFoto({ patient, visit, rev, setRev }) {
  const ctx = useFieldCtx();

  const meta = useMemo(() => hitungMetaFoto(visit), [visit, rev]);

  /*
   * Tulis DAFTAR foto ke model + jejak audit ringkas.
   * Lihat catatan panjang di kepala berkas soal kenapa tidak lewat ctx.write().
   *
   * Isi foto (rujukan { id, mime, ... } / data URL) bukan kolom formulir:
   * ditulis langsung, tapi jejaknya tetap dicatat dalam bentuk ringkas
   * yang terbaca manusia: "(kosong)" → "3 foto (512 KB)".
   */
  function tulisFoto(key, daftar) {
    const v = visit;
    if (!v) return false;

    if (ctx.frozen) {
      UI.toast('Kunjungan ini dibekuan. Buka bekuan dulu untuk mengubah.', 'warn');
      return false;
    }

    if (!v.photos) v.photos = { before: null, after: null, catatan: '', ruler: false, rulerNote: '' };

    const lama = Photos.list(v.photos, key);
    const ket = arr => (arr && arr.length
      ? `${arr.length} foto (${Photos.humanSize(arr.reduce((a, r) => a + Photos.sizeOf(r), 0))})`
      : '(kosong)');

    /* Daftar adalah sumber kebenaran; photos[key] tetap dijaga sebagai
       foto pertama supaya cetak, galeri, dan pembaca lama tetap jalan. */
    v.photos[`${key}List`] = daftar;
    v.photos[key] = daftar[0] || null;

    Store.appendAudit(patient.id, v.id, {
      key: `photos.${key}`,
      label: `Foto ${LABEL_SLOT[key]}`,
      before: ket(lama),
      after: ket(daftar),
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

  /* wire(): file.addEventListener('change', ...) — kini bisa banyak berkas. */
  async function unggah(key, files) {
    const antre = Array.from(files || []).filter(Boolean);
    if (!antre.length) return;

    UI.toast(`Memproses ${antre.length} foto...`, 'muted', 1500);

    const daftar = Photos.list(vphotos(), key);
    const idAda = new Set(daftar.map(r => r && r.id).filter(Boolean));
    let tersimpan = 0, gagal = 0;

    for (const file of antre) {
      try {
        // Kompresi adaptif — sama seperti wire() di app.js lama.
        // Hasilnya kini membawa `blob` (biner mentah), bukan hanya data URL.
        const r = await Photos.compressAdaptive(file);

        /* Dikirim sebagai BINER, bukan base64: server menyimpannya sebagai
           BLOB dan mengembalikan rujukan ringan yang masuk ke model. */
        const hasil = await API.uploadPhoto({
          visitId: visit.id, kind: key, blob: r.blob, width: r.width, height: r.height
        });

        /* Simpan data URL hasil kompresi ke cache cetak. Di sini data URL-nya
           sudah tersedia tanpa perlu meminta ulang ke server. */
        window.FOTO_CACHE = window.FOTO_CACHE || {};
        window.FOTO_CACHE[hasil.photo.id] = r.dataUrl;

        tersimpan++;
        /* Berkas isi sama persis menghasilkan id yang sama (id = hash isi)
           dan menimpa barisnya sendiri di server — tidak diduplikasi. */
        if (!idAda.has(hasil.photo.id)) {
          idAda.add(hasil.photo.id);
          daftar.push(hasil.photo);
        }
      } catch (err) {
        gagal++;
        console.error('[foto]', err);
      }
    }

    if (tersimpan && tulisFoto(key, daftar)) {
      UI.toast(`${tersimpan} foto ${LABEL_SLOT[key].toLowerCase()} tersimpan`, 'ok');
    }
    if (gagal) UI.toast(`${gagal} foto gagal diproses`, 'danger');
  }

  function vphotos() {
    return (visit && visit.photos) || {};
  }

  /* Klik × pada satu thumbnail — ditambah konfirmasi. */
  async function hapus(key, idx) {
    const daftar = Photos.list(vphotos(), key);
    const foto = daftar[idx];
    if (!foto) return;

    const ok = await UI.confirm(
      `Hapus foto ${LABEL_SLOT[key].toLowerCase()} ke-${idx + 1} dari kunjungan ini?\n\n` +
      'Foto akan hilang dari rekam medis dan tidak dapat dikembalikan.',
      { title: 'Hapus Foto', okText: 'Hapus Foto' }
    );
    if (!ok) return;

    /* Biner foto dibuang di server lebih dulu supaya tidak meninggalkan
       BLOB yatim di basis data. Kalau langkah ini gagal, rujukan di model
       tetap dibuang — jangan sampai foto "hantu" yang tidak bisa dibuka
       tertinggal di rekam medis. */
    if (foto.id) {
      try { await API.deletePhoto(foto.id); } catch (e) { /* diabaikan */ }
    }

    const sisa = daftar.slice();
    sisa.splice(idx, 1);
    if (!tulisFoto(key, sisa)) return;
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