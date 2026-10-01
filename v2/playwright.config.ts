import { defineConfig } from '@playwright/test';

// E2E de la SPA contra servicios locales oficiales: emulador de Firebase Auth (9099),
// Worker en workerd con D1 local (8787) y Vite (5173). Sin servicios de terceros.
// La D1 de E2E vive aparte (test/e2e/.state) y se recrea en cada ejecución, para no tocar
// la base de desarrollo ni agotar MAX_PROFILES.
//
// Configuración explícita y sin secretos (test/e2e/env.ts): no se lee nada de .dev.vars ni de otros archivos ignorados.
// Con CI=1 no se reutiliza ningún servidor ya arrancado (si un puerto está ocupado, la ejecución falla).
// Chromium: el que instala `npx playwright install chromium`; PW_CHROMIUM_PATH solo si hay que usar otro binario.
import { E2E_WORKER_VARS, PAGES_TEST_ENV, PAGES_URL } from './test/e2e/env';

const CHROME = process.env.PW_CHROMIUM_PATH || undefined;
const STATE = 'test/e2e/.state';
const reuse = !process.env.CI;
const vars = Object.entries(E2E_WORKER_VARS).map(([k, v]) => `--var ${k}:${v}`).join(' ');

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 2,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: CHROME ? { executablePath: CHROME } : {},
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: 'npx firebase emulators:start --only auth --project demo-skitrip',
      url: 'http://127.0.0.1:9099/',
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: `rm -rf ${STATE} && npx wrangler d1 migrations apply skitrip --local --persist-to ${STATE} && npx wrangler d1 execute skitrip --local --persist-to ${STATE} --file test/e2e/seed.sql && npx wrangler dev --local --port 8787 --persist-to ${STATE} ${vars}`,
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: reuse,
      timeout: 180_000,
      env: { CI: '1' },
      stdout: 'ignore',
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/',
      reuseExistingServer: reuse,
      timeout: 60_000,
      stdout: 'ignore',
    },
    {
      // Build real de Pages (no el servidor de desarrollo ni su proxy) servido bajo /skitrip/ en otro origen.
      command: 'npx vite build && npx vite preview --outDir dist-pages-test --port 4173 --strictPort',
      url: PAGES_URL,
      reuseExistingServer: reuse,
      timeout: 120_000,
      env: PAGES_TEST_ENV,
      stdout: 'ignore',
    },
  ],
});
