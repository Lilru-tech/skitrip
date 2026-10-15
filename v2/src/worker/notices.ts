// Avisos de solicitudes de amistad e invitaciones directas a viajes. Cada función devuelve una sentencia para ir en el
// mismo batch (transacción) que el cambio que la origina: si la solicitud o invitación no se crea, tampoco el aviso.
//
// Un aviso por destinatario y origen (clave «friend_request:<emisor>» / «trip_invitation:<viaje>»): reintentar no lo
// duplica y una solicitud nueva tras cancelar reutiliza el mismo aviso apuntando a la solicitud vigente.
// El estado (pendiente, aceptada, caducada…) no se copia en el aviso: se lee al listar, así nunca ofrece acciones
// que ya no son válidas.

const UPSERT = `INSERT INTO notifications (id, user_id, kind, dedupe_key, payload, created_at) VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (user_id, dedupe_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, read_at = NULL`;

export const friendRequestNotice = (db: D1Database, to: string, from: string, requestId: string, t: number) =>
  db.prepare(UPSERT).bind(to, 'friend_request', `friend_request:${from}`, JSON.stringify({ requestId, fromUserId: from }), t);

export const tripInvitationNotice = (db: D1Database, invitee: string, tripId: string, invitationId: string, inviterId: string, t: number) =>
  db.prepare(UPSERT).bind(invitee, 'trip_invitation', `trip_invitation:${tripId}`, JSON.stringify({ invitationId, tripId, inviterId }), t);

/** Marca como leído el aviso de una solicitud o invitación concreta cuando deja de estar pendiente (nada que hacer). */
export const closeNotice = (db: D1Database, userId: string, kind: 'friend_request' | 'trip_invitation', sourceId: string, t: number) =>
  db.prepare(`UPDATE notifications SET read_at = ?4 WHERE user_id = ?1 AND kind = ?2 AND read_at IS NULL
              AND json_extract(payload, ?3) = ?5`).bind(userId, kind, kind === 'friend_request' ? '$.requestId' : '$.invitationId', t, sourceId);

/** Al bloquear: cierra los avisos de solicitudes e invitaciones entre las dos personas, en ambos sentidos. */
export const closeNoticesBetween = (db: D1Database, a: string, b: string, t: number) =>
  db.prepare(`UPDATE notifications SET read_at = ?3 WHERE read_at IS NULL AND user_id IN (?1, ?2) AND kind IN ('friend_request', 'trip_invitation')
              AND coalesce(json_extract(payload, '$.fromUserId'), json_extract(payload, '$.inviterId')) IN (?1, ?2)`).bind(a, b, t);
