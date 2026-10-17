# WoundCare EHR

Aplikasi web untuk **Formulir Rekam Medis & Manajemen Klinis Perawatan Luka Modern**.
Berjalan di server lokal Node.js dengan basis data **SQLite**, dilindungi halaman masuk.

---

## Menjalankan

### Aplikasi React (antarmuka baru)

```bash
cd web
npm install          # sekali saja
npm run dev          # http://localhost:5173
```

Backend tetap `node server.js` di port 8080 dan **tidak berubah sama
sekali**; Vite meneruskan `/api` ke sana lewat proxy.

Untuk build produksi:

```bash
cd web
npm run build        # hasil di web/dist/
```

### Aplikasi lama (masih utuh)

```bash
node server.js       # http://localhost:8080
```

Keduanya memakai basis data yang sama, jadi **berhati-hati membuka keduanya
sekaligus** lalu mengedit dari dua tempat.

---

```bash
node server.js
# buka http://localhost:8080
```

Butuh **Node.js 22 ke atas** (untuk modul bawaan `node:sqlite`).
**Tidak ada `npm install`** — seluruh aplikasi berjalan tanpa satu pun dependensi.

> **Aplikasi ini tidak bisa dibuka dengan klik dua kali `index.html`.**
> Halaman masuk, sesi, dan basis data semuanya butuh server.
> Membuka lewat `file://` akan menampilkan peringatan.

### Akun awal

| Username | Peran | Sandi |
|---|---|---|
| `admin` | Admin | `woundcare123` |
| `slamet` | Dokter | `woundcare123` |
| `perawat` | Perawat | `woundcare123` |

Hapus akun percobaan dan buat milik sendiri setelah sistem berjalan.

### Lokasi basis data

`data/woundcare.db` — dibuat otomatis saat pertama kali server dijalankan.
Salin berkas ini untuk cadangan; hapus folder `data/` untuk mulai dari nol.

---

## Struktur aplikasi React (`web/`)

Antarmuka ditulis ulang memakai **React 19 + Vite 7**. Yang **tidak** ditulis
ulang adalah otaknya:

| Yang | Status |
|---|---|
| `server.js`, `db.js` | **tidak berubah satu baris pun** |
| `scales` `store` `api` `ui` `photos` `charts` `logo` `print` | disalin **byte-identik** ke `web/public/lib/` |
| `assets/js/app.js` (3446 baris) | inilah yang diganti jadi komponen React |

Delapan modul itu **memang tidak boleh diimpor sebagai ES module**. Semuanya
berbentuk `const UI = (() => {...})()`, dan `const` tingkat atas di ES module
hanya hidup di modul itu sendiri — diimpor, ketujuhnya tidak saling melihat
dan hasilnya `UI is not defined`. Karena itu dimuat sebagai `<script>` klasik,
dan `public/lib/globals.js` menempelkannya ke `window`.

### Kontrak binding

`web/src/core/field-binding.jsx` adalah tempat seluruh audit form terjadi.
Tab **tidak boleh** menulis ke model lewat `setPath()` langsung — auditnya
hilang. Dua scope dibedakan otomatis dari awalan path:

| Awalan | Scope | Efek |
|---|---|---|
| `identity.*`, `mrNumber` | pasien | `Store.touch()`, tanpa audit |
| `wound.*`, `winner.*`, `photos.*`, `date`, `time` | kunjungan | audit + `touchVisit`, terkunci saat beku |

Semantik ini disalin apa adanya dari `app.js` lama, termasuk daftar `RISKY`
yang dipakai untuk konfirmasi kolom berisiko pada kunjungan yang sudah lewat.

### Mengubah modul klasik

Kalau `assets/js/*.js` ikut diubah, salin ulang ke `web/public/lib/` supaya
kedua aplikasi tetap sama:

```powershell
Copy-Item assets\js\charts.js web\public\lib\charts.js -Force
```

### Pemeriksaan karakter asing

```bash
node cek-karakter.js
```

Menarik keluar karakter CJK / Cyrillic / Hangul yang kadang bocor dari
proses edit otomatis. Selalu jalankan sebelum commit — sel beberapa enter
di proyek ini.

---

