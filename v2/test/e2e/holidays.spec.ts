import { expect, test } from '@playwright/test';
import { BASE, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser } from './helpers';
import { E2E_INGEST_TOKEN } from './env';

// Festivos y vacaciones con periodos SINTÉTICOS enviados por la ingesta local (credencial de prueba), en 2031 para no
// cruzarse con otras pruebas: ni OpenHolidays ni producción. Sustituye a la antigua sección de afluencia.

const per = (calendarId: string, kind: 'public' | 'school', start: string, end: string, name: string, parts: string | null = null) =>
  ({ calendarId, kind, start, end, name, scope: parts ? 'part' : 'all', parts });

test('ficha: qué calendarios tienen fiesta o vacaciones en las fechas, en parte, sin calendario y fin de semana', async ({ page, request }, info) => {
  const r = await request.post(`${BASE}/api/ingest/holidays`, { headers: { Authorization: `Bearer ${E2E_INGEST_TOKEN}` }, data: { from: '2031-01-01', to: '2031-12-31', periods: [
    per('fr-zc', 'school', '2031-02-22', '2031-03-09', "Vacances d'hiver"), per('fr-zc', 'public', '2031-12-25', '2031-12-25', 'Noël'),
    per('es-ct', 'school', '2031-06-21', '2031-09-08', 'Vacaciones de verano'), per('es-ct', 'public', '2031-12-26', '2031-12-26', 'San Esteban'),
    per('es-ar', 'school', '2031-03-03', '2031-03-03', 'Día no lectivo', 'AR-TE'), per('es-ar', 'school', '2031-06-25', '2031-09-10', 'Vacaciones de verano'), per('es-ar', 'public', '2031-12-25', '2031-12-25', 'Navidad'),
  ] } });
  expect(r.status(), await r.text()).toBe(200);
  const u = makeUser('fest');
  await createUserViaApi(request, u);
  await distinctIp(page);
  await loginUI(page, u);

  await page.goto('/#/estaciones/e2e-beta?desde=2031-03-01&hasta=2031-03-03');
  const sec = page.getByTestId('holidays');
  await expect(sec.getByRole('heading', { name: 'Festivos y vacaciones en estas fechas' })).toBeVisible();
  await expect(sec).toContainText('No es una cifra de gente');
  const sum = sec.getByTestId('holidays-summary');
  await expect(sum).toContainText('Con fiesta o vacaciones: Francia, zona C.');
  await expect(sum).toContainText('Solo en parte de: Aragón.');
  await expect(sum).toContainText('Sin calendario publicado todavía:');
  await expect(sum).toContainText('Andorra');
  await expect(sum).not.toContainText('Cataluña');
  await expect(sum).toContainText('Fin de semana: sáb 1 mar y dom 2 mar.');
  await sec.getByText('Ver por calendario').click();
  await expect(sec.getByTestId('holidays-fr-zc')).toContainText("Vacances d'hiver (vacaciones escolares, 22/02–09/03)");
  await expect(sec.getByTestId('holidays-es-ar')).toContainText('Día no lectivo (vacaciones escolares, 03/03; solo en AR-TE)');
  await expect(sec.getByTestId('holidays-es-ct')).toContainText('sin festivos ni vacaciones escolares');
  await expect(sec.getByTestId('holidays-ad')).toContainText('calendario aún no publicado');
  await expect(sec).toContainText('OpenHolidays API');
  // La afluencia histórica ya no está.
  await expect(page.getByRole('heading', { name: /Afluencia/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `festivos (${info.project.name})`);
});
