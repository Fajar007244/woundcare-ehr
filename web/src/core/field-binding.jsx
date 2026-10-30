/* ==========================================================
   Lapisan binding form  →  ke React
   ==========================================================
   INI KONTRAK YANG DIPAKAI SELURUH TAB.

   app.js yang lama MEMBEDAKAN DUA SCOPE lewat atribut berbeda:

       data-bind="identity.nama"   → kolom PASIEN
       data-vbind="wound.lokasi"  → kolom KUNJUNGAN

   dan efeknya berbeda total:

       kolom pasien   → Store.touch(patient)          (tanpa audit)
       kolom kunjungan→ appendAudit + touchVisit + syncAudit

   Percobaan pertama menyatukan keduanya dengan `visit || patient`.
   Akibatnya begitu kunjungan aktif ada, SEMUA kolom identity.* jadi undefined
   dan penulisan mendarat di objek kunjungan — data pasien kosong total.
   Scope dipulihkan di sini lewat inferensi awalan path, dengan
   `scope` eksplisit sebagai pengganti bila perlu.

   INFERENSI SCOPE (awalan path):
       identity.*  mrNumber            → patient
       wound.*  winner.*  cppt.*  pemeriksaan.*  photos.*  date  time  dressing.*  frozen  → visit
   Sisanya default ke patient; apa pun bisa di-override dengan prop `scope`.
   ========================================================== */

import { createContext, useCallback, useContext, useRef } from 'react';
import { Store, UI } from '../lib/index.js';
import { markSaved } from './save-signal.jsx';

/* ---------- util path (identik dengan app.js) ---------- */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o === null || o === undefined) ? undefined : o[k], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let ref = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (ref[keys[i]] === null || ref[keys[i]] === undefined || typeof ref[keys[i]] !== 'object') {
      ref[keys[i]] = {};
    }
    ref = ref[keys[i]];
  }
  ref[keys[keys.length - 1]] = value;
}

const VISIT_PREFIX = ['wound', 'winner', 'cppt', 'pemeriksaan', 'photos', 'dressing', 'date', 'time', 'frozen', 'keluhan', 'perawat'];

/** Tentukan scope dari path; `explicit` menang kalau diberikan. */
export function scopeOf(path, explicit) {
  if (explicit) return explicit;
  const akar = String(path).split('.')[0];
  return VISIT_PREFIX.indexOf(akar) >= 0 ? 'visit' : 'patient';
}

/* ---------- kolom berisiko: daftar tunggal, dipindahkan apa adanya ---------- */

const RISKY = [
  { test: p => p === 'date',                              why: 'tanggal kunjungan menentukan urutan kronologis' },
  { test: p => /^winner\.scores\./.test(p),                why: 'menentukan skor total WINNER' },
  { test: p => /^wound\.ukuran\./.test(p),                 why: 'menentukan luas & kedalaman luka' },
  { test: p => /^wound\.jaringan\./.test(p),               why: 'menentukan proporsi jaringan dasar luka' }
];

export function riskyReason(p) {
  const r = RISKY.find(x => x.test(p));
  return r ? r.why : null;
}

/* ---------- konteks ---------- */

const FieldCtx = createContext(null);
export const useFieldCtx = () => useContext(FieldCtx);

function isPastDate(iso) {
  if (!iso) return false;
  const s = String(iso);
  const d = new Date(s.length <= 10 ? s + 'T23:59:59' : s);
  return !isNaN(d) && d.getTime() < Date.now();
}

/**
 * Pembungkus satu tab formulir.
 * `patient` boleh null (kunjungan terpisah), `visit` boleh null (tab identitas).
 */
