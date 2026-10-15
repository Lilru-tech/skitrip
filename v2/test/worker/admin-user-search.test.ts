// Vincular datos de la hoja antigua a la propia cuenta del administrador. El selector usaba el buscador de amigos, que
// excluye a quien consulta: buscando su propio alias, el administrador no se encontraba. Cada caso falla sin el cambio.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayMadrid } from '../../src/core/dates';
import { api, signup } from './helpers';

const future = addDays(todayMadrid(), 40);
let adm: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  adm = await signup(`AdmBusca${Math.random().toString(36).slice(2, 6)}`);
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('us-lf','sheets_test','us.csv','us-sha',0,0,0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) VALUES
      ('us-c1','us-lf','us-c1','Yo Mismo','global','Consejo propio (prueba)','2026-01-10',0),
      ('us-c2','us-lf','us-c2','Otra Persona','global','Consejo ajeno (prueba)','2026-01-11',0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status) VALUES
      ('us-a1','us-lf','us-a1','Yo Mismo','2026-01-15','libre','free'),
      ('us-a2','us-lf','us-a2','Yo Mismo',?1,'libre','free'),
      ('us-a3','us-lf','us-a3','Otra Persona',?1,'ocupado','busy')`).bind(future),
  ]);
});

describe('búsqueda de cuentas para administración', () => {
  it('el administrador encuentra su propio alias, marcado como suyo, sin correos', async () => {
    const r = await api(adm.token, 'GET', `/api/admin/users/search?q=${encodeURIComponent(adm.alias.slice(0, 6))}`);
    expect(r.status).toBe(200);
    expect(r.d1).toBe(2); // sesión + una consulta (docs/QUOTAS.md)
    expect(r.json.users).toContainEqual({ id: adm.id, alias: adm.alias, isMe: true });
    expect(JSON.stringify(r.json)).not.toMatch(/@/);
    for (const u of r.json.users) expect(Object.keys(u).sort()).toEqual(['alias', 'id', 'isMe']);
  });

  it('encuentra otras cuentas activas, pero no las bloqueadas', async () => {
    const other = await signup(`AdmOtra${Math.random().toString(36).slice(2, 6)}`);
    const gone = await signup(`AdmBloq${Math.random().toString(36).slice(2, 6)}`);
    expect((await api(adm.token, 'POST', `/api/admin/users/${gone.id}/block`)).status).toBe(200);
    expect((await api(adm.token, 'GET', `/api/admin/users/search?q=${other.alias}`)).json.users).toEqual([{ id: other.id, alias: other.alias, isMe: false }]);
    expect((await api(adm.token, 'GET', `/api/admin/users/search?q=${gone.alias}`)).json.users).toEqual([]);
    // Ni por la API se vinculan datos a una cuenta bloqueada.
    expect((await api(adm.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Otra Persona', userId: gone.id })).status).toBe(404);
    expect((await api(adm.token, 'POST', '/api/admin/legacy/availability/reconcile', { person: 'Otra Persona', userId: gone.id })).status).toBe(404);
    expect((await api(adm.token, 'POST', '/api/admin/legacy/comments/us-c2/reconcile', { userId: gone.id })).status).toBe(404);
  });

  it('una cuenta sin administración no puede buscar ni vincular', async () => {
    const u = await signup();
    expect((await api(u.token, 'GET', `/api/admin/users/search?q=${adm.alias}`)).status).toBe(404);
    expect((await api(u.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Yo Mismo', userId: u.id })).status).toBe(404);
    expect((await api(null, 'GET', `/api/admin/users/search?q=${adm.alias}`)).status).toBe(401);
  });

  it('el buscador de amigos sigue excluyendo a quien busca', async () => {
    expect((await api(adm.token, 'GET', `/api/friends/search?q=${adm.alias}`)).json.users).toEqual([]);
  });
});

describe('vincular a la propia cuenta', () => {
  it('asigna disponibilidad y comentarios sin publicarlos ni copiarlos al calendario, con auditoría', async () => {
    const r = await api(adm.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Yo Mismo', userId: adm.id });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ days: 2, comments: 1 });
    const s = (await api(adm.token, 'GET', '/api/admin/legacy/summary')).json;
    expect(s.names.find((n: any) => n.name === 'Yo Mismo')).toMatchObject({ state: 'linked', userId: adm.id, alias: adm.alias });
    const c = (await api(adm.token, 'GET', '/api/admin/legacy/comments')).json.comments.find((x: any) => x.id === 'us-c1');
    expect(c).toMatchObject({ reconciled_user_id: adm.id, published: 0 });
    // Disponibilidad: visible como hoja antigua propia, sin incorporar y sin tocar el calendario.
    const mine = (await api(adm.token, 'GET', '/api/legacy/availability/mine')).json.days;
    expect(mine.map((d: any) => d.day)).toEqual(['2026-01-15', future]);
    expect(mine.every((d: any) => d.incorporatedAt === null && d.currentStatus === null)).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM availability WHERE user_id = ?1').bind(adm.id).first('n')).toBe(0);
    // Originales intactos y registro de auditoría.
    expect(await env.DB.prepare(`SELECT legacy_status FROM legacy_availability WHERE id = 'us-a2'`).first('legacy_status')).toBe('libre');
    const log = await env.DB.prepare(`SELECT detail_json FROM audit_log WHERE action = 'legacy_identity.link' AND target_id = 'Yo Mismo' AND actor_id = ?1`).bind(adm.id).first<string>('detail_json');
    expect(JSON.parse(log!)).toMatchObject({ userId: adm.id, days: 2, comments: 1 });
  });
});
