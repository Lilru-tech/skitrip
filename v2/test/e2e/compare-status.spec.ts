import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Estado de apertura en Comparar con los datos sintéticos de seed.sql: Dominio Alfa abierto (parte de hace 1 h),
// Épsilon cerrada (parte de hoy), Beta con dato de hace 5 días y Gamma con parte de hace 7 días (desconocidas),
// Delta y las estaciones del dominio sin datos. Los casos «todas cerradas» y «cerradas + desconocida» cambian solo la
// respuesta del catálogo en el navegador (page.route), sin tocar la D1.

async function loggedIn(page: Page, request: APIRequestContext) {
  const u = makeUser('est');
  await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
}

test('planificar compara todas; esquiar ahora solo recomienda abiertas confirmadas', async ({ page, request }, info) => {
  await loggedIn(page, request);
  await page.goto('/#/comparar');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  const card = (name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
  await expect(card('Dominio Alfa').locator('.status-badge')).toHaveText('✓ Abierta');
  await expect(card('Épsilon Cerrada').locator('.status-badge')).toHaveText('✕ Cerrada');
  await expect(card('Épsilon Cerrada')).toHaveClass(/is-closed/);
  await expect(card('Beta').locator('.status-badge')).toHaveText('? Estado desconocido');
  await expect(card('Beta')).toContainText('último dato capturado hace más de');
  await expect(card('Beta')).toContainText('(último estado publicado: abierta). No se da por cerrada.');
  await expect(near).toContainText('Épsilon Cerrada');
  // Apertura y actualidad separadas: «Dato reciente» es neutro y no dice «Abierta».
  const dominioDetails = card('Dominio Alfa').locator('details.area-more');
  await dominioDetails.locator('summary').click();
  await expect(dominioDetails.locator('.badge-fresh')).toContainText('Dato reciente');
  await expect(page.getByText('Actualizado', { exact: true })).toHaveCount(0);
  // Resumen: catálogo completo frente a resultados del filtro, con desconocidas contadas. Hay una abierta: sin aviso.
  const overview = page.getByRole('region', { name: 'Estado de apertura' });
  await expect(overview).toContainText('Catálogo completo (5)1 abierta · 1 cerrada · 0 fuera de temporada · 3 con estado desconocido');
  await expect(overview).toContainText('Con tu filtro (3)1 abierta · 1 cerrada · 0 fuera de temporada · 1 con estado desconocido');
  await expect(overview.getByRole('status')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `comparar planificar (${info.project.name})`);

  await page.getByRole('link', { name: 'Esquiar ahora' }).click();
  const open = page.getByRole('list', { name: 'Estaciones abiertas dentro de la distancia' });
  await expect(open.getByRole('listitem').filter({ has: page.getByRole('heading') })).toHaveCount(1);
  await expect(open).toContainText('Dominio Alfa');
  await expect(page.getByRole('list', { name: 'Estaciones con estado desconocido' })).toContainText('Beta');
  const closed = page.locator('details').filter({ hasText: 'Cerradas o fuera de temporada ahora' });
  await expect(closed).not.toHaveAttribute('open', '');
  await closed.locator('> summary').click();
  // La ficha cerrada sigue accesible para planificar.
  const closedLink = closed.getByRole('link', { name: /Épsilon Cerrada/ });
  await closedLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Épsilon Cerrada (sintético)' })).toBeVisible();
  await page.goBack();
  await expectNoHorizontalOverflow(page, `comparar ahora (${info.project.name})`);
});

/** Respuesta del catálogo con el estado de todas las áreas sustituido (fresco), salvo `unknownIds`, que quedan sin dato. */
async function forceStatuses(page: Page, opStatus: string, unknownIds: string[] = []) {
  await page.route('**/api/public/catalog**', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const now = Date.now();
    for (const a of body.areas) {
      a.snow = unknownIds.includes(a.id) ? null : {
        observedAt: now - 3600_000, sourceDate: null, opStatus, openKm: null, totalKm: a.officialTotalKm, openRuns: null, totalRuns: null, openLifts: null, totalLifts: null,
        depthMinCm: null, depthMaxCm: null, quality: 'ok', qualityNote: null, sourceId: 'e2e', freshness: 'fresh', rank: { openKm: 0, excluded: null, label: null },
      };
    }
    await route.fulfill({ response: res, json: body });
  });
}

test('aviso global: «todas cerradas» solo con cierre confirmado y vigente en todas', async ({ page, request }, info) => {
  await loggedIn(page, request);
  await forceStatuses(page, 'closed_confirmed');
  await page.goto('/#/comparar?contexto=ahora');
  const notice = page.getByRole('region', { name: 'Estado de apertura' }).getByRole('status');
  await expect(notice).toContainText('Todas las estaciones del catálogo están cerradas. Las 5 están cerradas o fuera de temporada según su fuente, con dato vigente.');
  await expect(page.getByText('Ninguna estación abierta confirmada dentro de esa distancia')).toBeVisible();
  await expectNoHorizontalOverflow(page, `todas cerradas (${info.project.name})`);
});

test('aviso global: cerradas y una desconocida no se presentan como «todas cerradas»', async ({ page, request }) => {
  await loggedIn(page, request);
  await forceStatuses(page, 'closed_confirmed', ['e2e-sin-ruta']);
  await page.goto('/#/comparar');
  const notice = page.getByRole('region', { name: 'Estado de apertura' }).getByRole('status');
  await expect(notice).toContainText('No hay ninguna estación abierta confirmada en el catálogo. Ninguna abierta confirmada: 4 cerradas, 1 con estado desconocido (puede estar abierta; no hay dato vigente).');
  await expect(notice).not.toContainText('Todas las estaciones');
});
