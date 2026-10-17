/* ============================================================
   api/index.js — Fungsi serverless untuk Vercel
   ============================================================
   Vercel mencari fungsi di folder `api/`. Berkas ini hanya meneruskan
   permintaan ke handler yang sama dengan server lokal, jadi tidak ada
   logika yang terduplikasi.

   Jalur /api/* sudah diperbaiki oleh vercel.json agar semuanya masuk ke /api.
   ============================================================ */

module.exports = require('../server.js');