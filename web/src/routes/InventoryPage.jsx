import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../core/data.jsx';
import { UI, API } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { openFinanceLog } from '../core/overlays.jsx';
import '../styles/inventory.css';

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function labelJenis(j) { return j === 'bmhp' ? 'BMHP' : 'Obat'; }

export default function InventoryPage() {
  const { user, patients } = useData();
  const nav = useNavigate();
  const isAdmin = !!(user && user.peran === 'Admin');

  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [q, setQ] = useState('');
  const [jenis, setJenis] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);

  const [usageOpen, setUsageOpen] = useState(false);
  const [usagePatientId, setUsagePatientId] = useState('');
  const [usageVisitId, setUsageVisitId] = useState('');
  const [usageLines, setUsageLines] = useState([{ itemId: '', qty: 1 }]);
  const [usageBusy, setUsageBusy] = useState(false);

  async function muat() {
    setLoading(true);
    setErr(null);
    try {
      const d = await API.listItems({});
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      setErr(e && e.message ? e.message : String(e));
      setItems(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { muat(); }, []);

  const filtered = (items || []).filter(it => {
    if (jenis !== 'all' && it.jenis !== jenis) return false;
    if (lowOnly && !(Number(it.stok) <= Number(it.stok_min))) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      if (!((it.nama || '').toLowerCase().includes(s) || (it.kode || '').toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const totalJenis = items ? items.length : 0;
  const totalNilai = (items || []).reduce((a, it) => a + Number(it.stok || 0) * Number(it.harga_beli || 0), 0);
  const lowCount = (items || []).filter(it => Number(it.stok) <= Number(it.stok_min)).length;

  const activeItems = (items || []).filter(it => Number(it.aktif) === 1);

  function bukaFormBarang(it) {
    let m;
    const val = id => { const n = m.root.querySelector(id); return n ? n.value : ''; };
    const simpan = async () => {
      const body = {
        id: it ? it.id : undefined,
        nama: val('#it-nama').trim(),
        kode: val('#it-kode').trim(),
        jenis: val('#it-jenis'),
        satuan: val('#it-satuan').trim(),
        harga_beli: Number(val('#it-hb') || 0),
        harga_jual: Number(val('#it-hj') || 0),
        stok_min: Number(val('#it-min') || 0),
        catatan: val('#it-catatan'),
      };
      if (!body.nama) { UI.toast('Nama barang wajib diisi.', 'warn'); return; }
      try {
        await API.saveItem(body);
        m.close();
        UI.toast(it ? 'Barang diperbarui.' : 'Barang ditambahkan.', 'ok');
        muat();
      } catch (e) {
        UI.toast((e && e.message) || 'Gagal menyimpan barang.', 'danger');
      }
    };
    const jenisOpts = ['obat', 'bmhp'].map(j =>
      `<option value="${j}"${(it && it.jenis === j) || (!it && j === 'obat') ? ' selected' : ''}>${labelJenis(j)}</option>`
    ).join('');
    m = UI.modal({
      title: it ? 'Ubah Barang' : 'Tambah Barang',
      body: `
        <div class="form-row form-row--2">
          <div class="field">
            <label class="field__label" for="it-nama">Nama *</label>
            <input type="text" id="it-nama" value="${UI.esc(it ? it.nama || '' : '')}">
          </div>
          <div class="field">
            <label class="field__label" for="it-kode">Kode</label>
            <input type="text" id="it-kode" value="${UI.esc(it ? it.kode || '' : '')}">
          </div>
        </div>
        <div class="form-row form-row--2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="it-jenis">Jenis</label>
            <select id="it-jenis">${jenisOpts}</select>
          </div>
          <div class="field">
            <label class="field__label" for="it-satuan">Satuan</label>
            <input type="text" id="it-satuan" value="${UI.esc(it ? it.satuan || '' : '')}" placeholder="pcs, tablet, botol">
          </div>
        </div>
        <div class="form-row form-row--3" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="it-hb">Harga Beli</label>
            <input type="number" id="it-hb" value="${it ? Number(it.harga_beli || 0) : 0}" min="0">
          </div>
          <div class="field">
            <label class="field__label" for="it-hj">Harga Jual</label>
            <input type="number" id="it-hj" value="${it ? Number(it.harga_jual || 0) : 0}" min="0">
          </div>
          <div class="field">
            <label class="field__label" for="it-min">Stok Minimum</label>
            <input type="number" id="it-min" value="${it ? Number(it.stok_min || 0) : 0}" min="0">
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="it-catatan">Catatan</label>
          <textarea id="it-catatan" rows="2">${UI.esc(it ? it.catatan || '' : '')}</textarea>
        </div>
      `,
      footer: [
        UI.el('button', { class: 'btn', text: 'Batal', onclick: () => m.close() }),
        UI.el('button', { class: 'btn btn--primary', text: 'Simpan', onclick: simpan })
      ]
    });
  }

  async function nonaktifkan(it) {
    const ok = await UI.confirm(
      `Nonaktifkan barang "${it.nama}"? Stok harus kosong terlebih dahulu.`,
      { title: 'Nonaktifkan Barang', okText: 'Nonaktifkan' }
    );
    if (!ok) return;
    try {
      await API.deleteItem(it.id);
      UI.toast('Barang dinonaktifkan.', 'ok');
      muat();
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal menonaktifkan barang.', 'danger');
    }
  }

  function bukaStok(it) {
    let m;
    const val = id => { const n = m.root.querySelector(id); return n ? n.value : ''; };
    const simpan = async () => {
      const jns = val('#sm-jenis');
      const jumlah = Number(val('#sm-jumlah'));
      const alasan = val('#sm-alasan').trim();
      try {
        await API.addStockMove({ itemId: it.id, jenis: jns, jumlah, alasan });
        m.close();
        UI.toast('Pergerakan stok dicatat.', 'ok');
        muat();
      } catch (e) {
        UI.toast((e && e.message) || 'Gagal mencatat stok.', 'danger');
      }
    };
    m = UI.modal({
      title: `Stok Masuk / Koreksi — ${it.nama}`,
      body: `
        <div class="field">
          <label class="field__label" for="sm-jenis">Jenis</label>
          <select id="sm-jenis">
            <option value="masuk">Masuk (penerimaan)</option>
            <option value="koreksi">Koreksi (selisih, boleh negatif)</option>
          </select>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="sm-jumlah">Jumlah</label>
          <input type="number" id="sm-jumlah" value="1">
          <p class="field__hint">Stok saat ini: ${angka(it.stok)} ${UI.esc(it.satuan || '')}.</p>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="sm-alasan">Alasan</label>
          <textarea id="sm-alasan" rows="2" placeholder="mis. pembelian, retur, penyesuaian fisik"></textarea>
        </div>
      `,
      footer: [
        UI.el('button', { class: 'btn', text: 'Batal', onclick: () => m.close() }),
        UI.el('button', { class: 'btn btn--primary', text: 'Simpan', onclick: simpan })
      ]
    });
  }

  async function bukaRiwayat(it) {
    const m = UI.modal({
      title: `Riwayat Stok — ${it.nama}`,
      body: `<p class="field__hint">Memuat…</p>`,
      footer: [UI.el('button', { class: 'btn', text: 'Tutup', onclick: () => m.close() })]
    });
    try {
      const d = await API.listStock({ itemId: it.id, limit: 100 });
      const moves = Array.isArray(d.moves) ? d.moves : [];
      if (!moves.length) {
        m.body.innerHTML = `<div class="empty-state"><h3>Belum ada pergerakan</h3><p>Riwayat akan muncul setelah stok berubah.</p></div>`;
        return;
      }
      const rows = moves.map(mv => `
        <tr>
          <td style="font-size:12px;white-space:nowrap">${new Date(mv.pada).toLocaleString('id-ID')}</td>
          <td><span class="badge badge--muted">${UI.esc(mv.jenis)}</span></td>
          <td class="num-cell">${angka(mv.jumlah)}</td>
          <td class="num-cell">${angka(mv.stok_akhir)}</td>
          <td style="font-size:12px">${UI.esc(mv.alasan || '—')}</td>
          <td style="font-size:12px">${UI.esc(mv.oleh_nama || '—')}</td>
        </tr>
      `).join('');
      m.body.innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Waktu</th><th>Jenis</th><th class="num-cell">Jumlah</th>
                <th class="num-cell">Stok Akhir</th><th>Alasan</th><th>Oleh</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (e) {
      m.body.innerHTML = `<div class="callout callout--danger"><strong>Gagal memuat riwayat</strong>${UI.esc((e && e.message) || '')}</div>`;
    }
  }

  function bukaPemakaian() {
    setUsagePatientId('');
    setUsageVisitId('');
    setUsageLines([{ itemId: '', qty: 1 }]);
    setUsageOpen(true);
  }

  const selectedPatient = (patients || []).find(p => p.id === usagePatientId) || null;
  const visitsOfPatient = selectedPatient ? (selectedPatient.visits || []) : [];

  function updateLine(i, patch) {
    setUsageLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  function addLine() { setUsageLines(prev => [...prev, { itemId: '', qty: 1 }]); }
  function removeLine(i) { setUsageLines(prev => prev.filter((_, idx) => idx !== i)); }

  async function submitUsage() {
    const lines = usageLines
      .filter(l => l.itemId)
      .map(l => ({ itemId: l.itemId, qty: Number(l.qty) || 0 }))
      .filter(l => l.qty > 0);
    if (!lines.length) { UI.toast('Pilih minimal satu barang.', 'warn'); return; }
    if (!usageVisitId) { UI.toast('Pilih kunjungan pasien.', 'warn'); return; }
    setUsageBusy(true);
    try {
      const r = await API.confirmUsage({
        visitId: usageVisitId,
        patientId: usagePatientId,
        patientNama: selectedPatient && selectedPatient.identity ? (selectedPatient.identity.nama || '') : '',
        lines
      });
      setUsageOpen(false);
      const noInv = r && r.invoice ? r.invoice.nomor : '';
      UI.toast(
        noInv
          ? `Pemakaian dicatat. Invoice ${noInv} terbentuk, stok berkurang.`
          : 'Pemakaian dicatat, stok berkurang.',
        'ok'
      );
      muat();
    } catch (e) {
      const msg = (e && e.message) || 'Gagal mencatat pemakaian.';
      UI.toast(msg, 'danger');
    } finally {
      setUsageBusy(false);
    }
  }

  useEffect(() => {
    if (!usageOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setUsageOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [usageOpen]);

  return (
    <main className="view" id="view-inventory">
      <div className="page-head page-head--hero">
        <div className="page-head__lead">
          <span className="page-head__icon"><Icon name="box" size={22} /></span>
          <div className="page-head__text">
            <h1>Persediaan</h1>
            <p className="page-head__sub">Obat dan BMHP: stok, harga, dan pemakaian per kunjungan.</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>← Dashboard</button>
          <button className="btn" onClick={muat} disabled={loading}>
            {loading ? 'Memuat…' : 'Muat Ulang'}
          </button>
          {isAdmin ? (
            <button className="btn" onClick={() => openFinanceLog('persediaan')} title="Lihat riwayat perubahan">
              Riwayat
            </button>
          ) : null}
          <button className="btn btn--primary" onClick={bukaPemakaian}>
            Catat Pemakaian
          </button>
          {isAdmin ? (
            <button className="btn btn--primary" onClick={() => bukaFormBarang(null)}>
              + Tambah Barang
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid--3 inv-summary">
        <div className="stat stat--primary">
          <div className="stat__label">Jenis Barang</div>
          <div className="stat__value">{angka(totalJenis)}</div>
          <div className="stat__foot">obat &amp; BMHP terdaftar</div>
        </div>
        <div className="stat">
          <div className="stat__label">Total Nilai Stok</div>
          <div className="stat__value" style={{ fontSize: 18 }}>{rupiah(totalNilai)}</div>
          <div className="stat__foot">stok × harga beli</div>
        </div>
        <div className={`stat ${lowCount > 0 ? 'stat--warn' : ''}`}>
          <div className="stat__label">Stok Rendah</div>
          <div className="stat__value">{angka(lowCount)}</div>
          <div className="stat__foot">di bawah stok minimum</div>
        </div>
      </div>

      <div className="inv-toolbar">
        <div className="search-inline">
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Cari nama atau kode barang…"
            aria-label="Cari barang"
          />
        </div>
        <div className="inv-filters">
          {['all', 'obat', 'bmhp'].map(j => (
            <button
              key={j}
              type="button"
              className={`inv-chip${jenis === j ? ' is-active' : ''}`}
              onClick={() => setJenis(j)}
            >
              {j === 'all' ? 'Semua' : labelJenis(j)}
            </button>
          ))}
          <label className="inv-low-toggle">
            <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />
            <span>hanya stok rendah</span>
          </label>
        </div>
      </div>

      {loading && items === null ? (
        <div className="field__hint">Memuat persediaan…</div>
      ) : null}
      {err ? (
        <Callout tone="danger">
          <strong>Gagal memuat persediaan</strong>
          {err}
        </Callout>
      ) : null}

      {!loading && !err && items && filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="box" size={34} />}
          title={items.length ? 'Tidak ada barang yang cocok' : 'Belum ada barang'}
          actions={isAdmin ? <button className="btn btn--primary" onClick={() => bukaFormBarang(null)}>+ Tambah Barang</button> : null}
        >
          {items.length ? 'Coba ubah filter atau kata kunci.' : 'Mulai dengan menambahkan barang pertama.'}
        </EmptyState>
      ) : null}

      {!err && filtered.length > 0 ? (
        <>
          <div className="table-wrap inv-table-wrap">
            <table className="data inv-table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Jenis</th>
                  <th>Satuan</th>
                  <th className="num-cell">Stok</th>
                  <th className="num-cell">Min</th>
                  <th className="num-cell">Harga Jual</th>
                  <th>Status</th>
                  {isAdmin ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const low = Number(it.stok) <= Number(it.stok_min);
                  return (
                    <tr key={it.id} className={low ? 'inv-row--low' : ''}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{it.kode || '—'}</td>
                      <td>
                        <strong>{it.nama}</strong>
                        {it.catatan ? <div style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{it.catatan}</div> : null}
                      </td>
                      <td>{labelJenis(it.jenis)}</td>
                      <td>{it.satuan || '—'}</td>
                      <td className="num-cell">{angka(it.stok)}</td>
                      <td className="num-cell">{angka(it.stok_min)}</td>
                      <td className="num-cell">{rupiah(it.harga_jual)}</td>
                      <td>
                        {Number(it.aktif) !== 1 ? (
                          <Badge tone="muted">Nonaktif</Badge>
                        ) : low ? (
                          <Badge tone="warn"><Icon name="alert" size={12} /> Stok rendah</Badge>
                        ) : (
                          <Badge tone="ok">Aktif</Badge>
                        )}
                      </td>
                      {isAdmin ? (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div className="row-actions">
                            <button className="btn btn--sm btn--ghost" onClick={() => bukaFormBarang(it)}>Ubah</button>
                            <button className="btn btn--sm btn--ghost" onClick={() => bukaStok(it)}>Stok</button>
                            <button className="btn btn--sm btn--ghost" onClick={() => bukaRiwayat(it)}>Riwayat</button>
                            {Number(it.aktif) === 1 ? (
                              <button className="btn btn--sm btn--danger" onClick={() => nonaktifkan(it)}>Nonaktifkan</button>
                            ) : null}
                          </div>
                        </td>
                      ) : (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn--sm btn--ghost" onClick={() => bukaRiwayat(it)}>Riwayat</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="inv-cards">
            {filtered.map(it => {
              const low = Number(it.stok) <= Number(it.stok_min);
              return (
                <div key={it.id} className="inv-card">
                  <div className="inv-card__head">
                    <div>
                      <div className="inv-card__title">{it.nama}</div>
                      <div className="inv-card__code">{it.kode || '—'} · {labelJenis(it.jenis)}</div>
                    </div>
                    {Number(it.aktif) !== 1 ? (
                      <Badge tone="muted">Nonaktif</Badge>
                    ) : low ? (
                      <Badge tone="warn"><Icon name="alert" size={12} /> Rendah</Badge>
                    ) : (
                      <Badge tone="ok">Aktif</Badge>
                    )}
                  </div>
                  <div className="inv-card__grid">
                    <div className="inv-card__kv"><span>Stok</span><b>{angka(it.stok)} {it.satuan || ''}</b></div>
                    <div className="inv-card__kv"><span>Minimum</span><b>{angka(it.stok_min)}</b></div>
                    <div className="inv-card__kv"><span>Harga Jual</span><b>{rupiah(it.harga_jual)}</b></div>
                    <div className="inv-card__kv"><span>Harga Beli</span><b>{rupiah(it.harga_beli)}</b></div>
                  </div>
                  <div className="inv-card__actions">
                    <button className="btn btn--sm btn--ghost" onClick={() => bukaRiwayat(it)}>Riwayat</button>
                    {isAdmin ? (
                      <>
                        <button className="btn btn--sm btn--ghost" onClick={() => bukaFormBarang(it)}>Ubah</button>
                        <button className="btn btn--sm btn--ghost" onClick={() => bukaStok(it)}>Stok</button>
                        {Number(it.aktif) === 1 ? (
                          <button className="btn btn--sm btn--danger" onClick={() => nonaktifkan(it)}>Nonaktifkan</button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {usageOpen ? (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target.classList.contains('modal-backdrop')) setUsageOpen(false); }}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Catat Pemakaian</h2>
              <button className="modal__x" onClick={() => setUsageOpen(false)}>&times;</button>
            </div>
            <div className="modal__body">
              <div className="form-row form-row--2">
                <div className="field">
                  <label className="field__label">Pasien</label>
                  <select value={usagePatientId} onChange={e => { setUsagePatientId(e.target.value); setUsageVisitId(''); }}>
                    <option value="">— Pilih pasien —</option>
                    {(patients || []).map(p => (
                      <option key={p.id} value={p.id}>{p.identity && p.identity.nama ? p.identity.nama : p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label">Kunjungan</label>
                  <select value={usageVisitId} onChange={e => setUsageVisitId(e.target.value)} disabled={!selectedPatient}>
                    <option value="">— Pilih kunjungan —</option>
                    {visitsOfPatient.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.date ? new Date(v.date).toLocaleDateString('id-ID') : v.id}{v.time ? ' ' + v.time : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>Barang yang dipakai</strong>
                  <button className="btn btn--sm btn--ghost" onClick={addLine}>+ Baris</button>
                </div>
                {usageLines.map((line, i) => (
                  <div key={i} className="inv-usage-line">
                    <div className="field" style={{ margin: 0 }}>
                      <select value={line.itemId} onChange={e => updateLine(i, { itemId: e.target.value })}>
                        <option value="">— Pilih barang —</option>
                        {activeItems.map(it => (
                          <option key={it.id} value={it.id}>
                            {it.nama} ({it.kode || it.id}) — stok {angka(it.stok)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <input type="number" min="1" value={line.qty} onChange={e => updateLine(i, { qty: e.target.value })} />
                    </div>
                    <button className="btn btn--sm btn--danger" onClick={() => removeLine(i)} disabled={usageLines.length <= 1}>×</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal__foot">
              <button className="btn" onClick={() => setUsageOpen(false)} disabled={usageBusy}>Batal</button>
              <button className="btn btn--primary" onClick={submitUsage} disabled={usageBusy}>
                {usageBusy ? 'Menyimpan…' : 'Simpan Pemakaian'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
