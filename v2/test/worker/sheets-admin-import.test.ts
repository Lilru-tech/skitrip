// Importación de las hojas antiguas desde la administración (sin wrangler): vista previa, importación idempotente,
// mismos identificadores que tools/import-sheets.ts, nada publicado ni asignado y presupuesto de consultas D1.
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, signup } from './helpers';

const AVAIL = ['date,user,status', '10/01/2026,Ana Ejemplo,ocupado', '2026-01-11,Ana Ejemplo,quizá', '2026-01-12,Bea Ejemplo,libre', '2026-01-13,Bea Ejemplo,???'].join('\n');
const COMMENTS = ['id,resort_id,user,text,created', 'c-001,cerler-sheet,Ana Ejemplo,"Buena nieve, mucha cola",2026-01-12', 'c-002,inventada,Bea Ejemplo,Viento arriba,2026-01-13'].join('\n');

let adm: { token: string; id: string };
let user: { token: string; id: string };
beforeAll(async () => {
  adm = await signup();
  user = await signup();
  await env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?1`).bind(adm.id).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO legacy_id_map (legacy_kind, legacy_id, new_kind, new_id) VALUES ('resort','cerler-sheet','area','rv-cerler')`).run();
});

const imp = (token: string, body: Record<string, unknown>) => api(token, 'POST', '/api/admin/legacy/sheets/import', body);

describe('admin · importar hojas antiguas (CSV)', () => {
  it('solo administración: un usuario normal recibe 404 y no se escribe nada', async () => {
    expect((await imp(user.token, { kind: 'availability', fileName: 'disp.csv', csv: AVAIL, dryRun: false })).status).toBe(404);
    expect((await imp('', { kind: 'availability', fileName: 'disp.csv', csv: AVAIL })).status).toBe(401);
  });

  it('vista previa: recuentos, equivalencias y muestra, sin escribir en D1', async () => {
    const r = await imp(adm.token, { kind: 'availability', fileName: 'disp.csv', csv: AVAIL });
    expect(r.status).toBe(200);
    expect(r.json.dryRun).toBe(true);
    expect(r.json.report).toMatchObject({ kind: 'availability', valid: 4, errorCount: 0, alreadyImported: { file: false, rows: 0 } });
    expect(r.json.report.byStatus).toEqual({ busy: 1, maybe: 1, free: 1, sin_equivalencia: 1 });
    expect(r.json.report.sample[0]).toMatchObject({ person: 'Ana Ejemplo', day: '2026-01-10', legacyStatus: 'ocupado', mapped: 'busy' });
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM legacy_import_files WHERE kind = 'sheets_availability'`).first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect(r.d1).toBeLessThanOrEqual(40);
  });

  it('importar: copia íntegra, filas y auditoría; repetirlo no duplica', async () => {
    const r = await imp(adm.token, { kind: 'availability', fileName: 'disp.csv', csv: AVAIL, dryRun: false });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ dryRun: false, inserted: 4, alreadyPresent: 0, skippedErrors: 0 });
    expect(r.json.fileId).toBe(`legacy-sheets_availability-${r.json.report.sha256.slice(0, 16)}`);
    const raw = await env.DB.prepare('SELECT group_concat(data, \'\') AS d FROM (SELECT data FROM legacy_raw_chunks WHERE file_id = ?1 ORDER BY idx)').bind(r.json.fileId).first<{ d: string }>();
    expect(raw!.d).toBe(AVAIL);
    const rows = await env.DB.prepare('SELECT legacy_person_name AS p, day, mapped_status AS m, reconciled_user_id AS u FROM legacy_availability WHERE file_id = ?1 ORDER BY day').bind(r.json.fileId).all();
    expect(rows.results).toEqual([
      { p: 'Ana Ejemplo', day: '2026-01-10', m: 'busy', u: null }, { p: 'Ana Ejemplo', day: '2026-01-11', m: 'maybe', u: null },
      { p: 'Bea Ejemplo', day: '2026-01-12', m: 'free', u: null }, { p: 'Bea Ejemplo', day: '2026-01-13', m: null, u: null },
    ]);
    // Nada pasa al calendario nuevo por importar.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM availability').first<{ n: number }>())!.n).toBe(0);
    const log = await env.DB.prepare(`SELECT actor_id FROM audit_log WHERE action = 'legacy_sheets.import' AND target_id = ?1`).bind(r.json.fileId).first<{ actor_id: string }>();
    expect(log!.actor_id).toBe(adm.id);
    expect(r.d1).toBeLessThanOrEqual(40);

    const again = await imp(adm.token, { kind: 'availability', fileName: 'disp-otra-vez.csv', csv: AVAIL, dryRun: false });
    expect(again.json).toMatchObject({ inserted: 0, alreadyPresent: 4 });
    const pre = await imp(adm.token, { kind: 'availability', fileName: 'disp.csv', csv: AVAIL });
    expect(pre.json.report.alreadyImported).toEqual({ file: true, rows: 4 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM legacy_availability').first<{ n: number }>())!.n).toBe(4);
  });

  it('comentarios: se importan sin publicar ni asignar; estación desconocida es un aviso', async () => {
    const pre = await imp(adm.token, { kind: 'comments', fileName: 'coment.csv', csv: COMMENTS });
    expect(pre.json.report).toMatchObject({ valid: 2, errorCount: 0, warningCount: 1 });
    expect(pre.json.report.warnings[0].message).toContain('inventada');
    const r = await imp(adm.token, { kind: 'comments', fileName: 'coment.csv', csv: COMMENTS, dryRun: false });
    expect(r.json.inserted).toBe(2);
    const rows = await env.DB.prepare('SELECT published, reconciled_user_id AS u FROM legacy_comments WHERE file_id = ?1').bind(r.json.fileId).all();
    expect(rows.results.every((x: any) => x.published === 0 && x.u === null)).toBe(true);
  });

  it('filas con errores: no importa salvo que se pida omitir solo esas filas', async () => {
    const bad = ['date,user,status', '2026-01-20,Ana Ejemplo,ocupado', '31/02/2026,Ana Ejemplo,libre'].join('\n');
    const pre = await imp(adm.token, { kind: 'availability', fileName: 'mal.csv', csv: bad });
    expect(pre.json.report.errorCount).toBe(1);
    const refused = await imp(adm.token, { kind: 'availability', fileName: 'mal.csv', csv: bad, dryRun: false });
    expect(refused.status).toBe(422);
    expect(refused.json.error.code).toBe('invalid_rows');
    const partial = await imp(adm.token, { kind: 'availability', fileName: 'mal.csv', csv: bad, dryRun: false, allowPartial: true });
    expect(partial.json).toMatchObject({ inserted: 1, skippedErrors: 1 });
  });

  it('volumen: 5.000 días (el máximo) en una sola petición dentro del presupuesto de consultas; más se rechaza', async () => {
    const big = (people: number) => {
      const lines = ['date,user,status'];
      for (let p = 0; p < people; p++) for (let d = 0; d < 250; d++) lines.push(`${new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10)},Persona larga ${p},ocupado`);
      return lines.join('\n');
    };
    const r = await imp(adm.token, { kind: 'availability', fileName: 'grande.csv', csv: big(20), dryRun: false });
    expect(r.status).toBe(200);
    expect(r.json.inserted).toBe(5000);
    expect(r.d1).toBeLessThanOrEqual(40);
    const tooMany = await imp(adm.token, { kind: 'availability', fileName: 'enorme.csv', csv: big(21), dryRun: false });
    expect(tooMany.status).toBe(422);
    expect(tooMany.json.error.code).toBe('too_many_rows');
  });
});
