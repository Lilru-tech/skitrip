// Avisos de solicitudes de amistad e invitaciones directas: se crean con la solicitud, no se duplican, reflejan el
// estado vigente (sin acciones inválidas), marcar como leído no acepta nada y los pendientes anteriores se cubren.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import backfill from '../../migrations/0016_social_notifications.sql?raw';
import { api, befriend, signup } from './helpers';

const notices = async (u: { token: string }) => (await api(u.token, 'GET', '/api/notifications')).json.notifications as any[];
const social = async (u: { token: string }) => (await notices(u)).filter((n) => n.kind === 'friend_request' || n.kind === 'trip_invitation');
const unread = async (u: { token: string }) => (await api(u.token, 'GET', '/api/notifications/unread')).json.unread as number;
const rows = async (userId: string, kinds = ['friend_request', 'trip_invitation']) => (await env.DB.prepare(`SELECT kind, dedupe_key, read_at FROM notifications WHERE user_id = ?1 AND kind IN (SELECT value FROM json_each(?2))`).bind(userId, JSON.stringify(kinds)).all<any>()).results;
const invites = async (u: { token: string }) => (await notices(u)).filter((n) => n.kind === 'trip_invitation');

describe('avisos de amistad', () => {
  it('la solicitud crea un aviso para el destinatario; reintentar no lo duplica; leer no acepta', async () => {
    const a = await signup();
    const b = await signup();
    const r = await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    expect(r.status).toBe(201);
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).status).toBe(409);
    expect(await rows(b.id)).toHaveLength(1);
    expect(await rows(a.id)).toHaveLength(0);
    const [n] = await social(b);
    expect(n).toMatchObject({ kind: 'friend_request', state: 'pending', fromAlias: a.alias, read_at: null, payload: { requestId: r.json.requestId, fromUserId: a.id } });
    expect(await unread(b)).toBe(1);

    // Marcar como leído no acepta la solicitud.
    expect((await api(b.token, 'POST', '/api/notifications/read', { ids: [n.id] })).json.updated).toBe(1);
    expect(await unread(b)).toBe(0);
    const f = await api(b.token, 'GET', '/api/friends');
    expect(f.json.friends).toHaveLength(0);
    expect(f.json.incoming.map((x: any) => x.id)).toEqual([r.json.requestId]);
    expect((await social(b))[0].state).toBe('pending');
  });

  it('rechazar o cancelar cierra el aviso; una solicitud nueva reutiliza el mismo aviso', async () => {
    const a = await signup();
    const b = await signup();
    const r1 = await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    expect((await api(b.token, 'POST', `/api/friends/requests/${r1.json.requestId}/reject`)).status).toBe(200);
    let [n] = await social(b);
    expect(n.state).toBe('rejected');
    expect(n.read_at).not.toBeNull();

    const r2 = await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    expect(r2.status).toBe(201);
    [n] = await social(b);
    expect(await rows(b.id)).toHaveLength(1);
    expect(n).toMatchObject({ state: 'pending', read_at: null, payload: { requestId: r2.json.requestId } });

    expect((await api(a.token, 'POST', `/api/friends/requests/${r2.json.requestId}/cancel`)).status).toBe(200);
    [n] = await social(b);
    expect(n.state).toBe('cancelled');
    expect(n.read_at).not.toBeNull();
    // Responder a algo cancelado: 409, sin amistad.
    expect((await api(b.token, 'POST', `/api/friends/requests/${r2.json.requestId}/accept`)).status).toBe(409);
  });

  it('aceptar (también por solicitud cruzada) cierra el aviso', async () => {
    const a = await signup();
    const b = await signup();
    await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    const cross = await api(b.token, 'POST', '/api/friends/requests', { userId: a.id });
    expect(cross.json.status).toBe('accepted');
    const [n] = await social(b);
    expect(n.state).toBe('accepted');
    expect(n.read_at).not.toBeNull();
    expect(await rows(a.id)).toHaveLength(0);
  });

  it('bloquear cierra los avisos entre ambas personas y la otra persona no recibe ninguno nuevo', async () => {
    const a = await signup();
    const b = await signup();
    await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    expect((await api(b.token, 'POST', '/api/friends/blocks', { userId: a.id })).status).toBe(200);
    const [n] = await social(b);
    expect(n.state).toBe('cancelled');
    expect(n.read_at).not.toBeNull();
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).status).toBe(404);
    expect(await rows(b.id)).toHaveLength(1);
  });

  it('el recuento cuesta una consulta además de la sesión y solo ve avisos propios', async () => {
    const a = await signup();
    const b = await signup();
    await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    const r = await api(b.token, 'GET', '/api/notifications/unread');
    expect(r.json.unread).toBe(1);
    expect(r.d1).toBe(2);
    expect(await unread(a)).toBe(0);
    // Marcar como leído un aviso ajeno no hace nada.
    const [n] = await social(b);
    expect((await api(a.token, 'POST', '/api/notifications/read', { ids: [n.id] })).json.updated).toBe(0);
    expect(await unread(b)).toBe(1);
  });
});

