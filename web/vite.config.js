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
    sourcemap: true
  }
});