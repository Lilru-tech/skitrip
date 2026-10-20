import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, conflict, notFound, now, parseBody } from '../http';
import { zId } from '../schemas';
import { todayMadrid } from '../../core/dates';
import { pickManual, RUN_FIELDS, validateManualDraft, type ContributionRole, type ManualDraft } from '../../core/runs-manual';
import { contributionsByArea, importedFromRow, manualFromRow, resolveRows } from '../run-data';

// Administración de pistas: aportaciones manuales al total y a los colores del catálogo, con historial y control de
// versiones. Solo administración (comprobado aquí, en el servidor). No toca el parte diario (abiertas, apertura, nieve,
// km) ni el catálogo importado (area_runs), que reescribe cada publicación. Cada área puede tener varias aportaciones,
// una activa por temporada: cada operación actúa sobre UNA (contributionId) y no toca las demás.
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

/** Aportaciones de un área con su papel hoy (vigente, programada, sustituida, retirada): activas primero, recientes antes. */
function contributionsOut(rows: readonly any[], today: string) {
  const list = rows.map((r) => ({ row: r, m: manualFromRow(r)! }));
  const pick = pickManual(list.map((x) => x.m), today);
  const order: Record<ContributionRole, number> = { current: 0, scheduled: 1, superseded: 2, withdrawn: 3 };
  return list.map((x) => ({ ...contributionOut(x.row), role: pick.role(x.m) }))
    .sort((a, b) => order[a.role as ContributionRole] - order[b.role as ContributionRole] || (b.season ?? '').localeCompare(a.season ?? '') || b.id - a.id);
}

/** Todas las áreas con su cifra importada, sus aportaciones (activas o retiradas) y la resolución que verá el usuario. */
runAdminRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const [areas, imported, contributions, history] = await db.batch([
    db.prepare(`SELECT a.id, a.name, a.kind, l.parent_id FROM areas a LEFT JOIN area_links l ON l.child_id = a.id WHERE a.active = 1 ORDER BY a.name`),
    db.prepare('SELECT * FROM area_runs'),
    db.prepare(`SELECT c.*, u.alias AS updated_by_alias FROM area_run_contributions c LEFT JOIN users u ON u.id = c.updated_by`),
    db.prepare(`SELECT area_id, COUNT(*) AS n, MAX(at) AS last_at FROM area_run_history GROUP BY area_id`),
  ]);
  const impBy = new Map((imported.results as any[]).map((r) => [r.area_id, r]));
  const conBy = contributionsByArea(contributions.results as any[]);
  const histBy = new Map((history.results as any[]).map((r) => [r.area_id, r]));
  const today = todayMadrid();
  return c.json({
    today,
    areas: (areas.results as any[]).map((a) => {
      const rows = conBy.get(a.id) ?? [];
      const res = resolveRows(impBy.get(a.id), rows);
      return {
        id: a.id, name: a.name, kind: a.kind, parentId: a.parent_id ?? null,
        imported: importedFromRow(impBy.get(a.id)) ?? null, contributions: contributionsOut(rows, today),
        resolved: res, history: { count: histBy.get(a.id)?.n ?? 0, lastAt: histBy.get(a.id)?.last_at ?? null },
      };
    }),
  });
});

