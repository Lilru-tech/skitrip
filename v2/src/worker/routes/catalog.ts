import { Hono } from 'hono';
import { z } from 'zod';
import { freshness, STALE_HOURS } from '../../core/analytics';
import type { AppEnv } from '../env';
import { notFound, parseQuery } from '../http';
import { zId } from '../schemas';
import { CAPABILITIES } from '../../core/capabilities';

// Datos no personales: catálogo, rutas, nieve y fuentes. Lectura anónima con caché corta.
export const catalogRoutes = new Hono<AppEnv>();

type AreaRow = { id: string; name: string; kind: string; country: string; region: string | null; lat: number | null; lon: number | null; official_total_km: number | null; total_km_source: string | null; vibe_score: number | null; apres_score: number | null; notes: string | null; official_url: string | null };

const snowOut = (s: any, nowMs: number) => s && ({
  observedAt: s.observed_at, sourceDate: s.source_date, opStatus: s.op_status, openKm: s.open_km, totalKm: s.total_km,
  openRuns: s.open_runs, totalRuns: s.total_runs, openLifts: s.open_lifts, totalLifts: s.total_lifts,
  depthMinCm: s.depth_min_cm, depthMaxCm: s.depth_max_cm, quality: s.quality, qualityNote: s.quality_note, sourceId: s.source_id,
  freshness: freshness(s.observed_at, STALE_HOURS.snow, nowMs),
});

catalogRoutes.get('/catalog', async (c) => {
  const { origin } = parseQuery(c, z.object({ origin: zId.default('tarragona') }));
  const db = c.env.DB;
  const nowMs = Date.now();
  const [areas, links, routes, origins, snow, legacy] = await db.batch([
    db.prepare('SELECT * FROM areas WHERE active = 1 ORDER BY name'),
    db.prepare('SELECT parent_id, child_id, relation FROM area_links'),
    db.prepare('SELECT area_id, access_name, road_km, duration_min, toll_cents, source, checked_on, validated, notes FROM routes WHERE origin_id = ?1').bind(origin),
    db.prepare('SELECT id, name, lat, lon FROM origins ORDER BY name'),
    // Última observación nueva por área (índice area_id, observed_at).
    db.prepare(`SELECT s.* FROM snow_observations s
                JOIN (SELECT area_id, MAX(observed_at) AS m FROM snow_observations GROUP BY area_id) x ON x.area_id = s.area_id AND x.m = s.observed_at`),
    // Última observación legacy por ámbito, marcada como legacy.
    db.prepare(`SELECT l.scope_area_id AS area_id, l.obs_date, l.open_km, l.total_km, l.anomalies FROM legacy_snow_observations l
                JOIN (SELECT scope_area_id, MAX(obs_date) AS m FROM legacy_snow_observations WHERE scope_area_id IS NOT NULL GROUP BY scope_area_id) x
                  ON x.scope_area_id = l.scope_area_id AND x.m = l.obs_date
                GROUP BY l.scope_area_id`),
  ]);
  const routeBy = new Map((routes.results as any[]).map((r) => [r.area_id, r]));
  const snowBy = new Map((snow.results as any[]).map((s) => [s.area_id, s]));
  const legacyBy = new Map((legacy.results as any[]).map((s) => [s.area_id, s]));
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    origin,
    origins: origins.results,
    links: links.results,
    areas: (areas.results as AreaRow[]).map((a) => {
      const r = routeBy.get(a.id);
      const l = legacyBy.get(a.id);
      return {
        id: a.id, name: a.name, kind: a.kind, country: a.country, region: a.region, lat: a.lat, lon: a.lon,
        officialTotalKm: a.official_total_km, totalKmSource: a.total_km_source, vibe: a.vibe_score, apres: a.apres_score, notes: a.notes, officialUrl: a.official_url,
        route: r ? { accessName: r.access_name, roadKm: r.road_km, durationMin: r.duration_min, tollCents: r.toll_cents, source: r.source, checkedOn: r.checked_on, validated: !!r.validated, notes: r.notes } : null,
        snow: snowOut(snowBy.get(a.id), nowMs) ?? null,
        legacySnow: l ? { date: l.obs_date, openKm: l.open_km, totalKm: l.total_km, anomalies: l.anomalies ? JSON.parse(l.anomalies) : [], note: 'Serie legacy: no verificada; un 0 puede ser un «-» convertido.' } : null,
      };
    }),
  });
});

