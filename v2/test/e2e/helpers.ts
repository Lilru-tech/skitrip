import { expect, type APIRequestContext, type Browser, type Page, type TestInfo } from '@playwright/test';

export const AUTH = 'http://127.0.0.1:9099';
export const BASE = 'http://localhost:5173';

let n = 0;
export const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${(n++).toString(36)}`;
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

/**
 * El Worker limita altas por IP (5/h). En local todas las peticiones salen de la misma IP,
 * así que cada página de prueba se presenta con una IP distinta vía CF-Connecting-IP
 * (miniflare solo la rellena si falta). Es exclusivo de las pruebas.
 */
export async function distinctIp(page: Page) {
  const ip = randomIp();
  await page.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }));
}

export async function newUserPage(browser: Browser, info: TestInfo) {
  const ctx = await browser.newContext({ ...contextOptions(info) });
  const page = await ctx.newPage();
  await distinctIp(page);
  return page;
}

export function contextOptions(info: TestInfo) {
  const u = info.project.use;
  return { baseURL: BASE, viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, locale: 'es-ES', timezoneId: 'Europe/Madrid' };
}

export interface TestUser { email: string; password: string; alias: string }
export const makeUser = (prefix: string): TestUser => {
  const id = uniq();
  return { email: `${prefix}-${id}@example.test`, password: `pw-${id}-segura`, alias: `${prefix}_${id}`.slice(0, 24) };
};

/** Alta completa desde la interfaz: registro + alias. */
export async function signUpUI(page: Page, u: TestUser) {
  await page.goto('/registro');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByLabel('Alias público').fill(u.alias);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible({ timeout: 20_000 });
}

export async function loginUI(page: Page, u: Pick<TestUser, 'email' | 'password'>) {
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible({ timeout: 20_000 });
}

/** Alta rápida por API (emulador + /api/me), para pruebas que no tratan del registro. */
export async function createUserViaApi(request: APIRequestContext, u: TestUser) {
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    data: { email: u.email, password: u.password, returnSecureToken: true },
  });
  expect(r.ok()).toBeTruthy();
  const { idToken } = await r.json();
  const me = await request.post(`${BASE}/api/me`, { data: { alias: u.alias }, headers: { Authorization: `Bearer ${idToken}`, 'CF-Connecting-IP': randomIp() } });
  expect(me.status()).toBe(201);
  return idToken as string;
}

export async function apiAs(request: APIRequestContext, token: string, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const r = await request.fetch(`${BASE}${path}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok(), `${method} ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

/** Primer año de la temporada (dic–abr) calculado desde hoy en Madrid, igual que la app. */
export function seasonStartYear(): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m] = today.split('-').map(Number);
  return m >= 12 ? y : m <= 4 ? y - 1 : y;
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw, `desbordamiento horizontal en ${label}: ${r.sw} > ${r.iw}`).toBeLessThanOrEqual(r.iw);
}

export async function waitToast(page: Page, text: string | RegExp) {
  await expect(page.locator('.toasts').getByText(text).first()).toBeVisible();
}
