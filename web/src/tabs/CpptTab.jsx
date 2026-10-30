/* Catatan CPPT (SOAP-TIME) untuk kunjungan aktif. */

import { FieldProvider, Field, ChipGroup } from '../core/field-binding.jsx';
import { EmptyState } from '../components/ui.jsx';

const DIAGNOSIS = [
  'Gangguan integritas kulit/jaringan (D.0129)',
  'Nyeri akut (D.0077)',
  'Risiko infeksi (D.0142)'
];

export default function CpptTab({ patient, visit }) {
  if (!patient) {
    return <EmptyState title="Pasien tidak ditemukan">Data pasien tidak dapat dimuat.</EmptyState>;
  }
  if (!visit) {
    return <EmptyState title="Belum ada kunjungan">Catatan CPPT dibuat untuk setiap kunjungan. Tambahkan kunjungan terlebih dahulu.</EmptyState>;
  }

  return (
    <FieldProvider patient={patient} visit={visit}>
      <div id="form-cppt">
        <div className="card">
          <div className="card__head"><span className="num">7</span><h2>Catatan Perkembangan Pasien Terintegrasi (CPPT)</h2></div>
          <div className="card__body">
            <p className="field__hint" style={{ marginTop: 0, marginBottom: 16 }}>
              Catat perkembangan klinis pasien pada kunjungan ini. Perubahan tersimpan otomatis dan tercatat di audit kunjungan.
            </p>

            <section className="cppt-section">
              <h3><span>S</span> Subjective — Holistic Assessment</h3>
              <Field path="cppt.subjective" label="Keluhan dan hasil pengkajian holistik" rows={4} placeholder="Keluhan pasien, riwayat, kondisi psikososial, spiritual, dan kebutuhan pasien…" />
            </section>

            <section className="cppt-section">
              <h3><span>O</span> Objective — Wound Assessment</h3>
              <Field path="cppt.objective" label="Temuan objektif pengkajian luka" rows={4} placeholder="Kondisi luka, ukuran, jaringan, eksudat, kulit sekitar, tanda vital, dan temuan pemeriksaan…" />
              <p className="field__hint" style={{ marginTop: 8 }}>Hasil laboratorium dan radiologi dicatat pada tab Pemeriksaan Penunjang.</p>
            </section>

            <section className="cppt-section">
              <h3><span>A</span> Assessment — Diagnosis Keperawatan</h3>
              <ChipGroup path="cppt.diagnoses" label="Pilih diagnosis keperawatan" options={DIAGNOSIS} />
              <div style={{ marginTop: 12 }}>
                <Field path="cppt.diagnosisTambahan" label="Diagnosis tambahan" rows={2} placeholder="Tuliskan diagnosis keperawatan tambahan…" />
              </div>
            </section>

            <section className="cppt-section">
              <h3><span>P</span> Planning — Rencana</h3>
              <Field path="cppt.planning" label="Rencana tindakan dan evaluasi" rows={3} placeholder="Rencana perawatan, edukasi, kolaborasi, dan evaluasi…" />
            </section>

            <section className="cppt-section cppt-section--time">
              <h3><span>T</span> Tissue Management</h3>
              <Field path="cppt.tissueManagement" label="Manajemen jaringan" rows={3} placeholder="Tuliskan tindakan manajemen jaringan…" />
            </section>

            <section className="cppt-section cppt-section--time">
              <h3><span>I</span> Inflammation / Infection Control</h3>
              <Field path="cppt.infectionControl" label="Kontrol inflamasi / infeksi" rows={3} placeholder="Tuliskan tindakan pengendalian inflamasi dan infeksi…" />
            </section>

            <section className="cppt-section cppt-section--time">
              <h3><span>M</span> Moisture Balance</h3>
              <Field path="cppt.moistureBalance" label="Keseimbangan kelembapan" rows={3} placeholder="Tuliskan rencana menjaga kelembapan luka…" />
            </section>

            <section className="cppt-section cppt-section--time">
              <h3><span>E</span> Epithelial Edge</h3>
              <Field path="cppt.epithelialEdge" label="Tepi epitelisasi" rows={3} placeholder="Tuliskan kondisi tepi luka dan tindakan mendukung epitelisasi…" />
            </section>
          </div>
        </div>
      </div>
    </FieldProvider>
  );
}
