import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Pistas y variedad con los datos sintéticos de seed.sql (area_runs y el parte del dominio con abiertas por color).
// Nada de esto toca datos reales: la D1 de E2E se recrea en cada ejecución.

async function loggedIn(page: Page, request: APIRequestContext) {
  const u = makeUser('pis');
  await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
}
const card = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
const fact = (page: Page, name: string, label: string) => card(page, name).locator('.area-facts > div').filter({ has: page.locator('dt', { hasText: label }) }).first().locator('dd');

/** Solo cuenta «Variedad de pistas»: el resto de pesos a 0. */
async function openWeights(page: Page) {
  if ((await page.locator('details.weights').getAttribute('open')) === null) await page.locator('details.weights > summary').click();
}
async function onlyRunsWeight(page: Page) {
  await openWeights(page);
  for (const k of ['snowNow', 'size', 'distance', 'vibe']) await page.locator(`#w-${k}`).fill('0');
  await page.locator('#w-runs').fill('100');
  await expect(page.getByText('Variedad de pistas: 100')).toBeVisible();
}

test('planificar muestra el catálogo de pistas; esquiar ahora, las abiertas del parte vigente', async ({ page, request }, info) => {
  await loggedIn(page, request);
  await page.goto('/#/comparar');
  // Catálogo: el dominio sin cifra propia suma sus estaciones; sin desglose completo no se inventan colores.
  await expect(fact(page, 'Dominio Alfa', 'Número de pistas')).toContainText('70 (suma de sus estaciones) · sin desglose por colores');
  // Resumen breve («dato por revisar · no puntúa»); el porqué, en «Ver detalles».
  const betaRuns = fact(page, 'Beta', 'Número de pistas');
  await expect(betaRuns).toContainText('60 pistas publicadas · dato por revisar · no puntúa');
  await expect(betaRuns).not.toContainText('el desglose por colores');
  const betaDet = card(page, 'Beta').locator('details.area-more');
  await expect(betaDet.getByText('No puntúa: el desglose por colores no suma el total publicado.')).toBeHidden();
  await betaDet.locator('summary').click();
  await expect(betaDet.getByText('No puntúa: el desglose por colores no suma el total publicado.')).toBeVisible();
  const eps = fact(page, 'Épsilon Cerrada', 'Número de pistas');
  await expect(eps.getByRole('list', { name: /por color/ })).toHaveText(/5 verdes.*8 azules.*8 rojas.*4 negras/);
  await expect(fact(page, 'Delta Sin Ruta', 'Número de pistas')).toHaveText('Sin dato');
  // Procedencia plegada: fuente, fecha del dato y consulta, y que el catálogo no garantiza aperturas.
  const det = card(page, 'Épsilon Cerrada').locator('details.area-more');
  // «Ver detalles» con teclado: el resumen lleva el nombre de la estación para lectores de pantalla.
  await expect(det.locator('summary')).toHaveText('Ver detalles de Épsilon Cerrada (sintético)');
  await det.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(det).toHaveAttribute('open', '');
  await expect(det.getByRole('link', { name: /Listado oficial/ })).toHaveAttribute('href', 'https://example.invalid/epsilon-listado');
  await expect(det).toContainText('· contado pista a pista · dato del 01/10/2026 · consultado el 19/10/2026');
  await expect(page.getByText(/el catálogo de cada estación, que no garantiza qué pistas estarán abiertas/)).toBeVisible();

  // Peso a 0 por defecto; con solo «Variedad de pistas», más pistas = más puntos y Beta (no comparable) queda sin dato.
  await openWeights(page);
  await expect(page.getByText('Variedad de pistas: 0')).toBeVisible();
  await onlyRunsWeight(page);
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  await expect(near.locator('> li').first()).toContainText('Dominio Alfa');
  await expect(card(page, 'Beta').locator('.score-line')).toContainText('Falta: variedad de pistas');
  await expectNoHorizontalOverflow(page, `pistas planificar (${info.project.name})`);

  await page.getByRole('link', { name: 'Esquiar ahora' }).click();
  const open = fact(page, 'Dominio Alfa', 'Pistas abiertas');
  await expect(open).toContainText('52 abiertas de 70');
  await expect(open.getByRole('list', { name: /abiertas .* por color/ })).toHaveText(/15 de 18 verdes.*18 de 22 azules.*14 de 20 rojas.*5 de 10 negras/);
  // Sin parte vigente no se sustituye por el catálogo; un cierre confirmado da 0 deducido, sin colores.
  await expect(fact(page, 'Beta', 'Pistas abiertas')).toContainText('sin parte vigente de pistas (parte capturado hace más de 30 h) · catálogo: 60 pistas');
  const closed = page.locator('details').filter({ hasText: 'Cerradas o fuera de temporada ahora' });
  await closed.locator('> summary').click();
  await expect(fact(page, 'Épsilon Cerrada', 'Pistas abiertas')).toContainText('0 abiertas · deducido del cierre que confirma la fuente');
  await expect(fact(page, 'Épsilon Cerrada', 'Pistas abiertas').getByRole('list')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `pistas ahora (${info.project.name})`);
});

