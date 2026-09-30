// Reproducciones de la revisión independiente del 30/09/2026: cada test falla con el código anterior.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, signup } from './helpers';
import { parseGrandvalira } from '../../src/core/parsers/official-snow';
import { dedupeCards, parseOfferCardsHtml } from '../../src/core/parsers/offers';
import { cardToOffer } from '../../tools/collectors/offer-payload';
import grandvaliraReal from '../fixtures/real/grandvalira-estado-pistas.2026-09-30.txt?raw';

const INGEST = 'test-ingest-token';
const ingest = async (path: string, body: unknown) => {
  const r = await SELF.fetch(`http://localhost/api/ingest/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${INGEST}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json<any>() };
};
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, pipeline: 'offers', startedAt: Date.now() - 1000, finishedAt: Date.now(), expected: 1, ok: 1, failed: 0, unsupported: 0, ...over });

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country) VALUES ('rv-cerler','Cerler (test)','resort','ES'), ('rv-formigal','Formigal (test)','resort','ES')`),
    env.DB.prepare(`INSERT OR IGNORE INTO providers (id, name, enabled) VALUES ('esquiades','Esquiades',0), ('estiber','Estiber',0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter) VALUES
      ('rv-off-cer','rv-cerler','rv-cerler','offers','estiber','https://example.invalid/c','playwright','[]','unverified','estiber-cards'),
      ('rv-off-for','rv-formigal','rv-formigal','offers','estiber','https://example.invalid/f','playwright','[]','unverified','estiber-cards')`),
  ]);
});

describe('2 · presupuesto con condiciones exactas (API)', () => {
  it('10–12 dic, 2 personas, 100 €/persona: cambiar a febrero o a 4 personas deja el alojamiento pendiente', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Dic', startDate: '2026-12-10', endDate: '2026-12-12', participantsPlanned: 2, skiDays: 2, areaId: 'rv-cerler' })).json.trip;
    const cand = (await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel', modality: 'lodging', forfaitIncluded: 'no', areaId: 'rv-cerler', amountCents: 10000,
      unit: 'per_person', priceKind: 'user_quote', checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, childrenAges: [] })).json;
    const b0 = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json;
    await api(o.token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, chosenCandidateId: cand.id });
    const lodging = async () => (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json.result.components.find((c: any) => c.key === 'lodging');
    expect(await lodging()).toMatchObject({ status: 'known', totalCents: 20000 });

    let t = (await api(o.token, 'GET', `/api/trips/${trip.id}`)).json.trip;
    t = (await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { startDate: '2027-02-10', endDate: '2027-02-12', version: t.version })).json.trip;
    expect(await lodging()).toMatchObject({ status: 'pending', totalCents: null, referenceCents: 10000 });

    t = (await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { startDate: '2026-12-10', endDate: '2026-12-12', version: t.version })).json.trip;
    expect((await lodging()).status).toBe('known');
    t = (await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { participantsPlanned: 4, version: t.version })).json.trip;
    const l = await lodging();
    expect(l).toMatchObject({ status: 'pending', totalCents: null });
    expect(l.comparison.issues.join(' ')).toMatch(/2 adulto/);
  });

  it('noches incoherentes con las fechas se rechazan con un mensaje claro; cambiar fechas recalcula noches', async () => {
    const o = await signup();
    const bad = await api(o.token, 'POST', '/api/trips', { name: 'X', startDate: '2026-12-10', endDate: '2026-12-12', nights: 5 });
    expect(bad.status).toBe(422);
    expect(bad.json.error.message).toMatch(/son 2/);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Y', startDate: '2026-12-10', endDate: '2026-12-12' })).json.trip;
    const p = await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { endDate: '2026-12-15', version: trip.version });
    expect(p.json.trip.nights).toBe(5);
  });

  it('otro destino o menores con otras edades: incompatible; sin datos de ocupación: incompleto', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Z', startDate: '2026-12-10', endDate: '2026-12-12', participantsPlanned: 3, childrenAges: [8], areaId: 'rv-cerler' })).json.trip;
    const mk = async (over: Record<string, unknown>) => {
      const cand = (await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'C', modality: 'lodging', forfaitIncluded: 'no', areaId: 'rv-cerler', amountCents: 30000,
        unit: 'per_stay', priceKind: 'user_quote', checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, childrenAges: [8], ...over })).json;
      const b = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json;
      await api(o.token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b.params.version, chosenCandidateId: cand.id });
      return (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json.result.components.find((c: any) => c.key === 'lodging');
    };
    expect((await mk({})).status).toBe('known');
    expect((await mk({ areaId: 'rv-formigal' })).comparison.status).toBe('incompatible');
    expect((await mk({ childrenAges: [14] })).comparison.status).toBe('incompatible');
    const inc = await mk({ adults: null, childrenAges: null });
    expect(inc).toMatchObject({ status: 'pending' });
    expect(inc.comparison.status).toBe('incomplete');
  });
});

