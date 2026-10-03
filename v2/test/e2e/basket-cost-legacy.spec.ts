import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, uniq, waitToast } from './helpers';

// Cesta fija, comparación de coste por candidatura, recuperación legacy y nieve que no puntúa.
// Datos legacy sintéticos en test/e2e/seed.sql.

async function loggedIn(page: Page, request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}
const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const past = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split('-').reverse().join('/');

test('cesta: un producto repetido en dos filas da cobertura 100 % y la tabla muestra el cambio en € y %', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'bsk');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Cesta fija' });
  const { product: { id: pid } } = await apiAs(request, token, 'POST', '/api/products', { name: `Leche cesta ${uniq()}`, format: '1 L', netQty: 1000, netUnit: 'ml' });
  for (const qty of [1, 2]) await apiAs(request, token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche', productId: pid, qty });
  const d1 = past(10), d2 = past(3);
  for (const [observedOn, amountCents] of [[d1, 100], [d2, 120]] as const) {
    await apiAs(request, token, 'POST', '/api/prices', { productId: pid, amountCents, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn });
  }

  await page.goto(`/#/compra?viaje=${trip.id}`);
  await expect(page.getByTestId('list-criterion')).toHaveText('Mercadona online · 43007');
  await expect(page.getByRole('list', { name: 'Artículos' })).toContainText(`estantería · ${dmy(d2)}`);
  // Dos filas del mismo producto cuentan como un producto: 1 de 1 con precio.
  await expect(page.locator('main')).toContainText('1 de 1 productos exactos con precio');

  const totals = page.getByRole('region', { name: 'Total de la cesta por fecha' });
  await expect(totals).toContainText(dmy(d1));
  await expect(totals).toContainText('3,00 €');
  await expect(totals).toContainText('3,60 €');
  await expect(totals).toContainText('+0,60 €');
  await expect(totals).toContainText('+20 %');
  await expect(totals.locator('tbody')).not.toContainText('cobertura');
  await expect(page.getByRole('region', { name: 'Historial por producto' })).toContainText('× 3');
  await expect(page.locator('.basket-chart polyline')).toHaveCount(1);
  await expectNoHorizontalOverflow(page, `cesta (${info.project.name})`);

  // Criterio de precio: se edita en un diálogo accesible por teclado y el foco vuelve al botón.
  const change = page.getByRole('button', { name: 'Cambiar criterio de precio' });
  await change.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Criterio de precio' });
  await expect(dlg.getByLabel('Tienda')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(change).toBeFocused();
});

test('comparar coste: la opción completa tiene posición y la incompleta no', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'cst');
  const start = future(40), end = future(42);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Coste por candidatura', startDate: start, endDate: end, participantsPlanned: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, {
    title: 'Apartamento completo', modality: 'lodging', amountCents: 40000, unit: 'per_stay', priceKind: 'user_quote', areaId: 'e2e-dominio',
    checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1, forfaitIncluded: 'no',
  });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel sin precio', modality: 'lodging', areaId: 'e2e-beta' });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 0, renters: 0, groceriesCents: 10000 });

  await page.goto(`/#/viajes/${trip.id}/presupuesto`);
  const ranked = page.getByRole('list', { name: 'Candidaturas completas por coste' });
  const incomplete = page.getByRole('list', { name: 'Candidaturas con presupuesto incompleto' });
  await expect(ranked.locator(':scope > li')).toHaveCount(1);
  await expect(ranked).toContainText('1. Apartamento completo');
  await expect(ranked).toContainText('250,00 €/persona');
  await expect(ranked).toContainText('190 km por carretera');
  await expect(ranked).toContainText('cotización válida para el viaje');
  const inc = incomplete.locator(':scope > li'); // tarjetas (los avisos de cada tarjeta son una lista anidada)
  await expect(inc).toHaveCount(1);
  await expect(inc).toContainText('Hotel sin precio');
  await expect(inc).toContainText('Incompleto: falta Alojamiento');
  await expect(inc).toContainText('Conocido hasta ahora: 50,00 €/persona');
  await expect(inc).toContainText('(sin validar)');
  await expect(inc).not.toContainText(/^\d+\./);
  await expect(inc.locator('[data-rank]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `comparar coste (${info.project.name})`);
});

