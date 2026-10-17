/* ==========================================================
   TAB 2 — INFORMED CONSENT
   ----------------------------------------------------------
   Porting dari viewConsent() + refreshers.consent() + wire()
   di assets/js/app.js (baris 1932-2014 & 3013-3041).

   PENTING: kolom formulir persetujuan di app.js lama memakai
   atribut `data-tmp="1"` — artinya TIDAK terikat ke model, isinya
   baru disimpan ke Store saat tombol "Simpan Persetujuan" ditekan.
   Karena itu di sini isinya hidup di state lokal komponen, bukan
   lewat Field/ChipGroup.

   Yang terikat ke Store:
   • tambah berkas  → Store.addConsent()
   • hapus berkas   → Store.removeConsent()
   keduanya sudah memanggil notify() sendiri, jadi tabel di
   bawah otomatis me-render ulang.
   ========================================================== */

import { useState } from 'react';

import { FieldProvider, Row } from '../core/field-binding.jsx';
import { Store, UI } from '../lib/index.js';
import { Badge, Callout, EmptyState } from '../components/ui.jsx';

/* ---------- Opsi klinis: salinan OPT.hubungan di app.js lama ---------- */

const HUBUNGAN = ['Diri Sendiri', 'Suami / Istri', 'Anak', 'Orang Tua', 'Saudara', 'Lainnya'];

const KEPUTUSAN = ['SETUJU', 'TIDAK SETUJU'];

/** selectField() di app.js lama selalu diawali pilihan kosong. */
function pilihan(options) {
  return [{ v: '', t: '— Pilih —' }].concat(options.map(o => ({ v: o, t: o })));
}

/** Sama dengan isAdmin() di app.js lama. */
function isAdmin() {
  return !!(Store.user && Store.user.peran === 'Admin');
}

/* ---------- Isi form ---------- */

/**
 * Nilai awal form — persis refreshers.consent() di app.js lama:
 * nama diisi dari persetujuan terakhir (atau nama pasien),
 * tanggal/waktu diisi hari ini, dan "SETUJU" tercentang.
 */
function draftAwal(patient) {
  const terbaru = (patient && patient.consents && patient.consents[0]) || null;
  return {
    nama: terbaru ? terbaru.nama : ((patient && patient.identity && patient.identity.nama) || ''),
    hub: terbaru ? terbaru.hubungan : '',
    kep: 'SETUJU',
    date: Store.today(),
    time: Store.nowTime(),
    ttp: '',
    ttn: '',
    cat: ''
  };
}

/* ---------- Kartu 2 — formulir ---------- */

