import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, waitToast } from './helpers';

// Contrato nuevo del backend: presupuesto con referencia/comparación, tickets recuperables y capacidades reales.
// Fechas fijas dentro de los próximos 8 meses (hoy + ≤ 240 días) para que el Worker acepte las búsquedas.

async function loggedIn(page: Page, request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}

const future = (days: number) => {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
};

test('presupuesto: cotización válida y, al cambiar las fechas, alojamiento pendiente con la referencia', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'bud');
  const start = future(60), end = future(62);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', {
    name: 'Presupuesto con cotización', startDate: start, endDate: end, participantsPlanned: 2, rooms: 1, areaId: 'e2e-beta', skiDays: 2,
  });
  expect(trip.nights).toBe(2);
  const { id: cid } = await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, {
    title: 'Hotel cotizado', modality: 'lodging', amountCents: 40000, unit: 'per_stay', priceKind: 'user_quote', areaId: 'e2e-beta',
    checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1, forfaitIncluded: 'no',
  });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, chosenCandidateId: cid });

  await page.goto(`/#/viajes/${trip.id}/presupuesto`);
  const lodging = page.locator('[data-component="lodging"]');
  await expect(lodging).toHaveAttribute('data-status', 'known');
  await expect(lodging).toContainText('Conocido');
  await expect(lodging).toContainText('400,00 €');
  await expect(lodging).toContainText('La cotización coincide con las condiciones del viaje.');
  await expect(page.getByTestId('known-subtotal')).toHaveText('400,00 €');
  await expectNoHorizontalOverflow(page, `presupuesto conocido (${info.project.name})`);

  // Unas noches que no cuadran con las fechas: el 422 se muestra junto al campo, sin cerrar el diálogo.
  await page.goto(`/#/viajes/${trip.id}`);
  const editBtn = page.getByRole('button', { name: 'Editar', exact: true });
  await editBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Editar viaje' });
  await expect(dialog.getByLabel('Edades de menores')).toBeVisible();
  await expect(dialog.getByLabel('Habitaciones')).toHaveValue('1');
  await dialog.getByLabel('Noches').fill('5');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog.locator('.field-error')).toContainText('no coinciden con las fechas');
  await expectNoHorizontalOverflow(page, `editar viaje con error (${info.project.name})`);

  // Cambiar las fechas recalcula las noches y se guarda.
  const newStart = future(67), newEnd = future(70);
  await dialog.getByLabel('Ida').fill(newStart);
  await dialog.getByLabel('Vuelta').fill(newEnd);
  await expect(dialog.getByLabel('Noches')).toHaveValue('3');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await waitToast(page, 'Cambios guardados.');
  await expect(editBtn).toBeFocused();

  await page.goto(`/#/viajes/${trip.id}/presupuesto`);
  await expect(lodging).toHaveAttribute('data-status', 'pending');
  await expect(lodging).toContainText('Pendiente');
  await expect(lodging).toContainText('Referencia');
  await expect(lodging).toContainText('400,00 €');
  await expect(lodging).toContainText('No coincide con el viaje');
  await expect(lodging).toContainText('No se suma al total');
  await expect(page.getByTestId('known-subtotal')).not.toHaveText('400,00 €');
  await expect(page.getByTestId('budget-incomplete')).toContainText('Alojamiento');
  await expectNoHorizontalOverflow(page, `presupuesto pendiente (${info.project.name})`);
});

const TICKET = `MERCADONA, S.A.
C/ EJEMPLO 1
43007 TARRAGONA
30/09/2026 18:42 OP: 1
FACTURA SIMPLIFICADA: 1
Descripción P. Unit Importe
1 LECHE ENTERA 0,89
2 AGUA MINERAL 5L 1,20 2,40
TOTAL (€) 3,29`;

test('ticket sin gasto: se lista, «Crear gasto» lo vincula y repetirlo no duplica', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'rcp');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Tickets recuperables' });

  // Importación desde la interfaz con fallo de red justo al crear el gasto.
  let failed = false;
  await page.route('**/api/receipts/*/expense', async (route) => {
    if (!failed) { failed = true; await route.abort('failed'); } else await route.fallback();
  });
  await page.goto(`/#/compra?viaje=${trip.id}`);
  await page.getByRole('button', { name: 'Pegar un ticket…' }).click();
  const imp = page.getByRole('dialog', { name: 'Importar ticket' });
  await imp.getByLabel('Texto del ticket').fill(TICKET);
  await imp.getByRole('button', { name: 'Previsualizar' }).click();
  await imp.getByRole('button', { name: 'Confirmar ticket' }).click();
  await waitToast(page, /Ticket guardado, pero no se ha podido crear el gasto/);

  const list = page.getByRole('list', { name: 'Tickets importados' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Sin gasto');
  await expect(list).toContainText('3,29 €');
  const create = list.getByRole('button', { name: /^Crear gasto/ });
  await expectNoHorizontalOverflow(page, `tickets (${info.project.name})`);

  // Teclado: se abre con Enter, el foco entra en el diálogo, Escape cierra y el foco vuelve al botón.
  await create.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Crear gasto del ticket' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Concepto')).toBeFocused();
  await expectNoHorizontalOverflow(page, `diálogo crear gasto (${info.project.name})`);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(create).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Crear gasto' }).click();
  await waitToast(page, 'Gasto creado a partir del ticket.');
  await expect(list).toContainText('Gasto creado');
  await expect(list.getByRole('button', { name: /^Crear gasto/ })).toHaveCount(0);

  // Repetir es inofensivo: la vinculación devuelve el gasto existente y reimportar no duplica nada.
  const { receipts } = await apiAs(request, token, 'GET', '/api/receipts');
  expect(receipts).toHaveLength(1);
  const { members } = await apiAs(request, token, 'GET', `/api/trips/${trip.id}`);
  const again = await apiAs(request, token, 'POST', `/api/receipts/${receipts[0].id}/expense`, { tripId: trip.id, participants: [members[0].id] });
  expect(again).toMatchObject({ alreadyLinked: true, expenseId: receipts[0].expense_id });
  const reimport = await apiAs(request, token, 'POST', '/api/receipts/confirm', { text: TICKET, storeLabel: 'Mercadona', channel: 'store', postalCode: '43007', tripId: trip.id, mapping: [] });
  expect(reimport).toMatchObject({ alreadyImported: true, expenseId: receipts[0].expense_id });

  await page.goto(`/#/viajes/${trip.id}/gastos`);
  const expenses = page.getByRole('list', { name: 'Gastos del viaje' });
  await expect(expenses).toContainText('3,29 €');
  await expect(expenses.getByRole('listitem')).toHaveCount(1);
  await expect(expenses).toContainText('desde ticket');
});

