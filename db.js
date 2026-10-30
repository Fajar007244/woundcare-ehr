/* ============================================================
   db.js  ESkema & akses data PostgreSQL (Supabase)
   ============================================================
   Versi PostgreSQL dari lapisan data. NAMA FUNGSI DAN PERILAKUNYA
   sama persis dengan versi SQLite sebelumnya, jadi server.js tidak
   perlu tahu mesin datanya yang diganti  Ehanya menjadi async.

   Yang berubah dari versi SQLite:
     - prepare/run/get/all  ->  pool.query(sql, params)
     - placeholder ?        ->  $1, $2, $3
     - INTEGER AUTOINCREMENT->  SERIAL
     - PRAGMA / WAL         ->  dihapus (Postgres sudah MVCC)

   KONEKSI
     Database        : process.env.DATABASE_URL
     pooled (port 6543) untuk serverless, langsung (5432) untuk lokal
     SSL             : otomatis menyala untuk host jarak jauh

   Kenapa tidak SQLite di sini: Vercel (dan/serverless mana pun)
   filesystem-nyaephemeral dan read-only. Berkas .db lenyap tiap
   beberapa menit. PostgreSQL menyimpan data di luar server, jadi
   data tetap ada antar-restart dan antar-instance.
   ============================================================ */

const crypto = require('node:crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';

/* Pool dibuat SEKALI di tingkat modul. Di serverless setiap instance
   bisa Davies dipakai beberapa permintaan berturut-turut, jadi
   pool yang sama dipakai ulang  Emembuat koneksi baru tiap permintaan
   justru itu yang membuat serverless lambat dan menghabiskan kuota. */
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL && !/localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined
});

pool.on('error', (e) => {
  console.error('[db] kesalahan pool (koneksi idle terputus):', e.message);
});

/* ---------- Skema ---------- */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  nama           TEXT NOT NULL,
  peran          TEXT NOT NULL DEFAULT 'Perawat',
  password_hash  TEXT NOT NULL,
  salt           TEXT NOT NULL,
  aktif          INTEGER NOT NULL DEFAULT 1,
  dibuat         TEXT NOT NULL,
  terakhir_masuk TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dibuat  TEXT NOT NULL,
  expires TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id        TEXT PRIMARY KEY,
  mr_number TEXT NOT NULL,
  nama      TEXT NOT NULL DEFAULT '',
  nik       TEXT NOT NULL DEFAULT '',
  telepon   TEXT NOT NULL DEFAULT '',
  data      TEXT NOT NULL,
  archived  INTEGER NOT NULL DEFAULT 0,
  dibuat    TEXT NOT NULL,
  diubah    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tanggal    TEXT NOT NULL DEFAULT '',
  jam        TEXT NOT NULL DEFAULT '',
  skor       INTEGER,
  frozen     INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  dibuat     TEXT NOT NULL,
  diubah     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tanggal    TEXT NOT NULL DEFAULT '',
  data       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  visit_id   TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  kolom      TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  sebelum    TEXT NOT NULL DEFAULT '',
  sesudah    TEXT NOT NULL DEFAULT '',
  risky      INTEGER NOT NULL DEFAULT 0,
  oleh_id    INTEGER,
  oleh_nama  TEXT NOT NULL DEFAULT '',
  pada       TEXT NOT NULL
);

/* Riwayat akses: siapa membuka / mencetak / mengubah data pasien.
   Identitas petugas SELALU diambil dari sesi server, tidak pernah dari
   body permintaan, supaya catatan ini tidak bisa dipalsukan dari sisi klien. */
CREATE TABLE IF NOT EXISTS access_log (
  id           SERIAL PRIMARY KEY,
  patient_id   TEXT,
  patient_nama TEXT NOT NULL DEFAULT '',
  patient_rm   TEXT NOT NULL DEFAULT '',
  aksi         TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  oleh_id      INTEGER,
  oleh_nama    TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  pada         TEXT NOT NULL
);

/* Foto luka disimpan sebagai BLOB (bytea), bukan base64 di dalam kolom
   data. Base64 membengkakkan berkas 33%, dan ikut terkirim di setiap
   GET /api/data padahal belum tentu dibuka.
   visit_id sengaja TANPA foreign key: unggahan bisa tiba sebelum
   kunjungan sempat tersimpan, dan pembersihannya eksplisit
   (deleteVisit / deletePatient) supaya tidak ada foto yatim. */
CREATE TABLE IF NOT EXISTS photos (
  id       TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL,
  kind     TEXT NOT NULL,
  mime     TEXT NOT NULL DEFAULT 'image/jpeg',
  width    INTEGER NOT NULL DEFAULT 0,
  height   INTEGER NOT NULL DEFAULT 0,
  size     INTEGER NOT NULL DEFAULT 0,
  bytes    BYTEA NOT NULL,
  dibuat   TEXT NOT NULL
);

/* Identitas klinik (nama, pemilik, alamat, telepon).
   Dulu ini berkas data/clinic.json. Di serverless berkas lenyap tiap
   restart, jadi sekarang disimpan di database agar benar-benar ikut
   ke mana pun aplikasinya berjalan. Satu baris, id = 1. */
CREATE TABLE IF NOT EXISTS clinic_config (
  id     INTEGER PRIMARY KEY,
  config TEXT NOT NULL,
  diubah TEXT NOT NULL
);

/* ------------------------------------------------------------
   PERSEDIAAN & KEUANGAN

   Kenapa SEMUA nominal uang dan jumlah stok INTEGER:

   1. Rupiah tidak punya pecahan sen di praktik klinik. Harga obat
      Rp 1.000, bukan Rp 1.000,00. Menyimpannya sebagai NUMERIC akan
      membuat driver pg mengembalikan STRING (bukan number) demi
      menjaga presisi, lalu setiap penjumlahan di JavaScript harus
      di-parse ulang  Edan satu tempat yang lupa parse menghasilkan
      "1000" + "2000" = "10002000" yang tampak seperti angka.
   2. Tidak ada pembulatan: total invoice selalu sama dengan jumlah
      baris yang tertulis di nota. Kasir dan laporan tidak pernah
      berselisih satu rupiah karena galat floating point.
   3. Stok adalah satuan bulat (tablet, botol, pasang). Setengah
      tablet bukan transaksi yang sah di klinik ini.

   Karena itu setiap nilai dari body permintaan diperiksa dengan
   Math.trunc + Number.isFinite sebelum masuk SQL. Nilai pecahan
   dibulatkan ke bawah, nilai bukan angka ditolak.
   ------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,
  kode       TEXT NOT NULL DEFAULT '',
  nama       TEXT NOT NULL,
  jenis      TEXT NOT NULL DEFAULT 'obat',   /* 'obat' | 'bmhp' | 'dressing' | 'alkes' */
  satuan     TEXT NOT NULL DEFAULT '',
  harga_beli INTEGER NOT NULL DEFAULT 0,
  harga_jual INTEGER NOT NULL DEFAULT 0,
  stok       INTEGER NOT NULL DEFAULT 0,
  stok_min   INTEGER NOT NULL DEFAULT 0,
  aktif      INTEGER NOT NULL DEFAULT 1,
  catatan    TEXT NOT NULL DEFAULT '',
  dibuat     TEXT NOT NULL,
  diubah     TEXT NOT NULL
);

/* Riwayat pergerakan stok. Baris di sini TIDAK PERNAH dihapus, karena
   inilah bukti audit kenapa stok berkurang. stok_akhir disalin saat
   penulisan supaya riwayat tetap bisa dibaca meski harga/stok master
   berubah kemudian. visit_id/invoice_id sengaja tanpa foreign key:
   pemakaian obat sudah terjadi walau kunjungannya kemudian dihapus,
   dan catatan stoknya harus tetap ada. */
CREATE TABLE IF NOT EXISTS stock_moves (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  jenis      TEXT NOT NULL,                  /* 'masuk' | 'keluar' | 'koreksi' */
  jumlah     INTEGER NOT NULL,
  stok_akhir INTEGER NOT NULL,
  alasan     TEXT NOT NULL DEFAULT '',
  visit_id   TEXT,
  patient_id TEXT,
  invoice_id TEXT,
  oleh_id    INTEGER,
  oleh_nama  TEXT NOT NULL DEFAULT '',
  pada       TEXT NOT NULL
);

/* Nomor invoice unik: satu nomor tidak boleh dipakai dua kali walau
   dua petugas menagih pada detik yang sama. */
CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  nomor        TEXT NOT NULL UNIQUE,
  patient_id   TEXT NOT NULL DEFAULT '',
  patient_nama TEXT NOT NULL DEFAULT '',
  visit_id     TEXT NOT NULL DEFAULT '',
  tanggal      TEXT NOT NULL DEFAULT '',
  subtotal     INTEGER NOT NULL DEFAULT 0,
  diskon       INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  dibayar      INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'belum', /* 'belum'|'sebagian'|'lunas'|'batal' */
  layanan      TEXT NOT NULL DEFAULT 'onsite', /* 'onsite'|'homecare'  Ejenis layanan input invoice */
  rekomendasi  TEXT NOT NULL DEFAULT '',       /* saran: kunjungan ke-… & kontrol selanjutnya … */
  catatan      TEXT NOT NULL DEFAULT '',
  oleh_id      INTEGER,
  oleh_nama    TEXT NOT NULL DEFAULT '',
  dibuat       TEXT NOT NULL,
  diubah       TEXT NOT NULL
);

/* Baris tagihan. nama, satuan, dan harga DISALIN dari master
   saat transaksi, bukan dibaca lewat JOIN. Kalau harga barang naik
   bulan depan, nota lama tidak boleh ikut berubah  Enota adalah
   dokumen hukum, bukan tampilan master data. */
CREATE TABLE IF NOT EXISTS invoice_lines (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  jenis      TEXT NOT NULL DEFAULT 'tindakan', /* 'tindakan'|'obat'|'bmhp'|'dressing'|'alkes' */
  item_id    TEXT NOT NULL DEFAULT '',
  nama       TEXT NOT NULL DEFAULT '',
  qty        INTEGER NOT NULL DEFAULT 1,
  satuan     TEXT NOT NULL DEFAULT '',
  harga      INTEGER NOT NULL DEFAULT 0,
  jumlah     INTEGER NOT NULL DEFAULT 0,
  diskon     INTEGER NOT NULL DEFAULT 0,   /* persentase diskon per baris, 0-100 */
  urut       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tanggal    TEXT NOT NULL DEFAULT '',
  metode     TEXT NOT NULL DEFAULT 'tunai',   /* 'tunai'|'transfer'|'kartu'|'qris' */
  jumlah     INTEGER NOT NULL DEFAULT 0,
  catatan    TEXT NOT NULL DEFAULT '',
  oleh_id    INTEGER,
  oleh_nama  TEXT NOT NULL DEFAULT '',
  pada       TEXT NOT NULL
);

/* Jejak perubahan modul persediaan & kasir.
   Dipisahkan dari audit_log (yang berpaut pada kunjungan) karena mengubah
   harga barang atau membatalkan invoice bukan perubahan rekam medis, dan
   harus bisa dibaca per modul.

   Baris ditulis DI DALAM transaksi perubahan yang bersangkutan. Kalau
   pencatatannya gagal, perubahannya ikut dibatalkan: riwayat audit yang
   bisa hilang diam-diam lebih berbahaya daripada tidak punya riwayat. */
