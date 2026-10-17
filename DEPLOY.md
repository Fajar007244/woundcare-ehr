# Deploy ke Vercel — langkah demi langkah

Aplikasi ini sekarang memakai **PostgreSQL**, bukan SQLite. Alasannya satu
dan tidak bisa ditawar: **Vercel tidak punya disk yang awet.** Filesystem-nya
ephemeral dan read-only, jadi berkas `woundcare.db` akan lenyap beberapa
menit setelah deploy. Data harus hidup di luar server.

---

## Bagian 1 — Siapkan database di Supabase

1. Buka [supabase.com](https://supabase.com) → **New project**
2. Simpan **password database**-mu — hanya muncul sekali, catat baik-baik
3. Tunggu beberapa menit sampai project selesai dibuat
4. Buka **Settings → Database → Connection string → URI**

Kamu akan melihat dua baris:

| | Port | Untuk |
|---|---|---|
| Direct connection | 5432 | psql, migrasi lokal |
| **Session pooler** | **6543** | **Serverless — pakai ini** |

> **Pakai yang port 6543 (pooler).** Vercel menjalankan banyak instance
> sekaligus. Koneksi langsung ke database akan kehabisan jatah koneksi
> dalam hitungan menit.

Formatnya:

```
postgresql://postgres:PASSWORD@db.XXXXXXXXXXXX.supabase.co:6543/postgres
```

**Penting:** kalau password-mu mengandung `@ : / ? # [ ] %`, harus
di-URL-encode. Password `%` jadi `%25`, `@` jadi `%40`, dan seterusnya.

---

## Bagian 2 — Pindahkan data lama ke PostgreSQL

Supabase masih kosong. Data 3 pasien yang ada sekarang masih di SQLite.

```bash
# 1. salin contoh jadi .env
copy .env.example .env        # Windows
cp .env.example .env          # macOS/Linux

# 2. edit .env, isi DATABASE_URL

# 3. jalankan migrasi
npm install
node migrate-sqlite.cjs
```

Hasilnya kalau berhasil:

```
  Sumber  : D:\lukamu_lukaku\data\woundcare.db
  Tujuan  : PostgreSQL (melalui db.js)

  [1/5] skema PostgreSQL siap
  [2/5] 3 pasien
  [3/5] 1 foto (BLOB -> BYTEA)
  [4/5] 6 kunjungan
  [5/5] 3 persetujuan
```

Skripnya **aman dipanggil ulang** — patients, kunjungan, dan foto ditulis
dengan upsert berdasarkan id, jadi tidak akan duplikat.

---

## Bagian 3 — Uji di komputer dulu

Jangan langsung deploy. Pastikan lokal dulu:

```bash
npm start        # http://localhost:8080
```

Kalau banner memuat `Basis data: PostgreSQL`, berarti sudah nyambung.
Cek di browser: login → daftar pasien muncul → buka rekam medis.

---

## Bagian 4 — Upload ke Vercel

Proyek ini **belum** jadi repo git, jadi harus dibuat dulu:

```bash
git init
git add .
git commit -m "WoundCare EHR - React + PostgreSQL"
```

`.gitignore` sudah disiapkan untuk **tidak** ikut mengunggah:
`data/`, `*.db`, `.env`, `node_modules/`, `web/dist/`

Lalu:

```bash
npm i -g vercel
vercel          # ikuti petunjuk, pilih Yes untuk framework
```

Saat diminta Environment Variables, tambahkan:

| Nama | Nilai |
|---|---|
| `DATABASE_URL` | connection string dari Bagian 1 |

Terakhir:

```bash
vercel --prod
```

Vercel otomatis menjalankan `npm install`, build Vite, lalu menyajikannya
lewat HTTPS.

---

## Bagian 5 — Setelah online

### GANTI SEMUA SANDI

Ini **wajib**, bukan opsional. Di data contoh ada tiga akun, semuanya
sandi `woundcare123`:

```
admin / woundcare123
slamet / woundcare123
perawat / woundcare123
```

Selama sandi itu apa adanya, siapa pun yang tahu URL-mu bisa masuk dan
membaca seluruh rekam medis. Untuk demo, ganti dulu minimal akun `admin`
lewat **Pengaturan → Kelola Akun**. Kalau tidak, nonaktifkan saja dua
akun lain yang tidak dipakai.

### Cek header keamanan

`vercel.json` sudah menyertakan `X-Frame-Options`, `nosniff`, dan
`Referrer-Policy`. Kalau butuh HTTPS keras, tambahkan
`Strict-Transport-Security`.

### Batas yang perlu diketahui

| | Plans |
|---|---|
| Batas body fungsi | 4,5 MB (kita pakai 3 MB untuk foto) |
| Batas durasi fungsi | Hobby: 10 detik |
| Foto | Disimpan sebagai `bytea` di database — bukan ideal untuk skala besar |

Kalau nanti klinik riil dan foto sudah banyak, pindahkan fotonya ke
**Supabase Storage** dan simpan hanya URL-nya di baris. Itu perubahan
terpisah, bukan bagian deploy ini.

---

## Kalau ada masalah

**`DATABASE_URL belum diisi`** — variabel belum terpasang. Di Vercel:
Settings → Environment Variables, lalu ** redeploy** (Settings →
Environment Variables → menu ⋮ → Redeploy). Vercel hanya membaca env
saat build/deploy.

**`Connection terminated unexpectedly` / `too many connections`** — masih
pakai port 5432. Ganti ke **6543** (session pooler).

**Halaman kosong, API 500** — buka **Vercel → Logs**. Error asli ada di
sana; di browser cuma tampil pesan umum.

**`relation "users" does not exist`** — skema belum dibuat. Jalankan
`node migrate-sqlite.cjs` saja (tanpa `--demo`); itu yang membuat tabel.