import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Coste por persona en los pesos de Comparar con un viaje elegido: presupuestos completos para las mismas fechas y
// condiciones, la más barata por estación con su origen, y «coste pendiente» (nunca 0 €) donde falta algo.

const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
async function loggedIn(page: Page, request: APIRequestContext) {
  const u = makeUser('ccw');
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return token;
}
const card = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });

test('el coste del viaje puntúa con presupuestos completos; lo incompleto queda pendiente', async ({ page, request }, info) => {
  const token = await loggedIn(page, request);
  const start = future(50), end = future(52);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Coste en pesos', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  const cond = { unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 };
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Alfa', modality: 'lodging', amountCents: 40000, areaId: 'e2e-dominio', forfaitIncluded: 'no', ...cond });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel caro en Alfa', modality: 'lodging', amountCents: 60000, areaId: 'e2e-dominio', forfaitIncluded: 'no', ...cond });
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Paquete en Beta', modality: 'lodging_forfait', amountCents: 50000, areaId: 'e2e-beta', forfaitIncluded: 'yes', forfaitDays: 2, ...cond });
  // Épsilon: sin precio de forfait de esa estación y precio «desde»: incompleto.
  await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel en Épsilon', modality: 'lodging', amountCents: 10000, areaId: 'e2e-cerrada', forfaitIncluded: 'no', ...cond, priceKind: 'advertised_from' });
  const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
  await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0 });

  // Sin viaje: el coste no aparece ni puntúa.
  await page.goto('/#/comparar');
  await expect(page.getByLabel('Coste: 40')).toHaveCount(0);
  await expect(card(page, 'Beta')).not.toContainText('Coste por persona');

  await page.getByLabel('Coste por persona de').selectOption({ label: 'Coste en pesos' });
  const ctx = page.getByRole('status', { name: 'Coste del viaje' });
  await expect(ctx).toContainText('Coste por persona de «Coste en pesos»');
  await expect(ctx).toContainText('2 noches · 2 personas · 1 habitación · 2 días de forfait');
  await expect(card(page, 'Dominio Alfa')).toContainText('280,00 €');
  await expect(card(page, 'Dominio Alfa')).toContainText('de «Hotel en Alfa» (alojamiento + forfait aparte), la más barata de 2 completas');
  await expect(card(page, 'Beta')).toContainText('250,00 €');
  await expect(card(page, 'Beta')).toContainText('(paquete con forfait), calculado en esta estación sin cambiar el viaje');
  await expect(card(page, 'Épsilon')).toContainText('coste pendiente · falta: alojamiento');
  await expect(card(page, 'Épsilon')).toContainText('Falta: coste (puntúa 0)');
  await expect(card(page, 'Épsilon')).not.toContainText('0,00 €');
  // El criterio de coste aparece en los pesos.
  await page.getByText('Pesos de la puntuación').click();
  await expect(page.getByLabel(/^Coste: 40$/)).toBeVisible();
  await expectNoHorizontalOverflow(page, `comparar con coste (${info.project.name})`);

  // Solo con el coste: Beta (más barata) primero; Épsilon (pendiente) nunca por delante de una completa.
  for (const k of ['Nieve abierta ahora', 'Km de pistas', 'Cercanía', 'Ambiente']) await page.getByLabel(new RegExp(`^${k}:`)).fill('0');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  await expect(near.locator(':scope > li').nth(0)).toContainText('Beta');
  await expect(near.locator(':scope > li').nth(1)).toContainText('Dominio Alfa');
  await expect(near.locator(':scope > li').nth(2)).toContainText('Épsilon');
});

test('sin fechas o días de esquí el coste no se activa y se explica qué falta', async ({ page, request }) => {
  const token = await loggedIn(page, request);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Viaje sin fechas', nights: 2 });
  await page.goto(`/#/comparar?viaje=${trip.id}`);
  const ctx = page.getByRole('status', { name: 'Coste del viaje' });
  await expect(ctx).toContainText('El coste no puntúa todavía: al viaje le faltan fechas de llegada y salida, días de esquí.');
  await expect(card(page, 'Beta')).toContainText('coste pendiente · sin candidaturas del viaje en esta estación');
  await page.getByText('Pesos de la puntuación').click();
  await expect(page.getByLabel(/^Coste:/)).toHaveCount(0);
});

