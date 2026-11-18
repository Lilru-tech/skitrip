// Previsión: descarga de Open-Meteo (servidor; sin clave), caché compartida en D1, una descarga a la vez por punto y
// tope propio de unidades al día. Ante cuota agotada o fallo del proveedor se informa y se conserva lo guardado con su
// antigüedad: nunca se activa un servicio de pago ni se presenta una previsión ausente como buen tiempo.
import pointsDoc from '../../data/weather-points.json';
import type { Env } from './env';
import { dailyFromHourly, FORECAST_DAYS, FORECAST_MODELS, FORECAST_TTL_MS, HOURLY_VARS, splitModels, UNITS_PER_POINT, type ModelId, type StoredForecast } from '../core/weather';

export interface WeatherPoint {
  areaId: string; lat: number; lon: number; elevation: number; baseM: number; topM: number;
  altitudeSource: string; altitudeNote: string | null; location: string; locationSource: string;
}
export const WEATHER_POINTS: ReadonlyMap<string, WeatherPoint> = new Map((pointsDoc.points as WeatherPoint[]).map((p) => [p.areaId, p]));
/**
 * Puntos utilizables. Solo con el emulador de Auth (E2E locales; nunca en producción, que usa AUTH_MODE firebase) se
 * pueden añadir puntos de estaciones sintéticas con WEATHER_TEST_POINTS (JSON), para probar la interfaz sin red.
 */
let testPoints: { raw: string; map: ReadonlyMap<string, WeatherPoint> } | null = null;
export function weatherPoints(env: Env): ReadonlyMap<string, WeatherPoint> {
  if (env.AUTH_MODE !== 'emulator' || !env.WEATHER_TEST_POINTS) return WEATHER_POINTS;
  if (testPoints?.raw !== env.WEATHER_TEST_POINTS) {
    const extra = JSON.parse(env.WEATHER_TEST_POINTS) as WeatherPoint[];
    testPoints = { raw: env.WEATHER_TEST_POINTS, map: new Map([...WEATHER_POINTS, ...extra.map((p) => [p.areaId, p] as const)]) };
  }
  return testPoints.map;
}
export const WEATHER_ATTRIBUTION = 'Datos meteorológicos: Open-Meteo.com (CC BY 4.0), con modelos de ECMWF, DWD y Météo-France. SkiTrip agrega las horas en días y franja de esquí.';

const base = (env: Env) => (env.OPEN_METEO_BASE_URL ?? 'https://api.open-meteo.com').replace(/\/$/, '');
export const weatherDailyCap = (env: Env) => Number(env.WEATHER_DAILY_UNITS ?? 2000) || 2000;
const LOCK_MS = 60_000;

export class WeatherUnavailable extends Error {
  constructor(public reason: 'quota' | 'provider' | 'busy', message: string) { super(message); }
}

/** Reserva unidades del día (UTC) antes de llamar; si se pasaría del tope, no reserva. */
async function reserveUnits(db: D1Database, env: Env, units: number, nowMs: number) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const r = await db.prepare(`INSERT INTO weather_usage (day, units, requests) VALUES (?1, ?2, 1)
                              ON CONFLICT(day) DO UPDATE SET units = units + excluded.units, requests = requests + 1 WHERE units + excluded.units <= ?3`)
    .bind(day, units, weatherDailyCap(env)).run();
  if (!r.meta.changes || units > weatherDailyCap(env)) throw new WeatherUnavailable('quota', 'Se ha alcanzado el tope diario de consultas meteorológicas de SkiTrip. Se muestra la última previsión guardada, si la hay.');
}

/** Parámetros de la petición de previsión (también los usa la comprobación real tools/weather-real-check.ts). */
export const forecastQuery = (pts: readonly Pick<WeatherPoint, 'lat' | 'lon' | 'elevation'>[]) => new URLSearchParams({
  latitude: pts.map((p) => p.lat).join(','), longitude: pts.map((p) => p.lon).join(','), elevation: pts.map((p) => p.elevation).join(','),
  hourly: HOURLY_VARS.join(','), models: FORECAST_MODELS.map((m) => m.id).join(','), forecast_days: String(FORECAST_DAYS), timezone: 'GMT', timeformat: 'unixtime',
});

/**
 * Descarga y agrega la previsión de varios puntos en una sola petición (Open-Meteo admite varias coordenadas). Solo
 * descarga los puntos cuyo bloqueo consigue: si otra petición ya está descargando uno, no se repite.
 */
