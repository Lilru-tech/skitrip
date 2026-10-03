import { Hono } from 'hono';
import { z } from 'zod';
import { dailyCounts, findCandidateWindows, type DayStatus, type PersonDays } from '../../core/calendar';
import { daysBetween, eachDay, weekdayMon0 } from '../../core/dates';
import type { AppEnv } from '../env';
import { requireTripMember, visibleAvailabilityOwners } from '../access';
import { ApiError, conflict, newId, notFound, now, parseBody, parseQuery } from '../http';
import { zDate, zId } from '../schemas';

export const availabilityRoutes = new Hono<AppEnv>();

const MAX_RANGE_DAYS = 366;
const zRange = z.object({ from: zDate, to: zDate }).refine((r) => r.to >= r.from && daysBetween(r.from, r.to) <= MAX_RANGE_DAYS, 'rango no válido (máx. 366 días)');

async function loadDays(db: D1Database, userIds: string[], from: string, to: string): Promise<Map<string, Map<string, DayStatus>>> {
  const out = new Map<string, Map<string, DayStatus>>(userIds.map((id) => [id, new Map()]));
  if (!userIds.length) return out;
  const { results } = await db.prepare(`SELECT user_id, day, status FROM availability WHERE day BETWEEN ?1 AND ?2 AND user_id IN (SELECT value FROM json_each(?3))`)
    .bind(from, to, JSON.stringify(userIds)).all<{ user_id: string; day: string; status: DayStatus }>();
  for (const r of results) out.get(r.user_id)!.set(r.day, r.status);
  return out;
}

const toObj = (m: Map<string, DayStatus>) => Object.fromEntries(m);

availabilityRoutes.get('/me', async (c) => {
  const me = c.get('user').id;
  const { from, to } = parseQuery(c, zRange);
  const days = await loadDays(c.env.DB, [me], from, to);
  return c.json({ days: toObj(days.get(me)!) });
});

// Solo se edita la disponibilidad propia: el usuario sale del token, no del cuerpo.
availabilityRoutes.put('/me', async (c) => {
  const me = c.get('user').id;
  const body = await parseBody(c, z.object({
    set: z.array(z.object({ day: zDate, status: z.enum(['free', 'busy', 'maybe']).nullable() })).max(400).optional(),
    range: z.object({
      from: zDate, to: zDate,
      status: z.enum(['free', 'busy', 'maybe']).nullable(),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(), // 0 = lunes
    }).optional(),
  }));
  const changes = new Map<string, DayStatus | null>();
  if (body.range) {
    const r = body.range;
    if (r.to < r.from || daysBetween(r.from, r.to) > MAX_RANGE_DAYS) throw new ApiError(422, 'validation', 'Rango no válido (máx. 366 días).');
    const wd = r.weekdays ? new Set(r.weekdays) : null;
    for (const d of eachDay(r.from, r.to)) if (!wd || wd.has(weekdayMon0(d))) changes.set(d, r.status);
  }
  // Los días sueltos se aplican después del rango: sirven de excepciones al patrón semanal.
  for (const s of body.set ?? []) changes.set(s.day, s.status);
  const t = now();
  const upserts = [...changes].filter(([, s]) => s !== null).map(([day, status]) => ({ day, status }));
  const deletes = [...changes].filter(([, s]) => s === null).map(([day]) => day);
  // Dos sentencias fijas, en una transacción, para cualquier tamaño (temporada completa incluida).
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO availability (user_id, day, status, updated_at)
                      SELECT ?1, json_extract(value, '$.day'), json_extract(value, '$.status'), ?2 FROM json_each(?3) WHERE true
                      ON CONFLICT (user_id, day) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).bind(me, t, JSON.stringify(upserts)),
    c.env.DB.prepare(`DELETE FROM availability WHERE user_id = ?1 AND day IN (SELECT value FROM json_each(?2))`).bind(me, JSON.stringify(deletes)),
  ]);
  return c.json({ ok: true, changed: changes.size });
});

availabilityRoutes.get('/shares', async (c) => {
  const me = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    `SELECT s.scope, s.trip_id, t.name AS trip_name FROM availability_shares s LEFT JOIN trips t ON t.id = s.trip_id WHERE s.owner_id = ?1`,
  ).bind(me).all<{ scope: string; trip_id: string | null; trip_name: string | null }>();
  return c.json({ friends: results.some((r) => r.scope === 'friends'), trips: results.filter((r) => r.scope === 'trip').map((r) => ({ id: r.trip_id, name: r.trip_name })) });
});