```
index.html                 kerangka aplikasi + titik muat seluruh modul
login.html                 halaman masuk
server.js                  server HTTP: berkas statis + REST API + autentikasi
db.js                      skema SQLite, kueri, hashing sandi, sesi
assets/
  images/
    logo.png              logo instantsi (296 x 296, transparan)
  css/
    style.css              tema antarmuka (klinis, responsif)
    login.css              gaya halaman masuk
    print.css              aturan cetak A4 (@page, @media print)
  js/
    api.js                 klien HTTP (cookie sesi)
    logo.js                logo sebagai data URI untuk dokumen cetak
    scales.js              definisi 13 parameter WINNER Scale + utilitas skor
    store.js               model domain + antrean sinkronisasi ke server
    ui.js                  helper: modal, toast, tooltip, lightbox, format
    photos.js              kompresi & penyimpanan foto luka
    charts.js              grafik tren (canvas murni, tanpa pustaka)
    print.js              penyusun dokumen cetak
    app.js                 router, view, dan perekat formulir
```

---

## Keamanan

| Aspek | Penerapan |
|---|---|
| Sandi | `scrypt` (N=16384) dengan salt acak per pengguna, dibandingkan dengan `timingSafeEqual` |
| Sesi | token acak 32 byte, tabel `sessions`, kedaluwarsa 12 jam |
| Cookie | `HttpOnly` + `SameSite=Strict` — tidak terbaca JavaScript |
| SQL | seluruh kueri memakai prepared statement berparameter |
| Percobaan login | maks. 8 gagal / 10 menit per kombinasi IP + username |
| Berkas | folder `data/` dan berkas `.db` ditolak oleh server statis |
| Traversal | path dinormalisasi dan diperiksa tetap di dalam akar proyek |

### Hak akses berdasarkan peran

Pembatasan peran ditegakkan **di server** (`requireAdmin()`), bukan hanya
disembunyikan lewat CSS. Non-admin yang mencoba memanggil endpoint-nya secara
langsung tetap mendapat `403`.

| Tindakan | Admin | Dokter / Perawat |
|---|:--:|:--:|
| Buka, isi, ubah rekam medis | ✅ | ✅ |
| Tambah pasien, tambah kunjungan | ✅ | ✅ |
| Cetak rekam medis & daftar pasien | ✅ | ✅ |
| Ganti sandi sendiri | ✅ | ✅ |
| **Hapus pasien** | ✅ | ❌ `403` |
| **Hapus kunjungan** | ✅ | ❌ `403` |
| **Hapus berkas persetujuan** | ✅ | ❌ `403` |
| **Lihat Riwayat Akses** | ✅ | ❌ `403` |
| Menu **Pengaturan** (identitas klinik, cadangan, hapus semua) | ✅ | ❌ `403` |
| Tombol **Muat Data Contoh** | ✅ | ❌ |
| Kelola pengguna (`/api/users*`) | ✅ | ❌ `403` |

Dua lapis sekaligus: tombolnya **tidak dirender** untuk non-admin, dan endpoint-nya
menolak dengan `403` bila tetap dipanggil. Menutup hanya satu lapis tidak cukup —
lapis UI bisa dilewati lewat konsol.

Penghapusan dikunci karena tidak dapat dibatalkan; semua isi rekam medis lain
(bisa disalin, tidak merusak apa pun) tetap terbuka untuk semua petugas.
Duplikasi kunjungan dan penggantian isi formulir **tidak** dikunci — keduanya
tidak menghapus apa pun.

Berkas persetujuan ikut dikunci karena berisi tanda tangan pasien dan
menjadi bukti hukum, jadi tidak sewajarnya bisa dihapus oleh petugas mana pun.

### Membaca jejak vs menulis jejak

`POST /api/access` **tidak** memakai `requireAdmin` — ditutup, jejaknya justru
jadi bolong. Semua petugas tetap bisa mencatat bahwa mereka membuka, mencetak,
atau mengubah rekam medis; hanya admin yang boleh **membaca** catatannya.
Non-admin yang mencoba memanggil API-nya secara langsung mendapat:

```
403 Hanya admin yang boleh.
```

### Paginasi tabel

Riwayat akses dipaginasikan **10 baris per halaman** (`PER_HALAMAN` di `app.js`).
Nomor halaman yang ditampilkan: pertama, terakhir, posisi saat ini ±1 — dan
karena itu lompatannya dibatasi titik elipsis, tidak menjadi puluhan tombol
ketika data sudah menumpuk:

```
[‹] 1  2  3  4  …  10  [›]
      ‹  1  …  7  8  9  10  ›
      ‹  1  …  4  5  6  7  [›]
```

