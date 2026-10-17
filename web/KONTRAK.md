# Kontrak Migration — WoundCare EHR (React)

Dokumen ini mengikat **semua agen** yang mengerjakan migration. Baca entirety
sebelum menyentuh berkas apa pun.

---

## 1. Apa yang TIDAK boleh diubah

Berkas-berkas ini **tidak boleh disentuh sama sekali**:

| Berkas | Alasan |
|---|---|
| `D:\lukamu_lukaku\server.js` | backend + autentikasi + audit. Tak ada satu pun yang perlu berubah. |
| `D:\lukamu_lukaku\db.js` | skema SQLite. Sama. |
| `web\public\lib\*.js` | 8 modul klasik, disalin **byte-identik** dari `assets/js/`. |
| `web\src\lib\index.js` | jembatan ke modul klasik. |
| `web\src\core\field-binding.jsx` | kontrak binding + audit. |
| `web\src\styles\app.css` | disalin utuh dari `style.css`. |
| `web\index.html` | urutan `<script>` klasik itu kritis. |
| `web\src\App.jsx`, `main.jsx`, `data.jsx`, `components\ui.jsx` | kerangka; milik koordinator. |

Kalau ada yang terasa salah di sana, **laporkan**, jangan diubah sendiri.

---

## 2. Dua aturan yang paling sering membuat orang gagal

### 2a. Modul klasik BUKAN ES module

`Store`, `UI`, `Scales`, `Charts`, `Photos`, `PrintDoc`, `API`, `APP_LOGO`
dimuat sebagai `<script>` klasik. **Jangan** `import` berkas di
`web/public/lib/`. Akses lewat:

```js
import { Store, UI, Scales } from '../lib/index.js';
```

### 2b. `UI.badge()` mengembalikan STRING HTML

```js
<span>{UI.badge('Normal', 'ok')}</span>   // ❌ markup tampil mentah
<Badge tone="ok">Normal</Badge>            // ✅
```

`UI.badge()` hanya boleh dipakai di dalam string HTML, bukan di JSX.
Hal serupa berlaku pada `UI.modal()` / `UI.confirm()` / `UI.toast()` — semuanya
imperative dan dipanggil dari event handler, **itu tidak apa-apa di React**.

---

## 3. Kontrak tab

Setiap tab adalah berkas di `web\src\tabs\`:

```jsx
import { FieldProvider, Field, ChipGroup, Check, Row } from '../core/field-binding.jsx';

