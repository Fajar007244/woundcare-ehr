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
function labelJenis(j) { const m = { dressing: 'Dressing', alkes: 'Alkes', bmhp: 'BMHP', obat: 'Obat' }; return m[j] || j; }

/* Awalan kode barang per jenis: obat OBT-, BMHP BMH-, dressing DRS-, alkes ALK-. */
function prefixKode(j) {
  const m = { obat: 'OBT', bmhp: 'BMH', dressing: 'DRS', alkes: 'ALK' };
  return m[j] || 'BRG';
}

export default function InventoryPage() {
  const { user } = useData();
  const nav = useNavigate();
  const isAdmin = !!(user && user.peran === 'Admin');

  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [q, setQ] = useState('');
  const [jenis, setJenis] = useState('all');
  const [lowOnly, setLowOnly] = useState(false);


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

  /* Kode berikutnya untuk satu jenis: OBT-001, OBT-002, ...
     Nomor diambil dari kode terbesar yang sudah ada pada jenis itu saja,
     jadi menambah BMHP tidak memakai nomor milik obat. */
  function kodeOtomatis(jenis) {
    const prefix = prefixKode(jenis) + '-';
    let terbesar = 0;
    (items || []).forEach(it => {
      const kode = String(it.kode || '');
      if (!kode.startsWith(prefix)) return;
      const n = parseInt(kode.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > terbesar) terbesar = n;
    });
    return prefix + String(terbesar + 1).padStart(3, '0');
  }

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
    const jenisOpts = ['obat', 'bmhp', 'dressing', 'alkes'].map(j =>
      `<option value="${j}"${(it && it.jenis === j) || (!it && j === 'obat') ? ' selected' : ''}>${labelJenis(j)}</option>`
    ).join('');
    m = UI.modal({          title: it ? 'Ubah Produk / Barang' : 'Tambah Produk / Barang',
      body: `
        <div class="form-row form-row--2">
          <div class="field">
            <label class="field__label" for="it-nama">Nama *</label>
            <input type="text" id="it-nama" value="${UI.esc(it ? it.nama || '' : '')}">
          </div>
          <div class="field">
            <label class="field__label" for="it-kode">Kode</label>
            <input type="text" id="it-kode" value="${UI.esc(it ? it.kode || '' : kodeOtomatis('obat'))}"${it ? '' : ' readonly'}>
          </div>
        </div>
        <div class="form-row form-row--2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="it-jenis">Jenis Produk / Barang</label>
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
          <div class="field">              <label class="field__label" for="it-hj">Harga Jual (untuk Invoice)</label>
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
    /* Barang baru: kode mengikuti jenis yang dipilih. Barang lama dibiarkan
       memakai kodenya sendiri supaya riwayat stok & invoice tidak berubah. */
    if (!it) {
      const selJenis = m.root.querySelector('#it-jenis');
      const inpKode = m.root.querySelector('#it-kode');
      if (selJenis && inpKode) {
        selJenis.addEventListener('change', () => { inpKode.value = kodeOtomatis(selJenis.value); });
      }
    }
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
      body: `<p class="field__hint">Memuat...</p>`,
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
          <td style="font-size:12px">${UI.esc(mv.alasan || '?')}</td>
          <td style="font-size:12px">${UI.esc(mv.oleh_nama || '?')}</td>
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

  return (
    <main className="view" id="view-inventory">
      <div className="page-head page-head--hero">
        <div className="page-head__lead">
          <span className="page-head__icon"><Icon name="box" size={22} /></span>
          <div className="page-head__text">
            <h1>Produk &amp; Stok</h1>
            <p className="page-head__sub">Kelola obat, BMHP, dressing, dan alkes beserta harga dan stoknya.</p>
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => nav('/')}>Dashboard</button>
          <button className="btn" onClick={muat} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat Ulang'}
          </button>
          {isAdmin ? (
            <button className="btn" onClick={() => openFinanceLog('persediaan')} title="Lihat riwayat perubahan">
              Riwayat
            </button>
          ) : null}
          <button className="btn btn--primary" onClick={() => bukaFormBarang(null)}>
            + Tambah Barang
          </button>
        </div>
      </div>

      <div className="grid grid--3 inv-summary">
        <div className="stat stat--primary">
          <div className="stat__label">Jenis Barang</div>
          <div className="stat__value">{angka(totalJenis)}</div>
          <div className="stat__foot">barang terdaftar</div>
        </div>
        <div className="stat">
          <div className="stat__label">Total Nilai Stok</div>
          <div className="stat__value" style={{ fontSize: 18 }}>{rupiah(totalNilai)}</div>
          <div className="stat__foot">stok x harga beli</div>
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
            placeholder="Cari nama atau kode barang..."
            aria-label="Cari barang"
          />
        </div>
        <div className="inv-filters">
          {['all', 'obat', 'bmhp', 'dressing', 'alkes'].map(j => (
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
        <div className="field__hint">Memuat persediaan...</div>
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
          actions={<button className="btn btn--primary" onClick={() => bukaFormBarang(null)}>+ Tambah Barang</button>}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const low = Number(it.stok) <= Number(it.stok_min);
                  return (
                    <tr key={it.id} className={low ? 'inv-row--low' : ''}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{it.kode || '?'}</td>
                      <td>
                        <strong>{it.nama}</strong>
                        {it.catatan ? <div style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{it.catatan}</div> : null}
                      </td>
                      <td>{labelJenis(it.jenis)}</td>
                      <td>{it.satuan || '?'}</td>
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
                      <div className="inv-card__code">{it.kode || '?'} - {labelJenis(it.jenis)}</div>
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
                    <button className="btn btn--sm btn--ghost" onClick={() => bukaFormBarang(it)}>Ubah</button>
                    <button className="btn btn--sm btn--ghost" onClick={() => bukaStok(it)}>Stok</button>
                    {Number(it.aktif) === 1 ? (
                      <button className="btn btn--sm btn--danger" onClick={() => nonaktifkan(it)}>Nonaktifkan</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

    </main>
  );
}