describe('4 · identidad de ofertas por escenario, ámbito y condiciones', () => {
  const d = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + 42 * 86400_000).toISOString().slice(0, 10);

  async function twoScenarios() {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Esc', startDate: d, endDate: d2 })).json.trip;
    const base = { providerId: 'esquiades', areaId: 'rv-cerler', modality: 'lodging', checkIn: d, checkOut: d2, adults: 2 };
    const s1 = (await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { ...base, childrenAges: [3], rooms: 1 })).json.scenarioId;
    const s2 = (await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { ...base, childrenAges: [12], rooms: 2 })).json.scenarioId;
    return { o, trip, s1, s2 };
  }
  const card = (amount: number, over: Record<string, unknown> = {}) => ({ providerOfferId: 'H1', hotelName: 'Hotel Uno', unit: 'per_stay', priceKind: 'quoted_for_search', amountCents: amount,
    availability: 'available', extractor: 't@1', ...over });

  it('dos escenarios con el mismo hotel, hora e importe guardan una cotización cada uno', async () => {
    const { o, trip, s1, s2 } = await twoScenarios();
    const t = Date.now() - 3_600_000;
    const r = await ingest('offers', { run: run(`rv-2sc-${s1}`, { expected: 2, ok: 2 }), observedAt: t,
      results: [{ scenarioId: s1, outcome: 'results', offers: [card(50000)] }, { scenarioId: s2, outcome: 'results', offers: [card(50000)] }] });
    expect(r.json.written).toBe(2);
    const view = (await api(o.token, 'GET', `/api/trips/${trip.id}/scenarios`)).json.scenarios;
    expect(view.map((s: any) => s.offers.length)).toEqual([1, 1]);
    // Precios distintos después: cada serie solo compara consigo misma.
    await ingest('offers', { run: run(`rv-2sc-b-${s1}`, { expected: 2, ok: 2 }), observedAt: t + 1000,
      results: [{ scenarioId: s1, outcome: 'results', offers: [card(52000)] }, { scenarioId: s2, outcome: 'results', offers: [card(40000)] }] });
    const v2 = (await api(o.token, 'GET', `/api/trips/${trip.id}/scenarios`)).json.scenarios;
    const changes = v2.map((s: any) => s.offers[0].panel.change?.cents).sort();
    expect(changes).toEqual([-10000, 2000]);
  });

  it('lo pedido no prueba lo que dice la tarjeta: sin fechas/ocupación declaradas, el precio queda orientativo con aviso', async () => {
    const { s1 } = await twoScenarios();
    await ingest('offers', { run: run(`rv-unv-${s1}`), observedAt: Date.now() - 3_500_000, results: [{ scenarioId: s1, outcome: 'results', offers: [card(50000)] }] });
    const ob = await env.DB.prepare(`SELECT ob.price_kind, ob.warnings, o.conditions_verified, o.children_ages, o.rooms FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id
      WHERE ob.scenario_id = ?1`).bind(s1).first<any>();
    expect(ob).toMatchObject({ price_kind: 'advertised_from', conditions_verified: 0, children_ages: null, rooms: null });
    expect(ob.warnings).toMatch(/edades de menores/);
    // Con fechas, adultos, menores, habitaciones y «sin forfait» declarados: cotización verificada.
    await ingest('offers', { run: run(`rv-ver-${s1}`), observedAt: Date.now() - 3_400_000, results: [{ scenarioId: s1, outcome: 'results',
      offers: [card(50000, { checkIn: d, checkOut: d2, adults: 2, childrenAges: [3], rooms: 1, forfaitIncluded: 'no' })] }] });
    const v = await env.DB.prepare(`SELECT ob.price_kind FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id WHERE ob.scenario_id = ?1 AND o.conditions_verified = 1`).bind(s1).first<any>();
    expect(v.price_kind).toBe('quoted_for_search');
  });

  it('mismo ID de proveedor en áreas distintas y cancelación distinta son ofertas distintas', async () => {
    const t = Date.now() - 3_000_000;
    const cat = (sourceId: string, over: Record<string, unknown> = {}) => ({ sourceId, outcome: 'results', offers: [card(30000, { priceKind: 'advertised_from', ...over })] });
    const r = await ingest('offers', { run: run('rv-areas', { expected: 2, ok: 2 }), observedAt: t,
      catalog: [cat('rv-off-cer'), cat('rv-off-for'), cat('rv-off-cer', { cancellation: 'free' })], results: [] });
    expect(r.json.written).toBe(3);
    const n = await env.DB.prepare(`SELECT COUNT(DISTINCT id) AS n FROM offers WHERE provider_offer_id = 'H1' AND context = 'catalog'`).first<any>();
    expect(n.n).toBe(3);
  });

  it('una página de catálogo sin «desde» sigue siendo orientativa; null de forfait es «desconocido»', async () => {
    const r = await ingest('offers', { run: run('rv-cat-kind'), observedAt: Date.now() - 2_000_000, results: [],
      catalog: [{ sourceId: 'rv-off-cer', outcome: 'results', offers: [card(20000, { providerOfferId: 'H9', unit: 'per_person' })] }] });
    expect(r.json.written).toBe(1);
    const row = await env.DB.prepare(`SELECT ob.price_kind, ob.warnings, o.forfait_included FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id WHERE o.provider_offer_id = 'H9'`).first<any>();
    expect(row).toMatchObject({ price_kind: 'advertised_from', forfait_included: 'unknown' });
    expect(row.warnings).toMatch(/orientativo/);
  });
});

