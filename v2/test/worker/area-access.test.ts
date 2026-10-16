// Puntos de llegada en coche de las estaciones comparadas (migración 0017) con el catálogo real: todas las estaciones
// con ruta tienen su punto con fuente y fecha; las de una sola fuente o aproximadas lo dicen; ninguna se presenta
// como acceso confirmado sin estarlo; y Vall de Núria explica el tramo en cremallera que la ruta no incluye.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import catalog from '../../data/catalog.json';
import migration from '../../migrations/0017_custom_origin.sql?raw';
import { api, seedCatalog, signup } from './helpers';

const routed = [...new Set((catalog as any).routes.map((r: any) => r.area))] as string[];
const inserts = migration.split(/;\n/).map((s) => s.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim()).filter((s) => s.startsWith('INSERT OR IGNORE INTO area_access'));
const realFetch = globalThis.fetch;
afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  // La migración ya se aplicó sin el catálogo real (no insertó nada): se repiten sus filas ahora que existe.
  for (const sql of inserts) await env.DB.prepare(sql).run();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona', 'Tarragona', 41.1189, 1.2445)`),
    ...routed.map((id) => env.DB.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated) VALUES ('tarragona', ?1, 'x', 200, 180, 'manual', '2026-10-01', 0)`).bind(id)),
  ]);
});

describe('accesos de las estaciones comparadas', () => {
  it('cada estación con ruta tiene un punto de llegada con fuente, fecha y grado de confirmación', async () => {
    expect(inserts.length).toBe(routed.length);
    const { results } = await env.DB.prepare('SELECT * FROM area_access').all<any>();
    const by = new Map(results.map((r) => [r.area_id, r]));
    for (const id of routed) {
      const a = by.get(id);
      expect(a, id).toBeTruthy();
      expect(a.source, id).toMatch(/^https:\/\//);
      expect(a.checked_on, id).toBe('2026-10-16');
      expect(['contrasted', 'single_source', 'approximate'], id).toContain(a.confidence);
      // Las de varias fuentes citan al menos dos páginas; ninguna «contrastada» se apoya en una sola.
      if (a.confidence === 'contrasted') expect(a.source.split(' · ').length, id).toBeGreaterThanOrEqual(2);
      // El punto está cerca (menos de ~10 km) de la estación o de alguna estación miembro del dominio en el catálogo.
      // (El punto central del dominio Formigal-Panticosa en el catálogo está desplazado unos 30 km: no sirve de destino.)
      const near = [id, ...(catalog as any).links.filter((l: any) => l.parent === id).map((l: any) => l.child)]
        .map((x) => (catalog as any).areas.find((y: any) => y.id === x))
        .map((p: any) => Math.hypot(a.lat - p.lat, (a.lon - p.lon) * Math.cos((a.lat * Math.PI) / 180)) * 111);
      expect(Math.min(...near), id).toBeLessThan(10);
    }
    expect(by.get('vall-de-nuria')).toMatchObject({ mode: 'rack_railway', confidence: 'contrasted' });
    expect(by.get('vall-de-nuria').note).toMatch(/No incluye la subida en cremallera de Queralbs a Núria/);
    expect(by.get('port-aine')).toMatchObject({ confidence: 'approximate' });
    expect(by.get('port-aine').note).toMatch(/Rabasta/);
  });

  it('las rutas dicen qué punto es de una sola fuente o aproximado, y explican el cremallera', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'geo.mock') return realFetch(input, init);
      const body = JSON.parse(init.body);
      return Response.json({ sources_to_targets: [body.targets.map((_: unknown, i: number) => ({ source_index: 0, target_index: i, distance: 150_000, time: 7200 }))] });
    });
    const u = await signup();
    const r = await api(u.token, 'POST', '/api/geo/routes', { lat: 41.155, lon: 1.107 });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.areaId, x]));
    for (const id of routed) expect(by[id]?.access?.confidence, id).not.toBe('catalog_center');
    expect(by['pal-arinsal']).toMatchObject({ accessName: 'Pal, aparcamiento de La Caubella', access: { confidence: 'contrasted' } });
    expect(by['pal-arinsal'].notes ?? '').not.toMatch(/sin contrastar|aproximado/);
    expect(by['grandvalira'].notes).toContain('una sola fuente pública, sin contrastar');
    expect(by['port-aine'].notes).toContain('aproximado, sin confirmar');
    expect(by['vall-de-nuria']).toMatchObject({ lastLeg: 'rack_railway' });
    expect(by['vall-de-nuria'].notes).toContain('No incluye la subida en cremallera');
  });
});
