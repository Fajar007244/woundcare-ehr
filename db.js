/* ============================================================
   db.js — Skema & akses data PostgreSQL (Supabase)
   ============================================================
   Versi PostgreSQL dari lapisan data. NAMA FUNGSI DAN PERILAKUNYA
   sama persis dengan versi SQLite sebelumnya, jadi server.js tidak
   perlu tahu mesin datanya yang diganti — hanya menjadi async.

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
   pool yang sama dipakai ulang — membuat koneksi baru tiap permintaan
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

CREATE INDEX IF NOT EXISTS ix_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS ix_audit_visit    ON audit_log(visit_id);
CREATE INDEX IF NOT EXISTS ix_audit_patient  ON audit_log(patient_id);
CREATE INDEX IF NOT EXISTS ix_sessions_exp   ON sessions(expires);
CREATE INDEX IF NOT EXISTS ix_photos_visit   ON photos(visit_id);
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
 * Peringatan saja: kalau tidak ada admin aktif, semua endpoint admin
 * akan menolak siapa pun. Tidak membuat pengguna otomatis — itu
 * keputusan operator, bukan side-effect saat start.
 */
async function ensureAdminExists() {
  const n = (await pool.query("SELECT COUNT(*) c FROM users WHERE peran = 'Admin' AND aktif = 1")).rows[0].c;
  if (Number(n) > 0) return;
  console.log('  [db] PERINGATAN: tidak ada admin aktif — semua akses admin akan ditolak');
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
  // jadi harus dibersihkan eksplisit — kalau tidak, fotonya jadi yatim.
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
 * Satu kunjungan hanya punya satu foto `before` dan satu `after`, jadi
 * baris lain dengan pasangan yang sama dibuang lebih dulu.
 */
async function savePhotoFor(visitId, kind, { mime, bytes, width, height }) {
  await ready();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const id = photoIdFor(visitId, kind, buf);
  await pool.query('DELETE FROM photos WHERE visit_id = $1 AND kind = $2 AND id <> $3',
    [String(visitId), String(kind), id]);
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

/** Buang foto milik satu kunjungan — dipanggil saat kunjungan dihapus. */
async function deletePhotosForVisit(visitId) {
  await ready();
  const r = await pool.query('DELETE FROM photos WHERE visit_id = $1', [String(visitId)]);
  return r.rowCount;
}

/** Buang foto seluruh kunjungan milik satu pasien — saat pasien dihapus. */
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
 * Dipanggil dari saveVisit, jadi SEMUA jalur simpan ikut ternormalisasi —
 * termasuk pemulihan berkas cadangan lama yang masih berisi base64.
 */
async function splitPhotos(v) {
  if (!v || !v.photos) return v;
  for (const kind of ['before', 'after']) {
    const val = v.photos[kind];
    if (!val) continue;

    /* Bentuk lama: data URL. Inilah jalur migrasi — begitu kunjungan
       disimpan sekali, base64-nya pindah ke tabel `photos` sebagai BLOB. */
    if (typeof val === 'string') {
      const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(val);
      if (!m) continue;                                    // bukan data URL
      const buf = Buffer.from(m[2], 'base64');
      v.photos[kind] = await savePhotoFor(v.id, kind, { mime: m[1], bytes: buf, width: 0, height: 0 });
      continue;
    }

    /* Bentuk baru: rujukan. Pastikan binernya benar-benar ada. Kalau tidak,
       rujukannya dibuang, daripada meninggalkan gambar rusak. */
    if (typeof val === 'object' && val.id) {
      const a = await pool.query('SELECT 1 AS x FROM photos WHERE id = $1', [String(val.id)]);
      if (!a.rows.length) v.photos[kind] = null;
    }
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
  const allPhotos = (await pool.query('SELECT id, visit_id, kind, mime, width, height, size FROM photos')).rows;

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
    (photosByVisit[ph.visit_id] = photosByVisit[ph.visit_id] || {})[ph.kind] = rujukanFoto(ph);
  }

  const visitsByPatient = {};
  for (const v of visits) {
    const obj = JSON.parse(v.data);
    obj.audit = auditByVisit[v.id] || [];
    obj.frozen = !!v.frozen;
    /* Rujukan foto diambil dari tabel `photos`, bukan dari salinan di JSON.
       Efek sampingnya menguntungkan: kunjungan yang sempat kehilangan
       rujukannya pulih sendiri di sini. */
    const fp = photosByVisit[v.id];
    if (fp) {
      if (!obj.photos) obj.photos = { before: null, after: null, catatan: '', ruler: false, rulerNote: '' };
      if (fp.before) obj.photos.before = fp.before;
      if (fp.after) obj.photos.after = fp.after;
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
 * mode 'replace' — kosongkan dulu, lalu isi (pemulihan cadangan).
 * mode 'merge'   — isi tanpa mengosongkan; ID yang sama ditimpa.
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
       * Pada pemulihan dari .zip, foto SUDAH diunggah lebih dulu — bukan
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
 * Di sinilah base64 masih dipakai — dan itu memang disengaja. Berkas
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
        const ref = ps[kind];
        if (!ref || typeof ref !== 'object' || !ref.id) continue;
        const row = bytesById[ref.id];
        if (!row) continue;
        const b = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
        ps[kind] = 'data:' + (row.mime || 'image/jpeg') + ';base64,' + b.toString('base64');
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
 * gambar di memori — inilah yang membuat arsip skala klinik mungkin.
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
  PERAN_VALID, normalPeran, ensureAdminExists,
  DEFAULT_USERS
};