describe('3 · atomicidad de gastos y tickets', () => {
  async function tripOf2() {
    const a = await signup(); const b = await signup();
    const trip = (await api(a.token, 'POST', '/api/trips', { name: 'Gastos' })).json.trip;
    await env.DB.prepare(`INSERT INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?1, ?2, 'member', ?3)`).bind(trip.id, b.id, Date.now()).run();
    return { a, b, trip };
  }
  const fail = (name: string, table: string, when: string) => env.DB.prepare(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END`).run();
  const drop = (name: string) => env.DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();

  it('un fallo a mitad de la edición no deja cambios: cabecera, reparto e historial van juntos', async () => {
    const { a, b, trip } = await tripOf2();
    const e = (await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Cena', spentOn: '2026-12-10', payerId: a.id, amountCents: 1000, split: { mode: 'equal', participants: [a.id, b.id] } })).json;
    await fail('t_hist_fail', 'expense_history', `NEW.after_json LIKE '%"concept":"FALLA"%'`);
    try {
      const r = await api(a.token, 'PUT', `/api/trips/${trip.id}/expenses/${e.id}`, { concept: 'FALLA', spentOn: '2026-12-10', payerId: a.id, amountCents: 2000, version: 1,
        split: { mode: 'equal', participants: [a.id, b.id] } });
      expect(r.status).toBe(500);
    } finally { await drop('t_hist_fail'); }
    const s = (await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json;
    expect(s.expenses[0]).toMatchObject({ concept: 'Cena', amountCents: 1000, version: 1 });
    expect(Object.values(s.expenses[0].shares).reduce((x: number, y: any) => x + y, 0)).toBe(1000);
    expect(s.balanceCheckCents).toBe(0);
  });

  it('dos ediciones simultáneas con la misma versión: una gana, la otra recibe 409 y el reparto cuadra', async () => {
    const { a, b, trip } = await tripOf2();
    const e = (await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Súper', spentOn: '2026-12-10', payerId: a.id, amountCents: 1000, split: { mode: 'equal', participants: [a.id, b.id] } })).json;
    const put = (amount: number, who: typeof a) => api(who.token, 'PUT', `/api/trips/${trip.id}/expenses/${e.id}`, { concept: `Súper ${amount}`, spentOn: '2026-12-10', payerId: a.id, amountCents: amount, version: 1,
      split: { mode: 'custom', shares: [{ userId: a.id, shareCents: amount - 100 }, { userId: b.id, shareCents: 100 }] } });
    const [r1, r2] = await Promise.all([put(3000, a), put(5000, a)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const s = (await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json;
    const x = s.expenses[0];
    expect(Object.values(x.shares).reduce((p: number, q: any) => p + q, 0)).toBe(x.amountCents);
    expect(x.version).toBe(2);
    expect(s.balanceCheckCents).toBe(0);
  });

  const TICKET = '30/09/2026 12:00\nDescripción\n1 LECHE 1,00\nTOTAL 1,00';
  const meta = { text: TICKET, storeLabel: 'Mercadona Tarragona', channel: 'store', postalCode: '43007' };

  it('producto inexistente: 422 sin guardar nada; el reintento corregido se importa', async () => {
    const { a } = await tripOf2();
    const bad = await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, mapping: [{ lineNo: 3, productId: 'does-not-exist' }] });
    expect(bad.status).toBe(422);
    const ok = await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, mapping: [] });
    expect(ok.status).toBe(201);
    const dup = await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, mapping: [] });
    expect(dup.json).toMatchObject({ receiptId: ok.json.receiptId, alreadyImported: true });
  });

  it('un fallo al guardar las líneas no deja cabecera ni hash que bloquee el reintento', async () => {
    const { a } = await tripOf2();
    const text = TICKET.replace('LECHE', 'PAN');
    await fail('t_line_fail', 'receipt_lines', `NEW.raw_text LIKE '%PAN%'`);
    try {
      expect((await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, text, mapping: [] })).status).toBe(500);
    } finally { await drop('t_line_fail'); }
    expect((await api(a.token, 'GET', '/api/receipts')).json.receipts.filter((r: any) => r.total_cents === 100 && r.lines === 0)).toHaveLength(0);
    expect((await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, text, mapping: [] })).status).toBe(201);
  });

  it('si falla la vinculación del gasto, el ticket queda recuperable y se completa sin reimportar', async () => {
    const { a, b, trip } = await tripOf2();
    const text = TICKET.replace('LECHE', 'HUEVOS');
    const conf = (await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, text, tripId: trip.id, mapping: [] })).json;
    await fail('t_link_fail', 'expense_history', `NEW.after_json LIKE '%${conf.receiptId}%'`);
    try {
      expect((await api(a.token, 'POST', `/api/receipts/${conf.receiptId}/expense`, { tripId: trip.id, participants: [a.id, b.id] })).status).toBe(500);
    } finally { await drop('t_link_fail'); }
    const pending = (await api(a.token, 'GET', '/api/receipts')).json.receipts.find((r: any) => r.id === conf.receiptId);
    expect(pending.expense_id).toBeNull();
    expect((await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json.expenses).toHaveLength(0);
    const again = await api(a.token, 'POST', '/api/receipts/confirm', { ...meta, text, tripId: trip.id, mapping: [] });
    expect(again.json).toMatchObject({ receiptId: conf.receiptId, alreadyImported: true, expenseId: null });
    const link = await api(a.token, 'POST', `/api/receipts/${conf.receiptId}/expense`, { tripId: trip.id, participants: [a.id, b.id] });
    expect(link.status).toBe(201);
    expect((await api(a.token, 'GET', `/api/trips/${trip.id}/expenses`)).json.expenses).toHaveLength(1);
  });
});

describe('7 · capacidades de búsqueda publicadas antes de crear', () => {
  it('la API publica por proveedor y modalidad qué existe; crear un escenario sin adaptador lo dice sin culpar al proveedor', async () => {
    const caps = await SELF.fetch('http://localhost/api/public/capabilities').then((r) => r.json<any>());
    const esq = caps.capabilities.find((c: any) => c.provider === 'esquiades' && c.modality === 'lodging');
    expect(esq).toMatchObject({ dateSearch: 'not_implemented', manualQuote: 'available' });
    expect(caps.capabilities.every((c: any) => c.dateSearch !== 'implemented_verified')).toBe(true);
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Caps', startDate: '2027-01-15', endDate: '2027-01-17', participantsPlanned: 2, skiDays: 2, areaId: 'rv-cerler' })).json.trip;
    const sc = await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { providerId: 'estiber', areaId: 'rv-cerler', modality: 'lodging', checkIn: '2027-01-15', checkOut: '2027-01-17', adults: 2 });
    expect(sc.status).toBe(201);
    expect(sc.json.dateSearch).toBe('not_implemented');
    expect(sc.json.note).toMatch(/no está implementada/);
    expect(sc.json.note).not.toMatch(/proveedor no/i);
  });
});

describe('6 · compra, cesta fija y evolución', () => {
  const price = (tok: string, productId: string, amountCents: number, observedOn: string, over: Record<string, unknown> = {}) =>
    api(tok, 'POST', '/api/prices', { productId, amountCents, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn, visibility: 'shared_trips', ...over });
  const setup = async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Compra', startDate: '2027-01-15', endDate: '2027-01-17', participantsPlanned: 2, skiDays: 2 })).json.trip;
    const leche = (await api(o.token, 'POST', '/api/products', { name: 'Leche entera Hacendado', format: '1 L' })).json.product;
    const pan = (await api(o.token, 'POST', '/api/products', { name: 'Pan de molde Hacendado', format: '460 g' })).json.product;
    return { o, trip, leche, pan };
  };

  it('producto repetido en dos filas (1 + 2): la cesta cubre el 100 % y suma 3 envases; la estimación también', async () => {
    const { o, trip, leche } = await setup();
    await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche', productId: leche.id, qty: 1 });
    await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche (otra fila)', productId: leche.id, qty: 2 });
    await price(o.token, leche.id, 95, '2026-10-01');
    const b = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/basket`)).json;
    expect(b.points[0]).toMatchObject({ coverage: 1, totalCents: 285 });
    expect(b.products).toHaveLength(1);
    const est = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping`)).json.estimate;
    expect(est).toMatchObject({ knownCents: 285, complete: true });
  });

  it('otra tienda, otro canal u otro tipo de precio no se mezclan; el criterio es explícito y cambiable', async () => {
    const { o, trip, leche } = await setup();
    await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche', productId: leche.id, qty: 1 });
    await price(o.token, leche.id, 95, '2026-10-01');
    await price(o.token, leche.id, 80, '2026-10-02', { storeLabel: 'Mercadona Rambla', channel: 'store', postalCode: '43003' });
    await price(o.token, leche.id, 70, '2026-10-03', { priceType: 'promo', promoNote: '3x2' });
    const b = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/basket`)).json;
    expect(b.criterion).toMatchObject({ storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', priceType: 'shelf', origin: 'list' });
    expect(b.points.map((p: any) => p.date)).toEqual(['2026-10-01']);
    expect(b.availableSeries.length).toBe(3);
    const store = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/basket?store=Mercadona%20Rambla&postalCode=43003&channel=store`)).json;
    expect(store.criterion.origin).toBe('query');
    expect(store.points.map((p: any) => p.totalCents)).toEqual([80]);
    // La estimación usa la tienda de la lista (43007 online), no el precio más bajo de otra tienda.
    expect((await api(o.token, 'GET', `/api/trips/${trip.id}/shopping`)).json.estimate.knownCents).toBe(95);
    const put = await api(o.token, 'PUT', `/api/trips/${trip.id}/shopping/list`, { storeLabel: 'Mercadona Rambla', postalCode: '43003', channel: 'store' });
    expect(put.status).toBe(200);
    expect((await api(o.token, 'GET', `/api/trips/${trip.id}/shopping`)).json.estimate.knownCents).toBe(80);
  });

  it('cobertura parcial sin total; diferencia en € y % contra el anterior comparable; historial por producto', async () => {
    const { o, trip, leche, pan } = await setup();
    await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Leche', productId: leche.id, qty: 2 });
    await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: 'Pan', productId: pan.id, qty: 1 });
    await price(o.token, leche.id, 100, '2026-10-01'); await price(o.token, pan.id, 150, '2026-10-01');
    await price(o.token, leche.id, 110, '2026-10-08');
    await price(o.token, leche.id, 105, '2026-10-15'); await price(o.token, pan.id, 160, '2026-10-15');
    const b = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/basket`)).json;
    expect(b.points.map((p: any) => [p.date, p.coverage, p.totalCents, p.diffCents, p.diffPct])).toEqual([
      ['2026-10-01', 1, 350, null, null], ['2026-10-08', 0.5, null, null, null], ['2026-10-15', 1, 370, 20, 5.7]]);
    const hl = b.products.find((p: any) => p.productId === leche.id);
    expect(hl.name).toBe('Leche entera Hacendado');
    expect(hl.points.map((p: any) => p.diffCents)).toEqual([null, 10, -5]);
  });

  it('CSV de 500 filas se previsualiza y confirma dentro del presupuesto de consultas', async () => {
    const o = await signup();
    const p = (await api(o.token, 'POST', '/api/products', { name: 'Agua mineral', format: '1,5 L', ean: '8480000999999' })).json.product;
    const lines = Array.from({ length: 500 }, (_, i) => `${i % 2 ? p.id : ''},${i % 2 ? '' : '8480000999999'},"0,${String(20 + (i % 70)).padStart(2, '0')}",shelf,Mercadona,43007,store,${new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10)}`);
    const csv = `product_id,ean,amount,price_type,store,postal_code,channel,date\n${lines.join('\n')}\n`;
    const prev = await api(o.token, 'POST', '/api/prices/import/preview', { csv });
    expect(prev.status).toBe(200);
    expect(prev.json.valid).toBe(500);
    expect(prev.d1).toBeLessThanOrEqual(10);
    const conf = await api(o.token, 'POST', '/api/prices/import/confirm', { csv });
    expect(conf.status).toBe(200);
    expect(conf.json).toMatchObject({ created: 500, duplicates: 0 });
    expect(conf.d1).toBeLessThanOrEqual(12);
    expect((await api(o.token, 'POST', '/api/prices/import/confirm', { csv })).json).toMatchObject({ created: 0, duplicates: 500 });
  });
});

