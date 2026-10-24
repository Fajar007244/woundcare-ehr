/* ============================================================
   scales.js — Definisi klinis & utilitas skor
   ============================================================
   Arah skor: SEMUA item bernilai 1..5, nilai TINGGI = Luka LEBIH BURUK.
   Versi final pemilik klinik memakai 10 aspek, sehingga rentang total
   10 (sembuh) .. 50 (sangat buruk). Tiga aspek lama (tipe & jumlah
   jaringan nekrotik serta indurasi) sengaja dilepas agar penilaian
   lebih cepat di bedside dan tidak tumpang tindih dengan aspek lain.
   ============================================================ */

const Scales = (() => {

  /* ---------- 10 aspek WINNER Scale (urutan baku) ---------- */
  const ITEMS = [
    { key: 'size', label: 'Ukuran Luka', en: 'Size',
      anchors: {
        1: 'Sangat kecil, < 0,5 cm2',
        2: 'Kecil, 0,5 - 1 cm2',
        3: 'Sedang, 1 - 4 cm2',
        4: 'Besar, 4 - 16 cm2',
        5: 'Sangat besar, > 16 cm2'
      } },
    { key: 'depth', label: 'Kedalaman Luka', en: 'Depth',
      anchors: {
        1: 'Stage 1, superfisial (hanya dermis)',
        2: 'Melampaui dermis',
        3: 'Mencapai otot / tendon',
        4: 'Mencapai tulang',
        5: 'Nekrosis luas / tidak dapat dinilai'
      } },
    { key: 'edges', label: 'Tepi Luka', en: 'Edges',
      anchors: {
        1: 'Tepi baik, tegas, rata',
        2: 'Tepi jelas, sedikit meninggi',
        3: 'Tepi mulai menggantung',
        4: 'Fibrotik, mengeras ke jaringan sekitar',
        5: 'Fibrotik / hiperkeratotik, rolled / everted'
      } },
    { key: 'undermining', label: 'Gua / Terowongan', en: 'Undermining',
      anchors: {
        1: 'Tidak ada goa / terowongan',
        2: 'Terowongan dangkal, < 2 mm',
        3: 'Terowongan sedang, 2 - 6 mm',
        4: 'Terowongan dalam, > 6 mm',
        5: 'Terowongan luas, menembus fasia'
      } },
    { key: 'exType', label: 'Tipe Eksudat', en: 'Exudate Type',
      anchors: {
        1: 'Tidak ada',
        2: 'Serous, jernih',
        3: 'Serosanguinous',
        4: 'Sanguinous, merah',
        5: 'Purulent / abses'
      } },
    { key: 'exAmount', label: 'Jumlah Eksudat', en: 'Exudate Amount',
      anchors: {
        1: 'Tidak ada',
        2: 'Sedikit',
        3: 'Sedang',
        4: 'Banyak',
        5: 'Sangat banyak, ganti dressing harian'
      } },
    { key: 'skinColor', label: 'Warna Kulit Sekitar Luka', en: 'Surrounding Skin Color',
      anchors: {
        1: 'Normal',
        2: 'Pink / eritema tipis',
        3: 'Merah',
        4: 'Gelap / kebiruan',
        5: 'Hitam / nekrotik'
      } },
    { key: 'edema', label: 'Jaringan Edema', en: 'Peripheral Edema',
      anchors: {
        1: 'Tidak ada',
        2: 'Ringan',
        3: 'Sedang',
        4: 'Berat',
        5: 'Sangat berat, peau d\'orange'
      } },
    { key: 'granulation', label: 'Jaringan Granulasi', en: 'Granulation Tissue',
      anchors: {
        1: 'Sehat, 100%, tanpa edema',
        2: 'Lebih dari 75%',
        3: '50 - 75%',
        4: 'Kurang dari 50%',
        5: 'Tidak ada'
      } },
    { key: 'epithelial', label: 'Epitelisasi', en: 'Epithelialization',
      anchors: {
        1: 'Lengkap, luka tertutup 100%',
        2: 'Lebih dari 75%',
        3: '50 - 75%',
        4: 'Kurang dari 50%',
        5: 'Tidak ada'
      } }
  ];

  /* ---------- Band keparahan ----------
     Batas lama (13..65, span 52) dipotong di 24, 38, dan 52. Jarak tiap
     potongan dari titik terendah adalah 11, 25, dan 39 — yaitu fraksi
     11/52, 25/52, dan 39/52 dari seluruh rentang. Agar arti band tetap
     sama setelah rentang menyusut menjadi 10..50 (span 40), fraksi yang
     sama diterapkan ke span baru: 10 + 11/52*40 = 18,5 -> 18;
     10 + 25/52*40 = 19,2 -> 19; 10 + 39/52*40 = 40,0 -> 40. Karena itu
     batasnya menjadi 10 | 11-18 | 19-29 | 30-40 | 41-50. Angka-angka ini
     bukan angka sakti, melainkan hasil pembulatan fraksi di atas. */
  const BANDS = [
    { min: 10, max: 10, label: 'Sembuh / Epitelisasi Lengkap',            short: 'Sembuh',        tone: 'ok' },
    { min: 11, max: 18, label: 'Sangat Ringan, intervensi minimal',        short: 'Sangat Ringan', tone: 'ok' },
    { min: 19, max: 29, label: 'Ringan - Sedang, terapi aktif berkelanjutan', short: 'Ringan - Sedang', tone: 'info' },
    { min: 30, max: 40, label: 'Sedang - Berat, pemantauan intensif',       short: 'Sedang - Berat', tone: 'warn' },
    { min: 41, max: 50, label: 'Sangat Buruk, tata laksana kompleks / rujuk', short: 'Sangat Buruk',  tone: 'danger' }
  ];

  const MIN_TOTAL = 10;
  const MAX_TOTAL = 50;

  /* ---------- Perkiraan penyembuhan ----------
     Estimasi edukatif dari pemilik klinik: total skor dikali 12 lalu
     dibagi 55. Pembilang dan penyebut sengaja dinamai supaya bila
     pemilik klinik mengubah rasio, cukup satu tempat yang disentuh.
     Pembagian 55 (bukan 50) adalah koreksi final; jangan "rapikan"
     menjadi 50 hanya karena rentang totalnya 10..50. */
  const HEALING_NUMERATOR = 12;
  const HEALING_DIVISOR = 55;

  /**
   * Perkiraan lama penyembuhan dalam minggu (satu desimal).
   * Ini ESTIMASI EDUKATIF, bukan prognosis medis dan tidak boleh
   * dipakai sebagai janji kepada pasien.
   */
  function healingWeeks(total) {
    if (total == null) return null;
    return Math.round((total * HEALING_NUMERATOR / HEALING_DIVISOR) * 10) / 10;
  }

  /* ---------- Hitung total ---------- */
  function total(scores) {
    if (!scores) return null;
    let sum = 0, filled = 0;
    for (const it of ITEMS) {
      const v = Number(scores[it.key]);
      if (v >= 1 && v <= 5) { sum += v; filled++; }
    }
    return filled === 0 ? null : { sum, filled, of: ITEMS.length };
  }

  function band(sum) {
    if (sum == null) return null;
    return BANDS.find(b => sum >= b.min && sum <= b.max) || BANDS[BANDS.length - 1];
  }

  /**
   * Persentase perubahan dari `from` menuju `to`.
   * KONVENSI: nilai POSITIF = membaik (nilai turun), NEGATIF = memburuk.
   * Karena pada WINNER Scale & luas luka, angka yang lebih kecil = lebih baik.
   */
  function delta(from, to) {
    if (from == null || to == null || !from || !to) return null;
    return Math.round(((from - to) / from) * 1000) / 10;
  }

  /** Tren antar kunjungan, berdasarkan skor tertinggi & terakhir. */
  function trend(series) {
    const valid = (series || []).filter(s => s.score != null);
    if (valid.length < 2) {
      return { dir: 'flat', text: 'Perlu minimal 2 kunjungan berskor', tone: 'muted', delta: null };
    }
    const first = valid[0].score;
    const last  = valid[valid.length - 1].score;
    const d = delta(first, last);
    if (d === null) return { dir: 'flat', text: 'Belum ada pembanding', tone: 'muted', delta: null };

    // d positif = skor turun = membaik
    if (d >= 10)  return { dir: 'down', text: `Membaik ${d}%`,      tone: 'ok',     delta: d };
    if (d <= -10) return { dir: 'up',   text: `Memburuk ${Math.abs(d)}%`, tone: 'danger', delta: d };
    return { dir: 'flat', text: `Stabil ${d > 0 ? '+' : ''}${d}%`, tone: 'warn', delta: d };
  }

  /* ---------- Luas luka (cm2) dari panjang x lebar ---------- */
  function areaCm2(dim) {
    const p = parseFloat(dim && dim.panjang);
    const l = parseFloat(dim && dim.lebar);
    if (!isFinite(p) || !isFinite(l) || p <= 0 || l <= 0) return null;
    return Math.round(p * l * 100) / 100;
  }

  /* ---------- Persentase jaringan dasar luka ---------- */
  const TISSUE_KEYS = ['nekrotik', 'slough', 'granulasi', 'epitel'];

  function tissueSum(t) {
    if (!t) return null;
    return TISSUE_KEYS.reduce((s, k) => s + (Number(t[k]) || 0), 0);
  }

  /** Normalisasi proporsional sehingga total tepat 100. */
  function normalizeTissue(t) {
    const vals = TISSUE_KEYS.map(k => Number(t && t[k]) || 0);
    const sum = vals.reduce((a, b) => a + b, 0);
    const out = { nekrotik: 0, slough: 0, granulasi: 0, epitel: 0 };
    if (sum <= 0) return out;

    let acc = 0;
    TISSUE_KEYS.forEach((k, i) => {
      if (i === TISSUE_KEYS.length - 1) out[k] = 100 - acc;
      else { out[k] = Math.round((vals[i] / sum) * 100); acc += out[k]; }
    });
    return out;
  }

  /** Parameter dengan skor tertinggi, untuk IListar perhatian. */
  function worstItems(scores, n = 3) {
    return ITEMS
      .map(it => ({ item: it, score: Number(scores && scores[it.key]) || 0 }))
      .filter(x => x.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  return {
    ITEMS, BANDS, MIN_TOTAL, MAX_TOTAL, TISSUE_KEYS,
    HEALING_NUMERATOR, HEALING_DIVISOR,
    total, band, delta, trend, areaCm2, healingWeeks,
    tissueSum, normalizeTissue, worstItems
  };
})();