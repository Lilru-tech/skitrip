import { expect, test } from '@playwright/test';
import { BASE, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';
import { E2E_INGEST_TOKEN } from './env';
import { seasonLength, seasonStart } from '../../src/core/climate';

// Clima habitual con temporadas SINTÉTICAS enviadas por la ingesta local (credencial de prueba) para una estación
// sintética: ni Open-Meteo ni producción.

const season = (areaId: string, y: number) => {
  const n = seasonLength(y);
  const col = (v: number) => Array.from({ length: n }, () => v);
  return { areaId, season: y, requestedElevation: 2000, cell: { lat: 42.3, lon: 1.6, elevation: 1985 },
    series: { start: seasonStart(y), tmax: col(1), tmin: col(-7), precip: col(2), rain: col(0), snow: col(3), gust: col(30) } };
};

test('ficha: clima habitual ±7 días con los años que hay, separado de la previsión, y fuera de temporada', async ({ page, request }, info) => {
  const r = await request.post(`${BASE}/api/ingest/climate`, { headers: { Authorization: `Bearer ${E2E_INGEST_TOKEN}` }, data: { rows: [2015, 2016, 2017].map((y) => season('e2e-alfa-norte', y)) } });
  expect(r.status(), await r.text()).toBe(200);
  const u = makeUser('clm');
  await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);

  await page.goto('/#/estaciones/e2e-alfa-norte?desde=2027-01-15&hasta=2027-01-17');
  const sec = page.getByTestId('climate');
  await expect(sec.getByRole('heading', { name: 'Clima habitual en estas fechas' })).toBeVisible();
  await expect(sec).toContainText('No es una previsión.');
  const sum = sec.getByTestId('climate-summary');
  await expect(sum).toContainText('Máximas 1 °C (1 a 1)');
  await expect(sum).toContainText('nieve nueva ≥ 1 cm 51 de 51 días');
  await expect(sum).toContainText('(3 años)');
  await expect(sec).toContainText('Faltan 27 de 30 años');
  await sec.getByText('Ver detalles').click();
  await expect(sec).toContainText('Histórico reconstruido');
  await expect(sec).toContainText('ajustado por Open-Meteo a 1985 m');
  await expect(sec).toContainText('no la normal climatológica oficial');
  // La previsión sigue en su propia sección.
  await expect(page.getByTestId('forecast').getByRole('heading', { name: 'Previsión para tus fechas' })).toBeVisible();
  await expectNoHorizontalOverflow(page, `clima habitual (${info.project.name})`);

  await page.goto('/#/estaciones/e2e-alfa-norte?desde=2027-07-10&hasta=2027-07-12');
  await expect(sec.getByTestId('climate-summary')).toContainText('solo está preparado para la temporada de esquí');
  // Sin temporadas guardadas: se dice, sin ceros.
  await page.goto('/#/estaciones/e2e-beta?desde=2027-01-15&hasta=2027-01-17');
  await expect(sec.getByTestId('climate-summary')).toHaveText('Todavía no está preparado el histórico de este punto.');
});
