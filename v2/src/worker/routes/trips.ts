import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { areFriends, audit, isBlocked, requireTripEditor, requireTripMember, requireTripOwner, tripRole } from '../access';
import { ApiError, badRequest, conflict, forbidden, newId, notFound, now, parseBody } from '../http';
import { rateLimit } from '../ratelimit';
import { zCents, zDate, zId, zName } from '../schemas';

export const tripRoutes = new Hono<AppEnv>();

type TripRow = {
  id: string; owner_id: string; name: string; origin_id: string | null; start_date: string | null; end_date: string | null;
  nights: number | null; ski_days: number | null; participants_planned: number | null; cars: number | null;
  budget_cents: number | null; area_id: string | null; status: string; members_can_invite: number; version: number;
  created_at: number; updated_at: number;
};

const tripOut = (t: TripRow) => ({
  id: t.id, ownerId: t.owner_id, name: t.name, originId: t.origin_id, startDate: t.start_date, endDate: t.end_date,
  nights: t.nights, skiDays: t.ski_days, participantsPlanned: t.participants_planned, cars: t.cars,
  budgetCents: t.budget_cents, areaId: t.area_id, status: t.status, membersCanInvite: !!t.members_can_invite,
  version: t.version, createdAt: t.created_at, updatedAt: t.updated_at,
});

const tripFields = z.object({
  name: zName,
  originId: zId.nullable().optional(),
  startDate: zDate.nullable().optional(),
  endDate: zDate.nullable().optional(),
  nights: z.number().int().min(0).max(60).nullable().optional(),
  skiDays: z.number().int().min(0).max(60).nullable().optional(),
  participantsPlanned: z.number().int().min(1).max(60).nullable().optional(),
  cars: z.number().int().min(0).max(20).nullable().optional(),
  budgetCents: zCents.nullable().optional(),
  areaId: zId.nullable().optional(),
  status: z.enum(['planning', 'decided', 'done', 'cancelled']).optional(),
  membersCanInvite: z.boolean().optional(),
});

const COLS: Record<string, string> = {
  name: 'name', originId: 'origin_id', startDate: 'start_date', endDate: 'end_date', nights: 'nights', skiDays: 'ski_days',
  participantsPlanned: 'participants_planned', cars: 'cars', budgetCents: 'budget_cents', areaId: 'area_id', status: 'status',
  membersCanInvite: 'members_can_invite',
};

function checkDates(start?: string | null, end?: string | null) {
  if (start && end && end < start) throw new ApiError(422, 'validation', 'La fecha de vuelta no puede ser anterior a la de ida.');
}

tripRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, m.role FROM trips t JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?1
     ORDER BY COALESCE(t.start_date, '9999') ASC, t.created_at DESC LIMIT 200`,
  ).bind(c.get('user').id).all<TripRow & { role: string }>();
  return c.json({ trips: results.map((t) => ({ ...tripOut(t), role: t.role })) });
});

tripRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await parseBody(c, tripFields);
  checkDates(body.startDate, body.endDate);
  await rateLimit(c.env.DB, `trip_create:${user.id}`, 30, 86400);
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO trips (id, owner_id, name, origin_id, start_date, end_date, nights, ski_days, participants_planned, cars,
                          budget_cents, area_id, status, members_can_invite, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    ).bind(id, user.id, body.name, body.originId ?? 'tarragona', body.startDate ?? null, body.endDate ?? null, body.nights ?? null,
      body.skiDays ?? null, body.participantsPlanned ?? null, body.cars ?? null, body.budgetCents ?? null, body.areaId ?? null,
      body.status ?? 'planning', body.membersCanInvite ? 1 : 0, t),
    c.env.DB.prepare(`INSERT INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)`).bind(id, user.id, t),
  ]);
  const trip = await c.env.DB.prepare('SELECT * FROM trips WHERE id = ?1').bind(id).first<TripRow>();
  return c.json({ trip: { ...tripOut(trip!), role: 'owner' } }, 201);
});

// ---- Invitaciones (antes de /:id para que el enrutado no las confunda con un viaje) ----

tripRoutes.get('/invitations/mine', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.trip_id, t.name AS trip_name, u.alias AS inviter_alias, i.expires_at, i.created_at
     FROM trip_invitations i JOIN trips t ON t.id = i.trip_id JOIN users u ON u.id = i.inviter_id
     WHERE i.invitee_id = ?1 AND i.status = 'pending' AND i.expires_at > ?2 ORDER BY i.created_at DESC`,
  ).bind(c.get('user').id, now()).all();
  return c.json({ invitations: results });
});

