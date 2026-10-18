/* ==========================================================
   Baca arsip cadangan .zip di sisi peramban
   ----------------------------------------------------------
   Dipakai hanya saat MEMULIHKAN cadangan. Server tidak butuh
   membaca arsip — ia hanya menulisnya.

   Arsitekturnya sengaja begitu: pemulihan dipecah supaya tidak
   pernah ada satu permintaan besar. Foto diunggah satu per satu
   lewat POST /api/backup/photos, dan baru terakhir manifest-nya
   dikirim. Dengan begitu tidak ada langkah yang bisa melewati
   batas 4,5 MB milik Vercel, berapa pun besar kliniknya.

   Format arsip yang produced server (lihat backup-zip.js):
     manifest.json            data selain biner foto
     photos/<id>.<ekstensi>   biner foto apa adanya

   Metode STORE yang ditulis server, tapi metode DEFLATE juga
   ditangani di sini supaya arsip dari alat lain (WinRAR,
   7-zip, zip bawaan Windows) tetap bisa dipulihkan. Deflate
   ditangani lewat DecompressionStream bawaan peramban.
   ========================================================== */

(function (global) {
  'use strict';

  const SIG_EOCD    = 0x06054B50;
  const SIG_CENTRAL = 0x02014B50;
  const SIG_LOCAL   = 0x04034B50;

  const EKSTENSI = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  /** Cari penanda EOCD dari belakang berkas. */
  function cariEocd(v) {
    const n = v.byteLength;
    const bawah = Math.max(0, n - 0xFFFF - 22);
    for (let i = n - 22; i >= bawah; i--) {
      if (v.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('Berkas ini bukan arsip ZIP yang utuh (penanda akhir tidak ditemukan).');
  }

  /** Nama berkas di dalam ZIP: hanya yangascii/UTF-8 sederhana. */
  function bacaNama(bytes) {
    try { return new TextDecoder('utf-8').decode(bytes); }
    catch (e) { return String.fromCharCode.apply(null, bytes); }
  }

  /** Inflasi satu potongan data DEFLATE. */
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Peramban ini tidak mendukung DEFLATE. Simpan ulang cadangan lewat tombol Unduh.');
    }
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * Buka arsip.
   * @param {ArrayBuffer} buf isi berkas .zip
   * @returns {Promise<{manifest: object, fotos: Map<string, object>}>}
   *          `fotos` memetakan id foto -> { bytes: Uint8Array, mime }
   */
  async function bukaZip(buf) {
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const eocd = cariEocd(v);

    const jumlahEntries = v.getUint16(eocd + 10, true);
    const ukuranCd = v.getUint32(eocd + 12, true);
    let ptr = v.getUint32(eocd + 16, true);

    /* Arsip cadangan ini selalu mulai dari offset nol, tapi beberapa
     alat menulis prefiks di depannya. Karena itu posisi central
     directory dicocokkan dari ukurannya, bukan dipercaya buta. */
    if (ptr + ukuranCd > v.byteLength) ptr = eocd - ukuranCd;

    const manifest = { meta: {}, patients: [] };
    const fotos = new Map();
    let ketemuManifest = false;

    for (let i = 0; i < jumlahEntries; i++) {
      if (v.getUint32(ptr, true) !== SIG_CENTRAL) break;
      const metode = v.getUint16(ptr + 10, true);
      const ukuran = v.getUint32(ptr + 24, true);
      const namaLen = v.getUint16(ptr + 28, true);
      const extraLen = v.getUint16(ptr + 30, true);
      const komentarLen = v.getUint16(ptr + 32, true);
      const offsetLokal = v.getUint32(ptr + 42, true);
      const nama = bacaNama(u8.subarray(ptr + 46, ptr + 46 + namaLen));
      ptr += 46 + namaLen + extraLen + komentarLen;

      if (nama.endsWith('/')) continue;

      /* Header lokal memuat nama+extra lagi, yang panjangnya bisa
         berbeda dari yang di direktori pusat — jadi harus dibaca
         sendiri, bukan memakai ptr yang tadi. */
      if (v.getUint32(offsetLokal, true) !== SIG_LOCAL) continue;
      const lNamaLen = v.getUint16(offsetLokal + 26, true);
      const lExtraLen = v.getUint16(offsetLokal + 28, true);
      const mulaiData = offsetLokal + 30 + lNamaLen + lExtraLen;
      const mentah = u8.subarray(mulaiData, mulaiData + ukuran);

      if (nama === 'manifest.json') {
        const teks = new TextDecoder('utf-8').decode(mentah);
        const j = JSON.parse(teks);
        manifest.meta = j.meta || {};
        manifest.patients = Array.isArray(j.patients) ? j.patients : [];
        manifest.clinic = j.clinic || null;
        ketemuManifest = true;
        continue;
      }

      /* photos/<id>.<ekstensi> */
      if (nama.indexOf('photos/') !== 0) continue;
      const slash = nama.lastIndexOf('/');
      const namaBerkas = nama.slice(slash + 1);
      const titik = namaBerkas.lastIndexOf('.');
      const id = titik > 0 ? namaBerkas.slice(0, titik) : namaBerkas;
      const ext = titik > 0 ? namaBerkas.slice(titik + 1).toLowerCase() : 'jpg';
      const mime = Object.keys(EKSTENSI).find(m => EKSTENSI[m] === ext) || 'image/jpeg';
      const data = metode === 0 ? mentah : await inflate(mentah);
      fotos.set(id, { bytes: data, mime });
    }

    if (!ketemuManifest) {
      throw new Error('Arsip tidak berisi manifest.json — ini bukan cadangan WoundCare.');
    }
    return { manifest, fotos };
  }

  global.Backup = { bukaZip };
})(window);