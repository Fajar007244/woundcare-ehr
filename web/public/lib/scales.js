/* ============================================================
   scales.js — Definisi klinis & utilitas skor
   ============================================================
   Arah skor: SEMUA item bernilai 1..5, nilai TINGGI = Luka LEBIH BURUK.
   Rentang total 13 (sembuh) .. 65 (sangat buruk).
   ============================================================ */

const Scales = (() => {

  /* ---------- 13 parameter WINNER Scale ---------- */
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
        1: 'Superfisial, hanya dermis',
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
        4: 'Fibrotik, nyerah ke jaringan',
        5: 'Terangkat / rolled / everted'
      } },
    { key: 'undermining', label: 'Gua / Undermining', en: 'Undermining',
      anchors: {
        1: 'Tidak ada',
        2: 'Ringan, < 2 mm',
        3: 'Sedang, 2 - 6 mm',
        4: 'Berat, > 6 mm',
        5: 'Sangat berat, probed hingga mudah'
      } },
    { key: 'necType', label: 'Tipe Jaringan Nekrotik', en: 'Necrotic Tissue Type',
      anchors: {
        1: 'Tidak ada',
        2: 'Epidermis',
        3: 'Lemak subkutan',
        4: 'Otot',
        5: 'Tulang / tendon'
      } },
    { key: 'necAmount', label: 'Jumlah Jaringan Nekrotik', en: 'Necrotic Amount',
      anchors: {
        1: 'Tidak ada, 0%',
        2: '< 10%',
        3: '10 - 50%',
        4: '50 - 90%',
        5: '> 90%'
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
    { key: 'edema', label: 'Edema Jaringan Sekitar', en: 'Peripheral Edema',
      anchors: {
        1: 'Tidak ada',
        2: 'Ringan',
        3: 'Sedang',
        4: 'Berat',
        5: 'Sangat berat, peau d orange'
      } },
    { key: 'induration', label: 'Indurasi Jaringan Sekitar', en: 'Peripheral Induration',
      anchors: {
        1: 'Tidak ada',
        2: 'Ringan',
        3: 'Sedang',
        4: 'Berat',
        5: 'Sangat berat, jaringan berbatu'
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

  /* ---------- Band keparahan ---------- */
  const BANDS = [
    { min: 13, max: 13, label: 'Sembuh / Epitelisasi Lengkap',            short: 'Sembuh',        tone: 'ok' },
    { min: 14, max: 24, label: 'Sangat Ringan, intervensi minimal',        short: 'Sangat Ringan', tone: 'ok' },
    { min: 25, max: 38, label: 'Ringan - Sedang, terapi aktif berkelanjutan', short: 'Ringan - Sedang', tone: 'info' },
    { min: 39, max: 52, label: 'Sedang - Berat, pemantauan intensif',       short: 'Sedang - Berat', tone: 'warn' },
    { min: 53, max: 65, label: 'Sangat Buruk,tenance kompleks / rujuk',   short: 'Sangat Buruk',  tone: 'danger' }
  ];

  const MIN_TOTAL = 13;
  const MAX_TOTAL = 65;

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
    total, band, delta, trend, areaCm2,
    tissueSum, normalizeTissue, worstItems
  };
})();