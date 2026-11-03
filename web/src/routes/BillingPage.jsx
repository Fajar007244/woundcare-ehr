import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { UI, API } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { openFinanceLog } from '../core/overlays.jsx';
import InputInvoiceModal from '../components/invoice-form.jsx';
import '../styles/billing.css';

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
/* Tambah n hari pada tanggal ISO (YYYY-MM-DD) dan kembalikan ISO lagi.
   Dipakai untuk usulan kontrol berikutnya: 7 hari setelah kunjungan. */
function tambahHari(iso, n) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* Ukuran lembar untuk cetak invoice & kuitansi. Dipakai menyusun aturan
   @page saat mencetak dan mengatur skala huruf per lembar di billing.css.

   Ukuran ditulis dalam milimeter, bukan kata kunci: kata kunci A6 tidak
   dikenali Chrome, sehingga halaman jatuh ke ukuran default printer
   (Letter) dan isinya tercetak kecil di tengah lembar besar. */
const KERTAS_INVOICE = {
  a4: { size: '210mm 297mm', margin: '9mm' },
  a5: { size: '148mm 210mm', margin: '7mm' },
  a6: { size: '105mm 148mm', margin: '5mm' }
};
function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function statusTone(s) {
  if (s === 'lunas') return 'ok';
  if (s === 'sebagian') return 'warn';
  if (s === 'batal') return 'muted';
  return 'info';
}
function statusLabel(s) {
  if (s === 'lunas') return 'Lunas';
  if (s === 'sebagian') return 'Sebagian';
  if (s === 'batal') return 'Batal';
  return 'Belum';
}

/* Kelompok baris Input Invoice — mengikuti alur kasir klinik:
   dressing, obat-obatan, dan jasa tindakan masing-masing punya kolom
   diskon sendiri; transport hanya tampil untuk home care; rekomendasi
   (kunjungan ke-… & kontrol selanjutnya…) hanya untuk onsite. */
/* Blok kuitansi untuk CETAK — di layar disembunyikan CSS, hanya muncul
   saat body.print-kuitansi aktif (lihat billing.css). */