// Sustituye la configuración completa. Revocar = quitar del conjunto; la API deja de servir esos datos al instante.
availabilityRoutes.put('/shares', async (c) => {
  const me = c.get('user').id;
  const body = await parseBody(c, z.object({ friends: z.boolean(), tripIds: z.array(zId).max(50) }));
  const tripIds = [...new Set(body.tripIds)];
  if (tripIds.length) {
    const { results: mine } = await c.env.DB.prepare(`SELECT trip_id FROM trip_members WHERE user_id = ?1 AND trip_id IN (SELECT value FROM json_each(?2))`)
      .bind(me, JSON.stringify(tripIds)).all<{ trip_id: string }>();
    if (mine.length !== tripIds.length) throw notFound('Viaje');
  }
  const t = now();
  const stmts = [c.env.DB.prepare('DELETE FROM availability_shares WHERE owner_id = ?1').bind(me)];
  if (body.friends) stmts.push(c.env.DB.prepare(`INSERT INTO availability_shares (id, owner_id, scope, created_at) VALUES (?1, ?2, 'friends', ?3)`).bind(newId(), me, t));
  if (tripIds.length) stmts.push(c.env.DB.prepare(`INSERT INTO availability_shares (id, owner_id, scope, trip_id, created_at)
    SELECT lower(hex(randomblob(16))), ?1, 'trip', value, ?2 FROM json_each(?3)`).bind(me, t, JSON.stringify(tripIds)));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/** Personas cuya disponibilidad puedo ver ahora mismo (para elegir participantes de la vista común). */
availabilityRoutes.get('/visible', async (c) => {
  const me = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT u.id, u.alias FROM availability_shares s JOIN users u ON u.id = s.owner_id
     WHERE s.owner_id <> ?1 AND u.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = s.owner_id AND b.blocked_id = ?1) OR (b.blocker_id = ?1 AND b.blocked_id = s.owner_id))
       AND (
         (s.scope = 'friends' AND EXISTS (SELECT 1 FROM friendships f WHERE (f.user_a = ?1 AND f.user_b = s.owner_id) OR (f.user_b = ?1 AND f.user_a = s.owner_id)))
         OR (s.scope = 'trip' AND EXISTS (SELECT 1 FROM trip_members m1 JOIN trip_members m2 ON m2.trip_id = m1.trip_id
                                          WHERE m1.trip_id = s.trip_id AND m1.user_id = s.owner_id AND m2.user_id = ?1))
       )
     ORDER BY u.alias_norm`,
  ).bind(me).all();
  return c.json({ users: results });
});

async function commonView(db: D1Database, viewer: string, ids: string[], from: string, to: string, tripId?: string) {
  const allowed = await visibleAvailabilityOwners(db, viewer, ids, tripId);
  const visible = ids.filter((id) => allowed.has(id));
  const days = await loadDays(db, visible, from, to);
  const people: PersonDays[] = ids.map((id) => ({ id, days: days.get(id) ?? null }));
  return people;
}

const zCommon = z.object({
  from: zDate, to: zDate,
  nights: z.coerce.number().int().min(0).max(30).default(2),
  min: z.coerce.number().int().min(1).max(60).optional(),
});

/** Vista común con personas elegidas. Quien no comparte aparece como «no compartido», nunca con datos. */
availabilityRoutes.get('/common', async (c) => {
  const me = c.get('user').id;
  const q = parseQuery(c, zCommon.extend({ ids: z.string().max(2000) }));
  if (q.to < q.from || daysBetween(q.from, q.to) > MAX_RANGE_DAYS) throw new ApiError(422, 'validation', 'Rango no válido.');
  const ids = [...new Set([me, ...q.ids.split(',').map((s) => s.trim()).filter(Boolean)])].slice(0, 30);
  const people = await commonView(c.env.DB, me, ids, q.from, q.to);
  const { results: aliases } = await c.env.DB.prepare(`SELECT id, alias FROM users WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(people.map((p) => p.id))).all<{ id: string; alias: string }>();
  const aliasBy = new Map(aliases.map((a) => [a.id, a.alias]));
  return c.json(buildResponse(people, q, aliasBy));
});