CREATE TABLE IF NOT EXISTS finance_log (
  id        TEXT PRIMARY KEY,
  modul     TEXT NOT NULL,                   /* 'persediaan' | 'kasir' */
  aksi      TEXT NOT NULL,                   /* lihat MODUL_LOG di bawah */
  ref_id    TEXT NOT NULL DEFAULT '',
  judul     TEXT NOT NULL DEFAULT '',
  detail    TEXT NOT NULL DEFAULT '',
  oleh_id   INTEGER,
  oleh_nama TEXT NOT NULL DEFAULT '',
  pada      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS ix_audit_visit    ON audit_log(visit_id);
CREATE INDEX IF NOT EXISTS ix_audit_patient  ON audit_log(patient_id);
CREATE INDEX IF NOT EXISTS ix_sessions_exp   ON sessions(expires);
CREATE INDEX IF NOT EXISTS ix_photos_visit   ON photos(visit_id);

/* Indeks untuk pola akses yang benar-benar dipakai:
   - riwayat stok selalu ditanya per barang, terbaru dulu
   - baris invoice selalu diambil per invoice
   - daftar & laporan invoice disaring rentang tanggal
   - pemakaian per kunjungan dicari saat confirmUsage
   - pembayaran per invoice dijumlahkan saat menghitung sisa */
CREATE INDEX IF NOT EXISTS ix_stock_item      ON stock_moves(item_id, pada DESC);
CREATE INDEX IF NOT EXISTS ix_stock_visit     ON stock_moves(visit_id);
CREATE INDEX IF NOT EXISTS ix_lines_invoice   ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS ix_invoices_tgl    ON invoices(tanggal);
CREATE INDEX IF NOT EXISTS ix_invoices_visit  ON invoices(visit_id);
CREATE INDEX IF NOT EXISTS ix_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS ix_payments_tgl    ON payments(tanggal);
CREATE INDEX IF NOT EXISTS ix_flog_modul      ON finance_log(modul, pada DESC);

/* ---------- Migrasi basis data lama ----------
   CREATE TABLE IF NOT EXISTS TIDAK menambah kolom ke tabel yang sudah ada,
   jadi tiga ALTER idempoten di bawah dijalankan setiap boot. Pada basis data
   baru ketiganya no-op (kolom sudah dibuat oleh CREATE TABLE di atas). */
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS diskon INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS layanan TEXT NOT NULL DEFAULT 'onsite';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rekomendasi TEXT NOT NULL DEFAULT '';
`;

/* ---------- Password ---------- */

function hashPassword(pwd, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pwd), s, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash: h, salt: s };
}

function verifyPassword(pwd, hash, salt) {
  try {
    const h = crypto.scryptSync(String(pwd), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

const nowISO = () => new Date().toISOString();

/* ---------- Koneksi ---------- */

/* `siap` dipakai sebagai gerbang: setiap fungsi data menunggu promise
   ini lebih dulu, sehingga skema pasti sudah ada dan pengguna awal sudah
   tercipta sebelum query pertama. Di serverless ini penting karena tiap
   instance bisa nyala kapan saja, tanpa "proses start" seperti di
   server lokal. */
let siap = null;

function ready() {
  if (siap) return siap;
  siap = (async () => {
    if (!DATABASE_URL) {
      throw new Error(
        'DATABASE_URL belum diisi. Set di Vercel (Settings > Environment Variables) ' +
        'atau di berkas .env untuk pengujian lokal.'
      );
    }
    await pool.query(SCHEMA);
    await seedIfEmpty();
    await seedItemsIfEmpty();
    await ensureAdminExists();
    return true;
  })();
  siap.catch(() => { siap = null; });   // biar percobaan berikutnya bisa mengulang
  return siap;
}

const open = ready;

async function close() {
  if (!siap) return;
  siap = null;
  try { await pool.end(); } catch (e) {}
}

/* ---------- Peran pengguna ---------- */

const PERAN_VALID = ['Admin', 'Dokter', 'Perawat', 'Perawat Senior', 'Terapis', 'Administrasi'];

/**
 * Terima hanya peran yang ada di daftar putih; nilai lain atau kosong
 * jatuh ke 'Perawat' supaya tidak pernah ada peran ngawur di basis data.
 */
function normalPeran(p) {
  const v = String(p || '').trim();
  return PERAN_VALID.indexOf(v) >= 0 ? v : 'Perawat';
}

/* ---------- Pengguna awal ---------- */

const DEFAULT_USERS = [
  { username: 'admin',    nama: 'Administrator',  peran: 'Admin',    pwd: 'woundcare123' },
  { username: 'slamet',   nama: 'Slamet Wibut M', peran: 'Dokter',   pwd: 'woundcare123' },
  { username: 'perawat',  nama: 'Petugas Klinis', peran: 'Perawat',  pwd: 'woundcare123' }
];

async function seedIfEmpty() {
  const n = (await pool.query('SELECT COUNT(*) AS c FROM users')).rows[0].c;
  if (Number(n) > 0) return;
  for (const u of DEFAULT_USERS) {
    const { hash, salt } = hashPassword(u.pwd);
    await pool.query(
      `INSERT INTO users (username, nama, peran, password_hash, salt, aktif, dibuat)
       VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [u.username, u.nama, u.peran, hash, salt, nowISO()]
    );
  }
  console.log('  [db] pengguna awal dibuat: ' + DEFAULT_USERS.map(u => u.username).join(', '));
  console.log('  [db] sandi awal: woundcare123  (ganti setelah masuk pertama)');
}

/**
 * Barang contoh untuk klinik perawatan luka.
 *
 * ID-nya ditulis tetap (bukan acak) supaya seed ini idempoten: dijalankan
 * berkali-kali pun tidak menambah baris baru, dan pemeriksaan "tabel kosong"
 * di bawah membuat data asli pengguna tidak pernah tersentuh.
 *
 * Dua barang sengaja berstok di bawah stok_min (Ketorolac dan NaCl) agar
 * peringatan stok rendah punya contoh nyata saat pertama kali dicoba.
 */
const DEFAULT_ITEMS = [
  { id: 'it_paracetamol', kode: 'OBT-001', nama: 'Paracetamol 500mg', jenis: 'obat', satuan: 'tablet',
    harga_beli: 300,    harga_jual: 1000,  stok: 120, stok_min: 30, catatan: 'Pereda nyeri, tablet oral' },
  { id: 'it_amoxicillin', kode: 'OBT-002', nama: 'Amoxicillin 500mg', jenis: 'obat', satuan: 'kapsul',
    harga_beli: 800,    harga_jual: 2000,  stok: 80,  stok_min: 30, catatan: 'Antibiotik, kapsul oral' },
  { id: 'it_ketorolac',   kode: 'OBT-003', nama: 'Ketorolac 30mg', jenis: 'obat', satuan: 'ampul',
    harga_beli: 4000,   harga_jual: 10000, stok: 6,   stok_min: 10, catatan: 'Analgesik injeksi, simpan di suhu ruang' },
  { id: 'it_metronidazole', kode: 'OBT-004', nama: 'Metronidazole 500mg', jenis: 'obat', satuan: 'tablet',
    harga_beli: 500,    harga_jual: 1500,  stok: 60,  stok_min: 20, catatan: 'Antibiotik anaerob, tablet oral' },
  { id: 'it_kasa',        kode: 'BMH-001', nama: 'Kasa Steril', jenis: 'bmhp', satuan: 'pak',
    harga_beli: 2500,   harga_jual: 5000,  stok: 40,  stok_min: 20, catatan: 'Kasa steril 16x16 cm, per pak' },
  { id: 'it_nacl',        kode: 'BMH-002', nama: 'NaCl 0,9% 500ml', jenis: 'bmhp', satuan: 'botol',
    harga_beli: 8000,   harga_jual: 15000, stok: 8,   stok_min: 12, catatan: 'Cairan irigasi luka' },
  { id: 'it_povidone',    kode: 'BMH-003', nama: 'Povidone Iodine 60ml', jenis: 'bmhp', satuan: 'botol',
    harga_beli: 9000,   harga_jual: 18000, stok: 20,  stok_min: 10, catatan: 'Antiseptik luka' },
  { id: 'it_handscoon',   kode: 'BMH-004', nama: 'Handscoon Steril', jenis: 'bmhp', satuan: 'pasang',
    harga_beli: 3000,   harga_jual: 6000,  stok: 50,  stok_min: 25, catatan: 'Sarung tangan steril, per pasang' }
];

async function seedItemsIfEmpty() {
  const n = (await pool.query('SELECT COUNT(*) AS c FROM items')).rows[0].c;
  if (Number(n) > 0) return;
  const pada = nowISO();
  for (const it of DEFAULT_ITEMS) {
    await pool.query(
      `INSERT INTO items (id, kode, nama, jenis, satuan, harga_beli, harga_jual, stok, stok_min, aktif, catatan, dibuat, diubah)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, $11)
       ON CONFLICT(id) DO NOTHING`,
      [it.id, it.kode, it.nama, it.jenis, it.satuan,
       it.harga_beli, it.harga_jual, it.stok, it.stok_min, it.catatan, pada]
    );
  }
  console.log('  [db] barang contoh dibuat: ' + DEFAULT_ITEMS.length + ' item (obat & BMHP)');
}

/**
 * Peringatan saja: kalau tidak ada admin aktif, semua endpoint admin
 * akan menolak siapa pun. Tidak membuat pengguna otomatis  Eitu
 * keputusan operator, bukan side-effect saat start.
 */
async function ensureAdminExists() {
  const n = (await pool.query("SELECT COUNT(*) c FROM users WHERE peran = 'Admin' AND aktif = 1")).rows[0].c;
  if (Number(n) > 0) return;
  console.log('  [db] PERINGATAN: tidak ada admin aktif  Esemua akses admin akan ditolak');
}

/* ---------- Auth ---------- */

async function findUser(username) {
  await ready();
  const r = await pool.query('SELECT * FROM users WHERE username = $1 AND aktif = 1', [String(username)]);
  return r.rows[0] || null;
}

/** Pencarian tanpa saringan `aktif`, untuk keperluan administration. */
async function findUserById(id) {
  await ready();
  const r = await pool.query(
    'SELECT id, username, nama, peran, aktif, dibuat, terakhir_masuk FROM users WHERE id = $1',
    [Number(id)]
  );
  return r.rows[0] || null;
}

async function listUsers() {
  await ready();
  const r = await pool.query(
    'SELECT id, username, nama, peran, aktif, dibuat, terakhir_masuk FROM users ORDER BY nama'
  );
  return r.rows;
}

async function createUser({ username, nama, peran, password }) {
  await ready();
  if (!username || !nama || !password) throw new Error('Username, nama, dan sandi wajib diisi.');
  // Panjang minimum yang sama dengan dua jalur sandi lainnya
  // (setPassword oleh admin, ganti sandi sendiri).
  if (String(password).length < 8) throw new Error('Sandi minimal 8 karakter.');
  // Cek ke seluruh tabel, bukan hanya akun aktif: kalau tidak, username milik
  // akun yang sudah dinonaktifkan bisa dipakai lagi dan muncul dua baris kembar.
  const dipakai = await pool.query('SELECT id FROM users WHERE username = $1', [String(username).trim()]);
  if (dipakai.rows.length) throw new Error('Username sudah dipakai.');
  const { hash, salt } = hashPassword(password);
  await pool.query(
    `INSERT INTO users (username, nama, peran, password_hash, salt, aktif, dibuat)
     VALUES ($1, $2, $3, $4, $5, 1, $6)`,
    [String(username).trim(), String(nama).trim(), normalPeran(peran), hash, salt, nowISO()]
  );
  // WAJIB kolom eksplisit: findUser() memakai SELECT *, jadi mengembalikan
  // password_hash dan salt. Mengirimnya ke peramban berarti menyerahkan
  // bahan baku curian sandi ke siapa pun yang memanggil endpoint ini.
  return findUserById((await findUser(username)).id);
}