function KartuFormulir({ draft, set, onSimpan, onBersihkan }) {
  return (
    <div className="card">
      <div className="card__head">
        <span className="num">2</span>
        <h2>Formulir Persetujuan Tindakan (Informed Consent)</h2>
      </div>
      <div className="card__body">

        <Callout>
          <strong>Teks Persetujuan</strong>
          Saya yang bertanda tangan di bawah ini menyatakan <b>SETUJU / TIDAK SETUJU</b> untuk dilakukan tindakan perawatan luka modern,
          dokumentasi foto luka, serta prosedur medis pendukung lainnya, setelah menerima penjelasan mengenai
          <b> tujuan, risiko, dan estimasi biaya</b> treatable.
        </Callout>

        <div style={{ marginTop: 16 }}>
          <Row n={3}>
            <div className="field">
              <label className="field__label" htmlFor="c-nama">Nama Pasien / Penanggung Jawab</label>
              <input id="c-nama" type="text" value={draft.nama} onChange={e => set('nama', e.target.value)} />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="c-hub">Hubungan dengan Pasien</label>
              <select id="c-hub" value={draft.hub} onChange={e => set('hub', e.target.value)}>
                {pilihan(HUBUNGAN).map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
              </select>
            </div>

            <fieldset className="field">
              <legend className="field__label">Keputusan</legend>
              <div className="chips">
                {KEPUTUSAN.map(k => (
                  <label className="chip" key={k}>
                    <input
                      type="radio"
                      name="c_kep"
                      checked={draft.kep === k}
                      onChange={() => set('kep', k)}
                    />
                    <span className="chip__dot"></span>
                    <span>{k}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Row>
        </div>

        <Row n={4}>
          <div className="field">
            <label className="field__label" htmlFor="c-date">Tanggal</label>
            <input id="c-date" type="date" value={draft.date} onChange={e => set('date', e.target.value)} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="c-time">Waktu</label>
            <input id="c-time" type="time" value={draft.time} onChange={e => set('time', e.target.value)} />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="c-ttp">Tanda Tangan Pasien / Wali</label>
            <input id="c-ttp" type="text" value={draft.ttp} onChange={e => set('ttp', e.target.value)} />
            <div className="field__hint">Nama tertulis di atas garis tanda tangan</div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="c-ttn">Tanda Tangan Perawat</label>
            <input
              id="c-ttn"
              type="text"
              placeholder="Ns. Nama, S.Kep"
              value={draft.ttn}
              onChange={e => set('ttn', e.target.value)}
            />
          </div>
        </Row>

        <div className="field">
          <label className="field__label" htmlFor="c-cat">Catatan / Penjelasan Tambahan</label>
          <input id="c-cat" type="text" value={draft.cat} onChange={e => set('cat', e.target.value)} />
        </div>

        <div className="btn-group" style={{ marginTop: 16 }}>
          <button className="btn btn--primary" id="btn-save-consent" onClick={onSimpan}>Simpan Persetujuan</button>
          <button className="btn" id="btn-clear-consent" onClick={onBersihkan}>Bersihkan Form</button>
        </div>

      </div>
    </div>
  );
}

/* ---------- Kartu — riwayat persetujuan ---------- */

function KartuRiwayat({ consents, onHapus }) {
  const admin = isAdmin();

  return (
    <div className="card">
      <div className="card__head">
        <h2>Riwayat Persetujuan</h2>
        <Badge tone="muted">{consents.length} berkas</Badge>
      </div>
      <div className="card__body card__body--flush">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Keputusan</th>
                <th>Nama / Hubungan</th>
                <th>Waktu</th>
                <th>Tanda Tangan</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {consents.length ? consents.map(c => (
                <tr key={c.id}>
                  <td>
                    <strong><Badge tone={c.keputusan === 'SETUJU' ? 'ok' : 'danger'}>{c.keputusan}</Badge></strong>
                    <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 3 }}>{c.catatan || ''}</div>
                  </td>
                  <td>
                    {c.nama || '-'}
                    <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>{c.hubungan || '-'}</div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{UI.fmtDateTime(c.date, c.time)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {c.tandaTanganPasien || '(kertas)'}
                    <div style={{ color: 'var(--c-text-muted)' }}>{c.tandaTanganPerawat || '-'}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      {admin ? (
                        <button
                          className="btn btn--sm btn--ghost"
                          title="Hapus berkas persetujuan"
                          onClick={() => onHapus(c)}
                        >🗑</button>
                      ) : (
                        <span style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>
                    <EmptyState icon="✍️" title="Belum ada persetujuan">
                      Tindakan perawatan luka modern, dokumentasi foto, dan prosedur medis pendukung
                      memerlukan persetujuan tertulis.
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================
   Tab
   ========================================================== */

export default function ConsentTab({ patient, visit }) {
  const [draft, setDraft] = useState(() => draftAwal(patient));

  function set(kunci, nilai) {
    setDraft(d => Object.assign({}, d, { [kunci]: nilai }));
  }

  if (!patient) {
    return (
      <div className="empty-state">
        <h3>Pasien tidak ditemukan</h3>
        <p>Riwayat persetujuan tidak dapat dimuat.</p>
      </div>
    );
  }

  /* btn-save-consent */
  function simpan() {
    const nama = draft.nama.trim();
    if (!nama) {
      UI.toast('Nama penanggung jawab persetujuan wajib diisi', 'danger');
      return;
    }

    const tersimpan = Store.addConsent(patient.id, {
      nama,
      hubungan: draft.hub.trim(),
      keputusan: draft.kep || 'SETUJU',
      date: draft.date.trim() || Store.today(),
      time: draft.time.trim() || Store.nowTime(),
      tandaTanganPasien: draft.ttp.trim(),
      tandaTanganPerawat: draft.ttn.trim(),
      catatan: draft.cat
    });

    if (!tersimpan) {
      UI.toast('Gagal menyimpan persetujuan', 'danger');
      return;
    }

    UI.toast('Persetujuan tersimpan', 'ok');

    // renderTabBody() + refreshers.consent() di app.js lama:
    // form terisi ulang dengan nilai defaults (dan nama berkas baru).
    setDraft(draftAwal(patient));
  }

  /* btn-clear-consent */
  function bersihkan() {
    setDraft(draftAwal(patient));
    UI.toast('Form dibersihkan', 'muted', 1600);
  }

  /* data-del-consent */
  async function hapus(c) {
    const ok = await UI.confirm('Hapus berkas persetujuan ini?', { okText: 'Hapus' });
    if (ok) Store.removeConsent(patient.id, c.id);
  }

  return (
    /* Tidak ada satu pun kontrol di tab ini yang terikat ke model — kolom
     * persetujuan di app.js lama semuanya data-tmp, bukan data-bind.
     * FieldProvider hanya dibungkus karena itu kontrak setiap tab; isinya
     * disimpan lewat Store.addConsent() di tombol Simpan. */
    <FieldProvider patient={patient} visit={visit}>
      <div id="form-consent">
        <KartuFormulir
          draft={draft}
          set={set}
          onSimpan={simpan}
          onBersihkan={bersihkan}
        />

        <KartuRiwayat consents={patient.consents} onHapus={hapus} />
      </div>
    </FieldProvider>
  );
}