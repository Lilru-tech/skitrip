import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../http';
import { zId } from '../schemas';
import { todayMadrid } from '../../core/dates';
import { addDaysIso, daysBetweenIso, FORECAST_MODELS, forecastDays, freshnessOf, HORIZON_LABEL, TREND_MAX_LEAD, tripSummary } from '../../core/weather';
import { CLIMATE_FIRST_YEAR, CLIMATE_LAST_YEAR, CLIMATE_SOURCE_LABEL, CLIMATE_VARS, CLIMATE_WINDOW_DAYS, climateWindows, PRECIP_DAY_MM, SNOW_DAY_CM, STRONG_GUST_KMH, summarizeSlices, windowSlices, type ClimateSlice, type ClimateVar } from '../../core/climate';
import { needsRefresh, parseStored, refreshForecasts, WEATHER_ATTRIBUTION, weatherPoints, type ForecastRow, type WeatherPoint } from '../weather';

// Previsión pública por estación (ficha) y resumen de varias estaciones (Comparar). La ficha puede pedir una descarga
// de su punto si la guardada ha caducado; Comparar solo lee la caché (la refresca el cron de lo consultado).
export const weatherRoutes = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN = 31;
const BUSY_POLLS = 8;
const BUSY_POLL_MS = 500;
function range(c: { req: { query: (k: string) => string | undefined } }, today: string) {
  const from = c.req.query('desde') ?? today;
  const to = c.req.query('hasta') ?? from;
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new ApiError(422, 'validation', 'Fechas no válidas (AAAA-MM-DD).');
  if (to < from) throw new ApiError(422, 'validation', 'La fecha final no puede ser anterior a la inicial.');
  if (daysBetweenIso(from, to) >= MAX_SPAN) throw new ApiError(422, 'validation', `Como mucho ${MAX_SPAN} días.`);
  return { from, to };
}
const pointOut = (points: ReadonlyMap<string, WeatherPoint>, id: string) => {
  const p = points.get(id)!;
  return { lat: p.lat, lon: p.lon, elevation: p.elevation, baseM: p.baseM, topM: p.topM, altitudeSource: p.altitudeSource, altitudeNote: p.altitudeNote, location: p.location, locationSource: p.locationSource };
};
const modelsOut = (runs: Record<string, number | null | undefined> | undefined) =>
  FORECAST_MODELS.map((m) => ({ id: m.id, label: m.label, provider: m.provider, runAt: runs?.[m.id] ?? null }));

/** Estaciones con punto meteorológico de un área: ella misma o, si es un dominio, sus estaciones. */
async function scopesOf(db: D1Database, points: ReadonlyMap<string, WeatherPoint>, id: string) {
  const [area, members] = await db.batch([
    db.prepare('SELECT id, name, kind FROM areas WHERE id = ?1').bind(id),
    db.prepare('SELECT a.id, a.name FROM area_links l JOIN areas a ON a.id = l.child_id WHERE l.parent_id = ?1 ORDER BY a.name').bind(id),
  ]);
  const a = (area.results as any[])[0];
  if (!a) throw notFound('Estación');
  const list = points.has(a.id) ? [{ id: a.id as string, name: a.name as string }] : (members.results as any[]).filter((m) => points.has(m.id)).map((m) => ({ id: m.id as string, name: m.name as string }));
  return { area: a, scopes: list };
}

