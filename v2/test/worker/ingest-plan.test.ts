import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, signup } from './helpers';

const INGEST = 'test-ingest-token';
const ingest = (path: string, body: unknown, token = INGEST) =>
  SELF.fetch(`http://localhost/api/ingest/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json<any>() }));

beforeAll(async () => {
  const db = env.DB;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country, official_total_km) VALUES ('astun-candanchu','Astún + Candanchú','domain','ES',101), ('astun','Astún','resort','ES',50), ('candanchu','Candanchú','resort','ES',NULL),
      ('grandvalira','Grandvalira','resort','AD',215), ('cerler','Cerler','resort','ES',81)`),
    db.prepare(`INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES ('astun-candanchu','astun','member'), ('astun-candanchu','candanchu','member')`),
    db.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona','Tarragona',41.1189,1.2445)`),
    db.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, source, validated) VALUES ('tarragona','cerler','Cerler',295,'legacy_hardcode',0)`),
    db.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter) VALUES
      ('esq-ac','astun-candanchu','astun-candanchu','snow','esquiades','https://www.esquiades.com/informacion-interes/estado-pistas/','playwright','[]','unverified','esquiades-status'),
      ('esq-gv','grandvalira','grandvalira','snow','esquiades','https://www.esquiades.com/informacion-interes/estado-pistas/','playwright','[]','unverified','esquiades-status'),
      ('esq-cer','cerler','cerler','snow','esquiades','https://www.esquiades.com/informacion-interes/estado-pistas/','playwright','[]','unverified','esquiades-status')`),
    db.prepare(`INSERT OR IGNORE INTO providers (id, name, enabled) VALUES ('esquiades','Esquiades',0), ('estiber','Estiber',0), ('manual','Manual',0)`),
  ]);
});

const run = (id: string, over: Record<string, unknown> = {}) => ({ id, pipeline: 'snow', startedAt: Date.now() - 1000, finishedAt: Date.now(), expected: 3, ok: 3, failed: 0, unsupported: 0, ...over });
const obs = (areaId: string, sourceId: string, over: Record<string, unknown> = {}) => ({ sourceId, areaId, observedAt: 1_780_000_000_000, opStatus: 'open', openKm: 12.5, totalKm: 101, extractor: 'esquiades-status@2', ...over });

