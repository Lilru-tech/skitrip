/// <reference types="vite/client" />
// Afluencia histórica en la API: lectura pública por día y mes (estación frente a dominio, km del mismo día, sin
// autoría), administración (permisos, duplicados, versiones, historial, retirar y restaurar), carga inicial de la
// migración (idempotente) y persistencia frente a la reimportación del catálogo.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import MIGRATION from '../../migrations/0022_crowd_observations.sql?raw';
import { runCatalogSql } from '../../tools/run-catalog-sql';
import { api, seedCatalog, signup } from './helpers';

const cat = catalog as any;
let admin: { token: string; id: string };
let admin2: { token: string; id: string };
let user: { token: string; id: string };
const body = (o: Record<string, unknown> = {}) => ({
  observationId: null, expectedVersion: null, areaId: 'masella', date: '2025-02-15', measure: 'daily_skiers', status: 'value', value: 4000, sample: 'regular',
  sourceRef: 'https://example.invalid/noticia', sourceTitle: 'Noticia', sourcePublished: '2025-02-16', note: null, reason: 'Noticia del operador', ...o,
});
/** Las sentencias de carga inicial de la migración (los INSERT del final). */
const seedSql = () => MIGRATION.slice(MIGRATION.indexOf('INSERT INTO crowd_observations')).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
const crowds = async (id: string, dia: string) => (await api(null, 'GET', `/api/public/areas/${id}/crowds?dia=${dia}`)).json;

