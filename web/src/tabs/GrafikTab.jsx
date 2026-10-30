/* ==========================================================
   TAB 6 — GRAFIK TREN WINNER SCALE
   ----------------------------------------------------------
   Porting dari viewGrafik() + renderVisitRows() +
   renderTimeline() + refreshers.grafik() + attachChartHover()
   pada assets/js/app.js (baris 2656-2851).

   Yang perlu dijaga:

   1. Tab ini TIDAK punya kolom formulir — seluruh isinya hasil
      hitungan (Store.summarize + Scales). FieldProvider tetap
      dibungkus karena itu kontrak setiap tab, dan visit diteruskan
      apa adanya supaya tidak ada yang jatuh ke scope pasien.

   2. Charts.drawTrend() bekerja pada <canvas>. Di aplikasi lama
      `host.innerHTML = viewGrafik()` menyisipkan <canvas> lalu
      refreshers.grafik() menggambarnya. Di React tidak ada
      innerHTML, jadi gambar lewat REF CALLBACK: begitu node
      canvas terpasang di DOM, drawTrend() langsung dipanggil.

   3. Charts.drawTrend() membaca `canvas.clientWidth`, jadi saat
      ukuran jendela berubah lebarnya canvas ikut berubah dan
      grafik harus digambar ulang — sama seperti app.js lama
      menggambar ulang tiap kali tab dirender.

   4. Sumbu Y di modul Charts sengaja dibalik maknanya
      (ke atas = skor turun = membaik). Jangan "memperbaiki".
   ========================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';

import { FieldProvider } from '../core/field-binding.jsx';
import { Store, UI, Photos, Scales, Charts } from '../lib/index.js';
import { Badge, EmptyState } from '../components/ui.jsx';

const TINGGI = 320;   // opts.height di refreshers.grafik()

/* ---------- Status kondisi luka (RM. 03.2) ----------
   Bilah 1..55 dengan penanda 1 (jaringan sehat), 15 (regenerasi luka),
   30, dan 55 (degenerasi luka). Setiap kunjungan yang sudah berskor
ditandai X pada posisi skornya beserta tanggal kunjungan, sehingga
perjalanan luka terbaca pada satu garis. Skor total 10..50 selalu jatuh
di antara kedua ujung bilah. */
const STATUS_LUKA = [
  { v: 1, label: 'Jaringan Sehat' },
  { v: 15, label: 'Regenerasi luka' },
  { v: 30, label: '' },
  { v: 55, label: 'Degenerasi luka' }
];
const STATUS_MIN = STATUS_LUKA[0].v;
const STATUS_MAX = STATUS_LUKA[STATUS_LUKA.length - 1].v;
const statusPct = v => ((Math.max(STATUS_MIN, Math.min(STATUS_MAX, v)) - STATUS_MIN) /
  (STATUS_MAX - STATUS_MIN)) * 100;

const STATUS_BARIS = 3;      // kedalaman tumpukan bila tanda X berdekatan
const STATUS_JARAK_MIN = 8;  // % jarak minimum antar tanda agar tidak bertumpuk

/**
 * Bilah status kondisi luka + tanda X per kunjungan berskor.
 * Kunjungan yang tanggal/skornya berdekatan ditumpuk ke baris berikutnya
 * supaya tanggalnya tetap terbaca.
 */
