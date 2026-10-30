import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { UI, API } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { openFinanceLog } from '../core/overlays.jsx';
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
const GROUPS = [
  {
    key: 'dressing', label: 'Pemakaian Dressing', jenis: 'dressing', inventoryJenis: ['dressing'],
    hint: 'Metcovazine, Hydrocolloid, Foam, Transparent Film, dll.',
    contoh: ['Metcovazine Silver 50gr', 'Hydrocolloid 10x10cm',
             'Wound Foam 10x20cm', 'Transparent Film']
  },
  {
    key: 'alkes', label: 'Alkes / Alat Kesehatan', jenis: 'alkes', inventoryJenis: ['alkes'],
    hint: 'Alat kesehatan habis pakai, ...',
    contoh: ['Sarung tangan', 'Masker', 'Tensimeter strip']
  },
  {
    key: 'obat', label: 'Obat-obatan dan BMHP', jenis: 'bmhp', inventoryJenis: ['obat', 'bmhp'],
    hint: 'VIP Albumin, Sanmol, Neurobion, kasa, NaCl, Handscoon, dll.',
    contoh: ['VIP Albumin', 'Sanmol 500mg', 'Neurobion']
  },
  {
    key: 'jasa', label: 'Jasa Tindakan / Professional Fee', jenis: 'tindakan',
    hint: 'Tarif jasa tindakan per kunjungan. Isi nama dan harga secara manual.',
    contoh: ['Jasa perawatan luka', 'Jasa tindakan profesional']
  },
  {
    key: 'transport', label: 'Transport', jenis: 'tindakan', homecareOnly: true,
    hint: 'Biaya transport perawat — khusus Home Care',
    contoh: ['Transport home care']
  }
];

