/* ==========================================================
   TAB 5 — WINNER WOUND ASSESSMENT SCALE
   ----------------------------------------------------------
   Porting dari viewWinner() + refreshWinner() + renderWorst() +
   renderWinnerHistory() + autoFillWinner() + blok "Tab WINNER"
   di wire() pada assets/js/app.js (baris 2333-2650 & 3106-3119),
   ditambah openAuditHistory() (baris 1752-1804).

   Yang perlu dijaga:

   1. SETIAP kolom di sini berawalan `winner.` (scores.* dan note_*),
      jadi FieldProvider otomatis menjadikannya kolom KUNJUNGAN —
      audit + touchVisit + syncAudit + terkunci saat beku. Jangan
      dipaksa `visit={null}` (itu akan menjatuhkan kolomnya ke tabel
      patients dan menghilangkan jejaknya).

   2. refreshWinner() di app.js lama TIDAK menulis ke server: ia
      cuma menghitung `v.winner.total = Scales.total(scores).sum`
      di memori lalu menggambar ulang DOM-nya. Di React tidak ada
      DOM yang digambar ulang, tapi `v.winner.total` WAJIB benar,
      karena GrafikTab (tab 6), KartuRiwayat, dan KartuTimeline
      membacanya lewat Store.summarize(). Karena itu setiap
      perubahan skor di sini memanggil `Store.recalcWinner(visit)`
      lalu `Store.touchVisit(...)` — tanpa itu grafik jadi stale
      sampai halaman dimuat ulang.

   3. Tombol "Reset" dan "Isi Otomatis" di app.js lama menulis
      langsung ke model (setPath), sehingga jejaknya hilang. Di sini
      keduanya menulis lewat ctx.write() per kolom supaya audit tetap
      tercatat — sama seperti yang sudah dilakukan PengkajianTab pada
      tombol Normalisasi/Kosongkan.

   4. Tooltip jangkar penilaian memakai `data-tip` + UI.bindTips(),
      persis seperti di app.js lama. Bedanya: di app.js tooltip
      disisipkan sebagai atribut lalu di-escape (karena HTML-nya
      di-parse browser), sedangkan di React atribut diisi langsung
      sebagai string — jadi HTML-nya TIDAK perlu di-escape lagi.

   5. openAuditHistory() di app.js lama adalah fungsi privat modul.
      Di sini ia ditulis ulang di berkas ini (dipakai juga oleh tab
      lain nanti) memakai UI.modal() — sama seperti app.js: modal
      dibangun lewat string HTML karena UI.modal() memang API
      imperatif, bukan komponen React.
   ========================================================== */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FieldProvider, useFieldCtx } from '../core/field-binding.jsx';
import { Store, UI, Scales } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';

/* ---------- Warna band untuk angka total (padanan refreshWinner) ---------- */

const WARNA_BAND = {
  ok: 'var(--c-ok)',
  info: 'var(--c-info)',
  warn: 'var(--c-warn)',
  danger: 'var(--c-danger)'
};

/* ==========================================================
   Tooltip jangkar penilaian
   ========================================================== */

/** Isi tooltip `?` — padanan anchorTip(). */
function tipAnchors(item) {
  return (
    `<div class='tip__title'>${UI.esc(item.label)}</div>` +
    `<div style='font-family:var(--font-mono);font-size:11px'>` +
    Object.entries(item.anchors)
      .map(([n, txt]) => `<div class='tip__row'><b>${UI.esc(n)}</b><span>${UI.esc(txt)}</span></div>`)
      .join('') +
    `</div>`
  );
}

/** Isi tooltip tombol angka — padanan `data-tip` pada tiap radio. */
function tipSkor(item, n) {
  return (
    `<div class='tip__title'>Skor ${n} dari 5 &mdash; ${UI.esc(item.label)}</div>` +
    `<div class='tip__row' style='font-family:var(--font-mono);font-size:11px'>` +
    `<b>${n}</b><span>${UI.esc(item.anchors[n] || '')}</span></div>`
  );
}

/* ==========================================================
   Baris skor — 5 radio + kolom catatan
   ========================================================== */

/**
 * Satu baris tabel WINNER.
 *
 * Radio TIDAK memakai <ChipGroup> dari field-binding: bentuknya
 * harus persis `.winner-table` (kelas .scale-cell / .scale-head
 * sudah ada di app.css, dan #tab-body.is-frozen punya aturan
 * khusus untuk radio di dalam winner-table). Yang dipakai dari
 * FieldProvider hanya `ctx.write()` — jadi audit & lock tetap sama.
 */
