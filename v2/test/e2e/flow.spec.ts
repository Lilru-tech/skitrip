import { expect, test } from '@playwright/test';
import { makeUser, newUserPage, seasonStartYear, signUpUI, waitToast } from './helpers';

// Recorrido completo con dos personas: registro + alias, amistad, compartir calendario,
// marcar días, crear viaje, invitar, aceptar y ver una ventana candidata en el calendario del viaje.
test('dos amigos organizan un viaje y encuentran una ventana candidata', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const ana = makeUser('ana');
  const bea = makeUser('bea');
  const pa = await newUserPage(browser, info);
  const pb = await newUserPage(browser, info);

  await signUpUI(pa, ana);
  await signUpUI(pb, bea);

  // Amistad: Ana busca a Bea por alias y le envía solicitud; Bea la acepta.
  await pa.goto('/#/amigos');
  await pa.getByLabel('Alias', { exact: true }).fill(bea.alias);
  const result = pa.getByRole('list', { name: 'Resultados de la búsqueda' }).getByRole('listitem').filter({ hasText: bea.alias });
  await result.getByRole('button', { name: 'Enviar solicitud' }).click();
  await waitToast(pa, `Solicitud enviada a ${bea.alias}.`);

  await pb.goto('/#/amigos');
  await pb.getByRole('button', { name: `Aceptar a ${ana.alias}` }).click();
  await waitToast(pb, `Ahora eres amigo de ${ana.alias}.`);
  await expect(pb.getByRole('region', { name: /Tus amigos/ }).getByText(ana.alias, { exact: true })).toBeVisible();

  // Ambas comparten su disponibilidad con sus amistades y marcan del viernes 11 al domingo 13 de diciembre como libres.
  const y = seasonStartYear();
  const days = [`${y}-12-11`, `${y}-12-12`, `${y}-12-13`];
  for (const p of [pa, pb]) {
    await p.goto('/#/calendario?vista=compartir');
    await p.getByLabel('Todas mis amistades').check();
    await p.getByRole('button', { name: 'Guardar' }).click();
    await waitToast(p, 'Preferencias de compartición guardadas.');

    await p.goto('/#/calendario');
    await p.locator(`[data-date="${days[0]}"]`).click();
    await p.locator(`[data-date="${days[2]}"]`).click();
    await expect(p.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(3);
    await p.getByRole('region', { name: 'Aplicar estado a la selección' }).getByRole('button', { name: 'Libre' }).click();
    await waitToast(p, 'Guardado: 3 días como «libre».');
    for (const d of days) await expect(p.locator(`[data-date="${d}"]`)).toHaveAttribute('aria-label', /: libre$/);
  }

  // Ana crea el viaje e invita a Bea.
  const tripName = `Puente ${y} ${ana.alias.slice(-4)}`;
  await pa.goto('/#/viajes');
  await pa.getByRole('button', { name: 'Nuevo viaje' }).click();
  const dialog = pa.getByRole('dialog', { name: 'Nuevo viaje' });
  await dialog.getByLabel('Nombre del viaje').fill(tripName);
  await dialog.getByLabel('Noches').fill('2');
  await dialog.getByLabel('Presupuesto por persona (€)').fill('350,50');
  await dialog.getByRole('button', { name: 'Crear viaje' }).click();
  await expect(pa.getByRole('heading', { level: 1, name: tripName })).toBeVisible();
  await expect(pa.getByText('350,50 €')).toBeVisible();
  await pa.getByLabel('Amigo', { exact: true }).selectOption({ label: bea.alias });
  await pa.getByRole('button', { name: 'Enviar invitación' }).click();
  await waitToast(pa, `Invitación enviada a ${bea.alias}.`);

  // Bea acepta la invitación.
  await pb.goto('/#/viajes');
  await pb.getByRole('button', { name: `Aceptar invitación a ${tripName}` }).click();
  await waitToast(pb, `Te has unido a «${tripName}».`);
  await expect(pb.getByRole('link', { name: new RegExp(tripName) })).toBeVisible();

  // Calendario del viaje: aparece la ventana vie 11 → dom 13 con ambas libres.
  await pa.reload();
  await expect(pa.getByRole('region', { name: /Miembros/ }).getByText(bea.alias, { exact: true })).toBeVisible();
  await pa.getByRole('link', { name: 'Calendario del viaje' }).click();
  await expect(pa.getByRole('heading', { level: 1, name: 'Calendario del viaje' })).toBeVisible();
  const isDesktop = (info.project.use.viewport?.width ?? 0) >= 1000;
  const windowRow = isDesktop
    ? pa.locator('.window-table tbody tr').filter({ hasText: 'vie 11 dic' }).first()
    : pa.getByRole('list', { name: 'Ventanas candidatas' }).getByRole('listitem').filter({ hasText: 'vie 11 dic' }).first();
  await expect(windowRow).toBeVisible();
  await expect(windowRow).toContainText('dom 13 dic');
  await expect(windowRow).toContainText(isDesktop ? 'Con libres' : 'Encaja con quien está libre');
  await expect(windowRow).toContainText(bea.alias);

  // Proponer esas fechas y votar.
  await windowRow.getByRole('button', { name: /Proponer/ }).click();
  await waitToast(pa, /Fechas propuestas/);
  await pa.getByRole('group', { name: /Tu voto para vie 11 dic/ }).getByRole('button', { name: 'Sí' }).click();
  await waitToast(pa, 'Voto guardado: Sí.');
  await expect(pa.getByRole('group', { name: /Tu voto para vie 11 dic/ }).getByRole('button', { name: 'Sí' })).toHaveAttribute('aria-pressed', 'true');

  // El email de la otra persona nunca aparece.
  for (const [p, other] of [[pa, bea], [pb, ana]] as const) {
    await expect(p.locator('body')).not.toContainText(other.email);
  }
  await pa.context().close();
  await pb.context().close();
});
