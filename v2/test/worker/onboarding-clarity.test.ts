// Incorporación guiada de la hoja antigua y fichas más claras: cada test falla sin el cambio correspondiente.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayMadrid } from '../../src/core/dates';
import { api, signup } from './helpers';

const pub = (path: string) => SELF.fetch(`http://localhost${path}`).then((r) => r.json<any>());
const today = todayMadrid();
const future = addDays(today, 40);
let adm: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  adm = await signup();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id),
    env.DB.prepare(`INSERT OR IGNORE INTO areas (id, name, kind, country) VALUES ('oc-ordino','Ordino (test)','resort','AD')`),
    env.DB.prepare(`INSERT OR IGNORE INTO origins (id, name, lat, lon) VALUES ('tarragona','Tarragona',41.1,1.2)`),
    env.DB.prepare(`INSERT OR IGNORE INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated, notes) VALUES
      ('tarragona','oc-ordino','(punto de la estación en el catálogo)',215,211,'OSRM (OpenStreetMap), router.project-osrm.org','2026-10-01',0,NULL)`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('oc-lf','sheets_test','oc.csv','oc-sha',0,0,0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_id_map (legacy_kind, legacy_id, new_kind, new_id) VALUES ('resort','ordino-old','area','oc-ordino')`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) VALUES
      ('oc-c1','oc-lf','oc-c1','Marta','global','Llevad cadenas aunque no nieve','2026-01-10',0),
      ('oc-c2','oc-lf','oc-c2','Marta','ordino-old','Poca cola a primera hora','2026-01-11',0),
      ('oc-c3','oc-lf','oc-c3','Jordi','global','Reservad el párking antes','2026-01-12',0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status) VALUES
      ('oc-a1','oc-lf','oc-a1','Marta','2026-01-15','ocupado','busy'),
      ('oc-a2','oc-lf','oc-a2','Marta','2026-02-20','libre','free'),
      ('oc-a3','oc-lf','oc-a3','Marta',?1,'ocupado','busy'),
      ('oc-a4','oc-lf','oc-a4','Quim','2026-03-01','ocupado','busy')`).bind(future),
  ]);
});