Bilah paginasi dibuat `position: sticky` di dalam modal yang bisa digulir.
Tanpa itu, 10 baris selalu lebih tinggi daripada jendela dan tombolnya
tenggelam di bawah lipatan — terjangkau hanya setelah menggulir ke paling
bawah. Padding bawah modal dikecilkan saat paginasi hadir
(`.modal__body--paged`) supaya bilah itu menempel rata di tepi bawah, baik
saat sedang dijepit di atas maupun saat sudah tergulir habis.

Nomor baris yang sedang tampil selalu ditulis di kiri
(*"Menampilkan 11–20 dari 94 kejadian · halaman 2 dari 10"*), jadi posisi
tidak pernah harus ditebak dari menatap daftar.

Helper-nya (`pager()` + `nomorHalaman()`) sengaja dibuat umum, bukan
tertanam di `openAccessLog()`, karena tabel **Daftar Pasien Aktif** punya
kebutuhan yang sama tinggal memakai ulang.

Tiga tempat memakainya, semuanya seragam:

| Tempat | Sumber |
|---|---|
| Modal Riwayat Akses Klinik (menu akun) | seluruh klinik |
| Modal Riwayat Akses per pasien (bar pasien) | satu pasien, kolom *Rekam Medis* disembunyikan |
| Kartu Riwayat Akses di halaman Pengaturan | seluruh klinik |

Kartu di Pengaturan sebelumnya hanya menarik **12 baris terakhir** dengan
empat kolom — jadi yang terlihat di sana berbeda dari yang terlihat di modal.
Kini keduanya identik: lima kolom lengkap dengan *Keterangan*, 10 baris per
halaman, paginasi yang sama. Tombol *Lihat Riwayat Akses Klinik* yang membuka
modal dengan isi yang sama persis dihapus, karena setelah itu hanya ada satu
cara membaca daftar itu.

Rekap *per petugas* di bawah tabel dihitung dari **seluruh** data yang
dimuat, bukan hanya halaman yang sedang tampil — kalau dihitung per halaman,
"Administrator (12)" akan berubah-ubah tiap kali pindah halaman dan tidak
berarti apa-apa.

`POST /api/users/password` sengaja **tidak** memakai `requireAdmin` — kalau
dikunci, setiap petugas terkunci dari akunnya sendiri.

### Admin terakhir tidak bisa dinonaktifkan

`setActive()` menolak menonaktifkan admin aktif terakhir:

```
Ini admin aktif terakhir. Promosikan pengguna lain ke peran Admin lebih dulu.
```

Kalau diizinkan, seluruh akses admin mati permanen dan tidak ada yang bisa
memulihkannya dari dalam aplikasi. Server mengembalikan `400`, bukan `500`,
supaya pesannya sampai ke antarmuka.

### Kelola Akun

Kartu **Kelola Akun** (Pengaturan &rarr; iii) ialah antarmuka untuk mengelola
petugas: menambah akun, mengubah peran, menonaktifkan, dan menyetel ulang sandi
yang lupa.

| Peran | Isi & ubah formulir | Hapus rekam medis | Riwayat akses | Pengaturan |
|---|:--:|:--:|:--:|:--:|
| Admin | ✅ | ✅ | ✅ | ✅ |
| Dokter / Perawat Senior | ✅ | ❌ | ❌ | ❌ |
| Perawat / Terapis / Administrasi | ✅ | ❌ | ❌ | ❌ |

Pilihan peran dibatasi ke `PERAN_VALID` di `db.js`
(`Admin`, `Dokter`, `Perawat`, `Perawat Senior`, `Terapis`, `Administrasi`).
Nilai di luar daftar itu diturunkan menjadi `Perawat` oleh `normalPeran()`, dan
`app.js` punya salinan daftar yang sama untuk dropdown-nya — server tetap
sumber kebenaran, bukan peramban.

Tiga pagar yang sengaja dipasang, karena ketiganya pernah jadi sumber celah:

1. **Admin aktif terakhir** tidak bisa dinonaktifkan (`setActive()`) maupun
   diturunkan perannya (`setRole()`). Keduanya menolak dengan pesan yang sama.
2. **`createUser()` mengembalikan kolom eksplisit**, bukan `SELECT *`.
   `findUser()` memakai `SELECT *` sehingga memuat `password_hash` dan `salt` —
   kalau ikut terkirim, peramban memegang bahan baku curian sandi untuk
   setiap akun yang dibuat.
