import { expect, test } from '@playwright/test';
import { AUTH, distinctIp, makeUser } from './helpers';

test('contraseña incorrecta muestra un error comprensible', async ({ page, request }) => {
  const u = makeUser('pw');
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    data: { email: u.email, password: u.password, returnSecureToken: true },
  });
  expect(r.ok()).toBeTruthy();
  await distinctIp(page);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill('no-es-la-buena');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.');
  await expect(page).toHaveURL(/\/entrar$/);
});

test('un usuario recién registrado sin alias debe elegirlo', async ({ page, request }) => {
  const u = makeUser('noalias');
  await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    data: { email: u.email, password: u.password, returnSecureToken: true },
  });
  await distinctIp(page);
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Elige tu alias' })).toBeVisible();
  await page.getByLabel('Alias público').fill('x');
  await page.getByRole('button', { name: 'Guardar alias' }).click();
  await expect(page.getByRole('alert')).toContainText('Entre 3 y 24 caracteres');
  await page.getByLabel('Alias público').fill(u.alias);
  await page.getByRole('button', { name: 'Guardar alias' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
  // Cerrar sesión desde el perfil.
  await page.goto('/perfil');
  await expect(page.getByText(u.email)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
});

test('la portada para visitantes solo ofrece entrar o crear cuenta', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Crear cuenta' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/GitHub|Actions|workflow/i);
  await expect(page.locator('img')).toHaveCount(0);
});
