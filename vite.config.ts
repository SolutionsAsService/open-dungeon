import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = 'http://localhost:' + (process.env.PORT || 8787);
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': target, '/ws': { target: target.replace('http', 'ws'), ws: true } } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
