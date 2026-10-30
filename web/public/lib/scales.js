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
    /* Enam aspek pertama mengikuti formulir RM. 03.1 PENGKAJIAN LUKA
       (Wocare Center, Bogor) apa adanya: rentang, urutan, dan istilahnya
       disalin dari formulir resmi, bukan ditafsirkan ulang. */
    { key: 'size', label: 'Ukuran Luka', en: 'Size',
      anchors: {
        1: 'P × L < 4 cm',
        2: 'P × L 4 – < 16 cm',
        3: 'P × L 16 – < 36 cm',
        4: 'P × L 36 – < 80 cm',
        5: 'P × L > 80 cm'
      } },
    { key: 'depth', label: 'Kedalaman Luka', en: 'Depth',
      anchors: {
        1: 'Stage 1',
        2: 'Stage 2',
        3: 'Stage 3',
        4: 'Stage 4',
        5: 'Necrosis wound'
      } },
    { key: 'edges', label: 'Tepi Luka', en: 'Edges',
      anchors: {
        1: 'Samar, tidak jelas terlihat',
        2: 'Batas tepi terlihat, menyatu dengan dasar luka',
        3: 'Jelas, tidak menyatu dengan dasar luka',
        4: 'Jelas, tidak menyatu dengan dasar luka, tebal',
        5: 'Jelas, fibrotik, parut tebal / hiperkeratotik'
      } },
    { key: 'undermining', label: 'Gua / Terowongan', en: 'Undermining',
      anchors: {
        1: 'Tidak ada',
        2: 'Goa < 2 cm di area manapun',
        3: 'Goa 2 – 4 cm, < 50% pinggir luka',
        4: 'Goa 2 – 4 cm, > 50% pinggir luka',
        5: 'Goa > 4 cm di area manapun'
      } },
    { key: 'exType', label: 'Tipe Eksudat', en: 'Exudate Type',
      anchors: {
        1: 'Tidak ada',
        2: 'Bloody',
        3: 'Serosanguineous',
        4: 'Serous',
        5: 'Purulent'
      } },
    { key: 'exAmount', label: 'Jumlah Eksudat', en: 'Exudate Amount',
      anchors: {
        1: 'Kering',
        2: 'Moist',
        3: 'Sedikit',
        4: 'Sedang',
        5: 'Banyak'
      } },
    /* Empat aspek terakhir mengikuti formulir RM. 03.2 PENGKAJIAN LUKA
       (Wocare Center, Bogor). */
    { key: 'skinColor', label: 'Warna Kulit Sekitar Luka', en: 'Surrounding Skin Color',
      anchors: {
        1: 'Pink atau normal',
        2: 'Merah terang jika ditekan',
        3: 'Putih atau pucat atau hipopigmentasi',
        4: 'Merah gelap',
        5: 'Hitam atau hiperpigmentasi'
      } },
    { key: 'edema', label: 'Jaringan Edema', en: 'Peripheral Edema',
      anchors: {
        1: 'No swelling atau edema',
        2: 'Non pitting edema < 4 cm di sekitar luka',
        3: 'Non pitting edema > 4 cm di sekitar luka',
        4: 'Pitting edema < 4 cm di sekitar luka',
        5: 'Krepitasi atau pitting edema > 4 cm'
      } },
    { key: 'granulation', label: 'Jaringan Granulasi', en: 'Granulation Tissue',
      anchors: {
        1: 'Kulit utuh atau stage 1',
        2: 'Terang, 100% jaringan granulasi',
        3: 'Terang, 50% jaringan granulasi',
        4: 'Granulasi 25%',
        5: 'Tidak ada jaringan granulasi'
      } },
    { key: 'epithelial', label: 'Epitelisasi', en: 'Epithelialization',
      anchors: {
        1: '100% epitelisasi',
        2: '75% – 100% epitelisasi',
        3: '50% – 75% epitelisasi',
        4: '25% – 50% epitelisasi',
        5: '< 25% epitelisasi'
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