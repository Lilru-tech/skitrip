import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, waitToast } from './helpers';

// Datos de catálogo sintéticos: test/e2e/seed.sql (se carga en test/e2e/.state al arrancar).

async function loggedIn(page: Page, request: APIRequestContext, prefix = 'p2') {
  const u = makeUser(prefix);
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}

async function newTrip(request: APIRequestContext, token: string, name = 'Viaje de prueba') {
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name, nights: 3 });
  return trip as { id: string };
}

test('un gasto de 10 € entre 3 personas deja saldos que suman 0', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'gas');
  const trip = await newTrip(request, token, 'Gastos a tres');
  const { invitation } = await apiAs(request, token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true, maxUses: 3 });
  for (const prefix of ['gasb', 'gasc']) {
    const other = await createUserViaApi(request, makeUser(prefix));
    await apiAs(request, other, 'POST', '/api/trips/invitations/accept-link', { token: invitation.token });
  }

  await page.goto(`/#/viajes/${trip.id}/gastos`);
  await expect(page.getByRole('heading', { level: 1, name: 'Gastos' })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo gasto' });
  await dialog.getByLabel('Concepto').fill('Supermercado');
  await dialog.getByLabel('Importe (€)').fill('10');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await waitToast(page, 'Gasto registrado.');

  const rows = page.getByRole('list', { name: 'Saldo por persona' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  // El aviso sale antes de recargar los saldos (las filas ya existen a 0 por ser miembros): se espera al saldo nuevo.
  const read = async () => (await rows.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.balanceCents)))) as number[];
  await expect.poll(async () => (await read()).filter((c) => c !== 0).length).toBeGreaterThan(0);
  const cents = await read();
  expect(cents.reduce((a, b) => a + b, 0)).toBe(0);
  expect(cents.filter((c) => c > 0)).toHaveLength(1);
  expect(Math.max(...cents)).toBeGreaterThanOrEqual(666);
  await expect(page.getByTestId('balance-check')).toContainText('0,00 €');
  await expect(page.getByRole('list', { name: 'Gastos del viaje' })).toContainText('10,00 €');
  await expectNoHorizontalOverflow(page, `gastos (${info.project.name})`);
});

test('editar un artículo de la compra se guarda y persiste', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'shop');
  const trip = await newTrip(request, token, 'Compra de prueba');
  await page.goto(`/#/compra?viaje=${trip.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Compra' })).toBeVisible();
  await expect(page.getByText('No hay precios automáticos de Mercadona')).toBeVisible();

  await page.getByLabel('Artículo', { exact: true }).fill('Leche');
  await page.getByLabel('Cantidad', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await waitToast(page, 'Artículo añadido.');

  const items = page.getByRole('list', { name: 'Artículos' });
  await expect(items).toContainText('Leche');
  await expect(items).toContainText('precio pendiente');
  await items.getByRole('button', { name: 'Editar Leche' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar artículo' });
  await dialog.getByLabel('Nombre').fill('Leche semidesnatada');
  await dialog.getByLabel('Cantidad').fill('6');
  await dialog.getByLabel('Nota').fill('marca blanca');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await waitToast(page, 'Artículo guardado.');

  await page.getByRole('checkbox', { name: /Leche semidesnatada/ }).check();
  await expect(page.getByRole('checkbox', { name: /Leche semidesnatada/ })).toBeChecked();
  await page.waitForLoadState('networkidle');

  await page.reload();
  await expect(items).toContainText('Leche semidesnatada');
  await expect(items).toContainText('× 6');
  await expect(items).toContainText('marca blanca');
  await expect(page.getByRole('checkbox', { name: /Leche semidesnatada/ })).toBeChecked();
  await expectNoHorizontalOverflow(page, `compra (${info.project.name})`);
});

test('se vota una candidatura, un voto por persona y se puede cambiar', async ({ page, request }) => {
  const { token } = await loggedIn(page, request, 'vote');
  const trip = await newTrip(request, token, 'Votos de prueba');
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Apartamento de prueba', modality: 'lodging' });

  await page.goto(`/#/viajes/${trip.id}/candidaturas`);
  await expect(page.getByText('Votar no es reservar.')).toBeVisible();
  const group = page.getByRole('group', { name: 'Tu voto para Apartamento de prueba' });
  const up = group.getByRole('button', { name: 'A favor' });
  const down = group.getByRole('button', { name: 'En contra' });
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(group).toContainText('1 a favor · 0 en contra');

  await page.reload();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(group).toContainText('0 a favor · 1 en contra');
});

