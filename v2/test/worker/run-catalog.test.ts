// Pistas y variedad en la API: el catálogo de pistas (area_runs, migración 0020) y el desglose por colores del parte
// llegan separados al catálogo público y a la ficha; un dominio trae las cifras de sus estaciones sin sumarlas.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { seedCatalog } from './helpers';

const runCatalog = (catalog as any).run_catalog as any[];
const get = async (path: string) => (await SELF.fetch(`http://localhost${path}`)).json<any>();
const ingestSnow = async (observations: unknown[]) => {
  const t = Date.now();
  const r = await SELF.fetch('http://localhost/api/ingest/snow', { method: 'POST', headers: { Authorization: 'Bearer test-ingest-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: { id: `runs-${t}-${Math.random()}`, pipeline: 'snow', startedAt: t - 1000, finishedAt: t, expected: 1, ok: 1, failed: 0, unsupported: 0 }, observations, health: [] }) });
  return { status: r.status, json: await r.json<any>() };
};

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.batch([
    ...(catalog as any).links.map((l: any) => env.DB.prepare('INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (?1, ?2, ?3)').bind(l.parent, l.child, l.relation)),
    ...runCatalog.map((r) => env.DB.prepare(`INSERT INTO area_runs (area_id, total, green, blue, red, black, basis, comparable, season, source_date, checked_on, source_url, map_url, limitations)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`).bind(r.area, r.total, r.green, r.blue, r.red, r.black, r.basis, r.comparable ? 1 : 0, r.season, r.source_date,
      r.checked_on, r.source_url, r.map_url, r.limitations)),
  ]);
});

describe('catálogo de pistas en la API', () => {
  it('cada área trae su catálogo de pistas con procedencia; un dato ausente llega como null, no como 0', async () => {
    const c = await get('/api/public/catalog');
    const by = new Map(c.areas.map((a: any) => [a.id, a]));
    expect((by.get('grandvalira') as any).runs).toMatchObject({ total: 142, green: 23, blue: 53, red: 46, black: 20, basis: 'aggregate', comparable: true, sourceDate: '2026-09-30', checkedOn: '2026-10-19' });
    expect((by.get('astun') as any).runs).toMatchObject({ total: 57, basis: 'individual' });
    expect((by.get('baqueira-beret') as any).runs).toMatchObject({ total: null, green: null, comparable: false });
    expect((by.get('astun-candanchu') as any).runs).toMatchObject({ total: 110, comparable: false });
  });

  it('la ficha de un dominio trae su cifra y las de sus estaciones por separado', async () => {
    const d = await get('/api/public/areas/alp-2500');
    expect(d.runs).toMatchObject({ total: 131 });
    expect(d.memberRuns.map((m: any) => [m.areaId, m.total]).sort()).toEqual([['la-molina', 66], ['masella', null]]);
  });

  it('el parte guarda abiertas y totales por color tal como los publica la fuente, y sin ellos quedan null', async () => {
    const now = Date.now();
    const base = { sourceId: 'grandvalira-official', areaId: 'grandvalira', sourceDate: null, opStatus: 'partial', openKm: 35, totalKm: 215, extractor: 'test@1' };
    const r = await ingestSnow([
      { ...base, observedAt: now - 2000, openRuns: 40, totalRuns: 142, openRunsByColour: { green: 10, blue: 20, red: 8, black: 2 }, totalRunsByColour: { green: 23, blue: 53, red: 46, black: 20 } },
      { ...base, sourceId: 'esquiades-status-grandvalira', observedAt: now - 1000, openRuns: 41, totalRuns: 142 },
    ]);
    expect(r.status).toBe(200);
    expect(r.json.accepted).toBe(2);
    const rows = (await env.DB.prepare('SELECT source_id, open_runs_by_colour, total_runs_by_colour FROM snow_observations WHERE area_id = ?1 ORDER BY observed_at').bind('grandvalira').all<any>()).results;
    expect(rows.map((x) => [x.source_id, x.open_runs_by_colour && JSON.parse(x.open_runs_by_colour), x.total_runs_by_colour && JSON.parse(x.total_runs_by_colour)])).toEqual([
      ['grandvalira-official', { green: 10, blue: 20, red: 8, black: 2 }, { green: 23, blue: 53, red: 46, black: 20 }],
      ['esquiades-status-grandvalira', null, null],
    ]);
    const d = await get('/api/public/areas/grandvalira');
    expect(d.snow.at(-2)).toMatchObject({ openRuns: 40, openRunsByColour: { green: 10, blue: 20, red: 8, black: 2 } });
    expect(d.snow.at(-1)).toMatchObject({ openRuns: 41, openRunsByColour: null });
  });

  it('rechaza un desglose por colores con cifras no enteras o negativas', async () => {
    const r = await ingestSnow([{ sourceId: 'grandvalira-official', areaId: 'grandvalira', observedAt: Date.now(), opStatus: 'partial', openKm: 1, totalKm: 215, extractor: 't@1',
      openRunsByColour: { green: -1, blue: 0, red: 0, black: 0 } }]);
    expect(r.status).toBe(422);
  });
});
