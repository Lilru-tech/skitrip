// Reproducciones de la revisión independiente del 30/09/2026: cada test falla con el código anterior.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, signup } from './helpers';

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
