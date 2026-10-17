/* Peta tab → komponen.
 *
 * INI-placeholder. Setiap agen akan mengganti isi tabnya sendiri di
 * berkas terpisah (tabs/IdentitasTab.jsx, tabs/WinnerTab.jsx, dst).
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
   "Informed Consent", bukan "Persetujuan". */
export const TAB_LIST = [
  { key: 'identitas',  label: '1. Data Pasien' },
  { key: 'consent',    label: '2. Informed Consent' },
  { key: 'pengkajian', label: '3. Pengkajian Luka' },
  { key: 'foto',       label: '4. Foto Luka' },
  { key: 'winner',     label: '5. WINNER Scale' },
  { key: 'grafik',     label: '6. Grafik Tren' }
];

export const TABS = {
  identitas: IdentitasTab,
  consent: ConsentTab,
  pengkajian: PengkajianTab,
  foto: FotoTab,
  winner: WinnerTab,
  grafik: GrafikTab
};