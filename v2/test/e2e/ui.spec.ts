import { expect, test, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, seasonStartYear } from './helpers';

async function loggedIn(page: Page, request: import('@playwright/test').APIRequestContext) {
  const u = makeUser('ui');
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}

test('sin desbordamiento horizontal en las páginas principales', async ({ page, request }, info) => {
  // Páginas públicas.
  for (const path of ['/', '/entrar', '/registro', '/recuperar']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoHorizontalOverflow(page, `${path} (${info.project.name})`);
  }
  const { token } = await loggedIn(page, request);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Viaje con un nombre bastante largo para comprobar el ajuste', nights: 3, budgetCents: 42000 });

  const pages: [string, string][] = [
    ['/viajes', 'Mis viajes'],
    [`/viajes/${trip.id}`, 'Viaje con un nombre bastante largo para comprobar el ajuste'],
    [`/viajes/${trip.id}/calendario`, 'Calendario del viaje'],
    ['/calendario', 'Calendario'],
    ['/calendario?vista=grupo', 'Calendario'],
    ['/calendario?vista=compartir', 'Calendario'],
    ['/amigos', 'Amigos'],
    ['/perfil', 'Tu perfil'],
    ['/comparar', 'Comparar'],
    ['/compra', 'Compra'],
  ];
  for (const [path, h1] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page, `${path} (${info.project.name})`);
  }
  // Con una selección activa aparece la barra de acciones: tampoco debe desbordar.
  await page.goto('/calendario');
  const y = seasonStartYear();
  await page.locator(`[data-date="${y}-12-01"]`).click();
  await expect(page.getByRole('region', { name: 'Aplicar estado a la selección' })).toBeVisible();
  await expectNoHorizontalOverflow(page, `/calendario con selección (${info.project.name})`);
});

test('las secciones aún no disponibles lo dicen sin inventar datos', async ({ page, request }) => {
  await loggedIn(page, request);
  for (const path of ['/comparar', '/compra']) {
    await page.goto(path);
    await expect(page.getByText('Sección en construcción')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('€');
  }
});

test('el calendario se maneja solo con teclado', async ({ page, request }) => {
  await loggedIn(page, request);
  await page.goto('/calendario');
  await expect(page.getByRole('grid').first()).toBeVisible();

  // Tabulador hasta la rejilla (una sola parada gracias al tabindex itinerante).
  let date: string | undefined;
  for (let i = 0; i < 40 && !date; i++) {
    await page.keyboard.press('Tab');
    date = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date);
  }
  const y = seasonStartYear();
  expect(date).toBe(`${y}-12-01`);

  const active = () => page.evaluate(() => (document.activeElement as HTMLElement).dataset.date);
  await page.keyboard.press('ArrowRight');
  expect(await active()).toBe(`${y}-12-02`);
  await page.keyboard.press('ArrowDown');
  expect(await active()).toBe(`${y}-12-09`);
  await page.keyboard.press('ArrowUp');
  expect(await active()).toBe(`${y}-12-02`);

  // Mayús + flechas amplía el rango.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(3);

  // Escape limpia; Espacio inicia (en el día 4, donde está el foco) e Intro cierra el rango en el 6.
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(3);

  // Tab lleva a la barra de acciones; se aplica «quizá» con el teclado.
  let label = '';
  for (let i = 0; i < 10 && label !== 'Quizá'; i++) {
    await page.keyboard.press('Tab');
    label = (await page.evaluate(() => document.activeElement?.textContent?.replace('?', '').trim() ?? '')) as string;
  }
  expect(label).toBe('Quizá');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toasts')).toContainText('Guardado: 3 días como «quizá».');
  for (const d of ['04', '05', '06']) {
    await expect(page.locator(`[data-date="${y}-12-${d}"]`)).toHaveAttribute('aria-label', new RegExp(`^[a-záéíóú]+ ${Number(d)} de diciembre: quizá$`));
  }
  // Lo no marcado sigue «sin indicar», nunca libre.
  await expect(page.locator(`[data-date="${y}-12-07"]`)).toHaveAttribute('aria-label', /: sin indicar$/);
  await expect(page.locator(`[data-date="${y}-12-02"]`)).toHaveAttribute('aria-label', /: sin indicar$/);
  // El foco es visible.
  await page.locator(`[data-date="${y}-12-07"]`).focus();
  const shadow = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
  expect(shadow).not.toBe('none');
});

test('el foco vuelve al botón que abrió el diálogo', async ({ page, request }) => {
  await loggedIn(page, request);
  await page.goto('/viajes');
  const trigger = page.getByRole('button', { name: 'Nuevo viaje' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo viaje' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Nombre del viaje')).toBeFocused();
  // Datos a medias: si se cierra con Escape, el foco vuelve al disparador.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Con el botón Cerrar.
  await trigger.click();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(trigger).toBeFocused();

  // Patrón semanal del calendario.
  await page.goto('/calendario');
  const pattern = page.getByRole('button', { name: 'Patrón semanal…' });
  await pattern.click();
  const pd = page.getByRole('dialog', { name: 'Patrón semanal' });
  await expect(pd).toBeVisible();
  await pd.getByRole('button', { name: 'Cancelar' }).click();
  await expect(pattern).toBeFocused();
});

test('patrón semanal: viernes y sábados libres con excepciones', async ({ page, request }) => {
  await loggedIn(page, request);
  await page.goto('/calendario');
  await page.getByRole('button', { name: 'Patrón semanal…' }).click();
  const pd = page.getByRole('dialog', { name: 'Patrón semanal' });
  await expect(pd.getByLabel('viernes')).toBeChecked();
  await expect(pd.getByLabel('sábado')).toBeChecked();
  await pd.getByRole('button', { name: /Aplicar a \d+ días/ }).click();
  await expect(page.locator('.toasts')).toContainText('Patrón aplicado');
  const y = seasonStartYear();
  // Primer viernes de diciembre de la temporada.
  const firstFri = [...Array(7)].map((_, i) => `${y}-12-0${i + 1}`).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5)!;
  await expect(page.locator(`[data-date="${firstFri}"]`)).toHaveAttribute('aria-label', /: libre$/);
  // Excepción: ese viernes, ocupado.
  await page.locator(`[data-date="${firstFri}"]`).click();
  await page.getByRole('region', { name: 'Aplicar estado a la selección' }).getByRole('button', { name: 'Ocupado' }).click();
  await expect(page.locator(`[data-date="${firstFri}"]`)).toHaveAttribute('aria-label', /: ocupado$/);
});
