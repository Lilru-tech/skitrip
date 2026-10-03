/// <reference types="vite/client" />
// Auditoría de consultas D1, parte 2: TODAS las rutas que no mide quota-audit.test.ts, con volúmenes realistas.
// Cada petición cuenta todas sus sentencias (autenticación, límites de uso, lecturas, escrituras y cada sentencia de
// un batch). El Worker corta a 40 (503 query_budget); D1 Free admite 50. Al final se comprueba que ambas auditorías
// juntas cubren todas las rutas definidas en src/worker (mismo cálculo que tools/check-audit-coverage.ts).
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import TICKET from '../fixtures/parsers/mercadona-ticket.txt?raw';
import indexSrc from '../../src/worker/index.ts?raw';
import auditSrc from './quota-audit.test.ts?raw';
import auditAllSrc from './quota-audit-all.test.ts?raw';
import { coverage, definedRoutes, measuredLabels } from '../../tools/audit-coverage';
import { api, befriend, emulatorToken, seedCatalog, signup } from './helpers';

const routeSrc = import.meta.glob('../../src/worker/routes/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

type R = { status: number; json: any; d1: number };
const measured = new Map<string, { max: number; volume: string; status: number }>();
/** Mide una petición. Un 503 query_budget se registra como 41 (el contador no incluye la sentencia rechazada). */
async function m(label: string, volume: string, p: Promise<R>, ok: number[] = [200, 201]) {
  const r = await p;
  const overBudget = r.status === 503 && r.json?.error?.code === 'query_budget';
  const n = overBudget ? 41 : r.d1;
  const prev = measured.get(label);
  if (!prev || n > prev.max) measured.set(label, { max: n, volume, status: r.status });
  if (!overBudget && !ok.includes(r.status)) throw new Error(`${label} → ${r.status} ${JSON.stringify(r.json)}`);
  return r;
}

const INGEST = 'test-ingest-token';
const MEMBERS = 8, EXPENSES = 40, ITEMS = 150, PRODUCTS = 30, CANDIDATES = 20, COMMENTS = 50, PROPOSALS = 6, SEEDED_FRIENDS = 30;
const DAY = 86400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * DAY).toISOString().slice(0, 10);

const cat = catalog as any;
const snowSources = cat.sources.filter((s: any) => s.kind === 'snow');
const offerSources = cat.sources.filter((s: any) => s.kind === 'offers');
const AREA = cat.areas.find((a: any) => a.kind === 'resort').id;

beforeAll(async () => { await seedCatalog(env.DB, cat); });

