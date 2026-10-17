/* Sinyal "tersimpan" — indikator di patient-bar harus menyala dari tab
   mana pun, jadi ia tidak bisa berupa state lokal komponen. Pola publish/
   subscribe kecil, mirip cara Store.notify() bekerja. */

import { useEffect, useState } from 'react';

const pendengar = [];
let n = 0;

export function markSaved() {
  n += 1;
  pendengar.forEach(fn => { try { fn(n); } catch (e) { console.error(e); } });
}

export function subscribeSaved(fn) {
  pendengar.push(fn);
  return () => {
    const i = pendengar.indexOf(fn);
    if (i >= 0) pendengar.splice(i, 1);
  };
}

/** Indikator "Tersimpan otomatis" / "Siap". Pasang SATU kali di pemilih kunjungan. */
export function SaveState({ style }) {
  const [n, setN] = useState(0);

  useEffect(() => subscribeSaved(setN), []);

  useEffect(() => {
    if (!n) return undefined;
    const t = setTimeout(() => setN(0), 2200);
    return () => clearTimeout(t);
  }, [n]);

  if (!n) {
    return (
      <div id="save-state" className="save-state" style={style}>
        <span className="dot dot--muted"></span> Siap
      </div>
    );
  }
  return (
    <div id="save-state" className="save-state" style={style}>
      <span className="dot dot--ok"></span> Tersimpan otomatis
    </div>
  );
}