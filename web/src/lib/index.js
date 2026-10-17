/* ==========================================================
   Jembatan ke modul klasik
   ==========================================================
   Modul di public/lib/*.js tidak boleh diimpor sebagai ES module.
   Semuanya berbentuk:

       const UI = (() => { ... })();

   `const` di classic <script> masuk ke scope leksikal global sehingga
   berkas berikutnya bisa-reaching-nya. Tapi `const` di ES module hanya
   hidup di modul itu sendiri — diimpor, ketujuh modul tidak saling
   melihat dan hasilnya "UI is not defined".

   Karena itu file-nya dimuat sebagai <script> klasik di index.html,
   persis seperti di aplikasi lama, dan TIDAK diubah satu byte pun.
   public/lib/globals.js kemudian menempelkannya ke window, dan modul
   di bawah membacanya dari sana.

   Modul di bawah dievaluasi setelah semua script klasik (script module
   secara bawaan bersifat deferred), sehingga window.* sudah siap.
   ========================================================== */

function pick(name) {
  const v = window[name];
  if (v === undefined) {
    throw new Error(
      `Modul klasik "${name}" belum termuat. Cek urutan <script> di web/index.html — ` +
      `public/lib/globals.js harus berada setelah seluruh modul.`
    );
  }
  return v;
}

export const UI = pick('UI');
export const API = pick('API');
export const Scales = pick('Scales');
export const Store = pick('Store');
export const Photos = pick('Photos');
export const Charts = pick('Charts');
export const APP_LOGO = pick('APP_LOGO');
export const PrintDoc = pick('PrintDoc');