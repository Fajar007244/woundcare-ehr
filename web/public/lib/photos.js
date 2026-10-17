/* ============================================================
   photos.js — Unggah, kompresi, dan penyimpanan foto luka
   ============================================================
   Foto dikompresikan lewat canvas, lalu dikirim ke server sebagai BINER
   dan disimpan server sebagai BLOB di tabel `photos`. Yang tersimpan di
   v.photos[kind] bukan lagi gambar, melainkan rujukan ringan
   { id, mime, width, height, size } — lihat srcOf() di bawah.

   Data URL tetap didukung supaya data lama dan berkas cadangan versi lama
   tetap terbaca, tetapi bukan lagi bentuk penyimpanan yang dipakai.
   ============================================================ */

const Photos = (() => {

  const MAX_EDGE   = 1000;   // px sisi terpanjang
  const QUALITY    = 0.72;   // kualitas JPEG
  const WARN_BYTES = 350 * 1024; // per foto, sebelum penyimpanan

  /* ---------- Bentuk nilai foto ----------
   *
   * v.photos[kind] bisa berisi DUA hal, dan keduanya harus dibaca:
   *
   *   string  "data:image/jpeg;base64,..."     → format lama
   *   objek   { id, mime, width, height, size } → format sekarang
   *
   * srcOf() menyatukan keduanya menjadi src yang bisa langsung dipakai
   * <img>. Semua tempat yang menampilkan foto WAJIB lewat sini.
   */

  function srcOf(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;                 // data URL lama
    if (typeof p === 'object' && p.id) {                 // rujukan baru
      return '/api/photos?id=' + encodeURIComponent(p.id);
    }
    return null;
  }

  /** Data URL -> Blob. Cadangan jalur bila canvas.toBlob tidak tersedia. */
  function dataUrlToBlob(dataUrl) {
    const i = dataUrl.indexOf(',');
    const mime = (dataUrl.slice(0, i).match(/data:([^;,]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(dataUrl.slice(i + 1));
    const u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: mime });
  }

  /* ---------- Kompresikan file gambar -> data URL ---------- */
  function compress(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        return reject(new Error('Berkas bukan gambar.'));
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Gambar tidak dapat dibaca (format tidak didukung?).'));
        img.onload = () => {
          let { width: w, height: h } = img;

          // Skala proporsional
          const scale = Math.min(1, maxEdge / Math.max(w, h));
          w = Math.round(w * scale);
          h = Math.round(h * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');

          // Latar putih supaya foto PNG transparan tidak jadi hitam
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          let dataUrl;
          try {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          } catch (e) {
            return reject(new Error('Gagal memproses gambar.'));
          }

          const selesai = blob => resolve({
            dataUrl,
            blob: blob || dataUrlToBlob(dataUrl),   // biner mentah untuk diunggah
            width: w,
            height: h,
            originalName: file.name || '',
            originalSize: file.size || 0,
            capturedAt: new Date().toISOString()
          });

          /* toBlob memberi binernya langsung, jadi saat dikirim ke server
             foto tidak perlu melewati base64 sama sekali. Bila peramban
             tidak mendukung (atau toBlob menghasilkan null), data URL yang
             sudah ada dibongkar sebagai cadangan. */
          if (canvas.toBlob) canvas.toBlob(selesai, 'image/jpeg', quality);
          else selesai(null);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- Ambil dari input file ---------- */
  function fromInput(input, opts) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return Promise.resolve(null);
    return compress(f, opts);
  }

  /** Estimasi ukuran berkas foto (byte) — data URL lama maupun rujukan baru. */
  function sizeOf(p) {
    if (!p) return 0;
    if (typeof p === 'object') return p.size || 0;    // rujukan: ukurannya sudah tercatat
    if (typeof p !== 'string') return 0;
    const i = p.indexOf(',');
    if (i < 0) return 0;
    const b64 = p.slice(i + 1);
    return Math.floor(b64.length * 3 / 4);
  }

  function humanSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  }

  /* ---------- Target kompresi adaptif jika kuota mepet ---------- */
  /** Panggil ulang dengan kualitas lebih rendah sampai muat. */
  async function compressAdaptive(file, { budgetBytes = 300 * 1024 } = {}) {
    const ladder = [
      { maxEdge: 1000, quality: 0.72 },
      { maxEdge: 860,  quality: 0.62 },
      { maxEdge: 700,  quality: 0.55 },
      { maxEdge: 560,  quality: 0.48 }
    ];
    let last;
    for (const opt of ladder) {
      last = await compress(file, opt);
      if (sizeOf(last.dataUrl) <= budgetBytes) break;
    }
    return last;
  }

  return { compress, compressAdaptive, fromInput, srcOf, dataUrlToBlob,
           sizeOf, humanSize, MAX_EDGE, QUALITY, WARN_BYTES };
})();