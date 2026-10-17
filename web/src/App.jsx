/* Kerangka aplikasi: chrome + routing.
   Isi tiap tab diserahkan ke berkas masing-masing di src/tabs/. */

import { useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs, kids) => {
  const n = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  });
  (kids || []).forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
};

import { useData, usePatient } from './core/data.jsx';
import { PatientBar, VisitPicker } from './components/patient-bar.jsx';
import { UI, Store, API, Photos, APP_LOGO, PrintDoc } from './lib/index.js';
import { TABS, TAB_LIST } from './tabs/index.js';
import { openAuditHistory, openAccessLog } from './core/overlays.jsx';
import PatientListPage from './routes/PatientListPage.jsx';
import NewPatientPage from './routes/NewPatientPage.jsx';
import SettingsPage from './routes/SettingsPage.jsx';

/* ---------------- Chrome ---------------- */

/* Logo memakai path ABSOLUT. APP_LOGO.path bernilai relatif dan ikut
   pecah begitu halaman berada di route bersarang seperti /p/<id> —
   hasilnya gambar rusak di semua tab formulir, tapi masih baik di
   halaman daftar. */
function Brand({ clinic }) {
  return (
    <div className="brand">
      <div className="brand__logo">
        <img src="/assets/images/logo.png" alt="Logo Lukumu Lukaku Cimahi" />
      </div>
      {/* Wrapper ini WAJIB memakai kelas brand__text — CSS sudah
          menyerobotnya (min-width:0, flex:1 1 auto) untuk membuat
          teks memotong dengan elipsis, bukan memanjangkan navbar.
          Tanpa kelas, judul klinik menabrak tombol Pengaturan. */}
      <div className="brand__text">
        <div className="brand__title">{clinic.nama || 'WoundCare EHR'}</div>
        <div className="brand__sub">Rekam Medis &amp; Manajemen Klinis Perawatan Luka Modern</div>
      </div>
    </div>
  );
}

/* ---------------- Ganti sandi ---------------- */

/**
 * Dialog ganti sandi sendiri. Setelah berhasil server memutus sesi,
 * jadi pengguna wajib masuk lagi — itulah yang membuat sandi baru
 * benar-benar berlaku.
 */
function gantiSandi() {
  const m = UI.modal({
    title: 'Ganti Sandi',
    body: `
      <div className="field">
        <label className="field__label" for="gs-lama">Sandi sekarang</label>
        <input type="password" id="gs-lama" autocomplete="current-password">
      </div>
      <div className="field" style="margin-top:12px">
        <label className="field__label" for="gs-baru">Sandi baru</label>
        <input type="password" id="gs-baru" autocomplete="new-password">
        <div className="field__hint">Minimal 8 karakter.</div>
      </div>
      <div className="field" style="margin-top:12px">
        <label className="field__label" for="gs-ulang">Ulangi sandi baru</label>
        <input type="password" id="gs-ulang" autocomplete="new-password">
      </div>`,
    footer: [
      el('button', { class: 'btn', text: 'Batal', onclick: () => m.close() }),
      el('button', { class: 'btn btn--primary', text: 'Simpan Sandi', onclick: async () => {
        const baru = $('#gs-baru').value;
        if (baru.length < 8) { UI.toast('Sandi baru minimal 8 karakter.', 'warn'); return; }
        if (baru !== $('#gs-ulang').value) { UI.toast('Ulangi sandi tidak cocok.', 'warn'); return; }
        try {
          await API.changePassword({ password: baru });
          m.close();
          UI.toast('Sandi diubah. Silakan masuk kembali.', 'ok');
          setTimeout(() => Store.logout().then(() => location.replace('/login.html')), 900);
        } catch (e) {
          UI.toast(e.message || 'Gagal mengganti sandi', 'danger');
        }
      } })
    ]
  });
}