catalogRoutes.get('/areas/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const area = await db.prepare('SELECT * FROM areas WHERE id = ?1').bind(id).first<AreaRow>();
  if (!area) throw notFound('Estación');
  const nowMs = Date.now();
  const since = nowMs - 90 * 86400_000;
  const [links, sources, snow, legacySnow, legacyHotel, comments, offers] = await db.batch([
    db.prepare(`SELECT l.parent_id, p.name AS parent_name, l.child_id, ch.name AS child_name, l.relation FROM area_links l
                JOIN areas p ON p.id = l.parent_id JOIN areas ch ON ch.id = l.child_id WHERE l.parent_id = ?1 OR l.child_id = ?1`).bind(id),
    db.prepare(`SELECT s.*, h.last_attempt_at, h.last_success_at, h.last_status, h.last_error FROM sources s LEFT JOIN source_health h ON h.source_id = s.id
                WHERE s.area_id = ?1 OR s.scope_area_id = ?1 ORDER BY s.kind, s.priority`).bind(id),
    db.prepare('SELECT * FROM snow_observations WHERE area_id = ?1 AND observed_at >= ?2 ORDER BY observed_at').bind(id, since),
    db.prepare(`SELECT obs_date, open_km, total_km, anomalies FROM legacy_snow_observations WHERE scope_area_id = ?1 ORDER BY obs_date DESC LIMIT 120`).bind(id),
    db.prepare(`SELECT obs_date, provider, url, cheapest_unit_cents, top10_avg_unit_cents, sample_count FROM legacy_hotel_observations
                WHERE scope_area_id = ?1 ORDER BY ts DESC LIMIT 120`).bind(id),
    db.prepare(`SELECT c.id, c.body, c.created_at, c.updated_at, u.id AS author_id, u.alias AS author_alias FROM comments c JOIN users u ON u.id = c.author_id
                WHERE c.scope = 'area_public' AND c.area_id = ?1 AND c.hidden = 0 AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 100`).bind(id),
    // Ofertas orientativas recientes (sin escenario): fechas/ocupación del proveedor, con enlace para consultar.
    db.prepare(`SELECT o.id, o.provider_id, o.hotel_name_raw, o.modality, o.board, o.nights, o.forfait_days, o.adults, o.check_in, o.check_out, o.url,
                       ob.observed_at, ob.amount_cents, ob.unit, ob.price_kind, ob.availability
                FROM offers o JOIN offer_observations ob ON ob.offer_id = o.id
                WHERE o.area_id = ?1 AND ob.scenario_id IS NULL AND ob.observed_at >= ?2
                  AND ob.observed_at = (SELECT MAX(observed_at) FROM offer_observations x WHERE x.offer_id = o.id AND x.scenario_id IS NULL)
                ORDER BY ob.amount_cents LIMIT 30`).bind(id, nowMs - 14 * 86400_000),
  ]);
  c.header('Cache-Control', 'public, max-age=120');
  return c.json({
    area,
    links: links.results,
    sources: (sources.results as any[]).map((s) => ({ ...s, fields: JSON.parse(s.fields) })),
    snow: (snow.results as any[]).map((s) => snowOut(s, nowMs)),
    legacy: {
      warning: 'Datos legacy agregados: sin hotel, fechas de estancia ni ocupación; mezclan ofertas distintas. No sirven como evolución de un precio concreto.',
      snow: (legacySnow.results as any[]).map((r) => ({ ...r, anomalies: r.anomalies ? JSON.parse(r.anomalies) : [] })),
      hotel: legacyHotel.results,
    },
    comments: comments.results,
    offers: { note: 'Ofertas orientativas con las fechas y condiciones del proveedor. No son precios para vuestras fechas ni garantizan disponibilidad.', items: offers.results },
  });
});

/** Matriz de fuentes completa (para la página de fuentes y el panel de administración). */
catalogRoutes.get('/sources', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.area_id, a.name AS area_name, s.scope_area_id, s.kind, s.provider, s.url, s.method, s.fields, s.priority, s.status, s.checked_on, s.limitations, s.adapter,
            h.last_attempt_at, h.last_success_at, h.last_status
     FROM sources s JOIN areas a ON a.id = s.area_id LEFT JOIN source_health h ON h.source_id = s.id ORDER BY a.name, s.kind, s.priority`,
  ).all<any>();
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ sources: results.map((s) => ({ ...s, fields: JSON.parse(s.fields) })) });
});

/** Qué puede hacer hoy cada proveedor (catálogo, búsqueda por fechas, cotización manual). */
catalogRoutes.get('/capabilities', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ capabilities: CAPABILITIES });
});
