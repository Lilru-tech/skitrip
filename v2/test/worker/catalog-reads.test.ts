// Lecturas de D1 del catálogo público y de la ficha de estación con volúmenes de producción (5 394 registros legacy de
// nieve) y de final de temporada (dos capturas al día durante 150 días). Las consultas nuevas devuelven lo mismo que
// las anteriores (que recorrían toda la tabla en cada carga) y sus filas leídas no crecen con el histórico.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { seedCatalog } from './helpers';

const snowSources = (catalog as any).sources.filter((s: any) => s.kind === 'snow');
const areas = (catalog as any).areas.map((a: any) => a.id) as string[];
const HALF_DAY = 432e5;
let captures = 0;

/** `n` capturas más de todas las fuentes de nieve, cada 12 h y con fecha de parte. */
async function seedSnow(n: number) {
  const t0 = Date.parse('2026-10-15T06:00:00Z') - 400 * HALF_DAY;
  const stmts: D1PreparedStatement[] = [];
  for (let k = captures; k < captures + n; k++) for (const [i, s] of snowSources.entries()) {
    const t = t0 + k * HALF_DAY;
    stmts.push(env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, source_date, op_status, open_km, total_km, quality, content_hash, extractor)
      VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, 100, 'ok', ?7, 'test@1')`).bind(`o-${s.id}-${k}`, s.scope, s.id, t, new Date(t).toISOString().slice(0, 10), (k + i) % 90, `h${k}`));
  }
  captures += n;
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
}

const get = async (path: string) => {
  const r = await SELF.fetch(`http://localhost${path}`);
  return { status: r.status, json: await r.json<any>(), rows: Number(r.headers.get('X-D1-Rows-Read')) };
};

// Las consultas que había antes (recorrían snow_observations y legacy_snow_observations enteras), como referencia.
const OLD_SNOW = `SELECT * FROM (SELECT s.*, src.priority, ROW_NUMBER() OVER (PARTITION BY s.area_id, s.source_id ORDER BY s.observed_at DESC, s.id) AS rn
  FROM snow_observations s JOIN sources src ON src.id = s.source_id) WHERE rn = 1`;
const OLD_LEGACY = `SELECT l.scope_area_id AS area_id, l.obs_date, l.open_km, l.total_km, l.anomalies FROM legacy_snow_observations l
  JOIN (SELECT scope_area_id, MAX(obs_date) AS m FROM legacy_snow_observations WHERE scope_area_id IS NOT NULL GROUP BY scope_area_id) x
    ON x.scope_area_id = l.scope_area_id AND x.m = l.obs_date GROUP BY l.scope_area_id`;

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.prepare(`INSERT INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('f-snow','open_km_history','x.json','sha-snow',1,1,0)`).run();
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < 5394; i++) {
    const area = areas[i % 19];
    stmts.push(env.DB.prepare(`INSERT INTO legacy_snow_observations (file_id, legacy_resort_id, obs_date, open_km, total_km, scope_area_id) VALUES ('f-snow', ?1, ?2, ?3, 50, ?4)`)
      .bind(`legacy-${area}`, new Date(Date.UTC(2010, 0, 1) + Math.floor(i / 19) * 864e5).toISOString().slice(0, 10), i % 40, area));
  }
  for (let i = 0; i < 4480; i++) {
    const area = areas[i % 19];
    stmts.push(env.DB.prepare(`INSERT INTO legacy_hotel_observations (file_id, obs_date, ts, legacy_resort_id, provider, sample_count, samples_json, scope_area_id) VALUES ('f-snow', ?1, ?2, ?3, 'booking', 1, '[]', ?4)`)
      .bind(new Date(Date.UTC(2020, 0, 1) + i * 36e5).toISOString().slice(0, 10), new Date(Date.UTC(2020, 0, 1) + i * 36e5).toISOString(), `legacy-${area}`, area));
  }
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  await seedSnow(20);
});

