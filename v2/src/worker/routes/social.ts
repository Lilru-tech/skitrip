import { Hono } from 'hono';
import { z } from 'zod';
import { offerPanel } from '../../core/analytics';
import type { AppEnv } from '../env';
import { audit, requireTripMember } from '../access';
import { ApiError, forbidden, newId, notFound, now, parseBody, parseQuery } from '../http';
import { rateLimit } from '../ratelimit';
import { zId } from '../schemas';
import { sha256Hex } from '../crypto';
import { mapAvailability, mapComments, mapShopping } from '../../core/sheets';

// Comentarios (públicos por estación o privados de viaje), avisos internos y administración.
export const socialRoutes = new Hono<AppEnv>();

socialRoutes.post('/comments', async (c) => {
  const me = c.get('user').id;
  const b = await parseBody(c, z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('area_public'), areaId: zId, body: z.string().trim().min(1).max(2000) }),
    z.object({ scope: z.literal('trip_private'), tripId: zId, body: z.string().trim().min(1).max(2000) }),
  ]));
  await rateLimit(c.env.DB, `comment:${me}`, 60, 3600);
  if (b.scope === 'trip_private') await requireTripMember(c.env.DB, b.tripId, me);
  else if (!(await c.env.DB.prepare('SELECT 1 FROM areas WHERE id = ?1').bind(b.areaId).first())) throw notFound('Estación');
  const id = newId();
  const t = now();
  await c.env.DB.prepare('INSERT INTO comments (id, author_id, scope, area_id, trip_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)')
    .bind(id, me, b.scope, b.scope === 'area_public' ? b.areaId : null, b.scope === 'trip_private' ? b.tripId : null, b.body, t).run();
  return c.json({ id }, 201);
});

