import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, seasonStartYear, waitToast, type TestUser } from './helpers';

// Claridad del recorrido de un grupo nuevo (fase de usabilidad). Cada prueba reproduce un problema encontrado al
// recorrer la app con cuentas sintéticas del emulador: antes fallaba, ahora debe guiar.

async function user(request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  return { u, token: await createUserViaApi(request, u) };
}
async function befriend(request: APIRequestContext, a: { token: string }, b: { u: TestUser; token: string }) {
  const { users } = await apiAs(request, a.token, 'GET', `/api/friends/search?q=${encodeURIComponent(b.u.alias)}`);
  const { requestId } = await apiAs(request, a.token, 'POST', '/api/friends/requests', { userId: users[0].id });
  await apiAs(request, b.token, 'POST', `/api/friends/requests/${requestId}/accept`);
}

test('Vista común de una cuenta nueva: orientación, no «Parámetros no válidos»', async ({ page, request }, info) => {
  const { u } = await user(request, 'vcn');
  await distinctIp(page);
  await loginUI(page, u);
  await page.goto('/#/calendario?vista=grupo');
  await expect(page.getByText('Aún no puedes ver el calendario de nadie.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Ventanas candidatas/ })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Parámetros no válidos');
  await expect(page.locator('main')).toContainText('Se buscan ventanas en las que encaje la persona que comparte.');
  await expectNoHorizontalOverflow(page, `vista común vacía (${info.project.name})`);
});

test('disponibilidad oculta frente a sin indicar: quien comparte solo con amistades sabe quién del viaje no la ve', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const ana = await user(request, 'ocA');
  const bea = await user(request, 'ocB');
  const car = await user(request, 'ocC');
  // Ana es amiga de Bea y de Carla; Bea y Carla no son amigas entre sí.
  await befriend(request, ana, bea);
  await befriend(request, ana, car);
  const y = seasonStartYear();
  const { trip } = await apiAs(request, ana.token, 'POST', '/api/trips', { name: 'Ocultas', nights: 2 });
  const { invitation } = await apiAs(request, ana.token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true, maxUses: 3 });
  for (const p of [bea, car]) await apiAs(request, p.token, 'POST', '/api/trips/invitations/accept-link', { token: invitation.token });
  // Ana y Bea comparten «con todas mis amistades» y marcan días; Ana vie–dom, Bea solo vie–sáb.
  await apiAs(request, ana.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await apiAs(request, bea.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await apiAs(request, ana.token, 'PUT', '/api/availability/me', { set: [`${y}-12-11`, `${y}-12-12`, `${y}-12-13`].map((day) => ({ day, status: 'free' })) });
  await apiAs(request, bea.token, 'PUT', '/api/availability/me', { set: [`${y}-12-11`, `${y}-12-12`].map((day) => ({ day, status: 'free' })) });

  // Bea comparte «con amistades», pero Carla (miembro, no amiga) no la ve: antes no se le avisaba.
  const pb = await newUserPage(browser, info);
  await loginUI(pb, bea.u);
  await pb.goto(`/#/viajes/${trip.id}/calendario`);
  const notice = pb.getByRole('region', { name: 'Quién ve tu disponibilidad en este viaje' });
  await expect(notice).toContainText(`${car.u.alias} no es amistad tuya y no ve tu disponibilidad`);
  await expectNoHorizontalOverflow(pb, `aviso de compartir (${info.project.name})`);

  // Carla ve a Bea como «no comparte» y entiende que no es lo mismo que «sin indicar».
  const pc = await newUserPage(browser, info);
  await loginUI(pc, car.u);
  await pc.goto(`/#/viajes/${trip.id}/calendario`);
  const unanswered = pc.getByRole('region', { name: 'Quién falta por responder' });
  await expect(unanswered).toContainText(`No comparten su calendario contigo: ${bea.u.alias}`);
  await expect(unanswered).toContainText('No es lo mismo que «sin indicar»');

  // Bea comparte con el viaje desde el aviso: el aviso desaparece y Carla ya la ve.
  await notice.getByRole('button', { name: 'Compartir con este viaje' }).click();
  await waitToast(pb, 'Ahora los miembros de este viaje pueden ver tu disponibilidad.');
  await expect(notice).toHaveCount(0);
  await pc.reload();
  await expect(unanswered).not.toContainText(`No comparten su calendario contigo: ${bea.u.alias}`);

  // Ventanas: Bea libre vie–sáb no encaja en vie→dom (2 noches = 3 días). El estado vacío lo explica.
  await expect(pc.getByText('No hay ventanas que encajen')).toBeVisible();
  await expect(pc.locator('main')).toContainText('2 noches son 3 días');
  await pb.context().close();
  await pc.context().close();
});

test('candidaturas: el aviso «Votar no es reservar» no se repite', async ({ page, request }) => {
  const { u, token } = await user(request, 'vnr');
  await distinctIp(page);
  await loginUI(page, u);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Aviso único' });
  await page.goto(`/#/viajes/${trip.id}/candidaturas`);
  await expect(page.getByText('Votar no es reservar.')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Votar no es reservar. Votar no es reservar.');
});

test('Apuntar cotización desde la ficha: se distingue del precio orientativo y exige fechas', async ({ page, request }, info) => {
  const { u, token } = await user(request, 'cot');
  await distinctIp(page);
  await loginUI(page, u);
  const { trip } = await apiAs(request, token, 'POST', '/api/trips', { name: 'Cotizar sin fechas' });
  await page.goto('/#/estaciones/e2e-beta');
  await page.getByLabel('Viaje', { exact: true }).selectOption(trip.id);
  await page.getByRole('link', { name: 'Apuntar cotización' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apuntar cotización' });
  await expect(dialog).toContainText('Los precios «desde» de la ficha son orientativos');
  await expectNoHorizontalOverflow(page, `diálogo apuntar cotización (${info.project.name})`);
  await dialog.getByLabel('Título').fill('Hotel Uno, puente');
  await dialog.getByLabel('Importe (€)').fill('89');
  await dialog.getByRole('button', { name: 'Añadir' }).click();
  // Una cotización sin fechas no es una cotización exacta: se pide la entrada y la salida o marcarla como estimación.
  await expect(dialog.getByRole('alert')).toContainText('Una cotización es para unas fechas concretas');
  // El error queda al final del formulario: en móvil, antes no se veía y parecía que «Añadir» no hacía nada.
  await expect(dialog.getByRole('alert')).toBeInViewport();
  const y = seasonStartYear() + 1;
  await dialog.getByLabel('Entrada').fill(`${y}-01-15`);
  await dialog.getByLabel('Salida').fill(`${y}-01-17`);
  await dialog.getByRole('button', { name: 'Añadir' }).click();
  await waitToast(page, 'Cotización añadida.');
  const card = page.getByRole('list', { name: 'Candidaturas' }).getByRole('listitem').first();
  await expect(card).toContainText('cotización de un miembro');
});