const barisKosong = () => [{ nama: '', qty: 1, harga: 0, diskon: 0 }];const semuaGrup = () => ({
  dressing: barisKosong(), alkes: barisKosong(), obat: barisKosong(), jasa: barisKosong(), transport: barisKosong()
});

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
  const isAdmin = !!(user && user.peran === 'Admin');

  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');

  const [invoices, setInvoices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInv, setDetailInv] = useState(null);
  const [detailErr, setDetailErr] = useState(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payForm, setPayForm] = useState({ tanggal: todayISO(), metode: 'tunai', jumlah: '', catatan: '' });

  const [manualOpen, setManualOpen] = useState(false);
  const [manualPatientId, setManualPatientId] = useState('');
  const [manualVisitId, setManualVisitId] = useState('');
  const [manualLayanan, setManualLayanan] = useState('onsite');
  const [manualRekomendasi, setManualRekomendasi] = useState('');
  const [manualKontrol, setManualKontrol] = useState('');
  const [manualLines, setManualLines] = useState(semuaGrup);
  const [manualItems, setManualItems] = useState([]);
  const [manualItemsError, setManualItemsError] = useState('');
  const [manualDiskon, setManualDiskon] = useState(0);
  const [manualCatatan, setManualCatatan] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

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
    setDetailInv(null);
    setDetailErr(null);
    try {
      const d = await API.getInvoice(inv.id);
      const i = d.invoice;
      setDetailInv(i);
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

  /* Cetak dari modal yang sedang terbuka. Kelas di <body> membuat CSS cetak
     hanya mengaktifkan blok yang diinginkan (.print-area untuk invoice,
     .print-area-kuitansi untuk kuitansi) dan menyembunyikan sisa
     aplikasi; tanpa kelas itu dokumen cetak halaman lain ikut
     terpengaruh (lihat billing.css). */
  function cetakDengan(kelas) {
    const bersih = () => {
      document.body.classList.remove(kelas);
      window.removeEventListener('afterprint', bersih);
    };
    document.body.classList.add(kelas);
    window.addEventListener('afterprint', bersih);
    setTimeout(() => {
      window.print();
      // Jaring pengaman bila afterprint tidak dipicu (mis. dialog diblokir).
      setTimeout(bersih, 1000);
    }, 50);
  }

  function cetakInvoice() {
    if (!detailInv) return;
    cetakDengan('print-invoice');
  }

  function cetakKuitansi() {
    if (!detailInv) return;
    cetakDengan('print-kuitansi');
  }

  const selectedManualPatient = (patients || []).find(p => p.id === manualPatientId) || null;
  /* Urutan kronologis (lama → baru) dipakai untuk menghitung kunjungan
     ke-berapa dan dasar tanggal kontrol. Dropdown menampilkannya terbalik. */
  const manualVisits = selectedManualPatient
    ? (selectedManualPatient.visits || []).slice().sort((a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')))
    : [];
  const manualVisitsTerbaru = manualVisits.slice().reverse();
  /* Tanggal dasar usulan kontrol: kunjungan yang dipilih kasir, atau
     kunjungan terakhir pasien bila belum ada yang dipilih. */
  const visitTerpilih = manualVisitId ? manualVisits.find(v => v.id === manualVisitId) : null;
  const visitDasar = visitTerpilih || manualVisits[manualVisits.length - 1] || null;
  const kontrolUsulan = visitDasar && visitDasar.date
    ? tambahHari(visitDasar.date, 7)
    : tambahHari(todayISO(), 7);
  const kontrolTampil = manualKontrol || kontrolUsulan;

  const rekomendasiDefault = selectedManualPatient
    ? `Kunjungan ke-${manualVisits.length + 1} dan kontrol selanjutnya ${UI.fmtDate(kontrolTampil)}`
    : '';
  const rekomendasiTampil = manualRekomendasi || rekomendasiDefault;

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

  function bukaManual() {
    setManualPatientId('');
    setManualVisitId('');
    setManualLayanan('onsite');
    setManualRekomendasi('');
    setManualKontrol('');
    setManualLines(semuaGrup());
    setManualDiskon(0);
    setManualCatatan('');
    setManualOpen(true);
  }

  function pilihPasienInvoice(patientId) {
    setManualPatientId(patientId);
    setManualVisitId('');
    setManualRekomendasi('');
    setManualKontrol('');
  }

  function pilihKunjunganInvoice(visitId) {
    setManualVisitId(visitId);
    // Tanggal kontrol ikut diusulkan ulang dari kunjungan yang baru dipilih.
    setManualKontrol('');
    setManualRekomendasi('');
  }

  /* Produk katalog yang boleh dipakai satu kelompok baris. */
  function produkGrupUntuk(g) {
    const jenisProduk = Array.isArray(g.inventoryJenis)
      ? g.inventoryJenis
      : (g.inventoryJenis ? [g.inventoryJenis] : []);
    if (!jenisProduk.length) return [];
    return manualItems.filter(item => jenisProduk.includes(item.jenis) && Number(item.aktif) === 1);
  }

  function stokProduk(itemId) {
    const it = (manualItems || []).find(x => String(x.id) === String(itemId));
    return it ? Number(it.stok) || 0 : 0;
  }

  /* Pilih produk: harga otomatis, tetapi produk tanpa stok ditolak dengan
     peringatan supaya kasir tidak menagih barang yang tidak ada. */
  function pilihProdukBaris(g, i, id) {
    if (!id) {
      updateManualLine(g.key, i, { itemId: '', nama: '', harga: 0, satuan: '' });
      return;
    }
    const item = produkGrupUntuk(g).find(p => String(p.id) === id);
    if (!item) return;
    if (Number(item.stok) <= 0) {
      UI.toast(
        `Stok ${item.nama} habis (0 ${item.satuan || 'unit'}). Tambah stok di Produk & Stok terlebih dahulu.`,
        'warn'
      );
      updateManualLine(g.key, i, { itemId: '', nama: '', harga: 0, satuan: '' });
      return;
    }
    updateManualLine(g.key, i, {
      itemId: String(item.id), nama: item.nama,
      harga: Number(item.harga_jual) || 0, satuan: item.satuan || '', qty: 1
    });
  }

  /* Qty tidak boleh melebihi stok: kelebihan dipotong ke sisa stok + alert. */
  function ubahQtyBaris(g, i, nilai) {
    const line = (manualLines[g.key] || [])[i];
    if (!g.inventoryJenis || !line || !line.itemId) {
      updateManualLine(g.key, i, { qty: nilai });
      return;
    }
    const stok = stokProduk(line.itemId);
    const qty = Number(nilai) || 0;
    if (qty > stok) {
      UI.toast(`Stok ${line.nama || 'produk'} hanya ${angka(stok)}. Jumlah disesuaikan.`, 'warn');
      updateManualLine(g.key, i, { qty: stok });
      return;
    }
    updateManualLine(g.key, i, { qty: nilai });
  }

  function updateManualLine(grup, i, patch) {
    setManualLines(prev => ({
      ...prev,
      [grup]: prev[grup].map((l, idx) => idx === i ? { ...l, ...patch } : l)
    }));
  }
  function addManualLine(grup) {
    setManualLines(prev => ({ ...prev, [grup]: [...prev[grup], barisKosong()[0]] }));
  }
  function removeManualLine(grup, i) {
    setManualLines(prev => ({
      ...prev,
      [grup]: prev[grup].length > 1 ? prev[grup].filter((_, idx) => idx !== i) : prev[grup]
    }));
  }

  /* Ringkasan hidup di bawah formulir — dihitung dari baris yang sedang
     diketik, sama seperti yang nantinya dihitung server. */
  const manualHitung = (() => {
    let kotor = 0, net = 0;
    GROUPS.forEach(g => (manualLines[g.key] || []).forEach(l => {
      if (g.inventoryJenis && !l.itemId) return;
      const produk = l.itemId ? manualItems.find(item => String(item.id) === String(l.itemId)) : null;
      const harga = g.inventoryJenis
        ? (produk ? Number(produk.harga_jual) || 0 : 0)
        : (Number(l.harga) || 0);
      const k = (Number(l.qty) || 0) * harga;
      const d = Math.min(100, Math.max(0, Number(l.diskon) || 0));
      kotor += k;
      net += k - Math.round(k * d / 100);
    }));
    const total = Math.max(0, net - (Number(manualDiskon) || 0));
    return { kotor, diskonBaris: kotor - net, total };
  })();

  async function simpanManual() {
    const lines = [];
    GROUPS
      .filter(g => !(g.homecareOnly && manualLayanan !== 'homecare'))
      .forEach(g => (manualLines[g.key] || []).forEach(l => {
        if (g.inventoryJenis && !l.itemId) return;
        if (!String(l.nama || '').trim()) return;
        const qty = Number(l.qty) || 0;
        if (qty <= 0) return;
        lines.push({
          itemId: l.itemId || undefined,
          nama: String(l.nama || '').trim(), qty,
          harga: Number(l.harga) || 0,
          satuan: l.satuan || '',
          jenis: g.jenis,
          diskon: Math.min(100, Math.max(0, Number(l.diskon) || 0))
        });
      }));
    if (!lines.length) { UI.toast('Isi minimal satu baris pada salah satu kelompok.', 'warn'); return; }
    if (!manualPatientId) { UI.toast('Pilih pasien.', 'warn'); return; }

    /* Stok diperiksa sekali lagi tepat sebelum invoice dibuat: barang bisa
       saja habis dipakai petugas lain setelah katalog dimuat. */
    for (const g of GROUPS) {
      for (const l of (manualLines[g.key] || [])) {
        if (!g.inventoryJenis || !l.itemId) continue;
        const stok = stokProduk(l.itemId);
        if (stok <= 0) {
          UI.toast(`Stok ${l.nama || 'produk'} habis. Tambah stok di Produk & Stok terlebih dahulu.`, 'danger');
          return;
        }
        if (Number(l.qty) > stok) {
          UI.toast(`Jumlah ${l.nama || 'produk'} melebihi stok tersisa (${angka(stok)}).`, 'danger');
          return;
        }
      }
    }
    setManualBusy(true);
    try {
      const r = await API.createInvoice({
        patientId: manualPatientId,
        patientNama: selectedManualPatient && selectedManualPatient.identity ? (selectedManualPatient.identity.nama || '') : '',
        visitId: manualVisitId || '',
        lines,
        diskon: Number(manualDiskon) || 0,
        catatan: manualCatatan,
        layanan: manualLayanan,
        rekomendasi: manualLayanan === 'onsite' ? rekomendasiTampil : ''
      });
      setManualOpen(false);
      UI.toast('Invoice dibuat: ' + (r.invoice ? r.invoice.nomor : ''), 'ok');
      muat();
      if (r.invoice) bukaDetail(r.invoice);
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal membuat invoice.', 'danger');
    } finally {
      setManualBusy(false);
    }
  }

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetailOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  useEffect(() => {
    if (!manualOpen) return;
    let aktif = true;
    setManualItemsError('');
    API.listItems({ aktif: 1 })
      .then(d => { if (aktif) setManualItems(Array.isArray(d.items) ? d.items : []); })
      .catch(e => { if (aktif) setManualItemsError((e && e.message) || 'Katalog produk tidak dapat dimuat.'); });
    return () => { aktif = false; };
  }, [manualOpen]);

  useEffect(() => {
    if (!manualOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setManualOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [manualOpen]);

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
              {!detailInv && !detailErr ? <div className="field__hint">Memuat…</div> : null}
              {detailInv ? <AreaKuitansi inv={detailInv} clinic={clinic} /> : null}
              {detailInv ? (
                <div className="print-area">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16 }}>{detailInv.nomor}</div>
                      <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{UI.fmtDate(detailInv.tanggal)} · {detailInv.patient_nama || '?'} · {detailInv.layanan === 'homecare' ? 'Home Care' : 'Onsite'}</div>
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

                  <div style={{ marginTop: 10, textAlign: 'right', fontSize: 13 }}>
                    <div>Subtotal: <b>{rupiah(invHitung.kotor)}</b></div>
                    {invHitung.totalDiskon > 0 ? <div>Total Diskon: <b>{rupiah(invHitung.totalDiskon)}</b></div> : null}
                    <div style={{ fontSize: 15 }}>Total: <b>{rupiah(detailInv.total)}</b></div>
                    <div>Dibayar: <b>{rupiah(detailInv.dibayar)}</b></div>
                    <div>Sisa: <b>{rupiah(Number(detailInv.total) - Number(detailInv.dibayar))}</b></div>
                  </div>

                  {detailInv.rekomendasi ? (
                    <div style={{ marginTop: 12, fontSize: 13 }}>
                      <strong>Rekomendasi</strong>
                      <div>{detailInv.rekomendasi}</div>
                    </div>
                  ) : null}
                  {detailInv.catatan ? (
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      <strong>Keterangan</strong>
                      <div>{detailInv.catatan}</div>
                    </div>
                  ) : null}

                  {(detailInv.payments || []).length ? (
                    <div style={{ marginTop: 14 }}>
                      <strong style={{ fontSize: 13 }}>Riwayat Pembayaran</strong>
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
                      <strong style={{ fontSize: 13 }}>Catat Pembayaran</strong>
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
            <div className="modal__foot">
              {detailInv ? (
                <>
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

      {manualOpen ? (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target.classList.contains('modal-backdrop')) setManualOpen(false); }}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Input Invoice</h2>
              <button className="modal__x" onClick={() => setManualOpen(false)}>&times;</button>
            </div>
            <div className="modal__body">
              <div className="form-row form-row--2">
                <div className="field">
                  <label className="field__label">Pasien</label>
                  <select value={manualPatientId} onChange={e => pilihPasienInvoice(e.target.value)}>
                    <option value="">— Pilih pasien —</option>
                    {(patients || []).map(p => (
                      <option key={p.id} value={p.id}>{p.identity && p.identity.nama ? p.identity.nama : p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label">Kunjungan (opsional)</label>
                  <select value={manualVisitId} onChange={e => pilihKunjunganInvoice(e.target.value)} disabled={!selectedManualPatient}>
                    <option value="">— Tanpa kunjungan —</option>
                    {manualVisitsTerbaru.map(v => (
                      <option key={v.id} value={v.id}>{v.date ? UI.fmtDate(v.date) : v.id}{v.time ? ' ' + v.time : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row form-row--2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label className="field__label">Jenis Layanan</label>
                  <select value={manualLayanan} onChange={e => setManualLayanan(e.target.value)}>
                    <option value="onsite">Onsite (di klinik)</option>
                    <option value="homecare">Home Care</option>
                  </select>
                </div>
                {manualLayanan === 'onsite' ? (
                  <div className="field">
                    <label className="field__label">Kontrol Selanjutnya</label>
                    <input
                      type="date"
                      value={kontrolTampil}
                      onChange={e => {
                        setManualKontrol(e.target.value);
                        setManualRekomendasi('');
                      }}
                      title={visitDasar && visitDasar.date
                        ? 'Usulan 7 hari setelah kunjungan ' + UI.fmtDate(visitDasar.date)
                        : 'Usulan 7 hari setelah hari ini'}
                    />
                    <small className="field__hint">
                      {selectedManualPatient
                        ? 'Usulan otomatis 7 hari setelah kunjungan; ubah bila perlu.'
                        : 'Pilih pasien untuk menghitung kunjungan.'}
                    </small>
                  </div>
                ) : <div />}
              </div>

              {manualLayanan === 'onsite' ? (
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="field__label">Rekomendasi</label>
                  <input
                    type="text"
                    value={rekomendasiTampil}
                    onChange={e => setManualRekomendasi(e.target.value)}
                    placeholder={selectedManualPatient ? 'Kunjungan ke-… dan kontrol selanjutnya …' : 'Pilih pasien untuk menghitung kunjungan'}
                  />
                </div>
              ) : null}

              {manualItemsError ? <Callout tone="danger"><strong>Katalog produk</strong>{manualItemsError} Tidak dapat membuat invoice berbasis produk stok sampai katalog bisa dimuat.</Callout> : null}
              {GROUPS.filter(g => !(g.homecareOnly && manualLayanan !== 'homecare')).map(g => (
                <div className="inv-group" key={g.key}>
                  <div className="inv-group__head">
                    <strong>{g.label}</strong>
                    <button className="btn btn--sm" type="button" onClick={() => addManualLine(g.key)}>+ Baris</button>
                  </div>
                  {g.inventoryJenis ? null : (
                    <datalist id={`dl-${g.key}`}>
                      {g.contoh.map(c => <option key={c} value={c} />)}
                    </datalist>
                  )}
                  <div className="inv-line inv-line--head" aria-hidden="true">
                    <span>{g.inventoryJenis ? 'Produk / Nama' : 'Nama'}</span><span>Qty</span><span>Harga (Rp)</span><span>Diskon %</span><span></span>
                  </div>
                  {(manualLines[g.key] || []).map((line, i) => {
                    const produkGrup = produkGrupUntuk(g);
                    const produkTerpilih = line.itemId
                      ? produkGrup.find(item => String(item.id) === String(line.itemId))
                      : null;
                    const hargaBaris = g.inventoryJenis
                      ? (produkTerpilih ? Number(produkTerpilih.harga_jual) || 0 : 0)
                      : line.harga;
                    return (
                    <div key={i} className="inv-line">
                      <div className="field" style={{ margin: 0 }}>
                        {g.inventoryJenis ? (
                          <select
                            value={line.itemId || ''}
                            aria-label={`Pilih ${g.label}`}
                            onChange={e => pilihProdukBaris(g, i, e.target.value)}
                          >
                            <option value="">
                              {manualItemsError
                                ? 'Katalog produk tidak tersedia'
                                : (produkGrup.length ? '— Pilih produk —' : 'Belum ada produk di Produk & Stok')}
                            </option>
                            {produkGrup.map(item => {
                              const habis = Number(item.stok) <= 0;
                              return (
                                <option key={item.id} value={item.id}>
                                  {item.nama} · {habis ? 'stok habis' : 'stok ' + angka(item.stok)} · {rupiah(item.harga_jual)}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <input
                            type="text"
                            list={`dl-${g.key}`}
                            placeholder={g.contoh[0]}
                            value={line.nama}
                            aria-label={`Nama ${g.label}`}
                            onChange={e => updateManualLine(g.key, i, { nama: e.target.value })}
                          />
                        )}
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="1" value={line.qty}
                          aria-label="Qty"
                          onChange={e => ubahQtyBaris(g, i, e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="0" placeholder="0" value={hargaBaris}
                          disabled={!!g.inventoryJenis}
                          title={g.inventoryJenis ? 'Harga jual mengikuti produk pada Produk & Stok.' : undefined}
                          onChange={e => updateManualLine(g.key, i, { harga: e.target.value })} />

                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="0" max="100" value={line.diskon}
                          aria-label="Diskon persen"
                          onChange={e => updateManualLine(g.key, i, { diskon: e.target.value })} />
                      </div>
                      <button
                        className="btn btn--sm btn--danger"
                        type="button"
                        onClick={() => removeManualLine(g.key, i)}
                        disabled={(manualLines[g.key] || []).length <= 1}
                      >×</button>
                    </div>
                  );
                  })}
                </div>
              ))}

              <div className="form-row form-row--2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label className="field__label">Diskon Tambahan (Rp)</label>
                  <input type="number" min="0" value={manualDiskon} onChange={e => setManualDiskon(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field__label">Catatan / Keterangan</label>
                  <input
                    type="text"
                    value={manualCatatan}
                    onChange={e => setManualCatatan(e.target.value)}
                    placeholder="Contoh: Transfer bank BCA an. …"
                  />
                </div>
              </div>

              <div className="inv-recap">
                <div><span>Subtotal</span><b>{rupiah(manualHitung.kotor)}</b></div>
                <div><span>Diskon baris</span><b>{rupiah(manualHitung.diskonBaris)}</b></div>
                {Number(manualDiskon) > 0 ? (
                  <div><span>Diskon tambahan</span><b>{rupiah(manualDiskon)}</b></div>
                ) : null}
                <div className="inv-recap__total"><span>Total</span><b>{rupiah(manualHitung.total)}</b></div>
              </div>
            </div>
            <div className="modal__foot">
              <button className="btn" onClick={() => setManualOpen(false)} disabled={manualBusy}>Batal</button>
              <button className="btn btn--primary" onClick={simpanManual} disabled={manualBusy}>
                {manualBusy ? 'Menyimpan…' : 'Buat Invoice'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