describe('auditoría de consultas: resto de rutas', () => {
  it('todas las rutas restantes quedan por debajo de 40 sentencias con volúmenes reales', async () => {
    const db = env.DB;
    // ---------- Altas (todas antes de sembrar cuentas directamente: MAX_PROFILES cuenta usuarios) ----------
    const meUid = `uid-audit-me-${Math.random().toString(36).slice(2, 8)}`;
    const meAlias = `auditme${Math.random().toString(36).slice(2, 6)}`;
    await m('POST /me', '—', api(emulatorToken(meUid), 'POST', '/api/me', { alias: meAlias }, { 'CF-Connecting-IP': '10.9.9.9' }));
    const users = [];
    for (let i = 0; i < MEMBERS; i++) users.push(await signup());
    const [o, ...rest] = users;
    const [m1, , , , , m6, m7] = rest;
    const [x, r1, r2, r3, adm, victim, blk, linkUser] = [await signup(), await signup(), await signup(), await signup(), await signup(), await signup(), await signup(), await signup()];
    await db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id).run();

    // Amistades en volumen sembradas directamente (sin pasar por el límite de altas ni de solicitudes).
    const t0 = Date.now();
    await db.batch([
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
        INSERT INTO users (id, firebase_uid, alias, alias_norm, created_at, updated_at) SELECT 'aud-u-' || i, 'aud-fb-' || i, 'usuaud' || i, 'usuaud' || i, ?2, ?2 FROM n`).bind(SEEDED_FRIENDS, t0),
      db.prepare(`INSERT INTO friendships (user_a, user_b, created_at) SELECT MIN(?1, id), MAX(?1, id), ?2 FROM users WHERE id LIKE 'aud-u-%'`).bind(o.id, t0),
    ]);

    // ---------- Viaje principal: 8 miembros ----------
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Auditoría 2', startDate: '2027-01-15', endDate: '2027-01-18', participantsPlanned: MEMBERS, skiDays: 3, cars: 2, areaId: AREA })).json.trip;
    const T = `/api/trips/${trip.id}`;
    for (const u of rest) {
      await befriend(o, u);
      const inv = (await api(o.token, 'POST', `${T}/invitations`, { userId: u.id })).json.invitation;
      expect((await api(u.token, 'POST', `/api/trips/invitations/${inv.id}/accept`)).status).toBe(200);
    }
    for (const u of users) await api(u.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [trip.id] });
    await m('GET /availability/shares', '1 viaje + amigos', api(o.token, 'GET', '/api/availability/shares'));

    // ---------- Perfil y preferencias ----------
    await m('PATCH /me', '—', api(x.token, 'PATCH', '/api/me', { alias: `auditren${Math.random().toString(36).slice(2, 6)}`, homeOriginId: 'tarragona' }));
    await m('GET /me/prefs', '—', api(o.token, 'GET', '/api/me/prefs'));
    await m('PUT /me/prefs', '—', api(o.token, 'PUT', '/api/me/prefs', { prefs: { theme: 'dark', lastTrip: trip.id, filters: { kind: 'resort' } }, version: 1 }));
    await m('GET /health', '—', api(null, 'GET', '/api/health'));
    await m('GET /public/capabilities', '—', api(null, 'GET', '/api/public/capabilities'));

    // ---------- Amistades ----------
    const q1 = await m('POST /friends/requests', '—', api(r1.token, 'POST', '/api/friends/requests', { userId: o.id }));
    await m('POST /friends/requests/:id/reject', '—', api(o.token, 'POST', `/api/friends/requests/${q1.json.requestId}/reject`));
    const q2 = await m('POST /friends/requests', '—', api(o.token, 'POST', '/api/friends/requests', { userId: r2.id }));
    await m('POST /friends/requests/:id/cancel', '—', api(o.token, 'POST', `/api/friends/requests/${q2.json.requestId}/cancel`));
    const q3 = await m('POST /friends/requests', '—', api(r3.token, 'POST', '/api/friends/requests', { userId: o.id }));
    await m('POST /friends/requests/:id/accept', '—', api(o.token, 'POST', `/api/friends/requests/${q3.json.requestId}/accept`));
    const FR = `${MEMBERS - 1 + SEEDED_FRIENDS + 1} amigos`;
    await m('GET /friends/search', `${SEEDED_FRIENDS + 16} cuentas`, api(o.token, 'GET', '/api/friends/search?q=us'));
    await m('DELETE /friends/:userId', FR, api(o.token, 'DELETE', `/api/friends/${r3.id}`));
    await befriend(o, blk);
    await m('POST /friends/blocks', FR, api(o.token, 'POST', '/api/friends/blocks', { userId: blk.id }));
    await m('DELETE /friends/blocks/:userId', '—', api(o.token, 'DELETE', `/api/friends/blocks/${blk.id}`));

    // ---------- Invitaciones ----------
    await befriend(o, x);
    const invs: { trip: string; inv: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const tid = i === 0 ? trip.id : (await api(o.token, 'POST', '/api/trips', { name: `Secundario ${i}`, startDate: '2027-02-01', endDate: '2027-02-03' })).json.trip.id;
      invs.push({ trip: tid, inv: (await api(o.token, 'POST', `/api/trips/${tid}/invitations`, { userId: x.id })).json.invitation.id });
    }
    await m('GET /trips/invitations/mine', '5 pendientes', api(x.token, 'GET', '/api/trips/invitations/mine'));
    await m('POST /trips/invitations/:invId/decline', '—', api(x.token, 'POST', `/api/trips/invitations/${invs[1].inv}/decline`));
    await m('POST /trips/:id/invitations/:invId/revoke', '—', api(o.token, 'POST', `/api/trips/${invs[2].trip}/invitations/${invs[2].inv}/revoke`));
    const link = (await api(o.token, 'POST', `${T}/invitations`, { link: true, maxUses: 5 })).json.invitation;
    await m('POST /trips/invitations/accept-link', `${MEMBERS} miembros`, api(linkUser.token, 'POST', '/api/trips/invitations/accept-link', { token: link.token }));
    const tv = (await api(o.token, 'GET', T)).json.trip;
    await m('PATCH /trips/:id', '—', api(o.token, 'PATCH', T, { name: 'Auditoría 2 (editado)', rooms: 4, childrenAges: [], version: tv.version }));
    await m('PATCH /trips/:id/members/:userId', '—', api(o.token, 'PATCH', `${T}/members/${m1.id}`, { role: 'editor' }));

    // ---------- Propuestas de fechas y votos ----------
    const props = [];
    for (let i = 0; i < PROPOSALS; i++) {
      const start = addDays('2027-01-08', i * 7);
      props.push((await m('POST /availability/trip/:tripId/proposals', `${i} propuestas previas`, api(users[i % MEMBERS].token, 'POST', `/api/availability/trip/${trip.id}/proposals`, { start, end: addDays(start, 3) }))).json.id);
    }
    for (const p of props) for (const u of users) {
      await m('PUT /availability/trip/:tripId/proposals/:pid/vote', `${PROPOSALS} propuestas × ${MEMBERS}`, api(u.token, 'PUT', `/api/availability/trip/${trip.id}/proposals/${p}/vote`, { value: (['yes', 'maybe', 'no'] as const)[(p.length + u.id.length) % 3] }));
    }

    // ---------- Gastos ----------
    const ids = users.map((u) => u.id);
    for (let i = 0; i < EXPENSES; i++) {
      await api(users[i % MEMBERS].token, 'POST', `${T}/expenses`, { concept: `Gasto ${i}`, spentOn: '2027-01-16', payerId: users[i % MEMBERS].id, amountCents: 1000 + i, split: { mode: 'equal', participants: ids } });
    }
    const EX = `${EXPENSES} gastos × ${MEMBERS}`;
    const s1 = await m('POST /trips/:id/settlements', EX, api(o.token, 'POST', `${T}/settlements`, { fromUser: m1.id, toUser: o.id, amountCents: 2500, paidOn: '2027-01-19', note: 'Bizum' }));
    await api(o.token, 'POST', `${T}/settlements`, { fromUser: m1.id, toUser: o.id, amountCents: 1500, paidOn: '2027-01-19' });
    await m('DELETE /trips/:id/settlements/:sid', EX, api(o.token, 'DELETE', `${T}/settlements/${s1.json.id}`));
    const e0 = (await api(o.token, 'GET', `${T}/expenses`)).json.expenses[0];
    await m('DELETE /trips/:id/expenses/:eid', EX, api(o.token, 'DELETE', `${T}/expenses/${e0.id}`));

    // ---------- Compra: productos, lista, sugerencias, sustituciones ----------
    const prods: any[] = [];
    for (let i = 0; i < PRODUCTS; i++) prods.push((await api(o.token, 'POST', '/api/products', { name: i < 10 ? `Leche entera marca ${i}` : `Producto ${i}`, format: '1 L' })).json.product);
    const items: string[] = [];
    for (let i = 0; i < ITEMS; i++) {
      items.push((await api(o.token, 'POST', `${T}/shopping/items`, i === 0 ? { name: 'Leche entera', qty: 2 } : { name: `Art ${i}`, productId: prods[i % PRODUCTS].id, qty: 1 + (i % 3) })).json.id);
    }
    const SH = `lista de ${ITEMS}`;
    await m('PUT /trips/:id/shopping/list', SH, api(o.token, 'PUT', `${T}/shopping/list`, { storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online' }));
    await m('PATCH /trips/:id/shopping/items/:itemId', SH, api(m1.token, 'PATCH', `${T}/shopping/items/${items[1]}`, { bought: true, assigneeId: m1.id, qty: 3, productId: prods[2].id, version: 1 }));
    await m('DELETE /trips/:id/shopping/items/:itemId', SH, api(o.token, 'DELETE', `${T}/shopping/items/${items[2]}`));
    const sug = await m('GET /trips/:id/shopping/suggestions/:itemId', `${PRODUCTS} productos`, api(o.token, 'GET', `${T}/shopping/suggestions/${items[0]}`));
    expect(sug.json.suggestions.length).toBe(10);

    // Cadena de 10 sustituciones de formato: GET /products/:pid/prices la recorre en una sola sentencia recursiva (tope 10).
    let head = (await api(o.token, 'POST', '/api/products', { name: 'Aceite oliva virgen', format: '1 L' })).json.product.id;
    const first = head;
    for (let i = 0; i < 10; i++) head = (await m('POST /products/:pid/replace', '—', api(o.token, 'POST', `/api/products/${head}/replace`, { name: 'Aceite oliva virgen', format: `${i + 2} L` }))).json.id;
    for (let d = 0; d < 5; d++) await api(o.token, 'POST', '/api/prices', { productId: first, amountCents: 800 + d, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: `2026-09-${pad(d + 1)}` });
    const chain = await m('GET /products/:pid/prices (cadena de 10 sustituciones)', '10 sustituciones, 5 precios', api(o.token, 'GET', `/api/products/${first}/prices`));
    // Antes: una consulta por salto y cortada tras el primero. Ahora la cadena completa y en orden.
    expect(chain.json.replacedBy.map((x: any) => x.format)).toEqual(Array.from({ length: 10 }, (_, i) => `${i + 2} L`));

    // Open Prices: con caché (sin salir a la red) y sin EAN.
    const eanProd = (await api(o.token, 'POST', '/api/products', { name: 'Leche con EAN', ean: '8480000123456', format: '1 L' })).json.product;
    await db.prepare(`INSERT OR REPLACE INTO open_prices_cache (ean, fetched_at, status, payload) VALUES (?1, ?2, 'ok', '[]')`).bind('8480000123456', Date.now()).run();
    await m('GET /products/:pid/open-prices', 'caché vigente', api(o.token, 'GET', `/api/products/${eanProd.id}/open-prices`));
    await m('GET /products/:pid/open-prices (sin EAN)', '—', api(o.token, 'GET', `/api/products/${prods[0].id}/open-prices`));

    // ---------- Compra legacy ----------
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('aud-lf','sheets_audit','audit.csv','aud-sha',0,0,0)`),
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200)
        INSERT INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name) SELECT 'aud-ls-' || i, 'aud-lf', 'aud-ls-' || i, 'Artículo legacy ' || i, '2', '1,00 €', 'Pepe' FROM n`),
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
        INSERT INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) SELECT 'aud-lc-' || i, 'aud-lf', 'aud-lc-' || i, 'Pepe', NULL, 'Comentario legacy ' || i, '01/02/2024', 0 FROM n`),
      db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 1199)
        INSERT INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status)
        SELECT 'aud-la-' || i, 'aud-lf', 'aud-la-' || i, 'Persona ' || (i / 150), date('now', '+30 days', '+' || (i % 150) || ' days'), 'x', CASE i % 4 WHEN 0 THEN 'free' WHEN 1 THEN 'busy' WHEN 2 THEN 'maybe' END FROM n`),
    ]);
    await m('GET /trips/:id/shopping/legacy', `200 artículos legacy, ${SH}`, api(o.token, 'GET', `${T}/shopping/legacy`));
    const legacyItems = Array.from({ length: 140 }, (_, i) => ({ legacyId: `aud-ls-${i + 1}`, productId: i % 2 ? prods[i % PRODUCTS].id : null, qty: 1 + (i % 4) }));
    const li = await m('POST /trips/:id/shopping/legacy-import', '140 artículos', api(o.token, 'POST', `${T}/shopping/legacy-import`, { items: legacyItems }));
    expect(li.json.created).toBe(140);

    // ---------- Precios por CSV (500 filas, máximo por fichero) ----------
    const csv = ['product_id,amount,price_type,store,postal_code,channel,date',
      ...Array.from({ length: 500 }, (_, i) => `${prods[i % PRODUCTS].id},"1,${pad(i % 100)}",shelf,Mercadona online,43007,online,2026-08-${pad(1 + Math.floor(i / PRODUCTS))}`)].join('\n');
    const pv = await m('POST /prices/import/preview', '500 filas', api(o.token, 'POST', '/api/prices/import/preview', { csv }));
    expect(pv.json.valid).toBe(500);
    const pc = await m('POST /prices/import/confirm', '500 filas', api(o.token, 'POST', '/api/prices/import/confirm', { csv }));
    expect(pc.json.created).toBe(500);

    // ---------- Listas generales (migración 0010): 300 artículos, 200 de la hoja antigua, copia a un viaje con 150 ----------
    const GL = '/api/shopping-lists';
    const gl = (await m('POST /shopping-lists', '—', api(o.token, 'POST', GL, { name: 'Básicos auditoría' }))).json.list.id;
    for (let i = 1; i < 20; i++) await api(o.token, 'POST', GL, { name: `Lista ${i}` });
    await m('GET /shopping-lists', '20 listas', api(o.token, 'GET', GL));
    await m('GET /shopping-lists/:lid/legacy', '200 artículos legacy', api(o.token, 'GET', `${GL}/${gl}/legacy`));
    const gli = await m('POST /shopping-lists/:lid/legacy-import', '200 artículos (máximo por petición)', api(o.token, 'POST', `${GL}/${gl}/legacy-import`, { legacyIds: Array.from({ length: 200 }, (_, i) => `aud-ls-${i + 1}`) }));
    expect(gli.json.created).toBe(200);
    const glItems: string[] = [];
    for (let i = 0; i < 100; i++) {
      glItems.push((await m('POST /shopping-lists/:lid/items', `hasta 300 artículos`, api(o.token, 'POST', `${GL}/${gl}/items`, { name: `General ${i}`, productId: prods[i % PRODUCTS].id, qty: 1 + (i % 3), perDay: i % 5 === 0 }))).json.id);
    }
    expect((await api(o.token, 'POST', `${GL}/${gl}/items`, { name: 'Sobra' })).json.error.code).toBe('limit');
    const GLV = 'lista de 300';
    await m('PATCH /shopping-lists/:lid/items/:itemId', GLV, api(o.token, 'PATCH', `${GL}/${gl}/items/${glItems[1]}`, { qty: 4, note: 'nota', productId: prods[3].id, version: 1 }));
    await m('DELETE /shopping-lists/:lid/items/:itemId', GLV, api(o.token, 'DELETE', `${GL}/${gl}/items/${glItems[2]}`));
    await m('PATCH /shopping-lists/:lid', GLV, api(o.token, 'PATCH', `${GL}/${gl}`, { name: 'Básicos (editada)', version: 1 }));
    const glGet = await m('GET /shopping-lists/:lid', `299 artículos, ${PRODUCTS} productos con 500 precios`, api(o.token, 'GET', `${GL}/${gl}`));
    expect(glGet.json.items).toHaveLength(299);
    // Viaje de destino con 150 artículos sembrados directamente (30 productos repetidos).
    const dest = (await api(o.token, 'POST', '/api/trips', { name: 'Destino copia', skiDays: 4 })).json.trip.id;
    await api(o.token, 'GET', `/api/trips/${dest}/shopping`);
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 149)
      INSERT INTO shopping_items (id, list_id, name, product_id, qty, created_by, created_at, updated_at)
      SELECT 'aud-cp-' || i, (SELECT id FROM shopping_lists WHERE trip_id = ?1), 'Copia ' || i, json_extract(?2, '$[' || (i % 30) || ']'), 1, ?3, ?4, ?4 FROM n`)
      .bind(dest, JSON.stringify(prods.map((p) => p.id)), o.id, Date.now()).run();
    const cpv = await m('POST /shopping-lists/:lid/copy/preview', '299 artículos frente a 150 del viaje', api(o.token, 'POST', `${GL}/${gl}/copy/preview`, { tripId: dest }));
    let room = 150;
    const actions = cpv.json.rows.map((r: any) => ({ itemId: r.itemId, action: r.match ? (r.actions.includes('sum') ? 'sum' : 'skip') : room-- > 0 ? 'add' : 'skip' }));
    const cp = await m('POST /shopping-lists/:lid/copy', '299 decisiones: 150 altas, sumas y omisiones', api(o.token, 'POST', `${GL}/${gl}/copy`, { tripId: dest, items: actions }));
    expect(cp.json.added).toBe(150);
    expect(cp.json.summed).toBeGreaterThan(0);
    await m('DELETE /shopping-lists/:lid', '299 artículos, 150 copias en un viaje', api(o.token, 'DELETE', `${GL}/${gl}`));

    // ---------- Tickets ----------
    const meta = { storeLabel: 'Mercadona Sallent', channel: 'store', postalCode: '22640' };
    let rid = '';
    for (let i = 0; i < 10; i++) {
      const text = TICKET.replace('18:42', `18:${pad(10 + i)}`);
      const prev = await m('POST /receipts/preview', `${PRODUCTS + 12} productos, 10 líneas`, api(o.token, 'POST', '/api/receipts/preview', { text, ...meta }));
      const mapping = prev.json.parsed.lines.map((l: any, k: number) => ({ lineNo: l.lineNo, productId: prods[k % PRODUCTS].id }));
      const conf = await m('POST /receipts/confirm', `${mapping.length} líneas asociadas`, api(o.token, 'POST', '/api/receipts/confirm', { text, ...meta, tripId: trip.id, mapping }));
      rid ||= conf.json.receiptId;
    }
    await m('GET /receipts', '10 tickets', api(o.token, 'GET', '/api/receipts'));
    await m('POST /receipts/:rid/expense', `${MEMBERS} participantes`, api(o.token, 'POST', `/api/receipts/${rid}/expense`, { tripId: trip.id, concept: 'Compra súper', participants: ids }));

    // ---------- Candidaturas, votos, presupuesto, escenarios ----------
    const cond = { checkIn: '2027-01-15', checkOut: '2027-01-18', adults: MEMBERS, childrenAges: [], forfaitIncluded: 'yes', forfaitDays: 3 };
    for (let i = 0; i < CANDIDATES; i++) await api(o.token, 'POST', `${T}/candidates`, { title: `Opción ${i}`, modality: 'lodging_forfait', areaId: AREA, amountCents: 30000 + i * 500, unit: 'per_person', priceKind: 'user_quote', ...cond });
    const scen: string[] = [];
    for (let i = 0; i < 4; i++) scen.push((await api(o.token, 'POST', `${T}/scenarios`, { providerId: 'esquiades', areaId: AREA, modality: 'lodging_forfait', checkIn: '2027-01-15', checkOut: '2027-01-18', adults: 2 + i, forfaitDays: 3 })).json.scenarioId);
    const cands = (await api(o.token, 'GET', `${T}/candidates`)).json.candidates;
    const CV = `${CANDIDATES} candidaturas × ${MEMBERS} votos`;
    for (const c of cands.slice(0, 5)) for (const u of users) await m('PUT /trips/:id/candidates/:cid/vote', CV, api(u.token, 'PUT', `${T}/candidates/${c.id}/vote`, { value: u === o ? -1 : 1 }));
    await m('PATCH /trips/:id/candidates/:cid', CV, api(o.token, 'PATCH', `${T}/candidates/${cands[0].id}`, { title: 'Opción elegida', status: 'chosen', version: cands[0].version }));
    await m('DELETE /trips/:id/candidates/:cid', CV, api(o.token, 'DELETE', `${T}/candidates/${cands.at(-1).id}`));
    // Costes por estación (migración 0009): el destino del viaje y otra estación con candidaturas.
    const OTHER = (catalog as any).areas.find((a: any) => a.kind === 'resort' && a.id !== AREA).id;
    for (const id of [AREA, OTHER]) await m('PUT /trips/:id/destination-costs/:areaId', `${SH}, ${CANDIDATES} candidaturas`, api(o.token, 'PUT', `${T}/destination-costs/${id}`,
      { forfaitCentsPerDay: 5000, rentalCentsPerDay: 2000, tollsCentsPerCar: 3000, parkingCentsPerCar: 1000, kind: 'confirmed', sourceNote: 'auditoría', checkedOn: '2026-10-01', version: 0 }));
    await m('DELETE /trips/:id/destination-costs/:areaId', '—', api(o.token, 'DELETE', `${T}/destination-costs/${OTHER}`));
    const bv = (await api(o.token, 'GET', `${T}/budget`)).json.params.version;
    await m('PUT /trips/:id/budget', `${SH}, ${CANDIDATES} candidaturas`, api(o.token, 'PUT', `${T}/budget`, { version: bv, chosenCandidateId: cands[0].id, fuelCentsPerLitre: 165, litresPer100kmX10: 65, tollsCentsPerCar: 2000, forfaitCentsPerDay: 5500, rentalCentsPerDay: 2500, skiers: 7, renters: 3 }));

    // ---------- Ingesta ----------
    const snowT = Date.now() - 3_600_000;
    await m('POST /ingest/snow', `${snowSources.length} fuentes (catálogo completo)`, api(INGEST, 'POST', '/api/ingest/snow', {
      run: { id: 'aud-snow-1', pipeline: 'snow', startedAt: snowT - 5000, finishedAt: snowT, expected: snowSources.length, ok: snowSources.length, failed: 0, unsupported: 0 },
      observations: snowSources.map((s: any, i: number) => ({ sourceId: s.id, areaId: s.scope, observedAt: snowT, opStatus: 'open', openKm: 10 + i, totalKm: 200, extractor: 'audit@1' })),
      health: snowSources.map((s: any) => ({ sourceId: s.id, status: 'ok', attemptedAt: snowT })),
    }));
    const offer = (id: string, amount: number, catalogCard: boolean) => ({ providerOfferId: id, hotelName: `Hotel ${id}`, board: 'MP', nights: 3, forfaitDays: 3, forfaitIncluded: 'yes', adults: 2,
      checkIn: '2027-01-15', checkOut: '2027-01-18', unit: 'per_person', priceKind: catalogCard ? 'advertised_from' : 'quoted_for_search', amountCents: amount, availability: 'available', extractor: 'audit@1' });
    const offersBody = (runId: string, observedAt: number, factor: number) => ({
      run: { id: runId, pipeline: 'offers', startedAt: observedAt - 5000, finishedAt: observedAt, expected: 3, ok: 3, failed: 0, unsupported: 0 },
      observedAt,
      results: [{ scenarioId: scen[0], outcome: 'results', offers: Array.from({ length: 60 }, (_, i) => offer(`s${i}`, Math.round((20000 + i * 100) * factor), false)) }],
      catalog: offerSources.slice(0, 2).map((s: any, k: number) => ({ sourceId: s.id, outcome: 'results', offers: Array.from({ length: 60 }, (_, i) => offer(`c${k}-${i}`, Math.round((18000 + i * 100) * factor), true)) })),
      health: offerSources.slice(0, 2).map((s: any) => ({ sourceId: s.id, status: 'ok', attemptedAt: observedAt })),
    });
    const t1 = Date.now() - 2 * DAY, t2 = Date.now() - DAY;
    const OF = '180 ofertas (60 de escenario + 2 × 60 de catálogo)';
    await m('POST /ingest/offers', OF, api(INGEST, 'POST', '/api/ingest/offers', offersBody('aud-off-1', t1, 1)));
    await m('GET /ingest/scenarios', '4 escenarios activos', api(INGEST, 'GET', '/api/ingest/scenarios'));
    await m('GET /ingest/offer-sources', `${offerSources.length} fuentes`, api(INGEST, 'GET', '/api/ingest/offer-sources'));
    await m('GET /ingest/snow-sources', `${snowSources.length} fuentes`, api(INGEST, 'GET', '/api/ingest/snow-sources'));

    // Ofertas guardadas: o guarda 100 (y retira una 101.ª), m1 guarda 60. La segunda ingesta (+10 %) genera los avisos.
    const offerIds = (await db.prepare('SELECT id FROM offers ORDER BY id').all<{ id: string }>()).results.map((r) => r.id);
    expect(offerIds.length).toBe(180);
    for (const oid of offerIds.slice(0, 101)) await m('PUT /offers/:oid/save', '—', api(o.token, 'PUT', `/api/offers/${oid}/save`));
    await m('DELETE /offers/:oid/save', '—', api(o.token, 'DELETE', `/api/offers/${offerIds[100]}/save`));
    for (const oid of offerIds.slice(0, 60)) await api(m1.token, 'PUT', `/api/offers/${oid}/save`);
    await m('POST /ingest/offers', `${OF}, avisos a 2 usuarios`, api(INGEST, 'POST', '/api/ingest/offers', offersBody('aud-off-2', t2, 1.1)));
    await m('DELETE /trips/:id/scenarios/:sid', '4 escenarios', api(o.token, 'DELETE', `${T}/scenarios/${scen[3]}`));

    // Historial de una oferta con un año de observaciones.
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 365)
      INSERT INTO offer_observations (id, offer_id, observed_at, price_kind, amount_cents, unit, availability, extractor, content_hash)
      SELECT 'aud-h-' || i, ?1, ?2 - i * 86400000 - 3 * 86400000, 'advertised_from', 20000 + i, 'per_person', 'available', 'audit@1', 'aud-h-' || i FROM n`).bind(offerIds[150], Date.now()).run();
    await m('GET /offers/:oid/history', '367 observaciones', api(o.token, 'GET', `/api/offers/${offerIds[150]}/history`));

    // ---------- Avisos: marcar como leídos ----------
    const unread = async (uid: string) => (await db.prepare('SELECT id FROM notifications WHERE user_id = ?1 AND read_at IS NULL').bind(uid).all<{ id: string }>()).results.map((r) => r.id);
    const oUnread = await unread(o.id), m1Unread = await unread(m1.id);
    expect(oUnread.length).toBe(100);
    expect(m1Unread.length).toBe(60);
    await m('GET /notifications', '100 avisos sin leer (se devuelven 50)', api(o.token, 'GET', '/api/notifications'));
    const rd1 = await m('POST /notifications/read', '60 avisos sin leer, todos', api(m1.token, 'POST', '/api/notifications/read', { ids: m1Unread }));
    expect(rd1.json.updated).toBe(60);
    const rd2 = await m('POST /notifications/read (100 ids)', '100 IDs (máximo), todos sin leer', api(o.token, 'POST', '/api/notifications/read', { ids: oUnread }));
    expect(rd2.json.updated).toBe(100);

    // ---------- Comentarios ----------
    const comments: string[] = [];
    for (let i = 0; i < COMMENTS; i++) comments.push((await m('POST /comments', 'privado de viaje', api(users[i % MEMBERS].token, 'POST', '/api/comments', { scope: 'trip_private', tripId: trip.id, body: `Comentario ${i}: ¿quién lleva las cadenas?` }))).json.id);
    for (let i = 0; i < 10; i++) await m('POST /comments', 'público de estación', api(o.token, 'POST', '/api/comments', { scope: 'area_public', areaId: AREA, body: `Nieve polvo ${i}` }));
    await m('GET /trips/:id/comments', `${COMMENTS} comentarios`, api(o.token, 'GET', `${T}/comments`));
    await m('PATCH /comments/:cid', '—', api(o.token, 'PATCH', `/api/comments/${comments[0]}`, { body: 'Editado' }));
    await m('DELETE /comments/:cid', '—', api(o.token, 'DELETE', `/api/comments/${comments[MEMBERS]}`));

    // ---------- Administración ----------
    const A = (method: string, path: string, body?: unknown) => api(adm.token, method, `/api/admin${path}`, body);
    await m('GET /admin/health', 'capturas, fuentes y áreas del catálogo', A('GET', '/health'));
    await m('GET /admin/users', `${SEEDED_FRIENDS + 17} cuentas`, A('GET', '/users'));
    await m('POST /admin/users/:uid/block', '—', A('POST', `/users/${victim.id}/block`));
    await m('POST /admin/users/:uid/unblock', '—', A('POST', `/users/${victim.id}/unblock`));
    await m('POST /admin/comments/:cid/hide', '—', A('POST', `/comments/${comments[1]}/hide`, { hidden: true, reason: 'prueba' }));
    {
      const lines = ['date,user,status'];
      for (let p = 0; p < 20; p++) for (let d = 0; d < 250; d++) lines.push(`${new Date(Date.UTC(2023, 0, 1 + d)).toISOString().slice(0, 10)},Hoja ${p},ocupado`);
      const csv = lines.join('\n');
      await m('POST /admin/legacy/sheets/import', '5.000 filas (máximo por importación)', A('POST', '/legacy/sheets/import', { kind: 'availability', fileName: 'audit.csv', csv, dryRun: false }));
    }
    await m('GET /admin/legacy/comments', '500 comentarios legacy', A('GET', '/legacy/comments'));
    await m('POST /admin/legacy/comments/:lid/reconcile', '—', A('POST', '/legacy/comments/aud-lc-1/reconcile', { userId: m1.id, publish: true }));
    await m('POST /admin/legacy/comments/publish', '500 comentarios elegidos', A('POST', '/legacy/comments/publish', { ids: Array.from({ length: 500 }, (_, i) => `aud-lc-${i + 1}`), publish: true }));
    await m('GET /public/tips', '—', api(null, 'GET', '/api/public/tips'));
    await m('GET /admin/legacy/summary', '500 comentarios, 8 personas × 150 días + 20 × 250', A('GET', '/legacy/summary'));
    await m('GET /admin/legacy/availability', '8 personas × 150 días', A('GET', '/legacy/availability'));
    const rec = await m('POST /admin/legacy/availability/reconcile', '150 días', A('POST', '/legacy/availability/reconcile', { person: 'Persona 1', userId: m1.id }));
    expect(rec.json.days).toBe(150);
    const mine = await m('GET /legacy/availability/mine', '150 días', api(m1.token, 'GET', '/api/legacy/availability/mine'));
    const inc = await m('POST /legacy/availability/mine/incorporate', '150 días', api(m1.token, 'POST', '/api/legacy/availability/mine/incorporate', { days: mine.json.days.map((d: any) => d.day), overwrite: true }));
    expect(inc.json.incorporated + inc.json.skippedUnmapped).toBe(150);
    await m('POST /admin/legacy/identities/link', '150 días + 500 comentarios de «Pepe»', A('POST', '/legacy/identities/link', { name: 'Pepe', userId: r1.id }));
    await m('POST /admin/legacy/identities/link (disponibilidad)', '150 días', A('POST', '/legacy/identities/link', { name: 'Persona 2', userId: r1.id }));

    // ---------- Destructivas, al final ----------
    await m('DELETE /trips/:id/members/:userId', `${MEMBERS + 1} miembros`, api(o.token, 'DELETE', `${T}/members/${m7.id}`));
    await m('DELETE /trips/:id/members/:userId (abandonar)', `${MEMBERS} miembros`, api(m6.token, 'DELETE', `${T}/members/${m6.id}`));
    await m('POST /trips/:id/transfer', '—', api(o.token, 'POST', `${T}/transfer`, { userId: m1.id }));
    await m('DELETE /trips/:id', 'viaje completo (gastos, compra, tickets, candidaturas, comentarios)', api(m1.token, 'DELETE', T));
    expect((await api(m1.token, 'GET', T)).status).toBe(404);

    const rows = [...measured].sort((a, b) => b[1].max - a[1].max);
    console.log(['| Ruta | Sentencias D1 (máx.) | Volumen | HTTP |', '|---|---|---|---|', ...rows.map(([k, v]) => `| \`${k}\` | ${v.max} | ${v.volume} | ${v.status} |`)].join('\n'));
    for (const [k, v] of rows) expect.soft(v.max, k).toBeLessThanOrEqual(40);
  }, 600_000);

  it('entre las dos auditorías se miden todas las rutas definidas', () => {
    const files = Object.fromEntries(Object.entries(routeSrc).map(([p, s]) => [p.split('/').pop()!.replace(/\.ts$/, ''), s]));
    const defined = definedRoutes(indexSrc, files);
    const r = coverage(defined, [...measuredLabels(auditSrc), ...measuredLabels(auditAllSrc)]);
    console.log(`Rutas definidas: ${r.defined} · medidas: ${r.measured}`);
    expect(defined.length).toBeGreaterThan(90);
    expect.soft(r.missing, 'rutas sin medir').toEqual([]);
    expect.soft(r.unknown, 'etiquetas que no corresponden a ninguna ruta').toEqual([]);
  });
});