test('comparar coste: cada candidatura en su estación sin cambiar el viaje; forfait de otra estación pendiente', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'cdx');
  const start = future(50), end = future(52);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Coste en varias estaciones', startDate: start, endDate: end, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  const cond = { unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 };
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Alfa', modality: 'lodging', amountCents: 40000, areaId: 'e2e-dominio', forfaitIncluded: 'no', ...cond });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Paquete en Beta', modality: 'lodging_forfait', amountCents: 50000, areaId: 'e2e-beta', forfaitIncluded: 'yes', forfaitDays: 2, ...cond });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Gamma', modality: 'lodging', amountCents: 30000, areaId: 'e2e-lejana', forfaitIncluded: 'no', ...cond });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0 });

  await page.goto(`/#/viajes/${trip.id}/presupuesto`);
  const ranked = page.getByRole('list', { name: 'Candidaturas completas por coste' });
  await expect(ranked.locator(':scope > li')).toHaveCount(2);
  await expect(ranked.locator(':scope > li').nth(0)).toContainText('1. Paquete en Beta');
  await expect(ranked.locator(':scope > li').nth(0)).toContainText('250,00 €/persona');
  await expect(ranked.locator(':scope > li').nth(0)).toContainText('hipotético');
  await expect(ranked.locator(':scope > li').nth(1)).toContainText('2. Hotel en Alfa');
  await expect(ranked.locator(':scope > li').nth(1)).toContainText('280,00 €/persona');
  await expect(ranked.locator(':scope > li').nth(1)).not.toContainText('hipotético');
  const inc = page.getByRole('list', { name: 'Candidaturas con presupuesto incompleto' }).locator(':scope > li');
  await expect(inc).toHaveCount(1);
  await expect(inc).toContainText('Hotel en Gamma');
  await expect(inc).toContainText('Incompleto: falta Forfait');
  await expect(inc).toContainText('hipotético');
  await expect(inc).toContainText('el viaje tiene otro destino y no se modifica');
  // El presupuesto del viaje sigue en su destino.
  expect((await apiAs(request, token, 'GET', `/api/trips/${trip.id}`)).trip.areaId).toBe('e2e-dominio');
  await expectNoHorizontalOverflow(page, `comparar coste en varias estaciones (${info.project.name})`);
});

test('costes por estación: añadir el forfait de otra estación completa su comparación con procedencia', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'dcs');
  const start = future(60), end = future(62);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Costes por estación', startDate: start, endDate: end, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  const cond = { modality: 'lodging', unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1, forfaitIncluded: 'no' };
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Alfa', amountCents: 40000, areaId: 'e2e-dominio', ...cond });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Beta', amountCents: 30000, areaId: 'e2e-beta', ...cond });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0 });

  await page.goto(`/#/viajes/${trip.id}/presupuesto`);
  const inc = page.getByRole('list', { name: 'Candidaturas con presupuesto incompleto' }).locator(':scope > li');
  await expect(inc).toContainText('Hotel en Beta');
  await expect(inc).toContainText('Incompleto: falta Forfait');

  const costs = page.getByRole('list', { name: 'Costes por estación' });
  await expect(costs.locator(':scope > li')).toHaveCount(2);
  await costs.getByRole('button', { name: 'Añadir costes de Beta (sintético)' }).click();
  const dlg = page.getByRole('dialog', { name: 'Costes de Beta (sintético)' });
  await dlg.getByLabel('Forfait por día y persona (€)').fill('45');
  await dlg.getByLabel('Fecha de consulta').fill('2026-10-01');
  await dlg.getByLabel('Fuente').fill('web oficial (sintético)');
  await expectNoHorizontalOverflow(page, `diálogo costes por estación (${info.project.name})`);
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(dlg).toBeHidden();
  await expect(costs.locator('[data-area="e2e-beta"]')).toContainText('Forfait 45,00 € por día y persona');
  await expect(costs.locator('[data-area="e2e-beta"]')).toContainText('web oficial (sintético) · 01/10/2026');

  const ranked = page.getByRole('list', { name: 'Candidaturas completas por coste' }).locator(':scope > li');
  await expect(ranked).toHaveCount(2);
  await expect(ranked.nth(0)).toContainText('1. Hotel en Beta');
  await expect(ranked.nth(0)).toContainText('240,00 €/persona');
  await expect(ranked.nth(0)).toContainText('Se usan los costes guardados para esta estación');
  await expect(ranked.nth(1)).toContainText('2. Hotel en Alfa');
  await expect(ranked.nth(1)).toContainText('280,00 €/persona');
  await expectNoHorizontalOverflow(page, `costes por estación (${info.project.name})`);
});