async function joinTrip(db: D1Database, tripId: string, userId: string, t: number) {
  await db.prepare(`INSERT INTO trip_members (trip_id, user_id, role, joined_at) VALUES (?1, ?2, 'member', ?3) ON CONFLICT DO NOTHING`)
    .bind(tripId, userId, t).run();
}

tripRoutes.post('/invitations/:invId/:action{accept|decline}', async (c) => {
  const user = c.get('user');
  const inv = await c.env.DB.prepare(`SELECT * FROM trip_invitations WHERE id = ?1 AND invitee_id = ?2`)
    .bind(c.req.param('invId'), user.id).first<{ id: string; trip_id: string; inviter_id: string; status: string; expires_at: number }>();
  if (!inv) throw notFound('Invitación');
  const t = now();
  if (inv.status !== 'pending') throw conflict('Esta invitación ya no está pendiente.', 'invitation_closed');
  if (inv.expires_at <= t) {
    await c.env.DB.prepare(`UPDATE trip_invitations SET status = 'expired' WHERE id = ?1`).bind(inv.id).run();
    throw conflict('La invitación ha caducado.', 'invitation_expired');
  }
  const accept = c.req.param('action') === 'accept';
  const upd = await c.env.DB.prepare(`UPDATE trip_invitations SET status = ?1, responded_at = ?2 WHERE id = ?3 AND status = 'pending'`)
    .bind(accept ? 'accepted' : 'declined', t, inv.id).run();
  if (!upd.meta.changes) throw conflict('Esta invitación ya no está pendiente.', 'invitation_closed');
  if (accept) await joinTrip(c.env.DB, inv.trip_id, user.id, t);
  return c.json({ ok: true, tripId: accept ? inv.trip_id : null });
});

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

tripRoutes.post('/invitations/accept-link', async (c) => {
  const user = c.get('user');
  const { token } = await parseBody(c, z.object({ token: z.string().min(20).max(100) }));
  await rateLimit(c.env.DB, `invite_link:${user.id}`, 20, 3600);
  const hash = await sha256Hex(token);
  const t = now();
  const inv = await c.env.DB.prepare(`SELECT * FROM trip_invitations WHERE link_token_hash = ?1`).bind(hash)
    .first<{ id: string; trip_id: string; inviter_id: string; status: string; expires_at: number; uses: number; max_uses: number }>();
  if (!inv || inv.status !== 'pending' || inv.expires_at <= t || inv.uses >= inv.max_uses) throw notFound('Invitación');
  if (await isBlocked(c.env.DB, user.id, inv.inviter_id)) throw notFound('Invitación');
  if (await tripRole(c.env.DB, inv.trip_id, user.id)) return c.json({ ok: true, tripId: inv.trip_id });
  const upd = await c.env.DB.prepare(
    `UPDATE trip_invitations SET uses = uses + 1, status = CASE WHEN uses + 1 >= max_uses THEN 'accepted' ELSE status END
     WHERE id = ?1 AND status = 'pending' AND uses < max_uses AND expires_at > ?2`,
  ).bind(inv.id, t).run();
  if (!upd.meta.changes) throw notFound('Invitación');
  await joinTrip(c.env.DB, inv.trip_id, user.id, t);
  return c.json({ ok: true, tripId: inv.trip_id });
});

// ---- Viaje concreto ----

async function loadTrip(db: D1Database, id: string) {
  const t = await db.prepare('SELECT * FROM trips WHERE id = ?1').bind(id).first<TripRow>();
  if (!t) throw notFound('Viaje');
  return t;
}

tripRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await requireTripMember(c.env.DB, id, user.id);
  const trip = await loadTrip(c.env.DB, id);
  const { results: members } = await c.env.DB.prepare(
    `SELECT u.id, u.alias, m.role, m.joined_at FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id = ?1 ORDER BY m.joined_at`,
  ).bind(id).all();
  let invitations: unknown[] = [];
  if (role !== 'member' || trip.members_can_invite) {
    invitations = (await c.env.DB.prepare(
      `SELECT i.id, i.invitee_id, u.alias AS invitee_alias, i.link_token_hash IS NOT NULL AS is_link, i.status, i.expires_at, i.uses, i.max_uses
       FROM trip_invitations i LEFT JOIN users u ON u.id = i.invitee_id WHERE i.trip_id = ?1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
    ).bind(id).all()).results;
  }
  return c.json({ trip: { ...tripOut(trip), role }, members, invitations });
});

tripRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await requireTripEditor(c.env.DB, id, user.id);
  const body = await parseBody(c, tripFields.partial().extend({ version: z.number().int().positive() }));
  const current = await loadTrip(c.env.DB, id);
  checkDates(body.startDate !== undefined ? body.startDate : current.start_date, body.endDate !== undefined ? body.endDate : current.end_date);
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, col] of Object.entries(COLS)) {
    const v = (body as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k === 'membersCanInvite') {
      if (current.owner_id !== user.id) throw forbidden('Solo el propietario decide quién puede invitar.');
      sets.push(`${col} = ?`); args.push(v ? 1 : 0);
    } else {
      sets.push(`${col} = ?`); args.push(v);
    }
  }
  if (!sets.length) return c.json({ trip: tripOut(current) });
  const r = await c.env.DB.prepare(`UPDATE trips SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .bind(...args, now(), id, body.version).run();
  if (!r.meta.changes) throw conflict('Otra persona ha modificado el viaje. Recarga para ver los cambios antes de guardar.', 'version_conflict');
  return c.json({ trip: tripOut(await loadTrip(c.env.DB, id)) });
});

tripRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await requireTripOwner(c.env.DB, id, user.id);
  await c.env.DB.prepare('DELETE FROM trips WHERE id = ?1').bind(id).run();
  await audit(c.env.DB, user.id, 'trip.delete', 'trip', id);
  return c.json({ ok: true });
});

tripRoutes.post('/:id/invitations', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await requireTripMember(c.env.DB, id, user.id);
  const trip = await loadTrip(c.env.DB, id);
  if (role === 'member' && !trip.members_can_invite) throw forbidden('En este viaje solo el propietario y los editores pueden invitar.');
  const body = await parseBody(c, z.union([
    z.object({ userId: zId }),
    z.object({ link: z.literal(true), expiresInHours: z.number().int().min(1).max(24 * 14).default(72), maxUses: z.number().int().min(1).max(20).default(1) }),
  ]));
  await rateLimit(c.env.DB, `invite:${user.id}`, 50, 86400);
  const t = now();
  const invId = newId();
  if ('userId' in body) {
    if (body.userId === user.id) throw badRequest('No puedes invitarte a ti mismo.');
    // Solo se invita a amistades: evita spam a desconocidos. Un bloqueo se trata como «no encontrado».
    if (!(await areFriends(c.env.DB, user.id, body.userId)) || (await isBlocked(c.env.DB, user.id, body.userId))) {
      throw notFound('Amistad');
    }
    if (await tripRole(c.env.DB, id, body.userId)) throw conflict('Esa persona ya es miembro del viaje.', 'already_member');
    await c.env.DB.prepare(
      `INSERT INTO trip_invitations (id, trip_id, inviter_id, invitee_id, status, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)`,
    ).bind(invId, id, user.id, body.userId, t + 14 * 86400_000, t).run().catch((e) => {
      if (/UNIQUE/.test(String(e))) throw conflict('Ya hay una invitación pendiente para esa persona.', 'invitation_pending');
      throw e;
    });
    return c.json({ invitation: { id: invId } }, 201);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await c.env.DB.prepare(
    `INSERT INTO trip_invitations (id, trip_id, inviter_id, link_token_hash, status, expires_at, max_uses, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7)`,
  ).bind(invId, id, user.id, await sha256Hex(token), t + body.expiresInHours * 3600_000, body.maxUses, t).run();
  // El token solo se devuelve una vez; en BD solo queda su hash.
  return c.json({ invitation: { id: invId, token, expiresAt: t + body.expiresInHours * 3600_000 } }, 201);
});

