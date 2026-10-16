import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, createUserViaApi, expectNoHorizontalOverflow, loginUI, makeUser, newUserPage, seasonStartYear, waitToast, type TestUser } from './helpers';

// «Ocupado» visible en la vista común: antes solo estaba en la etiqueta accesible de la casilla, no en su contenido.
// Cuentas sintéticas del emulador y D1 local aislada (test/e2e/.state).

async function user(request: APIRequestContext, prefix: string) {
  const u = makeUser(prefix);
  return { u, token: await createUserViaApi(request, u) };
}
async function befriend(request: APIRequestContext, a: { token: string }, b: { u: TestUser; token: string }) {
  const { users } = await apiAs(request, a.token, 'GET', `/api/friends/search?q=${encodeURIComponent(b.u.alias)}`);
  const { requestId } = await apiAs(request, a.token, 'POST', '/api/friends/requests', { userId: users[0].id });
  await apiAs(request, b.token, 'POST', `/api/friends/requests/${requestId}/accept`);
}

test('27/02 ocupado: se ve en Mi disponibilidad y en Vista común, como recuento y como estado propio, sin compartir', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const ana = await user(request, 'ocuA');
  const bea = await user(request, 'ocuB');
  const car = await user(request, 'ocuC');
  await befriend(request, ana, bea);
  await befriend(request, ana, car);
  const day = `${seasonStartYear() + 1}-02-27`;
  // Bea comparte con amistades y está libre ese día; Carla no comparte (y marca ocupado: Ana nunca debe verlo).
  await apiAs(request, bea.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
  await apiAs(request, bea.token, 'PUT', '/api/availability/me', { set: [{ day, status: 'free' }] });
  await apiAs(request, car.token, 'PUT', '/api/availability/me', { set: [{ day, status: 'busy' }] });

  // Ana NO comparte su calendario con nadie y marca el día como ocupado desde la interfaz.
  const p = await newUserPage(browser, info);
  await loginUI(p, ana.u);
  await p.goto('/#/calendario?vista=mia');
  const mine = p.locator(`[data-date="${day}"]`);
  await mine.scrollIntoViewIfNeeded();
  await mine.click();
  await mine.click();
  await p.getByRole('region', { name: 'Aplicar estado a la selección' }).getByRole('button', { name: 'Ocupado' }).click();
  await waitToast(p, /Guardado: 1 día como «ocupado»/);
  await expect(mine).toHaveAttribute('aria-label', /: ocupado$/);
  await expect(mine).toContainText('✕');
  await expectNoHorizontalOverflow(p, `mi disponibilidad (${info.project.name})`);

  // Vista común (al cambiar de pestaña se vuelve a pedir): el ocupado se ve en el contenido, no solo en la etiqueta.
  await p.getByRole('link', { name: 'Vista común' }).click();
  await p.getByRole('checkbox', { name: new RegExp(car.u.alias) }).check();
  const common = p.locator(`[data-date="${day}"]`);
  await expect(common).toHaveAttribute('aria-label', /1 libre, 1 ocupado, 1 no compartido; tú: ocupado$/);
  await expect(common.locator('.gc-n-busy')).toHaveText('1✕');
  await expect(common.locator('.gc-n-free')).toHaveText('1✓');
  await expect(common.locator('.gc-n-hidden')).toHaveText('1—');
  await expect(common.locator('.gc-mine')).toHaveText('✕');
  // Agregado: el día no queda pintado como «ocupado» para todo el grupo (Bea está libre).
  await expect(common).toHaveClass(/gc-some/);
  await expectNoHorizontalOverflow(p, `vista común (${info.project.name})`);

  // Detalle por persona al seleccionar el día; Carla aparece como «no compartido», nunca con su estado.
  await common.scrollIntoViewIfNeeded();
  await common.click();
  await common.click();
  const detail = p.getByRole('region', { name: 'Detalle de la selección' });
  await expect(detail).toContainText(`Libre (1)${bea.u.alias}`);
  await expect(detail).toContainText(`Ocupado (1)${ana.u.alias} (tú)`);
  await expect(detail).toContainText(`No compartido (1)${car.u.alias}`);
  await expectNoHorizontalOverflow(p, `detalle del día (${info.project.name})`);

  // Persistencia: tras recargar sigue ocupado en ambas vistas.
  await p.reload();
  await expect(p.locator(`[data-date="${day}"]`)).toHaveAttribute('aria-label', /tú: ocupado$/);
  await p.getByRole('link', { name: 'Mi disponibilidad' }).click();
  await expect(p.locator(`[data-date="${day}"]`)).toHaveAttribute('aria-label', /: ocupado$/);

  // Bea no ve el ocupado de Ana: Ana no comparte.
  const pb = await newUserPage(browser, info);
  await loginUI(pb, bea.u);
  await pb.goto('/#/calendario?vista=grupo');
  await pb.getByRole('checkbox', { name: new RegExp(ana.u.alias) }).check();
  await expect(pb.locator(`[data-date="${day}"]`)).toHaveAttribute('aria-label', /1 libre, 1 no compartido; tú: libre$/);
  await expect(pb.locator(`[data-date="${day}"] .gc-n-busy`)).toHaveCount(0);
  await p.context().close();
  await pb.context().close();
});
