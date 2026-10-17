/* Komponen tampilan kecil yang setara dengan helper di ui.js.
 *
 * PENTING: `UI.badge()` mengembalikan STRING HTML, bukan elemen React.
 * Menempelkan string itu langsung di JSX akan menampilkan markup-nya
 * mentah-mentah — persis yang terjadi pada percobaan pertama.
 * Pakai <Badge> di JSX, dan UI.badge() hanya di dalam string HTML.
 */

import { UI } from '../lib/index.js';

export { UI };   // diteruskan agar pemanggil cukup mengimpor dari satu tempat

const TONE = ['ok', 'muted', 'warn', 'danger', 'info', 'primary'];

export function Badge({ tone = 'muted', children }) {
  const t = TONE.includes(tone) ? tone : 'muted';
  return <span className={`badge badge--${t}`}>{children}</span>;
}

/** Kartu dengan kepala bergaya aplikasi. */
export function Card({ title, badge, children, num }) {
  return (
    <div className="card">
      <div className="card__head">
        {num ? <span className="num">{num}</span> : null}
        <h2>{title}</h2>
        {badge || null}
      </div>
      <div className="card__body">{children}</div>
    </div>
  );
}

/** Kotak peringatan. `tone`: '', 'warn', 'danger'. */
export function Callout({ tone = '', children }) {
  const cls = tone ? `callout callout--${tone}` : 'callout';
  return <div className={cls}>{children}</div>;
}

export function EmptyState({ icon, title, children, actions }) {
  return (
    <div className="empty-state">
      {icon ? <span className="empty-state__icon">{icon}</span> : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions}
    </div>
  );
}

/** Titik status kecil untuk baris sinkronisasi & sejenisnya. */
export function Dot({ tone = 'ok' }) {
  return <span className={`dot dot--${tone}`} />;
}