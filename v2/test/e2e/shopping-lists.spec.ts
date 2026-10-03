import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BASE, apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, uniq, waitToast } from './helpers';

// Lista general de la compra de punta a punta con cuentas sintéticas del emulador: crear la lista sin viaje → revisar e
// importar la hoja antigua (sintética, test/e2e/seed.sql) → completar un artículo → copiar a dos viajes → modificar uno
// → comprobar que el otro y la lista no cambian, y ver precio e historial del producto. Otra cuenta no ve la lista.

async function loggedIn(page: Page, request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}
const past = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const LECHE = 'Leche (hoja sintética)';
const PAN = 'Pan de molde (hoja sintética)';

test('lista general: hoja antigua → dos viajes independientes → precio e historial; privada para otra cuenta', async ({ page, request, browser }, info) => {
  test.setTimeout(180_000);
  const { token } = await loggedIn(page, request, 'gls');
  const pname = `Leche brick ${uniq()}`;
  const { product } = await apiAs(request, token, 'POST', '/api/products', { name: pname, format: 'Brick 1 L' });
  const d1 = past(20), d2 = past(5);
  for (const [observedOn, amountCents] of [[d1, 99], [d2, 105]] as const) {
    await apiAs(request, token, 'POST', '/api/prices', { productId: product.id, amountCents, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn });
  }

  // 1) Sin ningún viaje: la compra abre en las listas generales, con estado vacío.
  const nav = page.getByRole('navigation', { name: info.project.use.isMobile ? 'Principal (móvil)' : 'Principal', exact: true });
  await nav.getByRole('link', { name: 'Compra' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compra' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mis listas generales' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Aún no tienes ninguna lista general')).toBeVisible();
  await page.getByLabel('Nombre de la lista').fill('Básicos de nieve');
  await page.getByRole('button', { name: 'Crear lista general' }).click();
  await waitToast(page, 'Lista creada.');
  await expect(page.getByRole('heading', { name: /Básicos de nieve/ })).toBeVisible();
  await expect(page.locator('main')).toContainText('Solo la ves tú');

  // 2) Hoja antigua: vista previa con lo que falta y precio marcado como antiguo; se importan los incompletos.
  const openLegacy = page.getByRole('button', { name: 'Revisar la hoja antigua' });
  await openLegacy.click();
  const dlg = page.getByRole('dialog', { name: 'Compra de la hoja antigua' });
  await expect(dlg).toContainText('nunca como precio actual');
  const legacyList = dlg.getByRole('list', { name: 'Artículos de la hoja antigua' });
  await expect(legacyList.getByRole('listitem').filter({ hasText: LECHE })).toContainText('precio antiguo: 5,40 €');
  await expect(legacyList.getByRole('listitem').filter({ hasText: LECHE })).toContainText('Falta: falta el producto exacto');
  await expectNoHorizontalOverflow(page, `hoja antigua en lista general (${info.project.name})`);
  await dlg.getByRole('button', { name: 'Importar 2 a la lista' }).click();
  await waitToast(page, '2 artículo(s) importado(s) de la hoja antigua.');
  const items = page.getByRole('list', { name: 'Artículos de la lista general' });
  await expect(items.getByRole('listitem')).toHaveCount(2);
  await expect(items.getByRole('listitem').filter({ hasText: LECHE })).toContainText('Precio antiguo de la hoja: 5,40 €');
  await expect(items.getByRole('listitem').filter({ hasText: LECHE })).toContainText('no es un precio actual');
  await expect(page.getByTestId('gl-incomplete')).toContainText('2 artículo(s) incompletos');

  // Repetir no duplica: en la interfaz ya no hay nada que importar y por API se ignora.
  await openLegacy.click();
  await expect(dlg).toContainText('Todos los artículos de la hoja ya están en esta lista.');
  await expect(dlg.getByRole('checkbox', { name: new RegExp(LECHE.replace(/[()]/g, '\\$&')) })).toBeDisabled();
  await page.keyboard.press('Escape');
  const { lists } = await apiAs(request, token, 'GET', '/api/shopping-lists');
  const lid = lists[0].id as string;
  expect(await apiAs(request, token, 'POST', `/api/shopping-lists/${lid}/legacy-import`, { legacyIds: ['e2e-ls1', 'e2e-ls2'] })).toEqual({ created: 0, alreadyImported: 2 });
  await page.reload();
  await expect(items.getByRole('listitem')).toHaveCount(2);

  // 3) Completar la leche: producto exacto y «por día». Ahora tiene último precio registrado con fecha y nada pendiente.
  await items.getByRole('button', { name: `Editar ${LECHE}` }).click();
  const edit = page.getByRole('dialog', { name: 'Editar artículo de la lista general' });
  await edit.getByLabel('Producto exacto').fill(pname);
  await edit.getByRole('button', { name: `Elegir ${pname}` }).click();
  await edit.getByLabel(/Por día de esquí/).check();
  await expectNoHorizontalOverflow(page, `editar artículo general (${info.project.name})`);
  await edit.getByRole('button', { name: 'Guardar' }).click();
  await waitToast(page, 'Artículo guardado.');
  const milk = items.getByRole('listitem').filter({ hasText: LECHE });
  await expect(milk).toContainText(`Producto: ${pname} · Brick 1 L`);
  await expect(milk).toContainText('× 6 por día de esquí');
  await expect(milk).toContainText(`Último precio registrado: 1,05 € (estantería · ${dmy(d2)}`);
  await expect(milk).not.toContainText('Falta:');
  await expect(page.getByTestId('gl-incomplete')).toContainText('1 artículo(s) incompletos');

  // 4) Dos viajes sintéticos (solo en el emulador). B ya tiene pan: la vista previa lo detecta como coincidencia.
  const tripA = (await apiAs(request, token, 'POST', '/api/trips', { name: `Viaje A ${uniq()}`, skiDays: 2 })).trip;
  const tripB = (await apiAs(request, token, 'POST', '/api/trips', { name: `Viaje B ${uniq()}` })).trip;
  await apiAs(request, token, 'POST', `/api/trips/${tripB.id}/shopping/items`, { name: 'pan de molde (hoja sintética)', qty: 1 });
  await page.reload();
  const copyPanel = page.getByRole('region', { name: 'Copiar a un viaje' });
  for (const trip of [tripA, tripB]) {
    await copyPanel.getByLabel('Viaje de destino').selectOption({ label: trip.name });
    await copyPanel.getByRole('button', { name: 'Revisar y copiar…' }).click();
    const cp = page.getByRole('dialog', { name: `Copiar a «${trip.name}»` });
    const rows = cp.getByRole('list', { name: 'Artículos a copiar' });
    if (trip === tripA) {
      await expect(cp.getByTestId('copy-summary')).toHaveText('La lista del viaje está vacía.');
      await expect(rows.getByRole('listitem').filter({ hasText: LECHE })).toContainText('× 12 (6 por día × 2 días de esquí)');
      await expectNoHorizontalOverflow(page, `vista previa de copia (${info.project.name})`);
      await cp.getByRole('button', { name: 'Copiar al viaje (2 nuevos)' }).click();
      await waitToast(page, `Copiado a «${trip.name}»: 2 añadido(s), 0 sumado(s), 0 sin tocar.`);
    } else {
      await expect(cp.getByTestId('copy-summary')).toContainText('El viaje ya tiene 1 artículo(s); 1 coinciden con esta lista.');
      const bread = rows.getByRole('listitem').filter({ hasText: PAN });
      await expect(bread).toContainText('Coincide (mismo nombre): en el viaje ya hay «pan de molde (hoja sintética)» × 1');
      await expect(bread.getByRole('radio', { name: /Dejar lo que hay/ })).toBeChecked();
      await expect(rows.getByRole('listitem').filter({ hasText: LECHE })).toContainText('× 6 (6 por día; el viaje no tiene días de esquí');
      await cp.getByRole('button', { name: 'Copiar al viaje (1 nuevos)' }).click();
      await waitToast(page, `Copiado a «${trip.name}»: 1 añadido(s), 0 sumado(s), 1 sin tocar.`);
    }
    await expect(cp).toBeHidden();
  }

  // 5) Modificar el viaje A: marcar la leche como comprada y cambiar cantidad y nota.
  await page.goto(`/#/compra?viaje=${tripA.id}`);
  const tripItems = page.getByRole('list', { name: 'Artículos' });
  await expect(tripItems.getByRole('listitem')).toHaveCount(2);
  await expect(tripItems.getByRole('listitem').filter({ hasText: LECHE })).toContainText('de una lista general');
  await tripItems.getByRole('button', { name: `Editar ${LECHE}` }).click();
  const tEdit = page.getByRole('dialog', { name: 'Editar artículo' });
  await tEdit.getByLabel('Cantidad').fill('3');
  await tEdit.getByLabel('Nota').fill('solo para A');
  await tEdit.getByRole('button', { name: 'Guardar' }).click();
  await waitToast(page, 'Artículo guardado.');
  await page.getByRole('checkbox', { name: new RegExp(LECHE.replace(/[()]/g, '\\$&')) }).check();
  await expect(page.getByRole('checkbox', { name: new RegExp(LECHE.replace(/[()]/g, '\\$&')) })).toBeChecked();
  await page.waitForLoadState('networkidle');

  // 6) El viaje B no cambia: cantidad propia, pendiente, sin la nota de A, y con el precio del mismo producto.
  await page.goto(`/#/compra?viaje=${tripB.id}`);
  await expect(tripItems.getByRole('listitem')).toHaveCount(2);
  const milkB = tripItems.getByRole('listitem').filter({ hasText: LECHE });
  await expect(milkB).toContainText('× 6');
  await expect(milkB).not.toContainText('solo para A');
  await expect(page.getByRole('checkbox', { name: new RegExp(LECHE.replace(/[()]/g, '\\$&')) })).not.toBeChecked();
  await expect(milkB).toContainText(`1,05 € por envase · estantería · ${dmy(d2)}`);
  const b = (await apiAs(request, token, 'GET', `/api/trips/${tripB.id}/shopping`)).items;
  expect(b.find((i: any) => i.name === LECHE)).toMatchObject({ qty: 6, bought: false, note: null, product: { id: product.id } });

  // 7) La lista general tampoco cambia, y desde ella se ve el historial de precios del producto.
  await page.goto(`/#/compra?vista=general&lista=${lid}`);
  await expect(milk).toContainText('× 6 por día de esquí');
  await expect(milk).not.toContainText('solo para A');
  await milk.getByRole('button', { name: `Ver precios de ${LECHE}` }).click();
  const history = page.locator('.detail-panel');
  await expect(history.getByRole('heading', { name: `${pname} · Brick 1 L` })).toBeVisible();
  await expect(history.getByRole('table')).toContainText(d1);
  await expect(history.getByRole('table')).toContainText(d2);
  await expect(history.getByRole('table')).toContainText('0,99 €');
  await expect(history.getByRole('table')).toContainText('1,05 €');
  await expectNoHorizontalOverflow(page, `lista general con historial (${info.project.name})`);

  // 8) Otra cuenta: ni por la interfaz ni por la API puede ver o editar la lista privada.
  const intruder = makeUser('gli');
  const otherToken = await createUserViaApi(request, intruder);
  const op = await newUserPage(browser, info);
  await loginUI(op, intruder);
  await op.goto(`/#/compra?vista=general&lista=${lid}`);
  await expect(op.getByText('Aún no tienes ninguna lista general')).toBeVisible();
  await expect(op.locator('main')).not.toContainText('Básicos de nieve');
  await expect(op.locator('main')).not.toContainText(LECHE);
  const headers = { Authorization: `Bearer ${otherToken}` };
  expect((await request.get(`${BASE}/api/shopping-lists/${lid}`, { headers })).status()).toBe(404);
  expect((await request.patch(`${BASE}/api/shopping-lists/${lid}`, { headers, data: { name: 'Robada', version: 1 } })).status()).toBe(404);
  expect((await request.post(`${BASE}/api/shopping-lists/${lid}/items`, { headers, data: { name: 'Intruso' } })).status()).toBe(404);
  expect((await request.post(`${BASE}/api/shopping-lists/${lid}/legacy-import`, { headers, data: { legacyIds: ['e2e-ls1'] } })).status()).toBe(404);
  const mine = await apiAs(request, token, 'GET', `/api/shopping-lists/${lid}`);
  expect(mine.list.name).toBe('Básicos de nieve');
  expect(mine.items).toHaveLength(2);
  await op.context().close();
});