function BarisSkor({ item, nomor, patient, visit, onNilaiUrut }) {
  const ctx = useFieldCtx();
  const pathSkor = `winner.scores.${item.key}`;
  const pathCatat = `winner.note_${item.key}`;

  const nilai = ctx.read(pathSkor);
  const catatan = ctx.read(pathCatat) || '';
  const terisi = Number(nilai) >= 1 && Number(nilai) <= 5;
  const beku = ctx.frozen;

  async function pilih(n) {
    const ok = await ctx.write(pathSkor, String(n), {
      label: item.label,
      before: nilai
    });
    if (!ok) return;
    /*
     * WAJIB. Tanpa dua baris ini `visit.winner.total` tetap nilai
     * lama, dan tab 6 (GrafikTab) ikut menampilkan angka basi.
     * Lihat catatan panjang di kepala berkas.
     */
    Store.recalcWinner(visit);
    Store.touchVisit(patient.id, visit.id);
    onNilaiUrut();
  }

  return (
    <tr data-item={item.key} className={terisi ? 'is-scored' : undefined}>
      <td style={{ width: 34, textAlign: 'center', color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {nomor}
      </td>

      <td className="scale-item">
        <div className="scale-label" data-tip={tipAnchors(item)}>
          <span>{item.label}</span>
          <span className="q" title="Lihat jangkar penilaian">?</span>
        </div>
      </td>

      {[1, 2, 3, 4, 5].map(n => (
        <td className="scale-cell" key={n}>
          <input
            type="radio"
            name={`winner_${item.key}`}
            value={n}
            id={`winner-${item.key}-${n}`}
            checked={Number(nilai) === n}
            disabled={beku}
            data-tip={tipSkor(item, n)}
            onChange={() => pilih(n)}
          />
        </td>
      ))}

      <td className="note-cell">
        <input
          type="text"
          id={`winner-note-${item.key}`}
          placeholder="temuan"
          disabled={beku}
          value={catatan}
          onChange={e => ctx.write(pathCatat, e.target.value, {
            label: `Catatan — ${item.label}`,
            before: catatan
          })}
        />
      </td>
    </tr>
  );
}

/* ==========================================================
   Kartu 5 — tabel + total
   ========================================================== */

/** Total, band, penanda posisi, dan progres pengisian. Padanan refreshWinner(). */
function PanelTotal({ hasil, beku, onReset, onIsiOtomatis, onRiwayat }) {
  const { total, band, filled } = hasil;

  const pct = total === null
    ? 0
    : ((total - Scales.MIN_TOTAL) / (Scales.MAX_TOTAL - Scales.MIN_TOTAL)) * 100;

  return (
    <div className="winner-total">
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-text-muted)' }}>
          Total Skor
        </div>
        <div
          className="winner-total__score"
          id="winner-score"
          style={{ color: band ? WARNA_BAND[band.tone] || '' : '' }}
        >
          {total === null ? '—' : total}
        </div>
      </div>

      <div className="winner-total__meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* refreshWinner(): UI.badge(b.label, b.tone) / UI.badge('Belum lengkap','muted') */}
          <span id="winner-band">
            {band
              ? <Badge tone={band.tone}>{band.short}</Badge>
              : <Badge tone="muted">Belum lengkap</Badge>}
          </span>
          <span id="winner-progress-text" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
            {filled === Scales.ITEMS.length
              ? `${Scales.ITEMS.length} dari ${Scales.ITEMS.length} parameter terisi`
              : `${filled} dari ${Scales.ITEMS.length} parameter terisi`}
          </span>
        </div>

        <div className="winner-total__scale">
          <div
            className="winner-total__marker"
            id="winner-marker"
            style={{
              left: `calc(${Math.max(0, Math.min(100, pct))}% )`,
              opacity: total === null ? '0' : '1'
            }}
          ></div>
        </div>
        <div className="winner-total__ticks">
          <span>13</span><span>26</span><span>39</span><span>52</span><span>65</span>
        </div>
        <div className="winner-progress">
          <div
            className="winner-progress__bar"
            id="winner-bar"
            style={{
              width: `${(filled / Scales.ITEMS.length) * 100}%`,
              background: filled === Scales.ITEMS.length ? 'var(--c-ok)' : 'var(--c-primary)'
            }}
          ></div>
        </div>
      </div>

      <div className="btn-group">
        <button
          className="btn btn--sm"
          id="btn-winner-fill"
          disabled={beku}
          title={beku ? 'Kunjungan dibekukan' : 'Isi parameter yang masih kosong dari data Pengkajian Luka'}
          onClick={onIsiOtomatis}
        >
          Isi Otomatis dari Pengkajian
        </button>

        <button
          className="btn btn--sm btn--ghost"
          id="btn-winner-reset"
          disabled={beku}
          title={beku ? 'Kunjungan dibekuan' : undefined}
          onClick={onReset}
        >
          Reset
        </button>

        <button
          className="btn btn--sm btn--ghost"
          id="btn-audit"
          onClick={onRiwayat}
          title="Lihat seluruh perubahan yang pernah dilakukan pada kunjungan ini"
        >
          🕓 Riwayat Perubahan
        </button>
      </div>
    </div>
  );
}

/* ==========================================================
   Kartu 5b — Parameter perlu perhatian
   ========================================================== */

/** Padanan renderWorst() — di app.js lama isinya di dalam #winner-worst. */
function KartuWorst({ visit }) {
  const scores = (visit.winner && visit.winner.scores) || {};
  const res = Scales.total(scores);

  if (!res || res.filled === 0) {
    return (
      <div className="card">
        <div className="card__head"><h2>Parameter Perlu Perhatian</h2></div>
        <div className="card__body" id="winner-worst">
          <div className="field__hint">Isi seluruh parameter untuk melihat analisis.</div>
        </div>
      </div>
    );
  }

  const worst = Scales.worstItems(scores, 5);

  if (!worst.length) {
    return (
      <div className="card">
        <div className="card__head"><h2>Parameter Perlu Perhatian</h2></div>
        <div className="card__body" id="winner-worst">
          <Callout>
            <strong>✓ Semua parameter bernilai 1</strong>
            Seluruh parameter berada pada skor terbaik. Luka dalam kondisi prima.
          </Callout>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card__head"><h2>Parameter Perlu Perhatian</h2></div>
      <div className="card__body" id="winner-worst">
        <Callout tone="warn">
          <strong>Parameter dengan skor tertinggi</strong>
          Fokuskan intervensi pada parameter berikut agar skor total turun lebih cepat.
        </Callout>
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Parameter</th><th className="num-cell">Skor</th><th>Arti</th></tr>
          </thead>
          <tbody>
            {worst.map(w => (
              <tr key={w.item.key}>
                <td><strong>{w.item.label}</strong></td>
                <td className="num-cell">
                  <Badge tone={w.score >= 4 ? 'danger' : w.score === 3 ? 'warn' : 'info'}>
                    {w.score}
                  </Badge>
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                  {w.item.anchors[w.score] || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ==========================================================
   Kartu 5c — Riwayat skor antar kunjungan
   ========================================================== */

/** Padanan renderWinnerHistory(). Tombol "Buka" melompat ke kunjungan itu. */
function KartuRiwayatSkor({ patient }) {
  const nav = useNavigate();
  const scored = (patient.visits || []).filter(v => v.winner && v.winner.total != null);

  return (
    <div className="card">
      <div className="card__head"><h2>Riwayat Skor</h2></div>
      <div className="card__body card__body--flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tanggal</th><th className="num-cell">Total</th><th>Band</th>
                <th className="num-cell">Δ dari sebelumnya</th><th></th>
              </tr>
            </thead>
            <tbody id="winner-history">
              {scored.length ? scored.map((v, i) => {
                const total = v.winner.total;
                const b = Scales.band(total);
                const prev = i > 0 ? scored[i - 1].winner.total : null;
                const d = prev === null ? null : Scales.delta(prev, total);
                return (
                  <tr key={v.id}>
                    <td style={{ fontSize: 12.5 }}>{UI.fmtDateTime(v.date, v.time)}</td>
                    <td className="num-cell"><strong style={{ fontSize: 15 }}>{total}</strong></td>
                    <td><Badge tone={b.tone}>{b.short}</Badge></td>
                    <td className="num-cell">
                      {d === null
                        ? <span style={{ color: 'var(--c-text-muted)' }}>—</span>
                        : <Badge tone={d >= 5 ? 'ok' : d <= -5 ? 'danger' : 'muted'}>{`${d > 0 ? '+' : ''}${d}%`}</Badge>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn--sm btn--ghost"
                          onClick={() => nav(`/p/${patient.id}?v=${v.id}`)}
                        >
                          Buka
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--c-text-muted)', padding: 24 }}>
                    Belum ada kunjungan berskor.
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
   Riwayat perubahan (openAuditHistory)
   ========================================================== */

/**
 * Padanan openAuditHistory() di app.js lama.
 *
 * Fungsi ini privat di modul klasik, jadi tidak bisa diimpor.
 * UI.modal() adalah API imperatif — persis seperti di app.js lama,
 * isinya tetap dirakit sebagai string HTML di dalam event handler.
 */
export function openAuditHistory(visit) {
  if (!visit) return;
  const list = (visit.audit || []).slice().reverse();

  let body;
  if (!list.length) {
    body = `<div class="callout">
      <strong>Belum ada perubahan tercatat</strong>
      Formulir ini belum pernah diubah sejak dibuat. Setiap perubahan pada kolom
      mana pun akan muncul di sini lengkap dengan nama petugas dan waktunya.
    </div>`;
  } else {
    const grup = {};
    list.forEach(r => { const d = (r.at || '').slice(0, 10); (grup[d] = grup[d] || []).push(r); });

    const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    body = Object.keys(grup).map(d => {
      const tgl = new Date(d + 'T00:00:00');
      const judul = isNaN(tgl) ? d
        : tgl.getDate() + ' ' + BULAN[tgl.getMonth()] + ' ' + tgl.getFullYear();

      return `
        <div style="margin-bottom:14px">
          <div class="audit-day">${UI.esc(judul)}</div>
          <div class="diff-list">
            ${grup[d].map(r => {
              const jam = (r.at || '').slice(11, 16);
              const kosong = !r.before;
              return `<div class="diff-row diff-row--${kosong ? 'add' : 'mod'}${r.risky ? ' is-risky' : ''}"
                    style="display:flex;gap:10px;padding:9px 11px;margin-bottom:7px;border:1px solid var(--c-border);border-radius:var(--r-md);background:var(--c-surface-2)">
                <div class="diff-row__icon" style="font-family:var(--font-mono);font-weight:700;color:var(--c-text-muted)">${kosong ? '+' : '~'}</div>
                <div style="flex:1;min-width:0">
                  <div class="diff-row__label" style="font-weight:600">${UI.esc(r.label)}${r.risky ? '<span class="audit-risk" title="Kolom berisiko">berisiko</span>' : ''}</div>
                  <div class="diff-row__vals" style="font-family:var(--font-mono);font-size:12.5px;margin-top:2px">${
                    kosong
                      ? `<ins style="text-decoration:none;color:var(--c-ok)">${UI.esc(r.after)}</ins>`
                      : `<del style="color:var(--c-danger)">${UI.esc(r.before)}</del><span class="arrow" style="margin:0 6px">→</span><ins style="text-decoration:none;color:var(--c-ok)">${UI.esc(r.after)}</ins>`
                  }</div>
                  <div class="audit-meta">${UI.esc(r.oleh)} · ${UI.esc(jam)}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  }

  UI.modal({
    title: 'Riwayat Perubahan — ' + UI.fmtDateTime(visit.date, visit.time),
    wide: true,
    body,
    footer: [UI.el('button', { class: 'btn btn--primary', text: 'Tutup' })]
  }).root.querySelector('.modal__foot .btn').addEventListener('click', function () {
    this.closest('.modal-backdrop').remove();
  });
}

/* ==========================================================
   Isi tab
   ========================================================== */

function IsiWinner({ patient, visit, rev, setRev }) {
  const ctx = useFieldCtx();
  const hostRef = useRef(null);

  /* Padanan refreshDerived() untuk awalan `winner`. */
  function nilaiUrut() { setRev(n => n + 1); }

  /*
   * Nilai turunan. Dihitung ulang setiap `rev` naik — persis seperti
   * refreshWinner() yang dipanggil ulang setiap ada kolom winner.*
   * yang berubah (lihat refreshDerived() di app.js lama).
   */
  const hasil = useMemo(() => {
    const scores = (visit && visit.winner && visit.winner.scores) || {};
    const res = Scales.total(scores);
    const total = res ? res.sum : null;
    return {
      res,
      total,
      band: total !== null ? Scales.band(total) : null,
      filled: res ? res.filled : 0
    };
  }, [visit, rev]);

  /*
   * Tooltip jangkar: UI.bindTips() memasang listener delegasi pada
   * satu akar. Efek ini cukup dijalankan sekali per elemen induk —
   * pemanggilan ganda (StrictMode) hanya memasang listener yang sama
   * dua kali dan tidak merusak apa pun.
   */
  useEffect(() => {
    if (hostRef.current) UI.bindTips(hostRef.current);
  }, []);

  /* --- btn-winner-reset --- */
  async function reset() {
    const ok = await UI.confirm('Kosongkan seluruh skor WINNER pada kunjungan ini?', { okText: 'Reset' });
    if (!ok) return;

    for (const it of Scales.ITEMS) {
      const wrote = await ctx.write(`winner.scores.${it.key}`, '', {
        label: it.label,
        before: ctx.read(`winner.scores.${it.key}`)
      });
      if (!wrote) return;      // dibekukan atau konfirmasi berisiko dibatalkan
    }

    Store.recalcWinner(visit);
    Store.touchVisit(patient.id, visit.id);
    nilaiUrut();
    UI.toast('Seluruh skor WINNER dikosongkan', 'muted', 2000);
  }

  /* --- btn-winner-fill: autoFillWinner() --- */
  async function isiOtomatis() {
    const w = visit.wound || {};
    const s = {};

    // 1. Ukuran (luas cm2)
    const area = Scales.areaCm2(w.ukuran);
    s.size = area === null ? null
      : area < 0.5 ? 1 : area < 1 ? 2 : area < 4 ? 3 : area < 16 ? 4 : 5;

    // 2. Kedalaman
    const dep = parseFloat(w.ukuran && w.ukuran.kedalaman);
    s.depth = !isFinite(dep) ? null : dep < 0.2 ? 1 : dep < 0.5 ? 2 : dep < 1 ? 3 : dep < 2 ? 4 : 5;

    // 3. Tepi
    const tepi = w.tepi || [];
    s.edges = tepi.includes('Menyatu') ? 1
      : tepi.includes('Menyatu') && tepi.includes('Thick / Hyperkeratosis') ? 3
      : tepi.includes('Callus') || tepi.includes('Thick / Hyperkeratosis') ? 3
      : tepi.includes('Evisi') ? 5
      : tepi.includes('Maserasi') ? 4
      : tepi.length ? 3 : null;

    // 4. Undermining
    const ud = w.undermining || {};
    const udDepth = parseFloat(ud.kedalaman);
    s.undermining = !ud.ada ? 1
      : !isFinite(udDepth) ? 3
      : udDepth < 0.2 ? 2 : udDepth < 0.6 ? 3 : udDepth <= 1 ? 4 : 5;

    // 5. Tipe jaringan nekrotik — dari lokasi + ada/tidaknya slough
    const pct = k => Number(w.jaringan && w.jaringan[k]) || 0;
    const nec = pct('nekrotik'), slo = pct('slough');
    s.necType = (nec === 0 && slo === 0) ? 1
      : w.iskemia && String(w.iskemia).startsWith('Ya') ? 5
      : slo > 20 ? 3
      : slo > 0 ? 2 : 1;

    // 6. Jumlah nekrotik (nekrotik + slough)
    const dead = nec + slo;
    s.necAmount = dead === 0 ? 1 : dead < 10 ? 2 : dead < 50 ? 3 : dead < 90 ? 4 : 5;

    // 7. Tipe eksudat
    const exTipe = w.eksudat && w.eksudat.tipe;
    s.exType = !exTipe || w.eksudat.jumlah === 'Tidak Ada' ? 1
      : exTipe === 'Serous' ? 2
      : exTipe === 'Serosanguinous' ? 3
      : exTipe === 'Sanguinous' ? 4
      : exTipe === 'Purulent' ? 5 : null;

    // 8. Jumlah eksudat
    const exJ = w.eksudat && w.eksudat.jumlah;
    s.exAmount = !exJ || exJ === 'Tidak Ada' ? 1 : exJ === 'Sedikit' ? 2 : exJ === 'Sedang' ? 3 : 4;

    // 9. Warna kulit sekitar
    const time = w.time || [];
    s.skinColor = time.includes('Rubor') ? 3 : time.includes('Functio Laesa') ? 5 : 2;

    // 10. Edema — tidak diukur langsung, default paling ringan yang tersedia
    s.edema = null;

    // 11. Indurasi
    s.induration = null;

    // 12. Granulasi
    const gran = pct('granulasi');
    s.granulation = gran >= 100 ? 1 : gran > 75 ? 2 : gran >= 50 ? 3 : gran > 0 ? 4 : 5;

    // 13. Epitelisasi
    const epi = pct('epitel');
    s.epithelial = epi >= 100 ? 1 : epi > 75 ? 2 : epi >= 50 ? 3 : epi > 0 ? 4 : 5;

    /* Simpan, jangan timpa yang sudah dinilai manual. */
    let filled = 0, kept = 0;
    for (const it of Scales.ITEMS) {
      const auto = s[it.key];
      const cur = visit.winner.scores[it.key];
      if (cur >= 1 && cur <= 5) { kept += 1; continue; }
      if (!(auto >= 1 && auto <= 5)) continue;
      const wrote = await ctx.write(`winner.scores.${it.key}`, String(auto), {
        label: it.label,
        before: cur
      });
      if (!wrote) break;
      filled += 1;
    }

    Store.recalcWinner(visit);
    Store.touchVisit(patient.id, visit.id);
    nilaiUrut();
    UI.toast(`Otomatis terisi ${filled} parameter, ${kept} dipertahankan`, 'ok', 3400);
  }

  if (!visit) {
    return (
      <EmptyState icon="📋" title="Belum ada kunjungan">
        Penilaian WINNER dicatat per kunjungan. Tambahkan kunjungan baru terlebih dahulu
        memakai tombol &quot;+ Kunjungan Baru&quot; di bagian atas.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card__head">
          <span className="num">5</span>
          <h2>WINNER Wound Assessment Scale</h2>
          <Badge tone="primary">13 parameter · skor 1–5</Badge>
        </div>
        <div className="card__body">
          <Callout>
            <strong>Cara mengisi</strong>
            Setiap parameter dinilai 1–5. <b>Skor tinggi = kondisi luka lebih buruk.</b>{' '}
            Arahkan kursor ke tanda <b>?</b> atau pilihan angka untuk melihat jangkar penilaian.{' '}
            Total minimum 13 (sembuh) dan maksimum 65 (sangat buruk).
          </Callout>
        </div>

        <div className="table-wrap" ref={hostRef}>
          <table className="data winner-table">
            <thead>
              <tr>
                <th></th>
                <th style={{ textAlign: 'left' }}>Parameter</th>
                {[1, 2, 3, 4, 5].map(n => <th className="scale-head" key={n}>{n}</th>)}
                <th style={{ textAlign: 'left' }}>Catatan / Temuan</th>
              </tr>
            </thead>
            <tbody>
              {Scales.ITEMS.map((it, i) => (
                <BarisSkor
                  key={it.key}
                  item={it}
                  nomor={i + 1}
                  patient={patient}
                  visit={visit}
                  onNilaiUrut={nilaiUrut}
                />
              ))}
            </tbody>
          </table>
        </div>

        <PanelTotal
          hasil={hasil}
          beku={ctx.frozen}
          onReset={reset}
          onIsiOtomatis={isiOtomatis}
          onRiwayat={() => openAuditHistory(visit)}
        />
      </div>

      <KartuWorst visit={visit} />
      <KartuRiwayatSkor patient={patient} />
    </>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function WinnerTab({ patient, visit }) {
  /* Padanan refreshDerived(): dinaikkan setiap kolom `winner.*` berubah. */
  const [rev, setRev] = useState(0);

  function onDerived(path) {
    if (String(path || '').startsWith('winner')) setRev(n => n + 1);
  }

  if (!patient) {
    return (
      <EmptyState icon="🔎" title="Pasien tidak ditemukan">
        Data pasien tidak dapat dimuat.
      </EmptyState>
    );
  }

  return (
    /* visit diteruskan apa adanya: seluruh kolom tab ini (winner.*)
     * adalah kolom kunjungan, sama seperti data-vbind di app.js lama. */
    <FieldProvider patient={patient} visit={visit} onDerived={onDerived}>
      <div id="form-winner">
        <IsiWinner patient={patient} visit={visit} rev={rev} setRev={setRev} />
      </div>
    </FieldProvider>
  );
}