export default function NamaTab({ patient, visit }) {
  return (
    <FieldProvider patient={patient} visit={visit}>
      {/* isi */}
    </FieldProvider>
  );
}
```

`patient` boleh null. `visit` boleh null (tab identitas, atau belum ada
kunjungan) — tampilkan `empty-state` kalau tab butuh kunjungan tapi `visit` null.

### SCOPE — dibaca otomatis, jangan dipaksa manual

Setiap path tahu sendiri kolom mana yang boleh disentuh:

| Awalan path | Scope | Efek |
|---|---|---|
| `identity.*`, `mrNumber`, `consents` | **pasien** | `Store.touch()` — tanpa audit, tetap jalan saat kunjungan beku |
| `wound.*`, `winner.*`, `photos.*`, `date`, `time`, `dressing.*` | **kunjungan** | audit + `touchVisit` + `syncAudit`, terkunci saat beku |

Jadi `<Field path="wound.lokasi" />` langsung menulis ke kunjungan dan
`<Field path="identity.nama" />` ke pasien. **Tidak perlu** menulis `scope`.
Kalau benar-benar perlu menimpa, tersedia prop `scope="patient" | "visit"`.

> Versi pertama kontrak memakai `visit || patient`. Akibatnya begitu
> kunjungan aktif ada, seluruh kolom `identity.*` jadi kosong. Sudah
> diperbaiki. Kalau menemukan symptom serupa, LAPORKAN — jangan dipatch
> dengan memaksa `visit={null}`.

**Hanya boleh menulis ke model lewat komponen Field / ChipGroup / Check.**
Jangan pernah `setPath()` langsung — audit-nya hilang.

---

## 4. Kelas CSS yang tersedia (jangan buat baru)

Semua sudah ada di `app.css` yang disalin utuh dari `style.css`:

```
.card  .card__head  .card__body  .num
.field  .field__label  .field__hint
.chips  .chip  .chip__dot
.form-row  .form-row--2 .. .form-row--5
.btn  .btn--primary  .btn--danger  .btn--ghost  .btn--sm  .btn-group
.badge  .badge--ok  .badge--warn  .badge--danger  .badge--info  .badge--primary  .badge--muted
.callout  .callout--warn  .callout--danger
.table-wrap  table.data  .row-actions  .num-cell  .empty-state
.stat  .stat--primary  .stat--warn  .stat__label  .stat__value  .stat__foot
.grid  .grid--2 .. .grid--4
.range-wrap  .winner-table  .photo-slot  .winner-total  .sub-band
.dot  .dot--ok  .dot--warn  .dot--muted
.view  .page-head  .page-head__text  .page-head__sub  .page-head__actions
.muted  .num  .is-active
```

Kalau butuh kelas baru, tambahkan **di akhir** `app.css` dengan prefiks
`wc-` dan tulis komentar alasannya. Jangan mengubah aturan yang sudah ada.

---

## 5. Pembagian berkas (TIDAK BOLEH TUMPERAH)

| Agen | Milkyin sendiri |
|---|---|
| 1 | `tabs/IdentitasTab.jsx`, `tabs/ConsentTab.jsx` — **selesai** |
| 2 | `tabs/PengkajianTab.jsx` |
| 3 | `tabs/FotoTab.jsx`, `tabs/GrafikTab.jsx` |
| 4 | `tabs/WinnerTab.jsx`, `routes/SettingsPage.jsx` |

Berkas lain milik agen lain. **Jangan menyuntingnya.** Kalau butuh perubahan di
luar wilayahmu, tulis di laporan, jangan dikerjakan.

---

## 6. Sumber kebenaran: app.js versi lama

Semua isi formulir ada di `D:\lukamu_lukaku\assets\js\app.js` (3446 baris).
Cari renderer tabmu dengan grep, misalnya:

```
renderIdentitas   renderConsent   renderPengkajian   renderWinner   renderFoto   renderGrafik
```

Di dalam fungsi itu ada seluruh daftar field, label, opsi, dan aturan
turunannya. **Salin persis** — jangan menyederhanakan, jangan menambahkan
field, jangan mengubah label.

---

## 7. Aturan turunan

Beberapa nilai dihitung otomatis. Gunakan fungsi yang sudah ada:

```js
import { Scales } from '../lib/index.js';
Scales.total(v.winner)     // total WINNER 13..65
Scales.band(total)         // { short, long, tone } untuk badge
Scales.tissueSum(wound)    // jumlah jaringan
Scales.areaCm2(wound)      // luas luka cm2
Scales.delta(a, b)         // selisih skor antar kunjungan
Scales.trend(...)          // { text, tone } untuk badge tren
Scales.worstItems(...)     // parameter paling buruk
```

Pola `onDerived` pada `FieldProvider` dipakai untuk memuat ulang nilai turunan
setelah ada perubahan. Lihat `refreshDerived()` di app.js lama.

---

## 8. Sebelum menyatakan selesai

WAJIB menjalankan, dari `D:\lukamu_lukaku\web`:

```
npx vite build
```

Harus **BUILD SUCCEEDED tanpa error**. Lalu buka `http://127.0.0.1:5173/`,
login sebagai admin, masuk ke tab kerjamu, dan pastikan:

1. Tab merender isi, bukan "Belum diimplementasikan"
2. **Console browser = 0 error** (F12 → Console)
3. Mengubah satu field → muncul toast / badge "Tersimpan otomatis"
4. Menutup lalu membuka lagi tab → nilainya tersimpan

Kalau langkah 2 gagal, laporkan apa yang muncul di konsol. Jangan
"memperbaiki" dengan cara membatalkan render.

---

## 9. Laporan (wajib, singkat)

1. Daftar berkas yang dibuat/diubah
2. Hasil `npx vite build`
3. Apa yang sudah diverifikasi di browser
4. Yang TIDAK selesai, dan alasannya
5. Apa pun di luar wilayahmu yang perlu diperbaiki koordinator