/* ============================================================
   ui.js — Helper UI bersama
   ============================================================ */

const UI = (() => {

  /* ---------- DOM ---------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ---------- Escape ---------- */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- Toast ---------- */
  function toast(msg, kind = 'ok', ms = 2600) {
    let root = $('#toast-root');
    if (!root) { root = el('div', { id: 'toast-root' }); document.body.appendChild(root); }
    const t = el('div', { class: `toast toast--${kind}`, text: msg });
    root.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .2s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 220);
    }, ms);
  }

  /* ---------- Modal ---------- */
  let openModals = 0;

  /**
   * modal({ title, body, footer, wide, onMount, onClose })
   * body/footer boleh string HTML atau Node.
   */
  function modal(opts = {}) {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: `modal${opts.wide ? ' modal--wide' : ''}` });

    const head = el('div', { class: 'modal__head' }, [
      el('h2', { text: opts.title || '' })
    ]);
    const closeBtn = el('button', { class: 'modal__x', title: 'Tutup (Esc)', html: '&times;' });
    head.appendChild(closeBtn);

    /** Isi sebuah container: terima string HTML, Node tunggal, atau array keduanya. */
    function fill(container, content) {
      if (content === null || content === undefined || content === false) return;
      if (Array.isArray(content)) { content.forEach(c => fill(container, c)); return; }
      if (typeof content === 'string') {
        // HTML yang memuat tag -> innerHTML, selain itu teks biasa
        if (/<[a-z][\s\S]*>/i.test(content)) container.insertAdjacentHTML('beforeend', content);
        else container.appendChild(document.createTextNode(content));
        return;
      }
      if (content instanceof Node) container.appendChild(content);
    }

    const body = el('div', { class: 'modal__body' });
    fill(body, opts.body);

    box.appendChild(head);
    box.appendChild(body);

    if (opts.footer) {
      const foot = el('div', { class: 'modal__foot' });
      fill(foot, opts.footer);
      box.appendChild(foot);
    }

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    openModals++;

    function close(result) {
      backdrop.remove();
      openModals = Math.max(0, openModals - 1);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose(result);
    }

    function onKey(e) {
      if (e.key === 'Escape' && openModals > 0) close(null);
    }

    closeBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);

    // Fokuskan elemen pertama yang bisa diisi
    const first = box.querySelector('input:not([type=hidden]), select, textarea, button.btn--primary');
    if (first) setTimeout(() => first.focus(), 40);

    if (opts.onMount) opts.onMount(box, close);
    return { root: box, body, close };
  }

  /** Konfirmasi sederhana. resolve(true/false) */
  function confirm(message, { title = 'Konfirmasi', okText = 'Ya, Lanjutkan', danger = true } = {}) {
    return new Promise(resolve => {
      let done = false;
      const m = modal({
        title,
        body: el('p', { text: message, style: 'margin:0' }),
        footer: [
          el('button', { class: 'btn', text: 'Batal', onclick: () => { done = true; m.close(); resolve(false); } }),
          el('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, text: okText,
            onclick: () => { done = true; m.close(); resolve(true); }
          })
        ],
        onClose: () => { if (!done) resolve(false); }
      });
    });
  }

  /* ---------- Tooltip ---------- */
  let tipEl = null;

  function showTip(html, x, y) {
    if (!tipEl) { tipEl = el('div', { class: 'tip' }); document.body.appendChild(tipEl); }
    tipEl.innerHTML = html;
    tipEl.classList.add('is-on');
    positionTip(x, y);
  }

  function positionTip(x, y) {
    if (!tipEl) return;
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tipEl.style.left = Math.max(8, left) + 'px';
    tipEl.style.top  = Math.max(8, top)  + 'px';
  }

  function hideTip() { if (tipEl) tipEl.classList.remove('is-on'); }

  /** Pasang tooltip pada elemen ber-atribut data-tip. */
  function bindTips(root = document) {
    root.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-tip]');
      if (t) showTip(t.dataset.tip, e.clientX, e.clientY);
    });
    root.addEventListener('mousemove', e => {
      if (tipEl && tipEl.classList.contains('is-on')) positionTip(e.clientX, e.clientY);
    });
    root.addEventListener('mouseout', e => {
      if (e.target.closest('[data-tip]')) hideTip();
    });
    root.addEventListener('click', hideTip, true);
  }

  /* ---------- Lightbox foto ---------- */
  function lightbox(src, caption) {
    const wrap = el('div', { class: 'lightbox' });
    const img = el('img', { src, alt: caption || 'Dokumentasi luka' });
    const close = el('button', { class: 'lightbox__close', html: '&times;' });
    const cap = el('div', { class: 'lightbox__cap', text: caption || '' });
    const box = el('div', {}, [img, cap]);

    wrap.appendChild(close);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    function dismiss() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    close.addEventListener('click', dismiss);
    wrap.addEventListener('click', e => { if (e.target === wrap) dismiss(); });
    document.addEventListener('keydown', onKey);
  }

  /* ---------- Format ---------- */
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function fmtDate(iso) {
    if (!iso) return '-';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    if (!y || !m || !d) return iso;
    return `${d} ${BULAN[parseInt(m, 10) - 1]} ${y}`;
  }

  function fmtDateTime(dateIso, timeStr) {
    const d = fmtDate(dateIso);
    return timeStr ? `${d}, ${timeStr}` : d;
  }

  function fmtDateShort(iso) {
    if (!iso) return '-';
    const [, m, d] = String(iso).slice(0, 10).split('-');
    if (!m || !d) return iso;
    return `${d}/${m}`;
  }

  /** Umur dalam tahun dari tanggal lahir. */
  function hitungUmur(tglLahir) {
    if (!tglLahir) return null;
    const b = new Date(tglLahir);
    if (isNaN(b)) return null;
    const now = new Date();
    let y = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) y--;
    return y >= 0 && y < 130 ? y : null;
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2)
      .map(w => w[0]).join('').toUpperCase() || '?';
  }

  /** Gabung label dari array-of-string dengan pembatas. */
  function joinList(arr, sep = ', ', fallback = '-') {
    if (!Array.isArray(arr)) return fallback;
    const f = arr.filter(Boolean);
    return f.length ? f.join(sep) : fallback;
  }

  /** Badge HTML dari tone. */
  function badge(text, tone = 'muted') {
    return `<span class="badge badge--${tone}">${esc(text)}</span>`;
  }

  /* ---------- Unduh berkas ---------- */
  function download(filename, content, mime = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** Pilih berkas -> Promise<text> */
  function pickFile(accept = '.json,application/json') {
    return new Promise(resolve => {
      const input = el('input', { type: 'file', accept, style: 'display:none' });
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { input.remove(); resolve(null); return; }
        const r = new FileReader();
        r.onload = () => { input.remove(); resolve({ name: f.name, text: String(r.result) }); };
        r.onerror = () => { input.remove(); resolve(null); };
        r.readAsText(f);
      });
      input.click();
    });
  }

  /* ---------- Debounce ---------- */
  function debounce(fn, ms = 250) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  return {
    $, $$, el, esc, toast, modal, confirm,
    showTip, hideTip, bindTips, lightbox,
    fmtDate, fmtDateTime, fmtDateShort, hitungUmur, initials, joinList, badge,
    download, pickFile, debounce
  };
})();