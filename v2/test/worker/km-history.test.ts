// Comparador de km entre temporadas en la API: parte de v2 frente a SkiTrip antiguo, preferencia de fuente, «Sin dato»,
// validación de fechas y número de sentencias.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { api, seedCatalog } from './helpers';

const cat = catalog as any;
const km = async (id: string, q: string) => api(null, 'GET', `/api/public/areas/${id}/km-history?${q}`);
const season = (r: any, s: string) => r.seasons.find((x: any) => x.season === s);

beforeAll(async () => {
  await seedCatalog(env.DB, cat);
  const ins = (id: string, src: string, date: string, op: string, open: number | null, quality = 'ok', at = 1) =>
    env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, source_date, op_status, open_km, total_km, quality, content_hash, extractor)
      VALUES (?1, 'grandvalira', ?2, ?3, ?4, ?5, ?6, 215, ?7, ?1, 'test')`).bind(id, src, at, date, op, open, quality);
  await env.DB.batch([
    // Prioridades del catálogo (seedCatalog no las copia): oficial 10, Esquiades 50.
    env.DB.prepare(`UPDATE sources SET priority = CASE id WHEN 'grandvalira-official' THEN 10 ELSE 50 END WHERE area_id = 'grandvalira'`),
    env.DB.prepare(`INSERT INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('f-km','open_km_history','x.json','sha-km',1,1,0)`),
    ...[['2025-12-30', 190], ['2025-12-31', 0], ['2026-01-01', 180], ['2024-12-30', 150]].map(([d, k], i) =>
      env.DB.prepare(`INSERT INTO legacy_snow_observations (file_id, legacy_resort_id, obs_date, open_km, total_km, scope_area_id) VALUES ('f-km', 'grandvalira', ?1, ?2, 215, 'grandvalira')`).bind(d, k)),
    // 01/01: el parte oficial (prioridad 10) prevalece sobre Esquiades (50) y sobre el dato antiguo.
    ins('k1', 'grandvalira-official', '2026-01-01', 'open', 199),
    ins('k2', 'esquiades-status-grandvalira', '2026-01-01', 'open', 150, 'ok', 5),
    // 02/01: solo un parte dudoso → sin dato.
    ins('k3', 'grandvalira-official', '2026-01-02', 'open', 120, 'suspicious'),
  ]);
});

describe('GET /api/public/areas/:id/km-history', () => {
  it('compara las mismas fechas en cada temporada con su procedencia', async () => {
    const r = await km('grandvalira', 'desde=12-30&hasta=01-02');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ areaId: 'grandvalira', from: '12-30', to: '01-02', firstDataDate: '2024-12-30' });
    const s = season(r.json, '2025-26');
    expect(s.dates.map((d: any) => [d.date, d.status, d.openKm, d.origin, d.provider])).toEqual([
      ['2025-12-30', 'value', 190, 'antiguo', null],
      ['2025-12-31', 'legacy_zero', null, 'antiguo', null],
      ['2026-01-01', 'value', 199, 'parte', 'official'],
      ['2026-01-02', 'none', null, null, null],
    ]);
    expect(s.summary).toMatchObject({ days: 4, withData: 2, doubtfulZeros: 1, mean: 194.5, usesLegacy: true });
    expect(season(r.json, '2024-25').summary).toMatchObject({ withData: 1, mean: 150 });
  });
  it('un solo día (sin «hasta»)', async () => {
    const r = await km('grandvalira', 'desde=01-01');
    expect(season(r.json, '2025-26').dates).toHaveLength(1);
  });
  it('estación sin ningún dato: lista vacía', async () => {
    const r = await km('javalambre', 'desde=01-01&hasta=01-03');
    expect(r.status).toBe(200);
    expect(r.json.seasons).toEqual([]);
  });
  it('fechas inválidas → 422; estación inexistente → 404', async () => {
    expect((await km('grandvalira', 'desde=02-30')).status).toBe(422);
    expect((await km('grandvalira', 'desde=03-10&hasta=02-01')).status).toBe(422);
    expect((await km('grandvalira', 'desde=01-01&hasta=02-15')).status).toBe(422);
    expect((await km('grandvalira', '')).status).toBe(422);
    expect((await km('no-existe', 'desde=01-01')).status).toBe(404);
  });
});

describe('copias archivadas (POST /api/ingest/km-archive)', () => {
  const INGEST = 'test-ingest-token';
  const row = (o: Record<string, unknown> = {}) => ({
    areaId: 'grandvalira', obsDate: '2016-01-10', dateBasis: 'copy', opStatus: 'open', openKm: 148, totalKm: 210, provider: 'esquiades',
    originalUrl: 'https://www.esquiades.com/informacion-interes/estado-pistas/',
    archiveUrl: 'https://web.archive.org/web/20160110120000/https://www.esquiades.com/informacion-interes/estado-pistas/',
    capturedAt: Date.UTC(2016, 0, 10, 12), extractor: 'esquiades-status@test+wayback', ...o,
  });
  it('sin la credencial de ingesta: 401; datos incoherentes: 422', async () => {
    expect((await api(null, 'POST', '/api/ingest/km-archive', { rows: [row()] })).status).toBe(401);
    expect((await api(INGEST, 'POST', '/api/ingest/km-archive', { rows: [row({ openKm: 300 })] })).status).toBe(422);
    expect((await api(INGEST, 'POST', '/api/ingest/km-archive', { rows: [row({ openKm: null })] })).status).toBe(422);
    expect((await api(INGEST, 'POST', '/api/ingest/km-archive', { rows: [row({ archiveUrl: 'https://example.com/x' })] })).status).toBe(422);
  });
  it('guarda (sin duplicar al repetir; ignora áreas desconocidas) y el comparador lo muestra con su enlace', async () => {
    const body = { rows: [row(), row({ areaId: 'no-existe' })] };
    expect((await api(INGEST, 'POST', '/api/ingest/km-archive', body)).json).toMatchObject({ written: 1, received: 2 });
    expect((await api(INGEST, 'POST', '/api/ingest/km-archive', body)).json).toMatchObject({ written: 0 });
    const r = (await km('grandvalira', 'desde=01-10')).json;
    expect(r.firstDataDate).toBe('2016-01-10');
    const s = season(r, '2015-16');
    expect(s.dates[0]).toMatchObject({ status: 'value', openKm: 148, totalKm: 210, origin: 'archivo', dateBasis: 'copy', archiveUrl: row().archiveUrl });
    expect(s.summary).toMatchObject({ withData: 1, usesArchive: true });
    expect(season(r, '2016-17').summary.withData).toBe(0);
  });
});
