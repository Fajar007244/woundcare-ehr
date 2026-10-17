/* ============================================================
   login.js — Halaman masuk
   ============================================================ */

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const form = $('#login-form');
  const errBox = $('#login-error');
  const btn = $('#login-submit');
  const userIn = $('#username');
  const passIn = $('#password');
  const pwToggle = $('#pw-toggle');

  if (location.protocol === 'file:') {
    errBox.hidden = false;
    errBox.textContent =
      'Halaman ini harus dibuka lewat server. Jalankan: node server.js — lalu buka http://localhost:8080';
    btn.disabled = true;
    $('#login-hint').hidden = true;
    return;
  }

  function showError(msg) {
    errBox.hidden = false;
    errBox.textContent = msg;
  }
  function clearError() { errBox.hidden = true; errBox.textContent = ''; }

  /* Kalau sudah punya sesi, langsung ke aplikasi */
  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && d.user) location.replace('/index.html'); })
    .catch(() => {});

  /* Tampilkan sandi */
  pwToggle.addEventListener('click', () => {
    const show = passIn.type === 'password';
    passIn.type = show ? 'text' : 'password';
    pwToggle.textContent = show ? '🙈' : '👁';
    pwToggle.setAttribute('aria-label', show ? 'Sembunyikan sandi' : 'Tampilkan sandi');
    passIn.focus();
  });

  /* Isi otomatis dari daftar akun percobaan */
  document.querySelectorAll('.cred').forEach(b => {
    b.addEventListener('click', () => {
      userIn.value = b.dataset.u;
      passIn.value = b.dataset.p;
      clearError();
      passIn.focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const username = userIn.value.trim();
    const password = passIn.value;

    if (!username || !password) {
      showError('Username dan sandi wajib diisi.');
      (username ? passIn : userIn).focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Memeriksa…';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(data.error || 'Gagal masuk.');
        passIn.select();
        return;
      }
      location.replace('/index.html');
    } catch (e) {
      showError('Tidak dapat menghubungi server. Pastikan `node server.js` masih berjalan.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });

  userIn.focus();
})();
