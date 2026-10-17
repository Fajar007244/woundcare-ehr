/* Jembatan global — dimuat sebagai <script> klasik, SETELAH 8 modul lain.
 *
 * Modul-modul itu berbentuk `const UI = (() => {...})()`. `const` tingkat atas
 * di classic script masuk ke scope leksikal global, bukan ke objek `window`.
 * Modul ES tidak bisa membacanya sebagai properti.
 *
 * Script ini menutup keduanya: membaca binding leksikal itu, lalu
 * menempelkannya ke window supaya modul ES bisa mengambilnya lewat
 * `window.UI`.
 *
 * Berkas ini tidak boleh diubah dan urutan pemuatannya tidak boleh diacak —
 * ia harus menjadi skrip klasik terakhir sebelum skrip modul apa pun.
 */
window.UI = UI;
window.API = API;
window.Scales = Scales;
window.Store = Store;
window.Photos = Photos;
window.Charts = Charts;
window.APP_LOGO = APP_LOGO;
window.PrintDoc = PrintDoc;