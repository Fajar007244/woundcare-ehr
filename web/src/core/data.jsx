/* ==========================================================
   Konteks data — jembatan antara Store (vanilla) dan React
   ==========================================================
   Store sudah punya mekanisme notify()/onChange(). Di sini
   subscribe-nya dibungkus jadi re-render, jadi komponen React
   otomatis mengikuti saat data berubah.

   Store TIDAK diubah sama sekali.
   ========================================================== */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Store } from '../lib/index.js';

const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

/** Status application's life-cycle. */
export const STATUS = {
  BOOTING: 'booting',
  NEEDS_LOGIN: 'needs-login',
  READY: 'ready',
  ERROR: 'error'
};

export function DataProvider({ children }) {
  const [status, setStatus] = useState(STATUS.BOOTING);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    let batal = false;

    Store.onChange(() => {
      if (!batal) setVersion(v => v + 1);
    });

    Store.boot()
      .then(() => { if (!batal) { setStatus(STATUS.READY); setUnsynced(Store.unsyncedCount()); } })
      .catch(e => {
        if (batal) return;
        // 401 berarti sesi tidak sah — kembalikan ke halaman masuk.
        if (e && (e.status === 401 || /Belum masuk/i.test(e.message || ''))) {
          setStatus(STATUS.NEEDS_LOGIN);
        } else {
          setError(e && e.message ? e.message : String(e));
          setStatus(STATUS.ERROR);
        }
      });

    return () => { batal = true; };
  }, []);

  // Antrean sinkronisasi: tandanya sering muncul sendiri.
  useEffect(() => {
    const t = setInterval(() => setUnsynced(Store.unsyncedCount()), 2000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo(() => {
    const patients = Store.activePatients();
    return {
      status, error, unsynced,
      user: Store.user,
      clinic: Store.clinic,
      patients,
      search: (q) => Store.search(q),
      getPatient: (id) => Store.getPatient(id),
      logout: async () => { await Store.logout(); location.replace('/login.html'); }
    };
  }, [status, error, unsynced, version]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

/** Pasien + kunjungan yang sedang dibuka. */
export function usePatient(patientId, visitId) {
  const data = useData();
  const patient = patientId ? data.getPatient(patientId) : null;
  const visit = patient && visitId
    ? patient.visits.find(v => v.id === visitId) || null
    : null;
  return { patient, visit, data };
}