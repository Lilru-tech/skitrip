import { expect, test, type Page } from '@playwright/test';

// Recorrido real en https://lilru-tech.github.io/skitrip/ contra la API y Firebase de producción.
// Requiere PROD_URL, PROD_API, FIREBASE_API_KEY (pública) y RUN_ID. Las cuentas son de prueba y llevan el id de ejecución.
const URL = (process.env.PROD_URL ?? '').replace(/\/?$/, '/');
const API = (process.env.PROD_API ?? '').replace(/\/$/, '');
const KEY = process.env.FIREBASE_API_KEY ?? '';
const RUN = process.env.RUN_ID ?? `local${Date.now()}`;
// Solo para ensayarla en local contra el emulador; en producción es la API real de Firebase.
const IDT = (process.env.IDENTITY_URL ?? 'https://identitytoolkit.googleapis.com').replace(/\/$/, '');
test.skip(!URL || !API || !KEY, 'Solo se ejecuta con PROD_URL, PROD_API y FIREBASE_API_KEY (Actions).');

const user = (k: string) => ({ email: `prod-check-${RUN}-${k}@example.com`, password: `pc-${RUN}-${k}-Segura!`, alias: `pc${RUN.slice(-6)}${k}`.slice(0, 24) });
const go = (p: Page, hash: string) => p.goto(`${URL}#${hash}`);
const toast = (p: Page, t: string | RegExp) => expect(p.locator('.toasts').getByText(t).first()).toBeVisible();