describe('8 · Comparar: nieve fiable y coste completo', () => {
  it('dos fuentes a la misma hora: siempre gana la preferente; un dato antiguo o dudoso se muestra con fecha pero no puntúa', async () => {
    const t = Date.now() - 3600_000;
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country) VALUES ('rv-snowa','Nieve A (test)','resort','ES'), ('rv-snowb','Nieve B (test)','resort','ES'), ('rv-snowc','Nieve C (test)','resort','ES')`),
      env.DB.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter, priority) VALUES
        ('rv-sn-agg','rv-snowa','rv-snowa','snow','esquiades','https://example.invalid/a','playwright','[]','unverified','esquiades-status', 50),
        ('rv-sn-off','rv-snowa','rv-snowa','snow','oficial','https://example.invalid/o','playwright','[]','unverified','x', 10),
        ('rv-sn-b','rv-snowb','rv-snowb','snow','esquiades','https://example.invalid/b','playwright','[]','unverified','esquiades-status', 50),
        ('rv-sn-c','rv-snowc','rv-snowc','snow','esquiades','https://example.invalid/c','playwright','[]','unverified','esquiades-status', 50)`),
      env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, op_status, open_km, total_km, quality, content_hash, extractor) VALUES
        ('rv-o1','rv-snowa','rv-sn-agg',?1,'open',40,100,'ok','h1','t'), ('rv-o2','rv-snowa','rv-sn-off',?1,'open',45,100,'ok','h2','t'),
        ('rv-o3','rv-snowb','rv-sn-b',?2,'open',80,100,'ok','h3','t'), ('rv-o4','rv-snowc','rv-sn-c',?1,'open',90,100,'total_mismatch','h4','t')`).bind(t, t - 72 * 3600_000),
    ]);
    const cat = await SELF.fetch('http://localhost/api/public/catalog').then((r) => r.json<any>());
    const a = cat.areas.find((x: any) => x.id === 'rv-snowa'), b = cat.areas.find((x: any) => x.id === 'rv-snowb'), c = cat.areas.find((x: any) => x.id === 'rv-snowc');
    expect(a.snow).toMatchObject({ sourceId: 'rv-sn-off', openKm: 45, rank: { openKm: 45, excluded: null } });
    expect(b.snow).toMatchObject({ openKm: 80, freshness: 'stale', rank: { openKm: null, excluded: 'antiguo' } });
    expect(b.snow.observedAt).toBe(t - 72 * 3600_000);
    expect(c.snow.rank).toMatchObject({ openKm: null, excluded: 'dudoso' });
    expect(c.snow.rank.label).toMatch(/dudoso/);
  });

  it('comparación de coste por persona: completos ordenados, incompletos sin posición y con lo que falta; cotización manual válida', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Coste', startDate: '2027-01-15', endDate: '2027-01-17', participantsPlanned: 2, skiDays: 2, cars: 0, areaId: 'rv-cerler' })).json.trip;
    const cond = { checkIn: '2027-01-15', checkOut: '2027-01-17', adults: 2, childrenAges: [], forfaitIncluded: 'yes', forfaitDays: 2 };
    await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Paquete caro', modality: 'lodging_forfait', areaId: 'rv-cerler', amountCents: 40000, unit: 'per_person', priceKind: 'user_quote', ...cond });
    await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Paquete barato', modality: 'lodging_forfait', areaId: 'rv-cerler', amountCents: 30000, unit: 'per_person', priceKind: 'user_quote', ...cond });
    await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Solo hotel', modality: 'lodging', areaId: 'rv-cerler', amountCents: 5000, unit: 'per_person', priceKind: 'user_quote', ...cond, forfaitIncluded: 'no', forfaitDays: null });
    const b0 = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json;
    await api(o.token, 'PUT', `/api/trips/${trip.id}/budget`, { version: b0.params.version, groceriesCents: 0, renters: 0 });
    const r = await api(o.token, 'GET', `/api/trips/${trip.id}/cost-comparison`);
    expect(r.status).toBe(200);
    expect(r.d1).toBeLessThanOrEqual(15);
    expect(r.json.options.map((x: any) => [x.title, x.rank, x.perPersonCents])).toEqual([['Paquete barato', 1, 30000], ['Paquete caro', 2, 40000], ['Solo hotel', null, null]]);
    expect(r.json.options[2].pending.join(' ')).toMatch(/Forfait/i);
  });
});

describe('9 · recorridos de migración legacy', () => {
  beforeAll(async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('rv-lf','sheets_test','test.csv','rv-sha',0,0,0)`),
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_id_map (legacy_kind, legacy_id, new_kind, new_id) VALUES ('resort','cerler-old','area','rv-cerler')`),
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) VALUES
        ('rv-lc1','rv-lf','rv-lc1','Pepe','cerler-old','Buen après en el pueblo','12/02/2024',0), ('rv-lc2','rv-lf','rv-lc2','Ana','cerler-old','Cola larga el sábado','13/02/2024',0)`),
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name) VALUES
        ('rv-ls1','rv-lf','rv-ls1','Leche','6','5,40 €','Pepe'), ('rv-ls2','rv-lf','rv-ls2','Pan','2 barras',NULL,'Ana')`),
    ]);
  });

  it('un comentario legacy publicado aparece en la página pública con autoría legacy explícita; sin publicar no', async () => {
    const adm = await signup();
    await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id).run();
    expect((await api(adm.token, 'POST', '/api/admin/legacy/comments/rv-lc1/reconcile', { userId: null, publish: true })).status).toBe(200);
    const area = await SELF.fetch('http://localhost/api/public/areas/rv-cerler').then((r) => r.json<any>());
    expect(area.legacyComments).toHaveLength(1);
    expect(area.legacyComments[0]).toMatchObject({ body: 'Buen après en el pueblo', legacyAuthorName: 'Pepe', dateText: '12/02/2024', linkedAlias: null });
    expect(area.legacyCommentsNote).toMatch(/texto libre/);
  });

  it('compra legacy: previsualizar, elegir viaje y productos exactos, conservar procedencia y no duplicar al repetir', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Legacy compra', startDate: '2027-02-01', endDate: '2027-02-03', participantsPlanned: 2, skiDays: 2 })).json.trip;
    const prod = (await api(o.token, 'POST', '/api/products', { name: 'Leche entera', format: '1 L' })).json.product;
    const prev = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/legacy`)).json;
    expect(prev.items.map((i: any) => i.name)).toEqual(expect.arrayContaining(['Leche', 'Pan']));
    expect(JSON.stringify(prev)).not.toMatch(/Pepe|Ana/); // los nombres de la hoja no se exponen ni se asocian a cuentas
    const body = { items: [{ legacyId: 'rv-ls1', productId: prod.id, qty: 6 }, { legacyId: 'rv-ls2', productId: null, qty: 2 }] };
    const r1 = await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/legacy-import`, body);
    expect(r1.json).toMatchObject({ created: 2, alreadyImported: 0 });
    const r2 = await api(o.token, 'POST', `/api/trips/${trip.id}/shopping/legacy-import`, body);
    expect(r2.json).toMatchObject({ created: 0, alreadyImported: 2 });
    const list = (await api(o.token, 'GET', `/api/trips/${trip.id}/shopping`)).json.items;
    expect(list).toHaveLength(2);
    expect(list.find((i: any) => i.legacyName === 'Leche')).toMatchObject({ qty: 6, product: { id: prod.id }, legacyItemId: 'rv-ls1' });
    expect((await api(o.token, 'GET', `/api/trips/${trip.id}/shopping/legacy`)).json.items.find((i: any) => i.id === 'rv-ls1').importedHere).toBe(true);
    const stranger = await signup();
    expect((await api(stranger.token, 'GET', `/api/trips/${trip.id}/shopping/legacy`)).status).toBe(404);
  });

  it('disponibilidad legacy: vista con estado actual e incorporación explícita; los días ausentes siguen sin indicar', async () => {
    const u = await signup();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status, reconciled_user_id) VALUES
        ('rv-la1','rv-lf','rv-la1-${Math.random()}','Pepe','2027-03-01','Libre','free',?1), ('rv-la2','rv-lf','rv-la2-${Math.random()}','Pepe','2027-03-02','No','busy',?1),
        ('rv-la3','rv-lf','rv-la3-${Math.random()}','Pepe','2027-03-04','¿?',NULL,?1)`).bind(u.id),
    ]);
    await api(u.token, 'PUT', '/api/availability/me', { set: [{ day: '2027-03-02', status: 'free' }] });
    const v = (await api(u.token, 'GET', '/api/legacy/availability/mine')).json;
    expect(v.days.map((d: any) => [d.day, d.mappedStatus, d.currentStatus])).toEqual([['2027-03-01', 'free', null], ['2027-03-02', 'busy', 'free'], ['2027-03-04', null, null]]);
    // Sin sobrescribir: solo días sin indicar y con estado reconocible.
    const inc = await api(u.token, 'POST', '/api/legacy/availability/mine/incorporate', { days: ['2027-03-01', '2027-03-02', '2027-03-04'], overwrite: false });
    expect(inc.json).toMatchObject({ incorporated: 1, skippedExisting: 1, skippedUnmapped: 1 });
    const cal = (await api(u.token, 'GET', '/api/availability/me?from=2027-03-01&to=2027-03-05')).json.days;
    expect(cal).toEqual({ '2027-03-01': 'free', '2027-03-02': 'free' }); // 03 y 05 siguen sin indicar
    const inc2 = await api(u.token, 'POST', '/api/legacy/availability/mine/incorporate', { days: ['2027-03-02'], overwrite: true });
    expect(inc2.json.incorporated).toBe(1);
    expect((await api(u.token, 'GET', '/api/availability/me?from=2027-03-02&to=2027-03-02')).json.days).toEqual({ '2027-03-02': 'busy' });
    // Días no asignados a esta cuenta no se incorporan.
    expect((await api(u.token, 'POST', '/api/legacy/availability/mine/incorporate', { days: ['2027-04-01'], overwrite: true })).json.incorporated).toBe(0);
  });
});

