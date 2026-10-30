import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { UI, API } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import '../styles/billing.css';

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function RevenuePage() {
  const { user } = useData();
  const nav = useNavigate();
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function muat() {
    setLoading(true);
    setErr(null);
    try {
      const [rev, inv] = await Promise.all([
        API.revenue({ from, to }),
        API.listInvoices({ from, to, limit: 1000 })
      ]);
      setData(rev);
      setInvoices(Array.isArray(inv.invoices) ? inv.invoices : []);
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
      setData(null);
      setInvoices(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { muat(); /* eslint-disable-next-line */ }, [from, to]);

  const totalDiterima = data ? Number(data.total || 0) : 0;
  const jmlTransaksi = data ? Number(data.jumlahTransaksi || 0) : 0;
  const rata = jmlTransaksi > 0 ? totalDiterima / jmlTransaksi : 0;

  const piutang = (invoices || []).reduce((a, inv) => {
    if (inv.status === 'batal') return a;
    const sisa = Number(inv.total) - Number(inv.dibayar);
    return sisa > 0 ? a + sisa : a;
  }, 0);

  const byDay = (data && Array.isArray(data.byDay)) ? data.byDay : [];
  const byMetode = (data && Array.isArray(data.byMetode)) ? data.byMetode : [];
  const byJenis = (data && Array.isArray(data.byJenis)) ? data.byJenis : [];
  const topItems = (data && Array.isArray(data.topItems)) ? data.topItems : [];

  const maxDay = byDay.reduce((m, d) => Math.max(m, Number(d.total || 0)), 0);

  return (
    <main className="view" id="view-revenue">
      <div className="page-head page-head--hero">
        <div className="page-head__lead">
          <span className="page-head__icon"><Icon name="wallet" size={22} /></span>
          <div className="page-head__text">
            <h1>Omset</h1>
            <p className="page-head__sub">Pendapatan diterima (kas) vs tagihan, rincian per metode, jenis, dan barang.</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>Dashboard</button>
          <button className="btn" onClick={muat} disabled={loading}>{loading ? 'Memuat…' : 'Muat Ulang'}</button>
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
      </div>

      {loading && data === null ? <div className="field__hint">Memuat omset…</div> : null}
      {err ? <Callout tone="danger"><strong>Gagal memuat omset</strong>{err}</Callout> : null}

      {!loading && !err && data ? (
        <>
          <div className="rev-grid">
            <div className="stat stat--primary">
              <div className="stat__label">Diterima (kas)</div>
              <div className="stat__value" style={{ fontSize: 18 }}>{rupiah(totalDiterima)}</div>
              <div className="stat__foot">uang yang benar-benar masuk</div>
            </div>
            <div className="stat">
              <div className="stat__label">Transaksi</div>
              <div className="stat__value">{angka(jmlTransaksi)}</div>
              <div className="stat__foot">pembayaran tercatat</div>
            </div>
            <div className="stat">
              <div className="stat__label">Rata-rata / Transaksi</div>
              <div className="stat__value" style={{ fontSize: 18 }}>{rupiah(rata)}</div>
              <div className="stat__foot">diterima / transaksi</div>
            </div>
            <div className="stat stat--warn">
              <div className="stat__label">Piutang</div>
              <div className="stat__value" style={{ fontSize: 18 }}>{rupiah(piutang)}</div>
              <div className="stat__foot">tagihan belum tertagih</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <h2>Pendapatan per Hari</h2>
              <Badge tone="muted">{byDay.length} hari</Badge>
            </div>
            <div className="card__body">
              {byDay.length === 0 ? (
                <EmptyState icon={<Icon name="barChart" size={34} />} title="Belum ada pembayaran pada periode ini">
                  Pendapatan dihitung dari uang yang benar-benar diterima (tabel pembayaran), bukan dari total tagihan.
                </EmptyState>
              ) : (
                <div className="rev-chart">
                  <svg viewBox="0 0 600 260" preserveAspectRatio="none">
                    {/* axes */}
                    <line x1="40" y1="10" x2="40" y2="230" stroke="var(--c-border)" />
                    <line x1="40" y1="230" x2="590" y2="230" stroke="var(--c-border)" />
                    {/* y labels */}
                    <text x="36" y="14" textAnchor="end" fontSize="10" fill="var(--c-text-muted)">{rupiah(maxDay)}</text>
                    <text x="36" y="230" textAnchor="end" fontSize="10" fill="var(--c-text-muted)">0</text>
                    {byDay.map((d, i) => {
                      const n = byDay.length;
                      const w = n === 1 ? 40 : (540 / (n - 1));
                      const x = 45 + (n === 1 ? 270 : i * (540 / (n - 1)));
                      const h = maxDay > 0 ? (Number(d.total) / maxDay) * 200 : 0;
                      const y = 230 - h;
                      return (
                        <g key={i}>
                          <rect x={x - 6} y={y} width="12" height={h} fill="var(--c-primary)" rx="2" />
                          <text x={x} y="245" textAnchor="middle" fontSize="9" fill="var(--c-text-muted)">
                            {String(d.tanggal).slice(5)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="rev-two">
            <div className="card">
              <div className="card__head"><h2>Per Metode Pembayaran</h2></div>
              <div className="card__body">
                {byMetode.length === 0 ? (
                  <div className="field__hint">Belum ada pembayaran.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Metode</th><th className="num-cell">Total</th></tr></thead>
                      <tbody>
                        {byMetode.map(m => (
                          <tr key={m.metode}>
                            <td>{m.metode}</td>
                            <td className="num-cell">{rupiah(m.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card__head"><h2>Per Jenis</h2></div>
              <div className="card__body">
                {byJenis.length === 0 ? (
                  <div className="field__hint">Belum ada tagihan.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th>Jenis</th><th className="num-cell">Total Ditagihkan</th></tr></thead>
                      <tbody>
                        {byJenis.map(j => (
                          <tr key={j.jenis}>
                            <td>{j.jenis === 'obat' ? 'Obat' : j.jenis === 'bmhp' ? 'BMHP' : j.jenis === 'tindakan' ? 'Tindakan' : j.jenis === 'dressing' ? 'Dressing' : j.jenis === 'alkes' ? 'Alkes' : j.jenis}</td>
                            <td className="num-cell">{rupiah(j.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="field__hint" style={{ marginTop: 8 }}>
                  Angka ini adalah nilai tagihan (akrual), bukan kas yang diterima.
                </p>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card__head"><h2>5 Barang Teratas (pendapatan)</h2></div>
            <div className="card__body">
              {topItems.length === 0 ? (
                <div className="field__hint">Belum ada data.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Barang</th><th className="num-cell">Qty</th><th className="num-cell">Pendapatan</th></tr></thead>
                    <tbody>
                      {topItems.map(t => (
                        <tr key={t.nama}>
                          <td>{t.nama}</td>
                          <td className="num-cell">{angka(t.qty)}</td>
                          <td className="num-cell">{rupiah(t.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
