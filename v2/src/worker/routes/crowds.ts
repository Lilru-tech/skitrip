import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, conflict, notFound, now, parseBody } from '../http';
import { zId } from '../schemas';
import { todayMadrid } from '../../core/dates';
import {
  CROWD_MEASURES, CROWD_MIN_YEARS, dailyIntensity, habitualIntensity, sameDaySummary, validateCrowdDraft, validMmdd, weekdayOf, yearsChecked,
  type CrowdDraft, type CrowdObservation, type SameDayKm,
} from '../../core/crowds';

// Afluencia histórica (docs/METEO-AFLUENCIA.md). Lectura pública por estación y día-mes; administración aparte, con
// historial, versión (409) y un único registro activo por ámbito, fecha y medida. La API pública nunca expone autoría
// ni motivo.

const areaParam = (v: string) => {
  const r = zId.safeParse(v);
  if (!r.success) throw notFound('Estación');
  return r.data;
};

const obsFromRow = (r: any): CrowdObservation => ({
  id: r.id, areaId: r.area_id, date: r.obs_date, measure: r.measure, status: r.status, value: r.value ?? null, sample: r.sample,
  sourceRef: r.source_ref, sourceTitle: r.source_title ?? null, sourcePublished: r.source_published ?? null, note: r.note ?? null,
});

export const crowdPublicRoutes = new Hono<AppEnv>();

/**
 * Observaciones del mismo día y mes en años anteriores, de la estación y (si es un dominio) de cada estación miembro por
 * separado. Con los km abiertos del parte de ese mismo día y ámbito cuando existen, y la intensidad diaria si se puede.
 */
crowdPublicRoutes.get('/areas/:id/crowds', async (c) => {
  const id = areaParam(c.req.param('id'));
  const mmdd = c.req.query('dia') ?? '';
  if (!validMmdd(mmdd)) throw new ApiError(422, 'validation', 'Indica el día y el mes como MM-DD (por ejemplo 02-15).');
  const db = c.env.DB;
  const [area, members, obs, first] = await db.batch([
    db.prepare('SELECT id, name, kind FROM areas WHERE id = ?1').bind(id),
    db.prepare('SELECT a.id, a.name FROM area_links l JOIN areas a ON a.id = l.child_id WHERE l.parent_id = ?1 ORDER BY a.name').bind(id),
    db.prepare(`SELECT * FROM crowd_observations WHERE state = 'active' AND substr(obs_date, 6) = ?2
                AND (area_id = ?1 OR area_id IN (SELECT child_id FROM area_links WHERE parent_id = ?1)) ORDER BY obs_date DESC, measure`).bind(id, mmdd),
    db.prepare(`SELECT MIN(substr(obs_date, 1, 4)) AS y FROM crowd_observations WHERE state = 'active'`),
  ]);
  const a = (area.results as any[])[0];
  if (!a) throw notFound('Estación');
  const rows = (obs.results as any[]).map(obsFromRow);
  // Km del parte de esos mismos días y ámbitos (fecha publicada por la fuente igual a la de la observación).
  let km: SameDayKm[] = [];
  if (rows.length) {
    const r = await db.prepare(`SELECT area_id, source_id, source_date, op_status, open_km, quality FROM snow_observations
                                WHERE source_date IN (SELECT value FROM json_each(?1)) AND area_id IN (SELECT value FROM json_each(?2))`)
      .bind(JSON.stringify([...new Set(rows.map((o) => o.date))]), JSON.stringify([...new Set(rows.map((o) => o.areaId))])).all<any>();
    km = r.results.map((k) => ({ areaId: k.area_id, date: k.source_date, sourceDate: k.source_date, openKm: k.open_km, opStatus: k.op_status, quality: k.quality, sourceId: k.source_id }));
  }
  const firstYear = (first.results as any[])[0]?.y ? Number((first.results as any[])[0].y) : null;
  const checked = yearsChecked(mmdd, firstYear, todayMadrid());
  const scopes = [{ id: a.id, name: a.name }, ...(members.results as any[]).map((m) => ({ id: m.id, name: m.name }))];
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({
    mmdd, yearsChecked: checked,
    scopes: scopes.map((s) => ({
      areaId: s.id, name: s.name,
      observations: rows.filter((o) => o.areaId === s.id).map((o) => ({ ...o, weekday: weekdayOf(o.date), intensity: dailyIntensity(o, km) })),
      summary: sameDaySummary(rows, s.id, mmdd, checked),
    })),
  });
});

/**
 * Afluencia habitual de varias estaciones para los días de un viaje (Comparar): mediana de la intensidad diaria de cada
 * ámbito en esos días y meses, con los años que la tienen. 2 sentencias, sea cual sea el número de estaciones.
 */
