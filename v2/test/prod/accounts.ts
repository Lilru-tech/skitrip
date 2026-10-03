import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

// Cuentas de prueba de producción: prod-check-<ejecución>-<letra>@example.com. Cada recorrido usa sus letras
// (smoke a-c, calendario d-f). Requiere PROD_URL, PROD_API, FIREBASE_API_KEY (pública) y RUN_ID.
export const URL = (process.env.PROD_URL ?? '').replace(/\/?$/, '/');
export const API = (process.env.PROD_API ?? '').replace(/\/$/, '');
export const KEY = process.env.FIREBASE_API_KEY ?? '';
export const RUN = process.env.RUN_ID ?? `local${Date.now()}`;
// Solo para ensayarla en local contra el emulador; en producción es la API real de Firebase.
export const IDT = (process.env.IDENTITY_URL ?? 'https://identitytoolkit.googleapis.com').replace(/\/$/, '');
export const CONFIGURED = !!(URL && API && KEY && process.env.PROD_URL);

export const user = (k: string) => ({ email: `prod-check-${RUN}-${k}@example.com`, password: `pc-${RUN}-${k}-Segura!`, alias: `pc${RUN.replace(/\D/g, '').slice(-7)}${k}`.slice(0, 24) });
export type TestUser = ReturnType<typeof user>;
export const go = (p: Page, hash: string) => p.goto(`${URL}#${hash}`);
export const toast = (p: Page, t: string | RegExp) => expect(p.locator('.toasts').getByText(t).first()).toBeVisible();

// Manifiesto para la limpieza de D1 (tools/prod-cleanup.ts): se escribe ANTES de crear nada con los correos exactos
// de esta ejecución y se completa con los UID de Firebase al final. Cada recorrido añade lo suyo sin pisar lo de otro.
const MANIFEST = process.env.CLEANUP_MANIFEST ?? path.resolve('test-results-prod/cleanup-manifest.json');
export function recordAccounts(letters: string[], uids: Record<string, string> = {}) {
  mkdirSync(path.dirname(MANIFEST), { recursive: true });
  const prev: { runId: string; users: { email: string; uid?: string }[] } = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { runId: RUN, users: [] };
  const byEmail = new Map(prev.users.map((u) => [u.email, u]));
  for (const k of letters) { const email = user(k).email; byEmail.set(email, { email, ...(byEmail.get(email)?.uid ? { uid: byEmail.get(email)!.uid } : {}), ...(uids[k] ? { uid: uids[k] } : {}) }); }
  writeFileSync(MANIFEST, JSON.stringify({ runId: RUN, users: [...byEmail.values()] }, null, 2));
}

export async function signIn(u: TestUser): Promise<{ idToken: string; localId: string } | null> {
  const r = await fetch(`${IDT}/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, returnSecureToken: true }),
  });
  return r.ok ? ((await r.json()) as { idToken: string; localId: string }) : null;
}
export async function idToken(u: TestUser) {
  const s = await signIn(u);
  expect(s, `acceso de ${u.alias} en Firebase`).toBeTruthy();
  return s!.idToken;
}
export async function signUpUi(p: Page, u: TestUser) {
  await go(p, '/registro');
  await p.getByLabel('Email').fill(u.email);
  await p.getByLabel('Contraseña').fill(u.password);
  await p.getByLabel('Alias público').fill(u.alias);
  await p.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
}
export async function signUpApi(u: TestUser) {
  const r = await fetch(`${IDT}/v1/accounts:signUp?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, returnSecureToken: true }) });
  expect(r.ok).toBeTruthy();
  const token = ((await r.json()) as { idToken: string }).idToken;
  const me = await fetch(`${API}/api/me`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: u.alias }) });
  expect(me.status).toBe(201);
  return { token, id: ((await me.json()) as { profile: { id: string } }).profile.id };
}
export async function apiAs(token: string, method: string, p: string, body?: unknown) {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json: any = null;
  try { json = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, json };
}

/** Al final, pase o falle: borra los viajes de prueba y las cuentas de Firebase y anota los UID en el manifiesto.
 *  El perfil de D1 lo borra después el workflow con tools/prod-cleanup.ts. */
export async function cleanupAccounts(letters: string[], tripsByOwner: Record<string, string[]>) {
  const uids: Record<string, string> = {};
  for (const k of letters) {
    const s = await signIn(user(k));
    if (!s) continue;
    uids[k] = s.localId;
    for (const trip of tripsByOwner[k] ?? []) {
      const r = await fetch(`${API}/api/trips/${trip}`, { method: 'DELETE', headers: { Authorization: `Bearer ${s.idToken}` } });
      console.log(`limpieza: viaje de prueba borrado → HTTP ${r.status}`);
    }
    const r = await fetch(`${IDT}/v1/accounts:delete?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: s.idToken }) });
    console.log(`limpieza: cuenta de prueba de Firebase borrada → HTTP ${r.status}`);
  }
  recordAccounts(letters, uids);
}

/** Año de inicio de la temporada (dic–abr) en hora de Madrid. */
export function seasonYear() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const [yy, mm] = today.split('-').map(Number);
  return mm >= 12 ? yy : mm <= 4 ? yy - 1 : yy;
}