tripRoutes.post('/:id/invitations/:invId/revoke', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await requireTripMember(c.env.DB, id, user.id);
  const inv = await c.env.DB.prepare('SELECT inviter_id FROM trip_invitations WHERE id = ?1 AND trip_id = ?2').bind(c.req.param('invId'), id).first<{ inviter_id: string }>();
  if (!inv) throw notFound('Invitación');
  if (role === 'member' && inv.inviter_id !== user.id) throw forbidden();
  await c.env.DB.prepare(`UPDATE trip_invitations SET status = 'revoked', responded_at = ?1 WHERE id = ?2 AND status = 'pending'`).bind(now(), c.req.param('invId')).run();
  return c.json({ ok: true });
});

tripRoutes.patch('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await requireTripOwner(c.env.DB, id, user.id);
  const { role } = await parseBody(c, z.object({ role: z.enum(['editor', 'member']) }));
  const target = c.req.param('userId');
  if (target === user.id) throw badRequest('Para dejar de ser propietario, transfiere la propiedad.');
  const r = await c.env.DB.prepare(`UPDATE trip_members SET role = ?1 WHERE trip_id = ?2 AND user_id = ?3 AND role <> 'owner'`).bind(role, id, target).run();
  if (!r.meta.changes) throw notFound('Miembro');
  return c.json({ ok: true });
});

// Eliminar a un miembro (propietario) o abandonar el viaje (uno mismo).
tripRoutes.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const target = c.req.param('userId');
  const myRole = await requireTripMember(c.env.DB, id, user.id);
  if (target === user.id) {
    if (myRole === 'owner') throw conflict('Transfiere la propiedad antes de abandonar el viaje.', 'owner_must_transfer');
  } else if (myRole !== 'owner') {
    throw forbidden('Solo el propietario puede quitar miembros.');
  }
  const r = await c.env.DB.prepare(`DELETE FROM trip_members WHERE trip_id = ?1 AND user_id = ?2 AND role <> 'owner'`).bind(id, target).run();
  if (!r.meta.changes) throw notFound('Miembro');
  // La compartición de disponibilidad ligada a este viaje deja de tener sentido.
  await c.env.DB.prepare(`DELETE FROM availability_shares WHERE trip_id = ?1 AND owner_id = ?2`).bind(id, target).run();
  await audit(c.env.DB, user.id, target === user.id ? 'trip.leave' : 'trip.remove_member', 'trip', id, { target });
  return c.json({ ok: true });
});

tripRoutes.post('/:id/transfer', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  await requireTripOwner(c.env.DB, id, user.id);
  const { userId } = await parseBody(c, z.object({ userId: zId }));
  if (userId === user.id) throw badRequest('Ya eres el propietario.');
  if (!(await tripRole(c.env.DB, id, userId))) throw notFound('Miembro');
  const t = now();
  // Orden importante por el índice único de propietario: primero degradar, luego ascender.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE trip_members SET role = 'editor' WHERE trip_id = ?1 AND user_id = ?2`).bind(id, user.id),
    c.env.DB.prepare(`UPDATE trip_members SET role = 'owner' WHERE trip_id = ?1 AND user_id = ?2`).bind(id, userId),
    c.env.DB.prepare(`UPDATE trips SET owner_id = ?1, version = version + 1, updated_at = ?2 WHERE id = ?3`).bind(userId, t, id),
  ]);
  await audit(c.env.DB, user.id, 'trip.transfer', 'trip', id, { to: userId });
  return c.json({ ok: true });
});
