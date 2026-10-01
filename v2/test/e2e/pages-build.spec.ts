import { expect, test, type Page } from '@playwright/test';
import { PAGES_URL } from './env';
import { apiAs, createUserViaApi, expectNoHorizontalOverflow, makeUser, type TestUser } from './helpers';

// El build que se publica en GitHub Pages: base /skitrip/, rutas con fragmento, API en otro origen (8787 aquí,
// workers.dev en producción) y CSP en <meta>. Se sirve con `vite preview` sin proxy, como archivos estáticos.
const API = 'http://localhost:8787';

async function watch(page: Page) {
  const violations: string[] = [];
  const sameOriginApi: string[] = [];
  const failed: string[] = [];
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('request', (r) => { if (r.url().startsWith('http://localhost:4173/') && r.url().includes('/api/')) sameOriginApi.push(r.url()); });
  page.on('response', (r) => { if (r.url().startsWith('http://localhost:4173/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  return { violations: async () => [...violations, ...(await page.evaluate(() => (window as any).__csp as string[]))], sameOriginApi, failed };
}

async function login(page: Page, u: TestUser) {
  await page.goto(`${PAGES_URL}#/entrar`);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible({ timeout: 20_000 });
}

test('build de Pages: portada exacta, recursos bajo /skitrip/, alta y API en otro origen sin violar la CSP', async ({ page }, info) => {
  const w = await watch(page);
  await page.goto(PAGES_URL);
  await expect(page.getByRole('main')).toBeVisible();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain(`connect-src ${API}`);
  expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe('/skitrip/favicon.svg');
  expect((await page.request.get(`${PAGES_URL}favicon.svg`)).status()).toBe(200);

  // Alta completa desde la interfaz publicada: Auth (emulador aquí) y POST /api/me al origen de la API.
  const u = makeUser('pgs');
  const meCall = page.waitForRequest((r) => r.url() === `${API}/api/me` && r.method() === 'POST');
  await page.goto(`${PAGES_URL}#/registro`);
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByLabel('Alias público').fill(u.alias);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  const headers = await (await meCall).allHeaders();
  expect(headers['origin']).toBe('http://localhost:4173');
  expect(headers['authorization']).toMatch(/^Bearer /);
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(`${PAGES_URL}#/viajes`);

  // Escritura cross-origin (preflight + POST) desde la interfaz.
  await page.getByRole('button', { name: 'Nuevo viaje' }).click();
  await page.getByLabel('Nombre del viaje').fill('Viaje desde Pages');
  await page.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Viaje desde Pages' })).toBeVisible();
  expect(page.url()).toMatch(/\/skitrip\/#\/viajes\/[^/]+$/);

  await expectNoHorizontalOverflow(page, `Pages (${info.project.name})`);
  expect(await w.violations()).toEqual([]);
  expect(w.sameOriginApi).toEqual([]);
  expect(w.failed).toEqual([]);
});

test('build de Pages: enlace directo, recarga, atrás/adelante, filtros en la URL y otra pestaña', async ({ page, request, context }) => {
  const w = await watch(page);
  const u = makeUser('pgn');
  await createUserViaApi(request, u);
  await login(page, u);

  // Enlace directo a una pantalla con filtro y recarga: sin 404 y con el filtro aplicado.
  await page.goto(`${PAGES_URL}#/estaciones/e2e-beta?modalidad=sin-confirmar`);
  await expect(page.getByRole('heading', { level: 1, name: 'Beta (sintético)' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Forfait sin confirmar/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Beta (sintético)' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Forfait sin confirmar/ })).toBeChecked();

  // Cambiar el filtro actualiza la URL (sustituye, no apila) y sobrevive a la recarga.
  await page.getByRole('radio', { name: /Solo alojamiento/ }).check();
  await expect(page).toHaveURL(/#\/estaciones\/e2e-beta$/);

  // Navegación interna, atrás y adelante.
  await page.goto(`${PAGES_URL}#/viajes`);
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
  const nav = page.getByRole('link', { name: 'Comparar' }).first();
  expect(await nav.getAttribute('href')).toBe('#/comparar');
  await nav.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Comparar' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Comparar' })).toBeVisible();

  // Abrir en otra pestaña: la URL del enlace funciona sola (misma sesión de Firebase en el navegador).
  const tab = await context.newPage();
  await tab.goto(new URL('#/comparar', PAGES_URL).toString());
  await expect(tab.getByRole('heading', { level: 1, name: 'Comparar' })).toBeVisible({ timeout: 20_000 });
  await tab.close();

  expect(await w.violations()).toEqual([]);
  expect(w.sameOriginApi).toEqual([]);
});

test('build de Pages: el enlace de invitación es de /skitrip/#/unirse y quien lo abre se une; el token sale de la barra', async ({ page, request, browser }, info) => {
  const owner = makeUser('pgo');
  const token = await createUserViaApi(request, owner);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Invitación Pages' });
  await login(page, owner);
  await page.goto(`${PAGES_URL}#/viajes/${trip.id}`);
  await page.getByRole('button', { name: 'Crear enlace' }).click();
  const url = await page.getByLabel('Enlace de invitación').inputValue();
  expect(url).toMatch(/^http:\/\/localhost:4173\/skitrip\/#\/unirse\?t=/);

  const guest = makeUser('pgg');
  await createUserViaApi(request, guest);
  const ctx = await browser.newContext({ viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch });
  const p2 = await ctx.newPage();
  await p2.goto(url); // sin sesión: pide entrar y vuelve a la invitación
  await p2.getByLabel('Email').fill(guest.email);
  await p2.getByLabel('Contraseña').fill(guest.password);
  await p2.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(p2.getByRole('heading', { level: 1, name: 'Invitación Pages' })).toBeVisible({ timeout: 20_000 });
  expect(p2.url()).not.toContain('t=');
  await p2.goBack();
  expect(p2.url()).not.toContain('t=');
  await ctx.close();
});
