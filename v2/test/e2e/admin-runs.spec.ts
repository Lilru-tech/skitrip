import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { AUTH, BASE, apiAs, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, waitToast } from './helpers';

// Administración › Pistas con datos sintéticos (test/e2e/seed.sql). Cada proyecto de Playwright edita su propia estación
// con un catálogo importado válido: la aportación queda guardada pero no se aplica (prevalece el importado), así que lo
// que ven las demás pruebas no cambia. La D1 de E2E se recrea en cada ejecución.
const ADMIN = { email: 'admin-e2e@example.test', password: 'admin-e2e-Pass1', uid: 'e2eAdminUid0000000000001', alias: 'admin-e2e' };
// Temporada de la aportación = la del catálogo importado (o sin indicar si no consta): así prevalece el importado.
const MINE: Record<string, { id: string; name: string; total: number; season: string }> = {
  'mobile-360': { id: 'e2e-alfa-norte', name: 'Alfa Norte (sintético)', total: 40, season: '2025-26' },
  'mobile-390': { id: 'e2e-cerrada', name: 'Épsilon Cerrada (sintético)', total: 25, season: '2026-27' },
  'desktop-1280': { id: 'e2e-lejana', name: 'Gamma Lejana (sintético)', total: 120, season: '' },
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
const areaCard = (page: Page, name: string) => page.getByRole('list', { name: 'Estaciones y dominios' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });

test('administración de pistas: secciones, filtros, vista previa, validación, conflicto, retirar e historial', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const mine = MINE[info.project.name];
  const token = await adminToken(request);
  await distinctIp(page);
  await loginUI(page, ADMIN);

  // Secciones: Pistas por defecto; las demás se abren con su pestaña.
  await page.goto('/#/admin');
  const tabs = page.getByRole('navigation', { name: 'Secciones de administración' });
  await expect(tabs.getByRole('link', { name: 'Pistas' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 2, name: 'Pistas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Salud de las fuentes' })).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Cuentas' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Cuentas bloqueadas' })).toBeVisible();
  await expect(page.getByText(/falta un listado de cuentas bloqueadas/)).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Vigilancia' }).click();
  await expect(page.getByRole('heading', { name: 'Salud de las fuentes' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Datos antiguos' }).click();
  await expect(page.getByRole('heading', { name: 'Importar la hoja antigua (CSV)' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Pistas' }).click();

  // Filtros y búsqueda.
  await page.getByLabel('Datos por revisar').check();
  await expect(areaCard(page, 'Beta (sintético)')).toContainText('Por revisar');
  await page.getByLabel('Faltan datos').check();
  await expect(areaCard(page, 'Delta Sin Ruta (sintético)')).toContainText('Sin total');
  await expect(areaCard(page, 'Alfa Sur (sintético)')).toContainText('30 pistas');
  await page.getByLabel('Todas').check();
  await page.getByLabel('Buscar estación o dominio').fill('alfa');
  await expect(areaCard(page, 'Dominio Alfa (sintético)')).toBeVisible();
  await expect(areaCard(page, 'Beta (sintético)')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `admin pistas lista (${info.project.name})`);

  // Una estación de dominio sin colores: la vista previa dice cómo quedaría el dominio, sin guardar.
  await areaCard(page, 'Alfa Sur (sintético)').getByRole('link', { name: /Editar pistas/ }).click();
  await page.getByLabel('Pistas verdes').fill('8');
  await page.getByLabel('Pistas azules').fill('10');
  const preview = page.getByRole('region', { name: 'Antes de guardar: lo que verá el usuario' });
  await expect(preview).toContainText('Es una estación de Dominio Alfa (sintético)');
  await expect(preview).toContainText('Dominio Alfa (sintético) puntuaría con 70 pistas (suma de sus estaciones)');
  await expect(preview).toContainText('completado con una aportación manual (verdes, azules');
  await page.getByLabel('Pistas rojas').fill('20');
  // Sin total propio, 8 + 10 + 20 supera el total importado (30): no se mezcla y se avisa antes de guardar.
  await expect(preview).toContainText('Esta aportación no se aplicará');
  await expect(preview).toContainText('no cuadra');
  await page.getByRole('link', { name: 'Pistas', exact: true }).first().click();

  // Discrepancia (Beta): una casilla no basta; hace falta explicación con evidencia.
  await page.getByLabel('Buscar estación o dominio').fill('beta');
  await areaCard(page, 'Beta (sintético)').getByRole('link', { name: /Editar pistas/ }).click();
  await expect(page.getByText(/El catálogo importado tiene una discrepancia pendiente/)).toBeVisible();
  await page.getByLabel('Total de pistas').fill('70');
  await page.getByLabel('Fuente o referencia comprobable').fill('https://example.invalid/beta-ficha-2026');
  await page.getByLabel('Motivo (solo administración)').fill('Prueba de discrepancia');
  await page.getByRole('button', { name: 'Guardar aportación' }).click();
  await expect(page.getByRole('alert')).toContainText('discrepancia pendiente');
  await page.getByLabel('Explicación con evidencia (se publica en los detalles)').fill('La ficha 2026-27 cuenta 70 pistas y su desglose suma 70.');
  await expect(page.getByTestId('run-errors')).toHaveCount(0);
  await expect(preview).toContainText('Puede puntuar en «Variedad de pistas» al planificar con 70 pistas');
  await page.getByRole('link', { name: 'Pistas', exact: true }).first().click();

  // Mi estación: catálogo importado válido; la aportación se guarda pero no se aplica, y se explica antes de guardar.
  await page.getByLabel('Buscar estación o dominio').fill(mine.name.split(' (')[0]);
  await areaCard(page, mine.name).getByRole('link', { name: /Editar pistas/ }).click();
  await page.getByLabel('Total de pistas').fill(String(mine.total + 1));
  await page.getByLabel('Fuente o referencia comprobable').fill('Folleto sintético de prueba, página 2');
  await page.getByLabel('Temporada (si se conoce)').fill(mine.season);
  await expect(preview).toContainText('Esta aportación no se aplicará');
  await expect(preview).toContainText('prevalece');
  await page.getByLabel('Motivo (solo administración)').fill('Prueba E2E');
  await page.getByLabel('Motivo (solo administración)').press('Enter');
  await waitToast(page, `Pistas de ${mine.name} guardadas.`);
  const values = page.getByRole('region', { name: 'Valores actuales de pistas' });
  await expect(values.getByRole('row', { name: /Total/ })).toContainText(`${mine.total}${mine.total + 1}${mine.total} · importado · prevalece el importado`);
  await expect(page.getByText('Aportación no aplicada')).toBeVisible();

  // Otro administrador guarda mientras tanto: no se sobrescribe en silencio.
  const body = { expectedVersion: 1, total: mine.total + 2, green: null, blue: null, red: null, black: null, comparable: true, resolution: null, season: mine.season || null, sourceDate: null, sourceRef: 'Folleto sintético de prueba, página 3', reason: 'Edición paralela' };
  await apiAs(request, token, 'PUT', `/api/admin/runs/${mine.id}`, body);
  await page.getByLabel('Motivo (solo administración)').fill('Segunda edición');
  await page.getByRole('button', { name: 'Guardar aportación' }).click();
  await expect(page.getByRole('alert')).toContainText('Otro administrador ha cambiado esta aportación');
  await page.getByRole('button', { name: 'Recargar' }).click();
  await expect(page.getByLabel('Total de pistas')).toHaveValue(String(mine.total + 2));

  // Retirar (con motivo) y ver el historial completo.
  await page.getByRole('button', { name: 'Retirar aportación' }).click();
  const dlg = page.getByRole('dialog', { name: `¿Retirar la aportación de ${mine.name}?` });
  await dlg.getByLabel('Motivo').fill('Fin de la prueba');
  await dlg.getByRole('button', { name: 'Retirar' }).click();
  await waitToast(page, 'Aportación retirada: se conserva en el historial.');
  await expect(page.getByRole('button', { name: 'Restaurar aportación' })).toBeVisible();
  await page.locator('details.fold > summary', { hasText: 'Historial' }).click();
  const hist = page.getByRole('list', { name: 'Historial de cambios' });
  await expect(hist.getByRole('listitem')).toHaveCount(3);
  await expect(hist.getByRole('listitem').nth(0)).toContainText('Aportación retirada');
  await expect(hist.getByRole('listitem').nth(0)).toContainText('Motivo: Fin de la prueba');
  await expect(hist.getByRole('listitem').nth(1)).toContainText(`Antes: total ${mine.total + 1}`);
  await expect(hist.getByRole('listitem').nth(2)).toContainText(`Aportación creada · `);
  await expect(hist.getByRole('listitem').nth(2)).toContainText(ADMIN.alias);
  await expectNoHorizontalOverflow(page, `admin pistas editor (${info.project.name})`);

  // La ficha pública sigue con la cifra oficial y sin motivo ni autoría.
  await page.goto(`/#/estaciones/${mine.id}`);
  await expect(page.getByRole('heading', { level: 1, name: mine.name })).toBeVisible();
  await expect(page.getByText('Aportación manual de administración')).toHaveCount(0);
  await expect(page.getByText('Prueba E2E')).toHaveCount(0);
});

test('administración de pistas: una cuenta normal no la ve ni puede usar su API', async ({ page, request }) => {
  const u = makeUser('rnu');
  const token = await createUserViaApi(request, u);
  for (const [method, path] of [['GET', '/api/admin/runs'], ['PUT', '/api/admin/runs/e2e-beta']] as const) {
    expect((await request.fetch(`${BASE}${path}`, { method, data: method === 'PUT' ? { total: 1 } : undefined, headers: { Authorization: `Bearer ${token}` } })).status()).toBe(404);
  }
  await distinctIp(page);
  await loginUI(page, u);
  await page.goto('/#/admin?seccion=pistas');
  await expect(page.getByRole('heading', { level: 1, name: 'Página no disponible' })).toBeVisible();
});
