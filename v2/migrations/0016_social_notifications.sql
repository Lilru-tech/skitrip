-- Avisos de solicitudes de amistad e invitaciones directas a viajes.
-- Un aviso por persona y origen: «friend_request:<emisor>» y «trip_invitation:<viaje>». Una solicitud o invitación
-- nueva del mismo origen reutiliza el aviso (lo vuelve a marcar sin leer), nunca crea otro.
-- Se crean para las solicitudes e invitaciones directas pendientes anteriores a esta migración; INSERT OR IGNORE
-- y la clave única (user_id, dedupe_key) evitan duplicados si ya existiera alguno. Los enlaces genéricos no tienen
-- destinatario y no generan avisos.
INSERT OR IGNORE INTO notifications (id, user_id, kind, dedupe_key, payload, created_at)
SELECT lower(hex(randomblob(16))), r.to_user, 'friend_request', 'friend_request:' || r.from_user,
       json_object('requestId', r.id, 'fromUserId', r.from_user), r.created_at
FROM friend_requests r
JOIN users f ON f.id = r.from_user AND f.status = 'active'
JOIN users t ON t.id = r.to_user AND t.status = 'active'
WHERE r.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = r.from_user AND b.blocked_id = r.to_user) OR (b.blocker_id = r.to_user AND b.blocked_id = r.from_user));

INSERT OR IGNORE INTO notifications (id, user_id, kind, dedupe_key, payload, created_at)
SELECT lower(hex(randomblob(16))), i.invitee_id, 'trip_invitation', 'trip_invitation:' || i.trip_id,
       json_object('invitationId', i.id, 'tripId', i.trip_id, 'inviterId', i.inviter_id), i.created_at
FROM trip_invitations i
JOIN users u ON u.id = i.invitee_id AND u.status = 'active'
WHERE i.status = 'pending' AND i.invitee_id IS NOT NULL
  AND i.expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = i.inviter_id AND b.blocked_id = i.invitee_id) OR (b.blocker_id = i.invitee_id AND b.blocked_id = i.inviter_id));