test('Comparar: el filtro de kilómetros cambia las estaciones visibles', async ({ page, request }, info) => {
  await loggedIn(page, request, 'cmp');
  await page.goto('/#/comparar');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  const noRoute = page.getByRole('list', { name: 'Estaciones sin distancia por carretera' });
  await expect(near).toContainText('Beta (sintético)');
  await expect(near).toContainText('Dominio Alfa (sintético)');
  await expect(near).not.toContainText('Gamma Lejana');
  // Las estaciones del dominio se muestran dentro de él, no como tarjetas aparte.
  await expect(near.getByRole('heading', { name: /Alfa Norte/ })).toHaveCount(0);
  await expect(near.getByRole('link', { name: 'Alfa Norte (sintético)' })).toBeVisible();
  // Sin ruta: grupo propio, nunca «cerca».
  await expect(noRoute).toContainText('Delta Sin Ruta (sintético)');
  await expect(near).not.toContainText('Delta Sin Ruta');
  // Nieve sin dato no es cero.
  await expect(page.getByRole('list', { name: 'Estaciones sin distancia por carretera' })).toContainText('sin dato');
  await expectNoHorizontalOverflow(page, `comparar (${info.project.name})`);

  await page.getByLabel('Máximo por carretera (km)').fill('200');
  await expect(near).not.toContainText('Beta (sintético)');
  await expect(near).toContainText('Dominio Alfa (sintético)');
  await expect(page.getByRole('list', { name: 'Estaciones fuera de la distancia', includeHidden: true })).toContainText('Beta (sintético)');
  await expect(noRoute).toContainText('Delta Sin Ruta (sintético)');

  await page.getByLabel('Máximo por carretera (km)').fill('1000');
  await expect(near).toContainText('Gamma Lejana (sintético)');
  await expect(near).toContainText('Beta (sintético)');
  await expect(noRoute).toContainText('Delta Sin Ruta (sintético)');
});

test('ficha de estación: ofertas por modalidad con su nota y unidades', async ({ page, request }) => {
  await loggedIn(page, request, 'area');
  await page.goto('/#/estaciones/e2e-beta');
  await expect(page.getByRole('heading', { level: 1, name: 'Beta (sintético)' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Hotel Uno');
  await expect(page.locator('main')).toContainText('desde, fechas del proveedor');
  await expect(page.locator('main')).toContainText('por persona');
  await expect(page.locator('main')).not.toContainText('Apartamentos Dos');
  await page.getByRole('radio', { name: 'Alojamiento + forfait' }).check();
  await expect(page.locator('main')).toContainText('Apartamentos Dos');
  await expect(page.locator('main')).not.toContainText('Hotel Uno');  // Forfait desconocido o contradictorio: ni en «Solo alojamiento» ni perdida; grupo propio con su aviso.
  await expect(page.locator('main')).not.toContainText('Hostal Tres');
  await page.getByRole('radio', { name: /Forfait sin confirmar/ }).check();
  await expect(page.locator('main')).toContainText('Hostal Tres');
  await expect(page.locator('main')).toContainText('Hotel Cuatro');
  await expect(page.locator('main')).toContainText('menciona forfait y «solo alojamiento/sin forfait» a la vez');
  await expect(page.locator('main')).not.toContainText('Apartamentos Dos');
  await page.getByRole('radio', { name: /Solo alojamiento/ }).check();
  await expect(page.locator('main')).toContainText('Hotel Uno');
  await expect(page.locator('main')).not.toContainText('Hostal Tres');
});

test('sin desbordamiento horizontal en las páginas nuevas', async ({ page, request }, info) => {
  // Fuentes es pública.
  await page.goto('/#/fuentes');
  await expect(page.getByRole('heading', { level: 1, name: 'Fuentes de datos' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page, `/fuentes sin sesión (${info.project.name})`);

  const { token } = await loggedIn(page, request, 'ovf');
  const trip = await newTrip(request, token, 'Viaje con un nombre bastante largo para comprobar el ajuste');
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Candidatura con un título largo para ver el ajuste en móvil', modality: 'lodging_forfait', amountCents: 123456, unit: 'per_stay' });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Artículo con un nombre muy largo para comprobar el ajuste', qty: 3 });

  const pages: [string, string][] = [
    ['/comparar', 'Comparar'],
    ['/comparar?origen=sabadell&modalidad=lodging_forfait', 'Comparar'],
    ['/estaciones/e2e-beta', 'Beta (sintético)'],
    ['/estaciones/e2e-dominio', 'Dominio Alfa (sintético)'],
    ['/estaciones/e2e-sin-ruta', 'Delta Sin Ruta (sintético)'],
    ['/fuentes', 'Fuentes de datos'],
    [`/viajes/${trip.id}`, 'Viaje con un nombre bastante largo para comprobar el ajuste'],
    [`/viajes/${trip.id}/presupuesto`, 'Presupuesto'],
    [`/viajes/${trip.id}/candidaturas`, 'Candidaturas y votos'],
    [`/viajes/${trip.id}/busquedas`, 'Búsquedas'],
    [`/viajes/${trip.id}/gastos`, 'Gastos'],
    [`/viajes/${trip.id}/comentarios`, 'Comentarios'],
    [`/compra?viaje=${trip.id}`, 'Compra'],
    ['/avisos', 'Avisos'],
    ['/admin', 'Página no disponible'],
  ];
  for (const [path, h1] of pages) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page, `${path} (${info.project.name})`);
  }
  // Una cuenta normal no ve la administración.
  await expect(page.locator('main')).not.toContainText('Salud de las fuentes');
});
