import { expect, test, type APIRequestContext } from '@playwright/test';
import { AUTH, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, seasonStartYear, uniq, waitToast } from './helpers';

// Hoja antigua de punta a punta en el navegador: la administración sube el CSV (vista previa, errores, importación
// idempotente), asigna una persona de la hoja a una cuenta y esa persona incorpora sus días de forma voluntaria.
const ADMIN = { email: 'admin-e2e@example.test', password: 'admin-e2e-Pass1', uid: 'e2eAdminUid0000000000001' };

async function ensureAdminAccount(request: APIRequestContext) {
  // API de administración del emulador de Auth (no existe fuera del emulador). El perfil con rol admin está en seed.sql.
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-skitrip/accounts`, {
    headers: { Authorization: 'Bearer owner' }, data: { localId: ADMIN.uid, email: ADMIN.email, password: ADMIN.password },
  });
  if (!r.ok()) expect(await r.text()).toMatch(/DUPLICATE_LOCAL_ID|EMAIL_EXISTS/);
}

test('hoja antigua: CSV subido por administración → asignación → la persona lo ve e incorpora lo que quiere', async ({ page, request, browser }, info) => {
  await ensureAdminAccount(request);
  const person = `Persona ${uniq()}`;
  const y = seasonStartYear() + 1;
  const csv = ['date,user,status', `15/01/${y},${person},ocupado`, `${y}-01-16,${person},libre`, `${y}-01-17,${person},???`, `31/02/${y},${person},libre`].join('\n');
  const member = makeUser('lgs');
  await createUserViaApi(request, member);

  await distinctIp(page);
  await loginUI(page, ADMIN);
  await page.goto('/#/admin');
  const panel = page.getByRole('region', { name: 'Importar la hoja antigua (CSV)' });
  await panel.getByLabel('Pestaña').selectOption('availability');
  await panel.getByLabel('Archivo CSV').setInputFiles({ name: 'disponibilidad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await panel.getByRole('button', { name: 'Previsualizar' }).click();
  const report = panel.getByTestId('sheet-report');
  await expect(report).toContainText('3 filas válidas · 1 error');
  await expect(report).toContainText('ocupado: 1 · libre: 1 · sin equivalencia: 1');
  await expect(report.getByRole('list', { name: 'Errores' })).toContainText('Línea 5');
  // Con errores no se importa hasta pedir que se omitan solo esas filas.
  await expect(panel.getByRole('button', { name: 'Importar' })).toBeDisabled();
  await panel.getByLabel('Importar omitiendo solo las filas con errores').check();
  await panel.getByRole('button', { name: 'Importar' }).click();
  await waitToast(page, 'Hoja importada: 3 filas nuevas, 1 omitidas por errores.');

  // Repetir con el mismo archivo: lo detecta y no duplica.
  await panel.getByLabel('Archivo CSV').setInputFiles({ name: 'disponibilidad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await panel.getByRole('button', { name: 'Previsualizar' }).click();
  await expect(panel.getByRole('status')).toContainText('Este archivo ya se importó (3 filas)');
  await panel.getByLabel('Importar omitiendo solo las filas con errores').check();
  await panel.getByRole('button', { name: 'Importar' }).click();
  await waitToast(page, 'Hoja importada: 0 filas nuevas, 3 ya estaban, 1 omitidas por errores.');

  // Asignación explícita a la cuenta (aviso de identidad incluido).
  const people = page.getByRole('list', { name: 'Personas de la hoja antigua' });
  const card = people.getByRole('listitem').filter({ hasText: `«${person}»` });
  await expect(card).toContainText('Sin asignar');
  await expect(card).toContainText('3 días marcados');
  await card.getByRole('button', { name: 'Asignar a una cuenta' }).click();
  await card.getByLabel('Alias de la cuenta').fill(member.alias);
  await card.getByRole('list', { name: 'Cuentas encontradas' }).getByRole('listitem').filter({ hasText: member.alias }).getByRole('button', { name: 'Elegir' }).click();
  const dlg = page.getByRole('dialog', { name: `¿Asignar «${person}» a ${member.alias}?` });
  await expect(dlg).toContainText('Un nombre parecido no prueba identidad');
  await dlg.getByRole('button', { name: 'Asignar' }).click();
  await waitToast(page, '3 días asignados.');
  await expect(card).toContainText(`Asignado a ${member.alias}`);
  await expectNoHorizontalOverflow(page, `admin hoja (${info.project.name})`);

  // La persona ve su hoja como referencia: nada está en su calendario hasta que lo incorpora.
  const mp = await newUserPage(browser, info);
  await loginUI(mp, member);
  await mp.goto('/#/calendario?vista=hoja');
  const table = mp.getByRole('region', { name: 'Hoja antigua frente a tu calendario' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('«ocupado» → ');
  await expect(table).toContainText('(sin equivalencia, no se incorpora)');
  await expect(table.getByRole('row').filter({ hasText: '«???»' }).getByRole('checkbox')).toBeDisabled();
  // Incorpora solo uno de los dos días posibles.
  await table.getByRole('row').filter({ hasText: '«ocupado»' }).getByRole('checkbox').check();
  await mp.getByRole('button', { name: 'Incorporar a mi calendario' }).click();
  await expect(mp.getByRole('status').filter({ hasText: 'Incorporados: 1.' })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: '«ocupado»' })).toContainText('incorporado');
  await expect(table.getByRole('row').filter({ hasText: '«libre»' })).toContainText('sin indicar');
  await expectNoHorizontalOverflow(mp, `hoja persona (${info.project.name})`);
  await mp.context().close();
});