test('búsquedas: la capacidad real se muestra antes de crear, con texto honesto y cotización manual', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'cap');
  const start = future(90), end = future(92);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Búsquedas honestas', startDate: start, endDate: end, participantsPlanned: 3, childrenAges: [9], areaId: 'e2e-beta' });

  await page.goto(`/#/viajes/${trip.id}/busquedas`);
  await expect(page.getByRole('heading', { level: 1, name: 'Búsquedas' })).toBeVisible();
  await expect(page.getByTestId('no-auto-search')).toContainText('Hoy no hay búsqueda automática por fechas en ningún proveedor');
  const main = page.locator('main');
  for (const bad of ['próxima pasada', 'aún no permite', 'ejecutarán', 'el proveedor bloqueó', 'seguir sus precios']) await expect(main).not.toContainText(bad);

  const open = page.getByRole('button', { name: 'Nueva búsqueda' });
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Nueva búsqueda' });
  const cap = dialog.getByRole('region', { name: 'Qué puede hacer la aplicación con este proveedor' });
  await expect(cap).toContainText('Esquiades · Solo alojamiento');
  await expect(cap).toContainText('Búsqueda automática por fechas');
  await expect(cap).toContainText('No implementada');
  await expect(cap).toContainText('orientativos');
  await expect(cap).toContainText('el robots.txt de Esquiades prohíbe a los programas su buscador (/book/)');
  await expect(cap.getByRole('link', { name: /Consultar en Esquiades/ })).toHaveAttribute('href', /esquiades/);
  await expect(cap.getByRole('button', { name: 'Guardar cotización manual' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear búsqueda' })).toHaveCount(0);
  await expect(dialog.getByLabel('Edades de menores')).toHaveValue('9');
  await expect(dialog.getByLabel('Adultos')).toHaveValue('2');
  await expectNoHorizontalOverflow(page, `diálogo búsqueda (${info.project.name})`);

  // La capacidad sigue al proveedor y la modalidad elegidos.
  await dialog.getByLabel('Proveedor', { exact: true }).selectOption('estiber');
  await dialog.getByLabel('Modalidad', { exact: true }).selectOption('lodging_forfait');
  await expect(cap).toContainText('Estiber · Alojamiento + forfait');
  await expect(cap.getByRole('link', { name: /Consultar en Estiber/ })).toBeVisible();

  // Escape cierra y devuelve el foco.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  // Guardar la búsqueda igualmente: se informa de que no se ejecutará sola.
  await open.click();
  await dialog.getByRole('button', { name: 'Guardar búsqueda sin ejecución' }).click();
  await waitToast(page, 'Búsqueda guardada, sin ejecución automática.');
  await expect(page.getByTestId('created-note')).toContainText('no se ejecutará automáticamente');
  await expect(page.locator('main')).toContainText('Sin ejecuciones: este proveedor no permite automatizar la búsqueda por fechas');

  // Cotización manual desde la capacidad, marcada como estimación deliberada.
  await open.click();
  await cap.getByRole('button', { name: 'Guardar cotización manual' }).click();
  const manual = page.getByRole('dialog', { name: 'Guardar cotización manual' });
  await expect(manual).toBeVisible();
  await expect(manual.getByLabel('Entrada')).toHaveValue(start);
  await expect(manual.getByLabel('Edades de menores de la cotización')).toHaveValue('9');
  await manual.getByLabel('Importe (€)').fill('520');
  await manual.getByLabel('El importe es').selectOption('per_stay');
  await manual.getByLabel(/Estimación manual/).check();
  await expectNoHorizontalOverflow(page, `diálogo cotización manual (${info.project.name})`);
  await manual.getByRole('button', { name: 'Añadir' }).click();
  await waitToast(page, 'Estimación manual añadida.');

  await page.goto(`/#/viajes/${trip.id}/candidaturas`);
  const card = page.getByRole('list', { name: 'Candidaturas' }).getByRole('listitem').first();
  await expect(card).toContainText('Estimación manual, no es una cotización');
  await expect(card).toContainText('≈ 520,00 €');
  await expect(card).toContainText('menores de 9 años');
  await expectNoHorizontalOverflow(page, `candidaturas con estimación (${info.project.name})`);
});