/**
 * Sin mínimo explícito, «todos» significa todas las personas que comparten su disponibilidad con quien consulta.
 * Quien no comparte no puede confirmarse ni descartarse: se informa en `requirement.notSharing`, nunca se cuenta como libre.
 */
function buildResponse(people: PersonDays[], q: { from: string; to: string; nights: number; min?: number }, aliasBy?: Map<string, string>) {
  const sharing = people.filter((p) => p.days !== null).length;
  const need = q.min ?? sharing;
  return {
    people: people.map((p) => ({ id: p.id, ...(aliasBy ? { alias: aliasBy.get(p.id) ?? null } : {}), shared: p.days !== null, days: p.days ? toObj(p.days) : null })),
    daily: dailyCounts(people, q.from, q.to),
    requirement: { mode: q.min != null ? 'min' : 'all_sharing', need, total: people.length, sharing, notSharing: people.length - sharing },
    windows: findCandidateWindows(people, { from: q.from, to: q.to, nights: q.nights, minPeople: need, limit: 30 }),
  };
}

/** Vista común de un viaje: miembros actuales; cada uno visible solo si lo comparte con quien consulta. */
availabilityRoutes.get('/trip/:tripId', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('tripId');
  await requireTripMember(c.env.DB, tripId, me);
  const q = parseQuery(c, zCommon);
  if (q.to < q.from || daysBetween(q.from, q.to) > MAX_RANGE_DAYS) throw new ApiError(422, 'validation', 'Rango no válido.');
  const { results: members } = await c.env.DB.prepare(`SELECT u.id, u.alias FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ?1 ORDER BY m.joined_at`).bind(tripId).all<{ id: string; alias: string }>();
  const people = await commonView(c.env.DB, me, members.map((m) => m.id), q.from, q.to, undefined);
  const { results: proposals } = await c.env.DB.prepare(
    `SELECT p.id, p.start_date, p.end_date, p.proposed_by, u.alias AS proposed_by_alias,
            (SELECT json_group_array(json_object('userId', v.user_id, 'value', v.value)) FROM date_votes v WHERE v.proposal_id = p.id) AS votes
     FROM date_proposals p JOIN users u ON u.id = p.proposed_by WHERE p.trip_id = ?1 ORDER BY p.start_date`,
  ).bind(tripId).all<{ votes: string }>();
  return c.json({ members, ...buildResponse(people, q), proposals: proposals.map((p) => ({ ...p, votes: JSON.parse(p.votes) })) });
});

availabilityRoutes.post('/trip/:tripId/proposals', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('tripId');
  await requireTripMember(c.env.DB, tripId, me);
  const { start, end } = await parseBody(c, z.object({ start: zDate, end: zDate }));
  if (end < start || daysBetween(start, end) > 30) throw new ApiError(422, 'validation', 'Propuesta de fechas no válida.');
  const id = newId();
  try {
    await c.env.DB.prepare('INSERT INTO date_proposals (id, trip_id, start_date, end_date, proposed_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, tripId, start, end, me, now()).run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw conflict('Esas fechas ya están propuestas.');
    throw e;
  }
  return c.json({ id }, 201);
});

availabilityRoutes.put('/trip/:tripId/proposals/:pid/vote', async (c) => {
  const me = c.get('user').id;
  const tripId = c.req.param('tripId');
  await requireTripMember(c.env.DB, tripId, me);
  const { value } = await parseBody(c, z.object({ value: z.enum(['yes', 'maybe', 'no']).nullable() }));
  const p = await c.env.DB.prepare('SELECT id FROM date_proposals WHERE id = ?1 AND trip_id = ?2').bind(c.req.param('pid'), tripId).first();
  if (!p) throw notFound('Propuesta');
  if (value === null) await c.env.DB.prepare('DELETE FROM date_votes WHERE proposal_id = ?1 AND user_id = ?2').bind(c.req.param('pid'), me).run();
  else await c.env.DB.prepare(`INSERT INTO date_votes (proposal_id, user_id, value, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (proposal_id, user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(c.req.param('pid'), me, value, now()).run();
  return c.json({ ok: true });
});