3. **Sandi minimal 8 karakter ditegakkan di ketiga jalur** —
   `createUser()`, `adminSetPassword()`, dan `POST /api/users/password`.
   Jalur terakhir sudah ada sejak awal; dua yang lain baru ditambahkan karena
   bisa membuat akun bersandi `"123"`.

Menyetel ulang sandi **milik sendiri** ikut memutus sesi yang sedang aktif,
karena cookie lama tidak boleh tetap hidup setelah sandinya berubah. Untuk
petugas lain, seluruh sesinya juga dicabut di server.

Akun **tidak pernah dihapus sendiri**, hanya dinonaktifkan — **kecuali** satu
alasan yang benar: menghapus admin aktif terakhir mematikan seluruh akses admin.
`deleteUser()` menolak hal itu dengan pesan yang sama seperti `setActive()`.

Menghapus akun **tidak merusak catatan jejak**. `audit_log.oleh_nama` dan
`access_log.oleh_nama` memang disalin ke dalam baris catatan itu sendiri, dan
kolom `oleh_id`-nya sengaja **tanpa** foreign key ke `users` — justru supaya
nama petugas tetap terbaca setelah akunnya tidak ada. Yang punya
`ON DELETE CASCADE` hanya `sessions.user_id`, jadi sesi petugas yang dihapus
langsung ikut mati, sedangkan catatan audit dan akses tetap utuh.

Bukti diuji: satu akun dibuat, ia masuk dan menghasilkan 4 catatan akses,
akunnya dihapus — keempat catatan masih ada utuh berikut nama dan waktunya.
Pasien yang pernah ia buat juga tidak menjadi yatim.

Sesi pemakaiannya: tombol **Hapus** baru muncul pada akun yang sudah
nonaktif. Jadi urutannya "nonaktifkan dulu, hapus kalau memang harus hilang",
dan tidak ada rekaman yang terhapus karena satu klik keliru.

Kendala yang tersisa, dan memang tidak bisa dihilangkan: menghapus akun
yang sedang dipakai sendiri ditolak (`Anda tidak bisa menghapus akun yang sedang
dipakai`). Nonaktifkan saja sudah cukup untuk mencabut aksesnya.

---

## Basis data

Enam tabel. Data klinis yang bentuknya berubah-ubah disimpan sebagai JSON pada
kolom `data`, sedangkan kolom yang perlu dicari atau diurutkan diekstrak menjadi
kolom biasa.

| Tabel | Isi |
|---|---|
| `users` | akun petugas: username, nama, peran, hash sandi, salt |
| `sessions` | token sesi, pengguna, waktu kedaluwarsa |
| `patients` | identitas pasien + kolom pencarian (nama, NIK, telepon) |
| `visits` | satu baris per kunjungan: tanggal, skor, status beku, isi JSON |
| `consents` | berkas persetujuan tindakan |
| `audit_log` | **tabel sendiri** untuk jejak perubahan — kolom, sebelum, sesudah, petugas, waktu |
| `access_log` | **tabel sendiri** untuk jejak akses — siapa membuka/mencetak/mengubah apa, dari IP mana |

Audit dipisah ke tabel sendiri karena nilainya bukan cache: inilah yang membuat
"siapa mengubah apa, kapan" bisa dijawab langsung dengan SQL, dan tidak ikut
hilang saat data kunjungan di-ganti.

### Jejak akses vs jejak audit

Keduanya berbeda dan keduanya perlu:

| | Menjawab pertanyaan |
|---|---|
| `audit_log` | *Isi apa yang berubah?* kolom, nilai lama → baru |
| `access_log` | *Siapa yang menyentuh data ini?* membuka, mencetak, membuat, menghapus |

Keduanya hanya bisa ditulis **dari server**. Klien hanya boleh mengirim
`patientId`, `aksi`, dan keterangan — nama petugas diambil dari sesi login, dan
nama pasien diambil dari tabel `patients`. Percobaan menyisipkan `patientNama`
atau `oleh_nama` palsu akan diabaikan begitu saja, dan `aksi` yang tidak dikenal
jatuh ke `lihat`.

Aksi yang tercatat: `lihat`, `buat`, `ubah`, `hapus`, `cetak`, `pulih`.
Lihat lewat **Riwayat Akses** pada bar pasien, atau kartu **Riwayat Akses** di
menu Pengaturan.

### Yang perlu diperkuat nanti

