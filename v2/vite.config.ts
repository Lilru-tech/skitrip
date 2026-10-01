import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { parseApiOrigin } from './src/web/api-origin';

// SPA de SkiTrip v2.
// - Desarrollo y E2E: base «/», Vite (5173) reenvía /api a `wrangler dev` (8787) y Auth usa el emulador.
// - Publicación en GitHub Pages (SKITRIP_TARGET=pages): base «/skitrip/», API en otro origen (VITE_API_BASE_URL),
//   Firebase real y CSP en <meta> (Pages no permite cabeceras propias). El build falla si falta configuración.
const FIREBASE_CONNECT = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];

function pagesCsp(apiOrigin: string, extraConnect: string[]): Plugin {
  // Lo que una CSP en <meta> puede aplicar. frame-ancestors, report-uri y sandbox se ignoran en <meta> (ver DEPLOY.md).
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    `connect-src ${[apiOrigin, ...FIREBASE_CONNECT, ...extraConnect].join(' ')}`, "frame-src 'none'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "manifest-src 'self'", "worker-src 'self'",
  ].join('; ');
  return {
    name: 'skitrip-pages-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, import.meta.dirname, ''), ...process.env };
  const pages = env.SKITRIP_TARGET === 'pages';
  // Variante de prueba del build de Pages (E2E): misma base /skitrip/, API en otro origen y CSP, pero contra el emulador
  // de Auth. Sale a dist-pages-test y el workflow de publicación comprueba que nunca se publica.
  const pagesTest = pages && env.SKITRIP_PAGES_TEST === '1';
  let apiOrigin = '';
  if (pages) {
    apiOrigin = parseApiOrigin(env.VITE_API_BASE_URL);
    if (!apiOrigin) throw new Error('Build de Pages sin VITE_API_BASE_URL: la API no está en github.io.');
    if (!pagesTest) {
      const missing = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID'].filter((k) => !env[k]);
      if (missing.length) throw new Error(`Build de Pages sin configuración pública: ${missing.join(', ')}`);
      if (env.VITE_USE_AUTH_EMULATOR === '1' || /^demo-/.test(env.VITE_FIREBASE_PROJECT_ID!)) throw new Error('El build de Pages no puede usar el emulador ni un proyecto demo-.');
    } else if (env.VITE_USE_AUTH_EMULATOR !== '1') throw new Error('El build de prueba de Pages solo funciona con el emulador.');
  }
  return {
    root: import.meta.dirname,
    base: pages ? (env.SKITRIP_BASE ?? '/skitrip/') : '/',
    plugins: [react(), ...(pages ? [pagesCsp(apiOrigin, pagesTest ? ['http://127.0.0.1:9099'] : [])] : [])],
    publicDir: 'public',
    build: {
      outDir: pagesTest ? 'dist-pages-test' : pages ? 'dist-pages' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // Sin data: URIs para scripts/estilos: la CSP no permite inline.
      assetsInlineLimit: 0,
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
    },
    // Sin proxy en preview: el build de Pages se prueba llamando a la API en su propio origen, como en producción.
    preview: { port: 4173, strictPort: true, proxy: {} },
  };
});
