/* ============================================================
   migrate-sqlite.cjs — Pindahkan data dari SQLite ke PostgreSQL
   ============================================================
   Jalankan SEKALI, di komputer ini, setelah DATABASE_URL diisi:

       node migrate-sqlite.cjs

   Membaca data/woundcare.db (SQLite, basis data lama) lalu
   menuliskannya ke PostgreSQL lewat lapisan data yang sama (db.js).

   Sifatnya AMAN DIPANGGIL ULANG: patient & kunjungan ditulis dengan
   upsert berdasarkan id, dan id foto bersifat deterministik dari isi
   berkasnya — jadi menjalankan dua kali tidak menghasilkan duplikat.

   Perintah balancing: skrip ini hanya MIGRASI. Untuk pengembangan
   harian tetap pakai SQLite? Tidak bisa — db.js sekarang PostgreSQL.
   Kembalikan basis data lama lewat berkas cadangan bila perlu.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;

/* ---------- Ambil DATABASE_URL dari .env bila ada ---------- */

function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}
loadEnv();

const SRC = process.env.SOURCE_DB || path.join(ROOT, 'data', 'woundcare.db');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL belum diisi.');
    console.error('  Salin .env.example menjadi .env lalu isi, atau set manual:\n');
    console.error('    $env:DATABASE_URL="postgresql://postgres:PASSWORD@db.xxx.supabase.co:6543/postgres"\n');
    process.exit(1);
  }
  if (!fs.existsSync(SRC)) {
    console.error('\n  Basis data sumber tidak ditemukan: ' + SRC);
    process.exit(1);
  }

  const db = require('./db');                       // PostgreSQL
  const src = new DatabaseSync(SRC, { readOnly: true });  // SQLite

  console.log('\n  Sumber  : ' + SRC);
  console.log('  Tujuan  : PostgreSQL (melalui db.js)\n');

  await db.ready();
  console.log('  [1/5] skema PostgreSQL siap');

  /* ---------- Pasien ---------- */
  const patients = src.prepare('SELECT * FROM patients').all();
  for (const r of patients) {
    const p = JSON.parse(r.data);
    p.id = r.id; p.mrNumber = r.mr_number;
    p.archived = !!r.archived;
    await db.savePatient(p);
  }
  console.log('  [2/5] ' + patients.length + ' pasien');

  /* ---------- Foto (harus lebih dulu:jukungan menghasilkan id rujukan) ---------- */
  let jumlahFoto = 0;
  const photos = src.prepare('SELECT * FROM photos').all();
  for (const r of photos) {
    const buf = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
    await db.savePhotoFor(r.visit_id, r.kind, {
      mime: r.mime, bytes: buf, width: r.width, height: r.height
    });
    jumlahFoto++;
  }
  console.log('  [3/5] ' + jumlahFoto + ' foto (BLOB -> BYTEA)');

  /* ---------- Kunjungan ----------
     Disimpan setelah foto supaya splitPhotos() bisa memasang rujukannya. */
  const visits = src.prepare('SELECT * FROM visits').all();
  let ordut = 0;
  for (const r of visits) {
    const v = JSON.parse(r.data);
    v.id = r.id;
    v.frozen = !!r.frozen;
    if (r.data.indexOf('"id":"ph_') >= 0) {
      const m = /"before":\{"id":"(ph_[a-f0-9]+)"/.exec(r.data);
      const m2 = /"after":\{"id":"(ph_[a-f0-9]+)"/.exec(r.data);
      if (m)  v.photos.before = { id: m[1] };
      if (m2) v.photos.after  = { id: m2[1] };
    }
    await db.saveVisit({ patientId: r.patient_id, visit: v });
    ordut++;
    if (ordut % 50 === 0) process.stdout.write('.');
  }
  console.log('\n  [4/5] ' + visits.length + ' kunjungan');

  /* ---------- Persetujuan ---------- */
  const consents = src.prepare('SELECT * FROM consents').all();
  for (const r of consents) await db.saveConsent(r.patient_id, JSON.parse(r.data));
  console.log('  [5/5] ' + consents.length + ' persetujuan');

  /* ---------- Audit ---------- */
  const audits = src.prepare('SELECT * FROM audit_log').all();
  for (const a of audits) {
    await db.appendAudit(
      null, a.patient_id, a.visit_id,
      { key: a.kolom, label: a.label, before: a.sebelum, after: a.sesudah,
        risky: !!a.risky, oleh: a.oleh_nama, at: a.pada }
    );
  }

  /* ---------- Identitas klinik ---------- */
  const clinicFile = path.join(ROOT, 'data', 'clinic.json');
  if (fs.existsSync(clinicFile)) {
    await db.saveClinicConfig(JSON.parse(fs.readFileSync(clinicFile, 'utf8')), {});
  }

  src.close();
  const s = await db.stats();
  console.log('\n  ==============================================');
  console.log('  HASIL   pasien ' + s.patients + ' · kunjungan ' + s.visits +
              ' · persetujuan ' + s.consent + ' · audit ' + s.audit +
              ' · foto ' + s.foto);
  console.log('  ==============================================\n');
  await db.close();
})().catch(e => {
  console.error('\n  ERROR: ' + e.message + '\n');
  process.exit(1);
});