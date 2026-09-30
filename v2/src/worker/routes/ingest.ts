import { Hono } from 'hono';
import { z } from 'zod';
import { classifySnow } from '../../core/parsers/snow';
import type { AppEnv } from '../env';
import { sha256Hex, safeEqual } from '../crypto';
import { ApiError, now, parseBody } from '../http';
import { zDate, zId } from '../schemas';

/**
 * Ingesta por lotes de los recolectores (GitHub Actions). Credencial propia (INGEST_TOKEN), distinta de
 * las sesiones de usuario, con privilegios mínimos: solo escribe observaciones, ejecuciones y salud.
 * Idempotente: reenviar el mismo lote no duplica filas.
 */
export const ingestRoutes = new Hono<AppEnv>();

ingestRoutes.use('*', async (c, next) => {
  const expected = c.env.INGEST_TOKEN;
  const got = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!expected || expected.length < 16 || !got || !(await safeEqual(got, expected))) {
    throw new ApiError(401, 'ingest_unauthorized', 'Credencial de ingesta no válida.');
  }
  await next();
});

const zRun = z.object({
  id: z.string().min(8).max(80).regex(/^[A-Za-z0-9._:-]+$/),
  pipeline: z.enum(['snow', 'offers', 'prices']),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive().nullable().optional(),
  expected: z.number().int().min(0).max(10_000),
  ok: z.number().int().min(0).max(10_000),
  failed: z.number().int().min(0).max(10_000),
  unsupported: z.number().int().min(0).max(10_000),
  runner: z.string().max(120).optional(),
  errorSummary: z.string().max(2000).nullable().optional(),
});
const zHealth = z.object({
  sourceId: zId,
  status: z.enum(['ok', 'empty', 'error', 'blocked', 'unsupported']),
  error: z.string().max(500).nullable().optional(),
  attemptedAt: z.number().int().positive(),
});

function runStatus(r: z.infer<typeof zRun>, rowsWritten: number): 'ok' | 'partial' | 'empty' | 'error' {
  if (r.expected > 0 && r.ok === 0) return r.failed > 0 ? 'error' : 'empty';
  if (rowsWritten === 0 && r.expected > 0) return 'empty'; // cero filas: problema visible, no éxito silencioso
  if (r.failed > 0 || r.unsupported > 0) return 'partial';
  return 'ok';
}

async function upsertRun(db: D1Database, r: z.infer<typeof zRun>, rowsWritten: number) {
  const status = runStatus(r, rowsWritten);
  await db.prepare(
    `INSERT INTO capture_runs (id, pipeline, started_at, finished_at, expected, ok, failed, unsupported, rows_written, status, error_summary, runner)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT (id) DO UPDATE SET finished_at = excluded.finished_at, expected = excluded.expected, ok = excluded.ok, failed = excluded.failed,
       unsupported = excluded.unsupported, rows_written = capture_runs.rows_written + excluded.rows_written, status = excluded.status, error_summary = excluded.error_summary`,
  ).bind(r.id, r.pipeline, r.startedAt, r.finishedAt ?? null, r.expected, r.ok, r.failed, r.unsupported, rowsWritten, status, r.errorSummary ?? null, r.runner ?? null).run();
  return status;
}

