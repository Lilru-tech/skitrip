import { forbidden, notFound } from './http';

export type TripRole = 'owner' | 'editor' | 'member';

export async function tripRole(db: D1Database, tripId: string, userId: string): Promise<TripRole | null> {
  const r = await db.prepare('SELECT role FROM trip_members WHERE trip_id = ?1 AND user_id = ?2').bind(tripId, userId).first<{ role: TripRole }>();
  return r?.role ?? null;
}

/** Miembro del viaje o 404: no revelamos si el viaje existe a quien no pertenece a él. */
export async function requireTripMember(db: D1Database, tripId: string, userId: string): Promise<TripRole> {
  const role = await tripRole(db, tripId, userId);
  if (!role) throw notFound('Viaje');
  return role;
}

export async function requireTripEditor(db: D1Database, tripId: string, userId: string): Promise<TripRole> {
  const role = await requireTripMember(db, tripId, userId);
  if (role === 'member') throw forbidden('Solo el propietario o los editores pueden modificar el viaje.');
  return role;
}

export async function requireTripOwner(db: D1Database, tripId: string, userId: string): Promise<void> {
  const role = await requireTripMember(db, tripId, userId);
  if (role !== 'owner') throw forbidden('Solo el propietario puede hacer esto.');
}

export const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function areFriends(db: D1Database, a: string, b: string): Promise<boolean> {
  const [x, y] = pair(a, b);
  return !!(await db.prepare('SELECT 1 FROM friendships WHERE user_a = ?1 AND user_b = ?2').bind(x, y).first());
}

/** Bloqueo en cualquiera de los dos sentidos. */
export async function isBlocked(db: D1Database, a: string, b: string): Promise<boolean> {
  return !!(await db
    .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ?1 AND blocked_id = ?2) OR (blocker_id = ?2 AND blocked_id = ?1)')
    .bind(a, b)
    .first());
}

/**
 * ¿Puede `viewer` ver la disponibilidad de `owner`? Única función de decisión para todos los
 * endpoints de calendario, de modo que bloqueos y revocaciones no se pueden esquivar por otra ruta.
 * - Uno mismo: sí.
 * - Bloqueo en cualquier sentido: no.
 * - Compartido con «amigos» y existe la amistad hoy: sí.
 * - Compartido con un viaje concreto y ambos son miembros hoy: sí (si se pasa ese viaje, solo ese).
 */
export async function canSeeAvailability(db: D1Database, viewer: string, owner: string, tripId?: string): Promise<boolean> {
  return (await visibleAvailabilityOwners(db, viewer, [owner], tripId)).has(owner);
}

/**
 * Misma regla que canSeeAvailability para varias personas en UNA consulta (presupuesto de D1 por petición).
 * Es la única implementación de la decisión: canSeeAvailability la usa.
 */
export async function visibleAvailabilityOwners(db: D1Database, viewer: string, owners: string[], tripId?: string): Promise<Set<string>> {
  const out = new Set<string>(owners.includes(viewer) ? [viewer] : []);
  const others = owners.filter((o) => o !== viewer);
  if (!others.length) return out;
  const { results } = await db
    .prepare(
      `SELECT o.value AS owner FROM json_each(?1) o
       WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?2 AND b.blocked_id = o.value) OR (b.blocker_id = o.value AND b.blocked_id = ?2))
         AND EXISTS (SELECT 1 FROM availability_shares s WHERE s.owner_id = o.value AND (
           (s.scope = 'friends' AND EXISTS (SELECT 1 FROM friendships f WHERE f.user_a = MIN(?2, o.value) AND f.user_b = MAX(?2, o.value)))
           OR
           (s.scope = 'trip' AND (?3 IS NULL OR s.trip_id = ?3)
             AND EXISTS (SELECT 1 FROM trip_members m1 WHERE m1.trip_id = s.trip_id AND m1.user_id = o.value)
             AND EXISTS (SELECT 1 FROM trip_members m2 WHERE m2.trip_id = s.trip_id AND m2.user_id = ?2))))`,
    )
    .bind(JSON.stringify(others), viewer, tripId ?? null)
    .all<{ owner: string }>();
  for (const r of results) out.add(r.owner);
  return out;
}

export async function audit(db: D1Database, actorId: string | null, action: string, targetType: string, targetId: string | null, detail?: unknown) {
  await db
    .prepare('INSERT INTO audit_log (id, actor_id, action, target_type, target_id, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(crypto.randomUUID(), actorId, action, targetType, targetId, detail === undefined ? null : JSON.stringify(detail), Date.now())
    .run();
}