crowdPublicRoutes.get('/crowds/habitual', async (c) => {
  const ids = [...new Set((c.req.query('areas') ?? '').split(',').filter((x) => zId.safeParse(x).success))].slice(0, 40);
  const days = [...new Set((c.req.query('dias') ?? '').split(','))];
  if (!days.length || days.length > 31 || !days.every(validMmdd)) throw new ApiError(422, 'validation', 'Indica los días como MM-DD separados por comas (31 como mucho).');
  if (!ids.length) return c.json({ areas: [] });
  const db = c.env.DB;
  const obs = (await db.prepare(`SELECT * FROM crowd_observations WHERE state = 'active' AND measure = 'daily_skiers' AND status = 'value' AND sample = 'regular'
                                 AND area_id IN (SELECT value FROM json_each(?1)) AND substr(obs_date, 6) IN (SELECT value FROM json_each(?2))`)
    .bind(JSON.stringify(ids), JSON.stringify(days)).all<any>()).results.map(obsFromRow);
  let km: SameDayKm[] = [];
  if (obs.length) {
    const r = await db.prepare(`SELECT area_id, source_id, source_date, op_status, open_km, quality FROM snow_observations
                                WHERE source_date IN (SELECT value FROM json_each(?1)) AND area_id IN (SELECT value FROM json_each(?2))`)
      .bind(JSON.stringify([...new Set(obs.map((o) => o.date))]), JSON.stringify([...new Set(obs.map((o) => o.areaId))])).all<any>();
    km = r.results.map((k) => ({ areaId: k.area_id, date: k.source_date, sourceDate: k.source_date, openKm: k.open_km, opStatus: k.op_status, quality: k.quality, sourceId: k.source_id }));
  }
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({ minYears: CROWD_MIN_YEARS, areas: ids.map((id) => ({ areaId: id, ...habitualIntensity(obs, km, id, days) })) });
});

// ---------- Administración ----------

export const crowdAdminRoutes = new Hono<AppEnv>();
crowdAdminRoutes.use('*', async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new ApiError(404, 'not_found', 'Ruta no encontrada.');
  await next();
});

const zText = (max: number) => z.string().trim().max(max);
const zSave = z.object({
  /** null = observación nueva; si no, la que se corrige. */
  observationId: z.number().int().positive().nullable().default(null),
  expectedVersion: z.number().int().positive().nullable(),
  areaId: zId,
  date: zText(10),
  measure: z.enum(CROWD_MEASURES as [string, ...string[]]),
  status: z.enum(['value', 'closed']),
  value: z.number().int().min(0).max(1_000_000).nullable(),
  sample: z.enum(['regular', 'record', 'selected']),
  sourceRef: zText(500),
  sourceTitle: zText(300).nullable(),
  sourcePublished: zText(10).nullable(),
  note: zText(1000).nullable(),
  reason: zText(300),
});
const zAction = z.object({ expectedVersion: z.number().int().positive(), reason: zText(300).min(5, 'explica el motivo') });

const CONFLICT = 'Otro administrador ha cambiado esta observación mientras la editabas. Recarga para ver la versión actual antes de guardar.';
const DUPLICATE = 'Ya hay una observación activa de esa estación, fecha y medida: corrígela en lugar de crear otra.';
const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
const snapshot = (r: any) => r && ({
  areaId: r.area_id ?? r.areaId, date: r.obs_date ?? r.date, measure: r.measure, status: r.status, value: r.value ?? null, sample: r.sample,
  sourceRef: r.source_ref ?? r.sourceRef, sourceTitle: r.source_title ?? r.sourceTitle ?? null, sourcePublished: r.source_published ?? r.sourcePublished ?? null,
  note: r.note ?? null, state: r.state ?? 'active',
});
// El historial va en el mismo batch y solo se anota si la escritura con esa versión, instante y autor se ha producido.
const historyInsert = (db: D1Database, obsId: number | null, key: { areaId: string; date: string; measure: string }, action: string, me: string, t: number, version: number, before: unknown, after: unknown, sourceRef: string, reason: string) =>
  db.prepare(`INSERT INTO crowd_history (observation_id, area_id, action, actor_id, at, before_json, after_json, source_ref, reason, version)
              SELECT o.id, o.area_id, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM crowd_observations o
              WHERE o.version = ?8 AND o.updated_at = ?3 AND o.updated_by = ?2 AND (?9 IS NULL OR o.id = ?9)
                AND (?9 IS NOT NULL OR (o.area_id = ?10 AND o.obs_date = ?11 AND o.measure = ?12 AND o.state = 'active')) LIMIT 1`)
    .bind(action, me, t, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), sourceRef, reason, version, obsId, key.areaId, key.date, key.measure);

const adminOut = (r: any) => ({ ...obsFromRow(r), reason: r.reason, origin: r.origin, state: r.state, version: r.version, updatedAt: r.updated_at, updatedByAlias: r.updated_by_alias ?? null });

/** Todas las observaciones (activas y retiradas) con su área, para la pestaña de Administración. */
crowdAdminRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const [areas, rows] = await db.batch([
    db.prepare('SELECT id, name, kind FROM areas WHERE active = 1 ORDER BY name'),
    db.prepare(`SELECT o.*, u.alias AS updated_by_alias FROM crowd_observations o LEFT JOIN users u ON u.id = o.updated_by ORDER BY o.obs_date DESC, o.id DESC LIMIT 500`),
  ]);
  return c.json({ today: todayMadrid(), areas: areas.results, observations: (rows.results as any[]).map(adminOut) });
});

