import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = 'http://localhost:' + (process.env.PORT || 8787);
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': target, '/ws': { target: target.replace('http', 'ws'), ws: true } } },
  // `vite preview` behaves like a static host (no API proxy) so local mode can be exercised.
  preview: { proxy: {} },
  // PGlite ships its own WASM/data files; pre-bundling breaks their URLs (local mode, web/src/local).
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500, target: 'es2022' },
});
