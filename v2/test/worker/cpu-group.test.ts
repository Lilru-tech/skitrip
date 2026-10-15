// Grupo sintético de la medición de CPU: lo que crea se ve por la API como un grupo real y la limpieza lo borra entero.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedGroupStatements, seedTripStatements, syntheticMembers } from '../../tools/cpu-group-sql';
import { cleanupStatements, testEmail, type CleanupManifest } from '../../tools/prod-cleanup-sql';
import { api, emulatorToken } from './helpers';

const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

describe('grupo sintético de «v2 · medir CPU»', () => {
  it('14 miembros + 2 cuentas: fechas comunes y viaje con 16 personas; la limpieza deja los recuentos como estaban', async () => {
    const runId = '910000001-1';
    const before = await count('SELECT COUNT(*) AS n FROM users');
    const mk = async (k: string) => {
      const token = emulatorToken(`uid-cpu-${k}`, { email: testEmail(runId, k) });
      const r = await api(token, 'POST', '/api/me', { alias: `pccpu${k}` }, { 'CF-Connecting-IP': `10.8.0.${k.charCodeAt(0)}` });
      return { token, id: r.json.profile.id as string, uid: `uid-cpu-${k}`, email: testEmail(runId, k) };
    };
    const p = await mk('p');
    const members = syntheticMembers(runId, 14);
    expect(() => syntheticMembers(runId, 15)).toThrow();
    await env.DB.batch(seedGroupStatements(members, p.id, '2026-12-01', 150, Date.now()).map((s) => env.DB.prepare(s)));
    await api(p.token, 'PUT', '/api/availability/me', { range: { from: '2026-12-01', to: '2027-04-29', status: 'free' } });
    await api(p.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });

    const visible = (await api(p.token, 'GET', '/api/availability/visible')).json.users;
    expect(visible).toHaveLength(14);
    const common = (await api(p.token, 'GET', `/api/availability/common?from=2026-12-01&to=2027-04-29&nights=2&ids=${members.map((m) => m.id).join(',')}`)).json;
    expect(common.people).toHaveLength(15);
    expect(common.people.every((x: any) => x.shared)).toBe(true);
    // Los días que se reenvían tal cual desde D1 son exactamente las filas de cada persona, y el recuento coincide.
    expect(Object.keys(common)).toEqual(['people', 'daily', 'requirement', 'windows']);
    const { results: rows } = await env.DB.prepare('SELECT day, status FROM availability WHERE user_id = ?1 ORDER BY day').bind(members[3].id).all<any>();
    expect(common.people.find((x: any) => x.id === members[3].id)).toEqual({ id: members[3].id, alias: members[3].alias, shared: true, days: Object.fromEntries(rows.map((r) => [r.day, r.status])) });
    const d0 = common.daily[0];
    expect(d0.free + d0.maybe + d0.busy + d0.unknown + d0.hidden).toBe(15);
    expect(common.requirement).toEqual({ mode: 'all_sharing', need: 15, total: 15, sharing: 15, notSharing: 0 });

    const trip = (await api(p.token, 'POST', '/api/trips', { name: 'Prueba CPU' })).json.trip;
    await env.DB.batch(seedTripStatements(members, trip.id, Date.now()).map((s) => env.DB.prepare(s)));
    const tv = (await api(p.token, 'GET', `/api/availability/trip/${trip.id}?from=2026-12-01&to=2027-04-29&nights=2`)).json;
    expect(tv.members).toHaveLength(15);
    expect(Object.keys(tv)).toEqual(['members', 'people', 'daily', 'requirement', 'windows', 'proposals']);
    expect(tv.people.find((x: any) => x.id === members[3].id).days).toEqual(common.people.find((x: any) => x.id === members[3].id).days);
    const split = { mode: 'equal', participants: [p.id, ...members.map((m) => m.id)] };
    expect((await api(p.token, 'POST', `/api/trips/${trip.id}/expenses`, { concept: 'Casa', spentOn: '2027-01-02', payerId: p.id, amountCents: 150000, split })).status).toBe(201);

    const m: CleanupManifest = { runId, users: [p, ...members].map((u) => ({ email: u.email, uid: u.uid })) };
    await env.DB.batch(cleanupStatements(m).map((s) => env.DB.prepare(s)));
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(before);
    expect(await count(`SELECT COUNT(*) AS n FROM availability WHERE user_id LIKE 'pcs-${runId}-%'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM trips WHERE id = ?1`, trip.id)).toBe(0);
  });
});
