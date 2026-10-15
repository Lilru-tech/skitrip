// Disponibilidad del viaje tras la optimización de CPU: mismos permisos, misma distinción entre «no compartido»
// (oculto) y «sin indicar», y el mismo resultado que el cálculo anterior (objeto analizado y consultado día a día).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { recordLookup, summarize, type PersonDays } from '../../src/core/calendar';
import { api, befriend, signup } from './helpers';

const from = '2026-12-01', to = '2027-01-31';

/** Lo que calculaba la ruta antes: días de D1 → objeto → consulta por día. */
async function reference(ids: string[], visible: Set<string>, nights: number, min?: number) {
  const people: PersonDays[] = [];
  for (const id of ids) {
    if (!visible.has(id)) { people.push({ id, days: null }); continue; }
    const { results } = await env.DB.prepare('SELECT day, status FROM availability WHERE user_id = ?1 AND day BETWEEN ?2 AND ?3 ORDER BY day').bind(id, from, to).all<any>();
    people.push({ id, days: recordLookup(Object.fromEntries(results.map((r) => [r.day, r.status]))) });
  }
  const sharing = people.filter((p) => p.days).length;
  return summarize(people, { from, to, nights, minPeople: min ?? sharing, limit: 30 });
}

describe('GET /availability/trip/:id (optimización de CPU)', () => {
  it('oculto ≠ sin indicar, bloqueo y permisos intactos; recuento e intervalos iguales al cálculo anterior; 5 sentencias', async () => {
    const o = await signup(), f = await signup(), t = await signup(), e = await signup(), h = await signup(), b = await signup(), x = await signup();
    for (const u of [f, t, e, h, b]) await befriend(o, u);
    const trip = (await api(o.token, 'POST', '/api/trips', { name: 'Viaje CPU' })).json.trip;
    for (const u of [f, t, e, h, b]) {
      const inv = (await api(o.token, 'POST', `/api/trips/${trip.id}/invitations`, { userId: u.id })).json.invitation;
      expect((await api(u.token, 'POST', `/api/trips/invitations/${inv.id}/accept`)).status).toBe(200);
    }
    await api(o.token, 'PUT', '/api/availability/me', { range: { from, to, status: 'free', weekdays: [4, 5, 6] }, set: [{ day: '2026-12-31', status: 'busy' }] });
    await api(f.token, 'PUT', '/api/availability/me', { range: { from: '2026-12-20', to: '2027-01-10', status: 'maybe' }, set: [{ day: '2026-12-26', status: 'free' }, { day: '2027-03-01', status: 'free' }] });
    await api(t.token, 'PUT', '/api/availability/me', { range: { from, to, status: 'free' } });
    await api(h.token, 'PUT', '/api/availability/me', { range: { from, to, status: 'free' } }); // no comparte: debe salir oculto
    await api(b.token, 'PUT', '/api/availability/me', { range: { from, to, status: 'free' } });
    await api(f.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] });
    await api(t.token, 'PUT', '/api/availability/shares', { friends: false, tripIds: [trip.id] }); // solo con el viaje, no con amigos
    await api(e.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [] }); // comparte sin indicar ningún día
    await api(b.token, 'PUT', '/api/availability/shares', { friends: true, tripIds: [trip.id] });
    await api(b.token, 'POST', '/api/friends/blocks', { userId: o.id }); // el bloqueo anula los dos permisos
    // Un día guardado que no es una fecha real (lo admite el CHECK de la tabla): antes salía en «days» sin contar.
    await env.DB.prepare(`INSERT INTO availability (user_id, day, status, updated_at) VALUES (?1, '2026-12-32', 'busy', 0)`).bind(f.id).run();

    const ids = [o.id, f.id, t.id, e.id, h.id, b.id];
    const visible = new Set([o.id, f.id, t.id, e.id]);
    for (const [nights, min] of [[2, undefined], [1, 2], [0, 1], [3, 4]] as const) {
      const r = await api(o.token, 'GET', `/api/availability/trip/${trip.id}?from=${from}&to=${to}&nights=${nights}${min ? `&min=${min}` : ''}`);
      expect(r.status).toBe(200);
      expect(r.d1).toBe(5); // usuario, miembros + propuestas (un batch de 2), permisos, días (antes 6)
      const v = r.json;
      expect(v.members.map((m: any) => m.id)).toEqual(ids);
      const by = (id: string) => v.people.find((p: any) => p.id === id);
      expect(by(h.id)).toEqual({ id: h.id, shared: false, days: null });
      expect(by(b.id)).toEqual({ id: b.id, shared: false, days: null });
      expect(by(e.id)).toEqual({ id: e.id, shared: true, days: {} });
      expect(by(f.id).days['2026-12-32']).toBe('busy');
      expect(by(f.id).days['2027-03-01']).toBeUndefined(); // fuera del rango pedido
      const ref = await reference(ids, visible, nights, min);
      expect(v.daily).toEqual(ref.daily);
      expect(v.windows).toEqual(ref.windows);
      expect(v.requirement).toEqual({ mode: min ? 'min' : 'all_sharing', need: min ?? 4, total: 6, sharing: 4, notSharing: 2 });
      const d = v.daily.find((x: any) => x.day === '2026-12-26');
      expect(d).toEqual({ day: '2026-12-26', free: 3, maybe: 0, busy: 0, unknown: 1, hidden: 2 });
    }
    // Quien no es miembro: 404 (también con un rango no válido, como antes); un miembro con rango no válido: 422.
    expect((await api(x.token, 'GET', `/api/availability/trip/${trip.id}?from=${from}&to=${to}`)).status).toBe(404);
    expect((await api(x.token, 'GET', `/api/availability/trip/${trip.id}?from=${to}&to=${from}`)).status).toBe(404);
    expect((await api(x.token, 'GET', `/api/availability/trip/no-existe?from=${from}&to=${to}`)).status).toBe(404);
    expect((await api(o.token, 'GET', `/api/availability/trip/${trip.id}?from=${to}&to=${from}`)).status).toBe(422);
    // Un miembro que no es el propietario también la ve, con sus propios permisos (h no comparte con nadie).
    const tv = (await api(t.token, 'GET', `/api/availability/trip/${trip.id}?from=${from}&to=${to}`)).json;
    expect(tv.people.find((p: any) => p.id === h.id)).toEqual({ id: h.id, shared: false, days: null });
    expect(tv.people.find((p: any) => p.id === t.id).shared).toBe(true);
  });
});
