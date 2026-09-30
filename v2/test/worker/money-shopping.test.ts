import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fetchOpenPrices } from '../../src/worker/open-prices';
import { enabledProviders, mercadonaDirect } from '../../src/worker/price-providers';
import { api, befriend, signup } from './helpers';

async function tripWith(n: number) {
  const users = [];
  for (let i = 0; i < n; i++) users.push(await signup());
  const [o, ...rest] = users;
  const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Gastos' })).json.trip;
  for (const u of rest) {
    await befriend(o, u);
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: u.id })).json.invitation;
    await api(u.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
  }
  return { trip, users };
}

describe('gastos', () => {
  it('10 € entre tres suma 10 €, saldos cero y la transferencia no duplica el gasto', async () => {
    const { trip, users: [a, b, c] } = await tripWith(3);
    const r = await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Peaje', spentOn: '2027-01-02', payerId: a.id, amountCents: 1000, split: { mode: 'equal', participants: [a.id, b.id, c.id] } });
    expect(r.status).toBe(201);
    let s = (await api(b.token, 'GET', `/api/trips/${trip.id}/expenses`)).json;
    expect(Object.values(s.expenses[0].shares).reduce((x: number, y: any) => x + y, 0)).toBe(1000);
    expect(s.balanceCheckCents).toBe(0);
    for (const t of s.suggestedTransfers) {
      const payer = [a, b, c].find((u) => u.id === t.fromUser)!;
      expect((await api(payer.token, 'POST', `/api/trips/${trip.id}/settlements`, { ...t, paidOn: '2027-01-03' })).status).toBe(201);
    }
    s = (await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json;
    expect(s.expenses).toHaveLength(1);
    expect(Object.values(s.balances).every((v) => v === 0)).toBe(true);
  });

  it('reparto personalizado debe sumar el total y los beneficiarios ser miembros', async () => {
    const { trip, users: [a, b] } = await tripWith(2);
    const outsider = await signup();
    const bad = await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'x', spentOn: '2027-01-02', payerId: a.id, amountCents: 1000, split: { mode: 'custom', shares: [{ userId: a.id, shareCents: 500 }, { userId: b.id, shareCents: 400 }] } });
    expect(bad.json.error.code).toBe('split_mismatch');
    const out = await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'x', spentOn: '2027-01-02', payerId: a.id, amountCents: 1000, split: { mode: 'equal', participants: [a.id, outsider.id] } });
    expect(out.status).toBe(422);
  });

  it('otro grupo no ve ni edita gastos manipulando IDs; edición concurrente con 409', async () => {
    const { trip, users: [a, b] } = await tripWith(2);
    const intruder = await signup();
    const e = (await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Súper', spentOn: '2027-01-02', payerId: a.id, amountCents: 3000, split: { mode: 'equal', participants: [a.id, b.id] } })).json;
    const body = { concept: 'Súper', spentOn: '2027-01-02', payerId: a.id, amountCents: 3100, split: { mode: 'equal', participants: [a.id, b.id] }, version: 1 };
    expect((await api(intruder.token, 'PUT', `/api/trips/${trip.id}/expenses/${e.id}`, body)).status).toBe(404);
    const other = (await api(intruder.token, 'POST', '/api/trips', { name: 'Mío' })).json.trip;
    expect((await api(intruder.token, 'PUT', `/api/trips/${other.id}/expenses/${e.id}`, body)).status).toBe(404);
    expect((await api(a.token, 'PUT', `/api/trips/${trip.id}/expenses/${e.id}`, body)).status).toBe(200);
    expect((await api(a.token, 'PUT', `/api/trips/${trip.id}/expenses/${e.id}`, body)).json.error.code).toBe('version_conflict');
    const hist = (await api(b.token, 'GET', `/api/trips/${trip.id}/expenses/history`)).json.history;
    expect(hist.map((h: any) => h.action)).toEqual(['update', 'create']);
  });
});