socialRoutes.get('/trips/:id/comments', async (c) => {
  const tripId = c.req.param('id');
  await requireTripMember(c.env.DB, tripId, c.get('user').id);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.updated_at, u.id AS author_id, u.alias AS author_alias FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.scope = 'trip_private' AND c.trip_id = ?1 AND c.deleted_at IS NULL AND c.hidden = 0 ORDER BY c.created_at`,
  ).bind(tripId).all();
  return c.json({ comments: results });
});

/** Solo el autor edita o borra su comentario; cambiar el ID en la petición no da acceso a otros. */
async function ownComment(db: D1Database, id: string, me: string) {
  const cm = await db.prepare('SELECT * FROM comments WHERE id = ?1 AND deleted_at IS NULL').bind(id).first<any>();
  if (!cm) throw notFound('Comentario');
  if (cm.scope === 'trip_private') await requireTripMember(db, cm.trip_id, me);
  if (cm.author_id !== me) throw forbidden('Solo puedes modificar tus propios comentarios.');
  return cm;
}

socialRoutes.patch('/comments/:cid', async (c) => {
  const me = c.get('user').id;
  await ownComment(c.env.DB, c.req.param('cid'), me);
  const { body } = await parseBody(c, z.object({ body: z.string().trim().min(1).max(2000) }));
  await c.env.DB.prepare('UPDATE comments SET body = ?1, updated_at = ?2 WHERE id = ?3').bind(body, now(), c.req.param('cid')).run();
  return c.json({ ok: true });
});

socialRoutes.delete('/comments/:cid', async (c) => {
  const me = c.get('user').id;
  await ownComment(c.env.DB, c.req.param('cid'), me);
  await c.env.DB.prepare('UPDATE comments SET deleted_at = ?1 WHERE id = ?2').bind(now(), c.req.param('cid')).run();
  return c.json({ ok: true });
});

// ---------- Avisos internos ----------

socialRoutes.get('/notifications', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, kind, payload, created_at, read_at FROM notifications WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50',
  ).bind(c.get('user').id).all<any>();
  return c.json({ notifications: results.map((n) => ({ ...n, payload: JSON.parse(n.payload) })), unread: results.filter((n) => !n.read_at).length });
});

socialRoutes.post('/notifications/read', async (c) => {
  const { ids } = await parseBody(c, z.object({ ids: z.array(zId).max(100) }));
  const me = c.get('user').id;
  // Una sola sentencia para cualquier número de IDs; solo avisos propios y aún sin leer.
  if (!ids.length) return c.json({ ok: true, updated: 0 });
  const r = await c.env.DB.prepare('UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL AND id IN (SELECT value FROM json_each(?3))')
    .bind(now(), me, JSON.stringify([...new Set(ids)])).run();
  return c.json({ ok: true, updated: r.meta.changes ?? 0 });
});

// ---------- Ofertas guardadas e historial de una oferta ----------

socialRoutes.put('/offers/:oid/save', async (c) => {
  const me = c.get('user').id;
  if (!(await c.env.DB.prepare('SELECT 1 FROM offers WHERE id = ?1').bind(c.req.param('oid')).first())) throw notFound('Oferta');
  await c.env.DB.prepare('INSERT OR IGNORE INTO saved_offers (user_id, offer_id, created_at) VALUES (?1, ?2, ?3)').bind(me, c.req.param('oid'), now()).run();
  return c.json({ ok: true });
});
socialRoutes.delete('/offers/:oid/save', async (c) => {
  await c.env.DB.prepare('DELETE FROM saved_offers WHERE user_id = ?1 AND offer_id = ?2').bind(c.get('user').id, c.req.param('oid')).run();
  return c.json({ ok: true });
});

socialRoutes.get('/offers/:oid/history', async (c) => {
  const oid = c.req.param('oid');
  const offer = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?1').bind(oid).first<any>();
  if (!offer) throw notFound('Oferta');
  const { results } = await c.env.DB.prepare(
    'SELECT observed_at, amount_cents, price_kind, unit, availability, scenario_id FROM offer_observations WHERE offer_id = ?1 ORDER BY observed_at LIMIT 1000',
  ).bind(oid).all<any>();
  const points = results.map((r) => ({ observedAt: r.observed_at, amountCents: r.amount_cents, priceKind: r.price_kind, unit: r.unit, availability: r.availability }));
  return c.json({ offer, points, panel: offerPanel(points), note: 'Evolución de una oferta fija: mismo proveedor, alojamiento y condiciones.' });
});

// ---------- Administración ----------

const admin = new Hono<AppEnv>();
admin.use('*', async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new ApiError(404, 'not_found', 'Ruta no encontrada.');
  await next();
});

admin.get('/health', async (c) => {
  const db = c.env.DB;
  const nowMs = Date.now();
  const [runs, health, coverage, users, sizes] = await db.batch([
    db.prepare(`SELECT * FROM capture_runs ORDER BY started_at DESC LIMIT 30`),
    db.prepare(`SELECT s.id, s.area_id, s.kind, s.provider, s.status, h.last_attempt_at, h.last_success_at, h.last_status, h.last_error, h.consecutive_fail
                FROM sources s LEFT JOIN source_health h ON h.source_id = s.id ORDER BY s.kind, s.area_id`),
    db.prepare(`SELECT a.id, (SELECT MAX(observed_at) FROM snow_observations s WHERE s.area_id = a.id) AS last_snow FROM areas a ORDER BY a.id`),
    db.prepare(`SELECT COUNT(*) AS n, SUM(status = 'blocked') AS blocked FROM users`),
    db.prepare(`SELECT (SELECT COUNT(*) FROM snow_observations) AS snow, (SELECT COUNT(*) FROM offer_observations) AS offers, (SELECT COUNT(*) FROM price_observations) AS prices,
                       (SELECT COUNT(*) FROM legacy_hotel_observations) AS legacy_hotel, (SELECT COUNT(*) FROM legacy_snow_observations) AS legacy_snow,
                       (SELECT COUNT(*) FROM search_scenarios WHERE active = 1) AS active_scenarios`),
  ]);
  const snowStaleMs = 30 * 3600_000;
  return c.json({
    runs: runs.results, sources: health.results,
    coverage: (coverage.results as any[]).map((r) => ({ areaId: r.id, lastSnow: r.last_snow, snowFreshness: r.last_snow == null ? 'never' : nowMs - r.last_snow <= snowStaleMs ? 'fresh' : 'stale' })),
    users: (users.results as any[])[0], maxProfiles: Number(c.env.MAX_PROFILES) || 50, rows: (sizes.results as any[])[0],
    quotas: { note: 'Workers Free: 100.000 peticiones/día y 10 ms de CPU por petición. D1 Free: 5 M filas leídas y 100.000 escritas al día, 500 MB por base. Al llegar al límite, las peticiones fallan: no se factura.' },
  });
});

/** Cuentas para moderación (sin emails): permite desbloquear a quien se bloqueó en cualquier sesión. */
admin.get('/users', async (c) => {
  const { status } = parseQuery(c, z.object({ status: z.enum(['active', 'blocked']).optional() }));
  const { results } = await c.env.DB.prepare(
    `SELECT id, alias, role, status, created_at FROM users WHERE (?1 IS NULL OR status = ?1) ORDER BY alias_norm LIMIT 500`,
  ).bind(status ?? null).all();
  return c.json({ users: results });
});

admin.post('/users/:uid/:action{block|unblock}', async (c) => {
  const me = c.get('user');
  const uid = c.req.param('uid');
  if (uid === me.id) throw new ApiError(422, 'validation', 'No puedes bloquearte a ti mismo.');
  const block = c.req.param('action') === 'block';
  const r = await c.env.DB.prepare(`UPDATE users SET status = ?1, tokens_valid_after = CASE WHEN ?1 = 'blocked' THEN ?2 ELSE tokens_valid_after END, updated_at = ?3 WHERE id = ?4`)
    .bind(block ? 'blocked' : 'active', Math.floor(Date.now() / 1000), now(), uid).run();
  if (!r.meta.changes) throw notFound('Usuario');
  await audit(c.env.DB, me.id, block ? 'user.block' : 'user.unblock', 'user', uid);
  return c.json({ ok: true });
});

admin.post('/comments/:cid/hide', async (c) => {
  const me = c.get('user');
  const { hidden, reason } = await parseBody(c, z.object({ hidden: z.boolean(), reason: z.string().max(300).optional() }));
  const r = await c.env.DB.prepare('UPDATE comments SET hidden = ?1 WHERE id = ?2').bind(hidden ? 1 : 0, c.req.param('cid')).run();
  if (!r.meta.changes) throw notFound('Comentario');
  await audit(c.env.DB, me.id, hidden ? 'comment.hide' : 'comment.unhide', 'comment', c.req.param('cid'), { reason });
  return c.json({ ok: true });
});

admin.get('/legacy/comments', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, u.alias AS reconciled_alias FROM legacy_comments l LEFT JOIN users u ON u.id = l.reconciled_user_id ORDER BY l.created_at_text LIMIT 500`,
  ).all();
  return c.json({ comments: results, note: 'Autoría legacy = nombre libre. Solo se asigna a una cuenta por acción administrativa explícita.' });
});

