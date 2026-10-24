/* ============================================================
   charts.js — Grafik tren WINNER Scale (canvas, tanpa library)
   ============================================================
   Sumbu Y dibalik maknanya: makin ke BAWAH = makin membaik.
   Zona hijau di bawah = target menyembuh.
   ============================================================ */

const Charts = (() => {

  const COLORS = {
    score:    '#0f766e',
    scoreFill:'rgba(15, 118, 110, .12)',
    area:     '#b45309',
    nrs:      '#1d4ed8',
    grid:     '#e4ebef',
    axis:     '#5c7180',
    text:     '#16232c',
    bandOk:   'rgba(34, 197, 94, .10)',
    bandBad:  'rgba(239, 68, 68, .07)'
  };

  /**
   * Gambar grafik tren.
   * @param {HTMLCanvasElement} canvas
   * @param {Array} points  [{ date, score, area, nrs }]
   * @param {Object} opts   { showArea, showNrs }
   */
  function drawTrend(canvas, points, opts = {}) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    const cssH = opts.height || 300;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const data = (points || []).filter(p => p && p.date);
    if (data.length === 0) {
      ctx.fillStyle = '#9fb0bc';
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Belum ada data untuk digrafikkan.', cssW / 2, cssH / 2);
      return null;
    }

    const hasArea = opts.showArea && data.some(p => typeof p.area === 'number' && p.area > 0);
    const M = { top: 22, right: hasArea ? 52 : 22, bottom: 34, left: 42 };
    const W = cssW - M.left - M.right;
    const H = cssH - M.top - M.bottom;

    const yMin = Scales.MIN_TOTAL;
    const yMax = Scales.MAX_TOTAL;

    const xAt = i => M.left + (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W);
    const yAt = v => M.top + ((v - yMin) / (yMax - yMin)) * H;

    /* --- Latar zona ---
       Batas zona hijau memakai ujung band "Sangat Ringan" dari Scales,
       bukan angka tetap, supaya tetap sejalan bila band disesuaikan.
       Zona merah sengaja digambar dari MAX_TOTAL ke dasar; tingginya nol
       pada skala sekarang, tetapi rumusnya tetap benar bila rentang
       berubah lagi. */
    ctx.fillStyle = COLORS.bandOk;
    const batasRingan = Scales.BANDS[1].max;
    ctx.fillRect(M.left, yAt(batasRingan), W, yAt(yMin) - yAt(batasRingan));
    ctx.fillStyle = COLORS.bandBad;
    ctx.fillRect(M.left, yAt(yMax), W, M.top + H - yAt(yMax));

    /* --- Grid + label Y --- */
    ctx.font = '11px "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepY = yMax - yMin;
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + (stepY / ticks) * i;
      const y = yAt(v);
      ctx.strokeStyle = (i % 2 === 0) ? COLORS.grid : 'transparent';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M.left, Math.round(y) + .5);
      ctx.lineTo(M.left + W, Math.round(y) + .5);
      ctx.stroke();
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(String(Math.round(v)), M.left - 8, y);
    }

    /* --- Label sumbu Y (sumbu dibalik: ke atas = skor turun = membaik) --- */
    ctx.save();
    ctx.translate(11, M.top + H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '10.5px "Segoe UI", sans-serif';
    ctx.fillStyle = COLORS.axis;
    ctx.fillText('Skor WINNER (ke atas = membaik)', 0, 0);
    ctx.restore();

    /* --- Label X --- */
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = Math.max(1, Math.floor(W / 58));
    const stride = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach((p, i) => {
      if (i % stride !== 0 && i !== data.length - 1) return;
      const x = Math.min(Math.max(xAt(i), M.left + 18), M.left + W - 18);
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(UI.fmtDateShort(p.date), x, M.top + H + 10);
    });

    /* --- Seri luas luka (sumbu kanan, opsional) --- */
    if (hasArea) {
      const areas = data.map(p => p.area).filter(v => typeof v === 'number' && v > 0);
      if (areas.length) {
        const aMax = Math.max(...areas) * 1.15 || 1;
        const ya = v => M.top + H - (v / aMax) * H;
        ctx.strokeStyle = COLORS.area;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        let started = false;
        data.forEach((p, i) => {
          if (typeof p.area !== 'number' || p.area <= 0) return;
          const x = xAt(i), y = ya(p.area);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        /* Sumbu kanan */
        const rx = M.left + W + 7;
        ctx.font = '10px "Cascadia Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.area;
        ctx.fillText(aMax.toFixed(1), rx, M.top + 4);
        ctx.fillText('0', rx, M.top + H);

        ctx.save();
        ctx.translate(rx + 36, M.top + H / 2);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillText('Luas luka (cm²)', 0, 0);
        ctx.restore();
      }
    }

    /* --- Seri skor WINNER --- */
    const scored = data.map((p, i) => ({ i, v: p.score }))
                        .filter(s => typeof s.v === 'number' && s.v >= yMin && s.v <= yMax);

    if (scored.length) {
      // area isi
      ctx.beginPath();
      scored.forEach((s, k) => {
        const x = xAt(s.i), y = yAt(s.v);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      const lastS = scored[scored.length - 1];
      ctx.lineTo(xAt(lastS.i), M.top + H);
      ctx.lineTo(xAt(scored[0].i), M.top + H);
      ctx.closePath();
      ctx.fillStyle = COLORS.scoreFill;
      ctx.fill();

      // garis
      ctx.beginPath();
      scored.forEach((s, k) => {
        const x = xAt(s.i), y = yAt(s.v);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = COLORS.score;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // titik + nilai
      scored.forEach(s => {
        const x = xAt(s.i), y = yAt(s.v);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = COLORS.score;
        ctx.stroke();

        ctx.font = 'bold 11px "Cascadia Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = COLORS.score;
        ctx.fillText(String(s.v), x, y - 8);
      });
    }

    /* --- Seri NRS (opsional) ---
       NRS punya rentang 0..10, sedangkan sumbu utama adalah rentang skor
       WINNER (Scales.MIN_TOTAL..Scales.MAX_TOTAL). Memakai yAt() langsung
       membuat yAt(2) jatuh DI ATAS area
       gambar, sehingga garisnya tidak pernah terlihat sama sekali —
       chip "Nyeri" terlihat hidup padahal tidak ada garis. Skala sendiri:
       0 di dasar, 10 di puncak area gambar. */
    if (opts.showNrs) {
      const yNrs = v => M.top + H - (Math.max(0, Math.min(10, v)) / 10) * H;
      ctx.beginPath();
      let started = false;
      data.forEach((p, i) => {
        if (typeof p.nrs !== 'number') return;
        const x = xAt(i), y = yNrs(p.nrs);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = COLORS.nrs;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* --- Hitung posisi titik untuk hover --- */
    const hits = scored.map(s => ({
      x: xAt(s.i), y: yAt(s.v), point: data[s.i]
    }));

    return { hits, xAt, yAt, margin: M };
  }

  /* ---------- Sparkline mini untuk daftar pasien ---------- */
  function sparkline(canvas, values, { width = 92, height = 28, color = COLORS.score } = {}) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const vals = (values || []).filter(v => typeof v === 'number');
    if (vals.length < 2) {
      ctx.strokeStyle = '#c8d5dd';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(2, height / 2);
      ctx.lineTo(width - 2, height / 2);
      ctx.stroke();
      return;
    }
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const span = (mx - mn) || 1;
    const pad = 3;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (width - pad * 2);
      const y = pad + ((v - mn) / span) * (height - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const lx = pad + (vals.length - 1) / (vals.length - 1) * (width - pad * 2);
    const ly = pad + ((vals[vals.length - 1] - mn) / span) * (height - pad * 2);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Konversi canvas -> data URL untuk dicetak. */
  function toDataURL(canvas) {
    try { return canvas.toDataURL('image/png'); }
    catch (e) { return null; }
  }

  return { drawTrend, sparkline, toDataURL, COLORS };
})();