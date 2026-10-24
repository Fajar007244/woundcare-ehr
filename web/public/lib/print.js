/* ============================================================
   print.js — Penyusun dokumen cetak (A4)
   ============================================================
   Semua isi di sini mengikuti aturan @page/ @media print
   pada assets/css/print.css.
   ============================================================ */

const PrintDoc = (() => {

  const { esc } = UI;

  /* Logo instantsi — dipakai pada kop dokumen cetak.
     Mengambil data URI dari logo.js supaya tidak bergantung
     pada proses unduh berkas gambar saat dialog cetak dibuka. */
  const LOGO_PATH = (window.APP_LOGO && window.APP_LOGO.print)
    || (window.APP_LOGO && window.APP_LOGO.path)
    || 'assets/images/logo.png';

  /* ---------- Kop surat ---------- */
  function header(subtitle) {
    const c = Store.clinic;
    const now = new Date();
    return `
      <div class="pr-head">
        <div class="pr-head__logo"><img src="${LOGO_PATH}" alt=""></div>
        <div class="pr-head__txt">
          <div class="pr-head__org">${esc(c.nama || 'Klinik Perawatan Luka Modern')}</div>
          <div class="pr-head__sub">${esc(c.alamat || '')}</div>
          <div class="pr-head__sub">${c.telepon ? 'Telp. ' + esc(c.telepon) : ''}</div>
        </div>
        <div class="pr-head__meta">
          Dicetak: ${esc(UI.fmtDate(now.toISOString().slice(0, 10)))}<br>
          ${esc(String(now.getHours()).padStart(2, '0'))}:${esc(String(now.getMinutes()).padStart(2, '0'))}<br>
          WoundCare EHR v${Store.version}
        </div>
      </div>
      <div class="pr-title">${esc(subtitle || 'Formulir Rekam Medis & Perawatan Luka Modern')}</div>`;
  }

  /* ---------- Kotak isian ---------- */
  function kv(label, value) {
    return `<tr><td class="pr-k">${esc(label)}</td><td>${esc(value && value !== '' ? value : '—')}</td></tr>`;
  }

  /** Kotak centang cetak. */
  function box(checked) {
    return `<span class="pr-box${checked ? ' is-on' : ''}">${checked ? '&#10003;' : ''}</span>`;
  }

  /** Daftar chip dengan centang. */
  function chips(options, selected) {
    const sel = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    return `<div class="pr-chips">${options.map(o =>
      `<span class="pr-chip${sel.includes(o) ? ' is-on' : ''}">${box(sel.includes(o))}${esc(o)}</span>`
    ).join('')}</div>`;
  }

  /* ---------- Bagian 1: Data Pasien ---------- */
  function sectionIdentity(p) {
    const id = p.identity;
    const umur = UI.hitungUmur(id.tglLahir);
    const al = id.alergi || {};
    const kom = id.komorbid || [];

    const allergyFlags = [
      al.tidakAda ? 'Tidak ada riwayat alergi' : null,
      al.obat ? `Obat: ${al.obat}` : null,
      al.dressing ? `Dressing/Lateks: ${al.dressing}` : null,
      al.lain ? `Lainnya: ${al.lain}` : null
    ].filter(Boolean);

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">1. Data Pasien</div>
      <table class="pr">
        <tr>
          <td class="pr-k">No. Rekam Medis</td><td style="font-weight:700">${esc(p.mrNumber)}</td>
          <td class="pr-k">Tanggal Masuk</td><td>${esc(UI.fmtDate(id.tanggalMasuk))}</td>
        </tr>
        <tr>
          <td class="pr-k">Nama Lengkap</td><td colspan="3" style="font-weight:700">${esc(id.nama || '—')}</td>
        </tr>
        <tr>
          <td class="pr-k">NIK</td><td>${esc(id.nik || '—')}</td>
          <td class="pr-k">Tanggal Lahir / Umur</td><td>${esc(UI.fmtDate(id.tglLahir))} (${umur !== null ? `${umur} Th` : '—'})</td>
        </tr>
        <tr>
          <td class="pr-k">Jenis Kelamin</td>
          <td>${box(id.jenisKelamin === 'L')} L &nbsp;&nbsp; ${box(id.jenisKelamin === 'P')} P</td>
          <td class="pr-k">Pekerjaan</td><td>${esc(id.pekerjaan || '—')}</td>
        </tr>
        <tr>
          <td class="pr-k">Alamat</td><td colspan="3">${esc(id.alamat || '—')}</td>
        </tr>
        <tr>
          <td class="pr-k">No. HP / WhatsApp</td><td>${esc(id.telepon || '—')}</td>
          <td class="pr-k">Dokter Penanggung Jawab</td><td>${esc(id.dpj || '—')}</td>
        </tr>
        <tr>
          <td class="pr-k">Kontak Darurat</td>
          <td>${esc(id.kontakNama || '—')} (${esc(id.kontakHubungan || '—')})</td>
          <td class="pr-k">No. HP Kontak</td><td>${esc(id.kontakTelepon || '—')}</td>
        </tr>
        <tr>
          <td class="pr-k">Riwayat Alergi</td>
          <td colspan="3">${allergyFlags.length
            ? allergyFlags.map(f => `<div style="font-weight:700">${box(true)} ${esc(f)}</div>`).join('')
            : `${box(false)} Tidak ada data</td>`}</tr>
        <tr>
          <td class="pr-k">Komorbid</td>
          <td colspan="3">${kom.length || id.komorbidLain
            ? chips(OPT_KOMORBID, kom) + (id.komorbidLain ? `<div style="margin-top:1mm">Lainnya: ${esc(id.komorbidLain)}</div>` : '')
            : `${box(false)} Tidak ada`}</td>
        </tr>
      </table>
    </div>`;
  }

  // Salinan lokal opsi agar modul PrintDoc mandiri
  const OPT_KOMORBID = ['Diabetes Mellitus', 'Hipertensi', 'Gagal Ginjal', 'Gagal Jantung', 'Asma / COPD', 'Hepatitis', 'Kanker', 'Lainnya'];
  const OPT_ETIOLOGI = ['Diabetes Mellitus (Diabetic Foot Ulcer)', 'Dekubitus', 'Luka Bakar', 'Venous Ulcer', 'Arterial Ulcer', 'Trauma / Post-Op', 'Lainnya'];
  const OPT_TEPI     = ['Menyatu', 'Evisi', 'Maserasi', 'Thick / Hyperkeratosis', 'Callus', 'Macerasi + Evisi'];
  const OPT_EKSJ     = ['Tidak Ada', 'Sedikit', 'Sedang', 'Banyak'];
  const OPT_EKST     = ['Serous', 'Sanguinous', 'Serosanguinous', 'Purulent'];
  const OPT_BAU      = ['Tidak Berbau', 'Berbau Ringan', 'Sangat Berbau'];
  const OPT_TIME     = ['Kalor', 'Dolor', 'Rubor', 'Tumor', 'Functio Laesa'];
  const OPT_SISI     = ['Kanan', 'Kiri', 'Tengah / Bilateral'];
  const OPT_ISKEMIA  = ['Tidak ada', 'Ragu-ragu', 'Ya (kaki dingin, pucat, tidak berkeringat)'];

  /* ---------- Bagian 2: Informed Consent ---------- */
  function sectionConsent(p) {
    return `
    <div class="pr-sec">
      <div class="pr-sec__head">2. Informed Consent (Persetujuan Tindakan)</div>
      <p style="font-size:8.8pt;margin:0 0 2mm">
        Saya yang bertanda tangan di bawah ini:
      </p>
      <p style="font-size:8.8pt;margin:0 0 2mm">
        Nama Pasien / Penanggung Jawab:
        <span class="pr-line">${esc(p.consents[0] ? p.consents[0].nama : (p.identity.nama || ''))}</span>
        &nbsp;&nbsp; Hubungan:
        <span class="pr-line" style="min-width:26mm">${esc(p.consents[0] ? p.consents[0].hubungan : '')}</span>
      </p>
      <p style="font-size:8.8pt;margin:0 0 2mm">
        Menyatakan <b>SETUJU / TIDAK SETUJU</b> untuk dilakukan tindakan perawatan luka modern,
        dokumentasi foto luka, serta prosedur medis pendukung lainnya, setelah menerima penjelasan
        mengenai tujuan, risiko, dan estimasi biaya perawatan luka.
      </p>
      <table class="pr">
        <tr>
          <th style="width:26mm">Tanggal &amp; Waktu</th>
          <th style="width:36mm">Tanda Tangan Pasien / Wali</th>
          <th style="width:36mm">Tanda Tangan Perawat / Suster</th>
          <th>Catatan</th>
        </tr>
        ${(p.consents.length ? p.consents : [null]).map(c => `
        <tr>
          <td>${c ? esc(UI.fmtDateTime(c.date, c.time)) : '__ / ____ / 20____ , ____ : ____'} ${c ? box(c.keputusan === 'SETUJU') + (c.keputusan === 'SETUJU' ? ' SETUJU' : ' TIDAK SETUJU') : box(true) + ' SETUJU'}</td>
          <td class="pr-fill">${c && c.tandaTanganPasien ? esc(c.tandaTanganPasien) : ''}</td>
          <td class="pr-fill">${c && c.tandaTanganPerawat ? esc(c.tandaTanganPerawat) : ''}</td>
          <td>${c ? esc(c.catatan || '') : ''}</td>
        </tr>`).join('')}
      </table>
      ${p.consents.length ? '' : `<p class="pr-legend">Bagian ini belum ditandatangani pada sistem digital. Cetak dan tanda tangani secara basah.</p>`}
    </div>`;
  }

  /* ---------- Bagian 3: Pengkajian Luka ---------- */
  function sectionWound(v) {
    const w = v.wound;
    const u = w.ukuran;
    const ud = w.undermining || {};
    const area = Scales.areaCm2(u);
    const j = w.jaringan || {};
    const sum = Scales.tissueSum(j);

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">3. Pengkajian Luka</div>
      <table class="pr">
        <tr><td style="height:4mm">${box(true)}</td><td class="pr-k">Tanggal / Jam</td>
            <td colspan="3">${esc(UI.fmtDateTime(v.date, v.time))}</td></tr>
        <tr>
          <td class="pr-k">Etiologi Luka</td>
          <td colspan="3">${chips(OPT_ETIOLOGI, w.etiologi)}${w.etiologiLain ? `<div style="margin-top:1mm">Lainnya: ${esc(w.etiologiLain)}</div>` : ''}</td>
        </tr>
        <tr>
          <td class="pr-k">Lokasi Luka</td>
          <td>${esc(w.lokasi || '—')}</td>
          <td class="pr-k" style="width:26mm">Sisi</td>
          <td>${chips(OPT_SISI, w.lokasiSisi)}</td>
        </tr>
        <tr>
          <td class="pr-k">Ukuran Luka</td>
          <td colspan="3">
            Panjang <b>${esc(u.panjang || '—')} cm</b> &nbsp;|&nbsp;
            Lebar <b>${esc(u.lebar || '—')} cm</b> &nbsp;|&nbsp;
            Kedalaman <b>${esc(u.kedalaman || '—')} cm</b> &nbsp;|&nbsp;
            Luas <b>${area !== null ? area + ' cm²' : '—'}</b>
          </td>
        </tr>
        <tr>
          <td class="pr-k">Gua / Tunnelling</td>
          <td colspan="3">
            ${box(!!ud.ada)} Ada &nbsp;&nbsp; ${box(!ud.ada)} Tidak ada
            ${ud.ada ? `&nbsp;&nbsp;|&nbsp;&nbsp; Arah: <b>${esc(ud.arahJam || '—')} jam</b>
             &nbsp;|&nbsp; Kedalaman: <b>${esc(ud.kedalaman || '—')} cm</b>
             &nbsp;|&nbsp; Lokasi: ${esc(ud.lokasi || '—')}` : ''}
          </td>
        </tr>
        <tr>
          <td class="pr-k">Tepi Luka</td>
          <td colspan="3">${chips(OPT_TEPI, w.tepi)}</td>
        </tr>
        <tr>
          <td class="pr-k">Tipe Jaringan</td>
          <td colspan="3">
            <table class="pr" style="margin-top:1mm">
              <tr>
                <th>Nekrotik</th><th>Slough</th><th>Granulasi</th><th>Epitelisasi</th><th style="width:22mm">Total</th>
              </tr>
              <tr style="text-align:center">
                <td style="text-align:center"><b>${esc(j.nekrotik || 0)}%</b></td>
                <td style="text-align:center"><b>${esc(j.slough || 0)}%</b></td>
                <td style="text-align:center"><b>${esc(j.granulasi || 0)}%</b></td>
                <td style="text-align:center"><b>${esc(j.epitel || 0)}%</b></td>
                <td style="text-align:center;font-weight:700">${sum !== null ? sum + '%' : '—'}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="pr-k">Eksudat</td>
          <td colspan="3">
            <b>Jumlah:</b> ${chips(OPT_EKSJ, w.eksudat && w.eksudat.jumlah)}<br>
            <b>Tipe:</b> ${chips(OPT_EKST, w.eksudat && w.eksudat.tipe)}
          </td>
        </tr>
        <tr>
          <td class="pr-k">Bau Luka</td>
          <td>${chips(OPT_BAU, w.bau)}</td>
          <td class="pr-k">Iskemia/Perfusi</td>
          <td>${chips(OPT_ISKEMIA, w.iskemia)}</td>
        </tr>
        <tr>
          <td class="pr-k">Tanda Infeksi</td>
          <td colspan="3">${chips(OPT_TIME, w.time)}${
            (w.time || []).length >= 2
              ? `<div style="margin-top:1mm;font-weight:700;color:#000">⚠ ${w.time.length} tanda infeksi — perlu pemantauan intensif</div>`
              : ''}</td>
        </tr>
        <tr>
          <td class="pr-k">Skala Nyeri (NRS)</td>
          <td colspan="3"><b>${esc(w.nrs ?? 0)} / 10</b>${
            Number(w.nrs) > 0 ? ` &nbsp;(${Number(w.nrs) <= 3 ? 'ringan' : Number(w.nrs) <= 6 ? 'sedang' : 'berat'})` : ''
          }</td>
        </tr>
        <tr>
          <td class="pr-k">Perawat</td><td>${esc(v.perawat || '—')}</td>
          <td class="pr-k">Dressing</td><td>${esc(v.dressing && v.dressing.nama ? v.dressing.nama : '—')}</td>
        </tr>
        ${w.catatan ? `<tr><td class="pr-k">Catatan Klinis</td><td colspan="3">${esc(w.catatan)}</td></tr>` : ''}
        ${v.notes ? `<tr><td class="pr-k">Catatan Kunjungan</td><td colspan="3">${esc(v.notes)}</td></tr>` : ''}
      </table>
    </div>`;
  }

  /* ---------- Bagian 4: Foto ---------- */

  /**
   * Src untuk foto di dokumen cetak.
   *
   * Foto datang dari URL (/api/photos?id=...), dan Chrome merender preview
   * cetak sebelum gambar itu selesai dimuat — hasilnya kotak kosong di
   * kertas. Untuk itu client menyimpan data URL tiap foto di
   * window.FOTO_CACHE (diisi di App.jsx & FotoTab.jsx), dan di sini data URL
   * itu dipakai bila tersedia, karena data URL dirender sinkron oleh browser.
   *
   * Data URL lama (format sebelum migrasi) dan rujukan yang cache-nya belum
   * terisi (mis. halaman baru dibuka, langsung Ctrl+P) tetap jatuh ke URL —
   * tetap dipanaskan lebih awal sebagai cadangan.
   */
  function srcCetakFoto(p) {
    const dataUrl = typeof p === 'string' ? p : null;
    const cache = window.FOTO_CACHE;
    if (dataUrl) return dataUrl;
    if (p && typeof p === 'object' && p.id) {
      if (cache && cache[p.id]) return cache[p.id];
      const url = '/api/photos?id=' + encodeURIComponent(p.id);
      const im = new Image();      // cadangan: mulai unduh lebih awal
      im.src = url;
      return url;
    }
    return null;
  }

  function sectionPhotos(v, compact) {
    const h = compact ? 32 : 42;

    const slot = (key, label, hint) => {
      const src = srcCetakFoto(v.photos[key]);
      return `
      <div class="pr-photo">
        <div class="pr-photo__frame" style="height:${h}mm">
          ${src
            ? `<img src="${esc(src)}" alt="${key}">`
            : `<div style="color:#999;font-size:8pt">Ruang foto<br>(${esc(hint)})</div>`}
        </div>
        <div class="pr-photo__cap">${esc(label)}</div>
        ${src ? '<div class="pr-photo__hint">terlampir</div>' : ''}
      </div>`;
    };

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">4. Foto Luka</div>
      <div class="pr-photos">
        ${slot('before', 'Foto Sebelum Perawatan', 'sebelum debridement')}
        ${slot('after', 'Foto Setelah Perawatan', 'sesudah dressing')}
      </div>
      <table class="pr" style="margin-top:2mm">
        <tr><td class="pr-k" style="width:26mm">Catatan Foto</td><td>${esc(v.photos.catatan || '—')}</td></tr>
        <tr><td class="pr-k">Mistaring</td><td>
          ${box(!!v.photos.ruler)} Mistar luka terlihat &nbsp;&nbsp;
          ${box(!!v.photos.rulerNote)} Label anatomi / orientasi
        </td></tr>
      </table>
    </div>`;
  }

  /* ---------- Bagian 5: WINNER Scale ---------- */
  function sectionWinner(v) {
    const scores = v.winner.scores || {};
    const res = Scales.total(scores);
    const total = res ? res.sum : null;
    const b = total !== null ? Scales.band(total) : null;

    /* Estimasi edukatif, bukan prognosis. Rumus dan label "perkiraan"
       ikut dicetak supaya angka tidak dibaca sebagai kepastian medis. */
    const estimasi = Scales.healingWeeks(total);
    const rentangBand = Scales.BANDS
      .map(x => (x.min === x.max ? String(x.min) : `${x.min}–${x.max}`))
      .join(' · ');

    const rows = Scales.ITEMS.map((it, i) => {
      const val = Number(scores[it.key]);
      const note = scores['note_' + it.key] || (v.winner.notes && v.winner.notes[it.key]) || '';
      return `<tr>
        <td style="width:6mm;text-align:center">${i + 1}</td>
        <td style="width:52mm">${esc(it.label)}</td>
        ${[1, 2, 3, 4, 5].map(n =>
          `<td style="width:8mm;text-align:center;${val === n ? 'font-weight:700;background:#e8f4f2' : ''}">${val === n ? '&#9679;' : ''}</td>`
        ).join('')}
        <td>${esc(note)}</td>
      </tr>`;
    }).join('');

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">5. WINNER Wound Assessment Scale</div>
      <table class="pr">
        <tr>
          <th colspan="2" style="text-align:left">Parameter</th>
          ${[1, 2, 3, 4, 5].map(n => `<th style="width:8mm;text-align:center">${n}</th>`).join('')}
          <th>Catatan / Temuan</th>
        </tr>
        ${rows}
        <tr>
          <td colspan="7" style="background:#e8f4f2;font-weight:700;text-align:right">
            TOTAL SKOR WINNER SCALE:
          </td>
        </tr>
        <tr>
          <td colspan="7" style="text-align:center;padding:3mm">
            <span style="font-size:20pt;font-weight:700;font-family:'Cascadia Mono',Consolas,monospace">${total !== null ? total : '—'}</span>
            &nbsp;&nbsp;/ ${Scales.MAX_TOTAL}&nbsp;&nbsp;
            ${b ? `<b>${esc(b.label)}</b>` : '<i>Belum dinilai lengkap</i>'}
          </td>
        </tr>
        <tr>
          <td colspan="7" style="text-align:center;padding:2mm">
            Perkiraan penyembuhan:
            <b>${estimasi !== null ? esc(String(estimasi)) + ' minggu' : '—'}</b>
            <span style="font-size:8pt;color:#666">
              &nbsp;(total &times; ${Scales.HEALING_NUMERATOR} &divide; ${Scales.HEALING_DIVISOR} &mdash; estimasi edukatif, bukan prognosis)
            </span>
          </td>
        </tr>
      </table>
      <p class="pr-legend">
        Skor ${Scales.MIN_TOTAL} = epitelisasi lengkap (sembuh) · Skor ${Scales.MAX_TOTAL} = kondisi sangat buruk ·
        ${rentangBand}.
        Jangkar kriteria untuk setiap skor tersedia pada aplikasi digital WoundCare EHR.
      </p>
    </div>`;
  }

  /* ---------- Bagian 6: Grafik ---------- */
  function sectionGraph(p, chartDataUrl) {
    const s = Store.summarize(p);
    return `
    <div class="pr-sec">
      <div class="pr-sec__head">6. Grafik Tren &amp; Ringkasan Perkembangan</div>
      <div class="pr-chart">
        ${chartDataUrl
          ? `<img src="${chartDataUrl}" alt="Grafik tren WINNER Scale">`
          : '<div style="padding:8mm;color:#666">Grafik belum dapat digenerate pada dokumen ini.</div>'}
      </div>
      <table class="pr" style="margin-top:2mm">
        <tr>
          <th>Tanggal</th><th>Foto</th><th style="width:16mm">Luas (cm²)</th>
          <th style="width:14mm">NRS</th><th style="width:14mm">Skor</th>
          <th style="width:30mm">Band</th><th>Catatan</th>
        </tr>
        ${p.visits.length ? p.visits.slice().reverse().map(v => {
          const area = Scales.areaCm2(v.wound.ukuran);
          const t = v.winner && v.winner.total;
          const bb = t != null ? Scales.band(t) : null;
          const ph = ['before', 'after'].map(k => v.photos[k]
            ? `<img src="${esc(srcCetakFoto(v.photos[k]) || '')}" style="width:16mm;height:12mm;object-fit:contain;border:1px solid #ccc;margin-right:1mm">`
            : `<span style="display:inline-block;width:16mm;height:12mm;border:1px dashed #999;text-align:center;color:#999;font-size:7pt;line-height:12mm;margin-right:1mm">—</span>`
          ).join('');
          return `<tr>
            <td style="white-space:nowrap">${esc(UI.fmtDate(v.date))}</td>
            <td>${ph}</td>
            <td style="text-align:center">${area !== null ? area : '—'}</td>
            <td style="text-align:center">${esc(w0(v.wound.nrs))}</td>
            <td style="text-align:center;font-weight:700">${t != null ? t : '—'}</td>
            <td>${bb ? esc(bb.short) : '—'}</td>
            <td>${esc(v.notes || v.wound.catatan || '')}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="7" style="text-align:center;color:#666">Belum ada kunjungan.</td></tr>'}
      </table>
      <table class="pr" style="margin-top:2mm">
        <tr>
          <td class="pr-k" style="width:32mm">Skor Tertinggi</td>
          <td style="width:22mm;font-weight:700">${s.firstScore ?? '—'}</td>
          <td class="pr-k" style="width:32mm">Skor Terakhir</td>
          <td style="width:22mm;font-weight:700">${s.lastScore ?? '—'}</td>
        </tr>
        <tr>
          <td class="pr-k">Perbaikan Skor</td>
          <td style="font-weight:700">${s.trend.delta !== null ? (s.trend.delta > 0 ? '+' : '') + s.trend.delta + '%' : '—'}</td>
          <td class="pr-k">Status</td>
          <td style="font-weight:700">${esc(s.trend.text)}</td>
        </tr>
        <tr>
          <td class="pr-k">Jumlah Kunjungan</td><td>${p.visits.length}</td>
          <td class="pr-k">Luas Luka Terakhir</td>
          <td>${s.lastArea !== null ? s.lastArea + ' cm²' : '—'}</td>
        </tr>
      </table>
    </div>`;
  }

  function w0(v) { return (v === null || v === undefined || v === '') ? '—' : v; }

  /* ---------- Tanda tangan akhir ---------- */
  function signatureBlock(p, v) {
    return `
    <div class="pr-sec pr-avoid" style="margin-top:5mm">
      <div class="pr-sig">
        <div class="pr-sig__col">
          <div>Pasien / Penanggung Jawab</div>
          <div class="pr-sig__box"></div>
          <div style="border-top:.5pt solid #000;padding-top:1mm">${esc(p.identity.nama || '')}</div>
        </div>
        <div class="pr-sig__col">
          <div>Perawat / Suster</div>
          <div class="pr-sig__box"></div>
          <div style="border-top:.5pt solid #000;padding-top:1mm">${esc((v && v.perawat) || '')}</div>
        </div>
        <div class="pr-sig__col">
          <div>Dokter Penanggung Jawab</div>
          <div class="pr-sig__box"></div>
          <div style="border-top:.5pt solid #000;padding-top:1mm">${esc(p.identity.dpj || '')}</div>
        </div>
      </div>
    </div>`;
  }

  /* ==========================================================
     Penyusun dokumen
     ========================================================== */

  /**
   * Bangun dokumen cetak.
   * @param {Object} opts
   *   - patientId : jika diisi, cetak rekam medis pasien tsb
   *   - visitId   : batasi hanya satu kunjungan
   *   - includeAll: cetak seluruh riwayat kunjungan
   *   - range     : 'all' | 'current'
   */
  function build(opts = {}) {
    const host = document.getElementById('print-root');
    if (!host) return;

    const c = Store.clinic;

    /* --- Kasus 1: daftar seluruh pasien --- */
    if (!opts.patientId) {
      const list = Store.activePatients();
      if (!list.length) { host.innerHTML = '<p>Tidak ada data pasien untuk dicetak.</p>'; return; }

      host.innerHTML = header('Daftar Pasien Aktif') + `
        <div class="pr-sec">
          <table class="pr">
            <tr><th>No</th><th style="width:26mm">No. RM</th><th>Nama</th><th style="width:16mm">JK</th>
                <th style="width:18mm">Umur</th><th style="width:18mm">Kunjungan</th>
                <th style="width:20mm">Skor</th><th>Komorbid</th></tr>
            ${list.map((p, i) => {
              const s = Store.summarize(p);
              const u = UI.hitungUmur(p.identity.tglLahir);
              return `<tr>
                <td style="text-align:center">${i + 1}</td>
                <td>${esc(p.mrNumber)}</td>
                <td>${esc(p.identity.nama || '—')}</td>
                <td style="text-align:center">${esc(p.identity.jenisKelamin || '—')}</td>
                <td style="text-align:center">${u !== null ? u : '—'}</td>
                <td style="text-align:center">${s.total}</td>
                <td style="text-align:center;font-weight:700">${s.lastScore ?? '—'}</td>
                <td>${esc(UI.joinList(p.identity.komorbid, ', ', '—'))}</td>
              </tr>`;
            }).join('')}
          </table>
        </div>
        <p class="pr-note">Dicetak ${esc(UI.fmtDate(new Date().toISOString().slice(0, 10)))} · ${list.length} pasien aktif · WoundCare EHR v${Store.version}</p>`;
      return;
    }

    /* --- Kasus 2: rekam medis seorang pasien --- */
    const p = Store.getPatient(opts.patientId);
    if (!p) { host.innerHTML = '<p>Data pasien tidak ditemukan.</p>'; return; }

    // Tentukan kunjungan mana yang dicetak
    let visits = p.visits.slice();
    if (opts.range === 'current' && opts.visitId) {
      const one = visits.find(v => v.id === opts.visitId);
      visits = one ? [one] : [];
    }
    if (!visits.length) visits = [];

    // Grafik tren (render offscreen)
    let chartUrl = null;
    try {
      const s = Store.summarize(p);
      if (s.scored.length) {
        const cv = document.createElement('canvas');
        cv.style.width = '100%';
        document.body.appendChild(cv);
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:absolute;left:-99999px;top:0;width:760px';
        document.body.appendChild(tmp);
        tmp.appendChild(cv);
        Charts.drawTrend(cv, s.scored, { height: 230, showArea: true, showNrs: false });
        chartUrl = Charts.toDataURL(cv);
        tmp.remove();
      }
    } catch (e) { console.error('[print] grafik gagal:', e); }

    let html = header(`Rekam Medis & Perawatan Luka Modern${opts.range === 'current' && visits[0]
      ? ` — ${UI.fmtDateTime(visits[0].date, visits[0].time)}` : ''}`);

    html += sectionIdentity(p);
    html += sectionConsent(p);

    if (!visits.length) {
      html += `<div class="pr-sec"><div class="pr-sec__head">3–6. Pengkajian</div>
        <p style="font-size:9pt">Belum ada kunjungan yang tercatat untuk pasien ini.</p></div>`;
    } else {
      visits.forEach((v, i) => {
        const isBreak = opts.range !== 'current' && i > 0;
        html += `<div class="${isBreak ? 'pr-break' : ''}">`;
        html += sectionWound(v);
        html += sectionPhotos(v);
        html += sectionWinner(v);
        if (opts.range === 'current') html += sectionGraph(p, chartUrl);
        html += signatureBlock(p, v);
        html += `</div>`;
      });
      if (opts.range !== 'current') {
        html += `<div class="pr-break"></div>` + sectionGraph(p, chartUrl);
      }
    }

    html += `<p class="pr-note">
      Rekam medis ini dihasilkan oleh WoundCare EHR sebagai alat bantu dokumentasi.
      Seluruh hasil pengkajian memerlukan verifikasi klinis oleh tenaga kesehatan kompeten
      yang bertanggung jawab atas pasien.
    </p>`;

    host.innerHTML = html;
  }

  /* ---------- Cetak ---------- */
  function print(opts) {
    build(opts);
    // Beri jeda agar gambar & font selesai dirender
    setTimeout(() => window.print(), 60);
  }

  /* Bangun otomatis saat pengguna menekan Ctrl+P */
  function init() {
    // Pastikan logo sudah termuat sebelum dokumen dicetak
    const preload = new Image();
    preload.src = LOGO_PATH;
    if (preload.decode) preload.decode().catch(() => {});

    window.addEventListener('beforeprint', () => {
      const app = window.App && window.App.state;
      if (!app) return;
      if (app.view === 'patient' && app.patientId) {
        build({ patientId: app.patientId, visitId: app.visitId, range: 'all' });
      } else {
        build({});
      }
    });
  }

  return { build, print, init, header, sectionIdentity, sectionWinner };
})();

document.addEventListener('DOMContentLoaded', PrintDoc.init);