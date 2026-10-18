/* ==========================================================
   PENGATURAN & DATA  (halaman /pengaturan)
   ----------------------------------------------------------
   Porting dari renderPengaturan() + renderAccessSummary() +
   renderAccessTable() + renderUsers() + wireUserActions() +
   openUserForm() + promptPassword() + exportCSV() + blok
   `wire()` "Tab pengaturan" pada assets/js/app.js
   (baris 717-1061, 2857-2994, 3121-3192, 3199-3233).

   Yang perlu dijaga:

   1. Hanya admin. Di app.js lama penjaganya `if (!isAdmin())
      return navigate('#/')` — sekali klik langsung lempar balik.
      Di React melempar balik dari render frowned upon, jadi
      halamannya tetap dirender tapi Isinya berupa pesan penolak
      yang rapi (lolos ke /pengaturan dengan cara ketik URL pun
      tidak akan crash).

   2. Helper paginasi `pager()` / `nomorHalaman()` ada di modul
      app.js yang lama dan TIDAK ikut ke public/lib/, jadi
      logikanya disalin apa adanya ke sini (lihat blok Paginasi
      di bawah). Aturannya: halaman pertama & terakhir selalu ada,
      begitu pula posisi sekarang ±1; kalau sedang di ujung, ujung
      yang lain ikut dibuka supaya tidak ada lompatan besar.

   3. Rekap "per petugas" dihitung dari SELURUH hasil
      Store.listAccess(), bukan dari potongan halaman yang sedang
      tampil. Kalau dihitung per halaman, jumlahnya akan ikut
      naik-turun tiap kali paginator diklik.

   4. Tombol Hapus hanya muncul untuk akun yang sudah NONAKTIF
      (dan bukan akun sendiri). Aturan "admin aktif terakhir"
      ditegakkan server (HTTP 400) — pesan dari server ditampilkan
      apa adanya lewat UI.toast, tidak ditafsirkan ulang di sini.

   5. Identitas Klinik disimpan lewat `API.saveConfig()` dulu
      (supaya kegagalan server langsung terlihat ke admin) lalu
      `Store.clinic = ...` untuk memperbarui memori + kicker
      antrean sinkronisasi.
   ========================================================== */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useData } from '../core/data.jsx';
import { Store, UI, API, Photos, Scales } from '../lib/index.js';
import { Badge, Callout } from '../components/ui.jsx';

/* ==========================================================
   Paginasi — salinan persis app.js lama (baris 80-135)
   ========================================================== */

const PER_HALAMAN = 10;

function nomorHalaman(total, cur) {
  const hal = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const nums = [];
  const push = n => { if (n >= 1 && n <= hal && nums.indexOf(n) < 0) nums.push(n); };
  push(1);
  for (let i = cur - 1; i <= cur + 1; i++) push(i);
  push(hal);
  if (cur <= 3) { push(2); push(3); push(4); }
  if (cur >= hal - 2) { push(hal - 1); push(hal - 2); push(hal - 3); }
  return nums.sort((a, b) => a - b);
}

/**
 * Bilah paginasi. `onGo` dipanggil dengan nomor halaman baru.
 * Versi React dari pager() — mengembalikan null kalau hanya ada
 * satu halaman (padanan `if (hal <= 1) return ''`).
 */
function Pager({ total, cur, onGo }) {
  const hal = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const aktif = Math.min(Math.max(1, cur), hal);
  if (hal <= 1) return null;

  const nums = nomorHalaman(total, aktif);
  const dari = (aktif - 1) * PER_HALAMAN + 1;
  const sampai = Math.min(aktif * PER_HALAMAN, total);

  /* Ratakan dulu: nomor halaman diselingi penanda lomatan. */
  const butir = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) butir.push({ gap: true, key: `gap-${n}` });
    butir.push({ gap: false, n, key: `hal-${n}` });
  });

  return (
    <div className="pager-bar">
      <div className="pager-bar__info">
        Menampilkan <b>{dari}–{sampai}</b> dari <b>{total.toLocaleString('id-ID')}</b> kejadian
        &middot; halaman <b>{aktif}</b> dari <b>{hal}</b>
      </div>
      <div className="pager">
        <button
          className="pager__btn"
          disabled={aktif <= 1}
          title="Halaman sebelumnya"
          aria-label="Halaman sebelumnya"
          onClick={() => onGo(aktif - 1)}
        >‹</button>

        {butir.map(b => b.gap
          ? <span className="pager__gap" key={b.key}>…</span>
          : (
            <button
              key={b.key}
              className={`pager__btn${b.n === aktif ? ' is-active' : ''}`}
              aria-current={b.n === aktif ? 'page' : undefined}
              onClick={() => onGo(b.n)}
            >{b.n}</button>
          ))}

        <button
          className="pager__btn"
          disabled={aktif >= hal}
          title="Halaman berikutnya"
          aria-label="Halaman berikutnya"
          onClick={() => onGo(aktif + 1)}
        >›</button>
      </div>
    </div>
  );
}

/* ==========================================================
   Helper tampilan
   ========================================================== */

/** Cerminan AKSI_LABEL di app.js lama. */
const AKSI_LABEL = {
  lihat:    { label: 'Melihat',     tone: 'info' },
  buat:     { label: 'Membuat',     tone: 'ok' },
  ubah:     { label: 'Mengubah',    tone: 'warn' },
  hapus:    { label: 'Menghapus',   tone: 'danger' },
  cetak:    { label: 'Mencetak',    tone: 'primary' },
  pulih:    { label: 'Memulihkan',  tone: 'warn' }
};

/** Padanan fmtWaktu() di app.js lama. */
function fmtWaktu(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const t = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return UI.fmtDate(d.toISOString().slice(0, 10)) + ', ' + t;
}