// Regresión: al cambiar de viaje o de salida, los importes anteriores no se muestran ni puntúan bajo la selección
// nueva. Mientras llega la respuesta (retrasada aquí a propósito) el coste queda pendiente; si falla, también.
async function twoTrips(request: APIRequestContext, token: string) {
  const start = future(60), end = future(62);
  const cond = { unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 };
  const make = async (name: string, amountCents: number) => {
    const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name, startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
    await apiAs(request, token, 'POST', `/api/trips/${trip.id}/candidates`, { title: `Hotel de ${name}`, modality: 'lodging', amountCents, areaId: 'e2e-dominio', forfaitIncluded: 'no', ...cond });
    const b0 = await apiAs(request, token, 'GET', `/api/trips/${trip.id}/budget`);
    await apiAs(request, token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0 });
    return trip as { id: string };
  };
  return { a: await make('Viaje A', 40000), b: await make('Viaje B', 60000) };
}
/** Retiene las respuestas de coste de un viaje hasta llamar a `release()`. */
async function holdCosts(page: Page, tripId: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(`**/api/trips/${tripId}/cost-comparison`, async (r) => { await gate; await r.continue(); });
  return { release, stop: () => page.unroute(`**/api/trips/${tripId}/cost-comparison`) };
}
const failCosts = (page: Page, tripId: string) => page.route(`**/api/trips/${tripId}/cost-comparison`,
  (r) => r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'Error de prueba.' } } }));

test('al cambiar de viaje no se reutilizan los costes del anterior (respuesta retrasada y error)', async ({ page, request }) => {
  const token = await loggedIn(page, request);
  const { a, b } = await twoTrips(request, token);
  await page.goto(`/#/comparar?viaje=${a.id}`);
  const alfa = card(page, 'Dominio Alfa');
  await expect(alfa).toContainText('280,00 €');

  const held = await holdCosts(page, b.id);
  await page.getByLabel('Coste por persona de').selectOption({ label: 'Viaje B' });
  await expect(alfa).toContainText('coste pendiente · calculando');
  await expect(alfa).not.toContainText('280,00 €');
  await page.getByText('Pesos de la puntuación').click();
  await expect(page.getByLabel(/^Coste:/)).toHaveCount(0);
  held.release();
  await expect(alfa).toContainText('380,00 €');
  await expect(page.getByLabel(/^Coste:/)).toBeVisible();
  await held.stop();

  await failCosts(page, a.id);
  await page.getByLabel('Coste por persona de').selectOption({ label: 'Viaje A' });
  await expect(page.getByRole('status', { name: 'Coste del viaje' })).toContainText('El coste queda pendiente: no se usan importes de otra selección');
  await expect(alfa).toContainText('coste pendiente · no se ha podido calcular');
  await expect(alfa).not.toContainText(/[23]80,00 €/);
  await expect(page.getByLabel(/^Coste:/)).toHaveCount(0);
});

test('al cambiar de salida el coste espera a su respuesta y, si falla, queda pendiente', async ({ page, request }) => {
  const token = await loggedIn(page, request);
  const { a } = await twoTrips(request, token);
  await page.goto(`/#/comparar?viaje=${a.id}`);
  const alfa = card(page, 'Dominio Alfa');
  await expect(alfa).toContainText('280,00 €');

  const held = await holdCosts(page, a.id);
  await page.getByLabel('Salida desde').selectOption('sabadell');
  await expect(alfa).toContainText('150 km');
  await expect(alfa).toContainText('coste pendiente · calculando');
  await expect(alfa).not.toContainText('280,00 €');
  held.release();
  await expect(alfa).toContainText('280,00 €');
  await held.stop();

  await failCosts(page, a.id);
  await page.getByLabel('Salida desde').selectOption('tarragona');
  await expect(alfa).toContainText('190 km');
  await expect(alfa).toContainText('coste pendiente · no se ha podido calcular');
  await expect(alfa).not.toContainText('280,00 €');
});