runAdminRoutes.get('/:areaId/history', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.contribution_id, h.action, h.at, h.before_json, h.after_json, h.source_ref, h.reason, h.version, u.alias AS actor_alias
     FROM area_run_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.area_id = ?1 ORDER BY h.id DESC LIMIT 200`,
  ).bind(areaId).all<any>();
  return c.json({
    history: results.map((h) => ({ id: h.id, contributionId: h.contribution_id ?? null, action: h.action, at: h.at, actor: h.action === 'import_change' ? null : h.actor_alias ?? 'cuenta eliminada',
      before: h.before_json ? JSON.parse(h.before_json) : null, after: h.after_json ? JSON.parse(h.after_json) : null, sourceRef: h.source_ref, reason: h.reason, version: h.version })),
  });
});

const zCount = z.number().int().min(0).max(2000).nullable();
const zText = (max: number) => z.string().trim().max(max);
const zSave = z.object({
  /** null = aportación nueva (otra temporada, o la primera); si no, la que se edita. */
  contributionId: z.number().int().positive().nullable().default(null),
  expectedVersion: z.number().int().positive().nullable(),
  total: zCount, green: zCount, blue: zCount, red: zCount, black: zCount,
  comparable: z.boolean(),
  resolution: zText(1000).nullable(),
  season: zText(7).nullable(),
  sourceDate: zText(10).nullable(),
  sourceRef: zText(500),
  reason: zText(300),
});
const zAction = z.object({ contributionId: z.number().int().positive(), expectedVersion: z.number().int().positive(), reason: zText(300).min(5, 'explica el motivo') });

/** Estado de una aportación en el historial: cifras, criterio y procedencia (sin autoría, que va en su columna). */
const snapshot = (r: any) => r && ({
  ...Object.fromEntries(RUN_FIELDS.map((f) => [f, r[f] ?? null])), comparable: !!r.comparable, resolution: r.resolution ?? null, season: r.season ?? null,
  sourceDate: r.source_date ?? r.sourceDate ?? null, sourceRef: r.source_ref ?? r.sourceRef ?? null, status: r.status ?? 'active',
});

async function load(db: D1Database, areaId: string, contributionId: number | null) {
  const [area, imported, all] = await db.batch([
    db.prepare('SELECT id FROM areas WHERE id = ?1').bind(areaId),
    db.prepare('SELECT * FROM area_runs WHERE area_id = ?1').bind(areaId),
    db.prepare('SELECT * FROM area_run_contributions WHERE area_id = ?1').bind(areaId),
  ]);
  if (!area.results.length) throw notFound('Estación');
  const rows = all.results as any[];
  const current = contributionId == null ? null : rows.find((r) => r.id === contributionId);
  if (contributionId != null && !current) throw notFound('Aportación');
  return { imported: (imported.results as any[])[0] ?? null, rows, current: current ?? null };
}
const CONFLICT = 'Otro administrador ha cambiado esta aportación mientras la editabas. Recarga para ver la versión actual antes de guardar.';
const sameSeason = (a: string | null, b: string | null) => (a ?? '') === (b ?? '');
const seasonTaken = (season: string | null) => conflict(season
  ? `Ya hay una aportación activa para la temporada ${season}: edítala en lugar de crear otra.`
  : 'Ya hay una aportación activa sin temporada: edítala en lugar de crear otra.', 'season_taken');
const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
const invalid = (errors: string[]) => new ApiError(422, 'validation', errors.join(' '));

// Historial en el mismo batch que la escritura: solo se anota si la escritura con esa versión, ese instante y ese
// administrador se ha producido (si otro escribió antes, ni se escribe ni se anota). Una aportación nueva se localiza
// por esos mismos datos (contributionId null).
const historyInsert = (db: D1Database, areaId: string, contributionId: number | null, action: string, me: string, t: number, version: number, before: unknown, after: unknown, sourceRef: string | null, reason: string) =>
  db.prepare(`INSERT INTO area_run_history (area_id, contribution_id, action, actor_id, at, before_json, after_json, source_ref, reason, version)
              SELECT ?1, c.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM area_run_contributions c
              WHERE c.area_id = ?1 AND c.version = ?9 AND c.updated_at = ?4 AND c.updated_by = ?3 AND (?10 IS NULL OR c.id = ?10) LIMIT 1`)
    .bind(areaId, action, me, t, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), sourceRef, reason, version, contributionId);

runAdminRoutes.put('/:areaId', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const me = c.get('user').id;
  const b = await parseBody(c, zSave);
  const db = c.env.DB;
  const { imported, rows, current } = await load(db, areaId, b.contributionId);
  const { contributionId: _, expectedVersion: __, ...fields } = b;
  const draft: ManualDraft = { ...fields, resolution: b.resolution || null, season: b.season || null, sourceDate: b.sourceDate || null };
  const today = todayMadrid();
  const errors = validateManualDraft(draft, { imported: importedFromRow(imported), today });
  if (errors.length) throw invalid(errors);
  if ((current?.version ?? null) !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  // Una activa por temporada: la otra (la vigente o la programada) no se sobrescribe desde aquí.
  if (rows.some((r) => r.id !== current?.id && r.status === 'active' && sameSeason(r.season, draft.season))) throw seasonTaken(draft.season);
  const t = now();
  const version = (current?.version ?? 0) + 1;
  const vals = [draft.total, draft.green, draft.blue, draft.red, draft.black, draft.comparable ? 1 : 0, draft.resolution, draft.season, draft.sourceDate, draft.sourceRef, draft.reason, today, me, t];
  const write = current
    ? db.prepare(`UPDATE area_run_contributions SET total = ?1, green = ?2, blue = ?3, red = ?4, black = ?5, comparable = ?6, resolution = ?7, season = ?8, source_date = ?9,
                  source_ref = ?10, reason = ?11, entered_on = ?12, status = 'active', version = version + 1, updated_by = ?13, updated_at = ?14 WHERE id = ?15 AND version = ?16`)
      .bind(...vals, current.id, current.version)
    : db.prepare(`INSERT INTO area_run_contributions (total, green, blue, red, black, comparable, resolution, season, source_date, source_ref, reason, entered_on, updated_by, updated_at,
                  area_id, created_by, created_at, status, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?13, ?14, 'active', 1)`).bind(...vals, areaId);
  const after = snapshot({ ...draft, status: 'active' });
  let w: D1Result;
  try {
    [w] = await db.batch([write, historyInsert(db, areaId, current?.id ?? null, current ? 'update' : 'create', me, t, version, snapshot(current), after, draft.sourceRef, draft.reason)]);
  } catch (e) {
    // Otro administrador ha creado a la vez una aportación activa de esa temporada (índice único).
    if (isUnique(e)) throw seasonTaken(draft.season);
    throw e;
  }
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  const savedId = current?.id ?? (w.meta.last_row_id as number);
  const all = (await db.prepare('SELECT * FROM area_run_contributions WHERE area_id = ?1').bind(areaId).all<any>()).results;
  return c.json({ ok: true, id: savedId, version, resolved: resolveRows(imported, all) });
});

runAdminRoutes.post('/:areaId/:action{withdraw|restore}', async (c) => {
  const areaId = areaParam(c.req.param('areaId'));
  const withdraw = c.req.param('action') === 'withdraw';
  const me = c.get('user').id;
  const b = await parseBody(c, zAction);
  const db = c.env.DB;
  const { imported, rows, current } = await load(db, areaId, b.contributionId);
  if (!current) throw notFound('Aportación');
  if (current.version !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  if (withdraw && current.status !== 'active') throw conflict('La aportación ya está retirada.', 'already_withdrawn');
  if (!withdraw) {
    if (current.status === 'active') throw conflict('La aportación ya está activa.', 'already_active');
    if (rows.some((r) => r.id !== current.id && r.status === 'active' && sameSeason(r.season, current.season))) throw seasonTaken(current.season);
    // Restaurar vuelve a pasar la validación con el catálogo importado de hoy (puede haber cambiado desde que se guardó).
    const m = manualFromRow(current)!;
    const errors = validateManualDraft({ ...m, reason: b.reason }, { imported: importedFromRow(imported), today: todayMadrid() });
    if (errors.length) throw invalid(['No se puede restaurar tal cual:', ...errors, 'Edítala con la evidencia que falta.']);
  }
  const t = now();
  const status = withdraw ? 'withdrawn' : 'active';
  let w: D1Result;
  try {
    [w] = await db.batch([
      db.prepare(`UPDATE area_run_contributions SET status = ?1, version = version + 1, updated_by = ?2, updated_at = ?3 WHERE id = ?4 AND version = ?5`)
        .bind(status, me, t, current.id, current.version),
      historyInsert(db, areaId, current.id, withdraw ? 'withdraw' : 'restore', me, t, current.version + 1, snapshot(current), snapshot({ ...current, status }), current.source_ref, b.reason),
    ]);
  } catch (e) {
    if (isUnique(e)) throw seasonTaken(current.season);
    throw e;
  }
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  const after = rows.map((r) => (r.id === current.id ? { ...r, status, version: current.version + 1 } : r));
  return c.json({ ok: true, id: current.id, version: current.version + 1, resolved: resolveRows(imported, after) });
});
