// Aportaciones manuales de pistas en la API: permisos de administración en el servidor, validación, versiones,
// historial, retirar y restaurar, y persistencia frente a la reimportación del catálogo (mismo SQL que la publicación).
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { runCatalogSql } from '../../tools/run-catalog-sql';
import { todayMadrid } from '../../src/core/dates';
import { currentSeasonStart, seasonLabel } from '../../src/core/runs-manual';
import { api, seedCatalog, signup } from './helpers';

// Ax 3 Domaines con temporada declarada (el catálogo real no la indica): solo con la misma temporada se completan huecos.
const runCatalog = ((catalog as any).run_catalog as any[]).map((r) => (r.area === 'ax-3-domaines' ? { ...r, season: '2026-27' } : r));
const pub = async (path: string) => (await SELF.fetch(`http://localhost${path}`)).json<any>();
const importRuns = async (entries: any[], label = 'prueba') => { await env.DB.batch(runCatalogSql(entries, { at: Date.now(), label }).map((s) => env.DB.prepare(s))); };
const areaRuns = async (id: string) => (await pub('/api/public/catalog')).areas.find((a: any) => a.id === id).runs;
const history = (id: string) => env.DB.prepare('SELECT action, actor_id, before_json, after_json, reason FROM area_run_history WHERE area_id = ?1 ORDER BY id').bind(id).all<any>().then((r) => r.results);
const body = (o: Record<string, unknown> = {}) => ({
  expectedVersion: null, total: null, green: null, blue: null, red: null, black: null, comparable: true, resolution: null, season: null, sourceDate: null,
  sourceRef: 'https://www.ax.ski/fr/lastation', reason: 'Ficha técnica con colores', ...o,
});

