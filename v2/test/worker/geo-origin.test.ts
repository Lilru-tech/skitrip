// Origen personalizado: búsqueda y rutas con Geoapify simulado (sin red), topes de créditos por persona y globales,
// errores del proveedor, privacidad (la dirección no se guarda) y coste del viaje desde otra salida.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, signup } from './helpers';

const realFetch = globalThis.fetch;
type Mock = { calls: { url: URL; body: any }[]; fail?: number; matrixNull?: string[] };
let mock: Mock;

/** Sustituye solo las llamadas a geo.mock (GEOAPIFY_BASE_URL de las pruebas). */
function installMock(m: Mock = { calls: [] }) {
  mock = m;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'geo.mock') return realFetch(input, init);
    const body = init?.body ? JSON.parse(init.body) : null;
    mock.calls.push({ url, body });
    if (mock.fail) return new Response('fail', { status: mock.fail });
    if (url.pathname === '/v1/geocode/search') {
      return Response.json({ results: [{ formatted: 'Reus, Tarragona, España', lat: 41.155, lon: 1.107, result_type: 'city' }, { formatted: 'sin coordenadas' }] });
    }
    if (url.pathname === '/v1/routematrix') {
      const row = body.targets.map((_: unknown, i: number) => ({ source_index: 0, target_index: i, distance: 100_000 + i * 10_000, time: 3600 + i * 60 }));
      return Response.json({ sources_to_targets: [row] });
    }
    return new Response('not found', { status: 404 });
  });
}
afterEach(() => vi.restoreAllMocks());