function UserMenu({ user, unsynced, onLogout }) {
  const [buka, setBuka] = useState(false);
  const nav = useNavigate();
  if (!user) return null;

  const admin = user.peran === 'Admin';

  return (
    <div className="user-menu-wrap" onClick={e => e.stopPropagation()}>
      <button className={`user-chip${buka ? ' is-open' : ''}`} onClick={() => setBuka(!buka)} title="Menu akun">
        <span className="user-chip__avatar">{UI.initials(user.nama)}</span>
        <span className="user-chip__text">
          <span className="user-chip__name">{user.nama}</span>
          <span className="user-chip__role">{user.peran || 'Petugas'}</span>
        </span>
        <span className="user-chip__caret">▾</span>
      </button>

      {buka ? (
        <div className="user-menu" role="menu">
          <div className="user-menu__head">
            <div className="user-menu__name">{user.nama}</div>
            <div className="user-menu__meta">{user.username} · {user.peran || 'Petugas'}</div>
            <div className={`user-menu__sync ${unsynced ? 'user-menu__sync--warn' : 'user-menu__sync--ok'}`}>
              <span className={`dot ${unsynced ? 'dot--warn' : 'dot--ok'}`} />
              <span>{unsynced ? `${unsynced} perubahan belum sampai ke server` : 'Tersinkron dengan server'}</span>
            </div>
          </div>
          <button className="user-menu__item" onClick={() => { setBuka(false); gantiSandi(); }}>
            <span className="user-menu__ico">🔑</span> Ganti Sandi
          </button>
          <button className="user-menu__item" onClick={() => { setBuka(false); nav('/pengaturan'); }}>
            <span className="user-menu__ico">🕓</span> Riwayat Akses Klinik
          </button>
          {admin ? (
            <button className="user-menu__item" onClick={() => { setBuka(false); nav('/pengaturan'); }}>
              <span className="user-menu__ico">⚙</span> Data &amp; Cadangan
            </button>
          ) : null}
          <div className="user-menu__sep"></div>
          <button className="user-menu__item user-menu__item--danger" onClick={onLogout}>
            <span className="user-menu__ico">⏻</span> Keluar
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Header() {
  const { clinic, user, unsynced, logout } = useData();
  const nav = useNavigate();

  useEffect(() => {
    const tutup = () => document.querySelector('.user-menu-wrap > .user-chip')?.classList.remove('is-open');
    document.addEventListener('click', tutup);
    return () => document.removeEventListener('click', tutup);
  }, []);

  return (
    <header className="app-header">
      <Brand clinic={clinic} />
      {/* Pencarian TIDAK lagi di navbar.
         Alasannya terukur: pada ponsel, kotak search di navbar memaksa
         header jadi tiga baris (brand+tombol, chip, kotak cari) —
         hampir seperempat tinggi layar untuk navigasi saja. Di desktop
         navbar jadi tiga kali tinggi isinya hanya untuk satu kotak.

         Kotaknya kini milik halaman Daftar Pasien (lihat
         routes/PatientListPage.jsx), tepat di bawah judul. Satu tempat,
         semua perangkat, tidak pernah ada dobel. */}
      <div className="app-header__spacer"></div>
      {user && user.peran === 'Admin' ? (
        <button className="btn btn--ghost" onClick={() => nav('/pengaturan')} title="Pengaturan &amp; cadangan data">
          ⚙ Pengaturan
        </button>
      ) : null}
      <UserMenu user={user} unsynced={unsynced} onLogout={logout} />
    </header>
  );
}

/* ==========================================================
   Halaman satu pasien
   ========================================================== */

function PatientPage() {
  const { patientId } = useParams();
  const nav = useNavigate();
  const { patient } = usePatient(patientId);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('identitas');

  const visitId = params.get('v');
  const visit = patient
    ? (patient.visits.find(v => v.id === visitId) || patient.visits[patient.visits.length - 1] || null)
    : null;

  /* `?v=` milik pasien sebelumnya harus dibuang saat berganti pasien. Kalau
     tidak, id kunjungan lama ikut terbawa ke URL baru — dan begitu URL itu
     dibuka lagi, pembaca bisa melihat kunjungan pasien yang salah. */
  useEffect(() => {
    if (!patient) return;
    if (!visitId || !patient.visits.some(v => v.id === visitId)) {
      const p = new URLSearchParams(location.search);
      p.delete('v');
      setParams(p, { replace: true });
    }
  }, [patientId]);

  useEffect(() => { window.scrollTo(0, 0); }, [patientId, tab]);

  /* ==========================================================
     CACHE DATA URL FOTO
     ----------------------------------------------------------
     Foto sekarang datang dari URL (/api/photos?id=...), dan Chrome
     merender preview cetak SEBELUM gambar itu selesai dimuat —
     hasilnya kotak kosong di kertas. Data URL bisa dirender sinkron,
     jadi untuk setiap foto yang rujukannya diketahui, binernya
     diambil sekali dan disimpan di window.FOTO_CACHE.

     print.js membaca cache ini; lihat srcCetakFoto() di sana.
     ========================================================== */
  useEffect(() => {
    window.FOTO_CACHE = window.FOTO_CACHE || {};
    if (!patient || !patient.visits) return;
    let berhenti = false;
    patient.visits.forEach(v => {
      ['before', 'after'].forEach(k => {
        const s = Photos.srcOf(v.photos && v.photos[k]);
        if (!s || s.slice(0, 5) === 'data:') return;
        let id = null;
        try { id = new URL(s, location.origin).searchParams.get('id'); } catch (e) {}
        if (!id || window.FOTO_CACHE[id]) return;
        fetch(s, { credentials: 'same-origin' })
          .then(r => (r.ok ? r.blob() : null))
          .then(b => {
            if (!b || berhenti) return;
            return new Promise(res => {
              const fr = new FileReader();
              fr.onload = () => res(fr.result);
              fr.onerror = () => res(null);
              fr.readAsDataURL(b);
            });
          })
          .then(d => { if (d) window.FOTO_CACHE[id] = d; })
          .catch(() => {});
      });
    });
    return () => { berhenti = true; };
  }, [patient]);

  function pilihVisit(id) {
    const p = new URLSearchParams(location.search);
    p.set('v', id);
    setParams(p);
  }

  function tambahKunjungan() {
    const v = {
      id: Store.uid('v'),
      date: Store.today(),
      time: Store.nowTime(),
      createdAt: Store.nowISO(),
      updatedAt: Store.nowISO()
    };
    Store.addVisit(patient.id, v);
    UI.toast('Kunjungan baru dibuat', 'ok');
    pilihVisit(v.id);
  }

  async function toggleFrozen() {
    if (!visit) return;
    const bekuan = !!visit.frozen;
    const ok = await UI.confirm(
      bekuan
        ? 'Buka bekuqn kunjungan ini? Formulir bisa diubah kembali.'
        : 'Bekukan kunjungan ini? Formulir tidak bisa diubah sampai bekuannya dibuka.',
      { okText: bekuan ? 'Buka Bekuan' : 'Bekuan' }
    );
    if (!ok) return;
    Store.setFrozen(patient.id, visit.id, !bekuan);
    UI.toast(bekuan ? 'Bekuan dibuka' : 'Kunjungan dibekukan', 'ok');
  }

  function duplikasi() {
    if (!visit) return;
    const salinan = JSON.parse(JSON.stringify(visit));
    salinan.id = Store.uid('v');
    salinan.date = Store.today();
    salinan.time = Store.nowTime();
    salinan.createdAt = salinan.updatedAt = Store.nowISO();
    salinan.audit = [];
    patient.visits.push(salinan);
    Store.sortVisits(patient);
    Store.touchVisit(patient.id, salinan.id);
    UI.toast('Kunjungan diduplikasi', 'ok');
    pilihVisit(salinan.id);
  }

  async function hapusKunjungan() {
    if (!visit) return;
    const ok = await UI.confirm(
      `Hapus kunjungan ${UI.fmtDateTime(visit.date, visit.time)} beserta fotonya?`,
      { title: 'Hapus Kunjungan', okText: 'Hapus' }
    );
    if (!ok) return;
    Store.removeVisit(patient.id, visit.id);
    const sisa = patient.visits[patient.visits.length - 1];
    if (sisa) pilihVisit(sisa.id);
    UI.toast('Kunjungan dihapus', 'warn');
  }

  function bukaAudit() {
    if (openAuditHistory) openAuditHistory(patient, visit);
    else UI.toast('Riwayat perubahan belum tersedia', 'muted');
  }

  function bukaAkses() {
    if (openAccessLog) openAccessLog(patient);
    else UI.toast('Riwayat akses hanya untuk admin', 'warn');
  }

  if (!patient) {
    return (
      <main className="view">
        <div className="empty-state">
          <h3>Pasien tidak ditemukan</h3>
          <button className="btn" onClick={() => nav('/')}>← Kembali ke daftar</button>
        </div>
      </main>
    );
  }

  const Komponen = TABS[tab] || TABS.identitas;

  /* Susunan ini harus sama dengan index.html versi lama (baris 82-89):
   *
   *   <main id="view-patient" class="view">
   *     <div id="patient-bar" class="patient-bar">
   *     <div id="visit-picker">
   *     <div id="tab-strip" class="tabs">
   *     <div id="tab-body">
   *
   * Dua hal yangeasy hilang kalau tidak dibungkus .view:
   *   • .view memberi padding sp-5, max-width 1400px, dan margin auto.
   *     Tanpa itu patient-bar & pemilih kunjungan melebar penuh layar,
   *     sedangkan isi tab tetap sempit — tidak rata.
   *   • .tabs (bukan .tab-strip) yang punya garis bawah + sorotan tab aktif.
   *     Kelas .tab-strip tidak ada di style.css sama sekali.
   */
  return (
    <main id="view-patient" className="view">
      <PatientBar
        patient={patient}
        visit={visit}
        onBack={() => nav('/')}
        onNewVisit={tambahKunjungan}
        onOpenAccessLog={bukaAkses}
      />

      <VisitPicker
        patient={patient}
        visit={visit}
        onPick={pilihVisit}
        onNewVisit={tambahKunjungan}
        onToggleFreeze={toggleFrozen}
        onDuplicate={duplikasi}
        onDelete={hapusKunjungan}
        onOpenAudit={bukaAudit}
      />

      {/* .tabs — bukan .tab-strip, itu tidak ada di style.css.
          Di ponsel .tabs berubah jadi bottom navigation; ikon dan label
          pendek Yang muncul di sana, sedangkan .tab__label (label
          lengkap) disembunyikan CSS. Di layar lebar sebaliknya. */}
      <div id="tab-strip" className="tabs">
        {TAB_LIST.map(t => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            <span className="tab__ico" aria-hidden="true">{t.icon}</span>
            <span className="tab__label">{t.label}</span>
            <span className="tab__short">{t.short}</span>
          </button>
        ))}
      </div>

      {/* <div>, bukan <main class="view"> — .view sudah dipakai di induknya,
          dan #tab-body.is-frozen (gaya beku) menunjuk ke elemen ini. */}
      <div id="tab-body" className={visit && visit.frozen ? 'is-frozen' : undefined}>
        <Komponen patient={patient} visit={visit} onGoTab={setTab} />
      </div>

      {/*
        * Preloader foto TERSENYUM.
        *
        * Foto kini datang dari /api/photos (URL, bukan data URL tertanam),
        * jadi pada saat Ctrl+P browser masih harus mengunduhnya. Kalau
        * belum pernah ditampilkan, gambar di kertas bisa keluar kosong.
        * Komponen ini memanaskan cache peramban untuk SELURUH foto
        * pasien sedari awal — ia sendiri tidak terlihat.
        */}
      {(() => {
        const urls = [];
        (patient.visits || []).forEach(v => {
          ['before', 'after'].forEach(k => {
            const s = Photos.srcOf(v.photos && v.photos[k]);
            if (s && s.slice(0, 5) !== 'data:') urls.push(s);
          });
        });
        return urls.length ? (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              opacity: 0,
              pointerEvents: 'none'
            }}
          >
            {urls.map(u => <img key={u} src={u} alt="" />)}
          </div>
        ) : null;
      })()}
    </main>
  );
}

/* ---------------- Aplikasi ---------------- */

/*
 * Jembatan ke print.js untuk tombol Ctrl+P.
 *
 * print.js (tidak boleh diubah) membaca `window.App.state` saat peristiwa
 * `beforeprint` untuk menentukan dokumen mana yang harus dibangun. Di React
 * tidak ada objek global itu, sehingga sebelumrylalu keluar lebih awal dan
 * #print-root tetap kosong — karena #screen-root disembunyikan oleh
 * print.css, hasil cetaknya halaman kosong.
 *
 * Jadi bentuk yang diharapkan print.js kita penuhi di sini.
 */
function usePrintState(state) {
  useEffect(() => {
    window.App = { state };
    return () => { delete window.App; };
  }, [state.view, state.patientId, state.visitId]);   // eslint-disable-line
}

export default function App() {
  const { pathname } = useLocation();
  const match = /^\/p\/([^/?]+)/.exec(pathname);
  const [params] = useSearchParams();
  const visitId = params.get('v');

  usePrintState({
    view: match ? 'patient' : 'list',
    patientId: match ? match[1] : null,
    visitId: match ? visitId : null
  });

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<PatientListPage />} />
        <Route path="/pasien-baru" element={<NewPatientPage />} />
        <Route path="/p/:patientId" element={<PatientPage />} />
        <Route path="/pengaturan" element={<SettingsPage />} />
        <Route path="*" element={<PatientListPage />} />
      </Routes>
    </>
  );
}