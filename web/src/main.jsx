import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './styles/app.css';
import { DataProvider, STATUS, useData } from './core/data.jsx';
import App from './App.jsx';

/*
 * Satu gerbang untuk seluruh aplikasi.
 *
 * App HANYA dirender setelah Store.boot() selesai. Kalau dirender lebih
 * awal, PatientPage akan membaca Store yang masih kosong dan menampilkan
 * "Pasien tidak ditemukan" — bahkan ketika URL-nya diketik langsung ke
 * /p/<id>. Menunggu di satu tempat lebih murah daripada_added guard di
 * setiap halaman.
 */
function Gerbang() {
  const { status, error } = useData();

  if (status === STATUS.NEEDS_LOGIN) {
    location.replace('/login.html');
    return null;
  }

  if (status === STATUS.ERROR) {
    return (
      <div className="boot-screen">
        <div className="boot-card boot-card--err">
          <h2>Gagal memuat data</h2>
          <p>{error}</p>
          <div className="btn-group" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn--primary" onClick={() => location.reload()}>Coba Lagi</button>
            <a className="btn" href="/login.html">Kembali ke halaman masuk</a>
          </div>
        </div>
      </div>
    );
  }

  if (status !== STATUS.READY) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          {/* Kelas di app.css adalah `boot-spinner`, bukan `boot-spin`.
              Selisih satu huruf itu membuat elemennya tanpa gaya sama
              sekali — jadi tidak terlihat berputar sama sekali. */}
          <div className="boot-spinner" role="status" aria-label="Memuat data"></div>
          <p>Memuat data rekam medis…</p>
        </div>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <Gerbang />
      </DataProvider>
    </BrowserRouter>
  </StrictMode>
);