async function signUp(p: Page, u: ReturnType<typeof user>) {
  await go(p, '/registro');
  await p.getByLabel('Email').fill(u.email);
  await p.getByLabel('Contraseña').fill(u.password);
  await p.getByLabel('Alias público').fill(u.alias);
  await p.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
}
async function idToken(u: ReturnType<typeof user>) {
  const r = await fetch(`${IDT}/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, returnSecureToken: true }),
  });
  expect(r.ok, `acceso de ${u.alias} en Firebase`).toBeTruthy();
  return ((await r.json()) as { idToken: string }).idToken;
}

// Limpieza al final, pase o falle: se borra el viaje de prueba (con sus datos) y las cuentas de Firebase.
// El perfil en D1 no tiene borrado por API: cada ejecución ocupa 3 de los MAX_PROFILES, con correo prod-check-….
let createdTrip: string | undefined;
test.afterAll(async () => {
  const tokens: (string | null)[] = [];
  for (const u of ['a', 'b', 'c'].map(user)) {
    const r = await fetch(`${IDT}/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.password, returnSecureToken: true }),
    });
    tokens.push(r.ok ? ((await r.json()) as { idToken: string }).idToken : null);
  }
  if (createdTrip && tokens[0]) {
    const r = await fetch(`${API}/api/trips/${createdTrip}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens[0]}` } });
    console.log(`limpieza: viaje de prueba borrado → HTTP ${r.status}`);
  }
  for (const t of tokens) {
    if (!t) continue;
    const r = await fetch(`${IDT}/v1/accounts:delete?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: t }) });
    console.log(`limpieza: cuenta de prueba de Firebase borrada → HTTP ${r.status}`);
  }
});

test('producción: registro, acceso, privacidad, amigos, viaje, calendario, compra y gastos', async ({ browser }) => {
  const [a, b, c] = ['a', 'b', 'c'].map(user);
  const ctx = () => browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const pa = await (await ctx()).newPage();
  const pb = await (await ctx()).newPage();
  const errors: string[] = [];
  for (const p of [pa, pb]) p.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CORS/i.test(m.text())) errors.push(m.text()); });

  // Registro real (Firebase + /api/me) de dos personas; la tercera solo por API para comprobar la privacidad.
  await signUp(pa, a);
  await signUp(pb, b);
  const rc = await fetch(`${IDT}/v1/accounts:signUp?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password, returnSecureToken: true }) });
  expect(rc.ok).toBeTruthy();
  const tc = ((await rc.json()) as { idToken: string }).idToken;
  expect((await fetch(`${API}/api/me`, { method: 'POST', headers: { Authorization: `Bearer ${tc}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: c.alias }) })).status).toBe(201);

  // Salida y acceso de nuevo.
  await go(pb, '/perfil');
  await pb.getByRole('button', { name: 'Cerrar sesión' }).click();
  // Sin sesión, una ruta privada lleva a la página de acceso.
  await expect(pb.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
  await go(pb, '/viajes');
  await expect(pb.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
  await pb.getByLabel('Email').fill(b.email);
  await pb.getByLabel('Contraseña').fill(b.password);
  await pb.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(pb.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();

  // Amistad.
  await go(pa, '/amigos');
  await pa.getByLabel('Alias', { exact: true }).fill(b.alias);
  await pa.getByRole('list', { name: 'Resultados de la búsqueda' }).getByRole('listitem').filter({ hasText: b.alias }).getByRole('button', { name: 'Enviar solicitud' }).click();
  await toast(pa, `Solicitud enviada a ${b.alias}.`);
  await go(pb, '/amigos');
  await pb.getByRole('button', { name: `Aceptar a ${a.alias}` }).click();
  await toast(pb, `Ahora eres amigo de ${a.alias}.`);

  // Calendario: compartir con amistades y marcar días libres.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const [yy, mm] = today.split('-').map(Number);
  const y = mm >= 12 ? yy : mm <= 4 ? yy - 1 : yy;
  const days = [`${y}-12-11`, `${y}-12-12`, `${y}-12-13`];
  for (const p of [pa, pb]) {
    await go(p, '/calendario?vista=compartir');
    await p.getByLabel('Todas mis amistades').check();
    await p.getByRole('button', { name: 'Guardar' }).click();
    await toast(p, 'Preferencias de compartición guardadas.');
    await go(p, '/calendario');
    await p.locator(`[data-date="${days[0]}"]`).click();
    await p.locator(`[data-date="${days[2]}"]`).click();
    await p.getByRole('region', { name: 'Aplicar estado a la selección' }).getByRole('button', { name: 'Libre' }).click();
    await toast(p, 'Guardado: 3 días como «libre».');
  }

  // Viaje e invitación.
  const tripName = `Prueba producción ${RUN}`;
  await go(pa, '/viajes');
  await pa.getByRole('button', { name: 'Nuevo viaje' }).click();
  const dialog = pa.getByRole('dialog', { name: 'Nuevo viaje' });
  await dialog.getByLabel('Nombre del viaje').fill(tripName);
  await dialog.getByLabel('Noches').fill('2');
  await dialog.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(pa.getByRole('heading', { level: 1, name: tripName })).toBeVisible();
  const tripId = /#\/viajes\/([^/?]+)/.exec(pa.url())?.[1];
  expect(tripId, 'id del viaje en la URL').toBeTruthy();
  createdTrip = tripId;
  await pa.getByLabel('Amigo', { exact: true }).selectOption({ label: b.alias });
  await pa.getByRole('button', { name: 'Enviar invitación' }).click();
  await toast(pa, `Invitación enviada a ${b.alias}.`);
  await go(pb, '/viajes');
  await pb.getByRole('button', { name: `Aceptar invitación a ${tripName}` }).click();
  await toast(pb, `Te has unido a «${tripName}».`);

  // Privacidad: sin token 401; una persona ajena no ve el viaje ni el calendario de otros.
  expect((await fetch(`${API}/api/trips`)).status).toBe(401);
  const foreign = await fetch(`${API}/api/trips/${tripId}`, { headers: { Authorization: `Bearer ${tc}` } });
  expect([403, 404]).toContain(foreign.status);
  const ta = await idToken(a);
  const own = await fetch(`${API}/api/trips/${tripId}`, { headers: { Authorization: `Bearer ${ta}` } });
  expect(own.status).toBe(200);

  // Compra.
  await go(pa, `/compra?viaje=${tripId}`);
  await pa.getByLabel('Artículo', { exact: true }).fill('Leche');
  await pa.getByLabel('Cantidad', { exact: true }).fill('2');
  await pa.getByRole('button', { name: 'Añadir', exact: true }).click();
  await toast(pa, 'Artículo añadido.');
  await expect(pa.getByRole('list', { name: 'Artículos' })).toContainText('Leche');

  // Gastos: 10 € entre dos, saldos que suman 0.
  await go(pa, `/viajes/${tripId}/gastos`);
  await pa.getByRole('button', { name: 'Nuevo gasto' }).click();
  const g = pa.getByRole('dialog', { name: 'Nuevo gasto' });
  await g.getByLabel('Concepto').fill('Supermercado');
  await g.getByLabel('Importe (€)').fill('10');
  await g.getByRole('button', { name: 'Guardar' }).click();
  await toast(pa, 'Gasto registrado.');
  const rows = pa.getByRole('list', { name: 'Saldo por persona' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  const cents = (await rows.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.balanceCents)))) as number[];
  expect(cents.reduce((s, v) => s + v, 0)).toBe(0);

  expect(errors, 'errores de CSP o CORS en la consola').toEqual([]);
});
