# Pemulihan & Pencadangan Data

Dokumen ini menjawab satu pertanyaan: **kalau data hilang, dari mana kita ambil
kembali?**

---

## 1. Tiga lapis, tiga sebab yang berbeda

| Lapis | Yang dilindungi | Siapa menjaganya | Otomatis? |
|---|---|---|---|
| **.zip dari aplikasi** | Klinik pindah komputer, arsip, salinan offline | Admin, saat dia mau | Manual |
| **pg_dump terjadwal** | Server atau basis data rusak total | Supabase + GitHub Actions | Tiap malam |
| **PITR Supabase** | Penghapusan tidak sengaja, tanpa jejak aplikasi | Supabase | 7–30 hari |

Semuanya perlu. Pemulihan dari `.zip` butuh server **masih hidup** — kalau
servernya mati, tombol "Unduh" tidak ada. Workflow `pg_dump` menutup lubang
itu, tapi punya jeda harian. PITR menutup sisanya.

---

## 2. Memulihkan dari `.zip` (cara biasa)

**Pengaturan → Data & Cadangan → Pulihkan dari Cadangan.**

Berurutannya:

1. Berkas dibaca dan diperiksa di peramban — **sebelum ada satu baris pun yang
   berubah di server**
2. Ditampilkan isinya: berapa pasien, kunjungan, foto, dan berapa yang akan
   tertimpa
3. Memilih **Gabungkan** (aman) atau **Ganti Total** (menghapus semua, dan
   mewajibkan mengetik `GANTI SEMUA`)
4. **Cadangan data saat ini diunduh otomatis** — jadi selalu ada jalan kembali
5. Foto diunggah satu per satu
6. Terakhir, manifest-nya dikirim

Kalau langkah mana pun gagal di tengah, **tidak ada yang terhapus** — karena
penghapusan baru terjadi di langkah 6.

### Kalau basis datanya masih hidup tapi kacau

Kembalikan berkas `pra-pulihkan-*.zip` yang terunduh otomatis di langkah 4.
Pemulihan itu persis kebalikannya: pilih *Gabungkan*, bukan *Ganti Total*.

---

## 3. Memulihkan dari `pg_dump` (server tidak bisa dipakai)

Tidak lewat antarmuka. Butuh akses shell.

```bash
# 1. Unduh artifact dari GitHub Actions
gh run download <run-number> -n woundcare-db-<run-number>

# 2. Dekripsi
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in woundcare-YYYYMMDDTHHMMSSZ.dump.enc \
  -out woundcare.dump
#   passphrase = secret BACKUP_PASSPHRASE di repository

# 3. Cek checksum DULU — kalau gagal, jangan diteruskan
sha256sum -c woundcare-YYYYMMDDTHHMMSSZ.sha256

# 4. Pulihkan ke database KOSONG
createdb woundcare_restore
pg_restore -d woundcare_restore --no-owner woundcare.dump
```

Jangan pernah memulihkan langsung ke database produksi tanpa memeriksa hasil
`pg_restore` lebih dulu. Kalau dump-nya setengah, hasilnya setengah juga — dan
sekarang ada dua masalah, bukan satu.

---

## 4. PITR Supabase

**Supabase Dashboard → Settings → Database → Point in Time Recovery.**

Ini yang menyelamatkan data ketika ada `DELETE` tanpa `WHERE` yang salah tulis
— kejadian yang **tidak akan pernah muncul di `access_log`**, karena
`access_log` hanya mencatat yang lewat aplikasi.

---

## 5. Yang TIDAK dilindungi — jujur soal itu

- **Seseorang yang masuk ke Dashboard Supabase dan mengganti kata sandinya.**
  Tidak ada yang menahan ini selain kata sandinya kuat dan 2FA aktif.
- **Kode aplikasi yang salah.** Cadangan menyimpan data, bukan logika.
- **Jejak akses lama.** Saat pemulihan *Ganti Total* berjalan, tabel
  `access_log` ikut dikosongkan — snapshot hanya berisi `audit_log`, bukan
  `access_log`. Jadi catatan "siapa yang membuka rekam medis ini" sebelum
  tanggal pemulihan **tidak bisa dipulihkan dari `.zip`**. Untuk itu ada
  `pg_dump` dan PITR.
- **Arsip `.zip` lebih besar dari 4 GB.** Penulis ZIP di `backup-zip.js`
  sengaja menolak lewat 4 GB alih-alih menghasilkan arsip rusak. Untuk data
  sebesar itu, andalkan `pg_dump`.

---

## 6. Yang sudah diuji, dan yang belum

**Sudah diuji:**

- Bolak-balik `.zip` → pemulihan → unduh ulang, **byte-per-byte identik**.
  SHA256 biner foto sebelum dan sesudah sama: `39b9f9cdd46a1b3f…`, 20.096 byte.
- Penulisan ZIP dibaca ulang oleh `Expand-Archive` Windows — implementasi
  lain, bukan yang kita tulis — tanpa complaint.
- Penolakan arsip rusak: entri tanpa `id`, snapshot bukan array, dan Escape
  pada dialog — semuanya ditolak tanpa menyentuh data.
- Pembaca ZIP di peramban membaca arsip yang sama dan mengekstrak semua foto.

**Belum diuji:**

- Memulihkan `.zip` ke database yang sama sekali berbeda.
- Workflow `pg_dump` — butuh dua secret repository yang belum diisi.
- Pemulihan dari arsip berukuran besar (ratusan foto).