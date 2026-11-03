import { useEffect, useState } from 'react';

import { UI, API } from '../lib/index.js';
import { Callout } from './ui.jsx';

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

/* Katalog produk dipakai bersama semua formulir invoice. Cache singkat
   (60 detik) supaya membuka formulir untuk kedua kalinya tidak menunggu
   jaringan lagi: sebelumnya setiap pembukaan memanggil /api/items
   (±0,6 detik) dan daftar produk kosong selama menunggu. */
const UMUR_KATALOG = 60000;
let katalog = { items: null, waktu: 0, janji: null };

function katalogMasihSegar() {
  return !!katalog.items && Date.now() - katalog.waktu < UMUR_KATALOG;
}

function ambilKatalog() {
  if (katalogMasihSegar()) return Promise.resolve(katalog.items);
  if (katalog.janji) return katalog.janji;
  katalog.janji = API.listItems({ aktif: 1 })
    .then(d => {
      const items = Array.isArray(d.items) ? d.items : [];
      katalog = { items, waktu: Date.now(), janji: null };
      return items;
    })
    .catch(e => { katalog.janji = null; throw e; });
  return katalog.janji;
}

function rupiah(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function angka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
/* Tambah n hari pada tanggal ISO (YYYY-MM-DD) dan kembalikan ISO lagi. */
function tambahHari(iso, n) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ==========================================================
   Formulir Input Invoice (dipakai bersama)
   ==========================================================
   Sebelumnya formulir ini menempel di halaman Kasir, sehingga membuat
   invoice untuk kunjungan yang sedang dibuka mengharuskan pindah
   halaman. Sekarang menjadi komponen sendiri dan bisa dibuka dari mana
   pun — Kasir maupun tab Grafik Tren pada halaman pasien.

   Komponen memasang datanya sendiri (pasien dari prop, katalog produk
   dari API) dan menutup diri lewat onClose(). onCreated(invoice) dipanggil
   setelah server berhasil membuat invoice.
   ========================================================== */
export default function InputInvoiceModal({
  open, onClose, patients, initialPatientId = '', initialVisitId = '', onCreated
}) {
  const [patientId, setPatientId] = useState(initialPatientId || '');
  const [visitId, setVisitId] = useState(initialVisitId || '');
  const [layanan, setLayanan] = useState('onsite');
  const [rekomendasiInput, setRekomendasiInput] = useState('');
  const [kontrol, setKontrol] = useState('');
  const [lines, setLines] = useState(semuaGrup);
  const [items, setItems] = useState([]);
  const [itemsError, setItemsError] = useState('');
  const [diskon, setDiskon] = useState(0);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  /* Katalog produk dimuat setiap formulir dibuka (harga & stok bisa
     berubah sejak pemuatan sebelumnya). */
  useEffect(() => {
    if (!open) return undefined;
    let aktif = true;
    setItemsError('');
    /* Katalog yang masih segar langsung dipakai — formulir terbuka dengan
       daftar produk siap, tanpa jeda jaringan. */
    if (katalogMasihSegar()) {
      setItems(katalog.items);
      return undefined;
    }
    ambilKatalog()
      .then(items => { if (aktif) setItems(items); })
      .catch(e => { if (aktif) setItemsError((e && e.message) || 'Katalog produk tidak dapat dimuat.'); });
    return () => { aktif = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
const selectedPatient = (patients || []).find(p => p.id === patientId) || null;
  /* Urutan kronologis (lama → baru) dipakai untuk menghitung kunjungan
     ke-berapa dan dasar tanggal kontrol. Dropdown menampilkannya terbalik. */
  const visits = selectedPatient
    ? (selectedPatient.visits || []).slice().sort((a, b) =>
        String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')))
    : [];
  const visitsTerbaru = visits.slice().reverse();
  /* Tanggal dasar usulan kontrol: kunjungan yang dipilih kasir, atau
     kunjungan terakhir pasien bila belum ada yang dipilih. */
  const visitTerpilih = visitId ? visits.find(v => v.id === visitId) : null;
  const visitDasar = visitTerpilih || visits[visits.length - 1] || null;
  const kontrolUsulan = visitDasar && visitDasar.date
    ? tambahHari(visitDasar.date, 7)
    : tambahHari(todayISO(), 7);
  const kontrolTampil = kontrol || kontrolUsulan;

  const rekomendasiDefault = selectedPatient
    ? `Kunjungan ke-${visits.length + 1} dan kontrol selanjutnya ${UI.fmtDate(kontrolTampil)}`
    : '';
  const rekomendasiTampil = rekomendasiInput || rekomendasiDefault;

  function pilihPasien(patientId) {
    setPatientId(patientId);
    setVisitId('');
    setRekomendasiInput('');
    setKontrol('');
  }

  function pilihKunjungan(visitId) {
    setVisitId(visitId);
    // Tanggal kontrol ikut diusulkan ulang dari kunjungan yang baru dipilih.
    setKontrol('');
    setRekomendasiInput('');
  }

  /* Produk katalog yang boleh dipakai satu kelompok baris. */
  function produkGrupUntuk(g) {
    const jenisProduk = Array.isArray(g.inventoryJenis)
      ? g.inventoryJenis
      : (g.inventoryJenis ? [g.inventoryJenis] : []);
    if (!jenisProduk.length) return [];
    return items.filter(item => jenisProduk.includes(item.jenis) && Number(item.aktif) === 1);
  }

  function stokProduk(itemId) {
    const it = (items || []).find(x => String(x.id) === String(itemId));
    return it ? Number(it.stok) || 0 : 0;
  }

  /* Pilih produk: harga otomatis, tetapi produk tanpa stok ditolak dengan
     peringatan supaya kasir tidak menagih barang yang tidak ada. */
  function pilihProduk(g, i, id) {
    if (!id) {
      updateLine(g.key, i, { itemId: '', nama: '', harga: 0, satuan: '' });
      return;
    }
    const item = produkGrupUntuk(g).find(p => String(p.id) === id);
    if (!item) return;
    if (Number(item.stok) <= 0) {
      UI.toast(
        `Stok ${item.nama} habis (0 ${item.satuan || 'unit'}). Tambah stok di Produk & Stok terlebih dahulu.`,
        'warn'
      );
      updateLine(g.key, i, { itemId: '', nama: '', harga: 0, satuan: '' });
      return;
    }
    updateLine(g.key, i, {
      itemId: String(item.id), nama: item.nama,
      harga: Number(item.harga_jual) || 0, satuan: item.satuan || '', qty: 1
    });
  }

  /* Qty tidak boleh melebihi stok: kelebihan dipotong ke sisa stok + alert. */
  function ubahQty(g, i, nilai) {
    const line = (lines[g.key] || [])[i];
    if (!g.inventoryJenis || !line || !line.itemId) {
      updateLine(g.key, i, { qty: nilai });
      return;
    }
    const stok = stokProduk(line.itemId);
    const qty = Number(nilai) || 0;
    if (qty > stok) {
      UI.toast(`Stok ${line.nama || 'produk'} hanya ${angka(stok)}. Jumlah disesuaikan.`, 'warn');
      updateLine(g.key, i, { qty: stok });
      return;
    }
    updateLine(g.key, i, { qty: nilai });
  }

  function updateLine(grup, i, patch) {
    setLines(prev => ({
      ...prev,
      [grup]: prev[grup].map((l, idx) => idx === i ? { ...l, ...patch } : l)
    }));
  }
  function addLine(grup) {
    setLines(prev => ({ ...prev, [grup]: [...prev[grup], barisKosong()[0]] }));
  }
  function removeLine(grup, i) {
    setLines(prev => ({
      ...prev,
      [grup]: prev[grup].length > 1 ? prev[grup].filter((_, idx) => idx !== i) : prev[grup]
    }));
  }

  /* Ringkasan hidup di bawah formulir — dihitung dari baris yang sedang
     diketik, sama seperti yang nantinya dihitung server. */
  const hitung = (() => {
    let kotor = 0, net = 0;
    GROUPS.forEach(g => (lines[g.key] || []).forEach(l => {
      if (g.inventoryJenis && !l.itemId) return;
      const produk = l.itemId ? items.find(item => String(item.id) === String(l.itemId)) : null;
      const harga = g.inventoryJenis
        ? (produk ? Number(produk.harga_jual) || 0 : 0)
        : (Number(l.harga) || 0);
      const k = (Number(l.qty) || 0) * harga;
      const d = Math.min(100, Math.max(0, Number(l.diskon) || 0));
      kotor += k;
      net += k - Math.round(k * d / 100);
    }));
    const total = Math.max(0, net - (Number(diskon) || 0));
    return { kotor, diskonBaris: kotor - net, total };
  })();

  async function simpan() {
    /* Daftar baris untuk server — nama variabelnya sengaja berbeda dari state
       `lines`. Sebelumnya variabel lokal ini bernama `lines` juga dan
       menutupi state, sehingga validasi selalu menganggap tidak ada baris
       dan invoice tidak pernah terkirim. */
    const daftar = [];
    GROUPS
      .filter(g => !(g.homecareOnly && layanan !== 'homecare'))
      .forEach(g => (lines[g.key] || []).forEach(l => {
        if (g.inventoryJenis && !l.itemId) return;
        if (!String(l.nama || '').trim()) return;
        const qty = Number(l.qty) || 0;
        if (qty <= 0) return;
        daftar.push({
          itemId: l.itemId || undefined,
          nama: String(l.nama || '').trim(), qty,
          harga: Number(l.harga) || 0,
          satuan: l.satuan || '',
          jenis: g.jenis,
          diskon: Math.min(100, Math.max(0, Number(l.diskon) || 0))
        });
      }));
    if (!daftar.length) { UI.toast('Isi minimal satu baris pada salah satu kelompok.', 'warn'); return; }
    if (!patientId) { UI.toast('Pilih pasien.', 'warn'); return; }

    /* Stok diperiksa sekali lagi tepat sebelum invoice dibuat: barang bisa
       saja habis dipakai petugas lain setelah katalog dimuat. */
    for (const g of GROUPS) {
      for (const l of (lines[g.key] || [])) {
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
    setBusy(true);
    try {
      const r = await API.createInvoice({
        patientId: patientId,
        patientNama: selectedPatient && selectedPatient.identity ? (selectedPatient.identity.nama || '') : '',
        visitId: visitId || '',
        lines: daftar,
        diskon: Number(diskon) || 0,
        catatan: catatan,
        layanan: layanan,
        rekomendasi: layanan === 'onsite' ? rekomendasiTampil : ''
      });
      onClose();
      UI.toast('Invoice dibuat: ' + (r.invoice ? r.invoice.nomor : ''), 'ok');
      /* Stok berubah di server setelah invoice dibuat — paksa katalog segar
         pada pembukaan berikutnya. */
      katalog = { items: katalog.items, waktu: 0, janji: null };
      if (onCreated) onCreated(r.invoice);
    } catch (e) {
      UI.toast((e && e.message) || 'Gagal membuat invoice.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
<div className="modal-backdrop" onMouseDown={(e) => { if (e.target.classList.contains('modal-backdrop')) onClose(); }}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Input Invoice</h2>
              <button className="modal__x" onClick={() => onClose()}>&times;</button>
            </div>
            <div className="modal__body">
              <div className="form-row form-row--2">
                <div className="field">
                  <label className="field__label">Pasien</label>
                  <select value={patientId} onChange={e => pilihPasien(e.target.value)}>
                    <option value="">— Pilih pasien —</option>
                    {(patients || []).map(p => (
                      <option key={p.id} value={p.id}>{p.identity && p.identity.nama ? p.identity.nama : p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label">Kunjungan (opsional)</label>
                  <select value={visitId} onChange={e => pilihKunjungan(e.target.value)} disabled={!selectedPatient}>
                    <option value="">— Tanpa kunjungan —</option>
                    {visitsTerbaru.map(v => (
                      <option key={v.id} value={v.id}>{v.date ? UI.fmtDate(v.date) : v.id}{v.time ? ' ' + v.time : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row form-row--2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label className="field__label">Jenis Layanan</label>
                  <select value={layanan} onChange={e => setLayanan(e.target.value)}>
                    <option value="onsite">Onsite (di klinik)</option>
                    <option value="homecare">Home Care</option>
                  </select>
                </div>
                {layanan === 'onsite' ? (
                  <div className="field">
                    <label className="field__label">Kontrol Selanjutnya</label>
                    <input
                      type="date"
                      value={kontrolTampil}
                      onChange={e => {
                        setKontrol(e.target.value);
                        setRekomendasiInput('');
                      }}
                      title={visitDasar && visitDasar.date
                        ? 'Usulan 7 hari setelah kunjungan ' + UI.fmtDate(visitDasar.date)
                        : 'Usulan 7 hari setelah hari ini'}
                    />
                    <small className="field__hint">
                      {selectedPatient
                        ? 'Usulan otomatis 7 hari setelah kunjungan; ubah bila perlu.'
                        : 'Pilih pasien untuk menghitung kunjungan.'}
                    </small>
                  </div>
                ) : <div />}
              </div>

              {layanan === 'onsite' ? (
                <div className="field" style={{ marginTop: 10 }}>
                  <label className="field__label">Rekomendasi</label>
                  <input
                    type="text"
                    value={rekomendasiTampil}
                    onChange={e => setRekomendasiInput(e.target.value)}
                    placeholder={selectedPatient ? 'Kunjungan ke-… dan kontrol selanjutnya …' : 'Pilih pasien untuk menghitung kunjungan'}
                  />
                </div>
              ) : null}

              {itemsError ? <Callout tone="danger"><strong>Katalog produk</strong>{itemsError} Tidak dapat membuat invoice berbasis produk stok sampai katalog bisa dimuat.</Callout> : null}
              {GROUPS.filter(g => !(g.homecareOnly && layanan !== 'homecare')).map(g => (
                <div className="inv-group" key={g.key}>
                  <div className="inv-group__head">
                    <strong>{g.label}</strong>
                    <button className="btn btn--sm" type="button" onClick={() => addLine(g.key)}>+ Baris</button>
                  </div>
                  {g.inventoryJenis ? null : (
                    <datalist id={`dl-${g.key}`}>
                      {g.contoh.map(c => <option key={c} value={c} />)}
                    </datalist>
                  )}
                  <div className="inv-line inv-line--head" aria-hidden="true">
                    <span>{g.inventoryJenis ? 'Produk / Nama' : 'Nama'}</span><span>Qty</span><span>Harga (Rp)</span><span>Diskon %</span><span></span>
                  </div>
                  {(lines[g.key] || []).map((line, i) => {
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
                            onChange={e => pilihProduk(g, i, e.target.value)}
                          >
                            <option value="">
                              {itemsError
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
                            onChange={e => updateLine(g.key, i, { nama: e.target.value })}
                          />
                        )}
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="1" value={line.qty}
                          aria-label="Qty"
                          onChange={e => ubahQty(g, i, e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="0" placeholder="0" value={hargaBaris}
                          disabled={!!g.inventoryJenis}
                          title={g.inventoryJenis ? 'Harga jual mengikuti produk pada Produk & Stok.' : undefined}
                          onChange={e => updateLine(g.key, i, { harga: e.target.value })} />

                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <input type="number" min="0" max="100" value={line.diskon}
                          aria-label="Diskon persen"
                          onChange={e => updateLine(g.key, i, { diskon: e.target.value })} />
                      </div>
                      <button
                        className="btn btn--sm btn--danger"
                        type="button"
                        onClick={() => removeLine(g.key, i)}
                        disabled={(lines[g.key] || []).length <= 1}
                      >×</button>
                    </div>
                  );
                  })}
                </div>
              ))}

              <div className="form-row form-row--2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label className="field__label">Diskon Tambahan (Rp)</label>
                  <input type="number" min="0" value={diskon} onChange={e => setDiskon(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field__label">Catatan / Keterangan</label>
                  <input
                    type="text"
                    value={catatan}
                    onChange={e => setCatatan(e.target.value)}
                    placeholder="Contoh: Transfer bank BCA an. …"
                  />
                </div>
              </div>

              <div className="inv-recap">
                <div><span>Subtotal</span><b>{rupiah(hitung.kotor)}</b></div>
                <div><span>Diskon baris</span><b>{rupiah(hitung.diskonBaris)}</b></div>
                {Number(diskon) > 0 ? (
                  <div><span>Diskon tambahan</span><b>{rupiah(diskon)}</b></div>
                ) : null}
                <div className="inv-recap__total"><span>Total</span><b>{rupiah(hitung.total)}</b></div>
              </div>
            </div>
            <div className="modal__foot">
              <button className="btn" onClick={() => onClose()} disabled={busy}>Batal</button>
              <button className="btn btn--primary" onClick={simpan} disabled={busy}>
                {busy ? 'Menyimpan…' : 'Buat Invoice'}
              </button>
            </div>
          </div>
        </div>
  );
}