export function FieldProvider({ patient, visit, onDerived, onSaved, children }) {
  const warnedNoUser = useRef(false);
  const frozen = !!(visit && visit.frozen);

  /** Baca nilai model pada scope yang benar. */
  function read(path, explicit) {
    const s = scopeOf(path, explicit);
    const src = s === 'visit' ? visit : patient;
    return src ? getPath(src, path) : undefined;
  }

  function mark() { markSaved(); if (onSaved) onSaved(); }

  /** Kolom pasien: disimpan ke tabel patients, TANPA jejak audit. */
  function savePatientColumn(changed) {
    if (changed) Store.touch(patient);
    mark();
  }

  /** Kolom kunjungan: catat audit, lalu kirim ke tabel visits. */
  function recordChange(path, label, before, after) {
    if (!visit || !patient) { savePatientColumn(true); return; }
    const who = Store.currentUserName();
    Store.appendAudit(patient.id, visit.id, {
      key: path,
      label,
      before: before === null || before === undefined ? '' : String(before),
      after: after === null || after === undefined ? '' : String(after),
      risky: !!riskyReason(path),
      oleh: who || 'Tanpa nama'
    });
    Store.touchVisit(patient.id, visit.id);      // isi kunjungan
    Store.syncAudit(patient.id, visit.id, true); // jejak audit ke audit_log
    mark();

    if (!who && !warnedNoUser.current) {
      warnedNoUser.current = true;
      UI.toast('Perubahan tercatat sebagai "Tanpa nama" — masuk sebagai petugas agar jejaknya jelas', 'warn', 4200);
    }
  }

  function askRisky(label, before, after, why) {
    const lama = (before === null || before === undefined || before === '') ? '(kosong)' : before;
    const baru = (after === null || after === undefined || after === '') ? '(kosong)' : after;
    return UI.confirm(
      `Kolom berisiko diubah pada kunjungan yang sudah lewat.\n\n` +
      `${label}\n${lama}  →  ${baru}\n\n` +
      `Alasan: ${why}.` +
      `\n\nPerubahan tetap akan tercatat atas nama ${Store.currentUserName() || 'Tanpa nama'}.`,
      { title: 'Konfirmasi Perubahan Berisiko', okText: 'Ya, Ubah', danger: false }
    );
  }

  /**
   * SATU-SATUNYA jalan untuk menulis nilai ke model.
   * Komponen field tidak boleh memanggil setPath langsung — nanti auditnya hilang.
   *
   * mode 'set'    → next = nilai baru, ditulis apa adanya ke path
   * mode 'toggle' → next diabaikan; `raw` ditambah/dilepas dari array di path
   * mode 'number' → next dikonversi ke Number (dikosongkan jadi '')
   */
  async function write(path, next, { label = path, mode = 'set', raw, before, scope } = {}) {
    const s = scopeOf(path, scope);
    const target = s === 'visit' ? visit : patient;
    if (!target) return false;

    // Bekuan hanya berlaku pada kolom kunjungan — sama seperti app.js lama.
    if (s === 'visit' && frozen) {
      UI.toast('Kunjungan ini dibekuan. Buka bekuan dulu untuk mengubah.', 'warn');
      return false;
    }

    const b = before === undefined ? null : before;
    let after;

    if (mode === 'toggle') {
      const arr = Array.isArray(getPath(target, path)) ? getPath(target, path).slice() : [];
      const i = arr.indexOf(raw);
      if (i >= 0) arr.splice(i, 1); else arr.push(raw);
      after = arr;
    } else if (mode === 'number') {
      after = next === '' ? '' : Number(next);
    } else {
      after = next === '' ? null : next;
    }

    const berubah = String(b === null || b === undefined ? '' : b)
                 !== String(after === null || after === undefined ? '' : after);

    // Konfirmasi selektif: kolom berisiko, kunjungan yang sudah lewat.
    const why = riskyReason(path);
    if (berubah && why && s === 'visit' && visit && isPastDate(visit.date)) {
      const shown = mode === 'toggle' ? raw : after;
      const ok = await askRisky(label, b, shown, why);
      if (!ok) return false;   // model tidak disentuh sama sekali
    }

    setPath(target, path, after);

    if (s === 'visit') {
      if (berubah) recordChange(path, label, b, after);
      else { Store.touchVisit(patient.id, visit.id); mark(); }
    } else {
      savePatientColumn(berubah);
    }

    if (berubah && onDerived) onDerived(path);
    return true;
  }

  return (
    <FieldCtx.Provider value={{ patient, visit, frozen, read, write, scopeOf }}>
      {children}
    </FieldCtx.Provider>
  );
}

/* ==========================================================
   Hook dasar
   ========================================================== */

/**
 * Mengikat satu kontrol ke model, lengkap dengan baseline-nya sendiri.
 *
 * @returns { value, change, disabled }
 */
export function useBound(path, label, opts = {}) {
  const { mode = 'set', scope } = opts;
  const ctx = useContext(FieldCtx);
  const value = ctx.read(path, scope);
  const base = useRef(
    (value === '' || value === null || value === undefined) ? null : value
  );

  const change = useCallback(async (next) => {
    const ok = await ctx.write(path, next, { label, mode, raw: opts.raw, before: base.current, scope });
    if (ok) base.current = (next === '' || next === null || next === undefined) ? null : next;
    return ok;
  }, [ctx, path, label, mode, opts.raw, scope]);

  return { value, change, disabled: ctx.frozen && ctx.scopeOf(path, scope) === 'visit' };
}

/* ==========================================================
   Komponen field
   ==========================================================
   Markup memakai kelas yang SUDAH ADA di app.css (`.chips`, `.chip`,
   `.chip__dot`, `.field`, `.form-row--N`), bukan kelas baru. Dengan
   begitu style.css bisa disalin utuh tanpa satu baris pun diubah.
   ========================================================== */

