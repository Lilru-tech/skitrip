import { expect, test, type APIRequestContext } from '@playwright/test';
import { AUTH, BASE, apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, uniq, waitToast } from './helpers';

// Vincular datos de la hoja antigua a la propia cuenta del administrador. El selector usaba el buscador de amigos, que
// excluye a quien busca: el administrador no encontraba su alias. Datos sintéticos en la D1 de E2E y el emulador.

const ADMIN = { email: 'admin-e2e@example.test', password: 'admin-e2e-Pass1', uid: 'e2eAdminUid0000000000001', alias: 'admin-e2e' };

async function adminToken(request: APIRequestContext) {
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-skitrip/accounts`, {
    headers: { Authorization: 'Bearer owner' }, data: { localId: ADMIN.uid, email: ADMIN.email, password: ADMIN.password },
  });
  if (!r.ok()) expect(await r.text()).toMatch(/DUPLICATE_LOCAL_ID|EMAIL_EXISTS/);
  const s = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { data: { email: ADMIN.email, password: ADMIN.password, returnSecureToken: true } });
  expect(s.ok()).toBeTruthy();
  return (await s.json()).idToken as string;
}

const future = () => { const d = new Date(Date.now() + 40 * 86400_000); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const iso = (dmy: string) => dmy.split('/').reverse().join('-');

test('administración: vincular un nombre antiguo a la propia cuenta y a otra cuenta activa', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const adm = await adminToken(request);
  const tag = uniq();
  const mine = `Yo ${tag}`;
  const other = `Otra ${tag}`;
  const day = future();
  await apiAs(request, adm, 'POST', '/api/admin/legacy/sheets/import', { kind: 'comments', fileName: `sc-${tag}.csv`, dryRun: false,
    csv: `estacion,autor,comentario,fecha\ngeneral,${mine},"Consejo propio ${tag}",10/01/2026\n` });
  await apiAs(request, adm, 'POST', '/api/admin/legacy/sheets/import', { kind: 'availability', fileName: `sa-${tag}.csv`, dryRun: false,
    csv: `fecha,persona,estado\n15/01/2026,${mine},libre\n${day},${mine},libre\n${day},${other},ocupado\n` });
  const member = makeUser('slm');
  await createUserViaApi(request, member);

  await distinctIp(page);
  await loginUI(page, ADMIN);
  await page.goto('/#/admin');
  const card = page.getByRole('list', { name: 'Nombres de la hoja antigua' }).getByRole('listitem').filter({ hasText: `«${mine}»` });
  await expect(card).toContainText('Sin vincular');
  await card.getByRole('button', { name: `Vincular a una cuenta para «${mine}»` }).click();
  const q = card.getByLabel(`Cuenta para «${mine}»`);
  const hits = card.getByRole('list', { name: 'Cuentas encontradas' });

  // Sin resultados: mensaje claro. Al cambiar la consulta no quedan resultados anteriores a la vista.
  await q.fill(ADMIN.alias);
  await expect(hits.getByRole('listitem').filter({ hasText: `${ADMIN.alias} (tú)` })).toBeVisible();
  await q.fill(`zz${tag}`);
  await expect(hits).toHaveCount(0);
  await expect(card.getByText('Ninguna cuenta activa con ese alias.')).toBeVisible();
  await expectNoHorizontalOverflow(page, `selector de cuentas (${info.project.name})`);

  // 1) Encuentra su propio alias como «(tú)» y lo vincula tras confirmar.
  await q.fill(ADMIN.alias);
  await hits.getByRole('listitem').filter({ hasText: `${ADMIN.alias} (tú)` }).getByRole('button', { name: 'Elegir' }).click();
  const dlg = page.getByRole('dialog', { name: `¿Vincular «${mine}» a ${ADMIN.alias} (tú)?` });
  await expect(dlg).toContainText('Un nombre parecido no prueba identidad');
  await expect(dlg).toContainText('No se publica ningún comentario ni se copia nada a su calendario');
  await dlg.getByRole('button', { name: 'Vincular' }).click();
  await waitToast(page, `«${mine}» vinculado a ${ADMIN.alias} (tú): 2 días y 1 comentario.`);

  // 2) Persiste al recargar; el comentario sigue sin publicar y la disponibilidad no entra en el calendario.
  await page.reload();
  await expect(card).toContainText(`Vinculado a ${ADMIN.alias}`);
  const comment = page.getByRole('list', { name: 'Comentarios heredados' }).getByRole('listitem').filter({ hasText: `Consejo propio ${tag}` });
  await expect(comment).toContainText('Sin publicar');
  await expect(comment).toContainText(`Vinculado a ${ADMIN.alias}`);
  const legacy = (await apiAs(request, adm, 'GET', '/api/legacy/availability/mine')).days.filter((d: any) => d.day === iso(day));
  // La cuenta de administración es compartida entre proyectos de Playwright: puede haber el mismo día de otra ejecución.
  expect(legacy.length).toBeGreaterThan(0);
  for (const d of legacy) expect(d).toMatchObject({ mappedStatus: 'free', incorporatedAt: null, currentStatus: null });
  const cal = await apiAs(request, adm, 'GET', `/api/availability/me?from=${iso(day)}&to=${iso(day)}`);
  expect(cal.days[iso(day)]).toBeUndefined();
  await page.goto('/#/calendario?vista=hoja');
  await expect(page.locator('main')).toContainText('No se copian a tu calendario hasta que los incorpores');

  // 3) Otra cuenta activa, desde el selector de disponibilidad.
  await page.goto('/#/admin');
  const person = page.getByRole('list', { name: 'Personas de la hoja antigua' }).getByRole('listitem').filter({ hasText: `«${other}»` });
  await person.getByRole('button', { name: 'Asignar a una cuenta' }).click();
  await person.getByLabel('Alias de la cuenta').fill(member.alias);
  await person.getByRole('list', { name: 'Cuentas encontradas' }).getByRole('listitem').filter({ hasText: member.alias }).getByRole('button', { name: 'Elegir' }).click();
  const dlg2 = page.getByRole('dialog', { name: `¿Asignar «${other}» a ${member.alias}?` });
  await expect(dlg2).toContainText('No se copia nada a su calendario');
  await dlg2.getByRole('button', { name: 'Asignar' }).click();
  await waitToast(page, '1 día asignado.');
  await page.reload();
  await expect(person).toContainText(`Asignado a ${member.alias}`);
});

test('sin administración no hay búsqueda ni vinculación; el buscador de amigos sigue sin incluirte', async ({ browser, request }, info) => {
  const u = makeUser('nad');
  const token = await createUserViaApi(request, u);
  const headers = { Authorization: `Bearer ${token}` };
  // 4) Una cuenta normal: ni la búsqueda administrativa ni la vinculación existen para ella.
  expect((await request.get(`${BASE}/api/admin/users/search?q=${ADMIN.alias}`, { headers })).status()).toBe(404);
  expect((await request.post(`${BASE}/api/admin/legacy/identities/link`, { headers, data: { name: 'Pepe', userId: 'x' } })).status()).toBe(404);
  const p = await newUserPage(browser, info);
  await loginUI(p, u);
  await p.goto('/#/admin');
  await expect(p.getByRole('heading', { level: 1, name: 'Página no disponible' })).toBeVisible();

  // 5) El buscador de amigos no te muestra a ti mismo.
  const friends = await apiAs(request, token, 'GET', `/api/friends/search?q=${encodeURIComponent(u.alias)}`);
  expect(friends.users).toEqual([]);
  await p.goto('/#/amigos');
  await p.getByLabel('Alias', { exact: true }).fill(u.alias);
  await expect(p.getByRole('list', { name: 'Resultados de la búsqueda' }).getByText(u.alias, { exact: true })).toHaveCount(0);
  await p.context().close();
});