describe('catálogo público: filas leídas de D1', () => {
  it('con los volúmenes de hoy lee unos cientos de filas (antes, ~30 000) y devuelve lo mismo que las consultas anteriores', async () => {
    const r = await get('/api/public/catalog');
    expect(r.status).toBe(200);
    expect(r.rows).toBeLessThan(600);
    const old = await env.DB.batch([env.DB.prepare(OLD_SNOW), env.DB.prepare(OLD_LEGACY)]);
    // Aun con el índice nuevo, las consultas anteriores recorren la tabla legacy entera.
    expect(old[0].meta.rows_read + old[1].meta.rows_read).toBeGreaterThan(5394);
    // Misma observación elegida por área y misma serie legacy que con las consultas anteriores.
    const oldSnow = old[0].results as any[];
    for (const a of r.json.areas.filter((x: any) => x.snow)) {
      const latest = oldSnow.filter((o) => o.area_id === a.id).map((o) => o.source_id).sort();
      expect(a.snow.sources).toBe(latest.length);
      expect(latest).toContain(a.snow.sourceId);
    }
    expect(r.json.areas.filter((x: any) => x.snow).length).toBe(new Set(oldSnow.map((o) => o.area_id)).size);
    const oldLegacy = new Map((old[1].results as any[]).map((l) => [l.area_id, l]));
    const withLegacy = r.json.areas.filter((x: any) => x.legacySnow);
    expect(withLegacy.length).toBe(oldLegacy.size);
    for (const a of withLegacy) expect([a.legacySnow.date, a.legacySnow.openKm]).toEqual([oldLegacy.get(a.id).obs_date, oldLegacy.get(a.id).open_km]);
  });

  it('la última captura de cada fuente sigue siendo la que se muestra (también con empate de hora: gana el id menor)', async () => {
    await seedSnow(1);
    const s = snowSources[0];
    const t = Date.parse('2026-10-15T06:00:00Z') + 3600_000;
    await env.DB.batch(['b', 'a'].map((x) => env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, op_status, open_km, total_km, quality, content_hash, extractor)
      VALUES (?1, ?2, ?3, ?4, 'open', 77, 100, 'ok', ?5, 'test@1')`).bind(`tie-${x}`, s.scope, s.id, t, `tie-${x}`)));
    const area = (await get('/api/public/catalog')).json.areas.find((a: any) => a.id === s.scope);
    const old = (await env.DB.prepare(OLD_SNOW).all<any>()).results.find((o) => o.source_id === s.id);
    expect(old.id).toBe('tie-a');
    expect(area.snow.sources).toBeGreaterThan(0);
    if (area.snow.sourceId === s.id) expect(area.snow.openKm).toBe(77);
  });

  it('al final de temporada (300 capturas por fuente) las filas leídas no crecen con el histórico', async () => {
    const before = (await get('/api/public/catalog')).rows;
    await seedSnow(279);
    expect(captures).toBe(300);
    const after = await get('/api/public/catalog');
    expect(after.rows).toBeLessThan(600);
    expect(after.rows - before).toBeLessThan(100);
  });

  it('ficha de estación: las series legacy de nieve y de hotel se leen por índice (antes, las dos tablas enteras)', async () => {
    const r = await get(`/api/public/areas/${areas[0]}`);
    expect(r.status).toBe(200);
    expect(r.rows).toBeLessThan(1_000);
    expect(r.json.legacy.hotel).toHaveLength(120);
    expect(r.json.legacy.hotel[0].obs_date >= r.json.legacy.hotel[119].obs_date).toBe(true);
    expect(r.json.legacy.snow).toHaveLength(120);
    expect(r.json.legacy.snow[0].obs_date > r.json.legacy.snow[119].obs_date).toBe(true);
  });

  it('escenarios de un viaje: las observaciones se buscan por escenario con índice, no recorriendo todas', async () => {
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN SELECT ob.amount_cents FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id
      WHERE ob.scenario_id IN (SELECT value FROM json_each(?1)) AND ob.observed_at >= ?2 ORDER BY ob.observed_at LIMIT 5000`).bind('["s1"]', 0).all<any>()).results.map((r) => r.detail).join(' | ');
    expect(plan).toContain('USING INDEX offer_obs_scenario');
  });
});