- Belum ada pencadangan otomatis. Salin `data/woundcare.db` secara berkala.
- Sesi disimpan di SQLite, jadi seluruh petugas berbagi satu berkas.
- `roles` baru berupa label — belum membatasi apa yang boleh dilakukan.
- `detail` pada `access_log` masih diisi dari klien, jadi isinya belum tepercaya
  seperti kolom `patient_nama` dan `oleh_nama`.
- Riwayat akses sudah ada, tetapi belum ada **penyuntingan rekam medis** yang
  tercatat terpisah dari `audit_log` (keduanya memang Purpose berbeda).

Seluruh skrip adalah **classic script** (bukan ES module) agar aplikasi tetap bisa
dijalankan langsung dari `file://`.

---

## Bagian formulir

| Tab | Isi |
|---|---|
| 1. Data Pasien | Identitas, kontak darurat, riwayat alergi, komorbid |
| 2. Informed Consent | Persetujuan tindakan, riwayat berkas persetujuan |
| 3. Pengkajian Luka | Etiologi, ukuran, undermining, jaringan dasar, eksudat, bau, TIME, NRS |
| 4. Foto Luka | Unggah foto sebelum & sesudah, mistar, galeri per kunjungan |
| 5. WINNER Scale | 13 parameter berskor 1–5, total otomatis, analisis parameter kritis |
| 6. Grafik Tren | Grafik skor, luas luka, nyeri; riwayat; timeline |

---

## WINNER Wound Assessment Scale

13 parameter, masing-masing diberi skor **1–5**. Semua parameter memakai arah yang sama:

> **Skor tinggi = kondisi luka lebih buruk.**
> **Total minimum 13** (epitelisasi lengkap / kondisi beban jaringan minimal) · **maksimum 65** (sangat buruk).

| Rentang | Band |
|---|---|
| 13 | Sembuh / epitelisasi lengkap |
| 14–24 | Sangat ringan |
| 25–38 | Ringan – sedang |
| 39–52 | Sedang – berat |
| 53–65 | Sangat buruk |

Jangkar skor tiap parameter ada di `assets/js/scales.js` dan tampil lewat tooltip
(arahkan kursor ke tanda **?** atau ke angka 1–5). Ubah di sana bila institusi
memakai kriteria berbeda.

### Perhitungan otomatis

Tombol **Isi Otomatis dari Pengkajian** memetakan data Bagian 3 ke skor WINNER:

- luas luka (panjang × lebar) → parameter *size*
- kedalaman → *depth*
- tepi luka → *edges*
- kedalaman gua → *undermining*
- jaringan nekrotik + slough → *necrotic type / amount*
- tipe & jumlah eksudat → *exudate type / amount*
- tanda Rubor → *skin color*
- jaringan granulasi & epitel → *granulation / epithelialization*

Dua parameter (**edema** dan **indurasi jaringan sekitar**) **tidak** diisi otomatis
karena tidak dapat diturunkan dari isian Bagian 3 — keduanya harus dinilai manual.

Skor yang sudah dinilai manual tidak akan ditimpa.

---

## Penyimpanan & cadangan

Semua data disimpan pada **SQLite di server lokal** (`data/woundcare.db`), bukan
di peramban. Setiap komputer yang membuka aplikasi ini melihat data yang sama.

Konsekuensinya:

- menutup peramban atau mengganti komputer → **data tetap ada**
- mengosongkan cache peramban → **tidak menghapus apa pun**
- seluruh petugas berbagi satu berkas basis data

Server berjalan di `localhost` dan tidak pernah mengirim data ke internet.
Namun data tetap hilang bila server atau komputer rusak, karena belum ada
pencadangan otomatis.

Karena itu, menu **Pengaturan** menyediakan:

- **Unduh Cadangan (JSON)** — simpan seluruh basis data
- **Pulihkan dari Cadangan** — gabungkan dengan data lama, atau ganti total
- **Ekspor Kunjungan (CSV)** — untuk diolah di Excel

Cara paling aman: salin `data/woundcare.db` secara berkala (matikan server dulu).

Foto luka dikompresi otomatis ke JPEG (maks. 1000 px sisi terpanjang, kualitas
diturunkan bertahap bila muatan membesar) agar basis data tetap ramping.

---

## Jejak Audit (pengganti gembok)

Formulir kunjungan **selalu bisa diedit**. Tidak ada lagi kunci yang menghalangi,
karena mengunci form justru menghalangi hal yang paling sering dibutuhkan
di klinik: membaca dan menyunting data.

Yang menggantikannya adalah dua hal:

### 1. Setiap perubahan tercatat otomatis

