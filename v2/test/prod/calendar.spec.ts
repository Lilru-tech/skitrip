import { expect, test, type Page } from '@playwright/test';
import { API, apiAs, cleanupAccounts, CONFIGURED, go, idToken, recordAccounts, RUN, seasonYear, signUpApi, signUpUi, toast, user } from './accounts';

// Calendario compartido de punta a punta en producción con tres cuentas de prueba (d, e, f):
// amistad aceptada, disponibilidades distintas (libre, quizá, ocupado y sin indicar), compartir con amistades,
// coincidencias y detalle por persona, propuesta de fechas y su uso en el viaje, compartir solo con un viaje,
// revocación y acceso ajeno rechazado. No toca la disponibilidad de nadie más ni invita a cuentas reales.
test.skip(!CONFIGURED, 'Solo se ejecuta con PROD_URL, PROD_API y FIREBASE_API_KEY (Actions).');

const LETTERS = ['d', 'e', 'f'];
test.beforeAll(() => recordAccounts(LETTERS));
let createdTrip: string | undefined;
test.afterAll(async () => { await cleanupAccounts(LETTERS, { d: createdTrip ? [createdTrip] : [] }); });

async function mark(p: Page, from: string, to: string, label: 'Libre' | 'Quizá' | 'Ocupado') {
  const apply = p.getByRole('region', { name: 'Aplicar estado a la selección' }).getByRole('button', { name: label });
  // Selección limpia: un clic empieza un rango y el siguiente lo cierra. Si el calendario se vuelve a pintar al llegar
  // los datos, la selección se pierde (pasó en producción el 03/10/2026): se recarga y se repite, nunca se re-clica
  // sobre una selección a medias.
  await expect(async () => {
    await go(p, '/calendario');
    await p.waitForLoadState('networkidle');
    await p.locator(`[data-date="${from}"]`).first().click();
    if (to !== from) await p.locator(`[data-date="${to}"]`).first().click();
    await expect(apply).toBeEnabled({ timeout: 3000 });
  }).toPass({ timeout: 45_000 });
  await apply.click();
  await expect(p.locator('.toasts')).toContainText('Guardado');
}
async function share(p: Page, friends: boolean) {
  await go(p, '/calendario?vista=compartir');
  const box = p.getByLabel('Todas mis amistades');
  if (friends) await box.check(); else await box.uncheck();
  await p.getByRole('button', { name: 'Guardar' }).click();
  await toast(p, 'Preferencias de compartición guardadas.');
}

