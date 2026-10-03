import { defineConfig } from '@playwright/test';

// Comprobación de PRODUCCIÓN (solo desde Actions, workflow «v2 · publicar» o «v2 · comprobar producción»):
// la web publicada en Pages con la API real y Firebase real. Crea cuentas de prueba identificables
// (prod-check-<ejecución>-…@example.com) y datos de prueba propios; no toca los de nadie más.
export default defineConfig({
  testDir: 'test/prod',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results-prod',
  use: { locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 1280, height: 800 }, trace: 'off', screenshot: 'only-on-failure' },
});
