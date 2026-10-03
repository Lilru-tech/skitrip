import { describe, expect, it } from 'vitest';
import { api, emulatorToken, signup } from './helpers';

// Recorrido mínimo de la fase 1: registro sin verificación → sesión → petición autenticada
// → dato persistido en D1 → rechazo de acceso de otro usuario.
describe('recorrido mínimo', () => {
  it('registro, persistencia y aislamiento entre usuarios', async () => {
    const tokenA = emulatorToken('uid-ana', { email: 'ana@example.test' });
    // Sin perfil: la API pide completar el alias, no da acceso a datos.
    expect((await api(tokenA, 'GET', '/api/me')).json).toMatchObject({ profile: null, needsAlias: true });
    expect((await api(tokenA, 'GET', '/api/trips')).status).toBe(403);

    const created = await api(tokenA, 'POST', '/api/me', { alias: 'Ana' });
    expect(created.status).toBe(201);
    expect(created.json.profile.email).toBe('ana@example.test');

    const trip = await api(tokenA, 'POST', '/api/trips', { name: 'Grandvalira enero', startDate: '2026-12-30', endDate: '2027-01-02', nights: 3 });
    expect(trip.status).toBe(201);
    const tripId = trip.json.trip.id;
    expect((await api(tokenA, 'GET', `/api/trips/${tripId}`)).json.trip.name).toBe('Grandvalira enero');

    const b = await signup('Bruno');
    for (const [m, p, body] of [
      ['GET', `/api/trips/${tripId}`],
      ['PATCH', `/api/trips/${tripId}`, { name: 'hackeado', version: 1 }],
      ['DELETE', `/api/trips/${tripId}`],
      ['POST', `/api/trips/${tripId}/invitations`, { link: true }],
      ['GET', `/api/availability/trip/${tripId}?from=2026-12-01&to=2027-01-31`],
    ] as const) {
      const r = await api(b.token, m, p, body);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    expect((await api(b.token, 'GET', '/api/trips')).json.trips).toEqual([]);
    expect((await api(tokenA, 'GET', `/api/trips/${tripId}`)).json.trip.name).toBe('Grandvalira enero');
  });

  it('rechaza token inválido, caducado o de otro proyecto', async () => {
    expect((await api(null, 'GET', '/api/me')).status).toBe(401);
    expect((await api('basura', 'GET', '/api/me')).status).toBe(401);
    expect((await api(emulatorToken('uid-x', { expOffset: -60 }), 'GET', '/api/me')).json.error.code).toBe('auth_expired');
    expect((await api(emulatorToken('uid-x', { aud: 'otro' }), 'GET', '/api/me')).status).toBe(401);
  });

  it('alias único normalizado, sin reutilizar perfil', async () => {
    await signup('Núria');
    const r = await api(emulatorToken('uid-otro-nuria'), 'POST', '/api/me', { alias: 'NURIA' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('alias_taken');
    expect((await api(emulatorToken('uid-mal'), 'POST', '/api/me', { alias: 'a b' })).status).toBe(422);
  });

  it('usuario bloqueado o sesión revocada pierden acceso', async () => {
    const u = await signup('Carla');
    const { env } = await import('cloudflare:test');
    await env.DB.prepare(`UPDATE users SET tokens_valid_after = ?1 WHERE id = ?2`).bind(Math.floor(Date.now() / 1000) + 10, u.id).run();
    expect((await api(u.token, 'GET', '/api/trips')).json.error.code).toBe('auth_revoked');
    await env.DB.prepare(`UPDATE users SET status = 'blocked', tokens_valid_after = 0 WHERE id = ?1`).bind(u.id).run();
    expect((await api(u.token, 'GET', '/api/trips')).json.error.code).toBe('user_blocked');
  });

  it('limita las altas por IP', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await api(emulatorToken(`uid-flood-${i}`), 'POST', '/api/me', { alias: `flood${i}` }, { 'CF-Connecting-IP': '203.0.113.9' })).status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('rechaza orígenes no permitidos y cuerpos enormes', async () => {
    const u = await signup('Dani');
    expect((await api(u.token, 'POST', '/api/trips', { name: 'x' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await api(u.token, 'POST', '/api/trips', { name: 'x'.repeat(70_000) })).status).toBe(413);
  });
});