test('al cambiar de modo la variedad se recalcula con el dato de ese modo', async ({ page, request }) => {
  await loggedIn(page, request);
  // Beta pasa a estar abierta con parte vigente y 60 abiertas (más que las 52 del dominio): solo en el navegador.
  await page.route('**/api/public/catalog**', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const beta = body.areas.find((a: any) => a.id === 'e2e-beta');
    // Totales por color que no cuadran con el total del parte (80 frente a 60): no sirven de denominador.
    beta.snow = { ...beta.snow, observedAt: Date.now() - 3600_000, sourceDate: null, opStatus: 'open', openRuns: 60, totalRuns: 60, quality: 'ok', freshness: 'fresh', rank: { openKm: 40, excluded: null, label: null },
      openRunsByColour: { green: 15, blue: 15, red: 15, black: 15 }, totalRunsByColour: { green: 20, blue: 20, red: 20, black: 20 } };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/#/comparar?contexto=ahora');
  await onlyRunsWeight(page);
  const open = page.getByRole('list', { name: 'Estaciones abiertas dentro de la distancia' });
  await expect(open.locator('> li').first()).toContainText('Beta');
  await expect(card(page, 'Beta').locator('.score-line')).toContainText('Puntuación 100');
  const betaNow = fact(page, 'Beta', 'Pistas abiertas');
  await expect(betaNow).toContainText('60 abiertas de 60');
  await expect(betaNow.getByRole('list', { name: /abiertas .* por color/ })).toHaveText(/^15 verdes\s*15 azules\s*15 rojas\s*15 negras$/);
  await expect(betaNow).toContainText('totales por color no usados: los totales por color suman 80 y el parte publica 60 pistas');

  // Planificar: Beta no tiene total comparable (desglose incoherente) y el dominio sí; nada de la puntuación anterior.
  await page.getByRole('link', { name: 'Planificar un viaje' }).click();
  await onlyRunsWeight(page);
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  await expect(near.locator('> li').first()).toContainText('Dominio Alfa');
  await expect(card(page, 'Beta').locator('.score-line')).toContainText('Puntuación 0');
  await expect(card(page, 'Beta').locator('.score-line')).toContainText('Falta: variedad de pistas');
});

test('la ficha separa catálogo y parte, con fuente, fechas, plano y las estaciones de un dominio', async ({ page, request }, info) => {
  await loggedIn(page, request);
  await page.goto('/#/estaciones/e2e-alfa-norte');
  const sec = page.getByRole('region', { name: 'Pistas y variedad' });
  await expect(sec).toContainText('Número de pistas: 40');
  // Procedencia, plano y criterio plegados en «Ver detalles», que se abre con el teclado.
  await expect(sec.getByRole('link', { name: /Plano oficial de pistas/ })).toBeHidden();
  await sec.locator('details.area-more > summary').focus();
  await page.keyboard.press('Enter');
  await expect(sec.locator('details.area-more')).toHaveAttribute('open', '');
  await expect(sec.getByRole('list', { name: /por color/ })).toHaveText(/10 verdes.*12 azules.*12 rojas.*6 negras/);
  await expect(sec).toContainText('temporada 2025-26 · sin fecha del dato publicada · consultado el 19/10/2026');
  await expect(sec.getByRole('link', { name: /Plano oficial de pistas/ })).toHaveAttribute('href', 'https://example.invalid/alfa-norte-plano.pdf');
  await expect(sec).toContainText('Pistas abiertas: sin parte vigente de pistas (sin parte) · catálogo: 40 pistas');
  await expectNoHorizontalOverflow(page, `ficha pistas (${info.project.name})`);

  await page.goto('/#/estaciones/e2e-dominio');
  const dom = page.getByRole('region', { name: 'Pistas y variedad' });
  await expect(dom).toContainText('Número de pistas: 70 (suma de sus estaciones)');
  await dom.locator('details.area-more > summary').click();
  await expect(dom.getByRole('list', { name: /estaciones de/ })).toContainText('Alfa Norte (sintético): 40 pistas');
  await expect(dom.getByRole('list', { name: /estaciones de/ })).toContainText('el dominio no se suma con ellas');
  await expect(dom).toContainText('Pistas abiertas: 52 abiertas de 70');

  await page.goto('/#/estaciones/e2e-beta');
  const beta = page.getByRole('region', { name: 'Pistas y variedad' });
  await expect(beta).toContainText('60 pistas publicadas · dato por revisar · no puntúa');
  await expect(beta.getByRole('list', { name: /Colores publicados/ })).toHaveText(/20 verdes.*20 azules.*20 rojas.*10 negras/);
  await beta.locator('details.area-more > summary').click();
  await expect(beta.locator('details.area-more')).toContainText('No puntúa: el desglose por colores no suma el total publicado.');
});

test('ficha: un gráfico sin km abiertos se queda en una línea con acceso al historial', async ({ page, request }) => {
  await loggedIn(page, request);
  // Épsilon tiene un solo parte (cerrada, sin km): se añade otro igual de ayer, solo en el navegador.
  await page.route('**/api/public/areas/e2e-cerrada', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.snow = [{ ...body.snow[0], observedAt: body.snow[0].observedAt - 86400_000 }, ...body.snow];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/#/estaciones/e2e-cerrada');
  const now = page.getByRole('region', { name: 'Estado actual' });
  await expect(now.locator('figure.snow-chart')).toHaveCount(0);
  await expect(now.getByTestId('snow-chart-empty')).toContainText('Sin km abiertos en las observaciones de los últimos 90 días');
  await now.getByRole('button', { name: 'Ver el historial de nieve' }).click();
  const hist = page.locator('details#a-snow-history');
  await expect(hist).toHaveAttribute('open', '');
  await expect(hist.locator('summary')).toBeFocused();
  await expect(hist.getByRole('table')).toBeVisible();
});