/** Terima opsi berupa string biasa atau {v, t}. */
export function normOptions(options) {
  return (options || []).map(o =>
    (o && typeof o === 'object') ? { v: o.v, t: o.t } : { v: String(o), t: String(o) }
  );
}

/** Kolom teks / angka / tanggal / waktu / pilihan / area teks. */
export function Field(props) {
  const { path, label, type = 'text', options = null, placeholder = '', hint = '',
          required = false, rows, min, max, step, scope } = props;
  const { value, change, disabled } = useBound(path, label, {
    mode: type === 'number' ? 'number' : 'set', scope
  });
  const v = value === null || value === undefined ? '' : value;

  return (
    <div className="field">
      <label className="field__label" htmlFor={`f-${path}`}>{label}{required ? ' *' : ''}</label>
      {options ? (
        <select id={`f-${path}`} value={v} disabled={disabled} onChange={e => change(e.target.value)}>
          {normOptions(options).map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select>
      ) : rows ? (
        <textarea id={`f-${path}`} rows={rows} placeholder={placeholder} disabled={disabled}
                  value={v} onChange={e => change(e.target.value)} />
      ) : (
        <input id={`f-${path}`} type={type} value={v} placeholder={placeholder}
               disabled={disabled} min={min} max={max} step={step}
               onChange={e => change(e.target.value)} />
      )}
      {hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

/** Satu chip centang tunggal yang menulis boolean ke path. */
export function Check({ path, label, scope }) {
  const { value, change, disabled } = useBound(path, label, { scope });
  return (
    <label className="chip">
      <input type="checkbox" checked={!!value} disabled={disabled} onChange={e => change(!!e.target.checked)} />
      <span className="chip__dot"></span>
      <span>{label}</span>
    </label>
  );
}

/**
 * Kelompok chip.
 * kind='checkbox' → menambah/melepas nilai dari array di path
 * kind='radio'    → menimpa satu nilai skalar di path
 */
export function ChipGroup({ path, label, options, kind = 'checkbox', hint = '', disabled: forceDisabled, scope }) {
  const ctx = useContext(FieldCtx);
  const opts = normOptions(options);
  const name = `g-${String(path).replace(/\W/g, '_')}`;
  const dis = forceDisabled || (ctx.frozen && ctx.scopeOf(path, scope) === 'visit');

  return (
    <fieldset className="field">
      <legend className="field__label">{label}</legend>
      <div className="chips">
        {opts.map(o => (kind === 'radio'
          ? <RadioChip key={o.v} path={path} raw={o.v} text={o.t} name={name} disabled={dis} label={label} scope={scope} />
          : <CheckChip key={o.v} path={path} raw={o.v} text={o.t} name={name} disabled={dis} label={`${label}: ${o.t}`} scope={scope} />
        ))}
      </div>
      {hint ? <div className="field__hint" style={{ marginTop: 6 }}>{hint}</div> : null}
    </fieldset>
  );
}

function CheckChip({ path, raw, text, name, disabled, label, scope }) {
  const ctx = useContext(FieldCtx);
  const arr = Array.isArray(ctx.read(path, scope)) ? ctx.read(path, scope) : [];
  const checked = arr.indexOf(raw) >= 0;
  // Baseline chip ini: nilai chip bila tercentang, selain itu null.
  const base = useRef(checked ? raw : null);

  return (
    <label className="chip">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={async () => {
          const ok = await ctx.write(path, null, { label, mode: 'toggle', raw, before: base.current, scope });
          const now = ctx.read(path, scope);
          if (ok) base.current = (Array.isArray(now) && now.indexOf(raw) >= 0) ? raw : null;
        }}
      />
      <span className="chip__dot"></span>
      <span>{text}</span>
    </label>
  );
}

function RadioChip({ path, raw, text, name, disabled, label, scope }) {
  const ctx = useContext(FieldCtx);
  const v = ctx.read(path, scope);
  const checked = String(v === null || v === undefined ? '' : v) === String(raw);
  const base = useRef(checked ? raw : null);

  return (
    <label className="chip">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={async () => {
          const ok = await ctx.write(path, raw, { label, before: base.current, scope });
          if (ok) base.current = raw;
        }}
      />
      <span className="chip__dot"></span>
      <span>{text}</span>
    </label>
  );
}

/** Baris pengelompokan kolom; `n` = 2..5, sesuai .form-row--N di app.css. */
export function Row({ n = 2, children }) {
  return <div className={`form-row form-row--${n}`}>{children}</div>;
}