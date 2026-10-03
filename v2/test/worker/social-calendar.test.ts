import { describe, expect, it } from 'vitest';
import { api, befriend, signup } from './helpers';

describe('amistades', () => {
  it('no permite autoamistad ni solicitudes repetidas', async () => {
    const a = await signup(); const b = await signup();
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: a.id })).status).toBe(400);
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).status).toBe(201);
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).json.error.code).toBe('request_pending');
  });

  it('solicitudes cruzadas se resuelven en una sola amistad', async () => {
    const a = await signup(); const b = await signup();
    await api(a.token, 'POST', '/api/friends/requests', { userId: b.id });
    const cross = await api(b.token, 'POST', '/api/friends/requests', { userId: a.id });
    expect(cross.json.status).toBe('accepted');
    const fa = (await api(a.token, 'GET', '/api/friends')).json;
    expect(fa.friends.map((f: any) => f.id)).toEqual([b.id]);
    expect(fa.incoming).toEqual([]);
    expect(fa.outgoing).toEqual([]);
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).json.error.code).toBe('already_friends');
  });

  it('aceptar, rechazar y cancelar: solo quien corresponde', async () => {
    const a = await signup(); const b = await signup(); const c = await signup();
    const r = (await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).json;
    expect((await api(c.token, 'POST', `/api/friends/requests/${r.requestId}/accept`)).status).toBe(404);
    expect((await api(a.token, 'POST', `/api/friends/requests/${r.requestId}/accept`)).status).toBe(404);
    expect((await api(b.token, 'POST', `/api/friends/requests/${r.requestId}/reject`)).json.status).toBe('rejected');
    const r2 = (await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).json;
    expect((await api(b.token, 'POST', `/api/friends/requests/${r2.requestId}/cancel`)).status).toBe(404);
    expect((await api(a.token, 'POST', `/api/friends/requests/${r2.requestId}/cancel`)).json.status).toBe('cancelled');
  });

  it('la búsqueda no revela emails y el bloqueo oculta a la persona', async () => {
    const a = await signup('buscaAna'); const b = await signup('buscaBea');
    const s = await api(a.token, 'GET', '/api/friends/search?q=busca');
    expect(JSON.stringify(s.json)).not.toMatch(/@/);
    expect(s.json.users.map((u: any) => u.alias)).toContain('buscaBea');
    await api(b.token, 'POST', '/api/friends/blocks', { userId: a.id });
    expect((await api(a.token, 'GET', '/api/friends/search?q=busca')).json.users.map((u: any) => u.alias)).not.toContain('buscaBea');
    expect((await api(a.token, 'POST', '/api/friends/requests', { userId: b.id })).status).toBe(404);
  });
});