Begitu satu kolom berubah, aplikasi menyimpan: nama kolom, nilai lama, nilai baru,
petugas, dan waktunya. Perubahan beruntun pada kolom yang sama dalam 90 detik
digabung menjadi satu entri agar log tetap terbaca.

Kolom yang baru berubah diberi **sorotan hijau selama sekitar 2 detik** dan tertaut
petugas yang mengubahnya. Tombol **Riwayat** pada bar kunjungan menampilkan
seluruh riwayat, dikelompokkan per tanggal, dengan penanda **berisiko** untuk kolom
yang memengaruhi kesimpulan klinis.

### 2. Konfirmasi hanya untuk kolom berisiko

Kolom berikut meminta konfirmasi **hanya bila kunjungan yang diubah sudah lewat
(bukan hari ini)**:

| Kolom | Kenapa berisiko |
|---|---|
| Tanggal kunjungan | menentukan urutan kronologis |
| Skor WINNER | menentukan skor total |
| Panjang / lebar / kedalaman luka | menentukan luas luka |
| Persentase jaringan dasar | menentukan proporsi jaringan |

Klik **Batal** mengembalikan nilai semula dan tidak menambah entri audit.
Kunjungan hari ini tidak pernah dimintai konfirmasi, supaya bekerja cepat.

### 3. Bekuan (opsional, nonaktif secara default)

Tombol **Bekukan** berfungsi bila sebuah kunjungan perlu dijaga agar tidak berubah,
misalnya saat sengketa atau permintaan audit. Setelah dibekukan, formulir tampil
read-only dengan banner biru, dan tetap bisa dibuka lagi.

### Daftar kontrol

| Tombol | Fungsi |
|---|---|
| `Riwayat (n)` | membuka riwayat perubahan kunjungan ini |
| `Bekukan` | membekukan / membuka bekuan kunjungan |
| `Duplikasi` | menyalin kunjungan untuk pengisian cepat |
| `Hapus Kunjungan` | menghapus kunjungan |

### Untuk database nanti

Audit saat ini sudah tersimpan permanen di dalam data kunjungan (`visit.audit`),
jadi tidak hilang ketika tab ditutup. Saat backend tersedia, salin baris-baris ini
ke tabel audit terpisah dengan kolom `petugas`, `waktu`, `kunjungan`, `kolom`,
`sebelum`, dan `sesudah`, beserta ID petugas dari server.

Kolom berisiko didefinisikan di satu tempat: konstanta `RISKY` di
`assets/js/app.js`. Menambah atau mengurangi kolom yang dimintai konfirmasi cukup
mengubah fungsi `test`-nya di sana.


## Mencetak

Tombol **Cetak Rekam Medis** atau `Ctrl + P` menghasilkan dokumen A4 yang memuat:

1. Kop klinik (isi di menu Pengaturan)
2. Data pasien
3. Informed consent dengan kolom tanda tangan
4. Pengkajian luka + foto, per kunjungan
5. Tabel WINNER Scale lengkap dengan skor terisi
6. Grafik tren dan tabel ringkasan
7. Blok tanda tangan pasien, perawat, dan dokter

Setiap kunjungan dimulai pada halaman baru. Untuk mencetak daftar seluruh pasien,
cetak dari halaman utama.

### Catatan tentang logo pada dokumen cetak

Logo kop disisipkan sebagai **data URI** (`assets/js/logo.js`), bukan path berkas.
`<img>` pada dokumen cetak dibuat di dalam event `beforeprint`, dan peramban bisa
memotret halaman sebelum berkas gambar selesai diunduh — hasilnya logo kosong.
Data URI tersedia seketika tanpa proses unduh, sehingga logo selalu tercetak.

Bila logo ingin diganti, taruh berkas baru di `assets/images/logo.png`, lalu
bangun ulang `logo.js` dengan data URI dari gambar tersebut.

---

## Catatan klinis

Aplikasi ini adalah **alat bantu dokumentasi**. Seluruh hasil pengkajian,
termasuk skor WINNER, memerlukan verifikasi klinis oleh tenaga kesehatan
kompeten yang bertanggung jawab atas pasien. Skala yang diimplementasikan
mengikuti praktik wound severity scoring yang lazim (Danger Foot Score,
Sussman–Culp), dan jangkar skornya dapat disesuaikan di `scales.js`.

---

## Pengujian

Seluruh berkas JS dapat diperiksa secara sintaks:

```bash
node --check assets/js/scales.js   # dan seterusnya
```
