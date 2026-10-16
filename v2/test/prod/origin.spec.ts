import { expect, test } from '@playwright/test';
import { API, apiAs, cleanupAccounts, CONFIGURED, go, idToken, recordAccounts, signUpUi, URL, user } from './accounts';

// Comprobación real y acotada del origen personalizado en producción, con Geoapify y OpenStreetMap de verdad (las
// pruebas locales usan un simulador). Una cuenta de prueba (letra g), un origen público (plaza del Mercadal, Reus) y
// una sola búsqueda y un solo cálculo de rutas: 1 + N créditos de Geoapify (N = estaciones comparadas, 19 hoy). No
// usa direcciones privadas ni toca datos de nadie más. Manual: v2 · comprobar producción → recorrido «origen».
test.skip(!CONFIGURED, 'Solo se ejecuta con PROD_URL, PROD_API y FIREBASE_API_KEY (Actions).');

const LETTERS = ['g'];
const PUBLIC_ORIGIN = 'Plaça del Mercadal, Reus';
test.beforeAll(() => recordAccounts(LETTERS));
test.afterAll(async () => { await cleanupAccounts(LETTERS, {}); });

test('producción: origen personalizado con Geoapify real desde un punto público de Reus y mapa de OSM', async ({ browser }) => {
  const g = user('g');
  const page = await (await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })).newPage();
  const tiles: { status: number; referer: string | undefined }[] = [];
  page.on('response', async (r) => {
    if (r.url().startsWith('https://tile.openstreetmap.org/')) tiles.push({ status: r.status(), referer: (await r.request().allHeaders())['referer'] });
  });
  await signUpUi(page, g);
  const token = await idToken(g);
  const st0 = await apiAs(token, 'GET', '/api/geo/status');
  expect(st0.status, 'GET /api/geo/status').toBe(200);
  expect(st0.json.enabled, 'clave GEOAPIFY_API_KEY configurada en el Worker').toBe(true);
  console.log(`Geoapify activado; créditos usados hoy (global): ${st0.json.global.used}/${st0.json.global.cap}`);

  // Mapa real: teselas de OSM con Referer solo del origen del sitio.
  await go(page, '/comparar?origen=personal');
  await page.getByRole('button', { name: 'Elegir un punto en el mapa' }).click();
  await expect(page.getByTestId('origin-map').locator('img.leaflet-tile-loaded').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(tiles.length).toBeGreaterThan(0);
  const origin = new globalThis.URL(URL).origin + '/';
  for (const t of tiles) { expect(t.status).toBe(200); expect(t.referer).toBe(origin); }
  console.log(`OSM: ${tiles.length} teselas, todas 200, Referer ${origin}`);

  // Una búsqueda y un cálculo de rutas desde el punto público.
  const picker = page.getByRole('region', { name: 'Origen personalizado' });
  await picker.getByLabel('Dirección o municipio de salida').fill(PUBLIC_ORIGIN);
  await picker.getByRole('button', { name: 'Buscar' }).click();
  const first = picker.getByRole('radio').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.check();
  await expect(picker.getByRole('radio', { checked: true })).toHaveAccessibleName(/Reus/);
  const routesResp = page.waitForResponse((r) => r.url() === `${API}/api/geo/routes`);
  await picker.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  const routes = (await (await routesResp).json()) as { routes: { areaId: string; accessName: string; roadKm: number | null; durationMin: number | null; lastLeg: string | null; access?: { confidence: string } }[]; credits: number };
  await expect(picker).toContainText('Salida desde:');
  expect(page.url()).not.toMatch(/Mercadal|41\.1|1\.10/);

  // Coherencia con las rutas curadas desde Tarragona (a unos 14 km de Reus): mismo orden de magnitud.
  const cat = await (await fetch(`${API}/api/public/catalog?origin=tarragona`)).json() as { areas: { id: string; name: string; route: { roadKm: number | null } | null }[] };
  const fixed = new Map(cat.areas.map((a) => [a.id, a]));
  // Primero se anota todo (para leerlo en el registro) y después se comprueba.
  const lines: string[] = [];
  const off: string[] = [];
  for (const r of routes.routes) {
    const t = fixed.get(r.areaId)?.route?.roadKm ?? null;
    lines.push(`${fixed.get(r.areaId)?.name ?? r.areaId}: ${r.roadKm ?? '—'} km, ${r.durationMin ?? '—'} min desde Reus · ${t ?? '—'} km desde Tarragona · llegada «${r.accessName}» (${r.access?.confidence ?? '?'})${r.lastLeg ? ' · último tramo en cremallera' : ''}`);
    if (r.roadKm == null) off.push(`${r.areaId}: sin distancia`);
    else if (t != null && Math.abs(r.roadKm - t) >= Math.max(40, t * 0.2)) off.push(`${r.areaId}: Reus ${r.roadKm} km frente a Tarragona ${t} km`);
  }
  console.log(lines.join('\n'));
  expect(off, 'distancias desde Reus incoherentes con las de Tarragona').toEqual([]);
  expect(routes.routes.find((r) => r.areaId === 'vall-de-nuria')?.lastLeg).toBe('rack_railway');
  const st1 = await apiAs(token, 'GET', '/api/geo/status');
  expect(st1.json.user.used).toBe(1 + routes.credits);
  console.log(`Créditos gastados por esta comprobación: ${st1.json.user.used} (1 búsqueda + ${routes.credits} destinos)`);
});