async function setPassword(userId, pwd) {
  await ready();
  const { hash, salt } = hashPassword(pwd);
  await pool.query('UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, userId]);
}

async function setActive(userId, aktif) {
  await ready();
  // Jangan biarkan admin terakhir dinonaktifkan: kalau terjadi, seluruh
  // akses admin terkunci permanen.
  if (!aktif) {
    const t = await pool.query('SELECT id, peran FROM users WHERE id = $1', [userId]);
    const target = t.rows[0];
    if (target && target.peran === 'Admin') {
      const c = await pool.query(
        "SELECT COUNT(*) c FROM users WHERE peran = 'Admin' AND aktif = 1 AND id <> $1", [userId]
      );
      if (Number(c.rows[0].c) === 0) {
        throw new Error('Ini admin aktif terakhir. Promosikan pengguna lain ke peran Admin lebih dulu.');
      }
    }
  }
  await pool.query('UPDATE users SET aktif = $1 WHERE id = $2', [aktif ? 1 : 0, userId]);
  if (!aktif) await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/**
 * Hapus akun beserta seluruh sesinya.
 *
 * Catatan audit dan catatan akses TIDAK ikut hilang dan tidak rusak:
 * keduanya menyimpan `oleh_nama` yang disalin saat penulisan, dan kolom
 * `oleh_id`-nya sengaja tanpa foreign key ke users. Namanya sudah ada
 * di dalam baris itu sendiri, bukan diambil lewat JOIN.
 */
async function deleteUser(userId) {
  await ready();
  const t = await pool.query('SELECT id, username, nama, peran, aktif FROM users WHERE id = $1', [userId]);
  const target = t.rows[0];
  if (!target) throw new Error('Pengguna tidak ditemukan.');
  // Admin aktif terakhir: menghapusnya mematikan seluruh akses admin.
  if (target.peran === 'Admin' && Number(target.aktif) === 1) {
    const c = await pool.query(
      "SELECT COUNT(*) c FROM users WHERE peran = 'Admin' AND aktif = 1 AND id <> $1", [userId]
    );
    if (Number(c.rows[0].c) === 0) {
      throw new Error('Ini admin aktif terakhir dan tidak bisa dihapus. Promosikan pengguna lain ke Admin lebih dulu.');
    }
  }
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  return target;
}

/** Ubah peran pengguna. Admin aktif terakhir tidak boleh diturunkan. */
async function setRole(userId, peran) {
  await ready();
  const baru = normalPeran(peran);
  const t = await pool.query('SELECT id, peran FROM users WHERE id = $1', [userId]);
  const target = t.rows[0];
  if (!target) throw new Error('Pengguna tidak ditemukan.');
  if (target.peran === 'Admin' && baru !== 'Admin') {
    const c = await pool.query(
      "SELECT COUNT(*) c FROM users WHERE peran = 'Admin' AND aktif = 1 AND id <> $1", [userId]
    );
    if (Number(c.rows[0].c) === 0) {
      throw new Error('Ini admin aktif terakhir. Promosikan pengguna lain ke Admin lebih dulu.');
    }
  }
  await pool.query('UPDATE users SET peran = $1 WHERE id = $2', [baru, userId]);
  return findUserById(userId);
}

/** Admin menyetel ulang sandi petugas lain (lupa sandi). */
async function adminSetPassword(userId, pwd) {
  await ready();
  if (!pwd || String(pwd).length < 8) throw new Error('Sandi baru minimal 8 karakter.');
  const t = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (!t.rows.length) throw new Error('Pengguna tidak ditemukan.');
  await setPassword(userId, pwd);
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return findUserById(userId);
}

async function login(username, password, ttlHours = 12) {
  const u = await findUser(username);
  if (!u) return null;
  if (!verifyPassword(password, u.password_hash, u.salt)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  await pool.query(
    'INSERT INTO sessions (token, user_id, dibuat, expires) VALUES ($1, $2, $3, $4)',
    [token, u.id, nowISO(), exp]
  );
  await pool.query('UPDATE users SET terakhir_masuk = $1 WHERE id = $2', [nowISO(), u.id]);
  return { token, expires: exp, user: publicUser(u) };
}

async function userFromToken(token) {
  await ready();
  if (!token) return null;
  const r = await pool.query(
    `SELECT u.*, s.expires FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (new Date(row.expires).getTime() < Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return null;
  }
  if (Number(row.aktif) !== 1) return null;
  return publicUser(row);
}

async function logout(token) {
  await ready();
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function purgeSessions() {
  await ready();
  await pool.query('DELETE FROM sessions WHERE expires < $1', [nowISO()]);
}

function publicUser(u) {
  return { id: u.id, username: u.username, nama: u.nama, peran: u.peran };
}

/* ---------- Data rekam medis ---------- */

const SQL_UPSERT_PATIENT = `
  INSERT INTO patients (id, mr_number, nama, nik, telepon, data, archived, dibuat, diubah)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT(id) DO UPDATE SET
    mr_number = excluded.mr_number, nama = excluded.nama, nik = excluded.nik,
    telepon = excluded.telepon, data = excluded.data,
    archived = excluded.archived, diubah = excluded.diubah
`;

async function savePatient(p) {
  await ready();
  const id = p.identity || {};
  await pool.query(SQL_UPSERT_PATIENT, [
    p.id, p.mrNumber || '', id.nama || '', id.nik || '', id.telepon || '',
    JSON.stringify(p), p.archived ? 1 : 0,
    p.createdAt || nowISO(), nowISO()
  ]);
  return p;
}

async function deletePatient(id) {
  await ready();
  // Foto dibuang lebih dulu: visits hilang lewat ON DELETE CASCADE, dan
  // sesudah itu daftar kunjungan milik pasien ini tidak bisa ditanyakan lagi.
  await deletePhotosForPatient(id);
  await pool.query('DELETE FROM patients WHERE id = $1', [id]);
}

const SQL_UPSERT_VISIT = `
  INSERT INTO visits (id, patient_id, tanggal, jam, skor, frozen, data, dibuat, diubah)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT(id) DO UPDATE SET
    tanggal = excluded.tanggal, jam = excluded.jam, skor = excluded.skor,
    frozen = excluded.frozen, data = excluded.data, diubah = excluded.diubah
`;

async function saveVisit(p) {
  await ready();
  const v = p.visit;
  // Foto diekstrak lebih dulu: data URL -> BLOB + rujukan, supaya yang
  // tersimpan di kolom `data` tidak lagi mengandung base64.
  await splitPhotos(v);
  const total = v.winner && v.winner.total != null ? v.winner.total : null;
  await pool.query(SQL_UPSERT_VISIT, [
    v.id, p.patientId, v.date || '', v.time || '',
    total, v.frozen ? 1 : 0, JSON.stringify(v),
    v.createdAt || nowISO(), nowISO()
  ]);
  return v;
}

async function deleteVisit(id) {
  await ready();
  // audit_log & photos sengaja tanpa FK (agar dipisah dari nasib kunjungan),
  // jadi harus dibersihkan eksplisit  Ekalau tidak, fotonya jadi yatim.
  await pool.query('DELETE FROM audit_log WHERE visit_id = $1', [id]);
  await deletePhotosForVisit(id);
  await pool.query('DELETE FROM visits WHERE id = $1', [id]);
}

const SQL_UPSERT_CONSENT = `
  INSERT INTO consents (id, patient_id, tanggal, data)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT(id) DO UPDATE SET tanggal = excluded.tanggal, data = excluded.data
`;

async function saveConsent(patientId, c) {
  await ready();
  await pool.query(SQL_UPSERT_CONSENT, [c.id, patientId, c.date || '', JSON.stringify(c)]);
  return c;
}

async function deleteConsent(id) {
  await ready();
  await pool.query('DELETE FROM consents WHERE id = $1', [id]);
}

/* ---------- Foto luka (BLOB) ----------
 *
 * Bentuk data:
 *   - Di tabel `photos`      : binernya, sebagai BYTEA
 *   - Di v.photos[kind]      : rujukan ringan { id, mime, width, height, size }
 *   - Data URL `data:...;base64,...` masih DITERIMA di semua sisi supaya
 *     data lama dan berkas cadangan versi lama tetap terbaca.
 *
 * ID foto sengaja deterministik dari (kunjungan + jenis + isi berkas):
 * menyimpan ulang foto yang sama TIDAK menambah baris, sedangkan
 * menggantinya dengan berkas lain menghasilkan ID baru dan baris lama
 * ikut dibuang.
 */

function photoIdFor(visitId, kind, bytes) {
  const h = crypto.createHash('sha256');
  h.update(String(visitId)); h.update('|'); h.update(String(kind)); h.update('|');
  h.update(bytes);
  return 'ph_' + h.digest('hex').slice(0, 20);
}

/**
 * Simpan satu foto untuk (kunjungan, jenis). Mengembalikan rujukannya.
 * Satu kunjungan boleh punya LEBIH DARI SATU foto `before` maupun
 * `after`, jadi baris lain dengan pasangan yang sama TIDAK dibuang  E
 * unggahan berikutnya menambah daftar, bukan menimpa yang lama.
 * Id foto dihitung dari isi binernya, jadi unggahan berkas yang sama
 * persis tetap menimpa barisnya sendiri (tidak jadi duplikat).
 */
async function savePhotoFor(visitId, kind, { mime, bytes, width, height }) {
  await ready();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const id = photoIdFor(visitId, kind, buf);
  await pool.query(
    `INSERT INTO photos (id, visit_id, kind, mime, width, height, size, bytes, dibuat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       mime = excluded.mime, width = excluded.width, height = excluded.height,
       size = excluded.size, bytes = excluded.bytes`,
    [id, String(visitId), String(kind), mime || 'image/jpeg',
     Number(width) || 0, Number(height) || 0, buf.length, buf, nowISO()]
  );
  return { id, mime: mime || 'image/jpeg', width: Number(width) || 0, height: Number(height) || 0, size: buf.length };
}

const rujukanFoto = row => ({
  id: row.id, mime: row.mime, width: row.width, height: row.height, size: row.size
});

/** Biner foto untuk dialirkan ke <img>. null bila tidak ada. */
async function getPhoto(id) {
  await ready();
  const r = await pool.query(
    'SELECT id, visit_id, kind, mime, size, bytes FROM photos WHERE id = $1', [String(id)]
  );
  const row = r.rows[0];
  if (!row) return null;
  row.bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  return row;
}

async function deletePhoto(id) {
  await ready();
  const r = await pool.query('DELETE FROM photos WHERE id = $1', [String(id)]);
  return r.rowCount;
}

/** Buang foto milik satu kunjungan  Edipanggil saat kunjungan dihapus. */
async function deletePhotosForVisit(visitId) {
  await ready();
  const r = await pool.query('DELETE FROM photos WHERE visit_id = $1', [String(visitId)]);
  return r.rowCount;
}

/** Buang foto seluruh kunjungan milik satu pasien  Esaat pasien dihapus. */
async function deletePhotosForPatient(patientId) {
  await ready();
  const r = await pool.query(
    'DELETE FROM photos WHERE visit_id IN (SELECT id FROM visits WHERE patient_id = $1)',
    [String(patientId)]
  );
  return r.rowCount;
}

/** Metadata saja. Dipakai /api/data supaya muatannya tetap kecil. */
async function photoMetaForVisit(visitId) {
  await ready();
  const r = await pool.query(
    'SELECT id, kind, mime, width, height, size FROM photos WHERE visit_id = $1', [String(visitId)]
  );
  const out = {};
  r.rows.forEach(x => { out[x.kind] = rujukanFoto(x); });
  return out;
}

async function photoStats() {
  await ready();
  const r = await pool.query('SELECT COUNT(*) n, COALESCE(SUM(size), 0) b FROM photos');
  return { jumlah: Number(r.rows[0].n), bytes: Number(r.rows[0].b) };
}

/**
 * Ubah data URL di v.photos menjadi BLOB + rujukan.
 *
 * Dipanggil dari saveVisit, jadi SEMUA jalur simpan ikut ternormalisasi  E
 * termasuk pemulihan berkas cadangan lama yang masih berisi base64.
 */
async function splitPhotos(v) {
  if (!v || !v.photos) return v;
  for (const kind of ['before', 'after']) {
    const listKey = kind + 'List';

    /* Daftar multi-foto adalah sumber kebenaran; data lama yang hanya
       punya photos[kind] diangkat menjadi daftar satu baris. */
    const items = Array.isArray(v.photos[listKey])
      ? v.photos[listKey]
      : (v.photos[kind] ? [v.photos[kind]] : []);

    /* Bentuk baru: rujukan. Pastikan binernya benar-benar ada. Kalau tidak,
       rujukannya dibuang, daripada meninggalkan gambar rusak.
       Satu query untuk semua id  EsplitPhotos dipanggil setiap kunjungan
       disimpan, jadi jumlahnya dijaga tetap konstan. */
    const ids = items
      .filter(x => x && typeof x === 'object' && x.id)
      .map(x => String(x.id));
    const ada = new Set();
    if (ids.length) {
      const a = await pool.query('SELECT id FROM photos WHERE id = ANY($1)', [ids]);
      a.rows.forEach(r => ada.add(r.id));
    }

    const bersih = [];
    for (const val of items) {
      if (!val) continue;

      /* Bentuk lama: data URL. Inilah jalur migrasi  Ebegitu kunjungan
         disimpan sekali, base64-nya pindah ke tabel `photos` sebagai BLOB. */
      if (typeof val === 'string') {
        const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(val);
        if (!m) continue;                                    // bukan data URL
        const buf = Buffer.from(m[2], 'base64');
        bersih.push(await savePhotoFor(v.id, kind, { mime: m[1], bytes: buf, width: 0, height: 0 }));
        continue;
      }

      if (typeof val === 'object' && val.id && ada.has(String(val.id))) bersih.push(val);
    }

    v.photos[listKey] = bersih;
    v.photos[kind] = bersih[0] || null;
  }
  return v;
}

/* ---------- Audit ---------- */

async function appendAudit(user, patientId, visitId, entry) {
  await ready();
  await pool.query(
    `INSERT INTO audit_log (visit_id, patient_id, kolom, label, sebelum, sesudah, risky, oleh_id, oleh_nama, pada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [visitId, patientId, entry.key || '', entry.label || '',
     String(entry.before || ''), String(entry.after || ''),
     entry.risky ? 1 : 0,
     user ? user.id : null, (user && user.nama) || entry.oleh || 'Tanpa nama',
     entry.at || nowISO()]
  );
}

async function clearAudit(visitId) {
  await ready();
  await pool.query('DELETE FROM audit_log WHERE visit_id = $1', [visitId]);
}

async function listAudit(visitId) {
  await ready();
  const r = await pool.query('SELECT * FROM audit_log WHERE visit_id = $1 ORDER BY id ASC', [visitId]);
  return r.rows;
}

/* ---------- Snapshot penuh ---------- */

async function snapshot(clinic) {
  await ready();
  const patients = (await pool.query('SELECT * FROM patients ORDER BY mr_number')).rows;
  const visits   = (await pool.query('SELECT * FROM visits ORDER BY tanggal, jam')).rows;
  const consents = (await pool.query('SELECT * FROM consents ORDER BY tanggal')).rows;
  const audits   = (await pool.query('SELECT * FROM audit_log ORDER BY id ASC')).rows;
  const allPhotos = (await pool.query(
    'SELECT id, visit_id, kind, mime, width, height, size FROM photos ORDER BY dibuat, id'
  )).rows;

  const auditByVisit = {};
  for (const a of audits) {
    (auditByVisit[a.visit_id] = auditByVisit[a.visit_id] || []).push({
      id: 'a' + a.id, key: a.kolom, label: a.label,
      before: a.sebelum, after: a.sesudah,
      risky: !!a.risky, oleh: a.oleh_nama, at: a.pada
    });
  }

  const photosByVisit = {};
  for (const ph of allPhotos) {
    const per = (photosByVisit[ph.visit_id] = photosByVisit[ph.visit_id] || {});
    (per[ph.kind] = per[ph.kind] || []).push(rujukanFoto(ph));
  }

  const visitsByPatient = {};
  for (const v of visits) {
    const obj = JSON.parse(v.data);
    obj.audit = auditByVisit[v.id] || [];
    obj.frozen = !!v.frozen;
    /* Rujukan foto diambil dari tabel `photos`, bukan dari salinan di JSON.
       Efek sampingnya menguntungkan: kunjungan yang sempat kehilangan
       rujukannya pulih sendiri di sini.
       - photos[kind]List  : SEMUA foto slot itu (sumber kebenaran)
       - photos[kind]      : foto pertama  Etetap dibaca cetak, galeri,
                             ekspor CSV, dan penanda "sudah ada foto" */
    const fp = photosByVisit[v.id] || {};
    if (!obj.photos) obj.photos = { before: null, after: null, catatan: '', ruler: false, rulerNote: '' };
    for (const kind of ['before', 'after']) {
      const daftar = fp[kind] || [];
      obj.photos[kind + 'List'] = daftar;
      obj.photos[kind] = daftar[0] || null;
    }
    (visitsByPatient[v.patient_id] = visitsByPatient[v.patient_id] || []).push(obj);
  }

  const consentByPatient = {};
  for (const c of consents) {
    (consentByPatient[c.patient_id] = consentByPatient[c.patient_id] || []).push(JSON.parse(c.data));
  }

  const lastAccessRows = await pool.query(
    `SELECT DISTINCT ON (patient_id) patient_id, oleh_nama, aksi, pada
     FROM access_log WHERE patient_id IS NOT NULL AND aksi IN ('lihat','cetak')
     ORDER BY patient_id, id DESC`
  );
  const lastByPatient = {};
  for (const r of lastAccessRows.rows) {
    lastByPatient[r.patient_id] = { oleh: r.oleh_nama, aksi: r.aksi, pada: r.pada };
  }

  return {
    meta: { version: 1, clinic: clinic || null },
    patients: patients.map(r => {
      const p = JSON.parse(r.data);
      p.archived = !!r.archived;
      p.visits = visitsByPatient[r.id] || [];
      p.consents = (consentByPatient[r.id] || []).sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || '')));
      p.lastAccess = lastByPatient[r.id] || null;
      return p;
    })
  };
}

/* ---------- Ganti / gabungkan seluruh basis data ---------- */

/**
 * Terapkan snapshot penuh ke basis data.
 * mode 'replace'  Ekosongkan dulu, lalu isi (pemulihan cadangan).
 * mode 'merge'    Eisi tanpa mengosongkan; ID yang sama ditimpa.
 *
 *Versi PostgreSQL memakai TRANSAKSI. Versi SQLite sebelumnya tidak, dan
 * itu berarti server mati di tengah pemulihan -> database setengah terisi
 * tanpa jalan kembali. Di sini semua atau tidak sama sekali.
 */
async function replaceAll(snap, merge = false, opts = {}) {
  await ready();
  const client = await pool.connect();
  const q = (sql, params) => client.query(sql, params);
  try {
    await q('BEGIN');
    if (!merge) {
      /* Foto diperlakukan berbeda dari tabel lain.
       *
       * Pada pemulihan dari .zip, foto SUDAH diunggah lebih dulu  Ebukan
       * sebagai base64 di dalam snapshot, karena itu membuat satu
       * permintaan melebihi batas 4,5 MB milik Vercel. Karena itu
       * `DELETE FROM photos` di sini justru membuang foto yang baru saja
       * dikirim, lalu rekam medisnya datang tanpa gambar.
       *
       * Yang benar: buang foto yang TIDAK ada di cadangan, sehingga yang
       * tersisa persis isi cadangan.
       */
      if (Array.isArray(opts.fotoIds) && opts.fotoIds.length) {
        await q('DELETE FROM photos WHERE id <> ALL($1::text[])', [opts.fotoIds]);
      } else {
        await q('DELETE FROM photos');
      }
      await q('DELETE FROM audit_log');
      await q('DELETE FROM visits');
      await q('DELETE FROM consents');
      await q('DELETE FROM patients');
    }

    for (const p of snap.patients) {
      if (!p || !p.id) continue;
      const pid = p.identity || {};
      await q(SQL_UPSERT_PATIENT, [
        p.id, p.mrNumber || '', pid.nama || '', pid.nik || '', pid.telepon || '',
        JSON.stringify(p), p.archived ? 1 : 0,
        p.createdAt || nowISO(), nowISO()
      ]);
      for (const v of (p.visits || [])) {
        if (!v || !v.id) continue;
        await splitPhotos(v);
        const total = v.winner && v.winner.total != null ? v.winner.total : null;
        await q(SQL_UPSERT_VISIT, [
          v.id, p.id, v.date || '', v.time || '',
          total, v.frozen ? 1 : 0, JSON.stringify(v),
          v.createdAt || nowISO(), nowISO()
        ]);
        for (const a of (v.audit || [])) {
          await q(
            `INSERT INTO audit_log (visit_id, patient_id, kolom, label, sebelum, sesudah, risky, oleh_id, oleh_nama, pada)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [v.id, p.id, a.key || '', a.label || '', String(a.before || ''), String(a.after || ''),
             a.risky ? 1 : 0, null, a.oleh || 'Tanpa nama', a.at || nowISO()]
          );
        }
      }
      for (const c of (p.consents || [])) {
        if (!c || !c.id) continue;
        await q(SQL_UPSERT_CONSENT, [c.id, p.id, c.date || '', JSON.stringify(c)]);
      }
    }
    await q('COMMIT');
  } catch (e) {
    try { await q('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }

  const n = await pool.query('SELECT COUNT(*) c FROM patients');
  return Number(n.rows[0].c);
}

/**
 * Snapshot untuk BERKAS CADANGAN: sama seperti snapshot(), tetapi setiap
 * rujukan foto ditukar kembali menjadi data URL base64.
 *
 * Di sinilah base64 masih dipakai  Edan itu memang disengaja. Berkas
 * cadangan harus mandiri: bisa memulihkan foto di komputer lain yang tidak
 * punya basis data asalnya. Base64 yang 33% lebih besar tidak masalah di
 * berkas yang diunduh sekali-sekali.
 */
async function exportSnapshot(clinic) {
  const snap = await snapshot(clinic);
  const rows = (await pool.query('SELECT id, mime, bytes FROM photos')).rows;
  const bytesById = {};
  for (const r of rows) bytesById[r.id] = r;

  for (const p of snap.patients) {
    for (const v of (p.visits || [])) {
      const ps = v.photos;
      if (!ps) continue;
      for (const kind of ['before', 'after']) {
        const ubah = ref => {
          if (!ref || typeof ref !== 'object' || !ref.id) return ref;
          const row = bytesById[ref.id];
          if (!row) return ref;
          const b = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
          return 'data:' + (row.mime || 'image/jpeg') + ';base64,' + b.toString('base64');
        };
        if (Array.isArray(ps[kind + 'List'])) ps[kind + 'List'] = ps[kind + 'List'].map(ubah);
        ps[kind] = ubah(ps[kind]);
      }
    }
  }
  return snap;
}

/* ---------- Cadangan .zip: manifest + aliran foto ---------- */

/**
 * Manifest cadangan: snapshot() apa adanya (foto di dalamnya sudah
 * berupa rujukan ringan, bukan base64) ditambah daftar foto.
 *
 * Daftar foto ini yang membuat pemulihan bisa bertahap: peramban
 * membaca daftar ini, mengunggah setiap biner satu per satu, baru
 * akhirnya mengirim manifest-nya.
 */
async function backupManifest(clinic) {
  await ready();
  const snap = await snapshot(clinic);
  const rows = (await pool.query(
    'SELECT id, visit_id, kind, mime, width, height, size FROM photos ORDER BY id'
  )).rows;

  snap.meta = snap.meta || {};
  snap.meta.format = 'woundcare-zip-1';
  snap.meta.dibuat = nowISO();
  snap.meta.foto = rows.map(r => ({
    id: r.id, visit_id: r.visit_id, kind: r.kind,
    mime: r.mime, width: r.width, height: r.height, size: r.size
  }));
  snap.meta.totalFoto = rows.length;
  snap.meta.totalFotoBytes = rows.reduce((a, r) => a + Number(r.size || 0), 0);
  return snap;
}

/**
 * Aliran foto satu per satu, dibaca dari database dalam berkas kecil.
 * Dipakai agar penulisan .zip tidak pernah memegang lebih dari satu
 * gambar di memori  Einilah yang membuat arsip skala klinik mungkin.
 */
async function* photoStream(batchSize = 25) {
  await ready();
  let setelah = '';
  for (;;) {
    const r = await pool.query(
      'SELECT id, mime, bytes, dibuat FROM photos WHERE id > $1 ORDER BY id LIMIT $2',
      [setelah, batchSize]
    );
    if (!r.rows.length) return;
    for (const row of r.rows) {
      yield {
        id: row.id,
        mime: row.mime || 'image/jpeg',
        dibuat: row.dibuat,
        bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes)
      };
    }
    setelah = r.rows[r.rows.length - 1].id;
  }
}

/* ---------- Riwayat akses ---------- */

const AKSI_VALID = ['lihat', 'buat', 'ubah', 'hapus', 'cetak', 'pulih'];

/**
 * Catat satu peristiwa akses.
 * - Identitas petugas (nama & id) SELALU dari sesi server, tidak pernah dari body.
 * - Nama & nomor rekam medis patient juga diambil dari server berdasarkan patientId.
 * - `aksi` divalidasi terhadap daftar putih.
 */
async function recordAccess(user, ip, entry) {
  await ready();
  const aksi = AKSI_VALID.indexOf(entry.aksi) >= 0 ? entry.aksi : 'lihat';

  let nama = '', rm = '', pid = entry.patientId || null;
  if (pid) {
    const r = await pool.query('SELECT nama, mr_number FROM patients WHERE id = $1', [String(pid)]);
    if (r.rows.length) { nama = r.rows[0].nama; rm = r.rows[0].mr_number; }
    else pid = null;                 // pasien sudah dihapus -> catat tanpa nama
  }

  await pool.query(
    `INSERT INTO access_log (patient_id, patient_nama, patient_rm, aksi, detail, oleh_id, oleh_nama, ip, pada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [pid, nama, rm, aksi, String(entry.detail || '').slice(0, 200),
     user ? user.id : null, (user && user.nama) || 'Tanpa nama',
     ip || '', nowISO()]
  );
  // Pangkas supaya tabel tidak tumbuh tanpa batas
  await pool.query(`DELETE FROM access_log WHERE id NOT IN (
    SELECT id FROM access_log ORDER BY id DESC LIMIT 5000
  )`);
}

/** Daftar akses terbaru, opsional disaring per pasien. */
async function listAccess({ patientId, limit = 200 } = {}) {
  await ready();
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  if (patientId) {
    const r = await pool.query(
      'SELECT * FROM access_log WHERE patient_id = $1 ORDER BY id DESC LIMIT $2',
      [String(patientId), n]
    );
    return r.rows;
  }
  const r = await pool.query('SELECT * FROM access_log ORDER BY id DESC LIMIT $1', [n]);
  return r.rows;
}

/** Kapan terakhir & oleh siapa sebuah rekam medis dibuka. */
async function lastAccess(patientId) {
  await ready();
  const r = await pool.query(
    `SELECT oleh_nama, aksi, pada FROM access_log
     WHERE patient_id = $1 AND aksi IN ('lihat','cetak')
     ORDER BY id DESC LIMIT 1`,
    [String(patientId)]
  );
  return r.rows[0] || null;
}

async function accessCount() {
  await ready();
  const r = await pool.query('SELECT COUNT(*) c FROM access_log');
  return Number(r.rows[0].c);
}

/* ---------- Persediaan & keuangan ----------
 *
 * Rantai bisnis yang dijaga di sini:
 *
 *   obat diserahkan / BMHP dipakai
 *        -> stok berkurang (stock_moves)
 *        -> baris invoice bertambah (invoice_lines)
 *        -> pembayaran masuk (payments)
 *        -> laporan pendapatan
 *
 * Setiap mata rantai ditulis di dalam SATU transaksi. Alasannya bukan
 * kerapian, melainkan uang dan barang: kalau stok sempat berkurang tetapi
 * invoice gagal dibuat, klinik kehilangan barang tanpa tagihan. Kalau
 * invoice sempat dibuat tetapi stok gagal berkurang, catatan dan rak fisik
 * berbeda tanpa cara mengetahui selisihnya. Keduanya harus jatuh bersama.
 */

const JENIS_ITEM = ['obat', 'bmhp', 'dressing', 'alkes'];
const JENIS_MOVE = ['masuk', 'keluar', 'koreksi'];
const STATUS_INVOICE = ['belum', 'sebagian', 'lunas', 'batal'];
const METODE_BAYAR = ['tunai', 'transfer', 'kartu', 'qris'];
const MODUL_LOG = ['persediaan', 'kasir'];

/** ID acak pendek. Teks, bukan SERIAL, supaya bisa dibentuk sebelum INSERT
    dan aman dipakai langsung di URL tanpa escaping tambahan. */
function idBaru(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/**
 * Tanggal bisnis (YYYY-MM-DD) memakai zona waktu SERVER, bukan UTC.
 * nowISO() tetap dipakai untuk jejak waktu teknis; tanggal nota harus
 * tanggal yang dilihat kasir di dinding. Di WIB/WITA/WIT, tanggal UTC bisa
 * berbeda satu hari pada pagi buta  Einvoice tanggal 1 bisa tercatat
 * tanggal 31 bulan sebelumnya.
 */
function tanggalHariIni(d = new Date()) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * Paksa nilai menjadi bilangan bulat. Uang dan stok disimpan INTEGER
 * (lihat komentar skema), jadi di sini pecahan dipotong ke bawah dan nilai
 * bukan angka DITOLAK  Ebukan diam-diam menjadi 0, karena 0 yang salah
 * lebih berbahaya daripada pesan galat.
 */
function bulat(v, label) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) throw new Error((label || 'Angka') + ' tidak valid.');
  return n;
}

/** Tambahkan saringan rentang tanggal ke daftar syarat + parameter.
    Dipakai berulang supaya penomoran $n tidak pernah tertukar. */
function tambahTanggal(syarat, nilai, kolom, dari, sampai) {
  if (dari) { nilai.push(String(dari)); syarat.push(kolom + ' >= $' + nilai.length); }
  if (sampai) { nilai.push(String(sampai)); syarat.push(kolom + ' <= $' + nilai.length); }
}

const olehDari = (oleh) => ({
  id: oleh && oleh.id != null ? Number(oleh.id) : null,
  nama: (oleh && oleh.nama) ? String(oleh.nama) : 'Tanpa nama'
});

/**
 * Tulis satu baris jejak perubahan modul persediaan/kasir.
 *
 * `q` boleh berupa client transaksi (supaya tercatat atomik bersama
 * perubahannya) atau pool. Pemanggil yang sedang di dalam transaksi WAJIB
 * mengirim client-nya  Ememakai pool di tengah transaksi berarti barisnya
 * bisa COMMIT walau transaksi induknya ROLLBACK.
 */
async function catatLog(q, { modul, aksi, refId, judul, detail, oleh } = {}) {
  if (MODUL_LOG.indexOf(String(modul)) < 0) {
    throw new Error('Modul jejak perubahan tidak dikenal.');
  }
  const org = olehDari(oleh);
  await q.query(
    `INSERT INTO finance_log
       (id, modul, aksi, ref_id, judul, detail, oleh_id, oleh_nama, pada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [idBaru('fl_'), String(modul), String(aksi || ''), String(refId || ''),
     String(judul || ''), String(detail || ''), org.id, org.nama, nowISO()]
  );
}

/* ---------- Barang (obat & BMHP) ---------- */

async function listItems({ jenis, aktif } = {}) {
  await ready();
  const syarat = [];
  const nilai = [];
  if (jenis && JENIS_ITEM.indexOf(String(jenis)) >= 0) {
    nilai.push(String(jenis)); syarat.push('jenis = $' + nilai.length);
  }
  /* `aktif` sengaja TIDAK default ke 1: layar riwayat stok perlu
     menampilkan barang yang sudah dinonaktifkan agar auditnya terbaca.
     Pemanggil yang hanya ingin barang hidup mengirim aktif=1. */
  if (aktif !== undefined && aktif !== null && aktif !== '') {
    nilai.push(Number(aktif) ? 1 : 0);
    syarat.push('aktif = $' + nilai.length);
  }
  const where = syarat.length ? ' WHERE ' + syarat.join(' AND ') : '';
  const r = await pool.query('SELECT * FROM items' + where + ' ORDER BY jenis, nama', nilai);
  return r.rows;
}

/**
 * Simpan barang baru atau ubah barang yang sudah ada.
 *
 * Stok TIDAK diambil dari body untuk baris yang sudah ada. Satu-satunya
 * jalan mengubah stok adalah addStockMove()/confirmUsage(), sehingga setiap
 * perubahan punya pelaku, alasan, dan stok akhir. Kalau admin bisa mengetik
 * ulang angka stok, barang hilang bisa "dirapikan" tanpa jejak.
 */
async function saveItem(item) {
  await ready();
  const b = item || {};
  const nama = String(b.nama || '').trim();
  if (!nama) throw new Error('Nama barang wajib diisi.');

  if (b.jenis !== undefined && b.jenis !== null && b.jenis !== '' &&
      JENIS_ITEM.indexOf(String(b.jenis)) < 0) {
    throw new Error('Jenis barang harus obat, bmhp, dressing, atau alkes.');
  }

  const id = b.id ? String(b.id) : idBaru('it_');
  const lama = (await pool.query('SELECT * FROM items WHERE id = $1', [id])).rows[0] || null;
  const jenis = b.jenis ? String(b.jenis) : (lama ? lama.jenis : 'obat');

  const pilih = (kunci, bawaan) =>
    b[kunci] === undefined || b[kunci] === null ? bawaan : b[kunci];

  const hargaBeli = bulat(pilih('harga_beli', lama ? lama.harga_beli : 0), 'Harga beli');
  const hargaJual = bulat(pilih('harga_jual', lama ? lama.harga_jual : 0), 'Harga jual');
  const stokMin = bulat(pilih('stok_min', lama ? lama.stok_min : 0), 'Stok minimum');
  if (hargaBeli < 0 || hargaJual < 0 || stokMin < 0) {
    throw new Error('Harga dan stok minimum tidak boleh negatif.');
  }

  const stokAwal = lama ? Number(lama.stok) : Math.max(0, bulat(pilih('stok', 0), 'Stok'));
  const aktif = b.aktif === undefined || b.aktif === null
    ? (lama ? Number(lama.aktif) : 1)
    : (b.aktif ? 1 : 0);

  const pada = nowISO();
  const kode = String(pilih('kode', lama ? lama.kode : '') || '').trim();
  const satuan = String(pilih('satuan', lama ? lama.satuan : '') || '').trim();
  const catatan = String(pilih('catatan', lama ? lama.catatan : '') || '');

  /* Ringkasan perubahan disusun dari selisih nilai lama vs baru, bukan dari
     apa yang dikirim klien: kolom yang tidak dikirim tidak muncul sebagai
     "berubah" hanya karena bentuk body-nya berbeda. */
  let detail;
  if (!lama) {
    detail = 'barang baru, stok awal ' + stokAwal + (satuan ? ' ' + satuan : '');
  } else {
    const beda = [];
    if (String(lama.nama) !== nama) beda.push('nama "' + lama.nama + '" ↁE"' + nama + '"');
    if (String(lama.jenis) !== jenis) beda.push('jenis ' + lama.jenis + ' ↁE' + jenis);
    if (Number(lama.harga_beli) !== hargaBeli) beda.push('harga beli Rp' + lama.harga_beli + ' ↁERp' + hargaBeli);
    if (Number(lama.harga_jual) !== hargaJual) beda.push('harga jual Rp' + lama.harga_jual + ' ↁERp' + hargaJual);
    if (Number(lama.stok_min) !== stokMin) beda.push('stok minimum ' + lama.stok_min + ' ↁE' + stokMin);
    if (Number(lama.aktif) !== aktif) beda.push(aktif ? 'diaktifkan' : 'dinonaktifkan');
    detail = beda.length ? beda.join('; ') : 'disimpan tanpa perubahan nilai';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO items (id, kode, nama, jenis, satuan, harga_beli, harga_jual, stok, stok_min, aktif, catatan, dibuat, diubah)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT(id) DO UPDATE SET
         kode = excluded.kode, nama = excluded.nama, jenis = excluded.jenis,
         satuan = excluded.satuan, harga_beli = excluded.harga_beli,
         harga_jual = excluded.harga_jual, stok_min = excluded.stok_min,
         aktif = excluded.aktif, catatan = excluded.catatan, diubah = excluded.diubah
       RETURNING *`,
      [id, kode, nama, jenis, satuan, hargaBeli, hargaJual, stokAwal, stokMin, aktif, catatan,
       lama ? lama.dibuat : pada, pada]
    );
    const row = r.rows[0];
    await catatLog(client, {
      modul: 'persediaan',
      aksi: lama ? 'barang_ubah' : 'barang_baru',
      refId: row.id,
      judul: row.nama,
      detail,
      oleh: b.oleh
    });
    await client.query('COMMIT');
    return row;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Nonaktifkan barang  ETIDAK menghapus barisnya.
 *
 * stock_moves dan invoice_lines merujuk riwayat barang ini. Menghapus
 * barisnya akan memutus jejak audit (dan karena FK ON DELETE CASCADE pada
 * stock_moves, riwayatnya ikut lenyap). Barang yang masih berstok juga
 * ditolak: menonaktifkan barang berstok membuat stok fisik tak bisa
 * dipakai lagi tetapi tetap tercatat sebagai aset.
 */
async function deleteItem(id, oleh) {
  await ready();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [String(id)]);
    const it = r.rows[0];
    if (!it) throw new Error('Barang tidak ditemukan.');
    if (Number(it.stok) > 0) {
      throw new Error('Stok ' + it.nama + ' masih ' + it.stok + ' ' + (it.satuan || '') +
        '. Kosongkan lewat koreksi stok sebelum menonaktifkan.');
    }
    if (Number(it.aktif) === 0) throw new Error('Barang ' + it.nama + ' sudah nonaktif.');

    await client.query('UPDATE items SET aktif = 0, diubah = $1 WHERE id = $2', [nowISO(), it.id]);
    await catatLog(client, {
      modul: 'persediaan',
      aksi: 'barang_nonaktif',
      refId: it.id,
      judul: it.nama,
      detail: 'dinonaktifkan; baris dan riwayat stok tetap disimpan',
      oleh
    });
    await client.query('COMMIT');
    return Object.assign({}, it, { aktif: 0 });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- Pergerakan stok ---------- */

/**
 * Catat penerimaan / koreksi / pengeluaran stok secara manual.
 *
 * Semua perubahan stok lewat satu pintu ini (confirmUsage memakai pola yang
 * sama di dalam transaksinya). Urutannya:
 *   BEGIN -> SELECT ... FOR UPDATE -> validasi -> UPDATE items -> INSERT
 *   stock_moves -> COMMIT, dan ROLLBACK pada galat apa pun.
 *
 * FOR UPDATE mengunci baris barang sampai transaksi selesai. Tanpa itu, dua
 * petugas yang mengeluarkan barang bersamaan bisa sama-sama membaca stok 10,
 * sama-sama mengurangi 8, dan stok akhir menjadi 2 padahal seharusnya -6.
 *
 * `koreksi` adalah SELISIH, bukan angka stok baru: jumlah = -3 berarti
 * "stok fisik 3 lebih sedikit dari catatan". Dengan begitu pergerakan tetap
 * punya arah dan bisa dijumlahkan seperti mutasi lain.
 */
async function addStockMove({ itemId, jenis, jumlah, alasan, visitId, patientId, oleh } = {}) {
  await ready();
  const jns = String(jenis || '');
  if (JENIS_MOVE.indexOf(jns) < 0) throw new Error('Jenis pergerakan stok tidak dikenal.');
  const n = bulat(jumlah, 'Jumlah');
  if (jns === 'koreksi') {
    if (n === 0) throw new Error('Koreksi nol tidak mengubah apa pun.');
  } else if (n <= 0) {
    throw new Error('Jumlah harus lebih dari nol.');
  }

  const org = olehDari(oleh);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [String(itemId)]);
    const it = r.rows[0];
    if (!it) throw new Error('Barang tidak ditemukan.');
    if (Number(it.aktif) !== 1) throw new Error('Barang ' + it.nama + ' sudah nonaktif.');

    const akhir = jns === 'keluar' ? Number(it.stok) - n : Number(it.stok) + n;
    if (akhir < 0) {
      throw new Error('Stok ' + it.nama + ' tidak cukup: tersedia ' + it.stok +
        ' ' + (it.satuan || '') + ', diminta ' + n + '.');
    }

    const pada = nowISO();
    const keterangan = String(alasan || '').trim() ||
      (jns === 'masuk' ? 'Penerimaan barang' : (jns === 'keluar' ? 'Pengeluaran barang' : 'Koreksi stok'));

    await client.query('UPDATE items SET stok = $1, diubah = $2 WHERE id = $3',
      [akhir, pada, it.id]);

    const m = await client.query(
      `INSERT INTO stock_moves
         (id, item_id, jenis, jumlah, stok_akhir, alasan, visit_id, patient_id, invoice_id, oleh_id, oleh_nama, pada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11)
       RETURNING *`,
      [idBaru('sm_'), it.id, jns, n, akhir, keterangan,
       visitId ? String(visitId) : null, patientId ? String(patientId) : null,
       org.id, org.nama, pada]
    );

    await catatLog(client, {
      modul: 'persediaan',
      aksi: jns === 'masuk' ? 'stok_masuk' : (jns === 'koreksi' ? 'stok_koreksi' : 'stok_keluar'),
      refId: it.id,
      judul: it.nama,
      detail: (jns === 'masuk' ? '+' : (jns === 'koreksi' && n > 0 ? '+' : '')) + n +
        (it.satuan ? ' ' + it.satuan : '') + ', stok ' + it.stok + ' ↁE' + akhir +
        '  E' + keterangan,
      oleh: org
    });

    await client.query('COMMIT');
    return { move: m.rows[0], item: Object.assign({}, it, { stok: akhir }) };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

async function listStockMoves({ itemId, limit } = {}) {
  await ready();
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const syarat = [];
  const nilai = [];
  if (itemId) { nilai.push(String(itemId)); syarat.push('m.item_id = $' + nilai.length); }
  nilai.push(n);
  const r = await pool.query(
    `SELECT m.*, i.nama, i.satuan, i.jenis AS jenis_item
     FROM stock_moves m LEFT JOIN items i ON i.id = m.item_id` +
    (syarat.length ? ' WHERE ' + syarat.join(' AND ') : '') +
    ' ORDER BY m.pada DESC, m.id DESC LIMIT $' + nilai.length,
    nilai
  );
  return r.rows;
}

/**
 * Riwayat perubahan untuk satu modul, terbaru dulu.
 * Hanya admin yang boleh memanggil (dicek di server.js); isinya menyebut
 * siapa mengubah harga, siapa menerima uang, dan siapa membatalkan tagihan.
 */
async function listFinanceLog({ modul, limit } = {}) {
  await ready();
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  const syarat = [];
  const nilai = [];

  if (modul) {
    if (MODUL_LOG.indexOf(String(modul)) < 0) throw new Error('Modul riwayat tidak dikenal.');
    nilai.push(String(modul)); syarat.push('modul = $' + nilai.length);
  }

  nilai.push(n);
  const r = await pool.query(
    'SELECT * FROM finance_log' +
    (syarat.length ? ' WHERE ' + syarat.join(' AND ') : '') +
    ' ORDER BY pada DESC, id DESC LIMIT $' + nilai.length,
    nilai
  );
  return r.rows;
}

/* ---------- Invoice ---------- */

/**
 * Nomor invoice otomatis: INV-YYYYMMDD-NNNN, urut per hari.
 *
 * Kunci advisory per tanggal (pg_advisory_xact_lock) membuat dua permintaan
 * yang berjalan bersamaan mengantre, bukan menghasilkan nomor kembar lalu
 * gagal karena UNIQUE. Kunci otomatis lepas saat COMMIT/ROLLBACK.
 *
 * Nomor terbesar dicari dengan CAST, bukan ORDER BY nomor: setelah urutan
 * melewati 9999, 'INV-...-10000' justru lebih kecil dari '-9999' bila
 * dibandingkan sebagai teks.
 */
async function nomorInvoiceBaru(client) {
  const awalan = 'INV-' + tanggalHariIni().replace(/-/g, '') + '-';
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['nomor:' + awalan]);
  const r = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(nomor FROM '[0-9]+$') AS INTEGER)), 0) AS n
     FROM invoices
     WHERE nomor LIKE $1 AND nomor ~ '^INV-[0-9]{8}-[0-9]+$'`,
    [awalan + '%']
  );
  const n = Number(r.rows[0].n) + 1;
  return awalan + String(n).padStart(4, '0');
}

/**
 * Hitung ulang uang sebuah invoice dari sumbernya, bukan dari angka yang
 * dikirim pemanggil:
 *   subtotal = SUM(invoice_lines.jumlah)
 *   total    = max(0, subtotal - diskon)
 *   dibayar  = SUM(payments.jumlah)
 *
 * `dibayar` selalu dihitung ulang dari tabel payments supaya tidak mungkin
 * "lupa" memperbarui kolom ringkasan saat baris tagihan ditambah.
 */
async function hitungUlangInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT id, diskon, status,
            COALESCE((SELECT SUM(jumlah) FROM invoice_lines WHERE invoice_id = $1), 0)::int AS subtotal,
            COALESCE((SELECT SUM(jumlah) FROM payments WHERE invoice_id = $1), 0)::int AS dibayar
     FROM invoices WHERE id = $1
     FOR UPDATE`,
    [invoiceId]
  );
  const row = r.rows[0];
  if (!row) throw new Error('Invoice tidak ditemukan.');

  const subtotal = Number(row.subtotal);
  const diskon = Number(row.diskon);
  const dibayar = Number(row.dibayar);
  const total = Math.max(0, subtotal - diskon);

  let status;
  if (row.status === 'batal') status = 'batal';
  else if (total <= 0 || dibayar >= total) status = 'lunas';
  else if (dibayar > 0) status = 'sebagian';
  else status = 'belum';

  await client.query(
    'UPDATE invoices SET subtotal = $1, total = $2, dibayar = $3, status = $4, diubah = $5 WHERE id = $6',
    [subtotal, total, dibayar, status, nowISO(), row.id]
  );
  return { subtotal, diskon, total, dibayar, status };
}

/**
 * Buat invoice manual (tindakan, atau barang yang memang tidak ditarik dari
 * stok). Pemakaian obat/BMHP sebaiknya lewat confirmUsage() agar stok dan
 * invoice bergerak bersama.
 *
 * Untuk baris yang menyebut itemId, harga SELALU diambil dari items.harga_jual,
 * bukan dari body. Kalau klien boleh mengirim harga, siapa pun bisa menagih
 * obat Rp 1 dan aturan "hanya admin boleh mengubah harga" kehilangan arti.
 */
async function createInvoice({ patientId, patientNama, visitId, lines, diskon, catatan,
                               layanan, rekomendasi, oleh } = {}) {
  await ready();
  const daftar = (Array.isArray(lines) ? lines : [])
    .filter(l => l && (l.itemId || String(l.nama || '').trim()));
  if (!daftar.length) throw new Error('Invoice harus punya minimal satu baris.');

  const jnsLayanan = layanan === 'homecare' || layanan === 'home_care' ? 'homecare' : 'onsite';
  const rek = String(rekomendasi || '').trim();

  const org = olehDari(oleh);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nomor = await nomorInvoiceBaru(client);
    const id = idBaru('inv_');
    const pada = nowISO();

    let subtotal = 0;
    let urut = 1;
    const baris = [];
    for (const l of daftar) {
      const qty = bulat(l.qty === undefined || l.qty === null ? 1 : l.qty, 'Jumlah');
      if (qty <= 0) throw new Error('Jumlah baris invoice harus lebih dari nol.');

      let jenis, itemId = '', nama = String(l.nama || '').trim();
      let satuan = String(l.satuan || '').trim();
      let harga;

      if (l.itemId) {
        itemId = String(l.itemId);
        const ir = await client.query('SELECT * FROM items WHERE id = $1', [itemId]);
        const it = ir.rows[0];
        if (!it) throw new Error('Barang pada baris invoice tidak ditemukan.');
        if (Number(it.aktif) !== 1) throw new Error('Barang ' + it.nama + ' sudah nonaktif.');
        jenis = JENIS_ITEM.indexOf(it.jenis) >= 0 ? it.jenis : 'bmhp';
        nama = it.nama;
        satuan = it.satuan;
        harga = Number(it.harga_jual);
      } else {
        jenis = ['tindakan', 'obat', 'bmhp', 'dressing', 'alkes'].indexOf(String(l.jenis)) >= 0
          ? String(l.jenis) : 'tindakan';
        if (!nama) throw new Error('Setiap baris invoice harus punya nama atau itemId.');
        harga = bulat(l.harga === undefined || l.harga === null ? 0 : l.harga, 'Harga');
        if (harga < 0) throw new Error('Harga tidak boleh negatif.');
      }

      const jumlahKotor = qty * harga;

      /* Diskon PER BARIS dalam persen (0-100), sesuai kolom "Dis." pada
         invoice: dressing, obat, jasa tindakan, dan transport masing-masing
         bisa diberi potongan sendiri. `jumlah` disimpan NETTO
         (qty ÁEharga ∁Ediskon baris) supaya subtotal = SUM(jumlah) tetap
         benar dan hitungUlangInvoice tidak perlu diubah. */
      let diskonPct = 0;
      if (l.diskon !== undefined && l.diskon !== null && l.diskon !== '') {
        diskonPct = bulat(l.diskon, 'Diskon baris');
        if (diskonPct < 0 || diskonPct > 100) throw new Error('Diskon baris harus antara 0 dan 100 persen.');
      }
      const jumlah = jumlahKotor - Math.round(jumlahKotor * diskonPct / 100);

      subtotal += jumlah;
      baris.push({ jenis, itemId, nama, qty, satuan, harga, jumlah, diskon: diskonPct, urut: urut++ });
    }

    const diskonN = Math.max(0, bulat(diskon === undefined || diskon === null ? 0 : diskon, 'Diskon'));
    const total = Math.max(0, subtotal - diskonN);

    const inv = await client.query(
      `INSERT INTO invoices
         (id, nomor, patient_id, patient_nama, visit_id, tanggal, subtotal, diskon, total, dibayar,
          status, layanan, rekomendasi, catatan, oleh_id, oleh_nama, dibuat, diubah)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 'belum', $10, $11, $12, $13, $14, $15, $15)
       RETURNING *`,
      [id, nomor, patientId ? String(patientId) : '', String(patientNama || '').trim(),
       visitId ? String(visitId) : '', tanggalHariIni(),
       subtotal, diskonN, total, jnsLayanan, rek, String(catatan || ''),
       org.id, org.nama, pada]
    );

    for (const b of baris) {
      await client.query(
        `INSERT INTO invoice_lines
           (id, invoice_id, jenis, item_id, nama, qty, satuan, harga, jumlah, diskon, urut)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [idBaru('il_'), id, b.jenis, b.itemId, b.nama, b.qty, b.satuan, b.harga, b.jumlah, b.diskon, b.urut]
      );
    }

    await catatLog(client, {
      modul: 'kasir',
      aksi: 'invoice_buat',
      refId: id,
      judul: nomor,
      detail: 'Total Rp' + total + ' · ' + baris.length + ' baris · ' +
        (jnsLayanan === 'homecare' ? 'Home Care' : 'Onsite') +
        (String(patientNama || '').trim() ? ' · ' + String(patientNama).trim() : ''),
      oleh: org
    });

    await client.query('COMMIT');
    return await getInvoice(inv.rows[0].id);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

async function getInvoice(id) {
  await ready();
  const r = await pool.query('SELECT * FROM invoices WHERE id = $1', [String(id)]);
  const inv = r.rows[0];
  if (!inv) return null;

  const l = await pool.query(
    'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY urut, id', [inv.id]
  );
  const p = await pool.query(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY tanggal, pada, id', [inv.id]
  );
  return Object.assign({}, inv, { lines: l.rows, payments: p.rows });
}

async function listInvoices({ from, to, status, patientId, limit } = {}) {
  await ready();
  const syarat = [];
  const nilai = [];
  tambahTanggal(syarat, nilai, 'tanggal', from, to);

  if (status) {
    if (STATUS_INVOICE.indexOf(String(status)) < 0) throw new Error('Status invoice tidak dikenal.');
    nilai.push(String(status)); syarat.push('status = $' + nilai.length);
  }
  if (patientId) { nilai.push(String(patientId)); syarat.push('patient_id = $' + nilai.length); }

  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  nilai.push(n);

  const r = await pool.query(
    'SELECT * FROM invoices' +
    (syarat.length ? ' WHERE ' + syarat.join(' AND ') : '') +
    ' ORDER BY tanggal DESC, dibuat DESC LIMIT $' + nilai.length,
    nilai
  );
  return r.rows;
}

/**
 * Pembayaran masuk. Sisa tagihan dihitung dari invoice yang DIKUNCI
 * (FOR UPDATE), sehingga dua pembayaran bersamaan tidak bisa sama-sama
 * lolos validasi "masih ada sisa" lalu membuat dibayar melebihi total.
 */
async function addPayment({ invoiceId, tanggal, metode, jumlah, catatan, oleh } = {}) {
  await ready();
  const n = bulat(jumlah, 'Jumlah pembayaran');
  if (n <= 0) throw new Error('Jumlah pembayaran harus lebih dari nol.');

  const mtd = METODE_BAYAR.indexOf(String(metode)) >= 0 ? String(metode) : 'tunai';
  const org = olehDari(oleh);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [String(invoiceId)]);
    const inv = r.rows[0];
    if (!inv) throw new Error('Invoice tidak ditemukan.');
    if (inv.status === 'batal') throw new Error('Invoice sudah dibatalkan, tidak bisa dibayar.');

    const sisa = Number(inv.total) - Number(inv.dibayar);
    if (n > sisa) {
      throw new Error('Pembayaran melebihi sisa tagihan (sisa Rp' + sisa + ').');
    }

    const pada = nowISO();
    const p = await client.query(
      `INSERT INTO payments (id, invoice_id, tanggal, metode, jumlah, catatan, oleh_id, oleh_nama, pada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [idBaru('pay_'), inv.id, String(tanggal || tanggalHariIni()), mtd, n,
       String(catatan || ''), org.id, org.nama, pada]
    );

    const dibayar = Number(inv.dibayar) + n;
    const lunas = Number(inv.total) <= 0 || dibayar >= Number(inv.total);
    const status = lunas ? 'lunas' : 'sebagian';

    await client.query(
      'UPDATE invoices SET dibayar = $1, status = $2, diubah = $3 WHERE id = $4',
      [dibayar, status, pada, inv.id]
    );

    await catatLog(client, {
      modul: 'kasir',
      aksi: 'bayar',
      refId: inv.id,
      judul: inv.nomor,
      detail: 'Rp' + n + ' via ' + mtd + ' · status ' + status +
        (inv.patient_nama ? ' · ' + inv.patient_nama : '') +
        (String(catatan || '').trim() ? '  E' + String(catatan).trim() : ''),
      oleh: org
    });

    await client.query('COMMIT');
    return {
      payment: p.rows[0],
      invoice: Object.assign({}, inv, { dibayar, status, diubah: pada })
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Ubah status invoice secara administratif (mis. membatalkan tagihan salah
 * pasien). `dibayar` sengaja TIDAK diubah di sini: uang yang sudah masuk
 * tetap tercatat di tabel payments dan tetap muncul di laporan pendapatan.
 * Status 'batal' hanya mengeluarkan tagihan dari daftar piutang/laporan
 * tagihan, bukan menghapus kuitansi.
 */
async function setInvoiceStatus({ id, status, oleh } = {}) {
  await ready();
  const st = String(status || '');
  if (STATUS_INVOICE.indexOf(st) < 0) throw new Error('Status invoice tidak dikenal.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cek = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [String(id)]);
    const inv = cek.rows[0];
    if (!inv) throw new Error('Invoice tidak ditemukan.');

    /* Status yang sama tidak perlu dicatat ulang: baris kembar hanya membuat
       riwayat ramai tanpa menambah informasi. */
    if (String(inv.status) === st) {
      await client.query('ROLLBACK');
      return await getInvoice(String(id));
    }

    await client.query('UPDATE invoices SET status = $1, diubah = $2 WHERE id = $3',
      [st, nowISO(), String(id)]);

    await catatLog(client, {
      modul: 'kasir',
      aksi: 'invoice_status',
      refId: inv.id,
      judul: inv.nomor,
      detail: 'status ' + inv.status + ' ↁE' + st +
        (inv.patient_nama ? ' · ' + inv.patient_nama : ''),
      oleh
    });

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
  return await getInvoice(String(id));
}

/**
 * INTI RANTAI BISNIS: catat pemakaian obat/BMHP untuk satu kunjungan.
 *
 * Satu transaksi, urutan yang disengaja:
 *   1. BEGIN
 *   2. Kunci baris item dengan SELECT ... FOR UPDATE, DIURUTKAN menurut id.
 *      Urutan tetap mencegah deadlock bila dua kunjungan memakai barang yang
 *      sama dalam urutan berbeda.
 *   3. Validasi semua baris lebih dulu (aktif + stok cukup). Tidak ada
 *      UPDATE sebelum seluruh baris lolos, jadi kegagalan baris ke-3 tidak
 *      meninggalkan baris ke-1 dan ke-2 sudah terpotong.
 *   4. Kurangi stok + INSERT stock_moves (jenis 'keluar', stok_akhir).
 *   5. Cari invoice kunjungan yang belum 'batal'; bila tidak ada, buat baru
 *      (nomor harian, di dalam transaksi yang sama).
 *   6. INSERT invoice_lines dengan harga dari items.harga_jual dan nama
 *      yang disalin saat itu  Enota lama tidak boleh berubah saat harga
 *      master naik.
 *   7. Hitung ulang subtotal/total/dibayar/status dari tabel sumber.
 *   8. COMMIT. Galat di langkah mana pun -> ROLLBACK, sehingga stok dan
 *      invoice tidak pernah terpisah.
 *
 * Baris dengan itemId sama digabung lebih dulu: kalau tidak, dua baris
 * @5 tablet akan diperiksa terhadap stok secara terpisah dan bisa lolos
 * keduanya walau totalnya melebihi stok.
 */
async function confirmUsage({ visitId, patientId, patientNama, lines, oleh } = {}) {
  await ready();
  const daftar = (Array.isArray(lines) ? lines : []).filter(l => l && l.itemId);
  if (!daftar.length) throw new Error('Tidak ada barang yang dipakai.');

  const qtyPerItem = new Map();
  for (const l of daftar) {
    const q = bulat(l.qty === undefined || l.qty === null ? 1 : l.qty, 'Jumlah pemakaian');
    if (q <= 0) throw new Error('Jumlah pemakaian harus lebih dari nol.');
    const kunci = String(l.itemId);
    qtyPerItem.set(kunci, (qtyPerItem.get(kunci) || 0) + q);
  }
  const ids = Array.from(qtyPerItem.keys()).sort();

  const org = olehDari(oleh);
  const vid = visitId ? String(visitId) : '';
  const pid = patientId ? String(patientId) : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Kunci per kunjungan. Tanpa ini, dua permintaan pemakaian yang tiba
       bersamaan untuk kunjungan yang SAMA bisa sama-sama tidak menemukan
       invoice lalu membuat dua invoice terpisah. Kunci advisory ini diambil
       sebelum kunci baris item, dan semua transaksi memakai urutan yang sama,
       sehingga tidak ada siklus kunci (deadlock). */
    if (vid) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['kunjungan:' + vid]);
    }

    /* Nama pasien disalin dari tabel pasien (server), bukan dipercaya dari
       body, supaya nota tidak bisa dibuat atas nama orang lain. */
    let namaPasien = String(patientNama || '').trim();
    if (!namaPasien && pid) {
      const pr = await client.query('SELECT nama FROM patients WHERE id = $1', [pid]);
      if (pr.rows.length) namaPasien = pr.rows[0].nama;
    }

    const itemById = {};
    for (const id of ids) {
      const r = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [id]);
      const it = r.rows[0];
      if (!it) throw new Error('Barang ' + id + ' tidak ditemukan.');
      if (Number(it.aktif) !== 1) throw new Error('Barang ' + it.nama + ' sudah nonaktif.');

      const butuh = qtyPerItem.get(id);
      if (Number(it.stok) < butuh) {
        throw new Error('Stok ' + it.nama + ' tidak cukup: butuh ' + butuh +
          ' ' + (it.satuan || '') + ', tersedia ' + it.stok + '.');
      }
      itemById[id] = it;
    }

    /* Invoice lama untuk kunjungan ini dikunci juga: dua permintaan
       pemakaian pada kunjungan yang sama harus mengantre, bukan menambah
       baris ke invoice yang sedang dihitung ulang. */
    let inv = null;
    if (vid) {
      const ir = await client.query(
        `SELECT * FROM invoices
         WHERE visit_id = $1 AND status <> 'batal'
         ORDER BY dibuat DESC, id DESC LIMIT 1
         FOR UPDATE`,
        [vid]
      );
      inv = ir.rows[0] || null;
    }

    const pada = nowISO();
    let dibuatBaru = false;
    if (!inv) {
      dibuatBaru = true;
      const nomor = await nomorInvoiceBaru(client);
      const ins = await client.query(
        `INSERT INTO invoices
           (id, nomor, patient_id, patient_nama, visit_id, tanggal, subtotal, diskon, total, dibayar,
            status, catatan, oleh_id, oleh_nama, dibuat, diubah)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 'belum', '', $7, $8, $9, $9)
         RETURNING *`,
        [idBaru('inv_'), nomor, pid, namaPasien, vid, tanggalHariIni(),
         org.id, org.nama, pada]
      );
      inv = ins.rows[0];
    }

    const urutRow = await client.query(
      'SELECT COALESCE(MAX(urut), 0) AS n FROM invoice_lines WHERE invoice_id = $1', [inv.id]
    );
    let urut = Number(urutRow.rows[0].n) + 1;

    const moves = [];
    for (const id of ids) {
      const it = itemById[id];
      const qty = qtyPerItem.get(id);
      const akhir = Number(it.stok) - qty;

      await client.query('UPDATE items SET stok = $1, diubah = $2 WHERE id = $3',
        [akhir, pada, it.id]);

      const mv = await client.query(
        `INSERT INTO stock_moves
           (id, item_id, jenis, jumlah, stok_akhir, alasan, visit_id, patient_id, invoice_id, oleh_id, oleh_nama, pada)
         VALUES ($1, $2, 'keluar', $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [idBaru('sm_'), it.id, qty, akhir, 'Pemakaian kunjungan',
         vid || null, pid || null, inv.id, org.id, org.nama, pada]
      );
      moves.push(mv.rows[0]);

      await client.query(
        `INSERT INTO invoice_lines
           (id, invoice_id, jenis, item_id, nama, qty, satuan, harga, jumlah, urut)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [idBaru('il_'), inv.id, JENIS_ITEM.indexOf(it.jenis) >= 0 ? it.jenis : 'bmhp', it.id,
         it.nama, qty, it.satuan, Number(it.harga_jual), qty * Number(it.harga_jual), urut++]
      );
    }

    await hitungUlangInvoice(client, inv.id);

    /* Dua baris jejak, satu per modul: halaman Persediaan melihat barang apa
       yang keluar, halaman Kasir melihat tagihan yang terbentuk. Keduanya
       ditulis dalam transaksi yang sama dengan pengurangan stok. */
    const ringkasBarang = ids
      .map(id => itemById[id].nama + ' ×' + qtyPerItem.get(id))
      .join(', ');

    await catatLog(client, {
      modul: 'persediaan',
      aksi: 'pemakaian',
      refId: inv.id,
      judul: namaPasien || inv.nomor,
      detail: ringkasBarang + ' · ' + inv.nomor,
      oleh: org
    });

    await catatLog(client, {
      modul: 'kasir',
      aksi: dibuatBaru ? 'invoice_buat' : 'invoice_tambah',
      refId: inv.id,
      judul: inv.nomor,
      detail: (dibuatBaru ? 'otomatis dari pemakaian · ' : 'baris ditambahkan · ') +
        ringkasBarang + (namaPasien ? ' · ' + namaPasien : ''),
      oleh: org
    });

    await client.query('COMMIT');

    /* Dibaca ulang SESUDAH commit supaya yang dikembalikan adalah keadaan
       yang benar-benar tersimpan, termasuk status hasil hitung ulang. */
    const lengkap = await getInvoice(inv.id);
    return { invoice: lengkap, moves };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- Laporan pendapatan ---------- */

/**
 * Ringkasan pendapatan.
 *
 * PENTING: `total` dihitung dari tabel `payments`, bukan dari
 * `invoices.total`. `total` tagihan adalah uang yang SEHARUSNYA masuk
 * (akrual); `payments` adalah uang yang BENAR-BENAR masuk (kas). Laporan
 * pendapatan klinik dipakai untuk mengetahui isi kas dan arus uang, jadi
 * piutang yang belum dibayar tidak boleh dihitung sebagai pendapatan.
 * Konsekuensinya: invoice 'lunas' yang dibayar bulan depan masuk ke bulan
 * pembayaran, bukan bulan tagihan. Invoice 'batal' dikeluarkan dari semua
 * hitungan.
 *
 * Karena itu ada dua cakupan tanggal yang berbeda dan itu disengaja:
 *   - total, byDay, byMetode, jumlahTransaksi  -> tanggal PEMBAYARAN
 *   - jumlahInvoice, byJenis, topItems         -> tanggal INVOICE
 * byJenis/topItems adalah komposisi barang yang tertagih pada periode itu,
 * bukan komposisi kas. Mencampurnya dengan pembayaran akan membuat satu
 * obat yang dibayar dua kali angsuran terhitung dua kali.
 */
async function revenueSummary({ from, to } = {}) {
  await ready();

  const sBayar = [];
  const nBayar = [];
  tambahTanggal(sBayar, nBayar, 'p.tanggal', from, to);
  const whereBayar = "i.status <> 'batal'" +
    (sBayar.length ? ' AND ' + sBayar.join(' AND ') : '');

  const utama = (await pool.query(
    `SELECT COALESCE(SUM(p.jumlah), 0)::int AS total,
            COUNT(*)::int AS transaksi
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE ${whereBayar}`,
    nBayar
  )).rows[0];

  const byDay = (await pool.query(
    `SELECT p.tanggal, COALESCE(SUM(p.jumlah), 0)::int AS total
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE ${whereBayar}
     GROUP BY p.tanggal ORDER BY p.tanggal`,
    nBayar
  )).rows;

  const byMetode = (await pool.query(
    `SELECT p.metode, COALESCE(SUM(p.jumlah), 0)::int AS total
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE ${whereBayar}
     GROUP BY p.metode ORDER BY total DESC`,
    nBayar
  )).rows;

  const sInv = [];
  const nInv = [];
  tambahTanggal(sInv, nInv, 'i.tanggal', from, to);
  const whereInv = "i.status <> 'batal'" +
    (sInv.length ? ' AND ' + sInv.join(' AND ') : '');

  const jml = (await pool.query(
    'SELECT COUNT(*)::int AS c FROM invoices i WHERE ' + whereInv, nInv
  )).rows[0];

  const byJenis = (await pool.query(
    `SELECT l.jenis, COALESCE(SUM(l.jumlah), 0)::int AS total
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE ${whereInv}
     GROUP BY l.jenis ORDER BY total DESC`,
    nInv
  )).rows;

  const topItems = (await pool.query(
    `SELECT l.nama, COALESCE(SUM(l.jumlah), 0)::int AS total,
            COALESCE(SUM(l.qty), 0)::int AS qty
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE ${whereInv} AND l.jenis IN ('obat', 'bmhp', 'dressing', 'alkes')
     GROUP BY l.nama ORDER BY total DESC LIMIT 10`,
    nInv
  )).rows;

  return {
    total: Number(utama.total),
    jumlahInvoice: Number(jml.c),
    jumlahTransaksi: Number(utama.transaksi),
    byDay: byDay.map(r => ({ tanggal: r.tanggal, total: Number(r.total) })),
    byJenis: byJenis.map(r => ({ jenis: r.jenis, total: Number(r.total) })),
    byMetode: byMetode.map(r => ({ metode: r.metode, total: Number(r.total) })),
    topItems: topItems.map(r => ({ nama: r.nama, total: Number(r.total), qty: Number(r.qty) }))
  };
}

/* ---------- Statistik ---------- */

async function stats() {
  await ready();
  const fp = await photoStats();
  const one = async (sql) => Number((await pool.query(sql)).rows[0].c);
  return {
    patients: await one('SELECT COUNT(*) c FROM patients WHERE archived = 0'),
    visits:   await one('SELECT COUNT(*) c FROM visits'),
    consent:  await one('SELECT COUNT(*) c FROM consents'),
    audit:    await one('SELECT COUNT(*) c FROM audit_log'),
    akses:    await one('SELECT COUNT(*) c FROM access_log'),
    users:    await one('SELECT COUNT(*) c FROM users WHERE aktif = 1'),
    foto:     fp.jumlah,
    fotoBytes: fp.bytes
  };
}

/* ---------- Identitas klinik ---------- */

async function getClinicConfig(fallback) {
  await ready();
  const r = await pool.query('SELECT config FROM clinic_config WHERE id = 1');
  if (!r.rows.length) return Object.assign({}, fallback || {});
  try { return Object.assign({}, fallback || {}, JSON.parse(r.rows[0].config)); }
  catch (e) { return Object.assign({}, fallback || {}); }
}

async function saveClinicConfig(cfg, fallback) {
  await ready();
  const merged = Object.assign({}, fallback || {}, cfg || {});
  await pool.query(
    `INSERT INTO clinic_config (id, config, diubah) VALUES (1, $1, $2)
     ON CONFLICT(id) DO UPDATE SET config = excluded.config, diubah = excluded.diubah`,
    [JSON.stringify(merged), nowISO()]
  );
  return merged;
}

module.exports = {
  open, ready, close, stats, snapshot, exportSnapshot,
  backupManifest, photoStream,
  getClinicConfig, saveClinicConfig,
  hashPassword, verifyPassword,
  findUser, findUserById, listUsers, createUser, setPassword, setActive,
  setRole, adminSetPassword, deleteUser,
  login, logout, userFromToken, purgeSessions, publicUser,
  savePatient, deletePatient, saveVisit, deleteVisit,
  saveConsent, deleteConsent,
  savePhotoFor, getPhoto, deletePhoto,
  deletePhotosForVisit, deletePhotosForPatient, photoMetaForVisit,
  photoStats, splitPhotos,
  appendAudit, clearAudit, listAudit, replaceAll,
  recordAccess, listAccess, lastAccess, accessCount,
  listItems, saveItem, deleteItem,
  addStockMove, listStockMoves, listFinanceLog,
  createInvoice, getInvoice, listInvoices, addPayment, setInvoiceStatus, confirmUsage,
  revenueSummary,
  PERAN_VALID, normalPeran, ensureAdminExists,
  DEFAULT_USERS, DEFAULT_ITEMS
};
