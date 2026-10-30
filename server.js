/* ============================================================
   server.js — REST API + autentikasi (PostgreSQL)
   ============================================================
   node server.js          -> http://localhost:8080   (lokal)
   Vercel                  -> handler di api/index.js

   Dua mode, satu berkas:
     - Lokal  : menjalankan server HTTP biasa (node server.js)
     - Vercel : exporting fungsi handler(req, res)

   Semua panggilan basis data sekarang `await`, karena PostgreSQL
   berjalur lewat jaringan — berbeda dari SQLite yang sinkron.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { ZipWriter } = require('./backup-zip.js');

/* ---------- Muat .env (KHUSUS LOKAL) ----------
 *
 * db.js membaca process.env.DATABASE_URL tepat saat dimuat, jadi berkas ini
 * harus dibaca SEBELUM require('./db'). Kalau tidak, server selalu melapor
 * "DATABASE_URL belum diisi" padahal .env sudah ada.
 *
 * Di Vercel tidak ada .env — variabelnya datang dari dashboard, jadi
 * pemuatannya dilewati sepenuhnya.
 */
if (!process.env.VERCEL) {
  try {
    const f = path.join(__dirname, '.env');
    if (fs.existsSync(f)) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) return;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
      });
    }
  } catch (e) {
    console.error('[env] gagal membaca .env:', e.message);
  }
}

const db = require('./db');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const COOKIE = 'wc_session';

/* Vercel sudah punya CDN sendiri untuk berkas statis hasil build.
   Di sana jangan kita sajikan berkas sendiri — cukup tangani /api. */
const ON_VERCEL = !!process.env.VERCEL;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

/* ---------- Utilitas ---------- */

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body
    : (typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8'));
  res.writeHead(code, Object.assign({
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  }, headers));
  res.end(buf);
}

const json = (res, code, obj) =>
  send(res, code, obj, { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Permintaan terlalu besar.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Body bukan JSON yang valid.')); }
    });
    req.on('error', reject);
  });
}

/** Baca body biner mentah — untuk unggah foto (bukan base64). */
function readBinary(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Foto terlalu besar (maksimal 3 MB).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Jenis foto yang dikenal model: satu `before` dan satu `after` per kunjungan. */
const KIND_FOTO = ['before', 'after'];

/** Kenali JPEG / PNG dari magic number, bukan dari nama berkas. */
function jenisGambar(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 &&
      buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  return null;
}

function cookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict'
  ];
  /* Di Vercel situsnya HTTPS, jadi cookie wajib Secure. Tanpa itu
     peramban bisa mengirim cookie lewat HTTP biasa. */
  if (ON_VERCEL) parts.push('Secure');
  if (maxAgeSec === 0) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${maxAgeSec}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

const clientIp = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || '';

/* ---------- Autentikasi ---------- */

async function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  return db.userFromToken(token);
}

/** Penjaga akses Admin: kembalikan user, atau null setelah mengirim 401/403. */
async function requireAdmin(req, res) {
  const u = await currentUser(req);
  if (!u) { json(res, 401, { error: 'Belum masuk.' }); return null; }
  if (u.peran !== 'Admin') { json(res, 403, { error: 'Hanya admin yang boleh.' }); return null; }
  return u;
}

/* ---------- Keamanan login ---------- */

/** Batasi percobaan login: 8 gagal / 10 menit / token (ip+username).
    Di serverless tiap instance punya peta sendiri, jadi batas ini
  sifatnya lebih longgar — cukup menahan percobaan otomatis sederhana. */
const attempts = new Map();
const WINDOW = 10 * 60 * 1000;
const MAX = 8;

const throttleKey = (req, username) =>
  clientIp(req) + '|' + String(username || '').toLowerCase();

function throttled(req, username) {
  const k = throttleKey(req, username);
  const a = attempts.get(k);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(k); return false; }
  return a.count >= MAX;
}
function failAttempt(req, username) {
  const k = throttleKey(req, username);
  const a = attempts.get(k);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(k, { first: Date.now(), count: 1 });
  else a.count++;
}
const clearAttempts = (req, username) => attempts.delete(throttleKey(req, username));

