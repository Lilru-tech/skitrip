import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { blockingQuery, cleanupStatements, remainingQuery, testEmail, validateManifest, type CleanupManifest } from '../../tools/prod-cleanup-sql';
import { api, befriend, emulatorToken } from './helpers';

let ip = 0;
async function signupAs(uid: string, email: string, alias: string) {
  const token = emulatorToken(uid, { email });
  const r = await api(token, 'POST', '/api/me', { alias }, { 'CF-Connecting-IP': `10.9.${++ip % 250}.1` });
  if (r.status !== 201) throw new Error(`signup ${r.status} ${JSON.stringify(r.json)}`);
  return { token, id: r.json.profile.id as string, uid, email };
}

async function run(m: CleanupManifest) {
  const blocking = await env.DB.prepare(blockingQuery(m)).all();
  if (blocking.results.length) return { blocked: blocking.results.length };
  await env.DB.batch(cleanupStatements(m).map((s) => env.DB.prepare(s)));
  return { blocked: 0, remaining: (await env.DB.prepare(remainingQuery(m)).first<{ n: number }>())!.n };
}

const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

describe('limpieza de pruebas de producción', () => {
  it('valida el manifiesto: solo correos exactos de la ejecución', () => {
    expect(validateManifest({ runId: '123456789', users: [{ email: testEmail('123456789', 'a') }] })).toEqual([]);
    expect(validateManifest({ runId: '123456789', users: [{ email: 'prod-check-123456788-a@example.com' }] })).toHaveLength(1);
    expect(validateManifest({ runId: '123456789', users: [{ email: 'david@cliqpod.io' }] })).toHaveLength(1);
    expect(validateManifest({ runId: '123456789', users: [{ email: "prod-check-123456789-a@example.com' OR 1=1 --" }] })).toHaveLength(1);
    expect(validateManifest({ runId: '1*', users: [{ email: 'prod-check-1*-a@example.com' }] }).length).toBeGreaterThan(0);
    expect(validateManifest({ runId: '123456789', users: [] })).toHaveLength(1);
    expect(() => cleanupStatements({ runId: '123456789', users: [{ email: 'otro@example.com' }] })).toThrow();
  });

  it('borra todo lo de la ejecución, respeta lo ajeno y es idempotente', async () => {
    const runId = '900000001';
    const real = await signupAs('uid-real-david', 'david.real@example.org', 'DavidReal');
    const otherRun = await signupAs('uid-other-run', testEmail('900000002', 'a'), 'OtraEjecucion');
    const a = await signupAs('uid-pc-a', testEmail(runId, 'a'), 'pcA');
    const b = await signupAs('uid-pc-b', testEmail(runId, 'b'), 'pcB');
    // Un administrador con un correo de prueba nunca se borra.
    const adm = await signupAs('uid-pc-c', testEmail(runId, 'c'), 'pcC');
    await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id).run();

    await befriend(a, b);
    await befriend(a, real);
    await api(a.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-30', status: 'free' }] });
    await api(a.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
    const trip = (await api(a.token, 'POST', '/api/trips', { name: 'Prueba' })).json.trip;
    const inv = (await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: b.id })).json.invitation;
    await api(b.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    expect((await api(a.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Peaje', spentOn: '2027-01-02', payerId: a.id, amountCents: 1000, split: { mode: 'equal', participants: [a.id, b.id] } })).status).toBe(201);
    const realTrip = (await api(real.token, 'POST', '/api/trips', { name: 'Real' })).json.trip;
    await api(real.token, 'PUT', '/api/availability/me', { set: [{ day: '2026-12-31', status: 'free' }] });

    const m: CleanupManifest = { runId, users: [a, b, adm].map((u) => ({ email: u.email, uid: u.uid })) };
    // Si el UID no coincide, no se selecciona a nadie.
    const wrongUid: CleanupManifest = { runId, users: [{ email: a.email, uid: 'uid-otro-distinto' }] };
    await env.DB.batch(cleanupStatements(wrongUid).map((s) => env.DB.prepare(s)));
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', a.id)).toBe(1);

    expect(await run(m)).toEqual({ blocked: 0, remaining: 1 }); // queda solo el administrador
    for (const u of [a, b]) {
      expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', u.id)).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM availability WHERE user_id = ?1', u.id)).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM friendships WHERE user_a = ?1 OR user_b = ?1', u.id)).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ?1', u.id)).toBe(0);
    }
    expect(await count('SELECT COUNT(*) AS n FROM trips WHERE id = ?1', trip.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM expense_history WHERE trip_id = ?1', trip.id)).toBe(0);
    for (const u of [real, otherRun, adm]) expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', u.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM trips WHERE id = ?1', realTrip.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM availability WHERE user_id = ?1', real.id)).toBe(1);

    // Repetir (p. ej. tras un fallo parcial) no cambia nada.
    const before = await count('SELECT COUNT(*) AS n FROM users');
    expect(await run(m)).toEqual({ blocked: 0, remaining: 1 });
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(before);
  });

  it('no borra nada si un viaje de la prueba tiene a alguien real', async () => {
    const runId = '900000003';
    const real = await signupAs('uid-real-2', 'real2@example.org', 'RealDos');
    const a = await signupAs('uid-pc3-a', testEmail(runId, 'a'), 'pc3A');
    await befriend(a, real);
    const trip = (await api(a.token, 'POST', '/api/trips', { name: 'Mixto' })).json.trip;
    const inv = (await api(a.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: real.id })).json.invitation;
    await api(real.token, 'POST', `/api/trips/invitations/${inv.id}/accept`);
    const m: CleanupManifest = { runId, users: [{ email: a.email, uid: a.uid }] };
    expect(await run(m)).toEqual({ blocked: 1 });
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?1', a.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM trips WHERE id = ?1', trip.id)).toBe(1);
  });

  it('cubre todas las tablas que apuntan a perfiles o viajes', async () => {
    const tables = (await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`).all<{ name: string }>()).results.map((r) => r.name);
    const sql = cleanupStatements({ runId: '123456789', users: [{ email: testEmail('123456789', 'a') }] }).join('\n');
    const fkOf = new Map<string, { table: string; from: string; on_delete: string }[]>();
    for (const t of tables) fkOf.set(t, (await env.DB.prepare(`SELECT * FROM pragma_foreign_key_list(?1)`).bind(t).all<{ table: string; from: string; on_delete: string }>()).results);
    // Tablas que cuelgan de un viaje (directamente o vía otra tabla del viaje) en cascada: caen con el viaje, y
    // blockingQuery garantiza que solo se borran viajes de la prueba.
    const tripScoped = new Set<string>(['trips']);
    for (let changed = true; changed;) {
      changed = false;
      for (const t of tables) if (!tripScoped.has(t) && fkOf.get(t)!.some((fk) => tripScoped.has(fk.table) && fk.on_delete === 'CASCADE')) { tripScoped.add(t); changed = true; }
    }
    const uncovered: string[] = [];
    for (const t of tables) {
      if (tripScoped.has(t) && t !== 'trips') continue;
      for (const fk of fkOf.get(t)!) {
        if (fk.table !== 'users') continue;
        if (fk.on_delete === 'CASCADE' || fk.on_delete === 'SET NULL') continue;
        if (new RegExp(`(DELETE FROM|UPDATE) ${t}\\b[^\\n]*\\b${fk.from}\\b`).test(sql)) continue;
        uncovered.push(`${t}.${fk.from} → ${fk.table} (${fk.on_delete})`);
      }
    }
    expect(uncovered).toEqual([]);
  });
});
