import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Server rekam medis tetap di :8080 (server.js + db.js tidak diubah sama sekali).
// Mode dev: Vite di :5173, semua /api diteruskan ke backend.
const BACKEND = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false }
    }
  },

  // Folder build di dalam web/ supaya berkas lama di root tidak tersentuh.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /* Sourcemap TIDAK diaktifkan untuk build produksi.
       Saat aktif ia menambah 1,79 MB ke folder dist — hampir 5x ukuran
       JS-nya sendiri — dan karena ada di dist, Vercel menyajikannya
       PUBLIK, sehingga kode React bisa direkonstruksi siapa saja.
       Untuk build lokal yang perlu debugging, ubah ke true. */
    sourcemap: false
  }
});