describe('ingesta de nieve', () => {
  it('exige la credencial de ingesta, distinta de las sesiones', async () => {
    expect((await ingest('snow', {}, 'otra-credencial-cualquiera')).status).toBe(401);
    const u = await signup();
    const r = await SELF.fetch('http://localhost/api/ingest/snow', { method: 'POST', headers: { Authorization: `Bearer ${u.token}` }, body: '{}' });
    expect(r.status).toBe(401);
  });

  it('guarda decimales, es idempotente y no replica un dominio en sus miembros', async () => {
    const body = { run: run('run-snow-1'), observations: [obs('astun-candanchu', 'esq-ac'), obs('astun', 'esq-ac')], health: [{ sourceId: 'esq-ac', status: 'ok', attemptedAt: Date.now() }] };
    const r1 = await ingest('snow', body);
    expect(r1.json.written).toBe(1);
    expect(r1.json.rejected).toEqual([{ sourceId: 'esq-ac', areaId: 'astun', reason: 'fuente o ámbito no registrado' }]);
    const r2 = await ingest('snow', body);
    expect(r2.json.written).toBe(0);
    const rows = await env.DB.prepare(`SELECT area_id, open_km FROM snow_observations WHERE source_id = 'esq-ac'`).all();
    expect(rows.results).toEqual([{ area_id: 'astun-candanchu', open_km: 12.5 }]);
  });

  it('desconocido no es cero, cierre confirmado y estaciones con cifras iguales conviven', async () => {
    await ingest('snow', { run: run('run-snow-2'), observations: [
      obs('grandvalira', 'esq-gv', { openKm: null, totalKm: 215, opStatus: 'unknown', observedAt: 1_780_000_100_000 }),
      obs('cerler', 'esq-cer', { openKm: 0, totalKm: 81, opStatus: 'closed_confirmed', observedAt: 1_780_000_100_000 }),
    ], health: [] });
    await ingest('snow', { run: run('run-snow-3'), observations: [
      obs('grandvalira', 'esq-gv', { openKm: 40, totalKm: 215, observedAt: 1_780_000_200_000 }),
      obs('cerler', 'esq-cer', { openKm: 40, totalKm: 81, observedAt: 1_780_000_200_000 }),
    ], health: [] });
    const gv = await env.DB.prepare(`SELECT open_km, op_status FROM snow_observations WHERE area_id = 'grandvalira' ORDER BY observed_at`).all();
    expect(gv.results[0]).toEqual({ open_km: null, op_status: 'unknown' });
    const cer = await env.DB.prepare(`SELECT open_km, op_status FROM snow_observations WHERE area_id = 'cerler' ORDER BY observed_at`).all();
    expect(cer.results.map((r: any) => r.open_km)).toEqual([0, 40]);
    expect(cer.results[0]).toMatchObject({ op_status: 'closed_confirmed' });
  });

  it('totales discrepantes quedan marcados', async () => {
    await ingest('snow', { run: run('run-snow-4'), observations: [obs('grandvalira', 'esq-gv', { openKm: 10, totalKm: 180, observedAt: 1_780_000_300_000 })], health: [] });
    const r = await env.DB.prepare(`SELECT quality FROM snow_observations WHERE area_id = 'grandvalira' AND total_km = 180`).first<{ quality: string }>();
    expect(r!.quality).toBe('total_mismatch');
  });

  it('una captura de cero filas es un problema visible y el fallo de una fuente no borra el último dato válido', async () => {
    const r = await ingest('snow', { run: run('run-snow-5', { ok: 0, failed: 3 }), observations: [], health: [{ sourceId: 'esq-gv', status: 'error', error: 'timeout', attemptedAt: Date.now() }] });
    expect(r.json.runStatus).toBe('error');
    const h = await env.DB.prepare(`SELECT last_status, last_success_at, consecutive_fail FROM source_health WHERE source_id = 'esq-gv'`).first<any>();
    expect(h.last_status).toBe('error');
    const cat = (await api(null, 'GET', '/api/public/catalog')).json;
    const gv = cat.areas.find((a: any) => a.id === 'grandvalira');
    expect(gv.snow.openKm).toBe(10);
    expect(gv.snow.freshness).toBe('stale'); // observación antigua: se sirve con su fecha, sin fingir frescura
  });

  it('catálogo público: sin datos personales ni controles de infraestructura', async () => {
    const cat = (await api(null, 'GET', '/api/public/catalog')).json;
    const s = JSON.stringify(cat);
    expect(s).not.toMatch(/@|INGEST|github/i);
    expect(cat.areas.find((a: any) => a.id === 'cerler').route).toMatchObject({ roadKm: 295, validated: false });
  });
});

