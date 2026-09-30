import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA de SkiTrip v2. El Worker (wrangler.jsonc) sirve `dist` como estáticos y /api/*.
// En desarrollo, Vite (5173) reenvía /api a `wrangler dev` (8787).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Sin data: URIs para scripts/estilos: la CSP de producción no permite inline.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  preview: { port: 4173 },
});