let admin: { token: string; id: string; alias: string };
let admin2: { token: string; id: string; alias: string };
let user: { token: string; id: string; alias: string };

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.batch((catalog as any).links.map((l: any) => env.DB.prepare('INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (?1, ?2, ?3)').bind(l.parent, l.child, l.relation)));
  await importRuns(runCatalog);
  [admin, admin2, user] = [await signup(), await signup(), await signup()];
  await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id IN (?1, ?2)`).bind(admin.id, admin2.id).run();
});

describe('permisos', () => {
  it('solo administración: sin sesión 401, cuenta normal 404 en todas las operaciones', async () => {
    expect((await api(null, 'GET', '/api/admin/runs')).status).toBe(401);
    for (const [m, p, b] of [['GET', '/api/admin/runs'], ['GET', '/api/admin/runs/ax-3-domaines/history'], ['PUT', '/api/admin/runs/ax-3-domaines', body({ green: 1 })],
      ['POST', '/api/admin/runs/ax-3-domaines/withdraw', { expectedVersion: 1, reason: 'prueba' }], ['POST', '/api/admin/runs/ax-3-domaines/restore', { expectedVersion: 1, reason: 'prueba' }]] as const) {
      expect((await api(user.token, m, p, b)).status).toBe(404);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM area_run_contributions').first('n')).toBe(0);
  });
});

describe('aportaciones', () => {
  it('completa los colores de Ax 3 Domaines: lo ven el catálogo y la ficha, con procedencia manual y sin autoría ni motivo', async () => {
    const r = await api(admin.token, 'PUT', '/api/admin/runs/ax-3-domaines', body({ green: 10, blue: 12, red: 11, black: 5, season: '2026-27', sourceDate: '2026-10-01' }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ version: 1, resolved: { state: 'applied' } });
    const runs = await areaRuns('ax-3-domaines');
    expect(runs).toMatchObject({ total: 38, green: 10, blue: 12, red: 11, black: 5, origin: 'mixed', manual: { fields: ['green', 'blue', 'red', 'black'], season: '2026-27', sourceDate: '2026-10-01' } });
    const detail = await pub('/api/public/areas/ax-3-domaines');
    expect(detail.runs).toEqual(runs);
    expect(JSON.stringify(detail)).not.toMatch(/Ficha técnica con colores|updatedBy|updated_by|created_by|actor/);
    const h = await history('ax-3-domaines');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: 'create', actor_id: admin.id, before_json: null, reason: 'Ficha técnica con colores' });
    expect(JSON.parse(h[0].after_json)).toMatchObject({ green: 10, total: null, sourceRef: 'https://www.ax.ski/fr/lastation' });
  });

  it('reimportar el catálogo sin cambios no borra la aportación ni anota nada', async () => {
    await importRuns(runCatalog);
    await importRuns(runCatalog);
    expect(await areaRuns('ax-3-domaines')).toMatchObject({ green: 10, origin: 'mixed' });
    expect(await history('ax-3-domaines')).toHaveLength(1);
  });

  it('si la importación trae después colores válidos, prevalecen; la aportación se conserva y el cambio queda en el historial', async () => {
    const changed = runCatalog.map((r) => (r.area === 'ax-3-domaines' ? { ...r, green: 9, blue: 13, red: 11, black: 5, source_date: '2026-10-15' } : r));
    await importRuns(changed, 'Importación del catálogo (prueba)');
    expect(await areaRuns('ax-3-domaines')).toMatchObject({ green: 9, blue: 13, origin: 'catalog', manual: null });
    const list = await api(admin.token, 'GET', '/api/admin/runs');
    const ax = list.json.areas.find((a: any) => a.id === 'ax-3-domaines');
    expect(ax.contribution).toMatchObject({ green: 10, status: 'active', version: 1 });
    expect(ax.resolved).toMatchObject({ state: 'not_applied', overridden: ['green', 'blue'], notes: ['automatica_prevalece'] });
    const h = await history('ax-3-domaines');
    expect(h.map((x) => x.action)).toEqual(['create', 'import_change']);
    expect(JSON.parse(h[1].before_json)).toMatchObject({ total: 38, green: null });
    expect(JSON.parse(h[1].after_json)).toMatchObject({ green: 9 });
    expect(h[1].actor_id).toBeNull();
    await importRuns(runCatalog);
    expect(await areaRuns('ax-3-domaines')).toMatchObject({ green: 10, origin: 'mixed' });
  });

  it('una importación con dato ausente, incoherente o de una temporada anterior no desplaza una aportación válida', async () => {
    const r = await api(admin.token, 'PUT', '/api/admin/runs/baqueira-beret', body({ total: 110, season: '2026-27', sourceRef: 'Ficha técnica impresa 2026-27, página 2', reason: 'Dato que faltaba' }));
    expect(r.status).toBe(200);
    for (const variant of [{}, { total: 100, green: 90, blue: 20, red: 0, black: 0, comparable: true }, { total: 104, comparable: true, season: '2025-26' }]) {
      await importRuns(runCatalog.map((x) => (x.area === 'baqueira-beret' ? { ...x, ...variant } : x)));
      expect(await areaRuns('baqueira-beret')).toMatchObject({ total: 110, origin: 'manual', sourceUrl: 'Ficha técnica impresa 2026-27, página 2', basis: 'aggregate' });
    }
    await importRuns(runCatalog);
  });

  it('valida también en el servidor: enteros, desglose, discrepancias, fuente y motivo', async () => {
    const put = (id: string, o: Record<string, unknown>) => api(admin.token, 'PUT', `/api/admin/runs/${id}`, body(o));
    expect((await put('les-angles', { total: -1 })).status).toBe(422);
    expect((await put('les-angles', { total: 2.5 })).status).toBe(422);
    expect((await put('les-angles', { total: 40, green: 10, blue: 10, red: 10, black: 9 })).json.error.message).toMatch(/suman 39/);
    expect((await put('les-angles', { total: 20, green: 15, blue: 10 })).json.error.message).toMatch(/más que el total/);
    expect((await put('les-angles', {})).json.error.message).toMatch(/al menos una cifra/);
    expect((await put('les-angles', { total: 37, sourceRef: 'x', reason: '' })).status).toBe(422);
    expect((await put('les-angles', { total: 37 })).json.error.message).toMatch(/discrepancia pendiente/);
    expect((await put('no-existe', { total: 3 })).status).toBe(404);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM area_run_contributions WHERE area_id = 'les-angles'`).first('n')).toBe(0);
  });

  it('Astún + Candanchú: no se vuelve comparable sin explicación; con evidencia puntúa su cifra y no la suma de sus estaciones', async () => {
    const no = await api(admin.token, 'PUT', '/api/admin/runs/astun-candanchu', body({ total: 114 }));
    expect(no.status).toBe(422);
    const ok = await api(admin.token, 'PUT', '/api/admin/runs/astun-candanchu', body({ total: 114, green: 16, blue: 33, red: 35, black: 30,
      resolution: 'Parte oficial: 116 entradas numeradas menos la 3 (trineos) y la 19 (snowpark).', sourceRef: 'https://tienda.astuncandanchu.com/partenieve/pistas', reason: 'Resolver la discrepancia' }));
    expect(ok.status).toBe(200);
    const d = await pub('/api/public/areas/astun-candanchu');
    expect(d.runs).toMatchObject({ total: 114, comparable: true, origin: 'manual', superseded: { total: 110, comparable: false } });
    expect(d.memberRuns.map((m: any) => [m.areaId, m.total]).sort()).toEqual([['astun', 57], ['candanchu', 57]]);
  });

  it('temporada: una cifra importada sin temporada no desplaza una aportación documentada de la temporada actual', async () => {
    const now = seasonLabel(currentSeasonStart(todayMadrid()));
    const gv = runCatalog.find((x) => x.area === 'grandvalira');
    expect([gv.season, gv.total]).toEqual([null, 142]);
    const r = await api(admin.token, 'PUT', '/api/admin/runs/grandvalira', body({ total: 140, season: now, reason: 'Ficha de la temporada actual' }));
    expect(r.json.resolved).toMatchObject({ state: 'applied', notes: ['sustituye_sin_temporada'] });
    expect(await areaRuns('grandvalira')).toMatchObject({ total: 140, green: null, origin: 'manual', superseded: { total: 142 } });
    // Una automática que declara una temporada posterior la sustituye; la aportación y el cambio quedan en el historial.
    const next = seasonLabel(currentSeasonStart(todayMadrid()) + 1);
    await importRuns(runCatalog.map((x) => (x.area === 'grandvalira' ? { ...x, season: next } : x)));
    expect(await areaRuns('grandvalira')).toMatchObject({ total: 142, origin: 'catalog' });
    expect((await history('grandvalira')).map((h) => h.action)).toEqual(['create', 'import_change']);
    await importRuns(runCatalog);
    expect(await areaRuns('grandvalira')).toMatchObject({ total: 140, origin: 'manual' });
  });

  it('una ficha publicada por adelantado para la próxima temporada se guarda, pero no sustituye la cifra de la temporada en curso', async () => {
    const next = seasonLabel(currentSeasonStart(todayMadrid()) + 1);
    const r = await api(admin.token, 'PUT', '/api/admin/runs/port-del-comte', body({ total: 31, season: next, sourceDate: todayMadrid(), reason: 'Ficha de la próxima temporada' }));
    expect(r.status).toBe(200);
    expect(r.json.resolved).toMatchObject({ state: 'scheduled', notes: ['temporada_futura'] });
    expect(await areaRuns('port-del-comte')).toMatchObject({ total: 29, origin: 'catalog' });
    const list = await api(admin.token, 'GET', '/api/admin/runs');
    expect(list.json.areas.find((a: any) => a.id === 'port-del-comte').contribution).toMatchObject({ total: 31, season: next, status: 'active' });
    // Dos temporadas por delante no.
    const far = await api(admin.token, 'PUT', '/api/admin/runs/port-del-comte', body({ expectedVersion: 1, total: 31, season: seasonLabel(currentSeasonStart(todayMadrid()) + 2) }));
    expect(far.status).toBe(422);
  });

  it('colores parciales sin total: se guardan y se muestran tal cual, sin total inventado ni ceros, y no puntúan', async () => {
    const r = await api(admin.token, 'PUT', '/api/admin/runs/cerler', body({ green: 10, reason: 'Solo verdes publicadas' }));
    expect(r.status).toBe(200);
    expect(await areaRuns('cerler')).toMatchObject({ total: null, green: 10, blue: null, red: null, black: null, origin: 'manual' });
  });

  it('dos administradores a la vez: el segundo recibe un conflicto en lugar de sobrescribir', async () => {
    const first = await api(admin.token, 'PUT', '/api/admin/runs/javalambre', body({ total: 12, reason: 'Primero' }));
    expect(first.status).toBe(200);
    const again = await api(admin2.token, 'PUT', '/api/admin/runs/javalambre', body({ total: 13, reason: 'Nuevo a la vez' }));
    expect(again.status).toBe(409);
    const a = await api(admin.token, 'PUT', '/api/admin/runs/javalambre', body({ expectedVersion: 1, total: 14, reason: 'Edición A' }));
    const b = await api(admin2.token, 'PUT', '/api/admin/runs/javalambre', body({ expectedVersion: 1, total: 15, reason: 'Edición B' }));
    expect([a.status, b.status]).toEqual([200, 409]);
    expect(b.json.error.code).toBe('version_conflict');
    expect(await env.DB.prepare(`SELECT total, version FROM area_run_contributions WHERE area_id = 'javalambre'`).first()).toEqual({ total: 14, version: 2 });
    expect((await history('javalambre')).map((h) => h.reason)).toEqual(['Primero', 'Edición A']);
  });

  it('retirar y restaurar conservan la trazabilidad; restaurar respeta la prioridad automática', async () => {
    const w = await api(admin.token, 'POST', '/api/admin/runs/javalambre/withdraw', { expectedVersion: 2, reason: 'Fuente dudosa' });
    expect(w.status).toBe(200);
    expect((await areaRuns('javalambre')).total).toBeNull();
    expect((await api(admin.token, 'POST', '/api/admin/runs/javalambre/withdraw', { expectedVersion: 3, reason: 'Otra vez' })).status).toBe(409);
    expect((await api(admin.token, 'POST', '/api/admin/runs/javalambre/restore', { expectedVersion: 2, reason: 'Versión vieja' })).status).toBe(409);
    // Mientras está retirada llega un dato automático válido (no se anota: la retirada no interviene); al restaurar,
    // prevalece el automático. Ninguna de las dos declara temporada: no se mezclan y se explica.
    await importRuns(runCatalog.map((x) => (x.area === 'javalambre' ? { ...x, total: 16, comparable: true } : x)));
    const r = await api(admin2.token, 'POST', '/api/admin/runs/javalambre/restore', { expectedVersion: 3, reason: 'La fuente era buena' });
    expect(r.status).toBe(200);
    expect(r.json.resolved).toMatchObject({ state: 'not_applied', notes: ['vigencia_desconocida'] });
    expect((await areaRuns('javalambre')).total).toBe(16);
    const h = await api(admin.token, 'GET', '/api/admin/runs/javalambre/history');
    expect(h.json.history.map((x: any) => [x.action, x.actor, x.reason])).toEqual([
      ['restore', admin2.alias, 'La fuente era buena'], ['withdraw', admin.alias, 'Fuente dudosa'], ['update', admin.alias, 'Edición A'], ['create', admin.alias, 'Primero'],
    ]);
    expect(h.json.history[2]).toMatchObject({ before: { total: 12 }, after: { total: 14 } });
    await importRuns(runCatalog);
    expect((await areaRuns('javalambre')).total).toBe(14);
  });

  it('el listado de administración trae cada área con su cifra importada, su aportación y su resolución', async () => {
    const r = await api(admin.token, 'GET', '/api/admin/runs');
    expect(r.status).toBe(200);
    const by = new Map(r.json.areas.map((a: any) => [a.id, a]));
    expect(by.size).toBe((catalog as any).areas.length);
    expect(by.get('astun')).toMatchObject({ parentId: 'astun-candanchu', imported: { total: 57, basis: 'individual' }, contribution: null, resolved: { state: 'none' } });
    expect(by.get('javalambre')).toMatchObject({ contribution: { total: 14, status: 'active', version: 4, updatedByAlias: admin2.alias }, history: { count: 5 } });
    expect(r.d1).toBeLessThan(10);
  });
});
