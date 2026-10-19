import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, conflict, notFound, now, parseBody } from '../http';
import { zId } from '../schemas';
import { todayMadrid } from '../../core/dates';
import { RUN_FIELDS, validateManualDraft, type ManualDraft } from '../../core/runs-manual';
import { importedFromRow, manualFromRow, resolveRows } from '../run-data';

// Administración de pistas: aportaciones manuales al total y a los colores del catálogo, con historial y control de
// versiones. Solo administración (comprobado aquí, en el servidor). No toca el parte diario (abiertas, apertura, nieve,
// km) ni el catálogo importado (area_runs), que reescribe cada publicación.
export const runAdminRoutes = new Hono<AppEnv>();
runAdminRoutes.use('*', async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new ApiError(404, 'not_found', 'Ruta no encontrada.');
  await next();
});

const areaParam = (v: string) => {
  const r = zId.safeParse(v);
  if (!r.success) throw notFound('Estación');
  return r.data;
};

const contributionOut = (c: any) => c && ({
  ...manualFromRow(c)!, reason: c.reason, createdAt: c.created_at, updatedAt: c.updated_at, updatedByAlias: c.updated_by_alias ?? null,
});

/** Todas las áreas con su cifra importada, su aportación (activa o retirada) y la resolución que verá el usuario. */
runAdminRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const [areas, imported, contributions, history] = await db.batch([
    db.prepare(`SELECT a.id, a.name, a.kind, l.parent_id FROM areas a LEFT JOIN area_links l ON l.child_id = a.id WHERE a.active = 1 ORDER BY a.name`),
    db.prepare('SELECT * FROM area_runs'),
    db.prepare(`SELECT c.*, u.alias AS updated_by_alias FROM area_run_contributions c LEFT JOIN users u ON u.id = c.updated_by`),
    db.prepare(`SELECT area_id, COUNT(*) AS n, MAX(at) AS last_at FROM area_run_history GROUP BY area_id`),
  ]);
  const impBy = new Map((imported.results as any[]).map((r) => [r.area_id, r]));
  const conBy = new Map((contributions.results as any[]).map((r) => [r.area_id, r]));
  const histBy = new Map((history.results as any[]).map((r) => [r.area_id, r]));
  return c.json({
    today: todayMadrid(),
    areas: (areas.results as any[]).map((a) => {
      const res = resolveRows(impBy.get(a.id), conBy.get(a.id));
      return {
        id: a.id, name: a.name, kind: a.kind, parentId: a.parent_id ?? null,
        imported: importedFromRow(impBy.get(a.id)) ?? null, contribution: contributionOut(conBy.get(a.id)) ?? null,
        resolved: res, history: { count: histBy.get(a.id)?.n ?? 0, lastAt: histBy.get(a.id)?.last_at ?? null },
      };
    }),
  });
});

