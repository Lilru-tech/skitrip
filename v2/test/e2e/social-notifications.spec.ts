import { expect, test, type Page } from '@playwright/test';
import { apiAs, createUserViaApi, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, waitToast } from './helpers';

// Solicitud de amistad e invitación directa entre dos sesiones abiertas, sin recargar: la campana de quien recibe se
// actualiza al volver a la pestaña (foco) o con la consulta periódica, y el aviso permite responder solo mientras
// la solicitud sigue pendiente. Cuentas sintéticas del emulador; D1 local aislada.

/** Volver a la pestaña: el mismo evento que dispara el navegador al recuperar el foco. */
const refocus = (p: Page) => p.evaluate(() => window.dispatchEvent(new Event('focus')));

test('solicitud e invitación llegan a la otra sesión sin recargar y se responden desde el aviso', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const ana = makeUser('avA');
  const bea = makeUser('avB');
  const tokenA = await createUserViaApi(request, ana);
  await createUserViaApi(request, bea);

  const pa = await newUserPage(browser, info);
  const pb = await newUserPage(browser, info);
  await loginUI(pa, ana);
  await loginUI(pb, bea);
  await pb.goto('/#/amigos');
  await expect(pb.getByRole('link', { name: 'Avisos: ninguno sin leer' })).toBeVisible();

  // Ana envía la solicitud desde su sesión.
  await pa.goto('/#/amigos');
  await pa.getByLabel('Alias', { exact: true }).fill(bea.alias);
  await pa.getByRole('list', { name: 'Resultados de la búsqueda' }).getByRole('button', { name: 'Enviar solicitud' }).click();
  await waitToast(pa, `Solicitud enviada a ${bea.alias}.`);

  // Bea vuelve a su pestaña: campana y lista de solicitudes al día sin recargar.
  const navCount = pb.waitForRequest((r) => r.url().endsWith('/api/notifications/unread'));
  await refocus(pb);
  await navCount;
  await expect(pb.getByRole('link', { name: 'Avisos: 1 sin leer' })).toBeVisible();
  await expect(pb.getByRole('region', { name: 'Solicitudes recibidas' })).toContainText(ana.alias);

  // El aviso ofrece responder; marcarlo como leído no acepta.
  await pb.getByRole('link', { name: 'Avisos: 1 sin leer' }).click();
  const card = pb.getByRole('listitem', { name: `${ana.alias} quiere ser tu amistad en SkiTrip` });
  await expect(card).toContainText('Marcar el aviso como leído no la acepta.');
  await card.getByRole('button', { name: 'Marcar como leído' }).click();
  await expect(card.getByText('Leído', { exact: true })).toBeVisible();
  await expect(pb.getByRole('link', { name: 'Avisos: ninguno sin leer' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Aceptar solicitud' })).toBeVisible();
  await card.getByRole('button', { name: 'Aceptar solicitud' }).click();
  await waitToast(pb, `Ahora eres amistad de ${ana.alias}.`);
  await expect(card).toContainText('Aceptada');
  await expect(card.getByRole('button', { name: 'Aceptar solicitud' })).toHaveCount(0);
  await expectNoHorizontalOverflow(pb, `avisos (${info.project.name})`);

  // Ana crea un viaje e invita a Bea; Bea está en Avisos y lo ve al volver a la pestaña.
  const { trip } = await apiAs(request, tokenA, 'POST', '/api/trips', { name: `Aviso ${ana.alias.slice(-4)}`, nights: 2 });
  await pa.goto(`/#/viajes/${trip.id}`);
  await pa.getByLabel('Amigo').selectOption({ label: bea.alias });
  await pa.getByRole('button', { name: 'Enviar invitación' }).click();
  await waitToast(pa, `Invitación enviada a ${bea.alias}.`);

  await refocus(pb);
  await expect(pb.getByRole('link', { name: 'Avisos: 1 sin leer' })).toBeVisible();
  const inv = pb.getByRole('listitem', { name: `${ana.alias} te invita al viaje «${trip.name}»` });
  await expect(inv).toBeVisible();

  // Ana retira la invitación: el aviso de Bea deja de ofrecer «Unirme al viaje».
  await pa.reload();
  await pa.getByRole('button', { name: /Retirar/ }).first().click();
  await waitToast(pa, 'Invitación retirada.');
  await refocus(pb);
  await expect(inv).toContainText('Retirada por quien invitó');
  await expect(inv.getByRole('button', { name: 'Unirme al viaje' })).toHaveCount(0);
  await expect(pb.getByRole('link', { name: 'Avisos: ninguno sin leer' })).toBeVisible();

  // Una invitación nueva al mismo viaje reutiliza el aviso (no se acumulan) y se acepta desde él.
  await pa.getByLabel('Amigo').selectOption({ label: bea.alias });
  await pa.getByRole('button', { name: 'Enviar invitación' }).click();
  await waitToast(pa, `Invitación enviada a ${bea.alias}.`);
  await refocus(pb);
  await expect(inv.getByRole('button', { name: 'Unirme al viaje' })).toBeVisible();
  await expect(pb.getByRole('listitem', { name: `${ana.alias} te invita al viaje «${trip.name}»` })).toHaveCount(1);
  await inv.getByRole('button', { name: 'Unirme al viaje' }).click();
  await waitToast(pb, `Te has unido a «${trip.name}».`);
  await expect(inv).toContainText('Aceptada');
  await inv.getByRole('link', { name: 'Ir al viaje' }).click();
  await expect(pb.getByRole('heading', { level: 1, name: trip.name })).toBeVisible();
  await pa.context().close();
  await pb.context().close();
});

test('la campana se actualiza sola cada minuto con la pestaña visible', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'una sola vez: espera real de un minuto');
  test.setTimeout(150_000);
  const ana = makeUser('avpA');
  const bea = makeUser('avpB');
  const tokenA = await createUserViaApi(request, ana);
  await createUserViaApi(request, bea);
  const pb = await newUserPage(browser, info);
  await loginUI(pb, bea);
  await expect(pb.getByRole('link', { name: 'Avisos: ninguno sin leer' })).toBeVisible();
  const { users } = await apiAs(request, tokenA, 'GET', `/api/friends/search?q=${encodeURIComponent(bea.alias)}`);
  await apiAs(request, tokenA, 'POST', '/api/friends/requests', { userId: users[0].id });
  await expect(pb.getByRole('link', { name: 'Avisos: 1 sin leer' })).toBeVisible({ timeout: 75_000 });
  await pb.context().close();
});
