import { expect, test, type APIRequestContext } from '@playwright/test';
import { AUTH, BASE, distinctIp, expectNoHorizontalOverflow, loginUI } from './helpers';

// Afluencia histórica con datos sintéticos: cada proyecto de Playwright usa su propia estación de test/e2e/seed.sql y
// añade sus observaciones por la API de administración (la D1 de E2E se recrea en cada ejecución; nada va a producción).
const ADMIN = { email: 'admin-e2e@example.test', password: 'admin-e2e-Pass1', uid: 'e2eAdminUid0000000000001' };
const MINE: Record<string, { id: string; name: string }> = {
  'mobile-360': { id: 'e2e-alfa-norte', name: 'Alfa Norte (sintético)' },
  'mobile-390': { id: 'e2e-cerrada', name: 'Épsilon Cerrada (sintético)' },
  'desktop-1280': { id: 'e2e-lejana', name: 'Gamma Lejana (sintético)' },
};

async function adminToken(request: APIRequestContext) {
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-skitrip/accounts`, {
    headers: { Authorization: 'Bearer owner' }, data: { localId: ADMIN.uid, email: ADMIN.email, password: ADMIN.password },
  });
  if (!r.ok()) expect(await r.text()).toMatch(/DUPLICATE_LOCAL_ID|EMAIL_EXISTS/);
  const s = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { data: { email: ADMIN.email, password: ADMIN.password, returnSecureToken: true } });
  expect(s.ok()).toBeTruthy();
  return (await s.json()).idToken as string;
}
const obs = (areaId: string, o: Record<string, unknown>) => ({
  observationId: null, expectedVersion: null, areaId, measure: 'daily_skiers', status: 'value', sample: 'regular',
  sourceRef: 'https://example.invalid/noticia-sintetica', sourceTitle: 'Noticia sintética', sourcePublished: null, note: null, reason: 'Prueba E2E', ...o,
});

test('ficha: afluencia del mismo día y mes, «Sin dato», muestras de récord, cierre y cambio rápido de fecha', async ({ page, request }, info) => {
  const mine = MINE[info.project.name];
  const token = await adminToken(request);
  for (const o of [
    obs(mine.id, { date: '2025-01-10', value: 1500 }),
    obs(mine.id, { date: '2024-01-10', value: 1300 }),
    obs(mine.id, { date: '2023-01-10', status: 'closed', value: null }),
    obs(mine.id, { date: '2025-01-10', measure: 'lift_passages', value: 20000 }),
    obs(mine.id, { date: '2025-03-01', value: 9000, sample: 'record' }),
  ]) {
    const r = await request.put(`${BASE}/api/admin/crowds`, { data: o, headers: { Authorization: `Bearer ${token}` } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  await distinctIp(page);
  await loginUI(page, ADMIN);
  await page.goto(`/#/estaciones/${mine.id}?afluencia=01-10`);
  const sec = page.getByRole('region', { name: 'Afluencia histórica' });
  const list = sec.getByRole('list', { name: /Afluencia del 10 de enero/ });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list).toContainText('viernes 10 de enero de 2025');
  await expect(list).toContainText('1500 esquiadores');
  await expect(list).toContainText('20.000 pasos por remontes');
  await expect(list).toContainText('Cierre confirmado (sin cifra)');
  await expect(list).toContainText(/Intensidad diaria: no calculable/);
  await expect(sec).toContainText('Media de 2 años: 1400 esquiadores');
  await expect(sec).toContainText(/Pasos por remontes.*Sin media/);
  await expect(sec).toContainText('no predice cuánta gente habrá');
  await expectNoHorizontalOverflow(page, 'afluencia en la ficha');

  // Otro día: «Sin dato», sin cifras del día anterior a la vista.
  await sec.getByLabel('Día').selectOption('11');
  await expect(sec.getByTestId('crowd-empty')).toContainText('Sin dato para el 11 de enero');
  await expect(sec).not.toContainText('1500');

  // Cambio rápido de mes y día: solo se ve lo del último día elegido (respuestas tardías descartadas).
  await sec.getByLabel('Mes').selectOption('3');
  await sec.getByLabel('Día').selectOption('1');
  await sec.getByLabel('Mes').selectOption('1');
  await sec.getByLabel('Día').selectOption('10');
  await sec.getByLabel('Mes').selectOption('3');
  await sec.getByLabel('Día').selectOption('1');
  await expect(sec.getByRole('list', { name: /Afluencia del 1 de marzo/ })).toContainText('9000 esquiadores');
  await expect(sec).toContainText('Muestra de récord');
  await expect(sec).toContainText('no representan la afluencia habitual');
  await expect(sec).not.toContainText('1500');

  // 29 de febrero: se puede elegir y no se sustituye por otro día.
  await sec.getByLabel('Mes').selectOption('2');
  await sec.getByLabel('Día').selectOption('29');
  await expect(sec.getByTestId('crowd-empty')).toContainText('29 de febrero');
  await sec.getByText('Ver detalles').click();
  await expect(sec).toContainText('solo existe en años bisiestos');
  await expect(sec).toContainText('Porcentaje de capacidad: no se calcula');
});

test('administración › afluencia: pestaña, alta con validación y duplicado rechazado', async ({ page, request }, info) => {
  const mine = MINE[info.project.name];
  await adminToken(request);
  await distinctIp(page);
  await loginUI(page, ADMIN);
  await page.goto('/#/admin?seccion=afluencia');
  await expect(page.getByRole('heading', { name: 'Observaciones de afluencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir observación' }).click();
  const form = page.getByRole('region', { name: 'Nueva observación' });
  await form.getByLabel('Estación o dominio').selectOption(mine.id);
  await form.getByLabel('Fecha del día observado').fill('2022-12-30');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form.getByRole('alert')).toContainText('https');
  await form.getByLabel(/Cifra/).fill('777');
  await form.getByLabel('Enlace a la fuente (https)').fill('https://example.invalid/otra');
  await form.getByLabel(/Motivo del cambio/).fill('Prueba de alta');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('list', { name: 'Observaciones' })).toContainText('777 esquiadores');
  await page.getByRole('button', { name: 'Añadir observación' }).click();
  const again = page.getByRole('region', { name: 'Nueva observación' });
  await again.getByLabel('Estación o dominio').selectOption(mine.id);
  await again.getByLabel('Fecha del día observado').fill('2022-12-30');
  await again.getByLabel(/Cifra/).fill('1');
  await again.getByLabel('Enlace a la fuente (https)').fill('https://example.invalid/otra');
  await again.getByLabel(/Motivo del cambio/).fill('Duplicado');
  await again.getByRole('button', { name: 'Guardar' }).click();
  await expect(again.getByRole('alert')).toContainText('Ya hay una observación activa');
  await expectNoHorizontalOverflow(page, 'administración de afluencia');
});