beforeAll(async () => {
  await seedCatalog(env.DB, cat);
  await env.DB.batch(cat.links.map((l: any) => env.DB.prepare('INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (?1, ?2, ?3)').bind(l.parent, l.child, l.relation)));
  [admin, admin2, user] = [await signup(), await signup(), await signup()];
  await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id IN (?1, ?2)`).bind(admin.id, admin2.id).run();
});

describe('carga inicial de la migración', () => {
  it('tres observaciones diarias por estación, marcadas como récord, con historial; repetirla no duplica', async () => {
    for (let i = 0; i < 2; i++) for (const s of seedSql()) await env.DB.prepare(s).run();
    const rows = (await env.DB.prepare(`SELECT area_id, obs_date, measure, value, sample, origin FROM crowd_observations WHERE origin = 'seed' ORDER BY area_id`).all<any>()).results;
    expect(rows).toEqual([
      { area_id: 'boi-taull', obs_date: '2026-02-21', measure: 'daily_skiers', value: 4123, sample: 'record', origin: 'seed' },
      { area_id: 'la-molina', obs_date: '2026-02-15', measure: 'daily_skiers', value: 8564, sample: 'record', origin: 'seed' },
      { area_id: 'port-aine', obs_date: '2026-02-21', measure: 'daily_skiers', value: 3368, sample: 'record', origin: 'seed' },
    ]);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM crowd_history WHERE action = 'seed'`).first('n')).toBe(3);
    // Ninguna cifra del grupo FGC se atribuye a una estación.
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM crowd_observations WHERE value IN (22585, 20096, 20276)`).first('n')).toBe(0);
  });
});

describe('lectura pública', () => {
  it('La Molina 15/02: fecha, día de la semana, cifra, muestra de récord; sin km del mismo día no hay intensidad', async () => {
    const r = await crowds('la-molina', '02-15');
    expect(r.scopes).toHaveLength(1);
    const [s] = r.scopes;
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0]).toMatchObject({ date: '2026-02-15', weekday: 'domingo', value: 8564, measure: 'daily_skiers', sample: 'record', intensity: { value: null, missing: 'no_report' } });
    expect(s.summary[0]).toMatchObject({ yearsWithValue: [2026], mean: null, selectedSample: true });
    expect(JSON.stringify(r)).not.toMatch(/reason|Carga inicial|created_by|updated_by|origin/);
  });
  it('otra fecha: «Sin dato» (ninguna observación, ningún resumen, ningún cero)', async () => {
    const r = await crowds('la-molina', '02-16');
    expect(r.scopes[0]).toMatchObject({ observations: [], summary: [] });
  });
  it('dominio: sus estaciones aparecen por separado y nada se suma ni se atribuye al dominio', async () => {
    const r = await crowds('alp-2500', '02-15');
    expect(r.scopes.map((s: any) => s.areaId)).toEqual(['alp-2500', 'la-molina', 'masella']);
    expect(r.scopes[0]).toMatchObject({ observations: [], summary: [] });
    expect(r.scopes[1].observations[0].value).toBe(8564);
  });
  it('intensidad con un parte válido del mismo día y ámbito; un parte del dominio no vale para la estación', async () => {
    const src = cat.sources.find((s: any) => s.kind === 'snow').id;
    const ins = (id: string, area: string, date: string, km: number | null) => env.DB.prepare(`INSERT INTO snow_observations (id, area_id, source_id, observed_at, source_date, op_status, open_km, quality, content_hash, extractor)
      VALUES (?1, ?2, ?3, 1, ?4, 'open', ?5, 'ok', ?1, 'test')`).bind(id, area, src, date, km).run();
    await ins('t-dom', 'alp-2500', '2026-02-15', 71);
    expect((await crowds('la-molina', '02-15')).scopes[0].observations[0].intensity).toMatchObject({ value: null, missing: 'no_report' });
    await ins('t-boi', 'boi-taull', '2026-02-21', 40);
    expect((await crowds('boi-taull', '02-21')).scopes[0].observations[0].intensity).toMatchObject({ value: 103.1, openKm: 40 });
    await ins('t-pa', 'port-aine', '2026-02-21', 0);
    expect((await crowds('port-aine', '02-21')).scopes[0].observations[0].intensity).toMatchObject({ value: null, missing: 'zero_km', openKm: 0 });
  });
  it('día y mes inválidos: 422; 29/02 válido', async () => {
    expect((await api(null, 'GET', '/api/public/areas/la-molina/crowds?dia=02-30')).status).toBe(422);
    expect((await api(null, 'GET', '/api/public/areas/la-molina/crowds')).status).toBe(422);
    expect((await api(null, 'GET', '/api/public/areas/la-molina/crowds?dia=02-29')).status).toBe(200);
    expect((await api(null, 'GET', '/api/public/areas/no-existe/crowds?dia=02-15')).status).toBe(404);
  });
});

describe('administración', () => {
  it('solo administración: sin sesión 401, cuenta normal 404', async () => {
    expect((await api(null, 'GET', '/api/admin/crowds')).status).toBe(401);
    for (const [m, p, b] of [['GET', '/api/admin/crowds'], ['PUT', '/api/admin/crowds', body()], ['GET', '/api/admin/crowds/1/history'],
      ['POST', '/api/admin/crowds/1/withdraw', { expectedVersion: 1, reason: 'prueba' }], ['POST', '/api/admin/crowds/1/restore', { expectedVersion: 1, reason: 'prueba' }]] as const) {
      expect((await api(user.token, m, p, b)).status).toBe(404);
    }
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM crowd_observations WHERE origin = 'admin'`).first('n')).toBe(0);
  });

  let id: number;
  it('alta, duplicado rechazado, edición con versión y conflicto entre dos administradores', async () => {
    const r = await api(admin.token, 'PUT', '/api/admin/crowds', body());
    expect(r.status).toBe(200);
    id = r.json.id;
    expect((await api(admin2.token, 'PUT', '/api/admin/crowds', body({ value: 1 }))).json.error.code).toBe('duplicate');
    // Misma fecha con otra medida: es otra observación (no se mezclan).
    expect((await api(admin.token, 'PUT', '/api/admin/crowds', body({ measure: 'lift_passages', value: 30000 }))).status).toBe(200);
    expect((await api(admin.token, 'PUT', '/api/admin/crowds', body({ observationId: id, expectedVersion: 1, value: 4100 }))).status).toBe(200);
    const stale = await api(admin2.token, 'PUT', '/api/admin/crowds', body({ observationId: id, expectedVersion: 1, value: 1 }));
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('version_conflict');
    expect(await env.DB.prepare('SELECT value FROM crowd_observations WHERE id = ?1').bind(id).first('value')).toBe(4100);
  });
  it('validación: cierre sin cifra, fecha futura, 29/02 de año no bisiesto, fuente no https', async () => {
    for (const b of [body({ status: 'closed', value: 0, date: '2025-02-10' }), body({ date: '2099-01-01' }), body({ date: '2025-02-29' }), body({ sourceRef: 'me lo dijeron', date: '2025-02-11' })]) {
      expect((await api(admin.token, 'PUT', '/api/admin/crowds', b)).status).toBe(422);
    }
    expect((await api(admin.token, 'PUT', '/api/admin/crowds', body({ status: 'closed', value: null, date: '2024-02-29' }))).status).toBe(200);
    const r = await crowds('masella', '02-29');
    expect(r.scopes[0].observations[0]).toMatchObject({ status: 'closed', value: null, intensity: { missing: 'closed' } });
  });
  it('retirar y restaurar con historial completo; retirada no se ve en público', async () => {
    expect((await api(admin.token, 'POST', `/api/admin/crowds/${id}/withdraw`, { expectedVersion: 2, reason: 'Fuente rectificada' })).status).toBe(200);
    expect((await crowds('masella', '02-15')).scopes[0].observations.map((o: any) => o.measure)).toEqual(['lift_passages']);
    expect((await api(admin.token, 'POST', `/api/admin/crowds/${id}/withdraw`, { expectedVersion: 3, reason: 'otra vez' })).status).toBe(409);
    expect((await api(admin.token, 'POST', `/api/admin/crowds/${id}/restore`, { expectedVersion: 3, reason: 'Fuente confirmada' })).status).toBe(200);
    const h = (await api(admin.token, 'GET', `/api/admin/crowds/${id}/history`)).json.history;
    expect(h.map((x: any) => x.action)).toEqual(['restore', 'withdraw', 'update', 'create']);
    expect(h[2]).toMatchObject({ before: { value: 4000 }, after: { value: 4100 }, reason: 'Noticia del operador' });
    const list = (await api(admin.token, 'GET', '/api/admin/crowds')).json;
    expect(list.observations.find((o: any) => o.id === id)).toMatchObject({ state: 'active', version: 4, origin: 'admin' });
  });
  it('la reimportación del catálogo (áreas y pistas) no toca las observaciones', async () => {
    const before = (await env.DB.prepare('SELECT * FROM crowd_observations ORDER BY id').all()).results;
    await seedCatalog(env.DB, cat);
    await env.DB.batch(runCatalogSql(cat.run_catalog, { at: Date.now(), label: 'reimportación' }).map((s) => env.DB.prepare(s)));
    expect((await env.DB.prepare('SELECT * FROM crowd_observations ORDER BY id').all()).results).toEqual(before);
  });
});
