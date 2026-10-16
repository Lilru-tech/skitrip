// Tiempos del proveedor desde un origen personalizado: se muestran tal cual. No se extrapola una duración desde las
// rutas de otros orígenes (Tarragona, Sabadell) ni se marca ningún tiempo como dudoso por compararlo con ellas. Para
// Port Ainé solo se añade la discrepancia observada el 16/10/2026 desde Reus, con su origen, fecha y valores.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OBSERVED_DISCREPANCIES } from '../../src/worker/routes/geo';
import { api, signup } from './helpers';

const realFetch = globalThis.fetch;
afterEach(() => vi.restoreAllMocks());

/** Geoapify simulado: cada destino con los km y minutos indicados por su latitud. */
function provider(byLat: Record<string, [number, number]>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'geo.mock') return realFetch(input, init);
    const body = JSON.parse(init.body);
    return Response.json({ sources_to_targets: [body.targets.map((t: any, i: number) => {
      const [km, min] = byLat[t.location[1].toFixed(2)];
      return { source_index: 0, target_index: i, distance: km * 1000, time: min * 60 };
    })] });
  });
}

beforeAll(async () => {
  const db = env.DB;
  const osrm = 'OSRM (OpenStreetMap), router.project-osrm.org';
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona', 'Tarragona', 41.1189, 1.2445), ('sabadell', 'Sabadell', 41.5463, 2.1086)`),
    db.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country, lat, lon) VALUES ('port-aine', 'Port Ainé', 'resort', 'ES', 42.43, 1.21), ('d-otra', 'Otra (prueba)', 'resort', 'ES', 42.61, 1.4)`),
    // Rutas guardadas desde otros orígenes, mucho más rápidas que lo que dará el proveedor simulado.
    db.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated) VALUES
      ('tarragona', 'port-aine', 'x', 216, 220, ?1, '2026-10-16', 0), ('sabadell', 'port-aine', 'x', 233, 212, ?1, '2026-10-01', 0),
      ('tarragona', 'd-otra', 'x', 200, 150, ?1, '2026-10-01', 0)`).bind(osrm),
  ]);
});

describe('tiempo del proveedor desde un origen personalizado', () => {
  it('Port Ainé: tiempo y distancia tal cual, con la discrepancia de Reus (origen, fecha y valores), sin duración extrapolada', async () => {
    provider({ '42.43': [210, 334], '42.61': [200, 400] });
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.155, lon: 1.107 });
    expect(r.status).toBe(200);
    const pa = r.json.routes.find((x: any) => x.areaId === 'port-aine');
    expect(pa).toMatchObject({ roadKm: 210, durationMin: 334 });
    expect(pa).not.toHaveProperty('durationDoubtful');
    expect(pa.notes).toContain(OBSERVED_DISCREPANCIES['port-aine']);
    // Ni la media de Tarragona (216 km en 220 min → unas 3 h 34 min para 210 km) ni la de Sabadell (unas 3 h 11 min).
    expect(pa.notes).not.toMatch(/3 h 11|3 h 34|dudoso|velocidad media/);
  });

  it('otra estación con un tiempo muy superior al de sus rutas de Tarragona no recibe ninguna marca ni referencia', async () => {
    provider({ '42.43': [210, 334], '42.61': [200, 400] });
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.155, lon: 1.107 });
    const other = r.json.routes.find((x: any) => x.areaId === 'd-otra');
    expect(other).toMatchObject({ roadKm: 200, durationMin: 400 });
    expect(other).not.toHaveProperty('durationDoubtful');
    expect(other.notes ?? '').not.toMatch(/OSRM|Tarragona|dudoso|discrepancia/i);
  });

  it('desde otro origen la nota sigue diciendo que se observó desde Reus y no adopta los valores de este cálculo', async () => {
    provider({ '42.43': [250, 300], '42.61': [180, 160] });
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.546, lon: 2.109 });
    const pa = r.json.routes.find((x: any) => x.areaId === 'port-aine');
    expect(pa).toMatchObject({ roadKm: 250, durationMin: 300 });
    expect(pa.notes).toContain('desde la plaza del Mercadal de Reus');
    expect(pa.notes).toContain('no verifica el tiempo desde otros orígenes');
    expect(pa.notes).not.toMatch(/250 km|5 h 00/);
  });

  it('la nota guarda los valores reales del 16/10/2026: Geoapify 210 km / 334 min y OSRM 212 km / 222 min, sin afirmar la causa', () => {
    const n = OBSERVED_DISCREPANCIES['port-aine'];
    expect(n).toContain('16/10/2026');
    expect(n).toContain('Geoapify dio 210 km y 5 h 34 min');
    expect(n).toContain('OSRM, 212 km y 3 h 42 min');
    expect(n).toContain('La causa no está confirmada');
    expect(n).not.toMatch(/mismo recorrido|equivocad|error de Geoapify/i);
    expect(Object.keys(OBSERVED_DISCREPANCIES)).toEqual(['port-aine']);
  });
});