describe('7 · fuente oficial de nieve (Grandvalira) con texto real', () => {
  it('la salida del adaptador pasa la ingesta; un 0 fuera de temporada queda con estado desconocido y no puntúa', async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country) VALUES ('rv-gv','Grandvalira (test)','resort','AD')`),
      env.DB.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter, priority) VALUES
        ('rv-gv-off','rv-gv','rv-gv','snow','official','https://www.grandvalira.com/es/estacion/estado-pistas','html','[]','unverified','grandvalira-official', 10)`),
    ]);
    const r = parseGrandvalira(grandvaliraReal)!;
    const t = Date.now() - 60_000;
    const res = await SELF.fetch('http://localhost/api/ingest/snow', { method: 'POST', headers: { Authorization: `Bearer ${INGEST}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: { id: 'rv-gv-run', pipeline: 'snow', startedAt: t, finishedAt: t, expected: 1, ok: 1, failed: 0, unsupported: 0 },
        observations: [{ sourceId: 'rv-gv-off', areaId: 'rv-gv', observedAt: t, ...r, extractor: 'grandvalira-official@1.0.0' }], health: [] }) }).then((x) => x.json<any>());
    expect(res).toMatchObject({ accepted: 1, written: 1 });
    const row = await env.DB.prepare('SELECT op_status, open_km, total_km, open_lifts, source_date FROM snow_observations WHERE source_id = ?1').bind('rv-gv-off').first<any>();
    expect(row).toEqual({ op_status: 'unknown', open_km: 0, total_km: 215, open_lifts: 4, source_date: '2026-09-23' });
    const cat = await SELF.fetch('http://localhost/api/public/catalog').then((x) => x.json<any>());
    // El extracto real es un parte del 23/09/2026: además de estado desconocido, es un parte antiguo (revisión final 3).
    expect(cat.areas.find((a: any) => a.id === 'rv-gv').snow.rank).toMatchObject({ openKm: null, excluded: 'parte_antiguo' });
  });
});

describe('revisión final 1–2 · extracción → ingesta → ficha pública', () => {
  const art = (id: string, cond: string, price = '200 €') => `<article data-offer-id="${id}"><h3>Hotel ${id}</h3><p>${cond}</p><span class="price">${price} por persona</span></article>`;
  it('dos fechas con la misma duración llegan como dos ofertas; forfait sí/no/desconocido/contradictorio se conserva con avisos', async () => {
    const html = art('f1', 'del 10/12/2026 al 12/12/2026, 2 adultos, sin menores, 1 habitación, 2 noches, sin forfait')
      + art('f1', 'del 10/02/2027 al 12/02/2027, 2 adultos, sin menores, 1 habitación, 2 noches, sin forfait')
      + art('f2', '2 noches, forfait 2 días incluido, 2 adultos')
      + art('f3', '2 noches, 2 adultos')
      + art('f4', '2 noches, forfait 1 día, solo alojamiento, 2 adultos');
    const offers = dedupeCards(parseOfferCardsHtml(html, 'estiber')).map((c) => cardToOffer(c, 'estiber-cards@1'));
    expect(offers).toHaveLength(5);
    const t = Date.now() - 60_000;
    const r = await ingest('offers', { run: run('rv-final-offers', { expected: 1, ok: 1 }), observedAt: t, results: [], catalog: [{ sourceId: 'rv-off-cer', outcome: 'results', offers }] });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ accepted: 5, written: 5 });
    const area = await SELF.fetch('http://localhost/api/public/areas/rv-cerler').then((x) => x.json<any>());
    const mine = area.offers.items.filter((o: any) => /^Hotel f[1-4]$/.test(o.hotel_name_raw));
    expect(mine).toHaveLength(5);
    const by = (h: string) => mine.filter((o: any) => o.hotel_name_raw === h);
    expect(by('Hotel f1').map((o: any) => o.check_in).sort()).toEqual(['2026-12-10', '2027-02-10']);
    expect(by('Hotel f1')[0].forfaitIncluded).toBe('no');
    expect(by('Hotel f2')[0].forfaitIncluded).toBe('yes');
    expect(by('Hotel f3')[0]).toMatchObject({ forfaitIncluded: 'unknown' });
    expect(by('Hotel f4')[0].forfaitIncluded).toBe('unknown');
    expect(by('Hotel f4')[0].warnings.join(' ')).toMatch(/forfait/i);
    expect(by('Hotel f3')[0].warnings.join(' ')).toMatch(/orientativo/i);
  });
});

describe('revisión final 3 · parte antiguo re-descargado hoy', () => {
  it('no puntúa ni desplaza a una fuente con parte reciente; se ven las dos fechas', async () => {
    const t = Date.now() - 600_000;
    const day = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country) VALUES ('rv-sd1','Parte 1 (test)','resort','ES'), ('rv-sd2','Parte 2 (test)','resort','ES')`),
      env.DB.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter, priority) VALUES
        ('rv-sd1-off','rv-sd1','rv-sd1','snow','official','https://example.invalid/1','html','[]','unverified','x', 10),
        ('rv-sd2-off','rv-sd2','rv-sd2','snow','official','https://example.invalid/2','html','[]','unverified','x', 10),
        ('rv-sd2-agg','rv-sd2','rv-sd2','snow','esquiades','https://example.invalid/3','html','[]','unverified','x', 50)`),
      env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, source_date, op_status, open_km, total_km, quality, content_hash, extractor) VALUES
        ('rv-sd-a','rv-sd1','rv-sd1-off',?1,?2,'partial',80,100,'ok','sd1','t'),
        ('rv-sd-b','rv-sd2','rv-sd2-off',?1,?2,'partial',80,100,'ok','sd2','t'),
        ('rv-sd-c','rv-sd2','rv-sd2-agg',?1,?3,'partial',60,100,'ok','sd3','t')`).bind(t, day(7), day(0)),
    ]);
    const cat = await SELF.fetch('http://localhost/api/public/catalog').then((x) => x.json<any>());
    const a = cat.areas.find((x: any) => x.id === 'rv-sd1').snow, b = cat.areas.find((x: any) => x.id === 'rv-sd2').snow;
    expect(a).toMatchObject({ openKm: 80, sourceDate: day(7), observedAt: t, freshness: 'stale', captureFreshness: 'fresh', rank: { openKm: null, excluded: 'parte_antiguo' } });
    expect(b).toMatchObject({ sourceId: 'rv-sd2-agg', openKm: 60, rank: { openKm: 60, excluded: null } });
  });
});
