/* Pemeriksaan karakter asing (CJK / Cyrillic / Hangul) yang bocor dari
   proses edit otomatis.

   Menjalankan:  node cek-karakter.js
   Keluar bukan-nol kalau ada; berguna sebagai gerbang sebelum commit.

   POLA dibangun dari escape unicode, BUKAN karakter harfiah, supaya berkas
   ini sendiri tidak memicu peringatannya sendiri. */

const fs = require('fs');
const path = require('path');

const SKIP = [/node_modules/, /[\\/]dist[\\/]/, /[\\/]public[\\/]lib[\\/]/, /[\\/]data[\\/]/];
const POLA = new RegExp(
  '[\\u3000-\\u9fff\\uff00-\\uffef\\uac00-\\ud7af\\u0400-\\u04ff]'
);

let bad = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.some(r => r.test(p))) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(jsx|js|css|html|md)$/.test(e.name)) continue;
    if (p === 'cek-karakter.js') continue;

    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((baris, i) => {
      if (POLA.test(baris)) {
        bad++;
        console.log(p + ':' + (i + 1) + ': ' + baris.trim());
      }
    });
  }
}

walk('.');

console.log(bad === 0 ? 'KARAKTER ASING: bersih' : bad + ' baris bermasalah');
process.exit(bad === 0 ? 0 : 1);