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
  // Recuentos por fuente de ESTA parte (no acumulados): el servidor suma las partes.
  ok: z.number().int().min(0).max(10_000),
  failed: z.number().int().min(0).max(10_000),
  unsupported: z.number().int().min(0).max(10_000),
  runner: z.string().max(120).optional(),
  errorSummary: z.string().max(2000).nullable().optional(),
  part: z.number().int().min(0).max(199).default(0),
  parts: z.number().int().min(1).max(200).default(1),
}).refine((r) => r.part < r.parts, 'part debe ser menor que parts');
const zHealth = z.object({
  sourceId: zId,
  status: z.enum(['ok', 'empty', 'error', 'blocked', 'unsupported']),
  error: z.string().max(500).nullable().optional(),
  attemptedAt: z.number().int().positive(),
});
type Run = z.infer<typeof zRun>;

/**
 * Presupuesto de consultas: cada POST de ingesta usa un número FIJO de sentencias, independiente del tamaño del lote
 * (lecturas agrupadas con json_each y escrituras INSERT … SELECT FROM json_each(?)). Ver docs/QUOTAS.md.
 * Tamaño máximo por parte: MAX_ITEMS elementos; los recolectores dividen en partes y reenviar una parte es idempotente.
 */
export const MAX_ITEMS = 200;

/** Sentencias de ejecución/partes/salud, para ir en el MISMO batch (transacción) que las observaciones. */
function runStatements(db: D1Database, r: Run, accepted: number, rejected: number, health: z.infer<typeof zHealth>[], obsTable: string) {
  const t = now();
  return {
    // La fila de ejecución debe existir antes que las observaciones (clave foránea).
    head: db.prepare(
      `INSERT INTO capture_runs (id, pipeline, started_at, finished_at, expected, status, error_summary, runner, parts_total)
       VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8)
       ON CONFLICT (id) DO UPDATE SET finished_at = MAX(COALESCE(capture_runs.finished_at, 0), COALESCE(excluded.finished_at, 0)),
         expected = excluded.expected, parts_total = excluded.parts_total, error_summary = COALESCE(excluded.error_summary, capture_runs.error_summary)`,
    ).bind(r.id, r.pipeline, r.startedAt, r.finishedAt ?? null, r.expected, r.errorSummary ?? null, r.runner ?? null, r.parts),
    tail: [
      // Reenviar una parte sustituye sus recuentos: nunca suma dos veces.
      db.prepare(
        `INSERT INTO capture_run_parts (run_id, part, ok, failed, unsupported, accepted, rejected, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (run_id, part) DO UPDATE SET ok = excluded.ok, failed = excluded.failed, unsupported = excluded.unsupported,
           accepted = excluded.accepted, rejected = excluded.rejected, received_at = excluded.received_at`,
      ).bind(r.id, r.part, r.ok, r.failed, r.unsupported, accepted, rejected, t),
      db.prepare(
        `INSERT INTO source_health (source_id, last_attempt_at, last_success_at, last_status, last_error, consecutive_fail)
         SELECT json_extract(value, '$.sourceId'), json_extract(value, '$.attemptedAt'),
                CASE WHEN json_extract(value, '$.status') = 'ok' THEN json_extract(value, '$.attemptedAt') END,
                json_extract(value, '$.status'), json_extract(value, '$.error'), CASE WHEN json_extract(value, '$.status') = 'ok' THEN 0 ELSE 1 END
         FROM json_each(?1) WHERE json_extract(value, '$.sourceId') IN (SELECT id FROM sources)
         ON CONFLICT (source_id) DO UPDATE SET
           last_success_at = CASE WHEN excluded.last_status = 'ok' THEN MAX(excluded.last_attempt_at, COALESCE(source_health.last_success_at, 0)) ELSE source_health.last_success_at END,
           consecutive_fail = CASE WHEN excluded.last_attempt_at <= COALESCE(source_health.last_attempt_at, 0) THEN source_health.consecutive_fail
                                   WHEN excluded.last_status = 'ok' THEN 0 ELSE source_health.consecutive_fail + 1 END,
           last_status = CASE WHEN excluded.last_attempt_at >= COALESCE(source_health.last_attempt_at, 0) THEN excluded.last_status ELSE source_health.last_status END,
           last_error = CASE WHEN excluded.last_attempt_at >= COALESCE(source_health.last_attempt_at, 0) THEN excluded.last_error ELSE source_health.last_error END,
           last_attempt_at = MAX(excluded.last_attempt_at, COALESCE(source_health.last_attempt_at, 0))`,
      ).bind(JSON.stringify(health)),
      // Estado agregado a partir de TODAS las partes recibidas y de las filas que realmente hay en la base.
      db.prepare(
        `UPDATE capture_runs SET
           parts_received = (SELECT COUNT(*) FROM capture_run_parts WHERE run_id = ?1),
           ok = (SELECT COALESCE(SUM(ok), 0) FROM capture_run_parts WHERE run_id = ?1),
           failed = (SELECT COALESCE(SUM(failed), 0) FROM capture_run_parts WHERE run_id = ?1),
           unsupported = (SELECT COALESCE(SUM(unsupported), 0) FROM capture_run_parts WHERE run_id = ?1),
           accepted = (SELECT COALESCE(SUM(accepted), 0) FROM capture_run_parts WHERE run_id = ?1),
           rejected = (SELECT COALESCE(SUM(rejected), 0) FROM capture_run_parts WHERE run_id = ?1),
           rows_written = (SELECT COUNT(*) FROM ${obsTable} WHERE run_id = ?1)
         WHERE id = ?1`,
      ).bind(r.id),
      db.prepare(
        `UPDATE capture_runs SET status = CASE
           WHEN parts_received < parts_total THEN 'running'
           WHEN expected > 0 AND ok = 0 AND failed > 0 THEN 'error'
           WHEN expected > 0 AND (ok = 0 OR accepted = 0) THEN 'empty'
           WHEN failed > 0 OR unsupported > 0 OR rejected > 0 THEN 'partial'
           ELSE 'ok' END
         WHERE id = ?1 RETURNING status, parts_received, parts_total, accepted, rejected, rows_written`,
      ).bind(r.id),
    ],
  };
}

