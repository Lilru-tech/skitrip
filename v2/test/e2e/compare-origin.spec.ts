import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Origen personalizado con Geoapify simulado (test/e2e/geoapify-mock.mjs): dirección o punto del mapa, distancias al
// acceso de cada estación, privacidad (nada en la URL, recordar solo si se pide), errores y límites, y el coste del
// viaje desde esa salida con los peajes pendientes hasta indicarlos.

async function loggedIn(page: Page, request: APIRequestContext) {
  const u = makeUser('ori');
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return token;
}
const card = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
/** Teselas del mapa: imagen vacía local (las pruebas no salen a internet). */
const blankTiles = (page: Page) => page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png',
  body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));

test('desde una dirección: distancias al acceso, privada y recordada solo si se pide', async ({ page, request }, info) => {
  await loggedIn(page, request);
  await page.goto('/#/comparar');
  await expect(card(page, 'Dominio Alfa')).toContainText('190 km');

  await page.getByLabel('Salida desde').selectOption('personal');
  const picker = page.getByRole('region', { name: 'Origen personalizado' });
  await expect(picker).toContainText('se envían a Geoapify');
  await expect(picker).toContainText('Powered by Geoapify');
  // Sin punto confirmado no se muestran las distancias de un origen fijo como si fueran suyas.
  await expect(page.getByText('Elige y confirma tu punto de salida')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Estaciones dentro de la distancia' })).toHaveCount(0);

  await picker.getByLabel('Dirección o municipio de salida').fill('Reus');
  await picker.getByRole('button', { name: 'Buscar' }).click();
  await expect(picker.getByRole('radio', { name: /Reus, Baix Camp/ })).toBeChecked();
  await picker.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(picker).toContainText('Salida desde: Reus, Baix Camp, Tarragona, España');
  await expect(card(page, 'Dominio Alfa')).toContainText('180 km');
  await expect(card(page, 'Dominio Alfa')).not.toContainText('190 km');
  await expect(card(page, 'Épsilon')).toContainText('Sin acceso en coche: se sube en cremallera');
  await card(page, 'Dominio Alfa').locator('details.area-more > summary').click();
  await expect(card(page, 'Dominio Alfa')).toContainText('Aparcamiento Alfa (sintético)');
  // Nada de la dirección ni de las coordenadas en la URL.
  expect(page.url()).toContain('origen=personal');
  expect(page.url()).not.toMatch(/Reus|41\.15|1\.10/);
  await expectNoHorizontalOverflow(page, `origen personalizado (${info.project.name})`);

  // Sin «Recordar», se olvida al recargar.
  await page.reload();
  await expect(page.getByLabel('Dirección o municipio de salida')).toBeVisible();
  await expect(page.getByText('Elige y confirma tu punto de salida')).toBeVisible();

  // Con «Recordar en este navegador», sigue al recargar y se puede olvidar.
  await page.getByLabel('Dirección o municipio de salida').fill('Reus');
  await page.getByRole('button', { name: 'Buscar' }).click();
  // Se marca tocando el texto (en móvil, con el teclado recién cerrado, la vista visual queda desplazada unos px).
  await page.getByText('Recordar en este navegador (si no').click();
  await expect(page.getByLabel(/Recordar en este navegador/)).toBeChecked();
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(card(page, 'Dominio Alfa')).toContainText('180 km');
  await page.reload();
  await expect(card(page, 'Dominio Alfa')).toContainText('180 km');
  await page.getByRole('button', { name: 'Olvidar este origen' }).click();
  await expect(page.getByText('Elige y confirma tu punto de salida')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('skitrip.customOrigin.v1'))).toBeNull();
});

test('desde un punto del mapa; Reus frente a Tarragona', async ({ page, request }) => {
  await blankTiles(page);
  await loggedIn(page, request);
  await page.goto('/#/comparar?origen=personal');
  await page.getByRole('button', { name: 'Elegir un punto en el mapa' }).click();
  const map = page.getByTestId('origin-map');
  await expect(map).toBeVisible();
  // Mover el mapa no consulta nada; marcar un punto tampoco hasta confirmar.
  let geoCalls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/geo/routes')) geoCalls++; });
  await map.click();
  await expect(page.getByText(/Elegido: Punto del mapa \(\d+\.\d{3}, \d+\.\d{3}\)/)).toBeVisible();
  expect(geoCalls).toBe(0);
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(page.getByRole('region', { name: 'Origen personalizado' })).toContainText('Salida desde: Punto del mapa');
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+ km · \d+ h \d+ min aprox\./);
  expect(geoCalls).toBe(1);

  // Tarragona como dirección: sus km salen de su punto (179), no de la ruta fija guardada (190).
  await page.getByRole('button', { name: 'Cambiar origen' }).click();
  await page.getByLabel('Dirección o municipio de salida').fill('Tarragona');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(card(page, 'Dominio Alfa')).toContainText('179 km');
  await page.getByLabel('Salida desde').selectOption('tarragona');
  await expect(card(page, 'Dominio Alfa')).toContainText('190 km');
});

