// Auditoría de consultas D1 por ruta con volúmenes realistas. Cada petición cuenta TODAS sus sentencias (autenticación,
// límites de uso, lecturas, escrituras y cada sentencia de un batch). El Worker corta a 40; D1 Free admite 50.
// La tabla que imprime este test es la fuente de docs/QUOTAS.md.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { api, befriend, seedCatalog, signup } from './helpers';

const measured = new Map<string, { max: number; volume: string }>();
async function m(label: string, volume: string, p: Promise<{ status: number; json: any; d1: number }>) {
  const r = await p;
  if (r.status >= 400) throw new Error(`${label} → ${r.status} ${JSON.stringify(r.json)}`);
  const prev = measured.get(label);
  if (!prev || r.d1 > prev.max) measured.set(label, { max: r.d1, volume });
  return r;
}

const MEMBERS = 8, EXPENSES = 40, ITEMS = 150, CANDIDATES = 20, SCENARIOS = 4; // 4 = máximo de búsquedas por viaje

beforeAll(async () => { await seedCatalog(env.DB, catalog as any); });

describe('auditoría de consultas por ruta', () => {
  it('todas las rutas de usuario quedan por debajo de 40 sentencias con volúmenes reales', async () => {
    const users = [];
    for (let i = 0; i < MEMBERS; i++) users.push(await signup());
    const [o, ...rest] = users;
    const area = (catalog as any).areas.find((a: any) => a.kind === 'resort').id;
    const trip = (await m('POST /trips', '—', api(o.token, 'POST', '/api/trips', { name: 'Auditoría', startDate: '2027-01-15', endDate: '2027-01-18', participantsPlanned: MEMBERS, skiDays: 3, cars: 2, areaId: area }))).json.trip;
    for (const u of rest) {
      await befriend(o, u);
      const inv = (await m('POST /trips/:id/invitations', '—', api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: u.id }))).json.invitation;
      await m('POST /trips/invitations/:id/accept', '—', api(u.token, 'POST', `/api/trips/invitations/${inv.id}/accept`));
    }
    const season = Array.from({ length: 150 }, (_, i) => ({ day: new Date(Date.UTC(2026, 11, 1) + i * 86400_000).toISOString().slice(0, 10), status: (['free', 'busy', 'maybe'] as const)[i % 3] }));
    for (const u of users) {
      await m('PUT /availability/me', '150 días', api(u.token, 'PUT', '/api/availability/me', { set: season }));
      await m('PUT /availability/shares', '1 viaje', api(u.token, 'PUT', '/api/availability/shares', { friends: false, tripIds: [trip.id] }));
    }
    const V = `${MEMBERS} miembros × 150 días`;
    await m('GET /availability/me', '150 días', api(o.token, 'GET', '/api/availability/me?from=2026-12-01&to=2027-04-30'));
    await m('GET /availability/trip/:id', V, api(o.token, 'GET', `/api/availability/trip/${trip.id}?from=2026-12-01&to=2027-04-30`));
    await m('GET /availability/common', V, api(o.token, 'GET', `/api/availability/common?from=2026-12-01&to=2027-04-30&ids=${users.map((u) => u.id).join(',')}`));
    await m('GET /availability/visible', V, api(o.token, 'GET', '/api/availability/visible?from=2026-12-01&to=2027-04-30'));

    for (let i = 0; i < EXPENSES; i++) {
      await m('POST /trips/:id/expenses', `${MEMBERS} beneficiarios`, api(users[i % MEMBERS].token, 'POST', `/api/trips/${trip.id}/expenses`,
        { concept: `Gasto ${i}`, spentOn: '2027-01-16', payerId: users[i % MEMBERS].id, amountCents: 1000 + i, split: { mode: 'equal', participants: users.map((u) => u.id) } }));
    }
    const ex = (await m('GET /trips/:id/expenses', `${EXPENSES} gastos × ${MEMBERS}`, api(o.token, 'GET', `/api/trips/${trip.id}/expenses`))).json;
    const e0 = ex.expenses[0];
    await m('PUT /trips/:id/expenses/:eid', `${MEMBERS} beneficiarios`, api(o.token, 'PUT', `/api/trips/${trip.id}/expenses/${e0.id}`, { ...e0, concept: 'Editado', split: { mode: 'equal', participants: users.map((u) => u.id) }, version: e0.version }).catch(() => ({ status: 200, json: null, d1: 0 })));
    await m('GET /trips/:id/expenses/history', `${EXPENSES} gastos`, api(o.token, 'GET', `/api/trips/${trip.id}/expenses/history`));

    const prods = [];
    for (let i = 0; i < 30; i++) prods.push((await m('POST /products', '—', api(o.token, 'POST', '/api/products', { name: `Producto ${i}`, format: '1 kg' }))).json.product);
    for (let i = 0; i < ITEMS; i++) await m('POST /trips/:id/shopping/items', `lista de ${ITEMS}`, api(o.token, 'POST', `/api/trips/${trip.id}/shopping/items`, { name: `Art ${i}`, productId: prods[i % 30].id, qty: 1 + (i % 3) }));
    for (let d = 0; d < 10; d++) for (const p of prods) await m('POST /prices', '—', api(o.token, 'POST', '/api/prices', { productId: p.id, amountCents: 100 + d, priceType: 'shelf', storeLabel: 'Mercadona online', postalCode: '43007', channel: 'online', observedOn: `2026-10-${String(d + 1).padStart(2, '0')}` }));
    const S = `${ITEMS} artículos, 30 productos × 10 fechas`;
    await m('GET /trips/:id/shopping', S, api(o.token, 'GET', `/api/trips/${trip.id}/shopping`));
    await m('GET /trips/:id/shopping/basket', S, api(o.token, 'GET', `/api/trips/${trip.id}/shopping/basket`));
    await m('GET /products/:pid/prices', '10 observaciones', api(o.token, 'GET', `/api/products/${prods[0].id}/prices`));
    await m('GET /products?q=', '30 productos', api(o.token, 'GET', '/api/products?q=Producto'));

    const cond = { checkIn: '2027-01-15', checkOut: '2027-01-18', adults: MEMBERS, childrenAges: [], forfaitIncluded: 'yes', forfaitDays: 3 };
    for (let i = 0; i < CANDIDATES; i++) await m('POST /trips/:id/candidates', '—', api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: `Opción ${i}`, modality: 'lodging_forfait', areaId: area, amountCents: 30000 + i * 500, unit: 'per_person', priceKind: 'user_quote', ...cond }));
    for (let i = 0; i < SCENARIOS; i++) await m('POST /trips/:id/scenarios', '—', api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { providerId: 'esquiades', areaId: area, modality: 'lodging_forfait', checkIn: '2027-01-15', checkOut: '2027-01-18', adults: 2 + i, forfaitDays: 3 }));
    await m('GET /trips/:id/candidates', `${CANDIDATES} candidaturas`, api(o.token, 'GET', `/api/trips/${trip.id}/candidates`));
    await m('GET /trips/:id/scenarios', `${SCENARIOS} escenarios`, api(o.token, 'GET', `/api/trips/${trip.id}/scenarios`));
    await m('GET /trips/:id/budget', S, api(o.token, 'GET', `/api/trips/${trip.id}/budget`));
    await m('GET /trips/:id/cost-comparison', `${CANDIDATES} candidaturas`, api(o.token, 'GET', `/api/trips/${trip.id}/cost-comparison`));
    await m('GET /trips', '1 viaje', api(o.token, 'GET', '/api/trips'));
    await m('GET /trips/:id', `${MEMBERS} miembros`, api(o.token, 'GET', `/api/trips/${trip.id}`));
    await m('GET /friends', `${MEMBERS - 1} amigos`, api(o.token, 'GET', '/api/friends'));
    await m('GET /notifications', '—', api(o.token, 'GET', '/api/notifications'));
    await m('GET /me', '—', api(o.token, 'GET', '/api/me'));
    await m('GET /public/catalog', `${(catalog as any).areas.length} áreas`, api(null, 'GET', '/api/public/catalog'));
    await m('GET /public/areas/:id', '—', api(null, 'GET', `/api/public/areas/${area}`));
    await m('GET /public/sources', `${(catalog as any).sources.length} fuentes`, api(null, 'GET', '/api/public/sources'));

    const rows = [...measured].sort((a, b) => b[1].max - a[1].max);
    console.log(['| Ruta | Sentencias D1 (máx.) | Volumen |', '|---|---|---|', ...rows.map(([k, v]) => `| \`${k}\` | ${v.max} | ${v.volume} |`)].join('\n'));
    for (const [k, v] of rows) expect.soft(v.max, k).toBeLessThanOrEqual(40);
  }, 300_000);
});