// Reconciliación explícita: un alias parecido no prueba identidad.
admin.post('/legacy/comments/:lid/reconcile', async (c) => {
  const me = c.get('user');
  const { userId, publish } = await parseBody(c, z.object({ userId: zId.nullable(), publish: z.boolean().default(false) }));
  if (userId && !(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?1').bind(userId).first())) throw notFound('Usuario');
  const r = await c.env.DB.prepare('UPDATE legacy_comments SET reconciled_user_id = ?1, reconciled_by = ?2, reconciled_at = ?3, published = ?4 WHERE id = ?5')
    .bind(userId, me.id, now(), publish ? 1 : 0, c.req.param('lid')).run();
  if (!r.meta.changes) throw notFound('Comentario legacy');
  await audit(c.env.DB, me.id, 'legacy_comment.reconcile', 'legacy_comment', c.req.param('lid'), { userId, publish });
  return c.json({ ok: true });
});

// Disponibilidad legacy: resumen por nombre y asignación explícita a una cuenta. No se copia al calendario nuevo.
admin.get('/legacy/availability', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.legacy_person_name AS person, COUNT(*) AS days, MIN(l.day) AS first_day, MAX(l.day) AS last_day,
            SUM(l.mapped_status IS NULL) AS unmapped, l.reconciled_user_id, u.alias AS reconciled_alias
     FROM legacy_availability l LEFT JOIN users u ON u.id = l.reconciled_user_id
     GROUP BY l.legacy_person_name, l.reconciled_user_id ORDER BY l.legacy_person_name`,
  ).all();
  return c.json({ people: results, note: 'Solo contiene los días marcados en la hoja; el resto queda sin indicar, nunca libre.' });
});

admin.post('/legacy/availability/reconcile', async (c) => {
  const me = c.get('user');
  const { person, userId } = await parseBody(c, z.object({ person: z.string().min(1).max(120), userId: zId.nullable() }));
  if (userId && !(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?1').bind(userId).first())) throw notFound('Usuario');
  const r = await c.env.DB.prepare('UPDATE legacy_availability SET reconciled_user_id = ?1 WHERE legacy_person_name = ?2').bind(userId, person).run();
  if (!r.meta.changes) throw notFound('Persona legacy');
  await audit(c.env.DB, me.id, 'legacy_availability.reconcile', 'legacy_person', person, { userId, days: r.meta.changes });
  return c.json({ ok: true, days: r.meta.changes });
});

/**
 * Cada persona ve solo sus días legacy ya asignados por un administrador, junto al estado actual de su calendario.
 * Nada se copia sin una incorporación explícita; los días que la hoja no tenía siguen sin indicar.
 */
socialRoutes.get('/legacy/availability/mine', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.day, l.legacy_status, l.mapped_status, l.incorporated_at, a.status AS current_status
     FROM legacy_availability l LEFT JOIN availability a ON a.user_id = l.reconciled_user_id AND a.day = l.day
     WHERE l.reconciled_user_id = ?1 ORDER BY l.day LIMIT 2000`,
  ).bind(c.get('user').id).all<any>();
  return c.json({
    days: results.map((r) => ({ day: r.day, legacyStatus: r.legacy_status, mappedStatus: r.mapped_status, currentStatus: r.current_status ?? null, incorporatedAt: r.incorporated_at })),
    note: 'Datos de la hoja antigua, asignados a tu cuenta por administración. No se copian a tu calendario hasta que los incorpores. Los días que no estaban en la hoja siguen sin indicar.',
  });
});