function StatusKondisiLuka({ s }) {
  const poin = s.scored || [];

  let baris = 0;
  let sebelum = null;
  const tanda = poin.map((p, i) => {
    const pct = statusPct(p.score);
    baris = (sebelum !== null && pct - sebelum < STATUS_JARAK_MIN)
      ? (baris + 1) % STATUS_BARIS
      : 0;
    sebelum = pct;
    return { ...p, pct, baris, terakhir: i === poin.length - 1 };
  });

  return (
    <div className="status-luka">
      <div className="status-luka__title">Status Kondisi Luka</div>

      {tanda.length ? (
        <div className="status-luka__marks">
          {tanda.map(t => (
            <div
              key={t.id}
              className={`status-luka__mark${t.terakhir ? ' is-latest' : ''}`}
              style={{ left: `${t.pct}%`, bottom: t.baris * 30 }}
              title={`${UI.fmtDate(t.date)} — skor ${t.score}`}
            >
              <span className="status-luka__mark-date">{UI.fmtDate(t.date)}</span>
              <span className="status-luka__mark-x">✕</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="status-luka__rail" aria-hidden="true"></div>

      <div className="status-luka__ticks">
        {STATUS_LUKA.map(t => (
          <div key={t.v} className="status-luka__tick" style={{ left: `${statusPct(t.v)}%` }}>
            <span className="status-luka__n">{t.v}</span>
            {t.label ? <span className="status-luka__label">{t.label}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================
   Kartu 6 — Grafik tren
   ========================================================== */

/** Ringkasan tren: skor terakhir, tertinggi, perbaikan, luas. */
function KartuRingkasan({ s }) {
  /* stat 1 — Skor Terakhir */
  const toneBanding = s.lastBand ? s.lastBand.tone : '';

  /* stat 3 — Perbaikan Skor */
  const toneTren = s.trend.tone === 'ok' ? 'ok' : s.trend.tone === 'danger' ? 'danger' : '';

  /* stat 4 — Luas Luka */
  const dLuas = (s.firstArea && s.lastArea !== null)
    ? Scales.delta(s.firstArea, s.lastArea)
    : null;

  return (
    <div className="grid grid--4" style={{ marginBottom: 16 }}>
      <div className={`stat${toneBanding ? ` stat--${toneBanding}` : ''}`}>
        <div className="stat__label">Skor Terakhir</div>
        <div className="stat__value">{s.lastScore ?? '—'}</div>
        <div className="stat__foot">{s.lastBand ? s.lastBand.short : 'belum dinilai'}</div>
      </div>

      <div className="stat">
        <div className="stat__label">Skor Tertinggi</div>
        <div className="stat__value">{s.firstScore ?? '—'}</div>
        <div className="stat__foot">pada kunjungan berskor pertama</div>
      </div>

      <div className={`stat${toneTren ? ` stat--${toneTren}` : ''}`}>
        <div className="stat__label">Perbaikan Skor</div>
        <div className="stat__value" style={{ fontSize: 19 }}>
          {s.trend.delta !== null ? (s.trend.delta > 0 ? '+' : '') + s.trend.delta + '%' : '—'}
        </div>
        {/* Scales.trend() sudah mengembalikan { text, tone } */}
        <div className="stat__foot"><Badge tone={s.trend.tone}>{s.trend.text}</Badge></div>
      </div>

      <div className="stat">
        <div className="stat__label">Luas Luka</div>
        <div className="stat__value" style={{ fontSize: 19 }}>
          {s.lastArea !== null ? s.lastArea + ' cm²' : '—'}
        </div>
        <div className="stat__foot">
          {dLuas === null
            ? 'belum diukur'
            : `luas ${dLuas > 0 ? 'berkurang' : 'bertambah'} ${Math.abs(dLuas)}%`}
        </div>
      </div>
    </div>
  );
}

/**
 * Canvas + legenda + tooltip. Padanan refreshers.grafik() +
 * attachChartHover().
 */
function PanelGrafik({ patient, s }) {
  /*
   * opt-area default ON, opt-nrs default OFF — persis seperti
   * atribut `checked` / tanpa `checked` di viewGrafik() app.js lama.
   */
  const [opsi, setOpsi] = useState({ area: true, nrs: false });
  const [tip, setTip] = useState(null);          // { x, y, p, b } | null

  const canvasRef = useRef(null);
  const hitRef = useRef(null);                   // { hits } dari drawTrend
  const opsiRef = useRef(opsi);
  const scoredRef = useRef(s.scored);
  opsiRef.current = opsi;
  scoredRef.current = s.scored;

  /*
   * Store.summarize() membuat objek baru tiap kali dipanggil, jadi
   * s.scored selalu identitas baru. Kalau draw() bergantung pada
   * identitas array itu, setiap re-render (mis. karena tooltip hover
   * berganti) akan menggambar ulang dan menutup tooltip lagi.
   * Karena itu dependensinya SIdik data-nya, bukan referensinya.
   */
  const sidik = JSON.stringify(s.scored);

  /** Padanan draw() di refreshers.grafik(). */
  const gambar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const state = Charts.drawTrend(canvas, scoredRef.current, {
      height: TINGGI,
      showArea: opsiRef.current.area,
      showNrs: opsiRef.current.nrs
    });
    hitRef.current = state && state.hits ? state : null;
  }, [sidik]);

  /*
   * Ref callback — bukan string HTML. React memanggilnya dengan node
   * tepat setelah canvas masuk DOM, jadi clientWidth sudah tersedia
   * dan grafik bisa langsung digambar.
   *
   * Identitasnya sengaja dijaga stabil lewat gambarRef: kalau
   * setCanvas ikut berubah setiap render, React akan melepas dan
   * memasang ulang canvas terus-menerus.
   */
  const gambarRef = useRef(gambar);
  gambarRef.current = gambar;

  const setCanvas = useCallback(node => {
    canvasRef.current = node;
    if (node) gambarRef.current();
  }, []);

  /* Gambar ulang saat titik data atau pilihan seri berubah. */
  useEffect(() => {
    gambar();
    setTip(null);
  }, [gambar, opsi]);

  /* Grafik harus redraw saat ukuran jendela berubah. */
  useEffect(() => {
    const onResize = () => gambar();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [gambar]);

  /* --- Hover: attachChartHover() di app.js lama --- */
  function titikTerdekat(e) {
    const state = hitRef.current;
    if (!state) return null;

    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    let best = null;
    let bestD = 18;
    state.hits.forEach(h => {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bestD) { bestD = d; best = h; }
    });
    return best;
  }

  function onMove(e) {
    const best = titikTerdekat(e);
    if (!best) { setTip(t => (t ? null : t)); return; }

    const p = best.point;
    setTip(t => {
      // Titik yang sama → jangan picu re-render lagi.
      if (t && t.p.id === p.id && t.x === best.x && t.y === best.y) return t;
      return { x: best.x, y: best.y, p, b: p.score != null ? Scales.band(p.score) : null };
    });
  }

  /* Charts.toDataURL() — dipakai untuk menyimpan grafik sebagai PNG. */
  function unduh() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const url = Charts.toDataURL(canvas);
    if (!url) { UI.toast('Gagal mengekspor grafik', 'danger'); return; }

    const a = document.createElement('a');
    a.href = url;
    a.download = `tren-winner-${(patient.mrNumber || 'pasien').replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    UI.toast('Grafik tersimpan sebagai PNG', 'ok');
  }

  return (
    <>
      <div className="chart-wrap" id="chart-wrap">
        <canvas id="trend-chart" ref={setCanvas} onMouseMove={onMove} onMouseLeave={() => setTip(null)} />

        <div
          className={`chart-tip${tip ? ' is-on' : ''}`}
          id="chart-tip"
          style={tip ? { left: tip.x + 'px', top: tip.y + 'px' } : undefined}
        >
          {tip ? (
            <>
              {UI.fmtDate(tip.p.date)}
              {tip.p.area ? ` · ${tip.p.area} cm²` : ''}
              {tip.p.nrs != null ? ` · NRS ${tip.p.nrs}` : ''}
              <br />
              <b>Skor {tip.p.score}</b>
              {tip.b ? ` — ${tip.b.short}` : ''}
            </>
          ) : null}
        </div>
      </div>

      <div className="chart-legend">
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: Charts.COLORS.score }} />
          Skor WINNER Scale (naik ke atas = membaik)
        </span>
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: Charts.COLORS.area }} />
          Luas luka (cm²)
        </span>
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: Charts.COLORS.nrs }} />
          Nyeri NRS 0–10
        </span>

        <span className="chart-legend__item" style={{ marginLeft: 'auto' }}>
          <label className="chip" style={{ padding: '3px 9px', fontSize: 11.5 }}>
            <input
              type="checkbox"
              id="opt-area"
              checked={opsi.area}
              onChange={e => setOpsi(o => ({ ...o, area: e.target.checked }))}
            />
            <span className="chip__dot"></span>
            <span>Luas luka</span>
          </label>
          <label className="chip" style={{ padding: '3px 9px', fontSize: 11.5 }}>
            <input
              type="checkbox"
              id="opt-nrs"
              checked={opsi.nrs}
              onChange={e => setOpsi(o => ({ ...o, nrs: e.target.checked }))}
            />
            <span className="chip__dot"></span>
            <span>Nyeri</span>
          </label>

          {/* Tambahan kecil: ekspor PNG lewat Charts.toDataURL(). */}
          <button className="btn btn--sm btn--ghost" onClick={unduh} title="Simpan grafik sebagai gambar">⬇ PNG</button>
        </span>
      </div>
    </>
  );
}

function KartuGrafik({ patient, s }) {
  return (
    <div className="card">
      <div className="card__head"><span className="num">6</span><h2>Grafik Tren WINNER Scale</h2></div>
      <div className="card__body">
        <KartuRingkasan s={s} />
        <PanelGrafik patient={patient} s={s} />
      </div>
    </div>
  );
}

/* ==========================================================
   Kartu 6b — Status kondisi luka (bilah 1 .. 55)
   ========================================================== */

function KartuStatus({ s }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head"><h2>Perkembangan Status Luka</h2></div>
      <div className="card__body">
        <StatusKondisiLuka s={s} />
      </div>
    </div>
  );
}

/* ==========================================================
   Riwayat lengkap
   ========================================================== */

/** Padanan renderVisitRows() di app.js lama. */
function KartuRiwayat({ patient }) {
  const kebalik = (patient.visits || []).slice().reverse();

  return (
    <div className="card">
      <div className="card__head">
        <h2>Riwayat Lengkap</h2>
        <Badge tone="muted">{patient.visits.length} kunjungan</Badge>
      </div>
      <div className="card__body card__body--flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Foto</th>
                <th className="num-cell">Luas</th>
                <th className="num-cell">NRS</th>
                <th className="num-cell">Skor</th>
                <th>Band</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {kebalik.length ? kebalik.map(v => {
                const p = v.photos || {};
                const cap = UI.fmtDateTime(v.date, v.time);
                const area = Scales.areaCm2(v.wound && v.wound.ukuran);
                const total = v.winner && v.winner.total;
                const b = total != null ? Scales.band(total) : null;

                const thumb = k => {
                  // srcOf(): data URL lama maupun rujukan { id, ... } baru
                  const s = Photos.srcOf(p[k]);
                  return s
                    ? (
                      <img
                        className="photo-thumb"
                        style={{ display: 'inline-block', marginRight: 4 }}
                        src={s}
                        alt={`Foto ${k === 'before' ? 'sebelum' : 'sesudah'}`}
                        onClick={() => UI.lightbox(s, cap)}
                      />
                    )
                    : <div className="photo-none" style={{ display: 'inline-block', marginRight: 4 }}>—</div>;
                };

                return (
                  <tr key={v.id}>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{cap}</td>
                    <td>{thumb('before')}{thumb('after')}</td>
                    <td className="num-cell">{area !== null ? area : '—'}</td>
                    <td className="num-cell">{(v.wound && v.wound.nrs) ?? '—'}</td>
                    <td className="num-cell">{total != null ? <strong>{total}</strong> : '—'}</td>
                    <td>{b ? <Badge tone={b.tone}>{b.short}</Badge> : '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--c-text-muted)', maxWidth: 260 }}>
                      {v.notes || (v.wound && v.wound.catatan) || '-'}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--c-text-muted)', padding: 24 }}>
                    Belum ada kunjungan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   Timeline
   ========================================================== */

/** Padanan renderTimeline() di app.js lama. */
function KartuTimeline({ patient }) {
  const kebalik = (patient.visits || []).slice().reverse();

  return (
    <div className="card">
      <div className="card__head"><h2>Timeline Kunjungan</h2></div>
      <div className="card__body">
        <div className="timeline">
          {kebalik.length ? kebalik.map(v => {
            const total = v.winner && v.winner.total;
            const b = total != null ? Scales.band(total) : null;
            const area = Scales.areaCm2(v.wound && v.wound.ukuran);

            const facts = [];
            if (area !== null) facts.push(`luas ${area} cm²`);
            if (v.wound && v.wound.nrs != null && v.wound.nrs !== '') facts.push(`nyeri ${v.wound.nrs}/10`);
            if (v.wound && (v.wound.time || []).length) facts.push(`${v.wound.time.length} tanda infeksi`);
            if (v.dressing && v.dressing.nama) facts.push(`dressing ${v.dressing.nama}`);

            return (
              <div className="tl-item" key={v.id}>
                <div className="tl-item__date">
                  {UI.fmtDateTime(v.date, v.time)}
                  {v.perawat ? ` · ${v.perawat}` : ''}
                </div>
                <div className="tl-item__title">
                  <span>{total != null ? `Skor ${total}` : 'Belum dinilai WINNER'}</span>
                  {b ? <Badge tone={b.tone}>{b.short}</Badge> : null}
                </div>
                <div className="tl-item__body">{facts.join(' · ') || '—'}</div>
                {v.notes
                  ? <div className="tl-item__body" style={{ color: 'var(--c-text)', marginTop: 4 }}>{v.notes}</div>
                  : null}
              </div>
            );
          }) : (
            <div className="field__hint">Belum ada kunjungan.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function GrafikTab({ patient, visit }) {
  /*
   * Padanan `const s = Store.summarize(p)` di viewGrafik().
   * Sengaja dihitung SETIAP render: Store.summarize() membaca objek
   * kunjungan yang hidup, dan re-render dipicu Store.notify() lewat
   * DataProvider — bukan lewat perubahan identitas `patient`.
   */
  const s = patient ? Store.summarize(patient) : null;

  if (!patient) {
    return (
      <EmptyState icon="🔎" title="Pasien tidak ditemukan">
        Data pasien tidak dapat dimuat.
      </EmptyState>
    );
  }

  return (
    /*
     * Tab ini bukan tab kunjungan di aplikasi lama (VISIT_TABS hanya
     * berisi pengkajian, foto, winner), jadi grafik tetap tampil
     * walau belum ada kunjungan — visit diteruskan apa adanya,
     * bukan dipaksa null.
     */
    <FieldProvider patient={patient} visit={visit}>
      <div id="form-grafik">
        <KartuGrafik patient={patient} s={s} />
        <KartuStatus s={s} />
        <KartuRiwayat patient={patient} />
        <KartuTimeline patient={patient} />
      </div>
    </FieldProvider>
  );
}