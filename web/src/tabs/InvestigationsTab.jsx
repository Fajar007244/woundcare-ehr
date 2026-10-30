/* Pemeriksaan penunjang berulang untuk setiap kunjungan. */

import { FieldProvider, Field, useFieldCtx } from '../core/field-binding.jsx';
import { EmptyState } from '../components/ui.jsx';
import { UI } from '../lib/index.js';

export default function InvestigationsTab({ patient, visit }) {
  if (!patient) {
    return <EmptyState title="Pasien tidak ditemukan">Data pasien tidak dapat dimuat.</EmptyState>;
  }
  if (!visit) {
    return <EmptyState title="Belum ada kunjungan">Hasil pemeriksaan dicatat per kunjungan. Tambahkan kunjungan terlebih dahulu.</EmptyState>;
  }

  return (
    <FieldProvider patient={patient} visit={visit}>
      <div id="form-investigations">
        <div className="card">
          <div className="card__head"><span className="num">6</span><h2>Hasil Pemeriksaan Penunjang</h2></div>
          <div className="card__body">
            <p className="field__hint" style={{ marginTop: 0, marginBottom: 16 }}>
              Tambahkan hasil laboratorium dan radiologi sesuai pemeriksaan pada kunjungan ini.
            </p>
            <DaftarPemeriksaan jenis="laboratorium" judul="A. Laboratorium" />
            <DaftarPemeriksaan jenis="radiologi" judul="B. Radiologi" />
          </div>
        </div>
      </div>
    </FieldProvider>
  );
}

function DaftarPemeriksaan({ jenis, judul }) {
  const ctx = useFieldCtx();
  const base = `pemeriksaan.${jenis}`;
  const records = ctx.read(base, 'visit') || {};
  const entries = Object.entries(records)
    .filter(([, entry]) => entry && entry.dihapus !== true)
    .sort(([a], [b]) => a.localeCompare(b));

  async function tambah() {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await ctx.write(`${base}.${id}.dibuat`, new Date().toISOString(), {
      label: `Tambah hasil ${jenis}`,
      before: null,
      scope: 'visit'
    });
  }

  async function hapus(id) {
    const ok = await UI.confirm(`Hapus isian ${jenis} ini?`, { okText: 'Hapus' });
    if (!ok) return;
    await ctx.write(`${base}.${id}.dihapus`, true, {
      label: `Hapus hasil ${jenis}`,
      before: null,
      scope: 'visit'
    });
  }

  return (
    <section className="investigation-section">
      <div className="investigation-section__head">
        <h3>{judul}</h3>
        <button className="btn btn--primary" type="button" disabled={ctx.frozen} onClick={tambah}>+ Tambah Isian</button>
      </div>
      {entries.length ? entries.map(([id]) => (
        <article className="investigation-entry" key={id}>
          <div className="investigation-entry__head">
            <strong>{jenis === 'laboratorium' ? 'Data Laboratorium' : 'Data Radiologi'}</strong>
            <button className="btn" type="button" disabled={ctx.frozen} onClick={() => hapus(id)} aria-label={`Hapus ${judul.toLowerCase()}`}>
              Hapus
            </button>
          </div>
          {jenis === 'laboratorium' ? <LaboratoriumFields id={id} /> : <RadiologiFields id={id} />}
        </article>
      )) : (
        <div className="investigation-empty">Belum ada isian. Pilih “Tambah Isian” untuk mencatat hasil.</div>
      )}
    </section>
  );
}

function LaboratoriumFields({ id }) {
  const root = `pemeriksaan.laboratorium.${id}`;
  return (
    <>
      <div className="form-row form-row--3">
        <Field path={`${root}.tanggal`} label="Tanggal pemeriksaan" type="date" />
        <Field path={`${root}.pemeriksaan`} label="Jenis pemeriksaan" placeholder="Contoh: Darah lengkap" />
        <Field path={`${root}.spesimen`} label="Spesimen" placeholder="Contoh: Darah" />
      </div>
      <div className="form-row form-row--2">
        <Field path={`${root}.hasil`} label="Hasil / nilai" rows={3} placeholder="Nama parameter dan hasil pemeriksaan…" />
        <Field path={`${root}.catatan`} label="Catatan / interpretasi" rows={3} placeholder="Nilai rujukan atau catatan klinis…" />
      </div>
    </>
  );
}

function RadiologiFields({ id }) {
  const root = `pemeriksaan.radiologi.${id}`;
  return (
    <>
      <div className="form-row form-row--3">
        <Field path={`${root}.tanggal`} label="Tanggal pemeriksaan" type="date" />
        <Field path={`${root}.modalitas`} label="Modalitas" placeholder="Contoh: X-ray, USG, CT Scan, MRI" />
        <Field path={`${root}.area`} label="Area pemeriksaan" placeholder="Bagian tubuh / lokasi luka" />
      </div>
      <div className="form-row form-row--2">
        <Field path={`${root}.temuan`} label="Temuan" rows={3} placeholder="Uraikan temuan radiologi…" />
        <Field path={`${root}.kesimpulan`} label="Kesimpulan" rows={3} placeholder="Kesimpulan pemeriksaan…" />
      </div>
    </>
  );
}