/* ---------- Identitas klinik ---------- */

const DEFAULT_CLINIC = {
  nama: 'KLINIK KHUSUS LUKA LUKAMU LUKAKU',
  namaPemilik: 'Slamet Wibut M, S.Kep., Ners, CWCC',
  alamat: 'Jl. Ciawitali no. 49B RT 03 RW X Citeureup Cimahi',
  telepon: '082250504500'
};

async function clinicConfig() {
  try { return await db.getClinicConfig(DEFAULT_CLINIC); }
  catch (e) { return Object.assign({}, DEFAULT_CLINIC); }
}

/* ---------- Berkas statis (hanya untuk mode lokal) ---------- */

const DIST = path.join(ROOT, 'web', 'dist');

function serveDist(req, res, urlPath) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return false;

  /* Penjaga data sensitif. HATI-HATI: /assets/ BUKAN berarti folder data.
     Setelah build, Vite menaruh CSS & JS aplikasi di web/dist/assets/.
     Yang dilarang adalah folder data/ dan berkas database/kode server. */
  if (/^\/(data)\//.test(urlPath) ||
      /\.(db|db-wal|db-shm|sqlite3?)$/i.test(urlPath) ||
      /^\/(server|db)\.js$/i.test(urlPath)) {
    send(res, 403, 'Forbidden');
    return true;
  }

  const rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) { send(res, 403, 'Forbidden'); return true; }

  if (!path.extname(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }

  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  headers['Cache-Control'] = (ext === '.html')
    ? 'no-store'
    : (/-[A-Za-z0-9_]{6,}\.[a-z0-9]+$/.test(path.basename(file))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');

  fs.readFile(file, (err, data) => {
    if (err) { send(res, 500, 'Server error'); return; }
    send(res, 200, data, headers);
  });
  return true;
}

/* ---------- API ---------- */

const routes = {
  'POST /api/login': async (req, res) => {
    const body = await readBody(req);
    const username = body.username;
    if (throttled(req, username)) {
      return json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 10 menit.' });
    }
    const r = await db.login(username, body.password);
    if (!r) {
      failAttempt(req, username);
      return json(res, 401, { error: 'Username atau sandi salah.' });
    }
    clearAttempts(req, username);
    setCookie(res, COOKIE, r.token, 12 * 3600);
    json(res, 200, { user: r.user, expires: r.expires });
  },

  'POST /api/logout': async (req, res) => {
    await db.logout(cookies(req)[COOKIE]);
    setCookie(res, COOKIE, '', 0);
    json(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const u = await currentUser(req);
    if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, { user: u });
  },

  'GET /api/data': async (req, res) => {
    const u = await currentUser(req);
    if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, await db.snapshot(await clinicConfig()));
  },

  'POST /api/patients': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const p = await readBody(req);
    if (!p || !p.id) return json(res, 400, { error: 'Data pasien tidak lengkap.' });
    await db.savePatient(p);
    json(res, 200, { ok: true, id: p.id });
  },

  /* Penghapusan data bersifat merusak dan tidak dapat dibatalkan,
     jadi hanya admin. */
  'DELETE /api/patients': async (req, res, _q, id) => {
    if (!await requireAdmin(req, res)) return;
    await db.deletePatient(id);
    json(res, 200, { ok: true });
  },

  'POST /api/visits': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const p = await readBody(req);
    if (!p || !p.patientId || !p.visit || !p.visit.id) {
      return json(res, 400, { error: 'Data kunjungan tidak lengkap.' });
    }
    await db.saveVisit(p);
    if (Array.isArray(p.clearAudit)) for (const vid of p.clearAudit) await db.clearAudit(vid);
    if (Array.isArray(p.audit)) for (const a of p.audit) await db.appendAudit(u, p.patientId, p.visit.id, a);
    json(res, 200, { ok: true, id: p.visit.id });
  },

  'DELETE /api/visits': async (req, res, _q, id) => {
    if (!await requireAdmin(req, res)) return;
    await db.deleteVisit(id);
    json(res, 200, { ok: true });
  },

  'POST /api/consents': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const p = await readBody(req);
    if (!p || !p.patientId || !p.consent || !p.consent.id) {
      return json(res, 400, { error: 'Data persetujuan tidak lengkap.' });
    }
    await db.saveConsent(p.patientId, p.consent);
    json(res, 200, { ok: true, id: p.consent.id });
  },

  'DELETE /api/consents': async (req, res, _q, id) => {
    if (!await requireAdmin(req, res)) return;
    await db.deleteConsent(id);
    json(res, 200, { ok: true });
  },

  /* --- Foto ---
     Dikirim sebagai biner mentah, bukan base64: menghemat 33%. */
  'POST /api/photos': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });

    const visitId = String(q.get('visitId') || '');
    const kind = String(q.get('kind') || '');
    if (!visitId) return json(res, 400, { error: 'Kunjungan tidak disebutkan.' });
    if (KIND_FOTO.indexOf(kind) < 0) return json(res, 400, { error: 'Jenis foto tidak dikenal.' });

    let bytes;
    try { bytes = await readBinary(req); }
    catch (e) { return json(res, 413, { error: e.message }); }
    if (!bytes.length) return json(res, 400, { error: 'Isi foto kosong.' });

    const mime = jenisGambar(bytes);
    if (!mime) return json(res, 415, { error: 'Berkas bukan gambar JPEG atau PNG.' });

    const ref = await db.savePhotoFor(visitId, kind, {
      mime, bytes,
      width: Number(q.get('width')) || 0,
      height: Number(q.get('height')) || 0
    });
    json(res, 200, { ok: true, photo: ref });
  },

  'GET /api/photos': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const f = await db.getPhoto(String(q.get('id') || ''));
    if (!f) return json(res, 404, { error: 'Foto tidak ditemukan.' });
    send(res, 200, f.bytes, {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=604800, immutable'
    });
  },

  'DELETE /api/photos': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, { ok: true, dihapus: await db.deletePhoto(String(q.get('id') || '')) });
  },

  'POST /api/audit': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = await readBody(req);
    if (!b || !b.patientId || !b.visitId) return json(res, 400, { error: 'Data audit tidak lengkap.' });
    if (b.replace) await db.clearAudit(b.visitId);
    for (const a of (b.entries || [])) await db.appendAudit(u, b.patientId, b.visitId, a);
    json(res, 200, { ok: true, n: (b.entries || []).length });
  },

  'GET /api/audit': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, { entries: await db.listAudit(q.get('visitId') || '') });
  },

  'POST /api/config': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const c = await readBody(req);
    json(res, 200, { ok: true, clinic: await db.saveClinicConfig(c, DEFAULT_CLINIC) });
  },

  'GET /api/stats': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, await db.stats());
  },

  /* --- Riwayat akses --- */
  'POST /api/access': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = await readBody(req);
    if (!b || !b.aksi) return json(res, 400, { error: 'Aksi tidak lengkap.' });
    await db.recordAccess(u, clientIp(req), b);
    json(res, 200, { ok: true });
  },

  /* Catatan akses MEMASUKI endpoint ini, jadi hanya admin yang boleh membaca.
       Menulis (POST di atas) tetap terbuka untuk semua. */
  'GET /api/access': async (req, res, q) => {
    if (!await requireAdmin(req, res)) return;
    json(res, 200, {
      entries: await db.listAccess({
        patientId: q.get('patientId') || null,
        limit: q.get('limit') || 200
      })
    });
  },

  'GET /api/access/last': async (req, res, q) => {
    if (!await requireAdmin(req, res)) return;
    json(res, 200, { last: await db.lastAccess(q.get('patientId') || '') });
  },

  /* --- Persediaan: obat & BMHP ---
   *
   * Kewenangan:
   *   - membaca barang & stok: semua petugas yang sudah masuk
   *   - menambah/mengubah/menonaktifkan barang, harga, dan stok: semua peran.
   *     Pemilik klinik membuka ini agar petugas gudang / perawat juga bisa
   *     merapikan katalog tanpa menunggu admin. Setiap perubahan tetap
   *     dicatat di log persediaan lewat db.saveItem()/db.deleteItem()/
   *     db.addStockMove(), lengkap dengan pelakunya, jadi bukan tanpa jejak.
   *   - mencatat pemakaian: semua petugas, karena perawat di ruang tindakan
   *     yang tahu barang apa yang benar-benar dipakai.
   *   - membaca riwayat perubahan persediaan (log): admin saja.
   */
  'GET /api/items': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, {
      items: await db.listItems({ jenis: q.get('jenis') || '', aktif: q.get('aktif') })
    });
  },

  'POST /api/items': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = await readBody(req);
    try { json(res, 200, { item: await db.saveItem(Object.assign({}, b, { oleh: u })) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  /* Nonaktifkan, bukan hapus: riwayat stok harus tetap bisa diaudit. */
  'DELETE /api/items': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    try { json(res, 200, { ok: true, item: await db.deleteItem(String(q.get('id') || ''), u) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  'GET /api/stock': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, {
      moves: await db.listStockMoves({
        itemId: q.get('itemId') || '',
        limit: q.get('limit') || 100
      })
    });
  },

  /* Penerimaan & koreksi stok terbuka untuk semua peran (bagian dari
     pengelolaan barang di tab Produk & Stok). Pengeluaran TIDAK lewat sini:
     ia harus melalui /api/usage supaya satu transaksi sekaligus mengurangi
     stok DAN membuat baris invoice. Kalau stok boleh dikurangi langsung,
     obat bisa keluar tanpa pernah ditagih. */
  'POST /api/stock': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = await readBody(req);
    if (b && b.jenis === 'keluar') {
      return json(res, 400, {
        error: 'Pengeluaran stok dicatat lewat /api/usage agar invoice ikut terbentuk.'
      });
    }
    try { json(res, 200, await db.addStockMove(Object.assign({}, b, { oleh: u }))); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  /* Pemakaian untuk satu kunjungan: stok turun + invoice bertambah + status
     dihitung ulang, semuanya dalam satu transaksi di db.confirmUsage(). */
  'POST /api/usage': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = (await readBody(req)) || {};
    if (!b.visitId) return json(res, 400, { error: 'Kunjungan tidak disebutkan.' });
    try { json(res, 200, await db.confirmUsage(Object.assign({}, b, { oleh: u }))); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  /* --- Keuangan: invoice, pembayaran, laporan ---
   *
   * Mencatat tagihan dan menerima pembayaran terbuka untuk semua petugas
   * yang sudah masuk — kasir dan perawat memang perlu melakukannya.
   * Membatalkan/mengubah status invoice adalah kontrol keuangan, jadi admin:
   * tanpa batas itu, tagihan yang sudah tercatat bisa "dihilangkan" dari
   * laporan oleh siapa pun yang memegang sesi.
   */
  'GET /api/invoices': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    try {
      json(res, 200, {
        invoices: await db.listInvoices({
          from: q.get('from') || '',
          to: q.get('to') || '',
          status: q.get('status') || '',
          patientId: q.get('patientId') || '',
          limit: q.get('limit') || 200
        })
      });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'GET /api/invoice': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const inv = await db.getInvoice(String(q.get('id') || ''));
    if (!inv) return json(res, 404, { error: 'Invoice tidak ditemukan.' });
    json(res, 200, { invoice: inv });
  },

  'POST /api/invoices': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = (await readBody(req)) || {};
    try {
      json(res, 200, { invoice: await db.createInvoice(Object.assign({}, b, { oleh: u })) });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/payments': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = (await readBody(req)) || {};
    try {
      json(res, 200, await db.addPayment(Object.assign({}, b, { oleh: u })));
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/invoices/status': async (req, res) => {
    const u = await requireAdmin(req, res); if (!u) return;
    const b = (await readBody(req)) || {};
    try {
      json(res, 200, { invoice: await db.setInvoiceStatus({ id: b.id, status: b.status, oleh: u }) });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'GET /api/revenue': async (req, res, q) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    json(res, 200, await db.revenueSummary({
      from: q.get('from') || '',
      to: q.get('to') || ''
    }));
  },

  /* Riwayat perubahan persediaan & kasir — admin saja.
     Isinya menyebut siapa mengubah harga, siapa menerima uang, dan siapa
     membatalkan tagihan. Itu kontrol keuangan, bukan bacaan umum, jadi
     dibatasi sama seperti /api/access. */
  'GET /api/finance-log': async (req, res, q) => {
    if (!await requireAdmin(req, res)) return;
    try {
      json(res, 200, {
        log: await db.listFinanceLog({
          modul: q.get('modul') || '',
          limit: q.get('limit') || 200
        })
      });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  /* --- Cadangan .zip: manifest + foto, DIALIRKAN ---
   *
   * Ini jalur cadangan yang benar untuk data skala nyata.
   *
   * `GET /api/export` (JSON tunggal) masih ada dan tetap berguna untuk
   * data kecil, tapi ia membungkus SETIAP foto sebagai base64 dalam satu
   * respons. Base64 menambah 33%, dan Vercel membatasi badan permintaan
   * serverless pada 4,5 MB — bukan 8 MB seperti batas yang ditetapkan
   * readBody() di berkas ini. Suatu saat restaurar akan selalu gagal,
   * bukan hanya pelan.
   *
   * Di sini foto menjadi berkas terpisah di dalam arsip, ditulis sambil
   * mengalir: satu foto held di memori pada satu waktu, sisanya langsung
   * ditulis ke koneksi. Panjang respons tidak dibatasi oleh ukuran ZIP,
   * hanya oleh ukuran database.
   */
  'GET /api/backup.zip': async (req, res) => {
    if (!await requireAdmin(req, res)) return;

    const d = new Date();
    const tgl = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="woundcare-cadangan-${tgl}.zip"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });

    const z = new ZipWriter(res, { date: d });
    try {
      const snap = await db.backupManifest(await clinicConfig());
      await z.add('manifest.json', Buffer.from(JSON.stringify(snap), 'utf8'));

      const ekst = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      let n = 0;
      for await (const f of db.photoStream()) {
        await z.add(`photos/${f.id}.${ekst[f.mime] || 'jpg'}`, f.bytes, f.dibuat);
        n++;
      }
      await z.finish();
      res.end();
      console.log(`[api] backup.zip selesai: ${snap.patients.length} pasien, ${n} foto`);
    } catch (e) {
      console.error('[api] backup.zip', e);
      // Header sudah terkirim, jadi tidak bisa kirim JSON error.
      // Putuskan saja koneksi agar peramban tahu arsipnya tidak utuh.
      try { res.destroy(); } catch (_) {}
    }
  },

  /* --- Unggah satu foto saat memulihkan arsip ---
   *
   * Terpisah dari POST /api/photos yang biasa: yang itu untuk petugas
   * mengunggah foto luka, sedangkan ini bagian dari pemulihan, jadi
   * WAJIB admin dan tidak boleh mencatat akses per-pasien.
   *
   * Body-nya biner mentah, bukan JSON dan bukan multipart — multipart
   * menambah lapisan yang tidak perlu dan ukurannya lebih besar.
   */
  'POST /api/backup/photos': async (req, res, q) => {
    if (!await requireAdmin(req, res)) return;

    const visitId = String(q.get('visitId') || '');
    const kind = String(q.get('kind') || '');
    if (!visitId) return json(res, 400, { error: 'Kunjungan tidak disebutkan.' });
    if (KIND_FOTO.indexOf(kind) < 0) return json(res, 400, { error: 'Jenis foto tidak dikenal.' });

    let bytes;
    try { bytes = await readBinary(req); }
    catch (e) { return json(res, 413, { error: e.message }); }
    if (!bytes.length) return json(res, 400, { error: 'Isi foto kosong.' });

    const mime = jenisGambar(bytes);
    if (!mime) return json(res, 415, { error: 'Berkas bukan gambar JPEG atau PNG.' });

    try {
      const ref = await db.savePhotoFor(visitId, kind, {
        mime,
        bytes,
        width: Number(q.get('width')) || 0,
        height: Number(q.get('height')) || 0
      });
      json(res, 200, { ok: true, photo: ref });
    } catch (e) {
      console.error('[api] backup/photos', e);
      json(res, 500, { error: 'Gagal menyimpan foto.' });
    }
  },

  /* --- Cadangan lengkap (foto disertakan sebagai base64) --- */
  'GET /api/export': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    json(res, 200, await db.exportSnapshot(await clinicConfig()));
  },

  /* --- Pulihkan cadangan / muat data contoh --- */
  'POST /api/bulk': async (req, res) => {
    const u = await requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const snap = b && b.snapshot;
    if (!snap || !Array.isArray(snap.patients)) {
      return json(res, 400, { error: 'Snapshot tidak lengkap.' });
    }

    /* Validasi ISI, bukan hanya bentuknya.
     *
     * Sebelumnya hanya diperiksa "!Array.isArray(snap.patients)". Berkas
     * apa pun yang kebetulan punya kunci "patients" — termasuk berkas
     * terpotong atau salah pilih — akan diterima. Dalam mode 'replace'
     * itu berarti: DELETE FROM patients, visits, consents, photos,
     * audit_log ... lalu nol baris diisi. Hasilnya basis data kosong,
     * dan pesan success tetap berbunyi "0 pasien dipulihkan".
     *
     * Karena itu setiap entri wajib punya id sebelum apa pun dihapus.
     */
    const cacat = snap.patients.filter(p => !p || typeof p !== 'object' || !p.id).length;
    if (cacat) {
      return json(res, 400, {
        error: `${cacat} catatan pasien tidak punya id. Pemulihan dibatalkan, data lama tidak disentuh.`
      });
    }
    if (snap.patients.length === 0 && (b.mode || 'replace') !== 'replace') {
      return json(res, 400, { error: 'Berkas tidak berisi pasien apa pun.' });
    }

    const mode = b.mode === 'merge' ? 'merge' : 'replace';
    try {
      const sebelum = await db.stats();
      /* fotoIds = daftar id foto yang ada di cadangan. Saat memulihkan
         arsip .zip, foto sudah diunggah lewat /api/backup/photos lebih
         dulu; daftar ini yang membuat replaceAll() membuang foto LAMA
         tanpa ikut membuang foto yang baru saja dikirim. */
      const fotoIds = Array.isArray(b.fotoIds) ? b.fotoIds.filter(x => typeof x === 'string') : null;
      const n = await db.replaceAll(snap, mode === 'merge', { fotoIds });
      if (snap.meta && snap.meta.clinic) await db.saveClinicConfig(snap.meta.clinic, DEFAULT_CLINIC);

      /* Jejak audit untuk pemulihan.
       *
       * Tanpa baris ini, mode 'replace' menghapus seluruh access_log
       * dan TIDAK meninggalkan catatan bahwa pemulihan itu terjadi.
       * Untuk rekam medis itu lubang kepatuhan, bukan sekadar fitur
       * yang kurang: tidak ada yang bisa membuktikan data diubah atau
       * kapan. 'pulih' sudah ada di AKSI_VALID, tapi tidak pernah dipanggil
       * dari jalur ini.
       */
      await db.recordAccess(u, clientIp(req), {
        aksi: 'pulih',
        detail: `${mode === 'merge' ? 'Gabung' : 'Ganti total'} — ${snap.patients.length} pasien dipulihkan, ` +
                `total ${sebelum.patients} → ${n}`
      });

      json(res, 200, { ok: true, patients: n, mode });
    } catch (e) {
      console.error('[api] bulk', e);
      json(res, 500, { error: 'Gagal menyimpan snapshot.' });
    }
  },

  /* --- Admin: kelola pengguna --- */
  'GET /api/users': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    json(res, 200, { users: await db.listUsers() });
  },

  'POST /api/users': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    try { json(res, 200, { user: await db.createUser(await readBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  /* Sandi sendiri: BOLEH untuk semua petugas yang sudah masuk. */
  'POST /api/users/password': async (req, res) => {
    const u = await currentUser(req); if (!u) return json(res, 401, { error: 'Belum masuk.' });
    const b = await readBody(req);
    if (!b.password || String(b.password).length < 8) {
      return json(res, 400, { error: 'Sandi baru minimal 8 karakter.' });
    }
    await db.setPassword(u.id, b.password);
    await db.logout(cookies(req)[COOKIE]);
    setCookie(res, COOKIE, '', 0);
    json(res, 200, { ok: true, relogin: true });
  },

  'DELETE /api/users': async (req, res, q) => {
    const u = await requireAdmin(req, res);
    if (!u) return;
    const id = Number(q.get('id'));
    // Menonaktifkan diri sendiri sudah cukup untuk mencabut akses.
    if (id === u.id) {
      return json(res, 400, { error: 'Anda tidak bisa menghapus akun yang sedang dipakai. Nonaktifkan saja bila aksesnya mau dicabut.' });
    }
    try { json(res, 200, { ok: true, deleted: await db.deleteUser(id) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/users/role': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const b = await readBody(req);
    try { json(res, 200, { user: await db.setRole(Number(b.id), b.peran) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/users/reset': async (req, res) => {
    const aku = await requireAdmin(req, res);
    if (!aku) return;
    const b = await readBody(req);
    try {
      await db.adminSetPassword(Number(b.id), b.password);
      const relogin = Number(b.id) === aku.id;
      if (relogin) setCookie(res, COOKIE, '', 0);
      json(res, 200, { ok: true, relogin });
    }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/users/active': async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    const b = await readBody(req);
    try { json(res, 200, { ok: true, active: await db.setActive(Number(b.id), !!b.aktif) }); }
    catch (e) { return json(res, 400, { error: e.message }); }
    json(res, 200, { ok: true });
  }
};

/* ---------- Dispatcher ---------- */

/**
 * Satu handler untuk dua tempat: server lokal dan fungsi Vercel.
 * Vercel memberi req/res Node biasa, jadi tidak ada penyesuaian.
 */
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (!p.startsWith('/api/')) {
    // Di Vercel berkas statis dilayani CDN dari hasil build.
    if (ON_VERCEL) return;
    if (serveDist(req, res, p)) return;
    return;
  }

  const key = `${req.method} ${p}`;
  const fn = routes[key];
  if (!fn) return json(res, 404, { error: 'Endpoint tidak dikenal.' });

  try {
    await fn(req, res, url.searchParams, url.searchParams.get('id'));
  } catch (e) {
    console.error('[api]', key, e);
    if (!res.headersSent) json(res, 500, { error: 'Terjadi kesalahan di server.' });
  }
}

module.exports = handler;
module.exports.handler = handler;

/* ---------- Mode lokal ---------- */

if (require.main === module) {
  db.ready()
    .then(() => db.purgeSessions())
    .catch(e => { console.error('[db] gagal:', e.message); });

  http.createServer(handler).listen(PORT, () => {
    console.log('');
    console.log('  WoundCare EHR');
    console.log('  ---------------------------------------------');
    console.log(`  Aplikasi : http://localhost:${PORT}`);
    console.log(`  Basis data: ${process.env.DATABASE_URL ? 'PostgreSQL' : '(DATABASE_URL belum diisi)'}`);
    console.log('  Login    : admin / woundcare123');
    console.log('             slamet / woundcare123');
    console.log('             perawat / woundcare123');
    console.log('');
  });
}