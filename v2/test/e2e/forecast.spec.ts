import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Previsión para las fechas del viaje con Open-Meteo SIMULADO (test/e2e/geoapify-mock.mjs, ruta /meteo) y puntos de
// estaciones sintéticas (WEATHER_TEST_POINTS, solo con el emulador). No hay red ni datos reales.

const madrid = (days: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + days * 86400_000));
async function loggedIn(page: Page, request: APIRequestContext) {
  const u = makeUser('fct');
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return token;
}
const card = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });

test('ficha: resumen sencillo, detalle por modelo y día, altitud y atribución; fechas del viaje y fuera de horizonte', async ({ page, request }, info) => {
  const token = await loggedIn(page, request);
  await apiAs(request, token, 'POST', '/api/trips', { name: 'Escapada previsión', startDate: madrid(1), endDate: madrid(2), nights: 1, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-beta', cars: 0 });
  await page.goto('/#/estaciones/e2e-beta');
  const sec = page.getByTestId('forecast');
  await expect(sec.getByRole('heading', { name: 'Previsión para tus fechas' })).toBeVisible();
  await expect(sec.getByTestId('forecast-summary')).toContainText('Nieve nueva');
  await expect(sec.getByTestId('forecast-summary')).toContainText('modelos');
  // Detalle: cada modelo con su nombre, la altitud ajustada por Open-Meteo y la atribución.
  await sec.getByText('Ver detalles').click();
  const det = sec.getByTestId('forecast-detail-e2e-beta');
  await expect(det).toContainText('ECMWF IFS');
  await expect(det).toContainText('DWD ICON');
  await expect(det).toContainText('Ajustado por Open-Meteo a 2000 m');
  await expect(det).toContainText('SkiTrip no aplica correcciones propias');
  await expect(sec).toContainText('Open-Meteo.com (CC BY 4.0)');
  await expectNoHorizontalOverflow(page, `previsión ficha (${info.project.name})`);

  // Las fechas de un viaje del usuario se aplican con un toque.
  await sec.getByRole('button', { name: /Escapada previsión/ }).click();
  await expect(page).toHaveURL(new RegExp(`desde=${madrid(1)}&hasta=${madrid(2)}`));
  await expect(sec.getByTestId('forecast-summary')).toContainText('Nieve nueva');

  // Fuera de horizonte: el mensaje, sin ningún modelo.
  await page.goto(`/#/estaciones/e2e-beta?desde=${madrid(20)}&hasta=${madrid(22)}`);
  await expect(sec.getByTestId('forecast-summary')).toHaveText('Todavía no hay previsión disponible para estas fechas.');
});

test('dominio: una previsión por estación miembro, sin mezclarlas', async ({ page, request }) => {
  await loggedIn(page, request);
  await page.goto('/#/estaciones/e2e-dominio');
  const sec = page.getByTestId('forecast');
  await expect(sec.getByTestId('forecast-e2e-alfa-norte')).toContainText('Alfa Norte (sintético):');
  await expect(sec.getByTestId('forecast-e2e-alfa-sur')).toContainText('Alfa Sur (sintético):');
  await expect(sec.getByTestId('forecast-e2e-alfa-norte')).toContainText('Nieve nueva');
});

test('Comparar: previsión del viaje por estación desde la caché; sin punto o sin dato se dice', async ({ page, request }, info) => {
  const token = await loggedIn(page, request);
  await apiAs(request, token, 'POST', '/api/trips', { name: 'Comparar con previsión', startDate: madrid(1), endDate: madrid(2), nights: 1, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-beta', cars: 0 });
  // La ficha descarga el punto de Beta (Comparar solo lee lo guardado).
  await page.goto('/#/estaciones/e2e-beta');
  await expect(page.getByTestId('forecast-summary')).toContainText('Nieve nueva');
  await page.goto('/#/comparar');
  await expect(card(page, 'Beta')).not.toContainText('Previsión del viaje');
  await page.getByLabel('Coste por persona de').selectOption({ label: 'Comparar con previsión' });
  await expect(card(page, 'Beta')).toContainText('Previsión del viaje');
  await expect(page.getByTestId('cmp-forecast-e2e-beta')).toContainText('Nieve nueva');
  await expect(card(page, 'Épsilon')).toContainText('sin punto de previsión');
  await expectNoHorizontalOverflow(page, `comparar con previsión (${info.project.name})`);
});
