import { expect, test } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';

// Pesos «Condiciones meteorológicas» y «Afluencia histórica» en Comparar, con Open-Meteo SIMULADO y estaciones
// sintéticas. Empiezan a 0, se aplican a todas o a ninguna y dicen por qué no se aplican.

const madrid = (days: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + days * 86400_000));

test('a 0 por defecto; el tiempo se aplica con previsión próxima de todas y explica cuándo no; la afluencia no se aplica sin registros', async ({ page, request }, info) => {
  const u = makeUser('crt');
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  await apiAs(request, token, 'POST', '/api/trips', { name: 'Criterios cerca', startDate: madrid(1), endDate: madrid(2), nights: 1, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  await apiAs(request, token, 'POST', '/api/trips', { name: 'Criterios lejos', startDate: madrid(10), endDate: madrid(12), nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'e2e-dominio', cars: 0 });
  // La ficha del dominio descarga la previsión de sus dos estaciones (Comparar solo lee lo guardado).
  await page.goto('/#/estaciones/e2e-dominio');
  await expect(page.getByTestId('forecast-e2e-alfa-norte')).toContainText('Nieve nueva');

  await page.goto('/#/comparar');
  await page.getByLabel('Máximo por carretera (km)').fill('200'); // solo Dominio Alfa (190 km)
  await page.getByText('Pesos de la puntuación').click();
  await expect(page.getByLabel(/^Condiciones meteorológicas: 0$/)).toBeVisible();
  await expect(page.getByLabel(/^Afluencia histórica: 0$/)).toBeVisible();
  await expect(page.getByTestId('weather-criterion')).toContainText('Elige un viaje con fechas');

  await page.getByLabel('Coste por persona de').selectOption({ label: 'Criterios lejos' });
  await expect(page.getByTestId('weather-criterion')).toContainText('Tiempo: no se aplica');
  await expect(page.getByTestId('weather-criterion')).toContainText('El viaje empieza dentro de 10 días');

  await page.getByLabel('Coste por persona de').selectOption({ label: 'Criterios cerca' });
  await expect(page.getByTestId('weather-criterion')).toContainText('Tiempo: se aplica');
  await expect(page.getByTestId('crowd-criterion')).toContainText('Afluencia: no se aplica');
  await expect(page.getByTestId('crowd-criterion')).toContainText('Ninguna estación tiene la intensidad diaria');

  // Solo el tiempo: la puntuación del dominio es la de su estación más desfavorable (escala absoluta, ninguna falta).
  for (const k of ['Km de pistas', 'Cercanía', 'Ambiente']) await page.getByLabel(new RegExp(`^${k}:`)).fill('0');
  await page.getByLabel(/^Condiciones meteorológicas:/).fill('100');
  const card = page.getByRole('list', { name: 'Estaciones dentro de la distancia' }).locator(':scope > li').first();
  await expect(card).toContainText('Dominio Alfa');
  await expect(card).toContainText(/Puntuación \d/);
  await expect(card).not.toContainText('Falta:');
  await expectNoHorizontalOverflow(page, `criterios del viaje (${info.project.name})`);
});
