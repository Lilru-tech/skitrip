import { Hono } from 'hono';
import { z } from 'zod';
import { normalizeAlias } from '../../core/alias';
import type { AppEnv } from '../env';
import { areFriends, isBlocked, pair } from '../access';
import { badRequest, conflict, newId, notFound, now, parseBody, parseQuery } from '../http';
import { rateLimit } from '../ratelimit';
import { zId } from '../schemas';

export const friendRoutes = new Hono<AppEnv>();

friendRoutes.get('/', async (c) => {
  const me = c.get('user').id;
  const db = c.env.DB;
  const [friends, incoming, outgoing, blocked] = await db.batch([
    db.prepare(
      `SELECT u.id, u.alias, f.created_at AS since FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ?1 OR f.user_b = ?1 ORDER BY u.alias_norm`,
    ).bind(me),
    db.prepare(`SELECT r.id, u.id AS user_id, u.alias, r.created_at FROM friend_requests r JOIN users u ON u.id = r.from_user WHERE r.to_user = ?1 AND r.status = 'pending' ORDER BY r.created_at DESC`).bind(me),
    db.prepare(`SELECT r.id, u.id AS user_id, u.alias, r.created_at FROM friend_requests r JOIN users u ON u.id = r.to_user WHERE r.from_user = ?1 AND r.status = 'pending' ORDER BY r.created_at DESC`).bind(me),
    db.prepare(`SELECT u.id, u.alias FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?1`).bind(me),
  ]);
  return c.json({ friends: friends.results, incoming: incoming.results, outgoing: outgoing.results, blocked: blocked.results });
});

// Búsqueda por alias. Nunca devuelve emails. Oculta a quien me bloqueó y a quien bloqueé.
friendRoutes.get('/search', async (c) => {
  const me = c.get('user').id;
  const { q } = parseQuery(c, z.object({ q: z.string().min(2).max(24) }));
  const norm = normalizeAlias(q.trim()).replace(/[%_\\]/g, (m) => `\\${m}`);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.alias FROM users u
     WHERE u.alias_norm LIKE ?1 ESCAPE '\\' AND u.id <> ?2 AND u.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?2) OR (b.blocker_id = ?2 AND b.blocked_id = u.id))
     ORDER BY u.alias_norm LIMIT 10`,
  ).bind(`${norm}%`, me).all();
  return c.json({ users: results });
});

friendRoutes.post('/requests', async (c) => {
  const me = c.get('user').id;
  const { userId } = await parseBody(c, z.object({ userId: zId }));
  if (userId === me) throw badRequest('No puedes enviarte una solicitud a ti mismo.', 'self_friend');
  await rateLimit(c.env.DB, `friend_req:${me}`, 30, 86400);
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?1 AND status = 'active'`).bind(userId).first();
  // Un bloqueo en cualquier sentido se responde igual que un usuario inexistente.
  if (!target || (await isBlocked(c.env.DB, me, userId))) throw notFound('Usuario');
  if (await areFriends(c.env.DB, me, userId)) throw conflict('Ya sois amigos.', 'already_friends');

  const t = now();
  // Solicitud cruzada: si la otra persona ya me la envió, aceptarla en lugar de crear otra.
  const reverse = await c.env.DB.prepare(`SELECT id FROM friend_requests WHERE from_user = ?1 AND to_user = ?2 AND status = 'pending'`).bind(userId, me).first<{ id: string }>();
  if (reverse) {
    const [a, b] = pair(me, userId);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE friend_requests SET status = 'accepted', responded_at = ?1 WHERE id = ?2 AND status = 'pending'`).bind(t, reverse.id),
      c.env.DB.prepare(`INSERT INTO friendships (user_a, user_b, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`).bind(a, b, t),
    ]);
    return c.json({ status: 'accepted', requestId: reverse.id });
  }
  const id = newId();
  try {
    await c.env.DB.prepare(`INSERT INTO friend_requests (id, from_user, to_user, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)`).bind(id, me, userId, t).run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) throw conflict('Ya enviaste una solicitud a esta persona.', 'request_pending');
    throw e;
  }
  return c.json({ status: 'pending', requestId: id }, 201);
});

friendRoutes.post('/requests/:id/:action{accept|reject|cancel}', async (c) => {
  const me = c.get('user').id;
  const action = c.req.param('action');
  const req = await c.env.DB.prepare(`SELECT * FROM friend_requests WHERE id = ?1`).bind(c.req.param('id')).first<{ id: string; from_user: string; to_user: string; status: string }>();
  // Solo el destinatario acepta/rechaza y solo el emisor cancela; en otro caso, 404.
  if (!req || (action === 'cancel' ? req.from_user !== me : req.to_user !== me)) throw notFound('Solicitud');
  if (req.status !== 'pending') throw conflict('La solicitud ya no está pendiente.', 'request_closed');
  if (action === 'accept' && (await isBlocked(c.env.DB, req.from_user, req.to_user))) throw notFound('Solicitud');
  const t = now();
  const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
  const upd = await c.env.DB.prepare(`UPDATE friend_requests SET status = ?1, responded_at = ?2 WHERE id = ?3 AND status = 'pending'`).bind(status, t, req.id).run();
  if (!upd.meta.changes) throw conflict('La solicitud ya no está pendiente.', 'request_closed');
  if (action === 'accept') {
    const [a, b] = pair(req.from_user, req.to_user);
    await c.env.DB.prepare(`INSERT INTO friendships (user_a, user_b, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`).bind(a, b, t).run();
  }
  return c.json({ status });
});

// Eliminar amistad: el acceso que dependía de ella (calendario compartido con «amigos») desaparece
// inmediatamente, porque canSeeAvailability comprueba la amistad en cada consulta.
friendRoutes.delete('/:userId', async (c) => {
  const me = c.get('user').id;
  const [a, b] = pair(me, c.req.param('userId'));
  const r = await c.env.DB.prepare('DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2').bind(a, b).run();
  if (!r.meta.changes) throw notFound('Amistad');
  return c.json({ ok: true });
});

friendRoutes.post('/blocks', async (c) => {
  const me = c.get('user').id;
  const { userId } = await parseBody(c, z.object({ userId: zId }));
  if (userId === me) throw badRequest('No puedes bloquearte a ti mismo.');
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first();
  if (!target) throw notFound('Usuario');
  const t = now();
  const [a, b] = pair(me, userId);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING').bind(me, userId, t),
    c.env.DB.prepare('DELETE FROM friendships WHERE user_a = ?1 AND user_b = ?2').bind(a, b),
    c.env.DB.prepare(`UPDATE friend_requests SET status = 'cancelled', responded_at = ?3 WHERE status = 'pending' AND ((from_user = ?1 AND to_user = ?2) OR (from_user = ?2 AND to_user = ?1))`).bind(me, userId, t),
    c.env.DB.prepare(`UPDATE trip_invitations SET status = 'revoked', responded_at = ?3 WHERE status = 'pending' AND ((inviter_id = ?1 AND invitee_id = ?2) OR (inviter_id = ?2 AND invitee_id = ?1))`).bind(me, userId, t),
  ]);
  return c.json({ ok: true });
});

friendRoutes.delete('/blocks/:userId', async (c) => {
  const me = c.get('user').id;
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ?1 AND blocked_id = ?2').bind(me, c.req.param('userId')).run();
  return c.json({ ok: true });
});