type RunSummary = { status: string; parts_received: number; parts_total: number; accepted: number; rejected: number; rows_written: number };
const lastRow = (res: D1Result[]) => (res.at(-1)!.results[0] as RunSummary);

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

// Nieve: 1 lectura + 1 batch de 6 sentencias = 7 sentencias por POST, sea cual sea el tamaño (≤ MAX_ITEMS).
ingestRoutes.post('/snow', async (c) => {
  const body = await parseBody(c, z.object({ run: zRun, observations: z.array(zSnowObs).max(MAX_ITEMS), health: z.array(zHealth).max(MAX_ITEMS) }));
  if (body.run.pipeline !== 'snow') throw new ApiError(422, 'validation', 'pipeline debe ser snow');
  const db = c.env.DB;
  const srcIds = [...new Set(body.observations.map((o) => o.sourceId))];
  // Una sola lectura: fuente, ámbito, total del catálogo y última observación de cada fuente.
  const { results: srcRows } = await db.prepare(
    `SELECT s.id, s.scope_area_id, s.kind, a.official_total_km,
            (SELECT json_object('openKm', o.open_km, 'totalKm', o.total_km, 'opStatus', o.op_status) FROM snow_observations o
              WHERE o.source_id = s.id AND o.area_id = s.scope_area_id ORDER BY o.observed_at DESC LIMIT 1) AS prev
     FROM sources s JOIN areas a ON a.id = s.scope_area_id WHERE s.id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(srcIds)).all<{ id: string; scope_area_id: string; kind: string; official_total_km: number | null; prev: string | null }>();
  const sources = new Map(srcRows.map((s) => [s.id, s]));
  const rows: Record<string, unknown>[] = [];
  const rejected: { sourceId: string; areaId: string; reason: string }[] = [];
  for (const o of body.observations) {
    const src = sources.get(o.sourceId);
    // El ámbito de las cifras lo decide el registro de fuentes, no el recolector: evita duplicar un dominio en sus miembros.
    if (!src || src.kind !== 'snow' || src.scope_area_id !== o.areaId) { rejected.push({ sourceId: o.sourceId, areaId: o.areaId, reason: 'fuente o ámbito no registrado' }); continue; }
    if (o.openKm != null && o.totalKm != null && o.openKm > o.totalKm) { rejected.push({ sourceId: o.sourceId, areaId: o.areaId, reason: 'abiertos > totales' }); continue; }
    const prev = src.prev ? JSON.parse(src.prev) : undefined;
    const q = classifySnow({ openKm: o.openKm, totalKm: o.totalKm, opStatus: o.opStatus }, prev, { catalogTotalKm: src.official_total_km ?? undefined });
    const hash = await sha256Hex(JSON.stringify([o.sourceId, o.areaId, o.observedAt, o.sourceDate ?? null, o.opStatus, o.openKm, o.totalKm, o.openRuns ?? null, o.totalRuns ?? null, o.openLifts ?? null, o.totalLifts ?? null, o.depthMinCm ?? null, o.depthMaxCm ?? null]));
    rows.push({ id: crypto.randomUUID(), ...o, sourceDate: o.sourceDate ?? null, openRuns: o.openRuns ?? null, totalRuns: o.totalRuns ?? null, openLifts: o.openLifts ?? null,
      totalLifts: o.totalLifts ?? null, depthMinCm: o.depthMinCm ?? null, depthMaxCm: o.depthMaxCm ?? null, quality: q.quality, qualityNote: q.reasons.join('; ') || null, hash });
  }
  const st = runStatements(db, body.run, rows.length, rejected.length, body.health, 'snow_observations');
  const J = (k: string) => `json_extract(value, '$.${k}')`;
  const res = await db.batch([
    st.head,
    db.prepare(
      `INSERT OR IGNORE INTO snow_observations (id, area_id, source_id, run_id, observed_at, source_date, op_status, open_km, total_km, open_runs, total_runs, open_lifts, total_lifts,
         depth_min_cm, depth_max_cm, quality, quality_note, content_hash, extractor)
       SELECT ${J('id')}, ${J('areaId')}, ${J('sourceId')}, ?2, ${J('observedAt')}, ${J('sourceDate')}, ${J('opStatus')}, ${J('openKm')}, ${J('totalKm')}, ${J('openRuns')}, ${J('totalRuns')},
         ${J('openLifts')}, ${J('totalLifts')}, ${J('depthMinCm')}, ${J('depthMaxCm')}, ${J('quality')}, ${J('qualityNote')}, ${J('hash')}, ${J('extractor')}
       FROM json_each(?1)`,
    ).bind(JSON.stringify(rows), body.run.id),
    ...st.tail,
  ]);
  const written = res[1].meta.changes ?? 0;
  const run = lastRow(res);
  return c.json({ written, accepted: rows.length, rejected, runStatus: run.status, run });
});

const zOfferIn = z.object({
  providerOfferId: z.string().max(120).nullable(),
  hotelName: z.string().max(200).nullable(),
  board: z.string().max(40).nullable().optional(),
  // Condiciones DECLARADAS por la tarjeta (null = la tarjeta no lo dice). Lo pedido al proveedor va en el escenario.
  nights: z.number().int().min(0).max(30).nullable().optional(),
  forfaitDays: z.number().int().min(0).max(30).nullable().optional(),
  forfaitIncluded: z.enum(['yes', 'no', 'unknown']).optional(),
  adults: z.number().int().min(1).max(30).nullable().optional(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).nullable().optional(),
  rooms: z.number().int().min(1).max(15).nullable().optional(),
  cancellation: z.enum(['free', 'partial', 'non_refundable', 'unknown']).nullable().optional(),
  unit: z.enum(['per_person', 'per_room', 'per_night', 'per_person_night', 'per_stay', 'unknown']),
  priceKind: z.enum(['advertised_from', 'quoted_for_search']),
  amountCents: z.number().int().min(0).max(100_000_000).nullable(),
  availability: z.enum(['available', 'unavailable', 'unknown']),
  url: z.string().url().max(500).nullable().optional(),
  checkIn: zDate.nullable().optional(),
  checkOut: zDate.nullable().optional(),
  warnings: z.array(z.string().max(200)).max(10).optional(),
  extractor: z.string().min(1).max(80),
});
type OfferIn = z.infer<typeof zOfferIn>;
type ScenarioRow = { id: string; provider_id: string; area_id: string; modality: string; check_in: string; check_out: string; nights: number; adults: number; children_ages: string; rooms: number | null; forfait_days: number | null };

const norm = (s?: string | null) => (s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const sameAges = (a: number[] | null | undefined, b: number[]) => a != null && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * ¿La tarjeta demuestra que cumple lo pedido? Solo si declara fechas y adultos iguales al escenario y, cuando el
 * escenario lleva menores o habitaciones, también esos datos. Lo pedido al proveedor no prueba nada por sí solo.
 */
export function verifyConditions(o: OfferIn, sc: ScenarioRow): { verified: boolean; missing: string[] } {
  const missing: string[] = [];
  if (o.checkIn !== sc.check_in || o.checkOut !== sc.check_out) missing.push('fechas');
  if (o.adults !== sc.adults) missing.push('adultos');
  const kids: number[] = JSON.parse(sc.children_ages || '[]');
  if (kids.length && !sameAges(o.childrenAges, kids)) missing.push('edades de menores');
  if (sc.rooms != null && o.rooms !== sc.rooms) missing.push('habitaciones');
  if (sc.modality === 'lodging_forfait' && (o.forfaitIncluded !== 'yes' || o.forfaitDays !== sc.forfait_days)) missing.push('forfait');
  if (sc.modality === 'lodging' && o.forfaitIncluded !== 'no') missing.push('sin forfait');
  return { verified: missing.length === 0, missing };
}

function forfaitOf(o: OfferIn): 'yes' | 'no' | 'unknown' {
  if (o.forfaitIncluded) return o.forfaitIncluded;
  return o.forfaitDays && o.forfaitDays > 0 ? 'yes' : 'unknown'; // null NO significa «sin forfait»
}

// Ofertas: 2 lecturas + 1 batch de 10 sentencias = 12 sentencias por POST (≤ MAX_ITEMS ofertas en total).
ingestRoutes.post('/offers', async (c) => {
  const body = await parseBody(c, z.object({
    run: zRun,
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
    health: z.array(zHealth).max(MAX_ITEMS).default([]),
  }));
  if (body.run.pipeline !== 'offers') throw new ApiError(422, 'validation', 'pipeline debe ser offers');
  const total = body.results.reduce((n, r) => n + r.offers.length, 0) + body.catalog.reduce((n, r) => n + r.offers.length, 0);
  if (total > MAX_ITEMS) throw new ApiError(422, 'too_many', `Máximo ${MAX_ITEMS} ofertas por parte; divide el lote.`);
  const db = c.env.DB;
  const [{ results: srcRows }, { results: scRows }] = await Promise.all([
    db.prepare(`SELECT id, scope_area_id, provider FROM sources WHERE kind = 'offers' AND id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(body.catalog.map((x) => x.sourceId))).all<{ id: string; scope_area_id: string; provider: string }>(),
    db.prepare(`SELECT id, provider_id, area_id, modality, check_in, check_out, nights, adults, children_ages, rooms, forfait_days FROM search_scenarios WHERE id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(body.results.map((x) => x.scenarioId))).all<ScenarioRow>(),
  ]);
  const sources = new Map(srcRows.map((s) => [s.id, s]));
  const scenarios = new Map(scRows.map((s) => [s.id, s]));
  const offers: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  let rejected = 0;
  const push = async (context: 'catalog' | 'scenario', provider: string, areaId: string, o: OfferIn, sc: ScenarioRow | null) => {
    const warnings = [...(o.warnings ?? [])];
    let priceKind: 'advertised_from' | 'quoted_for_search' = 'advertised_from';
    let verified = false;
    if (sc) {
      const v = verifyConditions(o, sc);
      verified = v.verified;
      if (o.priceKind === 'quoted_for_search' && verified) priceKind = 'quoted_for_search';
      else if (!verified) warnings.push(`Condiciones no verificadas en la tarjeta: ${v.missing.join(', ')}.`);
    } else if (o.priceKind === 'quoted_for_search') {
      warnings.push('Página de catálogo: precio orientativo aunque no diga «desde».');
    }
    const forfait = forfaitOf(o);
    const key = o.providerOfferId ?? norm(o.hotelName);
    if (!key) { rejected++; return; }
    // Identidad = contexto + proveedor + ámbito + oferta/hotel + condiciones declaradas (+ escenario). El precio NO forma parte.
    const identity = await sha256Hex(JSON.stringify([context, provider, areaId, sc?.id ?? null, key, o.board ?? null, o.cancellation ?? null, o.unit,
      o.nights ?? null, o.checkIn ?? null, o.checkOut ?? null, o.adults ?? null, o.childrenAges ? [...o.childrenAges].sort() : null, o.rooms ?? null, forfait, o.forfaitDays ?? null]));
    offers.push({ id: crypto.randomUUID(), provider, offerId: o.providerOfferId, hotel: o.hotelName, areaId, modality: forfait === 'yes' ? 'lodging_forfait' : 'lodging',
      checkIn: o.checkIn ?? null, checkOut: o.checkOut ?? null, nights: o.nights ?? null, adults: o.adults ?? null, childrenAges: o.childrenAges ? JSON.stringify(o.childrenAges) : null,
      rooms: o.rooms ?? null, board: o.board ?? null, cancellation: o.cancellation ?? null, forfaitDays: o.forfaitDays ?? null, forfait, url: o.url ?? null, identity,
      context, scenarioId: sc?.id ?? null, verified: verified ? 1 : 0 });
    const hash = await sha256Hex(JSON.stringify([identity, sc?.id ?? null, body.observedAt, o.amountCents, priceKind, o.unit, o.availability]));
    observations.push({ id: crypto.randomUUID(), identity, scenarioId: sc?.id ?? null, priceKind, amount: o.amountCents, unit: o.unit, availability: o.availability,
      extractor: o.extractor, hash, warnings: warnings.length ? JSON.stringify(warnings) : null });
  };
  for (const cat of body.catalog) {
    const src = sources.get(cat.sourceId);
    if (!src) { rejected += cat.offers.length; continue; }
    for (const o of cat.offers) await push('catalog', src.provider, src.scope_area_id, o, null);
  }
  const scenarioRuns: Record<string, unknown>[] = [];
  for (const r of body.results) {
    const sc = scenarios.get(r.scenarioId);
    if (!sc) { rejected += r.offers.length; continue; }
    scenarioRuns.push({ id: crypto.randomUUID(), scenarioId: sc.id, outcome: r.outcome, found: r.offers.length, error: r.error ?? null });
    for (const o of r.offers) await push('scenario', sc.provider_id, sc.area_id, o, sc);
  }
  const J = (k: string) => `json_extract(value, '$.${k}')`;
  const st = runStatements(db, body.run, observations.length, rejected, body.health, 'offer_observations');
  const day = new Date(body.observedAt).toISOString().slice(0, 10);
  const res = await db.batch([
    st.head,
    db.prepare(
      `INSERT OR IGNORE INTO offers (id, provider_id, provider_offer_id, hotel_name_raw, area_id, forfait_area_id, modality, check_in, check_out, nights, adults, children_ages, rooms,
         board, cancellation, forfait_days, forfait_included, url, identity_hash, context, scenario_id, conditions_verified, first_seen_at)
       SELECT ${J('id')}, ${J('provider')}, ${J('offerId')}, ${J('hotel')}, ${J('areaId')}, CASE WHEN ${J('forfait')} = 'yes' THEN ${J('areaId')} END, ${J('modality')},
         ${J('checkIn')}, ${J('checkOut')}, ${J('nights')}, ${J('adults')}, ${J('childrenAges')}, ${J('rooms')}, ${J('board')}, ${J('cancellation')}, ${J('forfaitDays')}, ${J('forfait')},
         ${J('url')}, ${J('identity')}, ${J('context')}, ${J('scenarioId')}, ${J('verified')}, ?2
       FROM json_each(?1)`,
    ).bind(JSON.stringify(offers), body.observedAt),
    db.prepare(
      `INSERT OR IGNORE INTO offer_observations (id, offer_id, scenario_id, run_id, observed_at, price_kind, amount_cents, unit, currency, availability, extractor, content_hash, warnings)
       SELECT ${J('id')}, (SELECT o.id FROM offers o WHERE o.identity_hash = ${J('identity')}), ${J('scenarioId')}, ?2, ?3, ${J('priceKind')}, ${J('amount')}, ${J('unit')}, 'EUR',
         ${J('availability')}, ${J('extractor')}, ${J('hash')}, ${J('warnings')}
       FROM json_each(?1)`,
    ).bind(JSON.stringify(observations), body.run.id, body.observedAt),
    db.prepare(
      `INSERT INTO scenario_runs (id, scenario_id, run_id, observed_at, outcome, offers_found, error)
       SELECT ${J('id')}, ${J('scenarioId')}, ?2, ?3, ${J('outcome')}, ${J('found')}, ${J('error')} FROM json_each(?1) WHERE true
       ON CONFLICT (scenario_id, run_id) DO UPDATE SET outcome = excluded.outcome, offers_found = excluded.offers_found, error = excluded.error, observed_at = excluded.observed_at`,
    ).bind(JSON.stringify(scenarioRuns), body.run.id, body.observedAt),
    db.prepare(`UPDATE search_scenarios SET last_run_at = MAX(COALESCE(last_run_at, 0), ?2) WHERE id IN (SELECT json_extract(value, '$.scenarioId') FROM json_each(?1))`)
      .bind(JSON.stringify(scenarioRuns), body.observedAt),
    // Avisos ≥ 3 % frente a la observación anterior de la MISMA serie (oferta = contexto+ámbito+condiciones+escenario; mismo tipo de precio y unidad).
    db.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, dedupe_key, payload, created_at)
       SELECT lower(hex(randomblob(16))), u.user_id, 'offer_price_change', 'offer:' || n.offer_id || ':' || ?3,
              json_object('offerId', n.offer_id, 'fromCents', n.from_c, 'toCents', n.to_c, 'pct', round((n.to_c - n.from_c) * 1000.0 / n.from_c) / 10.0,
                          'previousObservedAt', n.prev_at, 'observedAt', n.observed_at, 'priceKind', n.price_kind, 'unit', n.unit), ?4
       FROM (SELECT ob.offer_id, ob.amount_cents AS to_c, ob.observed_at, ob.price_kind, ob.unit, p.amount_cents AS from_c, p.observed_at AS prev_at
             FROM offer_observations ob
             JOIN offer_observations p ON p.id = (SELECT x.id FROM offer_observations x WHERE x.offer_id = ob.offer_id AND x.price_kind = ob.price_kind AND x.unit = ob.unit
                                                   AND x.amount_cents IS NOT NULL AND x.observed_at < ob.observed_at ORDER BY x.observed_at DESC LIMIT 1)
             WHERE ob.run_id = ?1 AND ob.observed_at = ?2 AND ob.amount_cents IS NOT NULL) n
       JOIN (SELECT offer_id, user_id FROM saved_offers
             UNION SELECT tc.offer_id, m.user_id FROM trip_candidates tc JOIN trip_members m ON m.trip_id = tc.trip_id
             WHERE tc.offer_id IS NOT NULL AND tc.status IN ('proposed','chosen')) u ON u.offer_id = n.offer_id
       WHERE n.from_c > 0 AND abs(n.to_c - n.from_c) * 100.0 / n.from_c >= 3`,
    ).bind(body.run.id, body.observedAt, day, now()),
    ...st.tail,
  ]);
  const run = lastRow(res);
  return c.json({ written: res[2].meta.changes ?? 0, accepted: observations.length, rejected, runStatus: run.status, run });
});

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