function AreaKuitansi({ inv, clinic }) {
  const c = clinic || {};
  const bayar = Number(inv.dibayar) || 0;
  const total = Number(inv.total) || 0;
  const sisa = Math.max(0, total - bayar);
  const pembayaran = inv.payments || [];
  const metode = pembayaran.length ? (pembayaran[pembayaran.length - 1].metode || '') : '';

  return (
    <div className="print-area-kuitansi kuitansi">
      <div className="kuitansi__head">
        <div>
          <div className="kuitansi__org">{c.nama || 'Klinik'}</div>
          <div className="kuitansi__addr">{c.alamat || ''}</div>
          <div className="kuitansi__addr">{c.telepon ? 'Telp: ' + c.telepon : ''}</div>
        </div>
        <div className="kuitansi__title">KUITANSI</div>
      </div>

      <table className="inv-detail-lines kuitansi__info">
        <tbody>
          <tr><td style={{ width: '40%' }}>No. Kuitansi</td><td><b>{inv.nomor}</b></td></tr>
          <tr><td>Tanggal</td><td>{UI.fmtDate(inv.tanggal)}</td></tr>
          <tr><td>Jenis Layanan</td><td>{inv.layanan === 'homecare' ? 'Home Care' : 'Onsite'}</td></tr>
          <tr><td>Telah diterima dari</td><td><b>{inv.patient_nama || '—'}</b></td></tr>
          <tr><td>Untuk pembayaran</td><td>Tagihan {inv.nomor}</td></tr>
        </tbody>
      </table>

      <div className="kuitansi__rows">
        <div><span>Total invoice</span><b>{rupiah(total)}</b></div>
        <div><span>Dibayar</span><b>{rupiah(bayar)}</b></div>
        <div><span>Sisa tagihan</span><b>{rupiah(sisa)}</b></div>
        {metode ? <div><span>Metode</span><b>{metode}</b></div> : null}
        <div className="kuitansi__grand"><span>Jumlah diterima</span><b>{rupiah(bayar)}</b></div>
      </div>

      <div className="kuitansi__sign">
        <div className="kuitansi__signto">( …………………………… )</div>
        <div className="kuitansi__signname">{c.namaPemilik || 'Petugas / Kasir'}</div>
        <div className="kuitansi__signrole">Petugas / Kasir</div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { user, patients, clinic } = useData();
  const nav = useNavigate();
  const loc = useLocation();
  const isAdmin = !!(user && user.peran === 'Admin');

  /* Formulir Input Invoice kini komponen bersama. `key` yang berubah tiap
     pembukaan memaksa isian lama dibuang, dan pasien/kunjungan awal bisa
     langsung dititipkan dari layar mana pun. */
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSeed, setManualSeed] = useState({ patientId: '', visitId: '', n: 0 });

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  const [invoices, setInvoices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInv, setDetailInv] = useState(null);
  /* Ringkasan dari baris tabel, ditampilkan seketika saat modal dibuka.
     Rincian baris & pembayaran menyusul dari server; tanpa ini modal
     tampak kosong lebih dulu dan terasa berat. */
  const [detailRingkas, setDetailRingkas] = useState(null);
  const [detailErr, setDetailErr] = useState(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payForm, setPayForm] = useState({ tanggal: todayISO(), metode: 'tunai', jumlah: '', catatan: '' });

  /* Satu pilihan ukuran kertas untuk invoice sekaligus kuitansi. */
  const [kertas, setKertas] = useState('a4');
  /* 'invoice' | 'kuitansi' — bagian mana yang dicetak. Selama modal rincian
     terbuka, pilihan ini (dan ukuran kertasnya) langsung diterapkan ke
     <body>, jadi Ctrl+P pun menghasilkan lembar yang sama. */
  const [cetakMode, setCetakMode] = useState('invoice');
  const [cetakMinta, setCetakMinta] = useState(null);

  async function muat() {
    setLoading(true);
    setErr(null);
    try {
      const d = await API.listInvoices({ from, to, status: status === 'all' ? '' : status, limit: 500 });
      setInvoices(Array.isArray(d.invoices) ? d.invoices : []);
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
      setInvoices(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { muat(); /* eslint-disable-next-line */ }, [from, to, status]);

  const filtered = (invoices || []).filter(inv => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (inv.nomor || '').toLowerCase().includes(s) ||
           (inv.patient_nama || '').toLowerCase().includes(s);
  });

  async function bukaDetail(inv) {
    setDetailOpen(true);
    setCetakMode('invoice');
    setDetailRingkas(inv || null);
    setDetailInv(null);
    setDetailErr(null);
    try {
      const d = await API.getInvoice(inv.id);
      const i = d.invoice;
      setDetailInv(i);
      setDetailRingkas(i);
      const sisa = Number(i.total) - Number(i.dibayar);
      setPayForm({ tanggal: todayISO(), metode: 'tunai', jumlah: sisa > 0 ? String(sisa) : '', catatan: '' });
    } catch (e) {
      setDetailErr((e && e.message) || 'Gagal memuat detail.');
    }
  }

  async function refreshDetail() {
    if (!detailInv) return;
    try {
      const d = await API.getInvoice(detailInv.id);
      setDetailInv(d.invoice);
      const sisa = Number(d.invoice.total) - Number(d.invoice.dibayar);
      setPayForm(f => ({ ...f, jumlah: sisa > 0 ? String(sisa) : '' }));
    } catch (e) {
      setDetailErr((e && e.message) || 'Gagal memuat detail.');
    }
  }

  async function catatBayar() {
    if (!detailInv) return;
    const jumlah = Number(payForm.jumlah);
    const sisa = Number(detailInv.total) - Number(detailInv.dibayar);
    if (!jumlah || jumlah <= 0) { UI.toast('Jumlah pembayaran harus lebih dari nol.', 'warn'); return; }
    if (jumlah > sisa) { UI.toast('Pembayaran melebihi sisa tagihan.', 'warn'); return; }
    setPayBusy(true);
    try {
      await API.addPayment({ invoiceId: detailInv.id, tanggal: payForm.tanggal, metode: payForm.metode, jumlah, catatan: payForm.catatan });
      UI.toast('Pembayaran dicatat.', 'ok');
      await refreshDetail();
      muat();
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal mencatat pembayaran.', 'danger');
    } finally {
      setPayBusy(false);
    }
  }

  async function batalInvoice() {
    if (!detailInv || !isAdmin) return;
    const ok = await UI.confirm(
      `Batalkan invoice ${detailInv.nomor}? Pembatalan tidak menghapus riwayat pembayaran yang sudah tercatat.`,
      { title: 'Batalkan Invoice', okText: 'Batalkan' }
    );
    if (!ok) return;
    try {
      await API.setInvoiceStatus(detailInv.id, 'batal');
      UI.toast('Invoice dibatalkan.', 'ok');
      await refreshDetail();
      muat();
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal membatalkan invoice.', 'danger');
    }
  }

  function bayarLunas() {
    if (!detailInv) return;
    const sisa = Number(detailInv.total) - Number(detailInv.dibayar);
    setPayForm(f => ({ ...f, jumlah: sisa > 0 ? String(sisa) : '' }));
  }

  /* Selama modal rincian terbuka: pasang kelas <body> (print-invoice /
     print-kuitansi + kertas-a4|a5|a6) dan aturan @page sesuai pilihan
     kertas. Kelas di <body> membuat CSS cetak hanya mengaktifkan blok yang
     diinginkan dan menyembunyikan sisa aplikasi (lihat billing.css).

     Dulu semua ini dipasang di dalam fungsi cetak, akibatnya Ctrl+P biasa
     tidak pernah memakai ukuran kertas yang dipilih — hasilnya selalu lembar
     A4 dengan tulisan kecil. Sekarang keadaannya mengikuti state. */
  useEffect(() => {
    if (!detailOpen) return undefined;
    const ukuran = KERTAS_INVOICE[kertas] || KERTAS_INVOICE.a4;
    /* Aturan @page tidak bisa dipilih lewat kelas <body>, jadi satu <style>
       disisipkan. Ditulis tanpa pembungkus @media print: Chrome mengabaikan
       @page di dalam @media. */
    let gaya = document.getElementById('inv-paper-size');
    if (!gaya) {
      gaya = document.createElement('style');
      gaya.id = 'inv-paper-size';
      document.head.appendChild(gaya);
    }
    gaya.textContent = `@page { size: ${ukuran.size}; margin: ${ukuran.margin}; }`;
    const aktif = cetakMode === 'kuitansi' ? 'print-kuitansi' : 'print-invoice';
    const pasif = aktif === 'print-invoice' ? 'print-kuitansi' : 'print-invoice';
    document.body.classList.remove(pasif);
    document.body.classList.add(aktif, 'kertas-' + kertas);
    return () => {
      document.body.classList.remove('print-invoice', 'print-kuitansi');
      document.body.classList.remove('kertas-a4', 'kertas-a5', 'kertas-a6');
      if (gaya && gaya.parentNode) gaya.parentNode.removeChild(gaya);
    };
  }, [detailOpen, kertas, cetakMode]);

  /* Percetakan dijalankan setelah kelas & @page terpasang (effect di atas),
     supaya dialog cetak membaca ukuran yang benar. */
  useEffect(() => {
    if (!cetakMinta) return undefined;
    const id = setTimeout(() => window.print(), 60);
    const selesai = () => setCetakMinta(null);
    window.addEventListener('afterprint', selesai, { once: true });
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', selesai);
    };
  }, [cetakMinta]);

  function cetakInvoice() {
    if (!detailInv) return;
    setCetakMode('invoice');
    setCetakMinta('invoice');
  }

  function cetakKuitansi() {
    if (!detailInv) return;
    setCetakMode('kuitansi');
    setCetakMinta('kuitansi');
  }

  /* Angka ringkas invoice yang sedang dilihat. `subtotal` tersimpan sudah
     NETTO per baris (qty × harga − diskon baris), jadi subtotal kotor dan
     total diskon dihitung ulang dari baris untuk ditampilkan. */
  const invHitung = (() => {
    if (!detailInv) return null;
    let kotor = 0;
    (detailInv.lines || []).forEach(l => { kotor += (Number(l.qty) || 0) * (Number(l.harga) || 0); });
    const diskonBaris = Math.max(0, kotor - Number(detailInv.subtotal || 0));
    return {
      kotor,
      diskonBaris,
      totalDiskon: diskonBaris + Math.max(0, Number(detailInv.diskon) || 0)
    };
  })();

  function bukaManual(patientId = '', visitId = '') {
    setManualSeed(seed => ({ patientId: patientId || '', visitId: visitId || '', n: seed.n + 1 }));
    setManualOpen(true);
  }

  /* Tab Grafik Tren mengirim "Buat Invoice" ke sini lewat state navigasi
     (pasien & kunjungan sudah terpilih). Formulir langsung dibuka, lalu
     state-nya dibersihkan supaya memuat ulang halaman tidak membukanya lagi. */
  useEffect(() => {
    const st = loc.state;
    if (!st || !st.buat) return;
    bukaManual(st.patientId, st.visitId);
    nav(loc.pathname, { replace: true, state: null });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loc.state]);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetailOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  return (
    <main className="view" id="view-billing">
      <div className="page-head page-head--hero">
        <div className="page-head__lead">
          <span className="page-head__icon"><Icon name="receipt" size={22} /></span>
          <div className="page-head__text">
            <h1>Kasir &amp; Invoice</h1>
            <p className="page-head__sub">Tagihan, pembayaran, dan pembatalan invoice.</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>← Dashboard</button>
          <button className="btn" onClick={muat} disabled={loading}>{loading ? 'Memuat…' : 'Muat Ulang'}</button>
          {isAdmin ? (
            <button className="btn" onClick={() => openFinanceLog('kasir')} title="Lihat riwayat perubahan">
              Riwayat
            </button>
          ) : null}
          <button className="btn btn--primary" onClick={bukaManual}>+ Input Invoice</button>
        </div>
      </div>

      <div className="bill-toolbar">
        <div className="field" style={{ margin: 0 }}>
          <label className="field__label">Dari</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field__label">Sampai</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="search-inline">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nomor atau nama pasien…" aria-label="Cari invoice" />
        </div>
      </div>

      <div className="bill-status-tabs" style={{ marginBottom: 14 }}>
        {['all', 'belum', 'sebagian', 'lunas', 'batal'].map(s => (
          <button key={s} type="button" className={`bill-tab${status === s ? ' is-active' : ''}`} onClick={() => setStatus(s)}>
            {s === 'all' ? 'Semua' : statusLabel(s)}
          </button>
        ))}
      </div>

      {loading && invoices === null ? <div className="field__hint">Memuat invoice…</div> : null}
      {err ? <Callout tone="danger"><strong>Gagal memuat invoice</strong>{err}</Callout> : null}

      {!loading && !err && invoices && filtered.length === 0 ? (
        <EmptyState icon={<Icon name="receipt" size={34} />} title={invoices.length ? 'Tidak ada invoice yang cocok' : 'Belum ada invoice'} >
          {invoices.length ? 'Coba ubah filter atau periode.' : 'Invoice terbentuk otomatis dari pemakaian barang.'}
        </EmptyState>
      ) : null}

      {!err && filtered.length > 0 ? (
        <>
          <div className="table-wrap bill-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Pasien</th>
                  <th className="num-cell">Total</th>
                  <th className="num-cell">Dibayar</th>
                  <th className="num-cell">Sisa</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const sisa = Number(inv.total) - Number(inv.dibayar);
                  return (
                    <tr key={inv.id} onClick={() => bukaDetail(inv)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.nomor}</td>
                      <td>{UI.fmtDate(inv.tanggal)}</td>
                      <td>{inv.patient_nama || '?'}</td>
                      <td className="num-cell">{rupiah(inv.total)}</td>
                      <td className="num-cell">{rupiah(inv.dibayar)}</td>
                      <td className="num-cell">{rupiah(sisa)}</td>
                      <td><Badge tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bill-cards">
            {filtered.map(inv => {
              const sisa = Number(inv.total) - Number(inv.dibayar);
              return (
                <div key={inv.id} className="bill-card" onClick={() => bukaDetail(inv)}>
                  <div className="bill-card__head">
                    <div>
                      <div className="bill-card__title">{inv.nomor}</div>
                      <div className="bill-card__meta">{UI.fmtDate(inv.tanggal)} · {inv.patient_nama || '?'}</div>
                    </div>
                    <Badge tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Badge>
                  </div>
                  <div className="bill-card__row"><span>Total</span><b>{rupiah(inv.total)}</b></div>
                  <div className="bill-card__row"><span>Dibayar</span><b>{rupiah(inv.dibayar)}</b></div>
                  <div className="bill-card__row"><span>Sisa</span><b>{rupiah(sisa)}</b></div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {detailOpen ? (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target.classList.contains('modal-backdrop')) setDetailOpen(false); }}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Detail Invoice</h2>
              <button className="modal__x" onClick={() => setDetailOpen(false)}>&times;</button>
            </div>
            <div className="modal__body">
              {detailErr ? <Callout tone="danger"><strong>Gagal</strong>{detailErr}</Callout> : null}
              {!detailInv && !detailErr ? (
                detailRingkas ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16 }}>{detailRingkas.nomor}</div>
                        <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                          {UI.fmtDate(detailRingkas.tanggal)} · {detailRingkas.patient_nama || '?'} · {detailRingkas.layanan === 'homecare' ? 'Home Care' : 'Onsite'}
                        </div>
                      </div>
                      <Badge tone={statusTone(detailRingkas.status)}>{statusLabel(detailRingkas.status)}</Badge>
                    </div>
                    <div style={{ marginTop: 10, textAlign: 'right', fontSize: '1em' }}>
                      <div>Total: <b>{rupiah(detailRingkas.total)}</b></div>
                      <div>Dibayar: <b>{rupiah(detailRingkas.dibayar)}</b></div>
                      <div>Sisa: <b>{rupiah(Number(detailRingkas.total) - Number(detailRingkas.dibayar))}</b></div>
                    </div>
                    <div className="field__hint" style={{ marginTop: 12 }}>Memuat rincian baris…</div>
                  </div>
                ) : <div className="field__hint">Memuat…</div>
              ) : null}
              {detailInv ? <AreaKuitansi inv={detailInv} clinic={clinic} /> : null}
              {detailInv ? (
                <div className="print-area">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.35em' }}>{detailInv.nomor}</div>
                      <div style={{ fontSize: '0.92em', color: 'var(--c-text-muted)' }}>{UI.fmtDate(detailInv.tanggal)} · {detailInv.patient_nama || '?'} · {detailInv.layanan === 'homecare' ? 'Home Care' : 'Onsite'}</div>
                    </div>
                    <Badge tone={statusTone(detailInv.status)}>{statusLabel(detailInv.status)}</Badge>
                  </div>

                  <table className="inv-detail-lines">
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th className="num">Qty</th>
                        <th>Satuan</th>
                        <th className="num">Harga</th>
                        <th className="num">Dis.</th>
                        <th className="num">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailInv.lines || []).map(l => (
                        <tr key={l.id}>
                          <td>{l.nama}</td>
                          <td className="num">{angka(l.qty)}</td>
                          <td>{l.satuan || (l.jenis === 'tindakan' ? '' : '?')}</td>
                          <td className="num">{rupiah(l.harga)}</td>
                          <td className="num">{Number(l.diskon) > 0 ? angka(l.diskon) + '%' : '0%'}</td>
                          <td className="num">{rupiah(l.jumlah)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 10, textAlign: 'right', fontSize: '1em' }}>
                    <div>Subtotal: <b>{rupiah(invHitung.kotor)}</b></div>
                    {invHitung.totalDiskon > 0 ? <div>Total Diskon: <b>{rupiah(invHitung.totalDiskon)}</b></div> : null}
                    <div style={{ fontSize: '1.15em' }}>Total: <b>{rupiah(detailInv.total)}</b></div>
                    <div>Dibayar: <b>{rupiah(detailInv.dibayar)}</b></div>
                    <div>Sisa: <b>{rupiah(Number(detailInv.total) - Number(detailInv.dibayar))}</b></div>
                  </div>

                  {detailInv.rekomendasi ? (
                    <div style={{ marginTop: 12, fontSize: '1em' }}>
                      <strong>Rekomendasi</strong>
                      <div>{detailInv.rekomendasi}</div>
                    </div>
                  ) : null}
                  {detailInv.catatan ? (
                    <div style={{ marginTop: 10, fontSize: '1em' }}>
                      <strong>Keterangan</strong>
                      <div>{detailInv.catatan}</div>
                    </div>
                  ) : null}

                  {(detailInv.payments || []).length ? (
                    <div style={{ marginTop: 14 }}>
                      <strong style={{ fontSize: '1em' }}>Riwayat Pembayaran</strong>
                      <table className="inv-detail-lines" style={{ marginTop: 6 }}>
                        <thead>
                          <tr>
                            <th>Tanggal</th>
                            <th>Metode</th>
                            <th className="num">Jumlah</th>
                            <th>Catatan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detailInv.payments || []).map(p => (
                            <tr key={p.id}>
                              <td>{UI.fmtDate(p.tanggal)}</td>
                              <td>{p.metode}</td>
                              <td className="num">{rupiah(p.jumlah)}</td>
                              <td>{p.catatan || '?'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {detailInv.status !== 'batal' && Number(detailInv.total) - Number(detailInv.dibayar) > 0 ? (
                    <div style={{ marginTop: 14 }}>
                      <strong style={{ fontSize: '1em' }}>Catat Pembayaran</strong>
                      <div className="inv-pay-form">
                        <div className="field" style={{ margin: 0 }}>
                          <label className="field__label">Tanggal</label>
                          <input type="date" value={payForm.tanggal} onChange={e => setPayForm({ ...payForm, tanggal: e.target.value })} />
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label className="field__label">Metode</label>
                          <select value={payForm.metode} onChange={e => setPayForm({ ...payForm, metode: e.target.value })}>
                            <option value="tunai">Tunai</option>
                            <option value="transfer">Transfer</option>
                            <option value="kartu">Kartu</option>
                            <option value="qris">QRIS</option>
                          </select>
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label className="field__label">Jumlah</label>
                          <input type="number" value={payForm.jumlah} onChange={e => setPayForm({ ...payForm, jumlah: e.target.value })} />
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label className="field__label">Catatan</label>
                          <input type="text" value={payForm.catatan} onChange={e => setPayForm({ ...payForm, catatan: e.target.value })} />
                        </div>
                      </div>
                      <div className="btn-group" style={{ marginTop: 10 }}>
                        <button className="btn btn--primary" onClick={catatBayar} disabled={payBusy}>
                          {payBusy ? 'Menyimpan…' : 'Simpan Pembayaran'}
                        </button>
                        <button className="btn" onClick={bayarLunas}>Bayar Lunas</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="modal__foot modal__foot--cetak">
              {detailInv ? (
                <>
                  <label className="print-size" title="Ukuran kertas untuk invoice & kuitansi">
                    <span>Kertas</span>
                    <select value={kertas} onChange={e => setKertas(e.target.value)} aria-label="Ukuran kertas cetak">
                      <option value="a4">A4</option>
                      <option value="a5">A5</option>
                      <option value="a6">A6</option>
                    </select>
                  </label>
                  <button className="btn" onClick={cetakInvoice}>Cetak Invoice</button>
                  <button className="btn" onClick={cetakKuitansi}>Cetak Kuitansi</button>
                  {isAdmin && detailInv.status !== 'batal' ? (
                    <button className="btn btn--danger" onClick={batalInvoice}>Batalkan Invoice</button>
                  ) : null}
                </>
              ) : null}
              <button className="btn" onClick={() => setDetailOpen(false)}>Tutup</button>
            </div>
          </div>
        </div>
      ) : null}

      <InputInvoiceModal
        key={manualSeed.n}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        patients={patients}
        initialPatientId={manualSeed.patientId}
        initialVisitId={manualSeed.visitId}
        onCreated={(inv) => { muat(); if (inv) bukaDetail(inv); }}
      />
    </main>
  );
}