test('producción: calendario compartido con amistad, viaje, propuesta, revocación y acceso ajeno', async ({ browser }) => {
  const [d, e, f] = LETTERS.map(user);
  const ctx = () => browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const pd = await (await ctx()).newPage();
  const pe = await (await ctx()).newPage();
  const y = seasonYear();
  const day = (n: number) => `${y}-12-${String(n).padStart(2, '0')}`;
  const range = `from=${day(1)}&to=${day(31)}`;

  await signUpUi(pd, d);
  await signUpUi(pe, e);
  const F = await signUpApi(f);               // persona ajena: ni amiga ni del viaje
  const td = await idToken(d), te = await idToken(e);
  const D = (await apiAs(td, 'GET', '/api/me')).json.profile.id as string;
  const E = (await apiAs(te, 'GET', '/api/me')).json.profile.id as string;

  // Amistad aceptada (interfaz).
  await go(pd, '/amigos');
  await pd.getByLabel('Alias', { exact: true }).fill(e.alias);
  await pd.getByRole('list', { name: 'Resultados de la búsqueda' }).getByRole('listitem').filter({ hasText: e.alias }).getByRole('button', { name: 'Enviar solicitud' }).click();
  await toast(pd, `Solicitud enviada a ${e.alias}.`);
  await go(pe, '/amigos');
  await pe.getByRole('button', { name: `Aceptar a ${d.alias}` }).click();
  await toast(pe, `Ahora eres amigo de ${d.alias}.`);

  // Disponibilidades distintas (interfaz). d: 11-13 libre, 14 quizá. e: 11-12 libre, 13 quizá, 15 ocupado; 14 sin indicar.
  await go(pd, '/calendario');
  await mark(pd, day(11), day(13), 'Libre');
  await mark(pd, day(14), day(14), 'Quizá');
  await go(pe, '/calendario');
  await mark(pe, day(11), day(12), 'Libre');
  await mark(pe, day(13), day(13), 'Quizá');
  await mark(pe, day(15), day(15), 'Ocupado');
  await expect(pe.locator(`[data-date="${day(15)}"]`).first()).toHaveAttribute('aria-label', /: ocupado$/);

  // Sin compartir todavía: d no ve los días de e.
  let view = (await apiAs(td, 'GET', `/api/availability/common?${range}&ids=${E}`)).json;
  expect(view.people.find((x: any) => x.id === E).shared).toBe(false);

  // Compartir con amistades (interfaz) y coincidencias en la vista común con detalle por persona.
  await share(pe, true);
  await share(pd, true);
  view = (await apiAs(td, 'GET', `/api/availability/common?${range}&ids=${E}&nights=2`)).json;
  const eDays = view.people.find((x: any) => x.id === E);
  expect(eDays.shared).toBe(true);
  expect(eDays.days[day(11)]).toBe('free');
  expect(eDays.days[day(13)]).toBe('maybe');
  expect(eDays.days[day(15)]).toBe('busy');
  expect(eDays.days[day(14)]).toBeUndefined();          // sin indicar: no se inventa
  // 11→13 incluye la salida: e tiene el 13 en «quizá», así que encaja con «quizá» pero no con todos libres.
  const w1113 = view.windows.find((w: any) => w.start === day(11) && w.end === day(13));
  expect(w1113).toMatchObject({ meetsWithFree: false, meetsWithMaybe: true });
  expect(w1113.maybe).toContain(E);
  expect(w1113.free).toContain(D);
  await go(pd, '/calendario?vista=grupo');
  await pd.getByRole('group', { name: /Personas en la vista común/ }).getByLabel(new RegExp(e.alias)).check();
  await pd.locator(`[data-date="${day(13)}"]`).last().click();
  const detail = pd.getByRole('region', { name: 'Detalle de la selección' });
  await expect(detail).toContainText('Quizá (sin confirmar)');
  await expect(detail).toContainText(e.alias);
  await pd.getByRole('button', { name: 'Cerrar detalle' }).click();
  await pd.locator(`[data-date="${day(14)}"]`).last().click();
  await expect(detail).toContainText('Sin indicar');

  // Viaje: d lo crea e invita a e (interfaz); propuesta de fechas, voto y uso en el viaje.
  const tripName = `Calendario producción ${RUN}`;
  await go(pd, '/viajes');
  await pd.getByRole('button', { name: 'Nuevo viaje' }).click();
  const dialog = pd.getByRole('dialog', { name: 'Nuevo viaje' });
  await dialog.getByLabel('Nombre del viaje').fill(tripName);
  await dialog.getByLabel('Noches').fill('2');
  await dialog.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(pd.getByRole('heading', { level: 1, name: tripName })).toBeVisible();
  const tripId = /#\/viajes\/([^/?]+)/.exec(pd.url())?.[1];
  expect(tripId).toBeTruthy();
  createdTrip = tripId;
  await pd.getByLabel('Amigo', { exact: true }).selectOption({ label: e.alias });
  await pd.getByRole('button', { name: 'Enviar invitación' }).click();
  await toast(pd, `Invitación enviada a ${e.alias}.`);
  await go(pe, '/viajes');
  await pe.getByRole('button', { name: `Aceptar invitación a ${tripName}` }).click();
  await toast(pe, `Te has unido a «${tripName}».`);

  await go(pd, `/viajes/${tripId}/calendario`);
  await expect(pd.getByRole('heading', { level: 1, name: 'Calendario del viaje' })).toBeVisible();
  const proposals = pd.getByRole('region', { name: 'Propuestas de fechas' });
  await proposals.getByLabel('Llegada').fill(day(11));
  await proposals.getByLabel('Salida').fill(day(13));
  await proposals.getByRole('button', { name: 'Proponer fechas' }).click();
  await toast(pd, /Fechas propuestas/);
  await pd.getByRole('group', { name: /Tu voto para/ }).first().getByRole('button', { name: 'Sí' }).click();
  await toast(pd, 'Voto guardado: Sí.');
  await go(pe, `/viajes/${tripId}/calendario`);
  await pe.getByRole('group', { name: /Tu voto para/ }).first().getByRole('button', { name: 'Quizá' }).click();
  await toast(pe, 'Voto guardado: Quizá.');
  // Un miembro sin permiso de edición no puede fijar fechas.
  await expect(pe.getByRole('button', { name: /como fechas del viaje/ })).toHaveCount(0);
  await pd.reload();
  await pd.getByRole('button', { name: /como fechas del viaje/ }).first().click();
  await toast(pd, /Fechas del viaje:/);
  await expect(pd.getByText('Son las fechas del viaje.')).toBeVisible();
  const trip = (await apiAs(td, 'GET', `/api/trips/${tripId}`)).json.trip;
  expect([trip.startDate, trip.endDate, trip.nights]).toEqual([day(11), day(13), 2]);

  // Compartir solo con el viaje: e deja de compartir con amistades pero sigue visible en el viaje.
  expect((await apiAs(te, 'PUT', '/api/availability/shares', { friends: false, tripIds: [tripId] })).status).toBe(200);
  const tripView = (await apiAs(td, 'GET', `/api/availability/trip/${tripId}?${range}&nights=2`)).json;
  expect(tripView.people.find((x: any) => x.id === E)?.days?.[day(11)]).toBe('free');
  expect(tripView.windows.some((w: any) => w.start === day(11) && w.end === day(13))).toBe(true);

  // Revocación total (interfaz): d deja de ver los días de e en la vista común y en el viaje.
  await go(pe, '/calendario?vista=compartir');
  await pe.getByLabel('Todas mis amistades').uncheck();
  await pe.getByLabel(tripName).uncheck();
  await pe.getByRole('button', { name: 'Guardar' }).click();
  await toast(pe, 'Preferencias de compartición guardadas.');
  view = (await apiAs(td, 'GET', `/api/availability/common?${range}&ids=${E}`)).json;
  expect(view.people.find((x: any) => x.id === E)).toMatchObject({ shared: false, days: null });
  const afterTrip = (await apiAs(td, 'GET', `/api/availability/trip/${tripId}?${range}&nights=2`)).json;
  const ePerson = (afterTrip.people ?? []).find((x: any) => x.id === E);
  expect(ePerson?.days ?? null).toBeNull();

  // Acceso ajeno rechazado: f no es amiga ni miembro.
  expect([403, 404]).toContain((await apiAs(F.token, 'GET', `/api/availability/trip/${tripId}?${range}`)).status);
  expect([403, 404]).toContain((await apiAs(F.token, 'GET', `/api/trips/${tripId}`)).status);
  const fView = (await apiAs(F.token, 'GET', `/api/availability/common?${range}&ids=${D}`)).json;
  expect(fView.people?.find((x: any) => x.id === D)?.days ?? null).toBeNull();
  expect((await fetch(`${API}/api/availability/common?${range}&ids=${D}`)).status).toBe(401);

  // Ningún correo ajeno en pantalla.
  await expect(pd.locator('body')).not.toContainText(e.email);
  await expect(pe.locator('body')).not.toContainText(d.email);
});
