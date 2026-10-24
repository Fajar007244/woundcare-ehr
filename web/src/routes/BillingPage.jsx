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

export default function BillingPage() {
  const { user, patients } = useData();
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
  const [manualLines, setManualLines] = useState([{ nama: '', qty: 1, harga: 0 }]);
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

  /* Cetak invoice memakai modal yang sedang terbuka. Kelas di <body>
     membuat CSS cetak hanya mengaktifkan .print-area dan menyembunyikan
     sisa aplikasi; tanpa kelas itu dokumen cetak halaman lain ikut
     terpengaruh (lihat billing.css). */
  function cetakInvoice() {
    if (!detailInv) return;
    const bersih = () => {
      document.body.classList.remove('print-invoice');
      window.removeEventListener('afterprint', bersih);
    };
    document.body.classList.add('print-invoice');
    window.addEventListener('afterprint', bersih);
    setTimeout(() => {
      window.print();
      // Jaring pengaman bila afterprint tidak dipicu (mis. dialog diblokir).
      setTimeout(bersih, 1000);
    }, 50);
  }

  const selectedManualPatient = (patients || []).find(p => p.id === manualPatientId) || null;
  const manualVisits = selectedManualPatient ? (selectedManualPatient.visits || []) : [];

  function bukaManual() {
    setManualPatientId('');
    setManualVisitId('');
    setManualLines([{ nama: '', qty: 1, harga: 0 }]);
    setManualDiskon(0);
    setManualCatatan('');
    setManualOpen(true);
  }

  function updateManualLine(i, patch) {
    setManualLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function addManualLine() { setManualLines(prev => [...prev, { nama: '', qty: 1, harga: 0 }]); }
  function removeManualLine(i) { setManualLines(prev => prev.filter((_, idx) => idx !== i)); }

  async function simpanManual() {
    const lines = manualLines
      .filter(l => l.nama.trim())
      .map(l => ({ nama: l.nama.trim(), qty: Number(l.qty) || 0, harga: Number(l.harga) || 0, jenis: 'tindakan' }))
      .filter(l => l.qty > 0);
    if (!lines.length) { UI.toast('Isi minimal satu baris.', 'warn'); return; }
    if (!manualPatientId) { UI.toast('Pilih pasien.', 'warn'); return; }
    setManualBusy(true);
    try {
      const r = await API.createInvoice({
        patientId: manualPatientId,
        patientNama: selectedManualPatient && selectedManualPatient.identity ? (selectedManualPatient.identity.nama || '') : '',
        visitId: manualVisitId || '',
        lines,
        diskon: Number(manualDiskon) || 0,
        catatan: manualCatatan
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
          <button className="btn btn--primary" onClick={bukaManual}>+ Invoice Manual</button>
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
              {detailInv ? (
                <div className="print-area">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 16 }}>{detailInv.nomor}</div>
                      <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{UI.fmtDate(detailInv.tanggal)} · {detailInv.patient_nama || '?'}</div>
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
                        <th className="num">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailInv.lines || []).map(l => (
                        <tr key={l.id}>
                          <td>{l.nama}</td>
                          <td className="num">{angka(l.qty)}</td>
                          <td>{l.satuan || '?'}</td>
                          <td className="num">{rupiah(l.harga)}</td>
                          <td className="num">{rupiah(l.jumlah)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div style={{ marginTop: 10, textAlign: 'right', fontSize: 13 }}>
                    <div>Subtotal: <b>{rupiah(detailInv.subtotal)}</b></div>
                    {Number(detailInv.diskon) > 0 ? <div>Diskon: <b>{rupiah(detailInv.diskon)}</b></div> : null}
                    <div style={{ fontSize: 15 }}>Total: <b>{rupiah(detailInv.total)}</b></div>
                    <div>Dibayar: <b>{rupiah(detailInv.dibayar)}</b></div>
                    <div>Sisa: <b>{rupiah(Number(detailInv.total) - Number(detailInv.dibayar))}</b></div>
                  </div>

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
                  <button className="btn" onClick={cetakInvoice}>Cetak</button>
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
              <h2>Buat Invoice Manual</h2>
              <button className="modal__x" onClick={() => setManualOpen(false)}>&times;</button>
            </div>
            <div className="modal__body">
              <div className="form-row form-row--2">
                <div className="field">
                  <label className="field__label">Pasien</label>
                  <select value={manualPatientId} onChange={e => { setManualPatientId(e.target.value); setManualVisitId(''); }}>
                    <option value="">— Pilih pasien —</option>
                    {(patients || []).map(p => (
                      <option key={p.id} value={p.id}>{p.identity && p.identity.nama ? p.identity.nama : p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label">Kunjungan (opsional)</label>
                  <select value={manualVisitId} onChange={e => setManualVisitId(e.target.value)} disabled={!selectedManualPatient}>
                    <option value="">— Tanpa kunjungan —</option>
                    {manualVisits.map(v => (
                      <option key={v.id} value={v.id}>{v.date ? UI.fmtDate(v.date) : v.id}{v.time ? ' ' + v.time : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>Baris tagihan (tindakan)</strong>
                  <button className="btn btn--sm btn--ghost" onClick={addManualLine}>+ Baris</button>
                </div>
                {manualLines.map((line, i) => (
                  <div key={i} className="inv-usage-line" style={{ gridTemplateColumns: '2fr 80px 110px 32px' }}>
                    <div className="field" style={{ margin: 0 }}>
                      <input type="text" placeholder="Nama tindakan" value={line.nama} onChange={e => updateManualLine(i, { nama: e.target.value })} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <input type="number" min="1" placeholder="Qty" value={line.qty} onChange={e => updateManualLine(i, { qty: e.target.value })} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <input type="number" min="0" placeholder="Harga" value={line.harga} onChange={e => updateManualLine(i, { harga: e.target.value })} />
                    </div>
                    <button className="btn btn--sm btn--danger" onClick={() => removeManualLine(i)} disabled={manualLines.length <= 1}>×</button>
                  </div>
                ))}
              </div>

              <div className="form-row form-row--2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label className="field__label">Diskon</label>
                  <input type="number" min="0" value={manualDiskon} onChange={e => setManualDiskon(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field__label">Catatan</label>
                  <input type="text" value={manualCatatan} onChange={e => setManualCatatan(e.target.value)} />
                </div>
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
