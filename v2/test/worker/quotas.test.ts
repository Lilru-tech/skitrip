// Presupuesto de consultas D1 con volúmenes reales del catálogo (data/catalog.json).
// D1 Free: 50 consultas por invocación, contando cada sentencia de un batch. El Worker corta a 40 (QUERY_BUDGET).
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { api, seedCatalog, signup } from './helpers';

const INGEST = 'test-ingest-token';
const ingest = async (path: string, body: unknown) => {
  const r = await SELF.fetch(`http://localhost/api/ingest/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${INGEST}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json<any>(), d1: Number(r.headers.get('X-D1-Statements')) };
};
const snowSources = (catalog as any).sources.filter((s: any) => s.kind === 'snow');
const offerSources = (catalog as any).sources.filter((s: any) => s.kind === 'offers');

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.prepare(`INSERT OR IGNORE INTO providers (id, name, enabled) VALUES ('esquiades','Esquiades',0), ('estiber','Estiber',0)`).run();
});

const run = (id: string, pipeline: string, over: Record<string, unknown> = {}) =>
  ({ id, pipeline, startedAt: Date.now() - 5000, finishedAt: Date.now(), expected: snowSources.length, ok: snowSources.length, failed: 0, unsupported: 0, ...over });

describe('ingesta de nieve con el catálogo completo', () => {
  const obs = (t: number) => snowSources.map((s: any, i: number) => ({ sourceId: s.id, areaId: s.scope, observedAt: t, opStatus: 'open', openKm: 10 + i, totalKm: 200, extractor: 'test@1' }));
  const health = (t: number) => snowSources.map((s: any) => ({ sourceId: s.id, status: 'ok', attemptedAt: t }));

  it(`${snowSources.length} fuentes en un POST: número fijo de consultas, muy por debajo de 50`, async () => {
    const t = Date.now() - 3_600_000;
    const r = await ingest('snow', { run: run('snow-full-1', 'snow'), observations: obs(t), health: health(t) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ written: snowSources.length, accepted: snowSources.length, runStatus: 'ok' });
    expect(r.d1).toBeLessThanOrEqual(8);
    // Reenviar el mismo lote: cero filas nuevas, pero la ejecución sigue siendo válida.
    const again = await ingest('snow', { run: run('snow-full-1', 'snow'), observations: obs(t), health: health(t) });
    expect(again.json).toMatchObject({ written: 0, accepted: snowSources.length, runStatus: 'ok' });
    expect(again.json.run.rows_written).toBe(snowSources.length);
    expect(again.d1).toBe(r.d1);
  });

  it('el mismo número de consultas con 1 observación que con el catálogo entero', async () => {
    const t = Date.now() - 3_000_000;
    const one = await ingest('snow', { run: run('snow-one', 'snow', { expected: 1, ok: 1 }), observations: obs(t).slice(0, 1), health: [] });
    expect(one.status).toBe(200);
    const full = await ingest('snow', { run: run('snow-full-2', 'snow'), observations: obs(t + 1), health: health(t + 1) });
    expect(full.d1).toBe(one.d1);
  });

  it('ejecución en varias partes: incompleta hasta recibir todas; reenviar una parte no duplica recuentos', async () => {
    const t = Date.now() - 2_000_000;
    const all = obs(t);
    const half = Math.ceil(all.length / 2);
    const p0 = await ingest('snow', { run: run('snow-parts', 'snow', { part: 0, parts: 2, ok: half }), observations: all.slice(0, half), health: [] });
    expect(p0.json.runStatus).toBe('running'); // incompleta, visible
    expect(p0.json.run).toMatchObject({ parts_received: 1, parts_total: 2 });
    await ingest('snow', { run: run('snow-parts', 'snow', { part: 0, parts: 2, ok: half }), observations: all.slice(0, half), health: [] });
    const p1 = await ingest('snow', { run: run('snow-parts', 'snow', { part: 1, parts: 2, ok: all.length - half }), observations: all.slice(half), health: [] });
    expect(p1.json.runStatus).toBe('ok');
    const row = await env.DB.prepare('SELECT ok, accepted, rows_written FROM capture_runs WHERE id = ?1').bind('snow-parts').first<any>();
    expect(row).toEqual({ ok: all.length, accepted: all.length, rows_written: all.length });
  });

  it('un lote demasiado grande se rechaza en validación, no a mitad de escritura', async () => {
    const big = Array.from({ length: 201 }, (_, i) => ({ sourceId: snowSources[0].id, areaId: snowSources[0].scope, observedAt: 1_780_000_000_000 + i, opStatus: 'open', openKm: 1, totalKm: 2, extractor: 'x@1' }));
    const r = await ingest('snow', { run: run('snow-big', 'snow'), observations: big, health: [] });
    expect(r.status).toBe(422);
    expect(await env.DB.prepare('SELECT 1 FROM capture_runs WHERE id = ?1').bind('snow-big').first()).toBeNull();
  });
});

describe('ingesta de ofertas con volumen real', () => {
  it(`${offerSources.length} páginas de catálogo × 10 ofertas en un POST: consultas fijas`, async () => {
    const catalogResults = offerSources.map((s: any) => ({
      sourceId: s.id, outcome: 'results',
      offers: Array.from({ length: 10 }, (_, i) => ({ providerOfferId: `${s.id}-${i}`, hotelName: `Hotel ${i}`, unit: 'per_person', priceKind: 'advertised_from', amountCents: 10000 + i, availability: 'available', extractor: 'test@1' })),
    }));
    const n = catalogResults.reduce((k: number, c: any) => k + c.offers.length, 0);
    expect(n).toBeLessThanOrEqual(200);
    const r = await ingest('offers', { run: run('offers-full', 'offers', { expected: offerSources.length, ok: offerSources.length }), observedAt: Date.now() - 3_600_000, results: [], catalog: catalogResults });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ written: n, accepted: n, runStatus: 'ok' });
    expect(r.d1).toBeLessThanOrEqual(14);
  });
});

describe('rutas de usuario con volumen', () => {
  it('temporada completa de calendario (150 días) en una petición', async () => {
    const u = await signup();
    const set = Array.from({ length: 150 }, (_, i) => ({ day: new Date(Date.UTC(2026, 11, 1) + i * 86400_000).toISOString().slice(0, 10), status: i % 3 ? 'free' : 'busy' }));
    const r = await api(u.token, 'PUT', '/api/availability/me', { set });
    expect(r.status).toBe(200);
    expect(r.d1).toBeLessThanOrEqual(40);
    const g = await api(u.token, 'GET', '/api/availability/me?from=2026-12-01&to=2027-04-30');
    expect(Object.keys(g.json.days)).toHaveLength(150);
  });
});
