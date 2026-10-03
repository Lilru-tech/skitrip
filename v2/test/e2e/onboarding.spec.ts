import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, AUTH, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, uniq, waitToast } from './helpers';

// Primeros pasos, incorporación guiada de la hoja antigua y fichas más claras. Datos sintéticos en seed.sql; los de la
// hoja se importan en cada prueba con nombres únicos, porque la D1 de E2E es común a los tres tamaños de pantalla.
const ADMIN = { email: 'admin-e2e@example.test', password: 'admin-e2e-Pass1', uid: 'e2eAdminUid0000000000001' };

async function adminToken(request: APIRequestContext) {
  const r = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-skitrip/accounts`, {
    headers: { Authorization: 'Bearer owner' }, data: { localId: ADMIN.uid, email: ADMIN.email, password: ADMIN.password },
  });
  if (!r.ok()) expect(await r.text()).toMatch(/DUPLICATE_LOCAL_ID|EMAIL_EXISTS/);
  const s = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, { data: { email: ADMIN.email, password: ADMIN.password, returnSecureToken: true } });
  expect(s.ok()).toBeTruthy();
  return (await s.json()).idToken as string;
}

async function loggedIn(page: Page, request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  const token = await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);
  return { u, token };
}

test('primeros pasos: amigos, disponibilidad compartida y primer viaje, marcados con datos reales', async ({ page, request, browser }, info) => {
  const { u, token } = await loggedIn(page, request, 'pp');
  const steps = page.getByRole('list', { name: 'Pasos para empezar' });
  await expect(page.getByRole('heading', { name: 'Primeros pasos' })).toBeVisible();
  await expect(page.locator('main')).toContainText('0 de 3 hechos');
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(steps).toContainText('Añade a tu grupo como amigos');
  await expect(steps).toContainText('Marca y comparte tu disponibilidad');
  await expect(steps).toContainText('Crea vuestro primer viaje');
  await expect(page.getByText('Aún no tienes viajes')).toBeVisible();
  await expectNoHorizontalOverflow(page, `primeros pasos (${info.project.name})`);

  // El paso del viaje abre el mismo diálogo de «Nuevo viaje».
  await steps.getByRole('button', { name: 'Crear un viaje' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo viaje' });
  await dialog.getByLabel('Nombre del viaje').fill('Primer viaje');
  await dialog.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Primer viaje' })).toBeVisible();
  await page.goto('/#/viajes');
  await expect(page.locator('main')).toContainText('1 de 3 hechos');
  await expect(steps.getByRole('listitem').filter({ hasText: 'Crea vuestro primer viaje' })).toContainText('(hecho)');

  // Compartir disponibilidad y tener un amigo completan los pasos: el panel desaparece.
  await apiAs(request, token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await page.reload();
  await expect(page.locator('main')).toContainText('2 de 3 hechos');
  const friend = makeUser('ppf');
  const ft = await createUserViaApi(request, friend);
  const me = await apiAs(request, token, 'GET', '/api/me');
  const req = await apiAs(request, ft, 'POST', '/api/friends/requests', { userId: me.profile.id });
  await expect(async () => {
    await page.reload();
    await expect(steps).toContainText('solicitud recibida');
  }).toPass();
  await apiAs(request, token, 'POST', `/api/friends/requests/${req.requestId}/accept`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Mis viajes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primeros pasos' })).toHaveCount(0);
  expect(u.alias).toBeTruthy();
});

test('hoja antigua guiada: resumen, vincular un nombre, publicar solo lo elegido y consulta histórica', async ({ page, request, browser }, info) => {
  const adm = await adminToken(request);
  const tag = uniq();
  const author = `Autora ${tag}`;
  const general = `Consejo general ${tag}: llevad cadenas`;
  const station = `Comentario de estación ${tag}`;
  // Comentarios con la estación por su nombre y «general»; disponibilidad de enero a marzo de 2026 (ya pasada).
  await apiAs(request, adm, 'POST', '/api/admin/legacy/sheets/import', { kind: 'comments', fileName: `c-${tag}.csv`, dryRun: false,
    csv: `estacion,autor,comentario,fecha\ngeneral,${author},"${general}",10/01/2026\nBeta (sintético),${author},"${station}",11/01/2026\n` });
  await apiAs(request, adm, 'POST', '/api/admin/legacy/sheets/import', { kind: 'availability', fileName: `a-${tag}.csv`, dryRun: false,
    csv: `fecha,persona,estado\n15/01/2026,${author},ocupado\n16/01/2026,${author},libre\n02/03/2026,${author},ocupado\n` });
  const member = makeUser('lgm');
  await createUserViaApi(request, member);

  await distinctIp(page);
  await loginUI(page, ADMIN);
  // Mis viajes avisa a administración de lo que queda por revisar.
  await expect(page.getByText('Datos de la hoja antigua por revisar:')).toBeVisible();
  await page.getByRole('link', { name: 'Revisar la hoja antigua' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Administración' })).toBeVisible();
  const guide = page.getByRole('region', { name: 'Hoja antigua: incorporación guiada' });
  const tally = guide.getByRole('definition');
  await expect(tally).toHaveCount(3);
  await expect(guide.getByText('Conservado', { exact: true })).toBeVisible();
  await expect(guide.getByText('Pendiente de revisión', { exact: true })).toBeVisible();
  await expect(guide.getByText('Incorporado', { exact: true })).toBeVisible();
  await expect(guide.getByTestId('legacy-period')).toContainText('no se trasladan a la temporada 2026–27');
  await expect(guide.getByRole('list', { name: 'Pasos de la hoja antigua' })).toContainText('Vincular cada nombre de la hoja a su cuenta');
  await expect(guide.getByRole('link', { name: 'Ir a Compra' })).toBeVisible();

  // Vincular el nombre a una cuenta (aviso de identidad; no publica nada).
  const names = page.getByRole('list', { name: 'Nombres de la hoja antigua' });
  const card = names.getByRole('listitem').filter({ hasText: `«${author}»` });
  await expect(card).toContainText('Sin vincular');
  await expect(card).toContainText('3 días de disponibilidad · 2 comentarios');
  await card.getByRole('button', { name: `Vincular a una cuenta para «${author}»` }).click();
  await card.getByLabel(`Cuenta para «${author}»`).fill(member.alias);
  await card.getByRole('list', { name: 'Cuentas encontradas' }).getByRole('listitem').filter({ hasText: member.alias }).getByRole('button', { name: 'Elegir' }).click();
  const dlg = page.getByRole('dialog', { name: `¿Vincular «${author}» a ${member.alias}?` });
  await expect(dlg).toContainText('Un nombre parecido no prueba identidad');
  await expect(dlg).toContainText('No se publica ningún comentario');
  await dlg.getByRole('button', { name: 'Vincular' }).click();
  await waitToast(page, `«${author}» vinculado a ${member.alias}: 3 días y 2 comentarios.`);
  await expect(card).toContainText(`Vinculado a ${member.alias}`);

  // Revisar comentarios: se publica solo el elegido.
  const list = page.getByRole('list', { name: 'Comentarios heredados' });
  const gen = list.getByRole('listitem').filter({ hasText: general });
  const st = list.getByRole('listitem').filter({ hasText: station });
  await expect(gen).toContainText('Consejo general');
  await expect(st).toContainText('Beta (sintético)');
  await expect(st).toContainText('Sin publicar');
  await gen.getByRole('checkbox').check();
  const actions = page.getByRole('region', { name: 'Acciones con los comentarios elegidos' });
  await expect(actions).toContainText('1 comentario elegido');
  await actions.getByRole('button', { name: 'Publicar los elegidos' }).click();
  const pub = page.getByRole('dialog', { name: '¿Publicar 1 comentario?' });
  await expect(pub).toContainText('1 consejo general en Comparar');
  await pub.getByRole('button', { name: 'Publicar' }).click();
  await waitToast(page, '1 comentario publicado.');
  await expect(list).not.toContainText(general); // la vista «Sin publicar» ya no lo muestra
  await expect(st).toContainText('Sin publicar');
  await expectNoHorizontalOverflow(page, `admin hoja guiada (${info.project.name})`);

  // Plantilla CSV descargable, sin identificadores internos.
  await page.getByText('Plantillas CSV y ayuda').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar plantilla de comentarios' }).click()]);
  expect(download.suggestedFilename()).toBe('plantilla-comentarios.csv');
  expect(readFileSync(await download.path(), 'utf8').replace(/^﻿/, '').split('\n')[0]).toBe('estacion,autor,comentario,fecha');

  // El consejo general publicado aparece en Comparar; el no elegido no aparece en la ficha de Beta.
  await page.goto('/#/comparar');
  await expect(page.getByRole('list', { name: 'Consejos generales de la hoja antigua' })).toContainText(general);
  await page.goto('/#/estaciones/e2e-beta');
  await expect(page.getByRole('heading', { level: 1, name: 'Beta (sintético)' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(station);
  await expect(page.locator('main')).not.toContainText(general);

  // La persona vinculada consulta sus días antiguos: son historia y no se ofrecen para incorporar.
  const mp = await newUserPage(browser, info);
  await loginUI(mp, member);
  await mp.goto('/#/calendario?vista=hoja');
  await expect(mp.getByRole('heading', { name: /Consulta histórica/ })).toBeVisible();
  await expect(mp.locator('main')).toContainText('no se copian a tu calendario ni se trasladan a la temporada 2026–27');
  await expect(mp.getByRole('list', { name: 'Resumen por mes' })).toContainText('Enero de 2026: 1 ocupado · 1 libre');
  await expect(mp.getByRole('list', { name: 'Resumen por mes' })).toContainText('Marzo de 2026: 1 ocupado');
  await expect(mp.getByRole('region', { name: 'Hoja antigua frente a tu calendario' })).toHaveCount(0);
  await expect(mp.getByRole('button', { name: 'Incorporar a mi calendario' })).toHaveCount(0);
  await mp.getByText(/Ver los 3 días/).click();
  await expect(mp.getByRole('region', { name: 'Consulta histórica de la hoja antigua' }).getByRole('row')).toHaveCount(4);
  await expectNoHorizontalOverflow(mp, `hoja histórica (${info.project.name})`);
  await mp.context().close();
});

test('ficha y Comparar: cierre confirmado, cobertura explicada, procedencia de la ruta y ruta sin ofertas automáticas', async ({ page, request }, info) => {
  const { token } = await loggedIn(page, request, 'fic');
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: `Viaje ${uniq()}`, nights: 2 });

  await page.goto('/#/comparar');
  const near = page.getByRole('list', { name: 'Estaciones dentro de la distancia' });
  const eps = near.getByRole('listitem').filter({ hasText: 'Épsilon Cerrada (sintético)' });
  await expect(eps).toContainText('Cerrada (confirmado por la fuente) · la fuente no publica km');
  await expect(eps).not.toContainText('sin dato abiertos de sin dato');
  await expect(eps).toContainText('cobertura 100 % de los criterios con dato');
  await expect(eps).toContainText('Cerrada: «nieve abierta ahora» puntúa 0 km');
  await expect(eps).toContainText('calculada con OSRM (OpenStreetMap) el 01/10/2026, sin revisión humana');
  await expect(near.getByRole('listitem').filter({ hasText: 'Beta (sintético)' })).toContainText('anotada a mano el 01/09/2026, sin revisar');
  await expectNoHorizontalOverflow(page, `comparar con cierre (${info.project.name})`);

  await page.goto('/#/estaciones/e2e-cerrada');
  await expect(page.getByRole('heading', { level: 1, name: 'Épsilon Cerrada (sintético)' })).toBeVisible();
  const now = page.getByRole('region', { name: 'Estado actual' });
  await expect(now).toContainText('Cerrada (confirmado por la fuente)');
  const offers = page.getByRole('region', { name: 'Ofertas y qué hacer' });
  await expect(offers.getByTestId('no-offers')).toContainText('No hay ofertas automáticas recientes');
  await expect(offers.getByRole('link', { name: /Buscar en Esquiades/ })).toHaveAttribute('href', 'https://example.invalid/ofertas-epsilon');
  const route = page.getByRole('region', { name: 'Cómo llegar' });
  await expect(route).toContainText('Desde Tarragona: 215 km · 3 h 31 min');
  await expect(route).toContainText('calculada con OSRM (OpenStreetMap) el 01/10/2026, sin revisión humana');
  await expect(route).toContainText('el acceso o aparcamiento no está confirmado');
  // Diagnóstico técnico plegado, pero accesible con sus fechas.
  const diag = page.locator('details').filter({ hasText: 'Fuentes y diagnóstico' });
  await expect(diag).not.toHaveAttribute('open', '');
  await diag.getByText('Fuentes y diagnóstico').click();
  await expect(diag).toContainText('revisada el 01/09/2026');
  await expectNoHorizontalOverflow(page, `ficha cerrada (${info.project.name})`);

  // Apuntar una cotización manual en un viaje: abre el formulario con la estación ya elegida.
  await offers.getByLabel('Viaje', { exact: true }).selectOption(trip.id);
  await offers.getByRole('link', { name: 'Apuntar cotización' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Candidaturas y votos' })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Estación')).toHaveValue('e2e-cerrada');
  await expect(page).not.toHaveURL(/cotizar=/);

  // Históricos antiguos plegados y con avisos explicados (nunca el código).
  await page.goto('/#/estaciones/e2e-beta');
  const old = page.locator('details').filter({ hasText: 'Históricos del SkiTrip antiguo' });
  await old.getByText('Históricos del SkiTrip antiguo').click();
  await expect(old).toContainText('Cero dudoso: el programa antiguo convertía «-» (sin dato) en 0');
  await expect(old).not.toContainText('zero_ambiguous');
  await expect(old).not.toContainText('total_mismatch_catalog');
  await expectNoHorizontalOverflow(page, `ficha con históricos (${info.project.name})`);
});