export async function refreshForecasts(db: D1Database, env: Env, areaIds: readonly string[], nowMs: number): Promise<{ refreshed: string[]; error?: WeatherUnavailable }> {
  const points = weatherPoints(env);
  const pts = areaIds.map((id) => points.get(id)).filter((p): p is WeatherPoint => !!p);
  if (!pts.length) return { refreshed: [] };
  // Bloqueo por punto: solo uno descarga; los demás leen lo guardado.
  const locks = await db.batch(pts.flatMap((p) => [
    db.prepare('INSERT OR IGNORE INTO weather_forecasts (area_id) VALUES (?1)').bind(p.areaId),
    db.prepare('UPDATE weather_forecasts SET refreshing_until = ?2 WHERE area_id = ?1 AND (refreshing_until IS NULL OR refreshing_until < ?3)').bind(p.areaId, nowMs + LOCK_MS, nowMs),
  ]));
  const mine = pts.filter((_, i) => locks[i * 2 + 1].meta.changes === 1);
  if (!mine.length) return { refreshed: [], error: new WeatherUnavailable('busy', 'La previsión se está actualizando en otra consulta.') };
  const release = (extra: { error?: string } = {}) => db.batch(mine.map((p) => db.prepare(
    `UPDATE weather_forecasts SET refreshing_until = NULL${extra.error ? ', last_error = ?2, last_error_at = ?3' : ''} WHERE area_id = ?1`,
  ).bind(...(extra.error ? [p.areaId, extra.error, nowMs] : [p.areaId]))));
  try {
    await reserveUnits(db, env, UNITS_PER_POINT * mine.length, nowMs);
    const q = forecastQuery(mine);
    const [res, ...metas] = await Promise.all([
      fetch(`${base(env)}/v1/forecast?${q}`, { headers: { 'user-agent': 'SkiTrip (private non-commercial trip planner)' } }),
      ...FORECAST_MODELS.map((m) => fetch(`${base(env)}/data/${m.meta}/static/meta.json`).then((r) => (r.ok ? r.json<any>() : null)).catch(() => null)),
    ]);
    if (!res.ok) throw new WeatherUnavailable(res.status === 429 ? 'quota' : 'provider', res.status === 429
      ? 'Open-Meteo ha limitado las consultas ahora (límite gratuito). Se muestra la última previsión guardada, si la hay.'
      : `Open-Meteo no ha respondido correctamente (HTTP ${res.status}). Se muestra la última previsión guardada, si la hay.`);
    const body = await res.json<any>();
    const list: any[] = Array.isArray(body) ? body : [body];
    if (list.length !== mine.length) throw new WeatherUnavailable('provider', 'Respuesta de Open-Meteo incompleta.');
    const runs = Object.fromEntries(FORECAST_MODELS.map((m, i) => [m.id, metas[i]?.last_run_initialisation_time ? metas[i].last_run_initialisation_time * 1000 : null])) as Record<ModelId, number | null>;
    await db.batch(mine.map((p, i) => {
      const per = splitModels(list[i].hourly ?? {});
      const stored: StoredForecast = {
        areaId: p.areaId, fetchedAt: nowMs, lat: list[i].latitude, lon: list[i].longitude, elevation: list[i].elevation ?? p.elevation, runs,
        days: Object.fromEntries(FORECAST_MODELS.map((m) => [m.id, dailyFromHourly(per[m.id])])),
      };
      return db.prepare('UPDATE weather_forecasts SET fetched_at = ?2, payload = ?3, refreshing_until = NULL, last_error = NULL WHERE area_id = ?1').bind(p.areaId, nowMs, JSON.stringify(stored));
    }));
    return { refreshed: mine.map((p) => p.areaId) };
  } catch (e) {
    const err = e instanceof WeatherUnavailable ? e : new WeatherUnavailable('provider', 'No se ha podido consultar Open-Meteo ahora. Se muestra la última previsión guardada, si la hay.');
    await release({ error: err.message });
    return { refreshed: [], error: err };
  }
}

export interface ForecastRow { area_id: string; fetched_at: number | null; payload: string | null; last_error: string | null; last_error_at: number | null; refreshing_until?: number | null }
export const parseStored = (r: ForecastRow | undefined): StoredForecast | null => (r?.payload ? JSON.parse(r.payload) as StoredForecast : null);
export const needsRefresh = (r: ForecastRow | undefined, nowMs: number) => !r?.fetched_at || nowMs - r.fetched_at > FORECAST_TTL_MS;

/**
 * Cron (cada 20 min): refresca hasta `max` puntos caducados que alguien ha consultado en las últimas 48 h (lo demás no
 * gasta). 3 puntos por pasada mantienen la agregación en pocos ms de CPU incluso con el isolate en frío.
 */
export async function cronRefreshForecasts(db: D1Database, env: Env, nowMs: number, max = 3) {
  const { results } = await db.prepare(`SELECT area_id FROM weather_forecasts WHERE last_requested_at >= ?1 AND (fetched_at IS NULL OR fetched_at < ?2)
                                        ORDER BY COALESCE(fetched_at, 0) LIMIT ?3`).bind(nowMs - 48 * 3600_000, nowMs - FORECAST_TTL_MS, max).all<{ area_id: string }>();
  if (!results.length) return { refreshed: [] as string[] };
  return refreshForecasts(db, env, results.map((r) => r.area_id), nowMs);
}

/** Borra el contador de unidades de hace más de 35 días. */
export const purgeWeatherUsage = (db: D1Database, nowMs: number) =>
  db.prepare('DELETE FROM weather_usage WHERE day < ?1').bind(new Date(nowMs - 35 * 86400_000).toISOString().slice(0, 10)).run();
