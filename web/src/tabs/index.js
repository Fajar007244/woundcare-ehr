/* Peta tab → komponen.
 *
 * `icon` bernama kunci ikon di components/icons.jsx (bukan karakter
 * emoji). Alasannya ada di sana: emoji dirender oleh font sistem, jadi
 * bentuk dan warnanya berbeda di tiap perangkat, dan di distro Linux
 * tertentu tidak ada sama sekali sehingga muncul kotak kosong.
 * Tombol navigasi yang tidak terbaca di tablet klinik bukan soal tampilan.
 *
 * Kontrak setiap tab:
 *   export default function XxxTab({ patient, visit }) { ... }
 * - patient  : objek pasien dari Store (boleh null)
 * - visit    : objek kunjungan aktif (boleh null)
 * - form     dibungkus <FieldProvider patient={patient} visit={visit}> sendiri
 */

import IdentitasTab from './IdentitasTab.jsx';
import ConsentTab from './ConsentTab.jsx';
import PengkajianTab from './PengkajianTab.jsx';
import FotoTab from './FotoTab.jsx';
import WinnerTab from './WinnerTab.jsx';
import GrafikTab from './GrafikTab.jsx';

/* Label persis sama dengan TABS di assets/js/app.js (baris 1352-1359).
   Pemisah titik, bukan titik tengah — dan tab kedua bernama
   "Informed Consent", bukan "Persetujuan".

   `icon` & `short` hanya dipakai oleh bottom navigation di ponsel.
   Di layar lebar keduanya disembunyikan lewat CSS, sehingga tampilan
   desktop tetap persis seperti semula. */
/* `num` dipisah dari `label` supaya nomor langkah bisa dirender sebagai
   chip tersendiri (lihat .tab__num di app.css). Sebelumnya nomornya
   menempel di dalam teks label sebagai "1. Data Pasien", sehingga tidak
   bisa digayakan terpisah maupun ditukar menjadi centang.

   `label` tetap sama kata demi kata dengan TABS di assets/js/app.js;
   yang hilang hanya awalan nomornya.
   `short` hanya dipakai bottom navigation di ponsel. */
export const TAB_LIST = [
  { key: 'identitas',  num: 1, label: 'Data Pasien',      icon: 'user',       short: 'Pasien' },
  { key: 'consent',    num: 2, label: 'Informed Consent', icon: 'fileText',    short: 'Consent' },
  { key: 'pengkajian', num: 3, label: 'Pengkajian Luka',  icon: 'activity',   short: 'Luka' },
  { key: 'foto',       num: 4, label: 'Foto Luka',        icon: 'camera',     short: 'Foto' },
  { key: 'winner',     num: 5, label: 'WINNER Scale',     icon: 'barChart',   short: 'Skor' },
  { key: 'grafik',     num: 6, label: 'Grafik Tren',      icon: 'trendingUp', short: 'Grafik' }
];

export const TABS = {
  identitas: IdentitasTab,
  consent: ConsentTab,
  pengkajian: PengkajianTab,
  foto: FotoTab,
  winner: WinnerTab,
  grafik: GrafikTab
};