test('errores y límites del proveedor: se explican y se ofrecen los orígenes fijos', async ({ page, request }) => {
  await loggedIn(page, request);
  await page.goto('/#/comparar?origen=personal');
  const picker = page.getByRole('region', { name: 'Origen personalizado' });
  await picker.getByLabel('Dirección o municipio de salida').fill('calle error 1');
  await picker.getByRole('button', { name: 'Buscar' }).click();
  await expect(picker.getByRole('alert')).toContainText('El servicio de mapas no ha respondido');
  await expect(picker.getByRole('alert')).not.toContainText('calle error');

  await picker.getByLabel('Dirección o municipio de salida').fill('Nolugar');
  await picker.getByRole('button', { name: 'Buscar' }).click();
  await expect(picker).toContainText('No se ha encontrado esa dirección');

  await page.route('**/api/geo/routes', (r) => r.fulfill({ status: 429, json: { error: { code: 'geo_user_limit', message: 'Has llegado al límite diario de búsquedas y rutas del origen personalizado. Mañana se renueva; mientras tanto puedes usar Tarragona o Sabadell.' } } }));
  await picker.getByLabel('Dirección o municipio de salida').fill('Reus');
  await picker.getByRole('button', { name: 'Buscar' }).click();
  await picker.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(picker.getByRole('alert')).toContainText('límite diario');
  await expect(page.getByRole('list', { name: 'Estaciones dentro de la distancia' })).toHaveCount(0);
  await picker.getByRole('alert').getByRole('button', { name: 'Usar Sabadell' }).click();
  await expect(page.getByLabel('Salida desde')).toHaveValue('sabadell');
  await expect(card(page, 'Dominio Alfa')).toContainText('150 km');
});

test('coste del viaje desde otra salida: peajes del recorrido pendientes hasta indicarlos', async ({ page, request }) => {
  const token = await loggedIn(page, request);
  const future = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  const start = future(50), end = future(52);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Con coche', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 1 });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Alfa', modality: 'lodging', amountCents: 40000, areaId: 'e2e-dominio', forfaitIncluded: 'no',
    unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0,
    fuelCentsPerLitre: 150, litresPer100kmX10: 60, tollsCentsPerCar: 3000, parkingCentsPerCar: 0 });

  await page.goto(`/#/comparar?viaje=${trip.id}`);
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+,\d\d\s€/);
  await page.getByLabel('Salida desde').selectOption('personal');
  await page.getByLabel('Dirección o municipio de salida').fill('Reus');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  const ctx = page.getByRole('status', { name: 'Coste del viaje' });
  await expect(ctx).toContainText('Transporte desde Reus, Baix Camp, Tarragona, España, no desde la salida del viaje');
  await expect(ctx).toContainText('Los que no indiques quedan pendientes');
  await expect(card(page, 'Dominio Alfa')).toContainText('coste pendiente · falta: peajes');
  await ctx.getByLabel(/Peajes por coche hasta Dominio Alfa/).fill('0');
  await ctx.getByRole('button', { name: 'Aplicar peajes' }).click();
  await expect(ctx).toContainText('Peajes indicados en todos los recorridos.');
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+,\d\d\s€ · de «Hotel en Alfa»/);
});

