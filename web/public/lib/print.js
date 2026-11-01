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

  /** Kop saja (tanpa judul) — dipakai sebagai <thead> agar berulang tiap halaman. */
  function kopSurat() {
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
      </div>`;
  }

  /** Judul dokumen — hanya tercetak sekali, di halaman pertama. */
  function header(subtitle) {
    return `<div class="pr-title">${esc(subtitle || 'Formulir Rekam Medis & Perawatan Luka Modern')}</div>`;
  }

  /**
   * Bungkus isi dokumen dalam tabel yang <thead>-nya berisi kop.
   * Mesin cetak mengulang thead di setiap halaman, jadi kop selalu muncul
   * di atas — termasuk pada halaman lanjutan satu kunjungan yang panjang.
   */
  function dokumen(isi) {
    return `<table class="pr-doc">
      <thead><tr><td>${kopSurat()}</td></tr></thead>
      <tbody><tr><td>${isi}</td></tr></tbody>
    </table>`;
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
  /* Urutan opsi mengikuti formulir RM. 03.1 PENGKAJIAN LUKA. */
  const OPT_TEPI     = [
    'Samar, tidak jelas terlihat',
    'Batas tepi terlihat, menyatu dengan dasar luka',
    'Jelas, tidak menyatu dengan dasar luka',
    'Jelas, tidak menyatu dengan dasar luka, tebal',
    'Jelas, fibrotik, parut tebal / hiperkeratotik'
  ];
  const OPT_EKSJ     = ['Kering', 'Moist', 'Sedikit', 'Sedang', 'Banyak'];
  const OPT_EKST     = ['Bloody', 'Serosanguineous', 'Serous', 'Purulent'];
  const OPT_BAU      = ['Tidak Berbau', 'Berbau Ringan', 'Sangat Berbau'];
  const OPT_TIME     = ['Kalor', 'Dolor', 'Rubor', 'Tumor', 'Functio Laesa'];
  const OPT_SISI     = ['Kanan', 'Kiri', 'Tengah / Bilateral'];
  const OPT_ISKEMIA  = ['Tidak ada', 'Ragu-ragu', 'Ya (kaki dingin, pucat, tidak berkeringat)'];

  /* ---------- Bagian 2: Informed Consent ---------- */

  /** Isi sel: data bila ada, sel kosong bila tidak (untuk ditulis tangan). */
  function isi(v) { return v === null || v === undefined ? '' : esc(String(v)); }

  /** Kota pada baris tanggal — kata terakhir alamat klinik. */
  function kotaKlinik() {
    const bagian = String((Store.clinic && Store.clinic.alamat) || '').trim().split(/\s+/);
    return bagian.length ? bagian[bagian.length - 1] : '';
  }

  /* Susunan mengikuti formulir RM. 01 "INFORMED CONSENT — Surat Pernyataan
     Persetujuan". Kop surat tetap memakai header() aplikasi, bukan kop
     formulir kertas, sesuai permintaan. */
  function sectionConsent(p) {
    const id = p.identity || {};
    const c = (p.consents && p.consents[0]) || null;
    const umur = UI.hitungUmur(id.tglLahir);
    const lahirUsia = id.tglLahir
      ? `${UI.fmtDate(id.tglLahir)}${umur !== null ? ` / ${umur} th` : ''}` : '';

    /* Bila penanda tangan bukan pasien sendiri, KTP/alamat/telepon pasien
       tidak boleh tercetak seolah-olah milik penanda tangan. */
    const samaPasien = !c || !c.nama
      || String(c.nama).trim().toLowerCase() === String(id.nama || '').trim().toLowerCase();
    const saya = (c && c.nama) || id.nama || '';

    const baris = (label, isiSel, style) =>
      `<tr><td class="pr-k">${esc(label)}</td><td colspan="3"${style ? ` style="${style}"` : ''}>${isiSel}</td></tr>`;

    const tanggal = c && c.date ? UI.fmtDate(c.date) : '';

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">2. Informed Consent (Persetujuan Tindakan)</div>

      <div style="text-align:center;margin:0 0 3mm">
        <div style="font-size:12pt;font-weight:700;letter-spacing:.1em">INFORMED CONSENT</div>
        <div style="font-size:9pt">Surat Pernyataan Persetujuan</div>
      </div>

      <p style="font-size:8.8pt;margin:0 0 1.5mm">Saya yang bertandatangan di bawah ini:</p>
      <table class="pr">
        ${baris('Nama Lengkap', isi(saya))}
        ${baris('No. KTP', isi(samaPasien ? id.nik : ''))}
        ${baris('Tgl Lahir / Usia', isi(samaPasien ? lahirUsia : ''))}
        ${baris('Alamat tinggal', isi(samaPasien ? id.alamat : ''), 'height:11mm')}
        ${baris('Telp./HP', isi(samaPasien ? id.telepon : ''))}
        ${baris('Hubungan dengan pasien', isi(c && c.hubungan ? c.hubungan : ''))}
      </table>

      <p style="font-size:8.8pt;margin:2.5mm 0 1.5mm">Bertindak sebagai pasien/wali keluarga pasien:</p>
      <table class="pr">
        <tr>
          <td class="pr-k">Nama Pasien</td><td>${isi(id.nama)}</td>
          <td class="pr-k" style="width:30mm">Tgl Lahir / Usia</td><td>${isi(lahirUsia)}</td>
        </tr>
        <tr>
          <td class="pr-k">No. Rekam Medis</td><td>${isi(p.mrNumber)}</td>
          <td class="pr-k">No. KTP</td><td>${isi(id.nik)}</td>
        </tr>
      </table>

      <p style="font-size:8.8pt;margin:3mm 0 1mm;text-align:justify">
        Menyatakan ${box(!!c && c.keputusan === 'SETUJU')} <b>SETUJU</b>
        &nbsp;&nbsp; ${box(!!c && c.keputusan === 'TIDAK SETUJU')} <b>TIDAK SETUJU</b>
        &nbsp; untuk dilakukan tindakan <b>PERAWATAN LUKA</b> atas pasien tersebut di atas.
      </p>
      <p style="font-size:8.8pt;margin:0 0 1mm;text-align:justify">
        Dengan telah diinformasikannya terlebih dahulu tentang kondisi pasien tersebut dan saya
        mengerti serta memahami konsekuensi dari tindakan tersebut, sesuai dengan penjelasan
        yang telah diberikan tenaga kesehatan yang melakukan perawatannya.
      </p>
      <p style="font-size:8.8pt;margin:0;text-align:justify">
        Demikianlah surat ini saya buat dengan penuh kesadaran dan tanpa tekanan dari pihak manapun.
      </p>

      <div style="text-align:right;font-size:8.8pt;margin:4mm 0 0">
        ${esc(kotaKlinik() || '……………………')}, ${tanggal
          ? esc(tanggal)
          : '<span style="display:inline-block;min-width:34mm;border-bottom:.5pt solid #000"></span>'}
      </div>

      <div class="pr-sig" style="margin-top:1mm">
        <div class="pr-sig__col">
          <div>Yang membuat pernyataan,</div>
          <div class="pr-sig__box">${c && c.tandaTanganPasien ? esc(c.tandaTanganPasien) : ''}</div>
          <div style="border-top:.5pt solid #000;padding-top:1mm">${isi(saya)}</div>
        </div>
        <div class="pr-sig__col">
          <div>Yang memberikan penjelasan,</div>
          <div class="pr-sig__box">${c && c.tandaTanganPerawat ? esc(c.tandaTanganPerawat) : ''}</div>
          <div style="border-top:.5pt solid #000;padding-top:1mm">${isi((Store.clinic && Store.clinic.namaPemilik) || '')}</div>
        </div>
      </div>

      ${p.consents.length ? `
      <table class="pr" style="margin-top:3mm">
        <tr>
          <th style="width:34mm">Tanggal &amp; Waktu</th><th>Nama / Hubungan</th>
          <th style="width:26mm">Keputusan</th><th>Catatan</th>
        </tr>
        ${p.consents.map(cs => `
        <tr>
          <td>${esc(UI.fmtDateTime(cs.date, cs.time))}</td>
          <td>${isi(cs.nama)}${cs.hubungan ? ` <span style="color:#555">(${esc(cs.hubungan)})</span>` : ''}</td>
          <td>${box(cs.keputusan === 'SETUJU')} ${esc(cs.keputusan || '—')}</td>
          <td>${isi(cs.catatan)}</td>
        </tr>`).join('')}
      </table>
      <p class="pr-legend">Baris di atas adalah berkas persetujuan yang tersimpan di sistem. Kolom tanda tangan sengaja dibiarkan kosong untuk ditandatangani basah.</p>`
      : '<p class="pr-legend">Belum ada berkas persetujuan tersimpan. Cetak formulir ini dan tandatangani secara basah.</p>'}
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
      /* Temuan disimpan di winner.note_<key> (bukan di winner.scores),
         jadi itulah yang dibaca lebih dulu. Kalau kosong, pakai teks
         parameter yang dipilih — itu yang tampil di formulir WINNER. */
      const note = (v.winner && v.winner['note_' + it.key]) || scores['note_' + it.key] ||
        (v.winner.notes && v.winner.notes[it.key]) ||
        (val >= 1 && val <= 5 ? (it.anchors[val] || '') : '');
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

  /* ---------- Bagian 6: Pemeriksaan Penunjang ---------- */

  /** Teks multi-baris -> HTML aman. */
  function teks(t) {
    if (t === null || t === undefined || t === '') return '—';
    return esc(String(t)).replace(/\n/g, '<br>');
  }

  /** Entri pemeriksaan yang belum dihapus, urut tanggal lalu id. */
  function entriPemeriksaan(obj) {
    return Object.entries(obj || {})
      .filter(([, e]) => e && e.dihapus !== true)
      .sort(([ia, a], [ib, b]) => String(a.tanggal || '').localeCompare(String(b.tanggal || '')) || ia.localeCompare(ib));
  }

  function sectionInvestigations(v) {
    const inv = v.pemeriksaan || {};
    const lab = entriPemeriksaan(inv.laboratorium);
    const rad = entriPemeriksaan(inv.radiologi);

    const kosong = '<tr><td colspan="5" style="text-align:center;color:#555">Belum ada isian.</td></tr>';

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">6. Hasil Pemeriksaan Penunjang</div>
      <div style="font-size:8.5pt;font-weight:700;margin:1mm 0">A. Laboratorium</div>
      <table class="pr">
        <tr>
          <th style="width:20mm">Tanggal</th><th style="width:30mm">Pemeriksaan</th>
          <th style="width:22mm">Spesimen</th><th>Hasil / Nilai</th><th style="width:38mm">Catatan</th>
        </tr>
        ${lab.length ? lab.map(([, e]) => `
        <tr>
          <td>${esc(e.tanggal ? UI.fmtDate(e.tanggal) : '—')}</td>
          <td>${teks(e.pemeriksaan)}</td>
          <td>${teks(e.spesimen)}</td>
          <td>${teks(e.hasil)}</td>
          <td>${teks(e.catatan)}</td>
        </tr>`).join('') : kosong}
      </table>
      <div style="font-size:8.5pt;font-weight:700;margin:2.5mm 0 1mm">B. Radiologi</div>
      <table class="pr">
        <tr>
          <th style="width:20mm">Tanggal</th><th style="width:24mm">Modalitas</th>
          <th style="width:24mm">Area</th><th>Temuan</th><th style="width:38mm">Kesimpulan</th>
        </tr>
        ${rad.length ? rad.map(([, e]) => `
        <tr>
          <td>${esc(e.tanggal ? UI.fmtDate(e.tanggal) : '—')}</td>
          <td>${teks(e.modalitas)}</td>
          <td>${teks(e.area)}</td>
          <td>${teks(e.temuan)}</td>
          <td>${teks(e.kesimpulan)}</td>
        </tr>`).join('') : kosong}
      </table>
    </div>`;
  }

  /* ---------- Bagian 7: CPPT ---------- */
  function sectionCppt(v) {
    const c = v.cppt || {};
    const vital = c.vital || {};
    const baris = (label, isi) => `<tr><td class="pr-k">${esc(label)}</td><td>${teks(isi)}</td></tr>`;

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">7. Catatan Perkembangan Pasien Terintegrasi (CPPT)</div>

      <table class="pr">
        <tr><th colspan="4">Pemeriksaan Tanda-Tanda Vital</th></tr>
        <tr>
          <td class="pr-k">Tekanan darah</td><td>${teks(vital.tekananDarah)}</td>
          <td class="pr-k">Nadi</td><td>${teks(vital.nadi)}</td>
        </tr>
        <tr>
          <td class="pr-k">Respirasi</td><td>${teks(vital.respirasi)}</td>
          <td class="pr-k">Suhu</td><td>${teks(vital.suhu)}</td>
        </tr>
      </table>

      <table class="pr" style="margin-top:2mm">
        ${baris('S — Subjective', c.subjective)}
        ${baris('O — Objective', c.objective)}
        ${baris('A — Diagnosis keperawatan', UI.joinList(c.diagnoses, ', ', ''))}
        ${c.diagnosisTambahan ? baris('Diagnosis tambahan', c.diagnosisTambahan) : ''}
        ${baris('P — Planning', c.planning)}
        ${baris('T — Tissue management', c.tissueManagement)}
        ${baris('I — Inflammation / infection control', c.infectionControl)}
        ${baris('M — Moisture balance', c.moistureBalance)}
        ${baris('E — Epithelial edge', c.epithelialEdge)}
      </table>
    </div>`;
  }

  /* ---------- Bagian 8: Grafik ---------- */
  function sectionGraph(p, chartDataUrl) {
    const s = Store.summarize(p);
    return `
    <div class="pr-sec">
      <div class="pr-sec__head">8. Grafik Tren &amp; Ringkasan Perkembangan</div>
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

  /* ---------- Bagian 9: Perkembangan status luka ---------- */

  /* Bilah 1..55 (RM. 03.2): 1 jaringan sehat, 15 regenerasi,
     30, 55 degenerasi — sama dengan tab Grafik Tren. */
  const STATUS_TITIK = [
    { v: 1, label: 'Jaringan sehat' },
    { v: 15, label: 'Regenerasi luka' },
    { v: 30, label: '' },
    { v: 55, label: 'Degenerasi luka' }
  ];
  const STATUS_MIN = 1;
  const STATUS_MAX = 55;
  const statusPct = v => ((Math.max(STATUS_MIN, Math.min(STATUS_MAX, v)) - STATUS_MIN) /
    (STATUS_MAX - STATUS_MIN)) * 100;

  /** Posisi absolut yang tidak terpotong di tepi kiri/kanan. */
  function posisi(pct) {
    if (pct < 8) return 'left:0;text-align:left';
    if (pct > 92) return 'left:100%;transform:translateX(-100%);text-align:right';
    return `left:${pct}%;transform:translateX(-50%);text-align:center`;
  }

  function sectionStatus(p) {
    const s = Store.summarize(p);
    const poin = s.scored || [];

    /* Tumpuk tanda yang berdekatan agar tanggalnya tetap terbaca. */
    let baris = 0;
    let sebelum = null;
    const tanda = poin.map(t => {
      const pct = statusPct(t.score);
      baris = (sebelum !== null && pct - sebelum < 8) ? (baris + 1) % 3 : 0;
      sebelum = pct;
      return { ...t, pct, baris };
    });

    return `
    <div class="pr-sec">
      <div class="pr-sec__head">9. Perkembangan Status Luka</div>
      ${poin.length ? '' : '<p style="font-size:8.8pt;margin:0">Belum ada kunjungan dengan skor WINNER, sehingga posisi luka pada bilah status belum dapat ditentukan.</p>'}
      <div style="position:relative;height:22mm">
        ${tanda.map(t => `
        <div style="position:absolute;bottom:${t.baris * 6}mm;${posisi(t.pct)};font-size:6.5pt;line-height:1.15;white-space:nowrap">
          <div>${esc(UI.fmtDate(t.date))}</div>
          <div style="font-weight:700;font-size:9pt">&#10005; ${t.score}</div>
        </div>`).join('')}
      </div>
      <div style="height:1.6mm;border:.5pt solid #555;background:#e8f4f2;-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>
      <div style="position:relative;height:9mm;font-size:6.5pt">
        ${STATUS_TITIK.map(t => `
        <div style="position:absolute;top:0.6mm;${posisi(statusPct(t.v))};line-height:1.15">
          <div style="font-weight:700">${t.v}</div>
          ${t.label ? `<div>${esc(t.label)}</div>` : ''}
        </div>`).join('')}
      </div>
      <table class="pr" style="margin-top:1mm">
        <tr><th style="width:26mm">Tanggal</th><th style="width:14mm">Skor</th>
            <th style="width:34mm">Band</th><th style="width:20mm">Posisi</th><th>Keterangan</th></tr>
        ${poin.length ? poin.map(t => {
          const b = Scales.band(t.score);
          return `<tr>
            <td>${esc(UI.fmtDate(t.date))}</td>
            <td style="text-align:center;font-weight:700">${t.score}</td>
            <td>${b ? esc(b.short) : '—'}</td>
            <td style="text-align:center">${statusPct(t.score).toFixed(0)}%</td>
            <td>${esc(t.score <= 15 ? 'Mendekati kondisi jaringan sehat' : t.score <= 30 ? 'Fase regenerasi / perbaikan' : 'Mengarah ke degenerasi luka')}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="5" style="text-align:center;color:#555">Belum ada data skor.</td></tr>'}
      </table>
      <p class="pr-legend">
        Bilah 1&ndash;55 mengikuti status kondisi luka: 1 = jaringan sehat, 15 = regenerasi luka,
        55 = degenerasi luka. Posisi dihitung dari skor total WINNER Scale
        (${Scales.MIN_TOTAL}&ndash;${Scales.MAX_TOTAL}) pada setiap kunjungan berskor.
      </p>
    </div>`;
  }

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

      host.innerHTML = dokumen(header('Daftar Pasien Aktif') + `
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
        <p class="pr-note">Dicetak ${esc(UI.fmtDate(new Date().toISOString().slice(0, 10)))} · ${list.length} pasien aktif · WoundCare EHR v${Store.version}</p>`);
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
      html += `<div class="pr-sec"><div class="pr-sec__head">3–9. Pengkajian</div>
        <p style="font-size:9pt">Belum ada kunjungan yang tercatat untuk pasien ini.</p></div>`;
    } else {
      visits.forEach((v, i) => {
        const isBreak = opts.range !== 'current' && i > 0;
        html += `<div class="${isBreak ? 'pr-break' : ''}">`;
        html += sectionWound(v);
        html += sectionPhotos(v);
        html += sectionWinner(v);
        html += sectionInvestigations(v);
        html += sectionCppt(v);
        if (opts.range === 'current') {
          html += sectionGraph(p, chartUrl);
          html += sectionStatus(p);
        }
        html += signatureBlock(p, v);
        html += `</div>`;
      });
      if (opts.range !== 'current') {
        html += `<div class="pr-break"></div>` + sectionGraph(p, chartUrl) + sectionStatus(p);
      }
    }

    html += `<p class="pr-note">
      Rekam medis ini dihasilkan oleh WoundCare EHR sebagai alat bantu dokumentasi.
      Seluruh hasil pengkajian memerlukan verifikasi klinis oleh tenaga kesehatan kompeten
      yang bertanggung jawab atas pasien.
    </p>`;

    host.innerHTML = dokumen(html);
  }

  /* ---------- Cetak ---------- */

  /* Cetak yang diminta lewat tombol (mis. "Cetak Kunjungan Ini").
   * window.print() memicu event `beforeprint`, dan handler di bawah
   * membangun ulang dokumen dengan SELURUH riwayat pasien. Tanpa penanda
   * ini, dokumen yang baru dibangun sesuai pilihan langsung tertimpa dan
   * kedua tombol menghasilkan halaman yang sama. */
  let permintaanCetak = null; // { at: number }
  const UMUR_PERMINTAAN = 60000;

  function print(opts) {
    build(opts);
    permintaanCetak = { at: Date.now() };
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
      /* Dokumen sudah dibangun oleh print() sesuai pilihan pengguna —
         jangan ditimpa dengan seluruh riwayat. */
      if (permintaanCetak && Date.now() - permintaanCetak.at < UMUR_PERMINTAAN) return;
      const app = window.App && window.App.state;
      if (!app) return;
      if (app.view === 'patient' && app.patientId) {
        build({ patientId: app.patientId, visitId: app.visitId, range: 'all' });
      } else {
        build({});
      }
    });

    /* Dialog ditutup (cetak atau batal): cetak berikutnya lewat Ctrl+P
       kembali memakai seluruh riwayat. */
    window.addEventListener('afterprint', () => { permintaanCetak = null; });
  }

  return { build, print, init, header, sectionIdentity, sectionWinner };
})();

document.addEventListener('DOMContentLoaded', PrintDoc.init);