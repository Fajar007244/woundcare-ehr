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
export const TAB_LIST = [
  { key: 'identitas',  label: '1. Data Pasien',      icon: 'user',       short: 'Pasien' },
  { key: 'consent',    label: '2. Informed Consent', icon: 'fileText',    short: 'Consent' },
  { key: 'pengkajian', label: '3. Pengkajian Luka',  icon: 'activity',   short: 'Luka' },
  { key: 'foto',       label: '4. Foto Luka',        icon: 'camera',     short: 'Foto' },
  { key: 'winner',     label: '5. WINNER Scale',     icon: 'barChart',   short: 'Skor' },
  { key: 'grafik',     label: '6. Grafik Tren',      icon: 'trendingUp', short: 'Grafik' }
];

export const TABS = {
  identitas: IdentitasTab,
  consent: ConsentTab,
  pengkajian: PengkajianTab,
  foto: FotoTab,
  winner: WinnerTab,
  grafik: GrafikTab
};