const TICKET = `MERCADONA, S.A.
C/ EJEMPLO 1
43007 TARRAGONA
30/09/2026 18:42 OP: 1
FACTURA SIMPLIFICADA: 1
Descripción P. Unit Importe
1 LECHE ENTERA 0,89
2 AGUA MINERAL 5L 1,20 2,40
TOTAL (€) 3,29`;

describe('compra y precios', () => {
  it('ticket: revisión previa, sin duplicados y vinculación única a un gasto; un precio nuevo no cambia el gasto pagado', async () => {
    const { trip, users: [a, b] } = await tripWith(2);
    const leche = (await api(a.token, 'POST', '/api/products', { name: 'Leche entera Hacendado', format: 'Brick 1 L' })).json.product;
    expect(leche).toMatchObject({ netQty: 1000, netUnit: 'ml' });
    const prev = (await api(a.token, 'POST', '/api/receipts/preview', { text: TICKET, storeLabel: 'Mercadona Tarragona', channel: 'store', postalCode: '43007' })).json;
    expect(prev.parsed.totalCents).toBe(329);
    expect(prev.duplicate).toBeNull();
    const conf = await api(a.token, 'POST', '/api/receipts/confirm', { text: TICKET, storeLabel: 'Mercadona Tarragona', channel: 'store', postalCode: '43007', tripId: trip.id, mapping: [{ lineNo: prev.parsed.lines[0].lineNo, productId: leche.id }] });
    expect(conf.status).toBe(201);
    expect(conf.json.prices).toBe(1);
    const again = await api(a.token, 'POST', '/api/receipts/confirm', { text: TICKET + '\n', storeLabel: 'Mercadona Tarragona', channel: 'store', postalCode: '43007', mapping: [] });
    expect(again.json.error.code).toBe('receipt_duplicate');
    const exp = await api(a.token, 'POST', `/api/receipts/${conf.json.receiptId}/expense`, { tripId: trip.id, participants: [a.id, b.id] });
    expect(exp.status).toBe(201);
    expect((await api(a.token, 'POST', `/api/receipts/${conf.json.receiptId}/expense`, { tripId: trip.id, participants: [a.id, b.id] })).json.error.code).toBe('receipt_already_linked');
    await api(a.token, 'POST', '/api/prices', { productId: leche.id, amountCents: 99, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: '2026-10-05' });
    const s = (await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json;
    expect(s.expenses[0].amountCents).toBe(329);
    const series = (await api(b.token, 'GET', `/api/products/${leche.id}/prices`)).json.series;
    expect(Object.keys(series).sort()).toEqual(['propio:receipt_effective:store', 'propio:shelf:online']);
    expect(series['propio:shelf:online'][0].unitPrice).toMatchObject({ perKgOrL_cents: 99, label: '€/L' });
  });

  it('los precios privados no se ven desde otro grupo', async () => {
    const a = await signup(); const x = await signup();
    const p = (await api(a.token, 'POST', '/api/products', { name: 'Pan de molde', format: 'Paquete 460 g' })).json.product;
    await api(a.token, 'POST', '/api/prices', { productId: p.id, amountCents: 145, priceType: 'shelf', storeLabel: 'Mercadona', channel: 'store', observedOn: '2026-10-01', visibility: 'shared_trips' });
    expect(Object.keys((await api(x.token, 'GET', `/api/products/${p.id}/prices`)).json.series)).toEqual([]);
  });

  it('CSV: previsualiza con errores por fila y la reimportación no duplica', async () => {
    const a = await signup();
    const p = (await api(a.token, 'POST', '/api/products', { name: 'Yogur natural', format: '6 x 125 g', ean: '8480000123456' })).json.product;
    const csv = `ean,amount,price_type,store,postal_code,channel,date\n8480000123456,"1,05",shelf,Mercadona,43007,store,01/10/2026\n0000,xx,shelf,M,43007,store,2026-10-01\n`;
    const prev = (await api(a.token, 'POST', '/api/prices/import/preview', { csv })).json;
    expect(prev.valid).toBe(1);
    expect(prev.rows[1].errors.length).toBeGreaterThan(0);
    expect((await api(a.token, 'POST', '/api/prices/import/confirm', { csv })).json).toMatchObject({ created: 1, skippedInvalid: 1 });
    expect((await api(a.token, 'POST', '/api/prices/import/confirm', { csv })).json).toMatchObject({ created: 0, duplicates: 1 });
    expect(p.netQty).toBe(750);
  });

  it('lista editable con versión y estimación honesta (artículos sin precio quedan pendientes)', async () => {
    const { trip, users: [a, b] } = await tripWith(2);
    const it1 = (await api(a.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche', qty: 2, assigneeId: b.id })).json;
    expect((await api(b.token, 'PATCH', `/api/trips/${trip.id}/shopping/items/${it1.id}`, { bought: true, version: 1 })).status).toBe(200);
    expect((await api(a.token, 'PATCH', `/api/trips/${trip.id}/shopping/items/${it1.id}`, { qty: 3, version: 1 })).json.error.code).toBe('version_conflict');
    const list = (await api(a.token, 'GET', `/api/trips/${trip.id}/shopping`)).json;
    expect(list.estimate).toMatchObject({ items: 1, priced: 0, unpriced: 1, complete: false });
    const budget = (await api(a.token, 'GET', `/api/trips/${trip.id}/budget`)).json;
    expect(budget.result.pending).toContain('Compra');
  });

  it('el conector directo de Mercadona está deshabilitado', async () => {
    expect(mercadonaDirect.enabled).toBe(false);
    expect(enabledProviders()).toEqual([]);
    await expect(mercadonaDirect.fetchPrices(['1'], '43007')).rejects.toThrow(/deshabilitado/);
  });
});

describe('Open Prices (respuestas simuladas; sin llamadas reales)', () => {
  const fake = (body: unknown, calls: string[]) => (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  it('sin cobertura: informa «empty» y no inventa precios', async () => {
    const calls: string[] = [];
    const r = await fetchOpenPrices(env.DB, '8480000999999', fake({ items: [], total: 0 }, calls));
    expect(r).toMatchObject({ status: 'empty', items: [] });
    expect(calls[0]).toMatch(/^https:\/\/prices\.openfoodfacts\.org\/api\/v1\/prices\?product_code=8480000999999/);
  });

  it('normaliza precios EUR, conserva tienda y fecha, y cachea', async () => {
    const calls: string[] = [];
    const body = {
      items: [{ id: 1, price: 1.1, currency: 'EUR', date: '2026-04-06', location: { osm_name: 'HiperDino', osm_address_city: 'Los Cristianos', osm_address_postcode: '38650', osm_address_country: 'España' }, proof: { type: 'PRICE_TAG' } },
              { id: 2, price: 2, currency: 'USD', date: '2026-04-06' }],
      total: 2,
    };
    const r = await fetchOpenPrices(env.DB, '5449000000996', fake(body, calls));
    expect(r.items).toEqual([expect.objectContaining({ amountCents: 110, store: 'HiperDino', postalCode: '38650', date: '2026-04-06' })]);
    const cached = await fetchOpenPrices(env.DB, '5449000000996', fake(body, calls));
    expect(cached.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('un fallo de red conserva el resultado anterior con su fecha', async () => {
    const calls: string[] = [];
    await fetchOpenPrices(env.DB, '1234567890123', fake({ items: [{ id: 9, price: 3, currency: 'EUR', date: '2026-01-01' }] }, calls), Date.now() - 8 * 86400_000);
    const failing = (async () => { throw new Error('red'); }) as unknown as typeof fetch;
    const r = await fetchOpenPrices(env.DB, '1234567890123', failing);
    expect(r).toMatchObject({ status: 'ok', cached: true, refreshFailed: true });
    expect(r.items[0].amountCents).toBe(300);
  });
});
