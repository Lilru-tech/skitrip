import { expect, test } from '@playwright/test';
import { distinctIp, expectNoHorizontalOverflow, makeUser, signUpUI } from './helpers';

// Comparador de km esquiables entre temporadas con los datos sintéticos de test/e2e/seed.sql: Beta tiene un parte del
// 10/02/2025 (30 de 90 km) y dos ceros del SkiTrip antiguo (10 y 11/02/2026), que no son cifra.
test.beforeEach(async ({ page }) => {
  await distinctIp(page);
  await signUpUI(page, makeUser('km'));
});

test('ficha: km de las mismas fechas en otras temporadas, «0 o sin dato», «Sin dato» y cambio de fechas', async ({ page }) => {
  await page.goto('/#/estaciones/e2e-beta?kmdesde=02-10&kmhasta=02-12');
  const box = page.getByTestId('km-compare');
  await expect(box.getByRole('heading', { name: 'Comparar con otros años' })).toBeVisible();
  const seasons = box.getByTestId('km-season');
  await expect(seasons.filter({ hasText: '2024-25' })).toContainText('30 km de media (1 de 3 días con dato)');
  await expect(seasons.filter({ hasText: '2025-26' })).toContainText('Sin dato en los 3 días (2 con «0 o sin dato»)');
  await box.getByText('Ver día a día').click();
  const table = box.getByRole('table');
  await expect(table.getByRole('row', { name: /^10\/02/ })).toContainText('0 o sin dato');
  await expect(table.getByRole('row', { name: /^10\/02/ })).toContainText('30 km de 90');
  await box.getByText('Ver detalles').click();
  await expect(box).toContainText('no predice lo que habrá');
  await expectNoHorizontalOverflow(page, 'comparador de km');

  // Un solo día: el resumen dice la fecha completa; otra fecha sin datos no deja cifras anteriores a la vista.
  await box.getByLabel('Hasta').fill(await box.getByLabel('Desde').inputValue());
  await expect(page).not.toHaveURL(/kmhasta/);
  await expect(seasons.filter({ hasText: '2024-25' })).toContainText('lunes 10 de febrero de 2025: 30 km de 90');
  const d = await box.getByLabel('Desde').inputValue();
  await box.getByLabel('Desde').fill(d.slice(0, 5) + '03-20');
  await expect(page).toHaveURL(/kmdesde=03-20/);
  await expect(box).not.toContainText('30 km');
  await expect(seasons.filter({ hasText: '2024-25' })).toContainText('Sin dato');

  // Intervalo al revés o demasiado largo: aviso, sin consulta.
  await page.goto('/#/estaciones/e2e-beta?kmdesde=03-10&kmhasta=02-01');
  await expect(page.getByTestId('km-compare').getByRole('alert')).toContainText('como máximo 31 días');
});

test('estación sin ningún parte: «Sin dato» sin temporadas', async ({ page }) => {
  await page.goto('/#/estaciones/e2e-alfa-norte?kmdesde=01-10');
  await expect(page.getByTestId('km-compare-empty')).toContainText('todavía no hay ningún parte guardado');
});
