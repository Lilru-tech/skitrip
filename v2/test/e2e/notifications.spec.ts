import { expect, test } from '@playwright/test';
import { dedupeCards, parseOfferCardsHtml } from '../../src/core/parsers/offers';
import { cardToOffer } from '../../tools/collectors/offer-payload';
import { E2E_INGEST_TOKEN } from './env';
import { apiAs, BASE, createUserViaApi, distinctIp, expectNoHorizontalOverflow, loginUI, makeUser, uniq } from './helpers';

// Recorrido completo de avisos: tarjetas sintéticas → analizador real → ingesta (credencial de prueba) → oferta guardada
// → cambio de precio en una segunda captura → avisos → «Marcar todos como leídos» (una sola petición por lotes).
test('avisos de cambio de precio: «Marcar todos como leídos» los marca todos y persiste', async ({ page, request }, info) => {
  const u = makeUser('ntf');
  const token = await createUserViaApi(request, u);
  const tag = uniq();
  const hotels = [1, 2, 3].map((i) => `Hotel Aviso ${i} ${tag}`);
  const html = (price: number) => hotels.map((h, i) =>
    `<article data-offer-id="ntf-${tag}-${i}"><h3>${h}</h3><p>del 10/01/2027 al 12/01/2027, 2 adultos, sin menores, 1 habitación, 2 noches, sin forfait</p><span class="price">${price + i * 10} € por persona</span></article>`).join('');
  const ingest = async (price: number, at: number) => {
    const offers = dedupeCards(parseOfferCardsHtml(html(price), 'estiber')).map((c) => cardToOffer(c, 'estiber-cards@e2e'));
    expect(offers).toHaveLength(3);
    const r = await request.post(`${BASE}/api/ingest/offers`, {
      headers: { Authorization: `Bearer ${E2E_INGEST_TOKEN}` },
      data: { run: { id: `e2e-ntf-${tag}-${at}`, pipeline: 'offers', startedAt: at - 1000, finishedAt: at, expected: 1, ok: 1, failed: 0, unsupported: 0 },
        observedAt: at, results: [], catalog: [{ sourceId: 'e2e-alfa-sur-offers', outcome: 'results', offers }] },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  await ingest(200, Date.now() - 3 * 3600_000);
  const area = await (await request.get(`${BASE}/api/public/areas/e2e-alfa-sur`)).json();
  const ids = area.offers.items.filter((o: any) => hotels.includes(o.hotel_name_raw)).map((o: any) => o.id);
  expect(ids).toHaveLength(3);
  for (const id of ids) await apiAs(request, token, 'PUT', `/api/offers/${id}/save`);
  await ingest(240, Date.now() - 3600_000); // +20 %: un aviso por oferta guardada

  await distinctIp(page);
  await loginUI(page, u);
  await expect(page.getByRole('link', { name: 'Avisos: 3 sin leer' })).toBeVisible();
  await page.goto('/#/avisos');
  const list = page.getByRole('list', { name: 'Avisos' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByText('Sin leer')).toHaveCount(3);
  const batch = page.waitForRequest((r) => r.url().endsWith('/api/notifications/read') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Marcar todos como leídos' }).click();
  expect(((await batch).postDataJSON() as { ids: string[] }).ids).toHaveLength(3);
  await expect(list.getByText('Leído', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Marcar todos como leídos' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, `avisos (${info.project.name})`);
  await page.reload();
  await expect(list.getByText('Leído', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Avisos: ninguno sin leer' })).toBeVisible();
});