weatherRoutes.get('/areas/:id/forecast', async (c) => {
  const r = zId.safeParse(c.req.param('id'));
  if (!r.success) throw notFound('Estación');
  const db = c.env.DB;
  const nowMs = Date.now();
  const today = todayMadrid(nowMs);
  const { from, to } = range(c, today);
  const points = weatherPoints(c.env);
  const { scopes } = await scopesOf(db, points, r.data);
  const ids = scopes.map((s) => s.id);
  const read = async () => (ids.length ? (await db.prepare('SELECT * FROM weather_forecasts WHERE area_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).all<ForecastRow>()).results : []);
  let rows = await read();
  // Solo se descarga si alguna fecha pedida está dentro del horizonte (hoy a D7) y lo guardado ha caducado.
  const inHorizon = to >= today && from <= addDaysIso(today, TREND_MAX_LEAD);
  const stale = ids.filter((id) => needsRefresh(rows.find((x) => x.area_id === id), nowMs));
  let notice: string | null = null;
  if (inHorizon && stale.length) {
    const res = await refreshForecasts(db, c.env, stale, nowMs);
    if (res.error && res.error.reason !== 'busy') notice = res.error.message;
    rows = await read();
    // Puntos que está descargando otra consulta a la vez: se espera su resultado (espera sin CPU, como mucho ~4 s)
    // en vez de responder «sin previsión» mientras llega.
    const waiting = () => stale.filter((id) => { const x = rows.find((y) => y.area_id === id); return needsRefresh(x, nowMs) && (x?.refreshing_until ?? 0) > Date.now(); });
    for (let i = 0; i < BUSY_POLLS && waiting().length; i++) {
      await new Promise((ok) => setTimeout(ok, BUSY_POLL_MS));
      rows = await read();
    }
    if (!notice && waiting().length) notice = 'La previsión de este punto se está actualizando en otra consulta. Vuelve a cargar en unos segundos.';
  }
  if (ids.length) await db.prepare('UPDATE weather_forecasts SET last_requested_at = ?2 WHERE area_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids), nowMs).run();
  c.header('Cache-Control', 'no-store');
  return c.json({
    today, from, to, attribution: WEATHER_ATTRIBUTION, horizonLabels: HORIZON_LABEL, notice,
    points: scopes.map((s) => {
      const row = rows.find((x) => x.area_id === s.id);
      const f = parseStored(row);
      const days = forecastDays(f, from, to, today);
      return {
        areaId: s.id, name: s.name, point: pointOut(points, s.id), fetchedAt: f ? row!.fetched_at : null, freshness: f ? freshnessOf(row!.fetched_at!, nowMs) : null,
        cell: f ? { lat: f.lat, lon: f.lon, elevation: f.elevation } : null, models: modelsOut(f?.runs), lastError: row?.last_error ?? null, days, summary: tripSummary(days),
      };
    }),
  });
});

/** Resumen de varias estaciones para unas fechas (Comparar). Solo caché; marca las estaciones como consultadas. */
weatherRoutes.get('/forecast', async (c) => {
  const db = c.env.DB;
  const nowMs = Date.now();
  const today = todayMadrid(nowMs);
  const { from, to } = range(c, today);
  const points = weatherPoints(c.env);
  const ids = [...new Set((c.req.query('areas') ?? '').split(',').filter((x) => zId.safeParse(x).success && points.has(x)))].slice(0, 40);
  if (!ids.length) return c.json({ today, from, to, attribution: WEATHER_ATTRIBUTION, areas: [] });
  const rows = (await db.prepare('SELECT * FROM weather_forecasts WHERE area_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).all<ForecastRow>()).results;
  // Marca como consultadas (crea la fila si no existe) para que el cron las descargue en su próxima pasada.
  await db.batch([
    db.prepare(`INSERT INTO weather_forecasts (area_id, last_requested_at) SELECT value, ?2 FROM json_each(?1) WHERE value IN (SELECT id FROM areas)
                ON CONFLICT(area_id) DO UPDATE SET last_requested_at = excluded.last_requested_at`).bind(JSON.stringify(ids), nowMs),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({
    today, from, to, attribution: WEATHER_ATTRIBUTION,
    areas: ids.map((id) => {
      const row = rows.find((x) => x.area_id === id);
      const f = parseStored(row);
      const days = forecastDays(f, from, to, today);
      return {
        areaId: id, fetchedAt: f ? row!.fetched_at : null, freshness: f ? freshnessOf(row!.fetched_at!, nowMs) : null, summary: tripSummary(days), horizons: [...new Set(days.map((d) => d.horizon))],
        // Franja de esquí por día y modelo (solo previsión próxima): lo que usa el criterio «Condiciones meteorológicas».
        ski: days.filter((d) => d.horizon === 'near').map((d) => ({ date: d.date, models: d.models.map((m) => ({ id: m.id, rain: m.day.ski.rain, strong: m.day.ski.strongGustHours, hours: m.day.ski.hours })) })),
      };
    }),
  });
});

/**
 * Clima habitual (ERA5, «Histórico reconstruido») de la estación o de cada estación de un dominio para unas fechas:
 * ventana de ±7 días en cada año de 1996 a 2025. Solo lee las temporadas guardadas (2 sentencias, sin red).
 */
weatherRoutes.get('/areas/:id/climate', async (c) => {
  const r = zId.safeParse(c.req.param('id'));
  if (!r.success) throw notFound('Estación');
  const db = c.env.DB;
  const today = todayMadrid();
  const { from, to } = range(c, today);
  const points = weatherPoints(c.env);
  const { scopes } = await scopesOf(db, points, r.data);
  const check = climateWindows(from, to);
  const slices = check.ok ? windowSlices(check.windows) : [];
  // D1 recorta cada temporada a los días de su ventana (el Worker no analiza 30 temporadas enteras: CPU).
  const sub = (k: string) => `(SELECT json_group_array(d.value) FROM json_each(c.payload, '$.${k}') d WHERE d.key BETWEEN w.a AND w.b) AS ${k}`;
  const rows = scopes.length && slices.length
    ? (await db.prepare(`WITH w AS (SELECT json_extract(value, '$.season') AS season, json_extract(value, '$.year') AS year, json_extract(value, '$.a') AS a, json_extract(value, '$.b') AS b FROM json_each(?2))
                         SELECT c.area_id, w.year, c.requested_elevation, c.cell_lat, c.cell_lon, c.cell_elevation, ${CLIMATE_VARS.map(sub).join(', ')}
                         FROM climate_seasons c JOIN w ON w.season = c.season
                         WHERE c.source = 'era5' AND c.area_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(scopes.map((s) => s.id)), JSON.stringify(slices)).all<ClimateRow>()).results
    : [];
  c.header('Cache-Control', 'no-store');
  return c.json({
    from, to, source: CLIMATE_SOURCE_LABEL, period: { from: CLIMATE_FIRST_YEAR, to: CLIMATE_LAST_YEAR }, windowDays: CLIMATE_WINDOW_DAYS,
    thresholds: { precipMm: PRECIP_DAY_MM, snowCm: SNOW_DAY_CM, gustKmh: STRONG_GUST_KMH },
    state: check.ok ? 'ok' : check.reason,
    points: scopes.map((s) => {
      const mine = rows.filter((x) => x.area_id === s.id);
      const last = mine[0];
      return {
        areaId: s.id, name: s.name, point: pointOut(points, s.id),
        cell: last ? { lat: last.cell_lat, lon: last.cell_lon, elevation: last.cell_elevation, requestedElevation: last.requested_elevation } : null,
        seasonsStored: mine.length, seasonsNeeded: slices.length,
        summary: check.ok && mine.length ? summarizeSlices(mine.map((x) => ({ year: x.year, vals: Object.fromEntries(CLIMATE_VARS.map((k) => [k, JSON.parse(x[k]) as (number | null)[]])) as ClimateSlice['vals'] })), check.windows.length, slices[0].b - slices[0].a + 1) : null,
      };
    }),
  });
});
interface ClimateRow extends Record<ClimateVar, string> { area_id: string; year: number; requested_elevation: number | null; cell_lat: number | null; cell_lon: number | null; cell_elevation: number | null }