async function applyHealth(db: D1Database, items: z.infer<typeof zHealth>[]) {
  const stmts = items.map((h) => db.prepare(
    `INSERT INTO source_health (source_id, last_attempt_at, last_success_at, last_status, last_error, consecutive_fail)
     VALUES (?1, ?2, CASE WHEN ?3 = 'ok' THEN ?2 END, ?3, ?4, CASE WHEN ?3 = 'ok' THEN 0 ELSE 1 END)
     ON CONFLICT (source_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
       last_success_at = CASE WHEN excluded.last_status = 'ok' THEN excluded.last_attempt_at ELSE source_health.last_success_at END,
       last_status = excluded.last_status, last_error = excluded.last_error,
       consecutive_fail = CASE WHEN excluded.last_status = 'ok' THEN 0 ELSE source_health.consecutive_fail + 1 END`,
  ).bind(h.sourceId, h.attemptedAt, h.status, h.error ?? null));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

const zSnowObs = z.object({
  sourceId: zId,
  areaId: zId,
  observedAt: z.number().int().positive(),
  sourceDate: zDate.nullable().optional(),
  opStatus: z.enum(['open', 'partial', 'closed_confirmed', 'out_of_season', 'unknown']),
  openKm: z.number().min(0).max(1000).nullable(),
  totalKm: z.number().positive().max(1000).nullable(),
  openRuns: z.number().int().min(0).max(1000).nullable().optional(),
  totalRuns: z.number().int().min(0).max(1000).nullable().optional(),
  openLifts: z.number().int().min(0).max(500).nullable().optional(),
  totalLifts: z.number().int().min(0).max(500).nullable().optional(),
  depthMinCm: z.number().int().min(0).max(2000).nullable().optional(),
  depthMaxCm: z.number().int().min(0).max(2000).nullable().optional(),
  extractor: z.string().min(1).max(80),
});

ingestRoutes.post('/snow', async (c) => {
  const body = await parseBody(c, z.object({ run: zRun.extend({ pipeline: z.literal('snow') }), observations: z.array(zSnowObs).max(500), health: z.array(zHealth).max(500) }));
  const db = c.env.DB;
  const srcIds = [...new Set(body.observations.map((o) => o.sourceId))];
  const sources = new Map<string, { scope_area_id: string; kind: string }>();
  for (const id of srcIds) {
    const s = await db.prepare('SELECT scope_area_id, kind FROM sources WHERE id = ?1').bind(id).first<{ scope_area_id: string; kind: string }>();
    if (s) sources.set(id, s);
  }
  // Se registra la ejecución primero (FK de las observaciones).
  await upsertRun(db, body.run, 0);
  let written = 0;
  const rejected: { sourceId: string; areaId: string; reason: string }[] = [];
  for (const o of body.observations) {
    const src = sources.get(o.sourceId);
    // El ámbito de las cifras lo decide el registro de fuentes, no el recolector: evita duplicar un dominio en sus miembros.
    if (!src || src.kind !== 'snow' || src.scope_area_id !== o.areaId) { rejected.push({ sourceId: o.sourceId, areaId: o.areaId, reason: 'fuente o ámbito no registrado' }); continue; }
    if (o.openKm != null && o.totalKm != null && o.openKm > o.totalKm) { rejected.push({ sourceId: o.sourceId, areaId: o.areaId, reason: 'abiertos > totales' }); continue; }
    const area = await db.prepare('SELECT official_total_km FROM areas WHERE id = ?1').bind(o.areaId).first<{ official_total_km: number | null }>();
    const prev = await db.prepare('SELECT open_km, total_km, op_status FROM snow_observations WHERE area_id = ?1 AND source_id = ?2 ORDER BY observed_at DESC LIMIT 1').bind(o.areaId, o.sourceId).first<{ open_km: number | null; total_km: number | null; op_status: string }>();
    const q = classifySnow(
      { openKm: o.openKm, totalKm: o.totalKm, opStatus: o.opStatus },
      prev ? { openKm: prev.open_km, totalKm: prev.total_km, opStatus: prev.op_status as any } : undefined,
      { catalogTotalKm: area?.official_total_km ?? undefined },
    );
    const hash = await sha256Hex(JSON.stringify([o.sourceId, o.areaId, o.observedAt, o.sourceDate ?? null, o.opStatus, o.openKm, o.totalKm, o.openRuns ?? null, o.totalRuns ?? null, o.openLifts ?? null, o.totalLifts ?? null, o.depthMinCm ?? null, o.depthMaxCm ?? null]));
    const r = await db.prepare(
      `INSERT OR IGNORE INTO snow_observations (id, area_id, source_id, run_id, observed_at, source_date, op_status, open_km, total_km, open_runs, total_runs, open_lifts, total_lifts,
         depth_min_cm, depth_max_cm, quality, quality_note, content_hash, extractor)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
    ).bind(crypto.randomUUID(), o.areaId, o.sourceId, body.run.id, o.observedAt, o.sourceDate ?? null, o.opStatus, o.openKm, o.totalKm, o.openRuns ?? null, o.totalRuns ?? null,
      o.openLifts ?? null, o.totalLifts ?? null, o.depthMinCm ?? null, o.depthMaxCm ?? null, q.quality, q.reasons.join('; ') || null, hash, o.extractor).run();
    written += r.meta.changes ?? 0;
  }
  await applyHealth(db, body.health);
  const status = await upsertRun(db, body.run, written);
  return c.json({ written, rejected, runStatus: status });
});

const zOfferIn = z.object({
  providerOfferId: z.string().max(120).nullable(),
  hotelName: z.string().max(200).nullable(),
  board: z.string().max(40).nullable().optional(),
  nights: z.number().int().min(0).max(30).nullable().optional(),
  forfaitDays: z.number().int().min(0).max(30).nullable().optional(),
  adults: z.number().int().min(1).max(30).nullable().optional(),
  cancellation: z.enum(['free', 'partial', 'non_refundable', 'unknown']).nullable().optional(),
  unit: z.enum(['per_person', 'per_room', 'per_night', 'per_person_night', 'per_stay', 'unknown']),
  priceKind: z.enum(['advertised_from', 'quoted_for_search']),
  amountCents: z.number().int().min(0).max(100_000_000).nullable(),
  availability: z.enum(['available', 'unavailable', 'unknown']),
  url: z.string().url().max(500).nullable().optional(),
  checkIn: zDate.nullable().optional(),
  checkOut: zDate.nullable().optional(),
  extractor: z.string().min(1).max(80),
});

ingestRoutes.post('/offers', async (c) => {
  const body = await parseBody(c, z.object({
    run: zRun.extend({ pipeline: z.literal('offers') }),
    observedAt: z.number().int().positive(),
    results: z.array(z.object({
      scenarioId: zId,
      outcome: z.enum(['results', 'empty', 'error', 'blocked', 'unsupported']),
      error: z.string().max(500).nullable().optional(),
      offers: z.array(zOfferIn).max(60),
    })).max(100),
    // Ofertas orientativas de las páginas de catálogo (fechas y ocupación del proveedor, no de un viaje).
    catalog: z.array(z.object({
      sourceId: zId,
      outcome: z.enum(['results', 'empty', 'error', 'blocked', 'unsupported']),
      offers: z.array(zOfferIn).max(60),
    })).max(60).default([]),
    health: z.array(zHealth).max(200).default([]),
  }));
  const db = c.env.DB;
  await upsertRun(db, body.run, 0);
  let written = 0;
  for (const cat of body.catalog) {
    const src = await db.prepare(`SELECT scope_area_id, provider FROM sources WHERE id = ?1 AND kind = 'offers'`).bind(cat.sourceId).first<{ scope_area_id: string; provider: string }>();
    if (!src) continue;
    for (const o of cat.offers) {
      const norm = (s?: string | null) => (s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const modality = o.forfaitDays ? 'lodging_forfait' : 'lodging';
      const identity = await sha256Hex(JSON.stringify(['catalog', src.provider, src.scope_area_id, o.providerOfferId ?? norm(o.hotelName), o.board ?? null, o.nights ?? null, o.forfaitDays ?? null,
        o.adults ?? null, o.cancellation ?? null, o.checkIn ?? null, o.checkOut ?? null, modality, o.unit]));
      await db.prepare(
        `INSERT OR IGNORE INTO offers (id, provider_id, provider_offer_id, hotel_name_raw, area_id, forfait_area_id, modality, check_in, check_out, nights, adults, board, cancellation,
           forfait_days, url, identity_hash, first_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
      ).bind(crypto.randomUUID(), src.provider, o.providerOfferId, o.hotelName, src.scope_area_id, modality === 'lodging_forfait' ? src.scope_area_id : null, modality,
        o.checkIn ?? null, o.checkOut ?? null, o.nights ?? null, o.adults ?? null, o.board ?? null, o.cancellation ?? null, o.forfaitDays ?? null, o.url ?? null, identity, body.observedAt).run();
      const offer = await db.prepare('SELECT id FROM offers WHERE identity_hash = ?1').bind(identity).first<{ id: string }>();
      const hash = await sha256Hex(JSON.stringify([offer!.id, body.observedAt, o.amountCents, o.priceKind, o.unit, o.availability]));
      const ins = await db.prepare(
        `INSERT OR IGNORE INTO offer_observations (id, offer_id, scenario_id, run_id, observed_at, price_kind, amount_cents, unit, currency, availability, extractor, content_hash)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 'EUR', ?8, ?9, ?10)`,
      ).bind(crypto.randomUUID(), offer!.id, body.run.id, body.observedAt, o.priceKind, o.amountCents, o.unit, o.availability, o.extractor, hash).run();
      if (ins.meta.changes) { written++; await notifyPriceChange(db, offer!.id, o.amountCents, o.priceKind, o.unit, body.observedAt); }
    }
  }
  for (const res of body.results) {
    const sc = await db.prepare('SELECT * FROM search_scenarios WHERE id = ?1').bind(res.scenarioId).first<any>();
    if (!sc) continue;
    await db.prepare(`INSERT OR IGNORE INTO scenario_runs (id, scenario_id, run_id, observed_at, outcome, offers_found, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(crypto.randomUUID(), sc.id, body.run.id, body.observedAt, res.outcome, res.offers.length, res.error ?? null).run();
    await db.prepare('UPDATE search_scenarios SET last_run_at = ?1 WHERE id = ?2').bind(body.observedAt, sc.id).run();
    for (const o of res.offers) {
      const norm = (s?: string | null) => (s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
      // Identidad = proveedor + oferta/hotel + condiciones. El precio NO forma parte de la identidad.
      const identity = await sha256Hex(JSON.stringify([sc.provider_id, o.providerOfferId ?? norm(o.hotelName), o.board ?? null, o.nights ?? sc.nights, o.forfaitDays ?? sc.forfait_days,
        o.adults ?? sc.adults, o.cancellation ?? null, o.checkIn ?? sc.check_in, o.checkOut ?? sc.check_out, sc.modality, o.unit]));
      await db.prepare(
        `INSERT OR IGNORE INTO offers (id, provider_id, provider_offer_id, hotel_name_raw, area_id, forfait_area_id, modality, check_in, check_out, nights, adults, children_ages,
           board, cancellation, forfait_days, url, identity_hash, first_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      ).bind(crypto.randomUUID(), sc.provider_id, o.providerOfferId, o.hotelName, sc.area_id, sc.modality === 'lodging_forfait' ? sc.area_id : null, sc.modality,
        o.checkIn ?? sc.check_in, o.checkOut ?? sc.check_out, o.nights ?? sc.nights, o.adults ?? sc.adults, sc.children_ages, o.board ?? null, o.cancellation ?? null,
        o.forfaitDays ?? sc.forfait_days, o.url ?? null, identity, body.observedAt).run();
      const offer = await db.prepare('SELECT id FROM offers WHERE identity_hash = ?1').bind(identity).first<{ id: string }>();
      const hash = await sha256Hex(JSON.stringify([offer!.id, body.observedAt, o.amountCents, o.priceKind, o.unit, o.availability]));
      const ins = await db.prepare(
        `INSERT OR IGNORE INTO offer_observations (id, offer_id, scenario_id, run_id, observed_at, price_kind, amount_cents, unit, currency, availability, extractor, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'EUR', ?9, ?10, ?11)`,
      ).bind(crypto.randomUUID(), offer!.id, sc.id, body.run.id, body.observedAt, o.priceKind, o.amountCents, o.unit, o.availability, o.extractor, hash).run();
      if (ins.meta.changes) {
        written++;
        await notifyPriceChange(db, offer!.id, o.amountCents, o.priceKind, o.unit, body.observedAt);
      }
    }
  }
  await applyHealth(db, body.health);
  const status = await upsertRun(db, body.run, written);
  return c.json({ written, runStatus: status });
});

/** Aviso interno si cambia ≥ 3 % el precio comparable de una oferta guardada. Máximo un aviso por oferta y día. */
async function notifyPriceChange(db: D1Database, offerId: string, amount: number | null, priceKind: string, unit: string, observedAt: number) {
  if (amount == null) return;
  const prev = await db.prepare(
    `SELECT amount_cents, observed_at FROM offer_observations WHERE offer_id = ?1 AND price_kind = ?2 AND unit = ?3 AND amount_cents IS NOT NULL AND observed_at < ?4
     ORDER BY observed_at DESC LIMIT 1`,
  ).bind(offerId, priceKind, unit, observedAt).first<{ amount_cents: number; observed_at: number }>();
  if (!prev || prev.amount_cents === 0) return;
  const pct = ((amount - prev.amount_cents) / prev.amount_cents) * 100;
  if (Math.abs(pct) < 3) return;
  const day = new Date(observedAt).toISOString().slice(0, 10);
  const { results } = await db.prepare(
    `SELECT user_id FROM saved_offers WHERE offer_id = ?1
     UNION SELECT m.user_id FROM trip_candidates tc JOIN trip_members m ON m.trip_id = tc.trip_id WHERE tc.offer_id = ?1 AND tc.status IN ('proposed','chosen')`,
  ).bind(offerId).all<{ user_id: string }>();
  const payload = JSON.stringify({ offerId, fromCents: prev.amount_cents, toCents: amount, pct: Math.round(pct * 10) / 10, previousObservedAt: prev.observed_at, observedAt });
  const stmts = results.map((r) => db.prepare(
    `INSERT OR IGNORE INTO notifications (id, user_id, kind, dedupe_key, payload, created_at) VALUES (?1, ?2, 'offer_price_change', ?3, ?4, ?5)`,
  ).bind(crypto.randomUUID(), r.user_id, `offer:${offerId}:${day}`, payload, now()));
  if (stmts.length) await db.batch(stmts);
}

/** Escenarios que los recolectores deben consultar: solo activos y ligados a viajes vigentes, con tope. */
ingestRoutes.get('/scenarios', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.provider_id, s.area_id, s.modality, s.check_in, s.check_out, s.nights, s.adults, s.children_ages, s.rooms, s.forfait_days, s.last_run_at,
            (SELECT url FROM sources src WHERE src.kind = 'offers' AND src.scope_area_id = s.area_id AND src.provider = s.provider_id ORDER BY priority LIMIT 1) AS source_url
     FROM search_scenarios s
     WHERE s.active = 1 AND s.check_in >= ?1
       AND EXISTS (SELECT 1 FROM trip_scenarios ts JOIN trips t ON t.id = ts.trip_id WHERE ts.scenario_id = s.id AND t.status IN ('planning','decided'))
     ORDER BY s.check_in LIMIT 40`,
  ).bind(today).all();
  return c.json({ scenarios: results });
});

/** Fuentes de nieve activas para el recolector (catálogo cerrado: el servidor nunca visita URLs del navegador). */
ingestRoutes.get('/offer-sources', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, area_id, scope_area_id, provider, url, adapter FROM sources WHERE kind = 'offers' AND status IN ('verified','unverified') AND adapter IS NOT NULL AND url IS NOT NULL ORDER BY priority`,
  ).all();
  return c.json({ sources: results });
});

ingestRoutes.get('/snow-sources', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.area_id, s.scope_area_id, s.provider, s.url, s.adapter, s.match_aliases, a.name AS area_name FROM sources s JOIN areas a ON a.id = s.area_id
     WHERE s.kind = 'snow' AND s.status IN ('verified','unverified') AND s.adapter IS NOT NULL ORDER BY s.priority`,
  ).all();
  return c.json({ sources: results });
});
