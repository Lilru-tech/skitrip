// Clima habitual: ingesta de temporadas (credencial de ingesta, validación, reenvío idempotente) y resumen ±7 días
// en la API pública leyendo solo lo guardado. Datos sintéticos; sin red.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { CLIMATE_SEASONS, climateSummary, climateWindows, seasonLength, seasonStart, type ClimateSeries } from '../../src/core/climate';
import { addDays } from '../../src/core/dates';
import { seedCatalog } from './helpers';

const TOKEN = 'test-ingest-token';
const row = (areaId: string, season: number, snowOn?: string) => {
  const n = seasonLength(season);
  const start = seasonStart(season);
  const col = (v: number) => Array.from({ length: n }, () => v);
  return {
    areaId, season, requestedElevation: 2077, cell: { lat: 42.3, lon: 1.9, elevation: 2050 },
    series: { start, tmax: col(3), tmin: col(-6), precip: col(0), rain: col(0), gust: col(30), snow: Array.from({ length: n }, (_, i) => (snowOn && addDays(start, i).endsWith(snowOn) ? 8 : 0)) },
  };
};
const ingest = (rows: unknown[], token = TOKEN) => SELF.fetch('http://localhost/api/ingest/climate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
const get = async (path: string) => { const r = await SELF.fetch(`http://localhost${path}`); return { status: r.status, json: await r.json<any>() }; };

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.batch((catalog as any).links.map((l: any) => env.DB.prepare('INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (?1, ?2, ?3)').bind(l.parent, l.child, l.relation)));
});
beforeEach(async () => { await env.DB.prepare('DELETE FROM climate_seasons').run(); });

describe('ingesta del clima', () => {
  it('pide la credencial de ingesta y valida la temporada completa', async () => {
    expect((await ingest([row('la-molina', 2010)], 'otra-credencial-cualquiera')).status).toBe(401);
    const bad = row('la-molina', 2010);
    bad.series.tmax = bad.series.tmax.slice(1);
    expect((await ingest([bad])).status).toBe(422);
    expect((await ingest([row('la-molina', 1990)])).status).toBe(422);
  });
  it('guarda, reenviar sustituye sin duplicar y el estado lista lo guardado; un área inexistente no se guarda', async () => {
    const r1 = await (await ingest([row('la-molina', 2010), row('no-existe', 2010)])).json<any>();
    expect(r1).toEqual({ written: 1, received: 2 });
    await ingest([row('la-molina', 2010)]);
    const st = await (await SELF.fetch('http://localhost/api/ingest/climate-status', { headers: { Authorization: `Bearer ${TOKEN}` } })).json<any>();
    expect(st.seasons).toEqual([{ areaId: 'la-molina', season: 2010, requestedElevation: 2077 }]);
  });
});

describe('clima habitual en la ficha', () => {
  it('resume ±7 días de los 30 años con lo guardado, con fuente y altitud', async () => {
    for (let i = 0; i < CLIMATE_SEASONS.length; i += 12) await ingest(CLIMATE_SEASONS.slice(i, i + 12).map((y) => row('la-molina', y, '01-15')));
    const r = await get('/api/public/areas/la-molina/climate?desde=2027-01-15&hasta=2027-01-15');
    expect(r.status).toBe(200);
    expect(r.json.state).toBe('ok');
    expect(r.json.source).toMatch(/Histórico reconstruido.*ERA5.*Open-Meteo/);
    const p = r.json.points[0];
    expect(p).toMatchObject({ areaId: 'la-molina', seasonsStored: 30, seasonsNeeded: 30, cell: { elevation: 2050, requestedElevation: 2077 } });
    expect(p.summary).toMatchObject({ years: 30, expectedYears: 30, windowDays: 15, tmax: { median: 3 }, snowDays: { days: 30, of: 450 } });
  });
  it('el recorte en D1 da lo mismo que resumir las temporadas enteras (bisiestos, 29/02, huecos)', async () => {
    const vary = (y: number): ClimateSeries => {
      const n = seasonLength(y);
      const v = (k: number) => Array.from({ length: n }, (_, i) => ((i * 7 + y * 3 + k) % 11 === 0 ? null : Math.round((((i * 13 + y + k) % 37) - 12) * 10) / 10));
      return { start: seasonStart(y), tmax: v(1), tmin: v(2), precip: v(3).map((x) => (x == null ? null : Math.abs(x) / 4)), rain: v(4), snow: v(5).map((x) => (x == null ? null : Math.abs(x) / 3)), gust: v(6).map((x) => (x == null ? null : 40 + Math.abs(x))) };
    };
    const all = new Map(CLIMATE_SEASONS.map((y) => [y, vary(y)]));
    for (let i = 0; i < CLIMATE_SEASONS.length; i += 12) await ingest(CLIMATE_SEASONS.slice(i, i + 12).map((y) => ({ ...row('masella', y), series: all.get(y)! })));
    for (const [a, b] of [['2028-02-29', '2028-03-02'], ['2027-12-28', '2028-01-03'], ['2027-11-02', '2027-11-02']]) {
      const w = climateWindows(a, b);
      if (!w.ok) throw new Error(a);
      const r = await get(`/api/public/areas/masella/climate?desde=${a}&hasta=${b}`);
      expect(r.json.points[0].summary).toEqual(climateSummary(w.windows, all));
    }
  });
  it('sin temporadas guardadas: sin resumen (no ceros); fuera de temporada: se dice', async () => {
    const none = await get('/api/public/areas/cerler/climate?desde=2027-02-01');
    expect(none.json.points[0]).toMatchObject({ seasonsStored: 0, summary: null });
    const out = await get('/api/public/areas/cerler/climate?desde=2027-07-01');
    expect(out.json).toMatchObject({ state: 'out_of_season' });
    expect(out.json.points[0].summary).toBeNull();
  });
  it('dominio: un resumen por estación, sin mezclar', async () => {
    await ingest([row('formigal', 2010), row('panticosa', 2010)]);
    const r = await get('/api/public/areas/formigal-panticosa/climate?desde=2011-01-10');
    expect(r.json.points.map((p: any) => [p.areaId, p.seasonsStored, p.summary.years])).toEqual([['formigal', 1, 1], ['panticosa', 1, 1]]);
  });
});
