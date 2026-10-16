// Tiempo del proveedor contrastado con otra fuente: la ruta OSRM guardada de la estación. Caso real: desde la plaza
// del Mercadal de Reus, Geoapify dio 210 km y 334 min hasta Port Ainé (ejecución 38886245758 del 16/10/2026), cuando
// OSRM da 212 km y 222 min hasta el mismo punto. No se corrige el tiempo: se marca como dudoso y se explica.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import catalog from '../../data/catalog.json';
import { durationDoubt } from '../../src/worker/routes/geo';
import { api, signup } from './helpers';

// Distancias y tiempos reales desde Reus (registro de la ejecución 38886245758), estación → [km, min].
const REUS: Record<string, [number, number]> = {
  'alp-2500': [220, 140], astun: [302, 186], 'ax-3-domaines': [282, 198], 'baqueira-beret': [271, 188], 'boi-taull': [249, 183],
  candanchu: [299, 181], cerler: [245, 181], 'espot-esqui': [225, 185], 'font-romeu-pyrenees-2000': [239, 155], 'formigal-panticosa': [290, 186],
  grandvalira: [195, 188], javalambre: [324, 193], 'les-angles': [257, 173], 'ordino-arcalis': [211, 205], 'pal-arinsal': [206, 199],
  'port-aine': [210, 334], 'port-del-comte': [153, 122], valdelinares: [247, 189], 'vall-de-nuria': [224, 144],
};
/** min/km de la ruta OSRM más rápida del catálogo para la estación (lo mismo que calcula la consulta del Worker). */
const refOf = (area: string) => {
  const r = (catalog as any).routes.filter((x: any) => x.area === area && String(x.source).startsWith('OSRM') && x.duration_min > 0 && x.road_km >= 50);
  return r.length ? Math.min(...r.map((x: any) => x.duration_min / x.road_km)) : null;
};

describe('tiempo dudoso del proveedor', () => {
  it('con los datos reales desde Reus solo Port Ainé queda marcado (el resto de estaciones no)', () => {
    const doubtful = Object.entries(REUS).filter(([id, [km, min]]) => durationDoubt(km, min, refOf(id))).map(([id]) => id);
    expect(doubtful).toEqual(['port-aine']);
    expect(durationDoubt(210, 334, refOf('port-aine'))).toEqual({ referenceMin: 191 });
  });
  it('sin referencia, con pocos km o con un tiempo coherente no dice nada', () => {
    expect(durationDoubt(210, 334, null)).toBeNull();
    expect(durationDoubt(40, 120, 1)).toBeNull();
    expect(durationDoubt(210, 280, 1)).toBeNull();
    expect(durationDoubt(210, 300, 1)).toEqual({ referenceMin: 210 });
    expect(durationDoubt(null, 300, 1)).toBeNull();
  });
});

const realFetch = globalThis.fetch;
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  const db = env.DB;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona', 'Tarragona', 41.1189, 1.2445), ('sabadell', 'Sabadell', 41.5463, 2.1086)`),
    db.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country, lat, lon) VALUES ('d-lenta', 'Lenta (prueba)', 'resort', 'ES', 42.43, 1.21), ('d-normal', 'Normal (prueba)', 'resort', 'ES', 42.6, 1.4)`),
    db.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated) VALUES
      ('tarragona', 'd-lenta', 'x', 216, 220, 'OSRM (OpenStreetMap), router.project-osrm.org', '2026-10-16', 0),
      ('sabadell', 'd-lenta', 'x', 233, 212, 'OSRM (OpenStreetMap), router.project-osrm.org', '2026-10-01', 0),
      ('tarragona', 'd-normal', 'x', 200, 190, 'OSRM (OpenStreetMap), router.project-osrm.org', '2026-10-01', 0)`),
  ]);
});

describe('POST /api/geo/routes marca el tiempo dudoso', () => {
  it('Port Ainé simulado (210 km, 334 min): tiempo tal cual, marcado y explicado; la otra estación, sin marca', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'geo.mock') return realFetch(input, init);
      const body = JSON.parse(init.body);
      return Response.json({ sources_to_targets: [body.targets.map((t: any, i: number) => {
        const slow = Math.abs(t.location[1] - 42.43) < 0.001;
        return { source_index: 0, target_index: i, distance: slow ? 210_000 : 205_000, time: slow ? 334 * 60 : 195 * 60 };
      })] });
    });
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.155, lon: 1.107 });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.areaId, x]));
    expect(by['d-lenta']).toMatchObject({ roadKm: 210, durationMin: 334, durationDoubtful: true });
    expect(by['d-lenta'].notes).toContain('Tiempo dudoso: el proveedor da 5 h 34 min para 210 km');
    expect(by['d-lenta'].notes).toContain('serían unas 3 h 11 min');
    expect(by['d-lenta'].notes).toContain('sin corregir');
    expect(by['d-normal']).toMatchObject({ roadKm: 205, durationMin: 195, durationDoubtful: false });
    expect(by['d-normal'].notes ?? '').not.toContain('Tiempo dudoso');
  });
});