socialRoutes.post('/legacy/availability/mine/incorporate', async (c) => {
  const me = c.get('user').id;
  const { days, overwrite } = await parseBody(c, z.object({ days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(400), overwrite: z.boolean().default(false) }));
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT l.day, l.mapped_status, a.status AS current_status FROM legacy_availability l LEFT JOIN availability a ON a.user_id = l.reconciled_user_id AND a.day = l.day
     WHERE l.reconciled_user_id = ?1 AND l.day IN (SELECT value FROM json_each(?2))`,
  ).bind(me, JSON.stringify([...new Set(days)])).all<{ day: string; mapped_status: string | null; current_status: string | null }>();
  const unmapped = results.filter((r) => !r.mapped_status);
  const existing = results.filter((r) => r.mapped_status && r.current_status && !overwrite);
  const take = results.filter((r) => r.mapped_status && (overwrite || !r.current_status)).map((r) => ({ day: r.day, status: r.mapped_status }));
  if (take.length) {
    const t = Date.now();
    const J = (k: string) => `json_extract(value, '$.${k}')`;
    await db.batch([
      db.prepare(`INSERT INTO availability (user_id, day, status, updated_at) SELECT ?1, ${J('day')}, ${J('status')}, ?2 FROM json_each(?3) WHERE true
                  ON CONFLICT (user_id, day) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).bind(me, t, JSON.stringify(take)),
      db.prepare(`UPDATE legacy_availability SET incorporated_at = ?2 WHERE reconciled_user_id = ?1 AND day IN (SELECT ${J('day')} FROM json_each(?3))`).bind(me, t, JSON.stringify(take)),
    ]);
  }
  return c.json({ incorporated: take.length, skippedExisting: existing.length, skippedUnmapped: unmapped.length, notAssigned: new Set(days).size - results.length });
});