test('peajes por recorrido: cada destino los suyos, sin dato pendiente y sin trasladarse a otra salida', async ({ page, request }, info) => {
  const token = await loggedIn(page, request);
  const future = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  const start = future(70), end = future(72);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Peajes por recorrido', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 1 });
  const cond = { modality: 'lodging', amountCents: 40000, forfaitIncluded: 'no', unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 };
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Alfa', areaId: 'e2e-dominio', ...cond });
  for (const [title, areaId] of [['Hotel en Beta', 'e2e-beta'], ['Hotel en Épsilon', 'e2e-cerrada']]) {
    await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title, areaId, forfaitCentsPerDay: 4000, rentalCentsPerDay: 0, parkingCentsPerCar: 0, ...cond });
  }
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0,
    fuelCentsPerLitre: 150, litresPer100kmX10: 60, tollsCentsPerCar: 3000, parkingCentsPerCar: 0 });
  const bodies: any[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/cost-comparison') && r.method() === 'POST') bodies.push(r.postDataJSON()); });

  await page.goto(`/#/comparar?viaje=${trip.id}`);
  const ctx = page.getByRole('status', { name: 'Coste del viaje' });
  // Salida del viaje: sus peajes; no se piden por recorrido.
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+,\d\d\s€ · de «Hotel en Alfa»/);
  await expect(ctx.getByRole('form', { name: 'Peajes por recorrido' })).toHaveCount(0);

  await page.getByLabel('Salida desde').selectOption('personal');
  await page.getByLabel('Dirección o municipio de salida').fill('Reus');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  const tolls = ctx.getByRole('form', { name: 'Peajes por recorrido' });
  const alfa = tolls.getByLabel(/hasta Dominio Alfa/), beta = tolls.getByLabel(/hasta Beta/), eps = tolls.getByLabel(/hasta Épsilon/);
  await expect(alfa).toHaveValue('');
  await expect(tolls).toContainText('Peajes indicados en 0 de 3 recorridos.');
  await alfa.fill('10');
  await beta.fill('30');
  await tolls.getByRole('button', { name: 'Aplicar peajes' }).click();
  await expect(tolls).toContainText('Peajes indicados en 2 de 3 recorridos.');
  // Cada recorrido con los suyos; el que no tiene dato queda pendiente (no toma los de otra estación ni los del viaje).
  await expect.poll(() => bodies.at(-1)?.tollsByArea).toEqual({ 'e2e-beta': 3000, 'e2e-dominio': 1000 });
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+,\d\d\s€ · de «Hotel en Alfa»/);
  await expect(card(page, 'Beta')).toContainText(/\d+,\d\d\s€ · de «Hotel en Beta»/);
  await expect(card(page, 'Épsilon')).toContainText('coste pendiente · falta: peajes');
  await expect(eps).toHaveValue('');
  await expectNoHorizontalOverflow(page, `peajes por recorrido (${info.project.name})`);

  // Otra salida: los importes de Reus no se trasladan; los campos muestran los de Sabadell (ninguno aún).
  await page.getByLabel('Salida desde').selectOption('sabadell');
  await expect(tolls.getByLabel(/hasta Dominio Alfa/)).toHaveValue('');
  await expect(tolls.getByLabel(/hasta Beta/)).toHaveValue('');
  await expect(tolls).toContainText('Peajes indicados en 0 de 3 recorridos.');
  await expect(card(page, 'Dominio Alfa')).toContainText('falta: peajes');
  await expect.poll(() => bodies.at(-1)).toEqual({ originId: 'sabadell', tollsByArea: {} });
  await tolls.getByLabel(/hasta Dominio Alfa/).fill('12');
  await tolls.getByRole('button', { name: 'Aplicar peajes' }).click();
  await expect(card(page, 'Dominio Alfa')).toContainText(/\d+,\d\d\s€ · de «Hotel en Alfa»/);

  // Volver a cada salida muestra sus propios importes en el campo visible.
  await page.getByLabel('Salida desde').selectOption('personal');
  await expect(tolls.getByLabel(/hasta Dominio Alfa/)).toHaveValue(/^10/);
  await expect(tolls.getByLabel(/hasta Beta/)).toHaveValue(/^30/);
  await page.getByLabel('Salida desde').selectOption('sabadell');
  await expect(tolls.getByLabel(/hasta Dominio Alfa/)).toHaveValue(/^12/);
  await expect(tolls.getByLabel(/hasta Beta/)).toHaveValue('');
  // Un punto nuevo del origen personalizado empieza sin peajes.
  await page.getByLabel('Salida desde').selectOption('personal');
  await page.getByRole('button', { name: 'Cambiar origen' }).click();
  await page.getByLabel('Dirección o municipio de salida').fill('Tarragona');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Calcular distancias desde aquí' }).click();
  await expect(tolls.getByLabel(/hasta Dominio Alfa/)).toHaveValue('');
  await expect(card(page, 'Dominio Alfa')).toContainText('falta: peajes');
});
