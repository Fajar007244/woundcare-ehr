/* Jendela overlay yang dipakai lebih dari satu tempat.
 *
 * openAuditHistory  → riwayat perubahan (audit) satu kunjungan
 * openAccessLog     → riwayat akses; hanya admin
 *
 * Keduanya dipindahkan ke sini supaya patient-bar (tombol Riwayat) dan
 * WinnerTab (tombol Riwayat Perubahan) memakai implementasi yang sama,
 * bukan dua salinan yang bisa berbeda Molecular.
 *
 * Ketentuannya identik dengan versi app.js lama:
 *   • identitas petugas SELALU dari server, tidak pernah dari klien
 *   • riwayat akses hanya boleh dilihat admin — dicek di UI DAN di server
 */

import { Store, UI, API } from '../lib/index.js';

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Nilai panjang dipotong supaya isi kolom besar tidak meledakkan modal. */
function potong(v, n = 200) {
  const s = String(v === null || v === undefined ? '' : v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const LABEL_AKSI = {
  lihat:    { label: 'Melihat',     tone: 'info' },
  buat:     { label: 'Membuat',     tone: 'ok' },
  ubah:     { label: 'Mengubah',    tone: 'warn' },
  hapus:    { label: 'Menghapus',   tone: 'danger' },
  cetak:    { label: 'Mencetak',    tone: 'primary' },
  pulih:    { label: 'Memulihkan',  tone: 'warn' }
};

/* ---------------- Riwayat perubahan (audit) ---------------- */

/* Store.recentAudit(patientId, visitId, minutes) memfilter berdasarkan WAKTU
   dalam menit, bukan jumlah baris — jadi angka besar berarti "pakai semua".
   Store sendiri sudah membatasi 400 entri terbaru per kunjungan. */
const SEMUA_MENIT = 60 * 24 * 365 * 50;

export function openAuditHistory(patient, visit) {
  if (!patient || !visit) return;

  const box = document.createElement('div');
  box.innerHTML = '<div class="field__hint">Memuat…</div>';

  const m = UI.modal({
    title: 'Riwayat Perubahan',
    wide: true,
    body: box,
    footer: [UI.el('button', { class: 'btn btn--primary', text: 'Tutup', onclick: () => m.close() })]
  });

  /* Bentuk entri audit di Store: { id, at, oleh, key, label, before, after, risky }
     recentAudit() itu SINKRON — mengembalikan array, bukan Promise. */
  try {
    const rows = Store.recentAudit(patient.id, visit.id, SEMUA_MENIT) || [];

    if (!rows.length) {
      box.innerHTML = `<div class="callout">
        <strong>Belum ada perubahan tercatat</strong>
        Setiap kolom yang diisi atau diubah pada kunjungan ini tercatat di sini
        lengkap dengan nilai lama, nilai baru, petugas, dan waktunya.
      </div>`;
      return m;
    }

    // Dikelompokkan per hari supaya mudah dipindai.
    const perHari = {};
    rows.forEach(r => {
      const hari = String(r.at).slice(0, 10);
      (perHari[hari] = perHari[hari] || []).push(r);
    });

    box.innerHTML = Object.keys(perHari).sort().reverse().map(hari => `
      <div style="margin-bottom:14px">
        <div class="field__label" style="margin-bottom:6px">${esc(UI.fmtDate(hari))}</div>
        <div class="diff-list">
          ${perHari[hari].map(r => `
            <div class="diff-row${r.risky ? ' is-risky' : ''}">
              <div class="diff-row__icon">${r.risky ? '⚠' : '✎'}</div>
              <div class="diff-row__label">${esc(r.label || r.key)}</div>
              <div class="diff-row__vals">
                ${esc(potong(r.before) || '(kosong)')} &rarr; <b>${esc(potong(r.after) || '(kosong)')}</b>
                · ${esc(r.oleh || 'Tanpa nama')} · ${esc(String(r.at).slice(11, 16))}
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = `<div class="callout callout--danger"><strong>Gagal memuat</strong>${esc(e.message)}</div>`;
  }

  return m;
}

/* ---------------- Riwayat akses ---------------- */

export function openAccessLog(patient) {
  const u = Store.user;
  if (!u || u.peran !== 'Admin') {
    UI.toast('Riwayat akses hanya dapat dilihat admin.', 'warn');
    return;
  }

  const box = document.createElement('div');
  box.innerHTML = '<div class="field__hint">Memuat…</div>';

  const m = UI.modal({
    title: patient ? 'Riwayat Akses — ' + ((patient.identity && patient.identity.nama) || patient.mrNumber)
                    : 'Riwayat Akses Klinik',
    wide: true,
    body: box,
    footer: [UI.el('button', { class: 'btn btn--primary', text: 'Tutup', onclick: () => m.close() })]
  });

  API.listAccess({ patientId: patient ? patient.id : null, limit: 300 })
    .then(d => {
      const rows = (d && d.entries) || [];
      if (!rows.length) {
        box.innerHTML = `<div class="callout"><strong>Belum ada catatan akses</strong>
          Setiap kali rekam medis dibuka, dicetak, diubah, atau dihapus, kejadiannya tercatat di sini.</div>`;
        return;
      }
      box.innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th style="width:140px">Waktu</th><th style="width:96px">Aksi</th>
              <th>Petugas</th>${patient ? '' : '<th>Rekam Medis</th>'}<th>Keterangan</th>
            </tr></thead>
            <tbody>${rows.map(r => {
              const a = LABEL_AKSI[r.aksi] || { label: r.aksi, tone: 'muted' };
              return `<tr>
                <td style="font-size:12px;white-space:nowrap">${esc(UI.fmtDateTime(String(r.pada).slice(0, 10), String(r.pada).slice(11, 16)))}</td>
                <td><span class="badge badge--${a.tone}">${esc(a.label)}</span></td>
                <td style="font-weight:600">${esc(r.oleh_nama || '—')}
                  ${r.ip ? `<div style="font-size:10.5px;color:var(--c-text-muted);font-family:var(--font-mono)">${esc(r.ip)}</div>` : ''}</td>
                ${patient ? '' : `<td style="font-size:12.5px">${esc(r.patient_nama || '—')}
                  <div style="font-size:10.5px;color:var(--c-text-muted);font-family:var(--font-mono)">${esc(r.patient_rm || '')}</div></td>`}
                <td style="font-size:12px;color:var(--c-text-muted)">${esc(potong(r.detail, 120) || '—')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
    })
    .catch(e => {
      box.innerHTML = `<div class="callout callout--danger"><strong>Gagal memuat</strong>${esc(e.message)}</div>`;
    });

  return m;
}