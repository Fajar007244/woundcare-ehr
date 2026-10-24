/* ==========================================================
   DASHBOARD  (halaman /)
   ----------------------------------------------------------
   Halaman pertama setelah masuk. Tugasnya menjawab tiga
   pertanyaan dalam satu layar:

     1. Bagaimana keadaan klinik hari ini?
        -> kartu ringkasan pasien & kunjungan
     2. Apa yang perlu dikerjakan sekarang?
        -> kunjungan terbaru, pasien perlu perhatian, stok rendah
     3. Ke mana saya pergi berikutnya?
        -> deretan pintasan ke halaman lain

   Data pasien/kunjungan sudah ada di Store (lewat useData),
   jadi tidak perlu permintaan jaringan. Data keuangan dan
   persediaan datang dari API dan dimuat terpisah supaya
   kegagalan salah satunya tidak mengosongkan seluruh halaman.
   ========================================================== */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { Store, UI, API, Scales } from '../lib/index.js';
import { Badge, Card } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import '../styles/dashboard.css';

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function salam() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}
function tanggalPanjang() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

export default function DashboardPage() {
  const { user, clinic, patients } = useData();
  const nav = useNavigate();
  const isAdmin = !!(user && user.peran === 'Admin');

  const [fin, setFin] = useState(null);      // { omset, transaksi, piutang, belum }
  const [items, setItems] = useState(null);  // daftar barang aktif
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!user) return;
    let batal = false;
    const from = firstDayOfMonth();
    const to = todayISO();

    const permintaan = [API.listItems({})];
    if (isAdmin) {
      permintaan.push(API.revenue({ from, to }), API.listInvoices({ limit: 500 }));
    }

    Promise.all(permintaan)
      .then(([it, rev, inv]) => {
        if (batal) return;
        setItems(Array.isArray(it.items) ? it.items.filter(x => Number(x.aktif) !== 0) : []);

        if (isAdmin) {
          const list = Array.isArray(inv.invoices) ? inv.invoices : [];
          const piutang = list.reduce((a, i) => {
            if (i.status === 'batal') return a;
            const sisa = Number(i.total) - Number(i.dibayar);
            return sisa > 0 ? a + sisa : a;
          }, 0);
          setFin({
            omset: Number(rev.total || 0),
            transaksi: Number(rev.jumlahTransaksi || 0),
            piutang,
            belum: list.filter(i => i.status !== 'lunas' && i.status !== 'batal').length
          });
        }
      })
      .catch(e => { if (!batal) setErr(e && e.message ? e.message : String(e)); });

    return () => { batal = true; };
  }, [user, isAdmin]);

  /* ---------- Ringkasan klinis ---------- */
  const s = Store.stats();

  const perluPerhatian = (patients || [])
    .map(p => ({ p, s: Store.summarize(p) }))
    .filter(x => x.s.infectionSigns > 0 || x.s.trend.dir === 'up')
    .sort((a, b) => b.s.infectionSigns - a.s.infectionSigns);

  /* ---------- Kunjungan terbaru (semua pasien) ---------- */
  const kunjungan = [];
  (patients || []).forEach(p => {
    (p.visits || []).forEach(v => kunjungan.push({ p, v }));
  });
  kunjungan.sort((a, b) =>
    String(b.v.date + (b.v.time || '')).localeCompare(String(a.v.date + (a.v.time || ''))));
  const kunjunganTerbaru = kunjungan.slice(0, 5);
  const hariIni = todayISO();
  const kunjunganHariIni = kunjungan.filter(x => x.v.date === hariIni).length;

  /* ---------- Persediaan ---------- */
  const stokRendah = (items || [])
    .filter(it => Number(it.stok) <= Number(it.stok_min))
    .sort((a, b) => Number(a.stok) - Number(b.stok));
  const nilaiStok = (items || []).reduce(
    (a, it) => a + Number(it.stok || 0) * Number(it.harga_beli || 0), 0);

  const pintasan = [
    { to: '/pasien', icon: 'user', label: 'Daftar Pasien', desc: `${angka(s.patients)} pasien aktif` },
    { to: '/pasien-baru', icon: 'fileText', label: 'Tambah Pasien', desc: 'Daftarkan pasien baru' },
    { to: '/kasir', icon: 'receipt', label: 'Kasir & Invoice', desc: fin ? `${angka(fin.belum)} invoice belum lunas` : 'Tagihan & pembayaran' },
    { to: '/persediaan', icon: 'box', label: 'Persediaan', desc: items ? `${angka(stokRendah.length)} stok rendah` : 'Stok obat & BMHP' }
  ];
  if (isAdmin) {
    pintasan.push(
      { to: '/omset', icon: 'wallet', label: 'Omset', desc: fin ? rupiah(fin.omset) + ' bulan ini' : 'Pendapatan klinik' },
      { to: '/pengaturan', icon: 'database', label: 'Pengaturan', desc: 'Identitas klinik & cadangan data' }
    );
  }

  return (
    <main className="view" id="view-dashboard">
      <div className="page-head page-head--hero">
        <div className="page-head__lead">
          <span className="page-head__icon"><Icon name="activity" size={22} /></span>
          <div className="page-head__text">
            <h1>Dashboard</h1>
            <p className="page-head__sub">
              {salam()}{user ? ', ' + user.nama : ''} · {clinic && clinic.nama ? clinic.nama + ' · ' : ''}{tanggalPanjang()}
            </p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/pasien')}>Daftar Pasien</button>
          <button className="btn btn--primary" onClick={() => nav('/pasien-baru')}>+ Tambah Pasien</button>
        </div>
      </div>

      {/* Pintasan — diletakkan paling atas karena inilah yang dipakai
          berulang kali; kartu statistik lebih sering dibaca sekilas. */}
      <section className={`dash-links${isAdmin ? '' : ' dash-links--four'}`} aria-label="Pintasan halaman">
        {pintasan.map(x => (
          <button key={x.to} type="button" className="dash-link" onClick={() => nav(x.to)}>
            <span className="dash-link__icon"><Icon name={x.icon} size={20} /></span>
            <span className="dash-link__text">
              <strong>{x.label}</strong>
              <span>{x.desc}</span>
            </span>
            <span className="dash-link__arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </section>

      <h2 className="dash-section-title">Ringkasan Klinik</h2>
      <div className="grid grid--4" style={{ marginBottom: 20 }}>
        <div className="stat stat--primary">
          <div className="stat__label">Pasien Aktif</div>
          <div className="stat__value">{angka(s.patients)}</div>
          <div className="stat__foot">{angka(s.visits)} kunjungan tercatat</div>
        </div>
        <div className="stat">
          <div className="stat__label">Kunjungan Hari Ini</div>
          <div className="stat__value">{angka(kunjunganHariIni)}</div>
          <div className="stat__foot">dari {angka(s.visits)} kunjungan tercatat</div>
        </div>
        <div className="stat">
          <div className="stat__label">Tren Membaik</div>
          <div className="stat__value" style={{ color: 'var(--c-ok)' }}>{angka(s.healing)}</div>
          <div className="stat__foot">pasien dengan skor turun</div>
        </div>
        <div className={`stat ${perluPerhatian.length ? 'stat--danger' : ''}`}>
          <div className="stat__label">Perlu Perhatian</div>
          <div className="stat__value">{angka(perluPerhatian.length)}</div>
          <div className="stat__foot">tanda infeksi atau skor memburuk</div>
        </div>
      </div>

      {isAdmin ? (
        <>
          <h2 className="dash-section-title">Keuangan &amp; Persediaan</h2>
          <div className="grid grid--4" style={{ marginBottom: 20 }}>
            <div className="stat stat--primary">
              <div className="stat__label">Omset Bulan Ini</div>
              <div className="stat__value" style={{ fontSize: 20 }}>{fin ? rupiah(fin.omset) : '—'}</div>
              <div className="stat__foot">{fin ? angka(fin.transaksi) + ' pembayaran diterima' : 'memuat…'}</div>
            </div>
            <div className={`stat ${fin && fin.piutang > 0 ? 'stat--warn' : ''}`}>
              <div className="stat__label">Piutang</div>
              <div className="stat__value" style={{ fontSize: 20 }}>{fin ? rupiah(fin.piutang) : '—'}</div>
              <div className="stat__foot">{fin ? angka(fin.belum) + ' invoice belum lunas' : 'memuat…'}</div>
            </div>
            <div className={`stat ${stokRendah.length ? 'stat--warn' : ''}`}>
              <div className="stat__label">Stok Rendah</div>
              <div className="stat__value">{items ? angka(stokRendah.length) : '—'}</div>
              <div className="stat__foot">di bawah stok minimum</div>
            </div>
            <div className="stat">
              <div className="stat__label">Nilai Stok</div>
              <div className="stat__value" style={{ fontSize: 20 }}>{items ? rupiah(nilaiStok) : '—'}</div>
              <div className="stat__foot">stok × harga beli</div>
            </div>
          </div>
        </>
      ) : null}

      {err ? (
        <div className="field__hint" style={{ marginBottom: 16 }}>
          Sebagian ringkasan tidak dapat dimuat: {err}
        </div>
      ) : null}

      <div className="dash-two">
        <Card title="Kunjungan Terbaru" badge={<Badge tone="muted">{kunjunganTerbaru.length} terakhir</Badge>}>
          {kunjunganTerbaru.length ? (
            <div className="dash-list">
              {kunjunganTerbaru.map(({ p, v }) => {
                const skor = v.winner && v.winner.total != null ? v.winner.total : null;
                const band = skor != null ? Scales.band(skor) : null;
                return (
                  <button
                    key={p.id + ':' + v.id}
                    type="button"
                    className="dash-row"
                    onClick={() => nav(`/p/${p.id}?v=${encodeURIComponent(v.id)}`)}
                  >
                    <span className="dash-row__main">
                      <strong>{p.identity.nama || '(Tanpa Nama)'}</strong>
                      <span>{UI.fmtDate(v.date)}{v.time ? ' · ' + v.time : ''}</span>
                    </span>
                    {skor != null
                      ? <Badge tone={band ? band.tone : 'muted'}>{skor} · {band ? band.short : 'Berskor'}</Badge>
                      : <Badge tone="muted">Belum dinilai</Badge>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="dash-empty">Belum ada kunjungan tercatat.</div>
          )}
        </Card>

        <div className="dash-stack">
          <Card title="Perlu Perhatian" badge={<Badge tone={perluPerhatian.length ? 'danger' : 'ok'}>{perluPerhatian.length} pasien</Badge>}>
            {perluPerhatian.length ? (
              <div className="dash-list">
                {perluPerhatian.slice(0, 4).map(({ p, s: ps }) => (
                  <button
                    key={p.id}
                    type="button"
                    className="dash-row"
                    onClick={() => nav(`/p/${p.id}`)}
                  >
                    <span className="dash-row__main">
                      <strong>{p.identity.nama || '(Tanpa Nama)'}</strong>
                      <span>{ps.lastVisitDate ? 'Kunjungan terakhir ' + UI.fmtDate(ps.lastVisitDate) : 'Belum ada kunjungan'}</span>
                    </span>
                    {ps.infectionSigns > 0
                      ? <Badge tone="danger">{ps.infectionSigns} tanda infeksi</Badge>
                      : <Badge tone={ps.trend.tone}>{ps.trend.text}</Badge>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="dash-empty">Tidak ada pasien yang perlu perhatian khusus.</div>
            )}
          </Card>

          <Card
            title="Stok Rendah"
            badge={<Badge tone={stokRendah.length ? 'warn' : 'ok'}>{items ? stokRendah.length + ' barang' : 'memuat…'}</Badge>}
          >
            {items === null ? (
              <div className="dash-empty">Memuat persediaan…</div>
            ) : stokRendah.length ? (
              <div className="dash-list">
                {stokRendah.slice(0, 4).map(it => (
                  <button key={it.id} type="button" className="dash-row" onClick={() => nav('/persediaan')}>
                    <span className="dash-row__main">
                      <strong>{it.nama}</strong>
                      <span>minimum {angka(it.stok_min)} {it.satuan || ''}</span>
                    </span>
                    <Badge tone="warn">{angka(it.stok)} tersisa</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <div className="dash-empty">Semua stok di atas batas minimum.</div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
