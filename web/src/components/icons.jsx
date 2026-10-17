/* Ikon garis (stroke) — satu gaya untuk seluruh aplikasi.
 *
 * SEBELUMNYA: emoji 👤 📝 🩹 📷 📊 📈 🔑 🕓 ⚙ ⏻
 *
 * Kenapa diganti. Emoji bukan gambar, tapi glif dari font sistem.
 * Bentuk, warna, dan ukurannya BERBEDA di tiap perangkat: Android dan
 * Windows menampilkannya berwarna penuh, iOS bergaya penuh, sebagian
 * distro Linux tidak punya sama sekali sehingga yang muncul kotak
 * kosong. Aplikasi ini dipakai perawat di ruang perawatan — di tablet
 * klinik yang sering berlapis sistem berbeda. Tombol yang tidak bisa
 * dibaca bukan soal selera.
 *
 * Ikon di sini inline SVG:
 *   - tidak butuh font emoji terpasang
 *   - tidak butuh jaringan atau berkas tambahan
 *   - tajam di semua ukuran layar (vector, bukan bitmap)
 *   - memakai currentColor, jadi warnanya otomatis mengikuti teks —
 *     termasuk merah pada "Keluar"
 *
 * Semua ikon memakai viewBox 24x24 dan digambar dengan garis
 * setebal 1.8 tanpa isi, agar bobot visualnya seragam.
 */

const GLYPHS = {
  /* --- Bottom navigation / tab --- */

  // Data Pasien
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5v-1.2a7.5 7.5 0 0 1 15 0v1.2" />
    </>
  ),

  // Informed Consent — kertas berisi baris bertanda
  fileText: (
    <>
      <path d="M14.5 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <polyline points="14.5 2.5 14.5 7 19 7" />
      <line x1="8.5" y1="12.5" x2="15.5" y2="12.5" />
      <line x1="8.5" y1="16" x2="13.5" y2="16" />
    </>
  ),

  // Pengkajian Luka — garis nadi
  activity: (
    <polyline points="2.5 12.5 7.5 12.5 10 6 14 18 16.5 12.5 21.5 12.5" />
  ),

  // Foto Luka
  camera: (
    <>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.8-2.8h6.4L17 7h3a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="3.6" />
    </>
  ),

  // WINNER Scale — batang grafik
  barChart: (
    <>
      <line x1="6.5" y1="20" x2="6.5" y2="14" />
      <line x1="12" y1="20" x2="12" y2="5" />
      <line x1="17.5" y1="20" x2="17.5" y2="10" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </>
  ),

  // Grafik Tren — garis naik
  trendingUp: (
    <>
      <polyline points="21.5 6.5 13.5 14.5 9.5 10.5 2.5 17.5" />
      <polyline points="16 6.5 21.5 6.5 21.5 12" />
    </>
  ),

  /* --- Menu akun --- */

  // Ganti Sandi
  key: (
    <>
      <circle cx="8" cy="16" r="4" />
      <path d="M10.8 13.2L21 3" />
      <path d="M17 7l2.5 2.5" />
      <path d="M14 10l2.5 2.5" />
    </>
  ),

  // Riwayat Akses Klinik — jam
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 6.5 12 12 15.8 14.2" />
    </>
  ),

  // Data & Cadangan — basis data
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-13" />
      <path d="M19.5 12c0 1.55-3.36 2.8-7.5 2.8S4.5 13.55 4.5 12" />
    </>
  ),

  // Keluar — pintu keluar
  logOut: (
    <>
      <path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 16.5 20.5 12 16 7.5" />
      <line x1="20" y1="12" x2="9" y2="12" />
    </>
  )
};

/**
 * @param {string} name  kunci pada GLYPHS
 * @param {number} size  ukuran dalam piksel, sama untuk lebar & tinggi
 */
export function Icon({ name, size = 18, className, strokeWidth = 1.8 }) {
  const glyph = GLYPHS[name];
  if (!glyph) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(GLYPHS);