describe('hoja antigua: resumen y pasos guiados (solo administración)', () => {
  it('el resumen distingue conservado, pendiente de revisión e incorporado, y lo pasado como histórico', async () => {
    const u = await signup();
    expect((await api(u.token, 'GET', '/api/admin/legacy/summary')).status).toBe(404);
    const s = (await api(adm.token, 'GET', '/api/admin/legacy/summary')).json;
    expect(s.comments).toMatchObject({ total: 3, published: 0, pending: 3, general: 2, linked: 0 });
    expect(s.availability).toMatchObject({ days: 4, people: 2, linkedDays: 0, unlinkedDays: 4, incorporated: 0, pastDays: 3, firstDay: '2026-01-15', lastDay: future });
    expect(s.shopping.total).toBeGreaterThanOrEqual(0);
    expect(s.names).toEqual([
      { name: 'Jordi', days: 0, comments: 1, state: 'unlinked', userId: null, alias: null },
      { name: 'Marta', days: 3, comments: 2, state: 'unlinked', userId: null, alias: null },
      { name: 'Quim', days: 1, comments: 0, state: 'unlinked', userId: null, alias: null },
    ]);
    expect(s.note).toMatch(/no se trasladan a otra temporada/);
  });

  it('vincular un nombre asigna disponibilidad y comentarios a la vez, sin publicar; solo administración', async () => {
    const marta = await signup();
    expect((await api(marta.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Marta', userId: marta.id })).status).toBe(404);
    expect((await api(adm.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Nadie', userId: marta.id })).status).toBe(404);
    const r = (await api(adm.token, 'POST', '/api/admin/legacy/identities/link', { name: 'Marta', userId: marta.id })).json;
    expect(r).toMatchObject({ days: 3, comments: 2 });
    const s = (await api(adm.token, 'GET', '/api/admin/legacy/summary')).json;
    expect(s.names.find((n: any) => n.name === 'Marta')).toMatchObject({ state: 'linked', userId: marta.id, alias: marta.alias });
    expect(s.comments).toMatchObject({ linked: 2, published: 0 });
    const list = (await api(adm.token, 'GET', '/api/admin/legacy/comments')).json.comments;
    expect(list.filter((c: any) => c.id.startsWith('oc-')).every((c: any) => c.published === 0)).toBe(true);
    // El nombre de la estación sustituye al identificador legacy.
    expect(list.find((c: any) => c.id === 'oc-c2').area_name).toBe('Ordino (test)');
    const audit = await env.DB.prepare(`SELECT action, target_id FROM audit_log WHERE action = 'legacy_identity.link' AND target_id = 'Marta'`).first<any>();
    expect(audit).toBeTruthy();

    // Los días pasados son consulta histórica: no se copian al calendario. Los futuros sí, si la persona los elige.
    const mine = (await api(marta.token, 'GET', '/api/legacy/availability/mine')).json;
    expect(mine.today).toBe(today);
    expect(mine.days.map((d: any) => d.day)).toEqual(['2026-01-15', '2026-02-20', future]);
    const inc = (await api(marta.token, 'POST', '/api/legacy/availability/mine/incorporate', { days: ['2026-01-15', '2026-02-20', future] })).json;
    expect(inc).toMatchObject({ incorporated: 1, skippedPast: 2, skippedExisting: 0, skippedUnmapped: 0, notAssigned: 0 });
    const cal = (await api(marta.token, 'GET', `/api/availability/me?from=2026-01-01&to=${addDays(future, 1)}`)).json.days;
    expect(cal).toEqual({ [future]: 'busy' });
    // Nada se traslada a la temporada siguiente: ni el 15/01/2027 ni el 20/02/2027.
    expect(cal['2027-01-15']).toBeUndefined();
    expect(cal['2027-02-20']).toBeUndefined();
  });

  it('publicar solo los comentarios elegidos; la vinculación no cambia y el consejo general aparece en su sección', async () => {
    const u = await signup();
    expect((await api(u.token, 'POST', '/api/admin/legacy/comments/publish', { ids: ['oc-c1'], publish: true })).status).toBe(404);
    expect((await pub('/api/public/tips')).tips.map((t: any) => t.id)).not.toContain('oc-c1');

    const r = (await api(adm.token, 'POST', '/api/admin/legacy/comments/publish', { ids: ['oc-c1'], publish: true })).json;
    expect(r.updated).toBe(1);
    const tips = await pub('/api/public/tips');
    const tip = tips.tips.find((t: any) => t.id === 'oc-c1');
    expect(tip).toMatchObject({ body: 'Llevad cadenas aunque no nieve', legacyAuthorName: 'Marta', dateText: '2026-01-10' });
    expect(tip.linkedAlias).toBeTruthy(); // vinculado antes: publicar no lo desvincula
    expect(tips.tips.map((t: any) => t.id)).not.toContain('oc-c3'); // no elegido: sigue sin publicar
    expect(tips.note).toMatch(/texto libre/);
    // Un consejo general no se cuela en la ficha de una estación.
    expect((await pub('/api/public/areas/oc-ordino')).legacyComments.map((c: any) => c.id)).not.toContain('oc-c1');

    await api(adm.token, 'POST', '/api/admin/legacy/comments/publish', { ids: ['oc-c1'], publish: false });
    expect((await pub('/api/public/tips')).tips.map((t: any) => t.id)).not.toContain('oc-c1');
    expect((await api(adm.token, 'POST', '/api/admin/legacy/comments/publish', { ids: ['no-existe'], publish: true })).status).toBe(404);
  });
});

describe('ficha de estación: cómo llegar con su procedencia', () => {
  it('la ficha incluye las rutas desde cada origen con fuente, fecha y validación tal cual (sin marcarlas revisadas)', async () => {
    const a = await pub('/api/public/areas/oc-ordino');
    expect(a.routes).toEqual([{ originId: 'tarragona', originName: 'Tarragona', accessName: '(punto de la estación en el catálogo)', roadKm: 215, durationMin: 211,
      tollCents: null, source: 'OSRM (OpenStreetMap), router.project-osrm.org', checkedOn: '2026-10-01', validated: false, notes: null }]);
  });
});

describe('importar comentarios sin conocer identificadores internos', () => {
  it('la columna «estacion» acepta el nombre de la estación y «general»', async () => {
    const csv = 'estacion,autor,comentario,fecha\nOrdino (test),Ana,Buen día,12/01/2026\ngeneral,Ana,Consejo,13/01/2026\n';
    const r = (await api(adm.token, 'POST', '/api/admin/legacy/sheets/import', { kind: 'comments', fileName: 'c.csv', csv, dryRun: true })).json;
    expect(r.report.warningCount).toBe(0);
    expect(r.report.sample.map((x: any) => x.resortId)).toEqual(['ordino-old', 'global']);
  });
});
