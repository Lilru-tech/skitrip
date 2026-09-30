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

  await page.goto(`/compra?viaje=${trip.id}`);
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

  await page.goto(`/viajes/${trip.id}/presupuesto`);
  const ranked = page.getByRole('list', { name: 'Candidaturas completas por coste' });
  const incomplete = page.getByRole('list', { name: 'Candidaturas con presupuesto incompleto' });
  await expect(ranked.getByRole('listitem')).toHaveCount(1);
  await expect(ranked).toContainText('1. Apartamento completo');
  await expect(ranked).toContainText('250,00 €/persona');
  await expect(ranked).toContainText('190 km por carretera');
  await expect(ranked).toContainText('cotización válida para el viaje');
  const inc = incomplete.getByRole('listitem');
  await expect(inc).toHaveCount(1);
  await expect(inc).toContainText('Hotel sin precio');
  await expect(inc).toContainText('Incompleto: falta Alojamiento');
  await expect(inc).toContainText('Conocido hasta ahora: 50,00 €/persona');
  await expect(inc).toContainText('(sin validar)');
  await expect(inc).not.toContainText(/^\d+\./);
  await expect(inc.locator('[data-rank]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `comparar coste (${info.project.name})`);
});

test('compra de la hoja antigua: se recupera con producto exacto y repetir no duplica', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'lgs');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Recuperar hoja' });
  const pname = `Leche hoja ${uniq()}`;
  await apiAs(request, token, 'POST', '/api/products', { name: pname, format: '1 L' });

  await page.goto(`/compra?viaje=${trip.id}`);
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
  await page.goto('/estaciones/e2e-beta');
  const legacy = page.getByRole('list', { name: 'Comentarios de la hoja antigua' });
  await expect(legacy).toContainText('De la hoja antigua · escrito por «Pepe»');
  await expect(legacy).toContainText('Buena nieve polvo');
  await expect(page.locator('main')).toContainText('no identifica una cuenta');
  await expectNoHorizontalOverflow(page, `estación con legacy (${info.project.name})`);

  await page.goto('/comparar');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  await expect(near).toContainText('no puntúa: dato de hace más de 30 h');
});