const AREAS = ['g-uno', 'g-dos', 'g-nuria'];
beforeAll(async () => {
  const db = env.DB;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona', 'Tarragona', 41.1189, 1.2445), ('sabadell', 'Sabadell', 41.5463, 2.1086)`),
    ...AREAS.map((id, i) => db.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country, lat, lon) VALUES (?1, ?2, 'resort', 'ES', ?3, 1.5)`).bind(id, `Geo ${id}`, 42.3 + i / 10)),
    ...AREAS.map((id, i) => db.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, toll_cents, source, checked_on, validated) VALUES ('tarragona', ?1, 'x', ?2, 120, NULL, 'manual', '2026-10-01', 1)`).bind(id, 200 + i)),
    db.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated) VALUES ('sabadell', 'g-uno', 'x', 150, 100, 'manual', '2026-10-01', 1)`),
    db.prepare(`INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source) VALUES ('g-nuria', 'Cremallera de prueba', 42.35, 2.16, 'rack_railway', 'Sin acceso en coche (prueba).', 'prueba')`),
    db.prepare(`INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source) VALUES ('g-uno', 'Aparcamiento de prueba', 42.31, 1.51, 'car', NULL, 'prueba')`),
  ]);
});

describe('origen personalizado', () => {
  it('busca, calcula rutas al acceso (no al centro) y no guarda la dirección ni las coordenadas', async () => {
    installMock();
    const u = await signup();
    const s = await api(u.token, 'POST', '/api/geo/search', { text: 'Reus' });
    expect(s.status).toBe(200);
    expect(s.json.results).toEqual([{ label: 'Reus, Tarragona, España', lat: 41.155, lon: 1.107, kind: 'city' }]);
    expect(s.json.attribution).toMatch(/Geoapify.*OpenStreetMap/);
    // La clave va al proveedor; la búsqueda filtra países y no se envía nada más.
    expect(mock.calls[0].url.searchParams.get('apiKey')).toBe('test-geo-key');
    expect(mock.calls[0].url.searchParams.get('filter')).toBe('countrycode:es,ad,fr');

    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.155, lon: 1.107 });
    expect(r.status).toBe(200);
    const call = mock.calls[1].body;
    expect(call.sources).toEqual([{ location: [1.107, 41.155] }]);
    // Destino de g-uno: su acceso (no el punto del catálogo); g-dos sin acceso usa el del catálogo.
    expect(call.targets).toContainEqual({ location: [1.51, 42.31] });
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.areaId, x]));
    expect(by['g-uno']).toMatchObject({ accessName: 'Aparcamiento de prueba', roadKm: expect.any(Number), durationMin: expect.any(Number) });
    expect(by['g-uno'].notes).toContain('aproximado, sin confirmar');
    expect(by['g-uno'].access).toMatchObject({ confidence: 'approximate' });
    // Sin acceso conocido: punto central del catálogo, dicho expresamente (no se presenta como acceso confirmado).
    expect(by['g-dos'].accessName).toBe('(punto central de la estación en el catálogo, no un acceso verificado)');
    expect(by['g-dos'].access).toMatchObject({ confidence: 'catalog_center' });
    expect(by['g-dos'].notes).toContain('punto central de la estación en el catálogo');
    expect(by['g-nuria']).toMatchObject({ lastLeg: 'rack_railway' });
    expect(by['g-nuria'].notes).toContain('Sin acceso en coche');
    expect(r.json.credits).toBe(r.json.routes.length);

    // Nada de la dirección ni de las coordenadas queda en D1 (solo contadores por día).
    const dump = await env.DB.prepare(`SELECT group_concat(scope || ':' || credits) AS s FROM geo_usage`).first<{ s: string }>();
    expect(dump?.s).not.toMatch(/41\.155|Reus/);
    const st = await api(u.token, 'GET', '/api/geo/status');
    expect(st.json).toMatchObject({ enabled: true, user: { used: 1 + r.json.credits, cap: 40 } });
  });

  it('valida el punto y el texto antes de gastar créditos', async () => {
    installMock();
    const u = await signup();
    expect((await api(u.token, 'POST', '/api/geo/routes', { lat: 10, lon: 1 })).status).toBe(422);
    expect((await api(u.token, 'POST', '/api/geo/search', { text: 'ab' })).status).toBe(422);
    expect(mock.calls).toHaveLength(0);
    expect((await api(u.token, 'GET', '/api/geo/status')).json.user.used).toBe(0);
    expect((await api(null, 'POST', '/api/geo/search', { text: 'Reus' })).status).toBe(401);
  });

  it('para antes del tope por persona y explica que se pueden usar los orígenes fijos', async () => {
    installMock();
    const u = await signup();
    // Tope por persona de las pruebas: 40 créditos; cada consulta de rutas cuesta tantos como destinos.
    let last;
    for (let i = 0; i < 20; i++) {
      last = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.1 + i / 1000, lon: 1.1 });
      if (last.status !== 200) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.json.error.code).toBe('geo_user_limit');
    expect(last!.json.error.message).toContain('Tarragona o Sabadell');
    const st = (await api(u.token, 'GET', '/api/geo/status')).json;
    expect(st.user.used).toBeLessThanOrEqual(40);
    // Una búsqueda (1 crédito) aún cabe si sobra algo; agotado del todo, ni se llama al proveedor.
    for (let i = 0; i < 40 && (await api(u.token, 'POST', '/api/geo/search', { text: 'Reus' })).status === 200; i++);
    expect((await api(u.token, 'GET', '/api/geo/status')).json.user.used).toBe(40);
    const callsBefore = mock.calls.length;
    expect((await api(u.token, 'POST', '/api/geo/search', { text: 'Reus' })).status).toBe(429);
    expect(mock.calls.length).toBe(callsBefore);
  });

  it('para antes del tope global aunque a la persona le queden créditos', async () => {
    installMock();
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`INSERT INTO geo_usage (day, scope, credits) VALUES (?1, 'global', 99) ON CONFLICT (day, scope) DO UPDATE SET credits = 99`).bind(day).run();
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.2, lon: 1.2 });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('geo_global_limit');
    // Lo reservado a la persona se devuelve.
    expect((await api(u.token, 'GET', '/api/geo/status')).json.user.used).toBe(0);
    await env.DB.prepare(`UPDATE geo_usage SET credits = 0 WHERE day = ?1 AND scope = 'global'`).bind(day).run();
  });

  it('un fallo o límite del proveedor se explica sin datos del usuario', async () => {
    const u = await signup();
    installMock({ calls: [], fail: 500 });
    const e = await api(u.token, 'POST', '/api/geo/search', { text: 'Calle Mayor 1, Reus' });
    expect(e.status).toBe(503);
    expect(e.json.error.code).toBe('geo_provider');
    expect(JSON.stringify(e.json)).not.toMatch(/Mayor|apiKey|test-geo-key/);
    installMock({ calls: [], fail: 429 });
    const l = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.2, lon: 1.2 });
    expect(l.status).toBe(429);
    expect(l.json.error.code).toBe('geo_provider_limit');
  });
});

describe('coste del viaje desde otra salida', () => {
  it('cambia los km del transporte y deja los peajes pendientes salvo que se indiquen', async () => {
    const u = await signup();
    const start = '2027-02-05', end = '2027-02-07';
    const t = await api(u.token, 'POST', '/api/trips', { name: 'Salidas', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'g-uno', cars: 1 });
    const tripId = t.json.trip.id;
    await api(u.token, 'POST', `/api/trips/${tripId}/candidates`, { title: 'Hotel', modality: 'lodging', amountCents: 40000, areaId: 'g-uno', forfaitIncluded: 'no',
      unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 });
    const b0 = await api(u.token, 'GET', `/api/trips/${tripId}/budget`);
    await api(u.token, 'PUT', `/api/trips/${tripId}/budget`, { version: b0.json.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0,
      fuelCentsPerLitre: 160, litresPer100kmX10: 60, tollsCentsPerCar: 2000, parkingCentsPerCar: 0 });

    const base = await api(u.token, 'GET', `/api/trips/${tripId}/cost-comparison`);
    expect(base.json.options[0]).toMatchObject({ roadKm: 200 });
    expect(base.json.options[0].perPersonCents).not.toBeNull();

    // Sabadell: su ruta; peajes del viaje (Tarragona) no valen → pendiente.
    const sab = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { originId: 'sabadell' });
    expect(sab.status).toBe(200);
    expect(sab.json.options[0]).toMatchObject({ roadKm: 150, perPersonCents: null });
    expect(sab.json.transport).toMatchObject({ originId: 'sabadell', tolls: 'per_route', tollAreas: [{ areaId: 'g-uno', given: false }] });
    expect(JSON.stringify(sab.json.options[0].missing ?? sab.json.options[0])).toMatch(/peaje/i);

    // Origen personalizado con peajes indicados: completo y con sus km.
    const per = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { roads: { 'g-uno': 120 }, tollsByArea: { 'g-uno': 0 } });
    expect(per.json.options[0]).toMatchObject({ roadKm: 120 });
    expect(per.json.options[0].perPersonCents).not.toBeNull();
    expect(per.json.options[0].perPersonCents).toBeLessThan(base.json.options[0].perPersonCents);
    expect(per.json.transport).toMatchObject({ originId: 'personal', tolls: 'per_route', tollAreas: [{ areaId: 'g-uno', given: true }] });

    // Misma salida que el viaje: idéntico a la consulta normal.
    const same = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { originId: 'tarragona' });
    expect(same.json.options[0].perPersonCents).toBe(base.json.options[0].perPersonCents);
    expect((await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { originId: 'sabadell', roads: {} })).status).toBe(422);
  });

  it('peajes por recorrido: cada estación con los suyos y la que no tiene dato, pendiente', async () => {
    const u = await signup();
    const start = '2027-02-12', end = '2027-02-14';
    const t = await api(u.token, 'POST', '/api/trips', { name: 'Peajes', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'g-uno', cars: 1 });
    const tripId = t.json.trip.id;
    const cond = { modality: 'lodging', amountCents: 40000, forfaitIncluded: 'no', unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1 };
    // Precio de forfait propio en cada candidatura para que el único dato que distinga los destinos sea el peaje.
    // g-nuria no tiene acceso en coche: su candidatura indica también el precio del cremallera (si no, quedaría pendiente).
    for (const areaId of AREAS) await api(u.token, 'POST', `/api/trips/${tripId}/candidates`, { title: `Hotel ${areaId}`, areaId, forfaitCentsPerDay: 4000, rentalCentsPerDay: 0, parkingCentsPerCar: 0,
      ...(areaId === 'g-nuria' ? { railwayCentsPerPerson: 3100 } : {}), ...cond });
    const b0 = await api(u.token, 'GET', `/api/trips/${tripId}/budget`);
    await api(u.token, 'PUT', `/api/trips/${tripId}/budget`, { version: b0.json.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0,
      fuelCentsPerLitre: 160, litresPer100kmX10: 60, tollsCentsPerCar: 2000, parkingCentsPerCar: 0 });

    const roads = { 'g-uno': 100, 'g-dos': 100, 'g-nuria': 100 };
    const r = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { roads, tollsByArea: { 'g-uno': 1000, 'g-dos': 3000 } });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.options.map((o: any) => [o.areaId, o]));
    // Mismos km y mismo hotel: la diferencia por persona es exactamente la de los peajes (2.000 céntimos / 2 personas).
    expect(by['g-uno'].perPersonCents).not.toBeNull();
    expect(by['g-dos'].perPersonCents - by['g-uno'].perPersonCents).toBe(1000);
    // Sin peajes indicados para esta estación: pendiente, sin tomar los de otra ni los del viaje.
    expect(by['g-nuria'].perPersonCents).toBeNull();
    expect(JSON.stringify(by['g-nuria'].missing ?? by['g-nuria'])).toMatch(/peaje/i);
    expect(r.json.transport.tollAreas).toEqual(expect.arrayContaining([
      expect.objectContaining({ areaId: 'g-uno', given: true }), expect.objectContaining({ areaId: 'g-dos', given: true }), expect.objectContaining({ areaId: 'g-nuria', given: false }),
    ]));
    // Otra salida sin peajes: ninguno se traslada de la consulta anterior.
    const sab = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { originId: 'sabadell' });
    expect(sab.json.options.every((o: any) => o.perPersonCents == null)).toBe(true);
    // Un peaje de 0 € es un dato (no hay peajes), distinto de «sin dato».
    const zero = await api(u.token, 'POST', `/api/trips/${tripId}/cost-comparison`, { roads, tollsByArea: { 'g-nuria': 0 } });
    const z = Object.fromEntries(zero.json.options.map((o: any) => [o.areaId, o]));
    expect(z['g-nuria'].perPersonCents).not.toBeNull();
    expect(z['g-uno'].perPersonCents).toBeNull();
  });

  it('cremallera: sin precio ni constancia de que el paquete lo incluya, la opción queda pendiente; incluido, no se suma dos veces', async () => {
    const u = await signup();
    const start = '2027-02-19', end = '2027-02-21';
    const t = await api(u.token, 'POST', '/api/trips', { name: 'Núria', startDate: start, endDate: end, nights: 2, participantsPlanned: 2, skiDays: 2, rooms: 1, areaId: 'g-nuria', cars: 1 });
    const tripId = t.json.trip.id;
    const cond = { amountCents: 40000, unit: 'per_stay', priceKind: 'user_quote', checkIn: start, checkOut: end, adults: 2, childrenAges: [], rooms: 1, areaId: 'g-nuria' };
    const hotel = (await api(u.token, 'POST', `/api/trips/${tripId}/candidates`, { title: 'Hotel', modality: 'lodging', forfaitIncluded: 'no', ...cond })).json.id;
    const pack = (await api(u.token, 'POST', `/api/trips/${tripId}/candidates`, { title: 'Paquete', modality: 'lodging_forfait', forfaitIncluded: 'yes', forfaitDays: 2, railwayIncluded: 'yes', ...cond })).json.id;
    const b0 = await api(u.token, 'GET', `/api/trips/${tripId}/budget`);
    await api(u.token, 'PUT', `/api/trips/${tripId}/budget`, { version: b0.json.params.version, skiers: 2, renters: 0, forfaitCentsPerDay: 4000, groceriesCents: 0,
      fuelCentsPerLitre: 160, litresPer100kmX10: 60, tollsCentsPerCar: 0, parkingCentsPerCar: 0 });
    const opts = async () => Object.fromEntries((await api(u.token, 'GET', `/api/trips/${tripId}/cost-comparison`)).json.options.map((o: any) => [o.id, o]));
    let by = await opts();
    expect(by[hotel].perPersonCents).toBeNull();
    expect(JSON.stringify(by[hotel])).toMatch(/cremallera/i);
    // El paquete dice que su forfait incluye el cremallera y esquían los dos: completo, sin sumarlo.
    expect(by[pack].perPersonCents).not.toBeNull();
    // El presupuesto elegido (sin candidatura) también lo deja pendiente.
    const bud = await api(u.token, 'GET', `/api/trips/${tripId}/budget`);
    expect(bud.json.result.components.find((c: any) => c.key === 'railway')).toMatchObject({ status: 'pending' });
    expect(bud.json.result.complete).toBe(false);
    // Con el precio del cremallera para el viaje: el hotel suma 2 × 31 € y el paquete sigue sin sumarlo.
    const b1 = await api(u.token, 'GET', `/api/trips/${tripId}/budget`);
    expect((await api(u.token, 'PUT', `/api/trips/${tripId}/budget`, { version: b1.json.params.version, railwayCentsPerPerson: 3100 })).status).toBe(200);
    const before = by;
    by = await opts();
    expect(by[hotel].perPersonCents).not.toBeNull();
    expect(by[pack].perPersonCents).toBe(before[pack].perPersonCents);
  });
});