describe('escenarios, ofertas y presupuesto', () => {
  it('ingesta de ofertas: no observada ≠ agotada, precio «desde» y no se multiplica al cambiar noches', async () => {
    const o = await signup();
    const d = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() + 62 * 86400_000).toISOString().slice(0, 10);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Paquete', startDate: d, endDate: d2, skiDays: 2, participantsPlanned: 2, cars: 1, areaId: 'cerler' })).json.trip;
    expect(trip.nights).toBe(2); // derivadas de las fechas
    const sc = await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { providerId: 'esquiades', areaId: 'cerler', modality: 'lodging_forfait', checkIn: d, checkOut: d2, adults: 2, forfaitDays: 2 });
    expect(sc.status).toBe(201);
    const sc2 = await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { providerId: 'esquiades', areaId: 'cerler', modality: 'lodging_forfait', checkIn: d, checkOut: d2, adults: 2, forfaitDays: 2 });
    expect(sc2.json).toMatchObject({ scenarioId: sc.json.scenarioId, reused: true });
    const scen = (await SELF.fetch('http://localhost/api/ingest/scenarios', { headers: { Authorization: `Bearer ${INGEST}` } }).then((r) => r.json<any>())).scenarios;
    expect(scen.map((s: any) => s.id)).toContain(sc.json.scenarioId);

    // La tarjeta declara fechas, adultos y forfait: condiciones verificadas → cotización para la búsqueda.
    const offer = (id: string, amount: number | null) => ({ providerOfferId: id, hotelName: `Hotel ${id}`, board: 'MP', nights: 2, forfaitDays: 2, forfaitIncluded: 'yes', adults: 2,
      checkIn: d, checkOut: d2, unit: 'per_person', priceKind: 'quoted_for_search', amountCents: amount, availability: 'available', extractor: 'esquiades-cards@2' });
    const t1 = Date.now() - 2 * 86400_000, t2 = Date.now() - 86400_000;
    await ingest('offers', { run: { ...run('run-off-1'), pipeline: 'offers' }, observedAt: t1, results: [{ scenarioId: sc.json.scenarioId, outcome: 'results', offers: [offer('A', 20000), offer('B', 25000)] }] });
    await ingest('offers', { run: { ...run('run-off-2'), pipeline: 'offers' }, observedAt: t2, results: [{ scenarioId: sc.json.scenarioId, outcome: 'results', offers: [offer('A', 19000)] }] });
    const view = (await api(o.token, 'GET', `/api/trips/${trip.id}/scenarios`)).json.scenarios[0];
    const A = view.offers.find((x: any) => x.hotelName === 'Hotel A');
    const B = view.offers.find((x: any) => x.hotelName === 'Hotel B');
    expect(A.panel.change).toMatchObject({ cents: -1000 });
    expect(B.availability).toBe('not_observed');
    expect(view.distribution.groups[0]).toMatchObject({ unit: 'per_person', n: 1, compositionChanged: true });

    const cand = (await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Hotel A', offerId: A.offerId, modality: 'lodging_forfait' })).json;
    const budget0 = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json;
    await api(o.token, 'PUT', `/api/trips/${trip.id}/budget`, { version: budget0.params.version, chosenCandidateId: cand.id });
    const b1 = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json.result;
    expect(b1.components.find((c: any) => c.key === 'lodging')).toMatchObject({ status: 'known', totalCents: 38000 });
    expect(b1.components.find((c: any) => c.key === 'forfait').status).toBe('not_applicable');
    const tv = (await api(o.token, 'GET', `/api/trips/${trip.id}`)).json.trip;
    const d4 = new Date(Date.parse(d2) + 2 * 86400_000).toISOString().slice(0, 10);
    const patched = await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { endDate: d4, version: tv.version });
    expect(patched.json.trip.nights).toBe(4);
    const b2 = (await api(o.token, 'GET', `/api/trips/${trip.id}/budget`)).json.result;
    expect(b2.components.find((c: any) => c.key === 'lodging')).toMatchObject({ status: 'pending', totalCents: null });
    expect(b2.complete).toBe(false);
  });

  it('ofertas de catálogo: orientativas, sin escenario, idempotentes y limitadas a fuentes registradas', async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, status, adapter) VALUES
      ('estiber-cer','cerler','cerler','offers','estiber','https://www.estiber.com/ofertas/cerler','playwright','[]','unverified','estiber-cards')`).run();
    const offer = { providerOfferId: 'est-1', hotelName: 'Hotel Prueba', board: 'half_board', nights: 2, forfaitDays: 2, adults: 2, unit: 'per_person', priceKind: 'advertised_from', amountCents: 18900, availability: 'available', extractor: 'estiber-cards@1' };
    const seen = Date.now() - 3_600_000; // el detalle público solo muestra ofertas de los últimos 14 días
    const body = (id: string) => ({ run: { ...run(id), pipeline: 'offers', expected: 1, ok: 1 }, observedAt: seen, results: [],
      catalog: [{ sourceId: 'estiber-cer', outcome: 'results', offers: [offer] }, { sourceId: 'esq-cer', outcome: 'results', offers: [offer] }] });
    const r1 = await ingest('offers', body('run-cat-1'));
    expect(r1.status).toBe(200);
    expect(r1.json.written).toBe(1); // esq-cer es una fuente de nieve: se ignora
    expect((await ingest('offers', body('run-cat-2'))).json.written).toBe(0);
    const area = (await api(null, 'GET', '/api/public/areas/cerler')).json;
    expect(area.offers.items).toHaveLength(1);
    expect(area.offers.items[0]).toMatchObject({ price_kind: 'advertised_from', amount_cents: 18900, unit: 'per_person' });
    expect(area.offers.note).toMatch(/orientativas/);
  });

  it('votos: uno por persona, modificable, y votar no es reservar', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Votos' })).json.trip;
    const c = (await api(o.token, 'POST', `/api/trips/${trip.id}/candidates`, { title: 'Apartamento', modality: 'lodging', amountCents: 30000, unit: 'per_stay' })).json;
    await api(o.token, 'PUT', `/api/trips/${trip.id}/candidates/${c.id}/vote`, { value: 1 });
    await api(o.token, 'PUT', `/api/trips/${trip.id}/candidates/${c.id}/vote`, { value: 1 });
    await api(o.token, 'PUT', `/api/trips/${trip.id}/candidates/${c.id}/vote`, { value: -1 });
    const list = (await api(o.token, 'GET', `/api/trips/${trip.id}/candidates`)).json.candidates;
    expect(list[0]).toMatchObject({ score: -1, up: 0, down: 1, my_vote: -1, status: 'proposed', price_kind: 'user_quote' });
  });

  it('límites de escenarios para no disparar el coste', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Límites' })).json.trip;
    const far = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
    const far2 = new Date(Date.now() + 402 * 86400_000).toISOString().slice(0, 10);
    expect((await api(o.token, 'POST', `/api/trips/${trip.id}/scenarios`, { providerId: 'esquiades', areaId: 'cerler', modality: 'lodging', checkIn: far, checkOut: far2, adults: 2 })).status).toBe(422);
  });
});

describe('comentarios', () => {
  it('nadie edita el comentario de otro cambiando el ID; los privados solo los ven miembros', async () => {
    const a = await signup(); const b = await signup();
    const c = (await api(a.token, 'POST', '/api/comments', { scope: 'area_public', areaId: 'cerler', body: 'Buena nieve' })).json;
    expect((await api(b.token, 'PATCH', `/api/comments/${c.id}`, { body: 'hackeado' })).status).toBe(403);
    expect((await api(b.token, 'DELETE', `/api/comments/${c.id}`)).status).toBe(403);
    const pub = (await api(null, 'GET', '/api/public/areas/cerler')).json.comments;
    expect(pub[0]).toMatchObject({ body: 'Buena nieve', author_alias: a.alias });
    expect(JSON.stringify(pub)).not.toMatch(/@/);
    const trip = (await api(a.token, 'POST', '/api/trips', { name: 'Priv' })).json.trip;
    const pc = (await api(a.token, 'POST', '/api/comments', { scope: 'trip_private', tripId: trip.id, body: 'secreto' })).json;
    expect((await api(b.token, 'GET', `/api/trips/${trip.id}/comments`)).status).toBe(404);
    expect((await api(b.token, 'PATCH', `/api/comments/${pc.id}`, { body: 'x' })).status).toBe(404);
    expect((await api(b.token, 'POST', '/api/comments', { scope: 'trip_private', tripId: trip.id, body: 'x' })).status).toBe(404);
  });

  it('la administración no es accesible para usuarios normales', async () => {
    const a = await signup();
    expect((await api(a.token, 'GET', '/api/admin/health')).status).toBe(404);
    await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(a.id).run();
    expect((await api(a.token, 'GET', '/api/admin/health')).status).toBe(200);
    const b = await signup();
    await api(a.token, 'POST', `/api/admin/users/${b.id}/block`, { reason: 'prueba' });
    const blocked = (await api(a.token, 'GET', '/api/admin/users?status=blocked')).json.users;
    expect(blocked.map((u: any) => u.id)).toContain(b.id);
    expect(JSON.stringify(blocked)).not.toMatch(/@/);
  });

  it('disponibilidad legacy: solo un administrador la asigna y no se copia al calendario', async () => {
    const adm = await signup(); const u = await signup(); const other = await signup();
    await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id).run();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('lf-av','sheets_availability','d.csv','h-av',1,2,1)`),
      env.DB.prepare(`INSERT OR IGNORE INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status) VALUES
        ('la1','lf-av','rh1','Núria','2026-01-10','marcado','busy'), ('la2','lf-av','rh2','Núria','2026-01-12','marcado','busy')`),
    ]);
    expect((await api(u.token, 'POST', '/api/admin/legacy/availability/reconcile', { person: 'Núria', userId: u.id })).status).toBe(404);
    const people = (await api(adm.token, 'GET', '/api/admin/legacy/availability')).json.people;
    expect(people.find((p: any) => p.person === 'Núria')).toMatchObject({ days: 2, reconciled_user_id: null });
    expect((await api(adm.token, 'POST', '/api/admin/legacy/availability/reconcile', { person: 'Núria', userId: u.id })).json.days).toBe(2);
    expect((await api(u.token, 'GET', '/api/legacy/availability/mine')).json.days.map((d: any) => d.day)).toEqual(['2026-01-10', '2026-01-12']);
    expect((await api(other.token, 'GET', '/api/legacy/availability/mine')).json.days).toEqual([]);
    const cal = await api(u.token, 'GET', '/api/availability/me?from=2026-01-01&to=2026-01-31');
    expect(cal.status).toBe(200);
    expect(cal.json.days).toEqual({});
  });
});