runAdminRoutes.get('/:areaId/history', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.action, h.at, h.before_json, h.after_json, h.source_ref, h.reason, h.version, u.alias AS actor_alias
     FROM area_run_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.area_id = ?1 ORDER BY h.id DESC LIMIT 200`,
  ).bind(areaId).all<any>();
  return c.json({
    history: results.map((h) => ({ id: h.id, action: h.action, at: h.at, actor: h.action === 'import_change' ? null : h.actor_alias ?? 'cuenta eliminada',
      before: h.before_json ? JSON.parse(h.before_json) : null, after: h.after_json ? JSON.parse(h.after_json) : null, sourceRef: h.source_ref, reason: h.reason, version: h.version })),
  });
});

const zCount = z.number().int().min(0).max(2000).nullable();
const zText = (max: number) => z.string().trim().max(max);
const zSave = z.object({
  expectedVersion: z.number().int().positive().nullable(),
  total: zCount, green: zCount, blue: zCount, red: zCount, black: zCount,
  comparable: z.boolean(),
  resolution: zText(1000).nullable(),
  season: zText(7).nullable(),
  sourceDate: zText(10).nullable(),
  sourceRef: zText(500),
  reason: zText(300),
});
const zAction = z.object({ expectedVersion: z.number().int().positive(), reason: zText(300).min(5, 'explica el motivo') });

/** Estado de una aportación en el historial: cifras, criterio y procedencia (sin autoría, que va en su columna). */
const snapshot = (r: any) => r && ({
  ...Object.fromEntries(RUN_FIELDS.map((f) => [f, r[f] ?? null])), comparable: !!r.comparable, resolution: r.resolution ?? null, season: r.season ?? null,
  sourceDate: r.source_date ?? r.sourceDate ?? null, sourceRef: r.source_ref ?? r.sourceRef ?? null, status: r.status ?? 'active',
});

async function load(db: D1Database, areaId: string) {
  const [area, imported, current] = await db.batch([
    db.prepare('SELECT id FROM areas WHERE id = ?1').bind(areaId),
    db.prepare('SELECT * FROM area_runs WHERE area_id = ?1').bind(areaId),
    db.prepare('SELECT * FROM area_run_contributions WHERE area_id = ?1').bind(areaId),
  ]);
  if (!area.results.length) throw notFound('Estación');
  return { imported: (imported.results as any[])[0] ?? null, current: (current.results as any[])[0] ?? null };
}
const CONFLICT = 'Otro administrador ha cambiado esta aportación mientras la editabas. Recarga para ver la versión actual antes de guardar.';
const invalid = (errors: string[]) => new ApiError(422, 'validation', errors.join(' '));

// Historial en el mismo batch que la escritura: solo se anota si la escritura con esa versión, ese instante y ese
// administrador se ha producido (si otro escribió antes, ni se escribe ni se anota).
const historyInsert = (db: D1Database, areaId: string, action: string, me: string, t: number, version: number, before: unknown, after: unknown, sourceRef: string | null, reason: string) =>
  db.prepare(`INSERT INTO area_run_history (area_id, action, actor_id, at, before_json, after_json, source_ref, reason, version)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM area_run_contributions WHERE area_id = ?1 AND version = ?9 AND updated_at = ?4 AND updated_by = ?3)`)
    .bind(areaId, action, me, t, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), sourceRef, reason, version);

runAdminRoutes.put('/:areaId', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const me = c.get('user').id;
  const b = await parseBody(c, zSave);
  const db = c.env.DB;
  const { imported, current } = await load(db, areaId);
  const draft: ManualDraft = { ...b, resolution: b.resolution || null, season: b.season || null, sourceDate: b.sourceDate || null };
  const today = todayMadrid();
  const errors = validateManualDraft(draft, { imported: importedFromRow(imported), today });
  if (errors.length) throw invalid(errors);
  if ((current?.version ?? null) !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  const t = now();
  const version = (current?.version ?? 0) + 1;
  const vals = [draft.total, draft.green, draft.blue, draft.red, draft.black, draft.comparable ? 1 : 0, draft.resolution, draft.season, draft.sourceDate, draft.sourceRef, draft.reason, today, me, t];
  const write = current
    ? db.prepare(`UPDATE area_run_contributions SET total = ?1, green = ?2, blue = ?3, red = ?4, black = ?5, comparable = ?6, resolution = ?7, season = ?8, source_date = ?9,
                  source_ref = ?10, reason = ?11, entered_on = ?12, status = 'active', version = version + 1, updated_by = ?13, updated_at = ?14 WHERE area_id = ?15 AND version = ?16`)
      .bind(...vals, areaId, current.version)
    : db.prepare(`INSERT INTO area_run_contributions (total, green, blue, red, black, comparable, resolution, season, source_date, source_ref, reason, entered_on, updated_by, updated_at,
                  area_id, created_by, created_at, status, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?13, ?14, 'active', 1)
                  ON CONFLICT (area_id) DO NOTHING`).bind(...vals, areaId);
  const after = snapshot({ ...draft, status: 'active' });
  const [w] = await db.batch([write, historyInsert(db, areaId, current ? 'update' : 'create', me, t, version, snapshot(current), after, draft.sourceRef, draft.reason)]);
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  const saved = await db.prepare('SELECT * FROM area_run_contributions WHERE area_id = ?1').bind(areaId).first<any>();
  return c.json({ ok: true, version, resolved: resolveRows(imported, saved) });
});

runAdminRoutes.post('/:areaId/:action{withdraw|restore}', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const withdraw = c.req.param('action') === 'withdraw';
  const me = c.get('user').id;
  const b = await parseBody(c, zAction);
  const db = c.env.DB;
  const { imported, current } = await load(db, areaId);
  if (!current) throw notFound('Aportación');
  if (current.version !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  if (withdraw && current.status !== 'active') throw conflict('La aportación ya está retirada.', 'already_withdrawn');
  if (!withdraw) {
    if (current.status === 'active') throw conflict('La aportación ya está activa.', 'already_active');
    // Restaurar vuelve a pasar la validación con el catálogo importado de hoy (puede haber cambiado desde que se guardó).
    const m = manualFromRow(current)!;
    const errors = validateManualDraft({ ...m, reason: b.reason }, { imported: importedFromRow(imported), today: todayMadrid() });
    if (errors.length) throw invalid(['No se puede restaurar tal cual:', ...errors, 'Edítala con la evidencia que falta.']);
  }
  const t = now();
  const status = withdraw ? 'withdrawn' : 'active';
  const [w] = await db.batch([
    db.prepare(`UPDATE area_run_contributions SET status = ?1, version = version + 1, updated_by = ?2, updated_at = ?3 WHERE area_id = ?4 AND version = ?5`)
      .bind(status, me, t, areaId, current.version),
    historyInsert(db, areaId, withdraw ? 'withdraw' : 'restore', me, t, current.version + 1, snapshot(current), snapshot({ ...current, status }), current.source_ref, b.reason),
  ]);
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  return c.json({ ok: true, version: current.version + 1, resolved: resolveRows(imported, { ...current, status, version: current.version + 1 }) });
});
