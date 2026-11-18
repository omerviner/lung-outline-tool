import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.BASE || '/', // set to /<repo>/ when served from a GitHub Pages project site
  plugins: [react()],
  build: { target: 'esnext' },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