describe('viajes e invitaciones', () => {
  it('invitación a amigo, aceptación y permisos de edición', async () => {
    const o = await signup(); const f = await signup(); const stranger = await signup();
    await befriend(o, f);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Cerler' })).json.trip;
    expect((await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: stranger.id })).status).toBe(404);
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: f.id })).json.invitation;
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}`)).status).toBe(404);
    expect((await api(f.token, 'POST', `/api/trips/invitations/${inv.id}/accept`)).status).toBe(200);
    const view = (await api(f.token, 'GET', `/api/trips/${trip.id}`)).json;
    expect(view.trip.role).toBe('member');
    expect((await api(f.token, 'PATCH', `/api/trips/${trip.id}`, { name: 'x', version: view.trip.version })).status).toBe(403);
    expect((await api(f.token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true })).status).toBe(403);
  });

  it('ser amigo no da acceso al viaje ni a sus gastos', async () => {
    const o = await signup(); const f = await signup();
    await befriend(o, f);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Privado' })).json.trip;
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}`)).status).toBe(404);
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}/expenses`)).status).toBe(404);
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}/shopping`)).status).toBe(404);
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}/comments`)).status).toBe(404);
  });

  it('invitación por enlace: caduca, se revoca y no revela el token', async () => {
    const o = await signup(); const x = await signup(); const y = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Enlace' })).json.trip;
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true, maxUses: 1 })).json.invitation;
    expect(inv.token.length).toBeGreaterThan(20);
    const detail = (await api(o.token, 'GET', `/api/trips/${trip.id}`)).json;
    expect(JSON.stringify(detail)).not.toContain(inv.token);
    expect((await api(x.token, 'POST', '/api/trips/invitations/accept-link', { token: inv.token })).json.tripId).toBe(trip.id);
    expect((await api(y.token, 'POST', '/api/trips/invitations/accept-link', { token: inv.token })).status).toBe(404);
    const inv2 = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { link: true })).json.invitation;
    await api(o.token, 'POST', `/api/trips/${trip.id}/invitations/${inv2.id}/revoke`);
    expect((await api(y.token, 'POST', '/api/trips/invitations/accept-link', { token: inv2.token })).status).toBe(404);
  });

  it('abandono y transferencia de propiedad', async () => {
    const o = await signup(); const f = await signup();
    await befriend(o, f);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Transfer' })).json.trip;
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: f.id })).json.invitation;
    await api(f.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    expect((await api(o.token, 'DELETE', `/api/trips/${trip.id}/members/${o.id}`)).json.error.code).toBe('owner_must_transfer');
    expect((await api(o.token, 'POST', `/api/trips/${trip.id}/transfer`, { userId: f.id })).status).toBe(200);
    expect((await api(f.token, 'GET', `/api/trips/${trip.id}`)).json.trip.role).toBe('owner');
    expect((await api(o.token, 'DELETE', `/api/trips/${trip.id}/members/${o.id}`)).status).toBe(200);
    expect((await api(o.token, 'GET', `/api/trips/${trip.id}`)).status).toBe(404);
  });

  it('edición simultánea: la segunda escritura con versión antigua recibe 409', async () => {
    const o = await signup();
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'V' })).json.trip;
    expect((await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { name: 'A', version: 1 })).status).toBe(200);
    expect((await api(o.token, 'PATCH', `/api/trips/${trip.id}`, { name: 'B', version: 1 })).json.error.code).toBe('version_conflict');
  });
});

describe('calendario compartido', () => {
  const range = 'from=2026-12-28&to=2027-01-04';

  it('cada persona edita solo lo suyo; sin compartir no se ve nada', async () => {
    const a = await signup(); const b = await signup();
    await befriend(a, b);
    await api(a.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-30', status: 'free' }] });
    const common = (await api(b.token, 'GET', `/api/availability/common?${range}&ids=${a.id}&nights=1`)).json;
    expect(common.people.find((p: any) => p.id === a.id)).toEqual({ id: a.id, alias: a.alias, shared: false, days: null });
    // Quien no comparte no bloquea las ventanas de los demás, pero se informa y nunca cuenta como libre.
    await api(b.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-30', status: 'free' }, { day: '2026-12-31', status: 'free' }] });
    const again = (await api(b.token, 'GET', `/api/availability/common?${range}&ids=${a.id}&nights=1`)).json;
    expect(again.requirement).toEqual({ mode: 'all_sharing', need: 1, total: 2, sharing: 1, notSharing: 1 });
    const w = again.windows.find((x: any) => x.start === '2026-12-30');
    expect(w).toMatchObject({ free: [b.id], hidden: [a.id], meetsWithFree: true });
    const strict = (await api(b.token, 'GET', `/api/availability/common?${range}&ids=${a.id}&nights=1&min=2`)).json;
    expect(strict.windows).toEqual([]);
  });

  it('compartir con amigos, patrón semanal con excepción y revocación inmediata al eliminar la amistad', async () => {
    const a = await signup(); const b = await signup();
    await befriend(a, b);
    await api(a.token, 'PUT', '/api/availability/me', {
      range: { from: '2026-12-28', to: '2027-01-10', status: 'free', weekdays: [4, 5] }, // viernes y sábados
      set: [{ day: '2027-01-01', status: 'busy' }],
    });
    await api(a.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
    const days = (await api(b.token, 'GET', `/api/availability/common?${range}&ids=${a.id}`)).json.people.find((p: any) => p.id === a.id).days;
    expect(days).toEqual({ '2027-01-01': 'busy', '2027-01-02': 'free' });
    expect(days['2026-12-31']).toBeUndefined(); // jueves sin indicar: no aparece como libre
    await api(b.token, 'DELETE', `/api/friends/${a.id}`);
    expect((await api(b.token, 'GET', `/api/availability/common?${range}&ids=${a.id}`)).json.people.find((p: any) => p.id === a.id).shared).toBe(false);
  });

  it('permiso de viaje independiente de la amistad; el bloqueo lo anula por cualquier ruta', async () => {
    const o = await signup(); const f = await signup();
    await befriend(o, f);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Cal' })).json.trip;
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: f.id })).json.invitation;
    await api(f.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    await api(f.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-30', status: 'maybe' }] });
    await api(f.token, 'PUT', '/api/availability/shares', { friends: false, tripIds: [trip.id] });
    await api(o.token, 'DELETE', `/api/friends/${f.id}`); // sin amistad, el permiso de viaje sigue
    const view = (await api(o.token, 'GET', `/api/availability/trip/${trip.id}?${range}&nights=1`)).json;
    expect(view.people.find((p: any) => p.id === f.id).days).toEqual({ '2026-12-30': 'maybe' });
    expect((await api(o.token, 'GET', `/api/availability/common?${range}&ids=${f.id}`)).json.people.find((p: any) => p.id === f.id).shared).toBe(true);
    await api(f.token, 'POST', '/api/friends/blocks', { userId: o.id });
    expect((await api(o.token, 'GET', `/api/availability/trip/${trip.id}?${range}`)).json.people.find((p: any) => p.id === f.id).shared).toBe(false);
    expect((await api(o.token, 'GET', `/api/availability/common?${range}&ids=${f.id}`)).json.people.find((p: any) => p.id === f.id).shared).toBe(false);
    expect((await api(o.token, 'GET', '/api/availability/visible')).json.users.map((u: any) => u.id)).not.toContain(f.id);
  });

  it('compartir con un viaje ajeno no es posible', async () => {
    const a = await signup(); const b = await signup();
    const trip = (await api(a.token, 'POST', '/api/trips', { name: 'Solo A' })).json.trip;
    expect((await api(b.token, 'PUT', '/api/availability/shares', { friends: false, tripIds: [trip.id] })).status).toBe(404);
  });

  it('ventanas del viaje: quién falta por responder y quizá no confirma', async () => {
    const o = await signup(); const f = await signup();
    await befriend(o, f);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Ventanas' })).json.trip;
    const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: f.id })).json.invitation;
    await api(f.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    await api(o.token, 'PUT', '/api/availability/me', { range: { from: '2026-12-28', to: '2027-01-04', status: 'free' } });
    await api(f.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-30', status: 'free' }, { day: '2026-12-31', status: 'maybe' }] });
    await api(f.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
    const v = (await api(o.token, 'GET', `/api/availability/trip/${trip.id}?${range}&nights=1`)).json;
    const w = v.windows.find((x: any) => x.start === '2026-12-30');
    expect(w).toMatchObject({ end: '2026-12-31', free: [o.id], maybe: [f.id], meetsWithFree: false, meetsWithMaybe: true });
    const other = v.windows.find((x: any) => x.start === '2027-01-02');
    expect(other).toBeUndefined(); // f no ha respondido esos días: no cuentan como libres
    expect((await api(o.token, 'POST', `/api/availability/trip/${trip.id}/proposals`, { start: '2026-12-30', end: '2026-12-31' })).status).toBe(201);
  });
});
