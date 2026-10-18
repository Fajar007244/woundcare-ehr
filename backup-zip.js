'use strict';
/* ==========================================================
   Penulis ZIP minimal (metode STORE)
   ----------------------------------------------------------
   Dipakai untuk pencadangan: satu berkas .zip berisi
     manifest.json  — seluruh data selain biner foto
     photos/<id>.<ekstensi> — biner foto apa adanya

   Kenapa STORE dan bukan DEFLATE: foto luka sudah JPEG, yang
   berarti sudah terkompresi. Menzip-nya lagi hanya membuang CPU
   dan menghasilkan arsip yang lebih besar. STORE juga menulis
   biner apa adanya, jadi yang keluar dari arsip persis sama
   dengan yang masuk ke database — tidak ada risiko gambar
   rusak karena dua kali kompresi.

   Kenapa tidak memakai pustaka: proyek ini hanya punya satu
   dependensi (pg), dan pustaka zip menarik beberapadependensi
   lain. Penulis STORE sepanjang ini adalah beratus baris dan
   bisa diaudit.

   Batas yang jujur: ZIP klasik punya batas 4 GB dan 65.535
   berkas. Di atas itu butuh ZIP64 yang TIDAK ditulis di sini —
   Writer akan melempar error, bukan menghasilkan arsip rusak.
   ========================================================== */

const BATAS_UKURAN = 0xFFFFFFFF;   // 4 GB  - 1
const BATAS_BERKAS = 0xFFFF;

/* ---------- CRC-32 (IEEE 802.3), sama seperti yang ZIP pakai ---------- */

let TABEL = null;
function tabel() {
  if (TABEL) return TABEL;
  TABEL = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    TABEL[n] = c;
  }
  return TABEL;
}

function crc32(buf) {
  const t = tabel();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------- waktu DOS (tanggal versi ZIP, bukan Unix) ---------- */

function waktuDos(d) {
  const tahun = Math.max(1980, d.getFullYear());
  return {
    waktu: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    tanggal: (((tahun - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
  };
}

/**
 * Penulis ZIP yang menulis langsung ke aliran (stream) — bukan
 * mengumpulkan semuanya di memori dulu. Ini yang membuat arsip
 * skala gigabyte mungkin: hanya satu foto yang held di memori
 * pada satu waktu.
 */
class ZipWriter {
  /** @param {import('http').ServerResponse} out */
  constructor(out, { date = new Date() } = {}) {
    this.out = out;
    this.offset = 0;              // byte yang sudah ditulis
    this.dos = waktuDos(date);
    this.direktori = [];          // entri untuk central directory
    this.selesai = false;
  }

  _tulis(buf) {
    this.offset += buf.length;
    if (!this.out.write(buf)) {
      // Backpressure: tunggu sampai stream siap menerima lagi.
      return new Promise((resolve, reject) => {
        this.out.once('drain', resolve);
        this.out.once('error', reject);
      });
    }
    return null;
  }

  /**
   * Tambahkan satu berkas. Data harus Buffer penuh.
   * (Foto dimuat satu per satu, jadi ini tidak pernah menahan
   *  lebih dari satu gambar di memori.)
   */
  async add(name, data, mtime) {
    if (this.selesai) throw new Error('ZipWriter sudah ditutup.');
    if (this.direktori.length >= BATAS_BERKAS) {
      throw new Error('Terlalu banyak berkas untuk ZIP klasik (batas 65.535). Gunakan pg_dump.');
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > BATAS_UKURAN) {
      throw new Error('Berkas terlalu besar untuk ZIP klasik (batas 4 GB). Gunakan pg_dump.');
    }

    const namaBuf = Buffer.from(name, 'utf8');
    const crc = crc32(buf);
    const d = mtime ? waktuDos(new Date(mtime)) : this.dos;
    const awal = this.offset;

    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034B50, 0);   // signature
    lokal.writeUInt16LE(20, 4);           // version needed
    lokal.writeUInt16LE(0x0800, 6);       // flags: nama berkas UTF-8
    lokal.writeUInt16LE(0, 8);            // metode: 0 = STORE
    lokal.writeUInt16LE(d.waktu, 10);
    lokal.writeUInt16LE(d.tanggal, 12);
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(buf.length, 18);  // compressed size
    lokal.writeUInt32LE(buf.length, 22);  // uncompressed size
    lokal.writeUInt16LE(namaBuf.length, 26);
    lokal.writeUInt16LE(0, 28);           // extra length

    let tunggu = this._tulis(lokal);
    if (tunggu) await tunggu;
    tunggu = this._tulis(namaBuf);
    if (tunggu) await tunggu;
    tunggu = this._tulis(buf);
    if (tunggu) await tunggu;

    this.direktori.push({
      nama: namaBuf, crc, ukuran: buf.length, offset: awal,
      waktu: d.waktu, tanggal: d.tanggal
    });
  }

  /** Tulis central directory + EOCD, lalu tutup. */
  async finish() {
    if (this.selesai) return;
    this.selesai = true;

    const mulaiCd = this.offset;
    for (const e of this.direktori) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014B50, 0);    // signature
      h.writeUInt16LE(20, 4);             // version made by
      h.writeUInt16LE(20, 6);             // version needed
      h.writeUInt16LE(0x0800, 8);         // flags
      h.writeUInt16LE(0, 10);             // metode STORE
      h.writeUInt16LE(e.waktu, 12);
      h.writeUInt16LE(e.tanggal, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.ukuran, 20);      // compressed
      h.writeUInt32LE(e.ukuran, 24);      // uncompressed
      h.writeUInt16LE(e.nama.length, 28);
      h.writeUInt16LE(0, 30);             // extra
      h.writeUInt16LE(0, 32);             // comment
      h.writeUInt16LE(0, 34);             // disk number
      h.writeUInt16LE(0, 36);             // internal attrs
      h.writeUInt32LE(0, 38);             // external attrs
      h.writeUInt32LE(e.offset, 42);      // offset local header
      const t = this._tulis(h);
      if (t) await t;
      const t2 = this._tulis(e.nama);
      if (t2) await t2;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.direktori.length, 8);
    eocd.writeUInt16LE(this.direktori.length, 10);
    eocd.writeUInt32LE(this.offset - mulaiCd, 12);   // ukuran central directory
    eocd.writeUInt32LE(mulaiCd, 16);                 // offset central directory
    eocd.writeUInt16LE(0, 20);                       // panjang komentar
    const t = this._tulis(eocd);
    if (t) await t;
  }
}

/* ---------- Catatan pembaca ZIP ----------
 * Pembaca tidak ada di sini. Pemulihan membongkar arsip di sisi
 * peramban, jadi pembacaannya milik web/public/lib/backup.js.
 * Server hanya perlu menulis.
 */

module.exports = { ZipWriter, crc32, BATAS_UKURAN, BATAS_BERKAS };