crowdAdminRoutes.get('/:obsId{[0-9]+}/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.action, h.at, h.before_json, h.after_json, h.source_ref, h.reason, h.version, h.actor_id, u.alias AS actor_alias
     FROM crowd_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.observation_id = ?1 ORDER BY h.id DESC LIMIT 100`,
  ).bind(Number(c.req.param('obsId'))).all<any>();
  return c.json({
    history: results.map((h) => ({ id: h.id, action: h.action, at: h.at, actor: h.action === 'seed' ? null : h.actor_alias ?? 'cuenta eliminada',
      before: h.before_json ? JSON.parse(h.before_json) : null, after: h.after_json ? JSON.parse(h.after_json) : null, sourceRef: h.source_ref, reason: h.reason, version: h.version })),
  });
});

crowdAdminRoutes.put('/', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, zSave);
  const db = c.env.DB;
  const draft: CrowdDraft = {
    areaId: b.areaId, date: b.date, measure: b.measure as CrowdDraft['measure'], status: b.status, value: b.value, sample: b.sample,
    sourceRef: b.sourceRef, sourceTitle: b.sourceTitle || null, sourcePublished: b.sourcePublished || null, note: b.note || null, reason: b.reason,
  };
  const errors = validateCrowdDraft(draft, todayMadrid());
  if (errors.length) throw new ApiError(422, 'validation', errors.join(' '));
  const [area, cur] = await db.batch([
    db.prepare('SELECT id FROM areas WHERE id = ?1').bind(draft.areaId),
    db.prepare('SELECT * FROM crowd_observations WHERE id = ?1').bind(b.observationId ?? -1),
  ]);
  if (!area.results.length) throw notFound('Estación');
  const current = (cur.results as any[])[0] ?? null;
  if (b.observationId != null && !current) throw notFound('Observación');
  if ((current?.version ?? null) !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  const t = now();
  const version = (current?.version ?? 0) + 1;
  const vals = [draft.areaId, draft.date, draft.measure, draft.status, draft.value, draft.sample, draft.sourceRef, draft.sourceTitle, draft.sourcePublished, draft.note, draft.reason, me, t];
  const write = current
    ? db.prepare(`UPDATE crowd_observations SET area_id = ?1, obs_date = ?2, measure = ?3, status = ?4, value = ?5, sample = ?6, source_ref = ?7, source_title = ?8,
                  source_published = ?9, note = ?10, reason = ?11, updated_by = ?12, updated_at = ?13, version = version + 1 WHERE id = ?14 AND version = ?15`)
      .bind(...vals, current.id, current.version)
    : db.prepare(`INSERT INTO crowd_observations (area_id, obs_date, measure, status, value, sample, source_ref, source_title, source_published, note, reason,
                  updated_by, updated_at, created_by, created_at, origin, state, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?12, ?13, 'admin', 'active', 1)`).bind(...vals);
  let w: D1Result;
  try {
    [w] = await db.batch([write, historyInsert(db, current?.id ?? null, draft, current ? 'update' : 'create', me, t, version, snapshot(current), snapshot(draft), draft.sourceRef, draft.reason)]);
  } catch (e) {
    if (isUnique(e)) throw conflict(DUPLICATE, 'duplicate');
    throw e;
  }
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  return c.json({ ok: true, id: current?.id ?? (w.meta.last_row_id as number), version });
});

crowdAdminRoutes.post('/:obsId{[0-9]+}/:action{withdraw|restore}', async (c) => {
  const withdraw = c.req.param('action') === 'withdraw';
  const me = c.get('user').id;
  const b = await parseBody(c, zAction);
  const db = c.env.DB;
  const current = await db.prepare('SELECT * FROM crowd_observations WHERE id = ?1').bind(Number(c.req.param('obsId'))).first<any>();
  if (!current) throw notFound('Observación');
  if (current.version !== b.expectedVersion) throw conflict(CONFLICT, 'version_conflict');
  if (withdraw && current.state !== 'active') throw conflict('La observación ya está retirada.', 'already_withdrawn');
  if (!withdraw && current.state === 'active') throw conflict('La observación ya está activa.', 'already_active');
  const t = now();
  const state = withdraw ? 'withdrawn' : 'active';
  let w: D1Result;
  try {
    [w] = await db.batch([
      db.prepare('UPDATE crowd_observations SET state = ?1, version = version + 1, updated_by = ?2, updated_at = ?3 WHERE id = ?4 AND version = ?5').bind(state, me, t, current.id, current.version),
      historyInsert(db, current.id, { areaId: current.area_id, date: current.obs_date, measure: current.measure }, withdraw ? 'withdraw' : 'restore', me, t, current.version + 1,
        snapshot(current), snapshot({ ...current, state }), current.source_ref, b.reason),
    ]);
  } catch (e) {
    if (isUnique(e)) throw conflict(DUPLICATE, 'duplicate');
    throw e;
  }
  if (!w.meta.changes) throw conflict(CONFLICT, 'version_conflict');
  return c.json({ ok: true, id: current.id, version: current.version + 1 });
});