describe('avisos de invitación a viajes', () => {
  it('la invitación directa avisa al destinatario; el enlace genérico no avisa a nadie', async () => {
    const a = await signup();
    const b = await signup();
    await befriend(a, b);
    const { json: { trip } } = await api(a.token, 'POST', '/api/trips', { name: 'Avisos', nights: 2 });
    const before = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'trip_invitation'`).first<{ n: number }>())!.n;
    expect((await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true, maxUses: 3 })).status).toBe(201);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'trip_invitation'`).first<{ n: number }>())!.n).toBe(before);

    const inv = await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: b.id });
    expect(inv.status).toBe(201);
    expect((await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: b.id })).status).toBe(409);
    expect(await rows(b.id, ['trip_invitation'])).toHaveLength(1);
    const [n] = await invites(b);
    expect(n).toMatchObject({ kind: 'trip_invitation', state: 'pending', tripId: trip.id, tripName: 'Avisos', inviterAlias: a.alias, payload: { invitationId: inv.json.invitation.id } });

    // Leer no acepta.
    await api(b.token, 'POST', '/api/notifications/read', { ids: [n.id] });
    expect((await api(b.token, 'GET', `/api/trips/${trip.id}`)).status).toBe(404);

    expect((await api(b.token, 'POST', `/api/trips/invitations/${inv.json.invitation.id}/accept`)).status).toBe(200);
    expect((await invites(b))[0].state).toBe('accepted');
  });

  it('revocar y caducar dejan el aviso sin acciones', async () => {
    const a = await signup();
    const b = await signup();
    await befriend(a, b);
    const { json: { trip } } = await api(a.token, 'POST', '/api/trips', { name: 'Revocar', nights: 2 });
    const inv = await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: b.id });
    await api(a.token, 'POST', `/api/trips/${trip.id}/invitations/${inv.json.invitation.id}/revoke`);
    let [n] = await invites(b);
    expect(n.state).toBe('revoked');
    expect(n.read_at).not.toBeNull();

    const inv2 = await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: b.id });
    [n] = await invites(b);
    expect(await rows(b.id, ['trip_invitation'])).toHaveLength(1);
    expect(n).toMatchObject({ state: 'pending', read_at: null });
    await env.DB.prepare('UPDATE trip_invitations SET expires_at = 1 WHERE id = ?1').bind(inv2.json.invitation.id).run();
    [n] = await invites(b);
    expect(n.state).toBe('expired');
    expect((await api(b.token, 'POST', `/api/trips/invitations/${inv2.json.invitation.id}/accept`)).status).toBe(409);
    [n] = await invites(b);
    expect(n).toMatchObject({ state: 'expired' });
    expect(n.read_at).not.toBeNull();
  });
});

describe('solicitudes e invitaciones anteriores a los avisos', () => {
  it('la migración crea un aviso por pendiente vigente, sin duplicar, y nada para enlaces, caducadas o cerradas', async () => {
    const a = await signup();
    const b = await signup();
    const c = await signup();
    const t = Date.now();
    await befriend(a, c);
    const { json: { trip } } = await api(a.token, 'POST', '/api/trips', { name: 'Antiguo', nights: 2 });
    // Filas como las dejaba el código anterior: sin aviso.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO friend_requests (id, from_user, to_user, status, created_at) VALUES ('old-req', ?1, ?2, 'pending', ?3)`).bind(a.id, b.id, t - 5000),
      env.DB.prepare(`INSERT INTO friend_requests (id, from_user, to_user, status, created_at) VALUES ('old-rej', ?1, ?2, 'rejected', ?3)`).bind(c.id, b.id, t - 5000),
      env.DB.prepare(`INSERT INTO trip_invitations (id, trip_id, inviter_id, invitee_id, status, expires_at, created_at) VALUES ('old-inv', ?1, ?2, ?3, 'pending', ?4, ?5)`).bind(trip.id, a.id, c.id, t + 86400_000, t - 4000),
      env.DB.prepare(`INSERT INTO trip_invitations (id, trip_id, inviter_id, invitee_id, status, expires_at, created_at) VALUES ('old-exp', ?1, ?2, ?3, 'pending', 5, 1)`).bind(trip.id, a.id, b.id),
      env.DB.prepare(`INSERT INTO trip_invitations (id, trip_id, inviter_id, link_token_hash, status, expires_at, created_at) VALUES ('old-link', ?1, ?2, 'old-link-hash', 'pending', ?3, ?4)`).bind(trip.id, a.id, t + 86400_000, t),
    ]);
    const stmts = backfill.replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < 2; i++) for (const s of stmts) await env.DB.prepare(s).run(); // dos veces: idempotente
    expect(await rows(b.id)).toEqual([{ kind: 'friend_request', dedupe_key: `friend_request:${a.id}`, read_at: null }]);
    expect(await rows(c.id, ['trip_invitation'])).toEqual([{ kind: 'trip_invitation', dedupe_key: `trip_invitation:${trip.id}`, read_at: null }]);
    expect((await social(b))[0]).toMatchObject({ state: 'pending', fromAlias: a.alias });
    expect((await invites(c))[0]).toMatchObject({ state: 'pending', tripName: 'Antiguo' });
    // Responder desde el aviso funciona con las filas antiguas.
    expect((await api(c.token, 'POST', '/api/trips/invitations/old-inv/accept')).status).toBe(200);
    expect((await invites(c))[0]).toMatchObject({ state: 'accepted' });
  });
});