test('candidatura con costes propios: el formulario cabe en móvil y el parking incluido se guarda', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'cco');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Costes propios', areaId: 'e2e-beta' });
  await page.goto(`/#/viajes/${trip.id}/candidaturas`);
  await page.getByRole('button', { name: 'Nueva candidatura' }).click();
  await page.getByLabel('Título').fill('Apartamento con parking');
  await page.getByLabel('Parking por coche, estancia (€)').fill('0');
  await page.getByLabel('Nota de los costes').fill('parking incluido');
  await expectNoHorizontalOverflow(page, `formulario de candidatura (${info.project.name})`);
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Apartamento con parking' })).toBeVisible();
  const { candidates } = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/candidates`);
  expect(candidates[0]).toMatchObject({ parking_cents_per_car: 0, costs_note: 'parking incluido', forfait_cents_per_day: null });
});

test('compra de la hoja antigua: se recupera con producto exacto y repetir no duplica', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'lgs');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Recuperar hoja' });
  const pname = `Leche hoja ${uniq()}`;
  await apiAs(request, token, 'POST', '/api/products', { name: pname, format: '1 L' });

  await page.goto(`/#/compra?viaje=${trip.id}`);
  const open = page.getByRole('button', { name: 'Recuperar de la hoja antigua' });
  await open.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Compra de la hoja antigua' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('no se usa');
  await dlg.getByRole('checkbox', { name: 'Leche (hoja sintética)' }).check();
  await dlg.getByLabel('Producto exacto para «Leche (hoja sintética)»').fill(pname);
  await dlg.getByRole('button', { name: `Elegir ${pname}` }).click();
  await expect(dlg.getByLabel('Cantidad de «Leche (hoja sintética)»')).toHaveValue('6');
  await expectNoHorizontalOverflow(page, `diálogo hoja antigua (${info.project.name})`);
  await dlg.getByRole('button', { name: 'Añadir 1 a la lista' }).click();
  await waitToast(page, '1 artículo(s) añadido(s) a la lista.');
  await expect(open).toBeFocused();

  const items = page.getByRole('list', { name: 'Artículos' });
  await expect(items.getByRole('listitem')).toHaveCount(1);
  await expect(items).toContainText(pname);
  await expect(items).toContainText('de la hoja antigua');

  // Al volver a abrir, el artículo ya importado se marca y no se puede elegir otra vez.
  await open.click();
  const done = dlg.getByRole('checkbox', { name: /Leche \(hoja sintética\)/ });
  await expect(done).toBeDisabled();
  await expect(dlg).toContainText('ya en la lista');
  await page.keyboard.press('Escape');

  // Repetir por API tampoco duplica.
  const again = await apiAs(request, token, 'POST', `/api/trips/${trip.id}/shopping/legacy-import`, { items: [{ legacyId: 'e2e-ls1', productId: null, qty: 1 }] });
  expect(again).toEqual({ created: 0, alreadyImported: 1 });
  await page.reload();
  await expect(items.getByRole('listitem')).toHaveCount(1);
  await expectNoHorizontalOverflow(page, `compra con legacy (${info.project.name})`);
});

test('legacy y nieve: comentario de la hoja con su autoría y nieve antigua que no puntúa', async ({ page, request }, info) => {
  await loggedIn(page, request, 'lgc');
  await page.goto('/#/estaciones/e2e-beta');
  const legacy = page.getByRole('list', { name: 'Comentarios de la hoja antigua' });
  await expect(legacy).toContainText('De la hoja antigua · escrito por «Pepe»');
  await expect(legacy).toContainText('Buena nieve polvo');
  await expect(page.locator('main')).toContainText('no identifica una cuenta');
  await expectNoHorizontalOverflow(page, `estación con legacy (${info.project.name})`);

  await page.goto('/#/comparar');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  await expect(near).toContainText('no puntúa: capturado hace más de 30 h');
  // Parte de hace una semana re-descargado hoy: se ven captura y fecha del parte, y no puntúa.
  // Gamma está a 780 km: se amplía la distancia máxima para que entre en la lista.
  await page.locator('#cmp-km').fill('800');
  const gamma = near.getByRole('listitem').filter({ hasText: 'Gamma Lejana (sintético)' });
  await expect(gamma).toContainText('parte del');
  await expect(gamma).toContainText('no puntúa: el parte de la fuente es anterior a ayer');
});