// Importación de las hojas antiguas (CSV exportado a mano) desde la administración, para no depender de wrangler en
// un ordenador: misma lógica e identificadores que tools/import-sheets.ts, así que ambas vías son idempotentes entre sí.
// Vista previa (dryRun) con recuentos y errores; nada se publica ni se asigna a una cuenta al importar.
const SHEET_RAW_CHUNK = 40_000;   // igual que tools/import-sheets.ts (mismos idx en legacy_raw_chunks)
const SHEET_ROWS_PER_STMT = 1000; // filas por sentencia (un solo parámetro JSON, sin el límite de 100 parámetros)
const SHEET_MAX_ROWS = 5000;      // por petición: CPU y consultas D1 acotadas (10–20 personas caben de sobra)
const zSheetImport = z.object({
  kind: z.enum(['comments', 'availability', 'shopping']),
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(450_000),
  dryRun: z.boolean().default(true),
  allowPartial: z.boolean().default(false),
});
admin.post('/legacy/sheets/import', async (c) => {
  const me = c.get('user');
  const db = c.env.DB;
  const b = await parseBody(c, zSheetImport);
  const content = b.csv.replace(/^﻿/, '');
  const { results: ids } = await db.prepare("SELECT legacy_id FROM legacy_id_map WHERE legacy_kind = 'resort'").all<{ legacy_id: string }>();
  const mapped = b.kind === 'comments' ? mapComments(content, new Set(ids.map((r) => r.legacy_id)))
    : b.kind === 'availability' ? mapAvailability(content) : mapShopping(content);
  const sha = await sha256Hex(content);
  const fileId = `legacy-sheets_${b.kind}-${sha.slice(0, 16)}`;
  const table = b.kind === 'comments' ? 'legacy_comments' : b.kind === 'availability' ? 'legacy_availability' : 'legacy_shopping_items';
  const prior = await db.prepare(`SELECT (SELECT COUNT(*) FROM legacy_import_files WHERE sha256 = ?1) AS files, (SELECT COUNT(*) FROM ${table} WHERE file_id = ?2) AS rows`)
    .bind(sha, fileId).first<{ files: number; rows: number }>();
  const report = {
    kind: b.kind, file: b.fileName, sha256: sha, bytes: new TextEncoder().encode(content).length, headers: mapped.headers,
    valid: mapped.rows.length, errors: mapped.errors.slice(0, 50), errorCount: mapped.errors.length, warnings: mapped.warnings.slice(0, 50), warningCount: mapped.warnings.length,
    duplicates: mapped.duplicates, alreadyImported: { file: !!prior?.files, rows: prior?.rows ?? 0 },
    ...(b.kind === 'availability' ? { byStatus: (mapped.rows as { mapped: string | null }[]).reduce<Record<string, number>>((m, r) => ({ ...m, [r.mapped ?? 'sin_equivalencia']: (m[r.mapped ?? 'sin_equivalencia'] ?? 0) + 1 }), {}) } : {}),
    sample: mapped.rows.slice(0, 5).map(({ key: _k, ...r }) => r),
  };
  if (b.dryRun) return c.json({ dryRun: true, report });
  if (mapped.errors.length && !b.allowPartial) throw new ApiError(422, 'invalid_rows', `La hoja tiene ${mapped.errors.length} filas con errores: corrígelas o importa omitiendo solo esas filas.`);
  if (!mapped.rows.length) throw new ApiError(422, 'empty', 'La hoja no tiene filas válidas.');
  if (mapped.rows.length > SHEET_MAX_ROWS) throw new ApiError(422, 'too_many_rows', `La hoja tiene ${mapped.rows.length} filas; el máximo por importación es ${SHEET_MAX_ROWS}. Divide el CSV en partes (cada parte se importa sin duplicar).`);

  const rows = await Promise.all((mapped.rows as any[]).map(async (r) => ({ ...r, id: crypto.randomUUID(), hash: await sha256Hex(r.key) })));
  const J = (k: string) => `json_extract(value, '$.${k}')`;
  const insert = b.kind === 'comments'
    ? `INSERT OR IGNORE INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published)
       SELECT ${J('id')}, ?1, ${J('hash')}, ${J('author')}, ${J('resortId')}, ${J('body')}, ${J('createdText')}, 0 FROM json_each(?2)`
    : b.kind === 'availability'
      ? `INSERT OR IGNORE INTO legacy_availability (id, file_id, row_hash, legacy_person_name, day, legacy_status, mapped_status)
         SELECT ${J('id')}, ?1, ${J('hash')}, ${J('person')}, ${J('day')}, ${J('legacyStatus')}, ${J('mapped')} FROM json_each(?2)`
      : `INSERT OR IGNORE INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name, extra_json)
         SELECT ${J('id')}, ?1, ${J('hash')}, ${J('name')}, ${J('quantityText')}, ${J('priceText')}, ${J('person')}, ${J('extra')} FROM json_each(?2)`;
  const payload = (r: any) => b.kind === 'shopping' ? { ...r, extra: Object.keys(r.extra).length ? JSON.stringify(r.extra) : null } : r;
  const stmts = [
    db.prepare(`INSERT OR IGNORE INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, source_ref, imported_at, report_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin-upload', ?7, ?8)`)
      .bind(fileId, `sheets_${b.kind}`, b.fileName, sha, report.bytes, mapped.rows.length, Date.now(), JSON.stringify({ ...report, errors: report.errorCount, warnings: report.warningCount, sample: undefined, importedBy: me.id })),
  ];
  for (let i = 0, n = 0; i < content.length; i += SHEET_RAW_CHUNK, n++) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO legacy_raw_chunks (file_id, idx, data) VALUES (?1, ?2, ?3)').bind(fileId, n, content.slice(i, i + SHEET_RAW_CHUNK)));
  }
  for (let i = 0; i < rows.length; i += SHEET_ROWS_PER_STMT) {
    stmts.push(db.prepare(insert).bind(fileId, JSON.stringify(rows.slice(i, i + SHEET_ROWS_PER_STMT).map(payload))));
  }
  const res = await db.batch(stmts);
  const inserted = res.slice(stmts.length - Math.ceil(rows.length / SHEET_ROWS_PER_STMT)).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  await audit(db, me.id, 'legacy_sheets.import', 'legacy_import_file', fileId, { kind: b.kind, rows: rows.length, inserted, skippedErrors: mapped.errors.length });
  return c.json({ dryRun: false, fileId, inserted, alreadyPresent: rows.length - inserted, skippedErrors: mapped.errors.length, report });
});

socialRoutes.route('/admin', admin);