/* Cerminan PERAN_VALID di db.js. Harus sama: server adalah sumber
   kebenaran dan akan menolak nilai di luar daftar ini. */
const DAFTAR_PERAN = ['Admin', 'Dokter', 'Perawat', 'Perawat Senior', 'Terapis', 'Administrasi'];

/* ==========================================================
   i — Identitas Klinik
   ========================================================== */

/**
 * Satu kolom teks.
 *
 * Sengaja berada di LUAR fungsi KartuIdentitasKlinik: kalau didefinisikan
 * di dalam, React akan melihat tipe baru tiap render, melepas & memasang
 * ulang seluruh <input> — dan fokus kursor hilang di tengah admin mengetik.
 */
function KolomKlinik({ id, label, value, onChange, disabled }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input type="text" id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function KartuIdentitasKlinik({ clinic, onSimpan, sibuk }) {
  const [nama, setNama] = useState(clinic.nama || '');
  const [pemilik, setPemilik] = useState(clinic.namaPemilik || '');
  const [alamat, setAlamat] = useState(clinic.alamat || '');
  const [telepon, setTelepon] = useState(clinic.telepon || '');

  /* Nilai server berubah (mis. setelah pemulihkan cadangan) → kolom ikut berubah. */
  useEffect(() => {
    setNama(clinic.nama || '');
    setPemilik(clinic.namaPemilik || '');
    setAlamat(clinic.alamat || '');
    setTelepon(clinic.telepon || '');
  }, [clinic.nama, clinic.namaPemilik, clinic.alamat, clinic.telepon]);

  return (
    <div className="card">
      <div className="card__head"><span className="num">i</span><h2>Identitas Klinik</h2></div>
      <div className="card__body">
        <p className="field__hint" style={{ marginBottom: 12 }}>Data ini dicetak pada kop setiap formulir.</p>

        <div className="form-row form-row--2">
          <KolomKlinik id="cl-nama" label="Nama Klinik / Instansi" value={nama} disabled={sibuk} onChange={setNama} />
          <KolomKlinik id="cl-pemilik" label="Nama Penanggung Jawab" value={pemilik} disabled={sibuk} onChange={setPemilik} />
        </div>
        <div className="form-row form-row--2">
          <KolomKlinik id="cl-alamat" label="Alamat" value={alamat} disabled={sibuk} onChange={setAlamat} />
          <KolomKlinik id="cl-telp" label="Telepon" value={telepon} disabled={sibuk} onChange={setTelepon} />
        </div>

        <div className="btn-group">
          <button
            className="btn btn--primary"
            id="btn-save-clinic"
            disabled={sibuk}
            onClick={() => onSimpan({ nama, namaPemilik: pemilik, alamat, telepon })}
          >
            Simpan Identitas
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   ii — Riwayat Akses
   ========================================================== */

function KartuRiwayatAkses() {
  const [semua, setSemua] = useState(null);     // null = belum pernah dimuat
  const [galat, setGalat] = useState(null);
  const [hal, setHal] = useState(1);
  const [memuat, setMemuat] = useState(false);

  /* renderAccessSummary(): Store.listAccess({ limit: 500 }) */
  async function muat() {
    setMemuat(true);
    setGalat(null);
    try {
      const d = await Store.listAccess({ limit: 500 });
      setSemua(d.entries || []);
      setHal(1);
    } catch (e) {
      setGalat(e && e.message ? e.message : String(e));
      setSemua(null);
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => { muat(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* --- renderAccessTable() --- */
  const total = semua ? semua.length : 0;
  const halaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const cur = Math.min(Math.max(1, hal), halaman);
  const potong = semua ? semua.slice((cur - 1) * PER_HALAMAN, (cur - 1) * PER_HALAMAN + PER_HALAMAN) : [];

  /* Rekap dihitung dari SELURUH data, bukan hanya halaman yang tampil. */
  const rekap = {};
  (semua || []).forEach(r => {
    const n = r.oleh_nama || '(tanpa nama)';
    rekap[n] = (rekap[n] || 0) + 1;
  });
  const rekapUrut = Object.entries(rekap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="card">
      <div className="card__head">
        <span className="num">ii</span>
        <h2>Riwayat Akses</h2>
        <Badge tone="primary">Jejak siapa membuka apa</Badge>
      </div>
      <div className="card__body">
        <Callout>
          <strong>Setiap akses tercatat</strong>
          Membuka, mencetak, membuat, mengubah, dan menghapus rekam medis tercatat di
          <b> tabel <code>access_log</code></b> pada server. Identitas petugas diambil dari
          sesi login, bukan dari peramban, sehingga catatan ini tidak dapat dipalsukan
          dari sisi klien.
        </Callout>

        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn" id="btn-refresh-access" disabled={memuat} onClick={muat}>
            {memuat ? 'Memuat…' : 'Muat Ulang'}
          </button>
        </div>

        <div id="access-summary" style={{ marginTop: 14 }}>
          {galat ? (
            <div className="callout callout--danger">
              <strong>Gagal memuat riwayat akses</strong>{UI.esc(galat)}
            </div>
          ) : semua === null ? (
            <div className="field__hint">Memuat…</div>
          ) : !total ? (
            <div className="field__hint">Belum ada akses tercatat.</div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Waktu</th>
                      <th style={{ width: 96 }}>Aksi</th>
                      <th>Petugas</th>
                      <th>Rekam Medis</th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {potong.map(r => {
                      const a = AKSI_LABEL[r.aksi] || { label: r.aksi, tone: 'muted' };
                      return (
                        <tr key={r.id}>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWaktu(r.pada)}</td>
                          <td><Badge tone={a.tone}>{a.label}</Badge></td>
                          <td style={{ fontWeight: 600 }}>
                            {r.oleh_nama || '—'}
                            {r.ip ? (
                              <div style={{ fontSize: 10.5, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{r.ip}</div>
                            ) : null}
                          </td>
                          <td style={{ fontSize: 12.5 }}>
                            {r.patient_nama || '—'}
                            <div style={{ fontSize: 10.5, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{r.patient_rm || ''}</div>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{r.detail || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="field__hint" style={{ marginTop: 8 }}>
                Total {total} kejadian tercatat. Per petugas:{' '}
                {rekapUrut.map(([k, v], i) => (
                  <span key={k}>{i > 0 ? ', ' : ''}{k} ({v})</span>
                ))}.
              </div>

              <Pager total={total} cur={cur} onGo={setHal} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   iii — Kelola Akun
   ========================================================== */

/** Dialog satu kolom untuk sandi baru — padanan promptPassword(). */
function promptPassword(judul) {
  return new Promise(resolve => {
    let m;
    const simpan = () => {
      const a = m.root.querySelector('#pw-baru').value;
      const b = m.root.querySelector('#pw-ulang').value;
      if (a.length < 8) { UI.toast('Sandi baru minimal 8 karakter.', 'warn'); return; }
      if (a !== b) { UI.toast('Ulangi sandi tidak cocok.', 'warn'); return; }
      m.close();
      resolve(a);
    };

    m = UI.modal({
      title: judul,
      body: `
        <div class="field">
          <label class="field__label" for="pw-baru">Sandi baru</label>
          <input type="text" id="pw-baru" autocomplete="new-password" placeholder="minimal 8 karakter">
          <p class="field__hint">Sesi yang sedang aktif akan dicabut, jadi petugas harus masuk lagi.</p>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="pw-ulang">Ulangi sandi</label>
          <input type="text" id="pw-ulang" autocomplete="new-password">
        </div>`,
      footer: [
        UI.el('button', { class: 'btn', text: 'Batal', onclick: () => { m.close(); resolve(null); } }),
        UI.el('button', { class: 'btn btn--primary', text: 'Simpan Sandi', onclick: simpan })
      ]
    });
  });
}

/** Formulir tambah petugas — padanan openUserForm(). */
function openUserForm(selesai) {
  let m;
  const nilai = id => {
    const n = m.root.querySelector(id);
    return n ? n.value : '';
  };

  const simpan = async () => {
    const username = nilai('#u-username').trim().toLowerCase();
    const nama = nilai('#u-nama').trim();
    const peran = nilai('#u-peran');
    const sandi = nilai('#u-sandi');
    const ulang = nilai('#u-sandi2');

    if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
      UI.toast('Username 3–24 karakter: huruf kecil, angka, titik, garis.', 'warn');
      return;
    }
    if (nama.length < 2) { UI.toast('Nama lengkap wajib diisi.', 'warn'); return; }
    if (sandi.length < 8) { UI.toast('Sandi minimal 8 karakter.', 'warn'); return; }
    if (sandi !== ulang) { UI.toast('Ulangi sandi tidak cocok.', 'warn'); return; }

    try {
      await API.createUser({ username, nama, peran, password: sandi });
      m.close();
      UI.toast(`Akun "${username}" dibuat`, 'ok');
      selesai();
    } catch (e) {
      UI.toast(e.message || 'Gagal membuat akun', 'danger');
    }
  };

  m = UI.modal({
    title: 'Tambah Petugas',
    body: `
      <div class="form-row form-row--2">
        <div class="field">
          <label class="field__label" for="u-nama">Nama lengkap</label>
          <input type="text" id="u-nama" placeholder="Nama yang akan tampil di rekam medis">
        </div>
        <div class="field">
          <label class="field__label" for="u-username">Username</label>
          <input type="text" id="u-username" autocomplete="off" placeholder="mis. siti">
          <p class="field__hint">Dipakai untuk masuk. Huruf kecil, angka, titik, atau garis.</p>
        </div>
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="u-peran">Peran</label>
        <select id="u-peran">
          ${DAFTAR_PERAN.map(p => `<option value="${UI.esc(p)}"${p === 'Perawat' ? ' selected' : ''}>${UI.esc(p)}</option>`).join('')}
        </select>
        <p class="field__hint">Hanya <b>Admin</b> yang bisa menghapus rekam medis, membuka Pengaturan, dan melihat riwayat akses.</p>
      </div>
      <div class="form-row form-row--2" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="u-sandi">Sandi</label>
          <input type="text" id="u-sandi" autocomplete="new-password">
        </div>
        <div class="field">
          <label class="field__label" for="u-sandi2">Ulangi sandi</label>
          <input type="text" id="u-sandi2" autocomplete="new-password">
        </div>
      </div>
      <div class="callout" style="margin-top:14px">
        <strong>Sandi awal ini dipakai bersama — jangan sampai lupa</strong>
        Minta petugas menggantinya lewat <b>menu akun &rarr; Ganti Sandi</b> setelah masuk pertama.
      </div>`,
    footer: [
      UI.el('button', { class: 'btn', text: 'Batal', onclick: () => m.close() }),
      UI.el('button', { class: 'btn btn--primary', text: 'Buat Akun', onclick: simpan })
    ]
  });
}

function KartuKelolaAkun() {
  const [users, setUsers] = useState(null);
  const [galat, setGalat] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const saya = Store.user && Store.user.id;

  async function muat() {
    setMemuat(true);
    setGalat(null);
    try {
      const d = await API.listUsers();
      setUsers(d.users || []);
    } catch (e) {
      setGalat(e && e.message ? e.message : String(e));
      setUsers(null);
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => { muat(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* --- wireUserActions() --- */
  async function gantiPeran(u, peran) {
    try {
      await API.setRole(u.id, peran);
      UI.toast('Peran diperbarui', 'ok');
      muat();
    } catch (e) {
      UI.toast(e.message || 'Gagal mengubah peran', 'danger');
      muat();          // dropdownnya belum ter-refresh, kembalikan ke nilai server
    }
  }

  async function toggleAktif(u) {
    const on = !u.aktif;
    const ok = await UI.confirm(
      on
        ? `Aktifkan kembali akun "${u.nama}"? Petugas bisa masuk lagi dengan sandi lamanya.`
        : `Nonaktifkan akun "${u.nama}"? Semua sesinya langsung dikeluarkan dari komputer mana pun.`,
      { okText: on ? 'Aktifkan' : 'Nonaktifkan' }
    );
    if (!ok) return;
    try {
      await API.setActive(u.id, on);
      UI.toast(on ? 'Akun diaktifkan' : 'Akun dinonaktifkan', 'ok');
      muat();
    } catch (e) {
      UI.toast(e.message || 'Gagal mengubah status', 'danger');
    }
  }

  async function resetSandi(u) {
    const sandi = await promptPassword(`Sandi baru untuk "${u.nama}"`);
    if (sandi === null) return;
    try {
      const r = await API.resetPassword(u.id, sandi);
      if (r && r.relogin) {
        UI.toast('Sandi Anda diubah. Silakan masuk kembali.', 'ok', 3000);
        setTimeout(() => { location.replace('/login.html'); }, 1200);
      } else {
        UI.toast(`Sandi "${u.nama}" disetel ulang`, 'ok');
        muat();
      }
    } catch (e) {
      UI.toast(e.message || 'Gagal menyetel ulang sandi', 'danger');
    }
  }

  async function hapus(u) {
    const ok = await UI.confirm(
      `Hapus akun "${u.nama}" (${u.username})? Akun tidak akan bisa masuk lagi. ` +
      `Catatan audit dan catatan akses yang pernah ia buat tetap tersimpan atas nama itu.`,
      { title: 'Hapus Akun', okText: 'Hapus Permanen' }
    );
    if (!ok) return;
    try {
      await API.deleteUser(u.id);
      UI.toast(`Akun "${u.username}" dihapus`, 'warn');
      muat();
    } catch (e) {
      UI.toast(e.message || 'Gagal menghapus akun', 'danger');
    }
  }

  return (
    <div className="card">
      <div className="card__head">
        <span className="num">iii</span>
        <h2>Kelola Akun</h2>
        <Badge tone="primary">Petugas yang boleh masuk</Badge>
      </div>
      <div className="card__body">
        <Callout>
          <strong>Peran menentukan hak akses</strong>
          Hanya <b>Admin</b> yang bisa membuka Pengaturan, menghapus rekam medis,
          melihat riwayat akses, dan mengelola cadangan. Dokter &amp; Perawat tetap bisa
          mengisi, mencetak, dan mengubah formulir seperti biasa.
        </Callout>

        <div id="users-host" style={{ marginTop: 14 }}>
          {galat ? (
            <div className="callout callout--danger">
              <strong>Gagal memuat daftar petugas</strong>{UI.esc(galat)}
            </div>
          ) : users === null ? (
            <div className="field__hint">Memuat…</div>
          ) : !users.length ? (
            <div className="field__hint">Belum ada akun petugas.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Petugas</th>
                    <th style={{ width: 165 }}>Peran</th>
                    <th style={{ width: 96 }}>Status</th>
                    <th style={{ width: 140 }}>Terakhir masuk</th>
                    <th style={{ width: 250 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.nama}</strong>
                        {u.id === saya ? <> <Badge tone="ok">Anda</Badge></> : null}
                        <div style={{ fontSize: 11, color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)' }}>{u.username}</div>
                      </td>
                      <td>
                        <select
                          className="select--sm"
                          value={u.peran}
                          disabled={memuat}
                          onChange={e => gantiPeran(u, e.target.value)}
                        >
                          {DAFTAR_PERAN.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td>
                        {u.aktif
                          ? <Badge tone="ok">Aktif</Badge>
                          : <Badge tone="muted">Nonaktif</Badge>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                        {u.terakhir_masuk ? UI.fmtDateTime(u.terakhir_masuk) : <i>belum pernah</i>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn--sm btn--ghost" disabled={memuat} onClick={() => resetSandi(u)}>
                            Reset Sandi
                          </button>

                          <button
                            className={`btn btn--sm ${u.aktif ? 'btn--danger' : 'btn--ghost'}`}
                            disabled={memuat}
                            onClick={() => toggleAktif(u)}
                          >
                            {u.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>

                          {/* Hapus hanya untuk akun nonaktif — akun sendiri tidak bisa dihapus. */}
                          {!u.aktif && u.id !== saya ? (
                            <button
                              className="btn btn--sm btn--danger"
                              disabled={memuat}
                              onClick={() => hapus(u)}
                            >
                              Hapus
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn btn--primary" id="btn-add-user" onClick={() => openUserForm(muat)}>
            + Tambah Petugas
          </button>
          <button className="btn" id="btn-refresh-users" disabled={memuat} onClick={muat}>
            {memuat ? 'Memuat…' : 'Muat Ulang'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   iv — Pencadangan & Pemulihan Data
   ========================================================== */

/** Padanan exportCSV() di app.js lama. */
function exportCSV() {
  const rows = [['No_RM', 'Nama', 'NIK', 'Tanggal_Kunjungan', 'Jam', 'Etiologi', 'Lokasi',
    'Panjang_cm', 'Lebar_cm', 'Luas_cm2', 'Nekrotik_pct', 'Slough_pct', 'Granulasi_pct', 'Epitel_pct',
    'Eksudat_Jumlah', 'Eksudat_Tipe', 'Bau', 'Tanda_Infeksi', 'NRS',
    'WINNER_Total', 'WINNER_Band', 'Foto_Sebelum', 'Foto_Sesudah', 'Catatan', 'Perawat']];

  Store.activePatients().forEach(p => {
    const id = p.identity;
    p.visits.forEach(v => {
      const w = v.wound || {};
      const area = Scales.areaCm2(w.ukuran);
      const total = v.winner && v.winner.total;
      const b = total != null ? Scales.band(total) : null;
      rows.push([
        p.mrNumber, id.nama, id.nik, v.date, v.time,
        UI.joinList(w.etiologi, ' / ', ''), w.lokasi,
        w.ukuran && w.ukuran.panjang, w.ukuran && w.ukuran.lebar, area === null ? '' : area,
        w.jaringan && w.jaringan.nekrotik, w.jaringan && w.jaringan.slough,
        w.jaringan && w.jaringan.granulasi, w.jaringan && w.jaringan.epitel,
        w.eksudat && w.eksudat.jumlah, w.eksudat && w.eksudat.tipe, w.bau,
        UI.joinList(w.time, ' / ', ''), w.nrs,
        total === null ? '' : total, b ? b.short : '',
        v.photos && v.photos.before ? 'ya' : 'tidak',
        v.photos && v.photos.after ? 'ya' : 'tidak',
        v.notes || w.catatan || '', v.perawat
      ]);
    });
  });

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell === null || cell === undefined ? '' : cell);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');

  // BOM agar Excel membaca UTF-8 dengan benar
  UI.download(`woundcare-kunjungan-${Store.today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  UI.toast('CSV diunduh', 'ok');
}

/* ==========================================================
   PEMULIHAN — validasi dan konfirmasi berlapis
   ----------------------------------------------------------
   Versi lama memakai SATU dialog confirm untuk DUA pilihan:
   OK = gabung, Batal = GANTI TOTAL.

   Itu bukan soal gaya, itu lubang data. UI.confirm() me-resolve
   false untuk APAPUN yang menutup dialog tanpa menekan tombol:
   Escape, klik di luar, tanda silang. Dan `false` berarti "ganti
   total". Jadi siapa pun yang memilih berkas lalu pencet Escape —
   gerakan paling wajar di dunia — menghapus seluruh database,
   tanpa konfirmasi kedua dan tanpa jalan kembali.

   Di bawah ini pemulihannya berjenjang:
     1. baca + validasi berkas di peramban — gagal cepat, dan paling
        penting: SEBELUM ada satu baris pun yang dihapus
     2. tampilkan apa yang sebenarnya ada di dalam berkas
     3. "Ganti Total" dipisah, dan mewajibkan mengetik GANTI SEMUA
     4. unduh cadangan data SEKARANG secara otomatis, sebelum
        pemulihan dijalankan — jadi selalu ada jalan kembali
   ========================================================== */

const KATA_GANTI = 'GANTI SEMUA';

/** Baca dan periksa isi cadangan. Melempar Error bila ditolak.
 *  `snap` sudah diurai pemanggil; `fotoTersedia` hanya ada untuk arsip .zip. */
function telaahBerkas(nama, snap, fotoTersedia) {
  if (!snap || typeof snap !== 'object' || !Array.isArray(snap.patients)) {
    throw new Error('Struktur berkas tidak dikenali — ini bukan cadangan WoundCare.');
  }

  /* Tanpa cek ini, berkas terpotong atau salah pilih tetap lolos:
     yang bentuknya "patients" sudah benar. Padahal kalau mode-nya
     replace, database sudah dikosongkan duluan lalu nol baris
     mengisinya. */
  const tanpaId = snap.patients.filter(p => !p || typeof p !== 'object' || !p.id).length;
  if (tanpaId) {
    throw new Error(`${tanpaId} catatan pasien tidak punya id. Berkas ditolak, data lama tidak disentuh.`);
  }

  let kunjungan = 0, consent = 0, foto = 0;
  for (const p of snap.patients) {
    kunjungan += (p.visits || []).length;
    consent += (p.consents || []).length;
    for (const v of (p.visits || [])) {
      const ps = v.photos || {};
      if (ps.before) foto++;
      if (ps.after) foto++;
    }
  }

  /* Arsip .zip yang biner fotonya tidak lengkap. Pemulihan tetap boleh
     jalan, tapi harus jujur soal berapa yang akan hilang. */
  const metaFoto = (snap.meta && Array.isArray(snap.meta.foto)) ? snap.meta.foto : null;
  const kurangFoto = (fotoTersedia && metaFoto)
    ? metaFoto.filter(f => !fotoTersedia.has(f.id)).length
    : 0;

  return {
    snap, nama,
    jumlah: { pasien: snap.patients.length, kunjungan, consent, foto },
    metaFoto, kurangFoto
  };
}

/** Unggah foto satu per satu, bukan semuanya dalam satu permintaan. */
async function unggahFoto(metaFoto, fotoTersedia, progres) {
  for (let i = 0; i < metaFoto.length; i++) {
    const fm = metaFoto[i];
    const data = fotoTersedia.get(fm.id);
    if (!data) { progres(i + 1, metaFoto.length); continue; }

    const qs = new URLSearchParams({
      visitId: fm.visit_id, kind: fm.kind,
      mime: fm.mime || 'image/jpeg',
      width: fm.width || 0, height: fm.height || 0
    });
    const res = await fetch('/api/backup/photos?' + qs.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data.bytes
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Gagal mengunggah foto ${fm.id}.`);
    }
    progres(i + 1, metaFoto.length);
  }
}

/** Dialog pilihan tiga arah. Menutup dialog apa pun berarti BATAL,
    bukan "ganti total" — itu inti perbaikannya. */
function dialogPilihan(telaah, tabrakan, format) {
  return new Promise(resolve => {
    let done = false;
    const tutup = v => { done = true; m.close(); resolve(v); };

    const baris = (k, v, catatan) =>
      `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--c-border)">
         <span style="color:var(--c-text-muted)">${k}</span>
         <span style="font-family:var(--font-mono)"><b>${v}</b>${catatan ? ` <span style="color:var(--c-text-muted);font-family:inherit">${catatan}</span>` : ''}</span>
       </div>`;

    const j = telaah.jumlah;
    const m = UI.modal({
      title: 'Pulihkan Cadangan',
      body: UI.el('div', {
        html: `
          <p style="margin:0 0 10px;font-size:13px">
            Berkas <b style="font-family:var(--font-mono)">${UI.esc(telaah.nama)}</b> berisi:
          </p>
          ${baris('Pasien', j.pasien)}
          ${baris('Kunjungan', j.kunjungan)}
          ${baris('Persetujuan', j.consent)}
          ${baris('Foto', j.foto)}
          <div class="callout callout--warn" style="margin-top:12px;font-size:12.5px">
            ${tabrakan > 0
              ? `GABUNG akan menimpa <b>${tabrakan}</b> pasien yang punya id sama — termasuk yang isinya lebih baru.`
              : 'Tidak ada id yang sama dengan data sekarang, jadi GABUNG hanya menambah.'}
          </div>
          ${telaah.kurangFoto > 0
            ? `<div class="callout callout--danger" style="margin-top:8px;font-size:12.5px">
                 <b>Arsip tidak lengkap:</b> ${telaah.kurangFoto} foto yang disebut manifest tidak ada di dalam arsip.
                 Kunjungan yang memakainya akan pulih tanpa gambar.
               </div>`
            : ''}
          <p style="margin:10px 0 0;font-size:12.5px;color:var(--c-text-muted)">
            Sumber: <b>${format === 'zip' ? 'arsip .zip (foto terpisah)' : 'JSON (foto disisipkan sebagai base64)'}</b>.
            GANTI TOTAL menghapus seluruh pasien, kunjungan, foto, dan jejak audit yang ada sekarang.
          </p>`
      }),
      footer: [
        UI.el('button', { class: 'btn', text: 'Batal', onclick: () => tutup(null) }),
        UI.el('button', { class: 'btn btn--danger', text: 'Ganti Total…', onclick: () => tutup('replace') }),
        UI.el('button', { class: 'btn btn--primary', text: 'Gabungkan', onclick: () => tutup('merge') })
      ],
      onClose: () => { if (!done) resolve(null); }
    });
  });
}

/** Konfirmasi ketik. Satu-satunya jalan ke "hapus semua". */
function dialogKetikGanti() {
  return new Promise(resolve => {
    let done = false;
    const tutup = v => { done = true; m.close(); resolve(v); };

    const input = UI.el('input', {
      type: 'text', placeholder: KATA_GANTI, autocomplete: 'off', spellcheck: 'false',
      style: 'font-family:var(--font-mono);text-transform:uppercase'
    });
    const ok = UI.el('button', { class: 'btn btn--danger', text: 'Hapus Semua & Pulihkan', onclick: () => tutup(true) });
    ok.disabled = true;

    input.addEventListener('input', () => {
      ok.disabled = input.value.trim().toUpperCase() !== KATA_GANTI;
    });

    const m = UI.modal({
      title: 'Hapus Seluruh Data?',
      body: UI.el('div', {
        html: `<p style="margin:0 0 10px;font-size:13px">
                 Semua pasien, kunjungan, foto, dan riwayat perubahan <b>akan dih permanen</b>.
                 Sebaiknya unduh cadangan dulu.
               </p>`
      }, [
        UI.el('p', { text: 'Ketik ' + KATA_GANTI + ' untuk melanjutkan:', style: 'margin:0 0 6px;font-size:12.5px;color:var(--c-text-muted)' }),
        input
      ]),
      footer: [
        UI.el('button', { class: 'btn', text: 'Batal', onclick: () => tutup(false) }),
        ok
      ],
      onClose: () => { if (!done) resolve(false); }
    });
    setTimeout(() => input.focus(), 60);
  });
}

function KartuCadangan({ patients, onSelesai }) {
  const [ukuranDb, setUkuranDb] = useState(null);
  const [mengunduh, setMengunduh] = useState(false);
  const [memulihkan, setMemulihkan] = useState(false);
  const [progres, setProgres] = useState('');

  /* Ukuran diambil dari server: perhitungan di sisi klien tidak lagi
     akurat, karena foto sudah disimpan sebagai BLOB terpisah dan tidak
     ikut di dalam state. */
  useEffect(() => {
    API.stats().then(s => setUkuranDb(s.fotoBytes || 0)).catch(() => {});
  }, []);

  /* Unduh keadaan SEKARANG juga, bukan hanya berkas yang diimpor.
     Dipakai baik untuk tombol Unduh, maupun otomatis tepat sebelum
     pemulihan — supaya selalu ada jalan kembali.

     Bentuk ZIP dipilih untuk daftar utama: foto jadi berkas terpisah di
     dalam arsip, jadi ukurannya tidak meledak oleh base64 dan bisa
     dipulihkan bertahap. JSON tetap tersedia untuk data kecil dan
     untuk dua arah kompatibilitas dengan versi lama. */
  async function unduhSekarang(akhiran, format = 'zip') {
    const jam = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    if (format === 'zip') {
      const res = await fetch('/api/backup.zip', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Gagal menyiapkan arsip cadangan.');
      const blob = await res.blob();
      UI.download(`woundcare-${akhiran}-${Store.today()}-${jam}.zip`, blob, 'application/zip');
      return 'arsip .zip';
    }
    const res = await fetch('/api/export', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Gagal mengambil cadangan dari server.');
    const teks = await res.text();
    UI.download(`woundcare-${akhiran}-${Store.today()}-${jam}.json`, teks, 'application/json');
    return 'berkas .json';
  }

  async function ekspor(format = 'zip') {
    setMengunduh(true);
    try {
      const what = await unduhSekarang('cadangan', format);
      UI.toast('Cadangan diunduh (' + what + ')', 'ok');
    } catch (e) {
      UI.toast(e.message, 'danger');
    } finally {
      setMengunduh(false);
    }
  }

  async function impor() {
    const f = await UI.pickFileBuffer();
    if (!f) return;

    setMemulihkan(true);
    try {
      /* 1 — baca berkas: arsip .zip atau JSON lama */
      let snap, fotoTersedia = null, format = 'json';
      /* Deteksi arsip lewat magic number "PK", bukan lewat nama berkas —
         orang sering mengganti nama atau menyimpannya jadi .json. */
      const buf = f.buffer;
      const magic = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      const adaZip = magic.length >= 2 && magic[0] === 0x50 && magic[1] === 0x4B;

      if (adaZip) {
        setProgres('Membaca arsip…');
        const z = await Backup.bukaZip(f.buffer);
        snap = z.manifest;
        fotoTersedia = z.fotos;
        format = 'zip';
      } else {
        let teks;
        try { teks = new TextDecoder('utf-8').decode(f.buffer); }
        catch (e) { throw new Error('Berkas bukan JSON yang valid.'); }
        try { snap = JSON.parse(teks); }
        catch (e) { throw new Error('Berkas bukan JSON yang valid.'); }
      }

      /* 2 — validasi isi, sebelum apa pun berubah di server */
      const telaah = telaahBerkas(f.name, snap, fotoTersedia);

      /* 3 — berapa id yang akan ditimpa */
      const idSekarang = new Set(patients.map(p => p.id));
      const tabrakan = telaah.snap.patients.filter(p => idSekarang.has(p.id)).length;

      /* 4 — pilihan. Null = batal, dan batal selalu aman. */
      const mode = await dialogPilihan(telaah, tabrakan, format);
      if (!mode) return;

      /* 5 — untuk ganti total, wajib mengetik ulang */
      if (mode === 'replace') {
        const yakin = await dialogKetikGanti();
        if (!yakin) return;
      }

      /* 6 — cadangan otomatis dari kondisi SEKARANG, sebelum menulis.
         Ini yang membuat pemulihan bisa dibatalkan: bila hasilnya
         tidak sesuai, berkas ini yang dikembalikan. */
      try {
        const what = await unduhSekarang('pra-pulihkan', format === 'zip' ? 'zip' : 'json');
        UI.toast('Cadangan otomatis tersimpan: ' + what, 'ok', 4000);
      } catch (e) {
        const tetap = await UI.confirm(
          'Gagal mengunduh cadangan otomatis.\n\nMelanjutkan tanpa cadangan berarti data sekarang tidak punya jalan kembali. Lanjutkan?',
          { title: 'Cadangan otomatis gagal', okText: 'Tetap Lanjut', danger: true }
        );
        if (!tetap) return;
      }

      /* 7 — unggah foto lebih dulu, satu per satu.
         HARUS mendahului apply: saat mode replace, server menghapus
         foto yang tidak ada di daftar cadangan. Kalau manifest dulu,
         foto barunya ikut terhapus. */
      if (telaah.metaFoto && telaah.metaFoto.length) {
        setProgres('Mengunggah 0/' + telaah.metaFoto.length + ' foto…');
        await unggahFoto(telaah.metaFoto, fotoTersedia, (selesai, total) => {
          setProgres(`Mengunggah ${selesai}/${total} foto…`);
        });
        setProgres('');
      }

      /* 8 — baru benar-benar menulis */
      const fotoIds = telaah.metaFoto ? telaah.metaFoto.map(x => x.id) : null;
      const res = Store.importJSON(telaah.snap, { merge: mode === 'merge', fotoIds });
      UI.toast(`${res.imported} pasien dipulihkan`, 'ok');
      onSelesai();
    } catch (err) {
      setProgres('');
      UI.toast(err.message, 'danger', 6000);
    } finally {
      setMemulihkan(false);
    }
  }

  return (
    <div className="card">
      <div className="card__head"><span className="num">iv</span><h2>Pencadangan &amp; Pemulihan Data</h2></div>
      <div className="card__body">
        <Callout tone="warn">
          <strong>⚠ Data tersimpan di basis data server, bukan di peramban</strong>
          Seluruh rekam medis, foto luka, dan jejak audit disimpan pada <b>PostgreSQL</b> di sisi server.
          Menutup peramban tidak menghapus data. Unduhlah cadangan secara berkala — menghapus dari
          peramban tidak mungkin, dan tidak ada di server yang bisa memulihkan data yang sudah hilang.
        </Callout>

        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          Ukuran basis data saat ini: <b style={{ fontFamily: 'var(--font-mono)' }}>{ukuranDb != null ? Photos.humanSize(ukuranDb) : '…'}</b>
          {' · '}{patients.length} pasien aktif · versi skema {Store.version}
        </p>

        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn btn--primary" id="btn-export" onClick={() => ekspor('zip')} disabled={mengunduh || memulihkan}>
            {mengunduh ? 'Menyiapkan…' : '⬇ Unduh Cadangan (.zip)'}
          </button>
          <button className="btn" id="btn-export-json" onClick={() => ekspor('json')} disabled={mengunduh || memulihkan}>
            ⬇ Cadangan (.json)
          </button>
          <button className="btn" id="btn-import" onClick={impor} disabled={memulihkan}>
            {memulihkan ? 'Memulihkan…' : '⬆ Pulihkan dari Cadangan'}
          </button>
          <button className="btn" id="btn-export-csv" onClick={exportCSV}>⬇ Ekspor Kunjungan (CSV)</button>
        </div>

        {progres ? (
          <p className="field__hint" style={{ marginTop: 10 }}>{progres}</p>
        ) : null}
      </div>
    </div>
  );
}

/* ==========================================================
   v — Zona Berbahaya
   ========================================================== */

function KartuZonaBerbahaya({ onSelesai }) {
  async function seed() {
    const ok = await UI.confirm(
      'Muat 3 pasien contoh beserta kunjungan dan skornya?',
      { title: 'Data Contoh', okText: 'Muat', danger: false }
    );
    if (!ok) return;
    Store.seedDemo();
    UI.toast('Data contoh dimuat', 'ok');
    onSelesai();
  }

  async function wipe() {
    const ok = await UI.confirm(
      'Hapus SELURUH data pasien, kunjungan, dan foto dari peramban ini?',
      { title: 'Hapus Semua Data', okText: 'Ya, Hapus Semuanya' }
    );
    if (!ok) return;
    Store.clearAll();
    UI.toast('Seluruh data dihapus', 'warn');
    onSelesai();
  }

  return (
    <div className="card">
      <div className="card__head"><span className="num">v</span><h2>Zona Berbahaya</h2></div>
      <div className="card__body">
        <div className="btn-group">
          <button className="btn" id="btn-seed" onClick={seed}>Muat Data Contoh</button>
          <button className="btn btn--danger" id="btn-wipe" onClick={wipe}>Hapus Seluruh Data</button>
        </div>
        <p className="field__hint" style={{ marginTop: 10 }}>
          Data contoh berguna untuk familiarize diri dengan fitur. Hapus seluruh data tidak dapat dibatalkan —
          unduh cadangan terlebih dahulu.
        </p>
      </div>
    </div>
  );
}

/* ==========================================================
   vi — Tentang Aplikasi
   ========================================================== */

function KartuTentang() {
  return (
    <div className="card">
      <div className="card__head"><span className="num">vi</span><h2>Tentang Aplikasi</h2></div>
      <div className="card__body" style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
        <p><b>WoundCare EHR</b> — formulir rekam medis &amp; manajemen klinis perawatan luka modern.</p>
        <p>Skala yang digunakan: <b>WINNER Wound Assessment Scale</b> &mdash; 13 parameter, skor 1&ndash;5, total 13&ndash;65.
          Skor 13 menunjukkan epitelisasi lengkap (sembuh), skor 65 menunjukkan kondisi sangat buruk.
          Jangkar penilaian mengikuti praktik wound severity scoring yang lazim dipakai
          (Danger Foot Score, Sussman&ndash;Culp), dan <b>dapat disesuaikan</b> oleh institusi Anda
          di <code>assets/js/scales.js</code>.</p>
        <p><strong>Bukan alat untuk diagnosis</strong>
          Aplikasi ini adalah alat bantu dokumentasi dan pencatatan. Hasil penilaian tetap memerlukan
          verifikasi klinis oleh tenaga kesehatan kompeten yang bertanggung jawab atas pasien.
        </p>
      </div>
    </div>
  );
}

/* ==========================================================
   Halaman
   ========================================================== */

export default function SettingsPage() {
  const { user, clinic, patients } = useData();
  const nav = useNavigate();
  const [sibuk, setSibuk] = useState(false);

  /* Setelah data besar berubah (pulihkan cadangan / hapus semua), kembali ke daftar. */
  function setelahPerubahanData() { nav('/'); }

  /* wire(): svClinic.addEventListener('click', ...) */
  async function simpanKlinik(nilai) {
    setSibuk(true);
    try {
      /* nama tidak boleh dikosongkan — kalau dikosongkan, pertahankan yang lama. */
      const config = {
        nama: (nilai.nama || '').trim() || clinic.nama,
        namaPemilik: (nilai.namaPemilik || '').trim(),
        alamat: (nilai.alamat || '').trim(),
        telepon: (nilai.telepon || '').trim()
      };

      await API.saveConfig(config);
      Store.clinic = config;     // memori + antrean sinkronisasi
      UI.toast('Identitas klinik disimpan', 'ok');
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal menyimpan identitas klinik', 'danger', 4500);
    } finally {
      setSibuk(false);
    }
  }

  /* Halaman menolak dengan rapi untuk selain admin — bukan crash. */
  if (!user || user.peran !== 'Admin') {
    return (
      <main className="view" id="view-settings">
        <div className="page-head">
          <div className="page-head__text">
            <h1>Pengaturan &amp; Data</h1>
            <p className="page-head__sub">Halaman pengaturan hanya dapat dibuka oleh admin.</p>
          </div>
        </div>
        <div className="callout callout--danger">
          <strong>Akses ditolak</strong>
          {user
            ? `Akun "${user.nama}" berperan ${user.peran || 'Petugas'}. `
            : 'Anda belum masuk. '}
          Identitas klinik, riwayat akses, pengelolaan akun, dan cadangan data hanya
          untuk akun dengan peran <b>Admin</b>. Hubungi admin klinik bila perlu
          perubahan di halaman ini.
        </div>
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => nav('/')}>← Kembali ke Daftar Pasien</button>
        </div>
      </main>
    );
  }

  return (
    <main className="view" id="view-settings">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Pengaturan &amp; Data</h1>
          <p className="page-head__sub">Identitas klinik, pencadangan, dan pengelolaan basis data lokal.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>← Kembali</button>
        </div>
      </div>

      <KartuIdentitasKlinik
        clinic={clinic}
        sibuk={sibuk}
        onSimpan={simpanKlinik}
      />

      <KartuRiwayatAkses />

      <KartuKelolaAkun />

      <KartuCadangan patients={patients} onSelesai={setelahPerubahanData} />

      <KartuZonaBerbahaya onSelesai={setelahPerubahanData} />

      <KartuTentang />
    </main>
  );
}