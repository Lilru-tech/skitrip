// Geoapify Free para el origen personalizado: búsqueda de direcciones y distancias por carretera hasta el acceso de
// cada estación. Plan gratuito: 3.000 créditos/día, 5 peticiones/s, sin tarjeta, uso comercial permitido con
// atribución («Powered by Geoapify» y © OpenStreetMap). Créditos: búsqueda = 1; matriz de rutas 1 × N = N.
//
// Privacidad: la dirección o el punto viajan solo en el cuerpo de la petición a esta API y de aquí a Geoapify. No se
// guardan en D1 ni se escriben en el registro: los errores se describen sin la dirección, las coordenadas ni la URL
// del proveedor (que lleva la clave).
import type { Env } from './env';
import { ApiError } from './http';

export const GEO_ATTRIBUTION = 'Powered by Geoapify · © OpenStreetMap contributors';
const DEFAULT_BASE = 'https://api.geoapify.com';
const TIMEOUT_MS = 8000;

export const geoEnabled = (env: Env) => !!env.GEOAPIFY_API_KEY;
export const geoCaps = (env: Env) => ({
  global: Math.max(0, Number(env.GEO_DAILY_CREDITS ?? 2000) || 0),
  user: Math.max(0, Number(env.GEO_USER_DAILY_CREDITS ?? 250) || 0),
});
export const utcDay = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);

/** Créditos usados hoy: global y de esta persona. */
export async function geoUsage(db: D1Database, userId: string, nowMs = Date.now()) {
  const { results } = await db.prepare(`SELECT scope, credits FROM geo_usage WHERE day = ?1 AND scope IN ('global', ?2)`)
    .bind(utcDay(nowMs), `user:${userId}`).all<{ scope: string; credits: number }>();
  const by = new Map(results.map((r) => [r.scope, r.credits]));
  return { global: by.get('global') ?? 0, user: by.get(`user:${userId}`) ?? 0 };
}

/** Suma `credits` al ámbito solo si no pasa de `cap`. Devuelve false (sin sumar) si se pasaría. Una sentencia. */
async function reserveScope(db: D1Database, day: string, scope: string, credits: number, cap: number): Promise<boolean> {
  if (credits > cap) return false;
  const row = await db.prepare(
    `INSERT INTO geo_usage (day, scope, credits) VALUES (?1, ?2, ?3)
     ON CONFLICT (day, scope) DO UPDATE SET credits = credits + ?3 WHERE credits + ?3 <= ?4
     RETURNING credits`,
  ).bind(day, scope, credits, cap).first<{ credits: number }>();
  return !!row;
}

/**
 * Reserva créditos antes de llamar al proveedor: primero los de la persona y después los globales (si no quedan
 * globales, se devuelven los de la persona). Un crédito reservado no se devuelve si el proveedor falla después: puede
 * haberlo cobrado igual.
 */
export async function reserveCredits(db: D1Database, env: Env, userId: string, credits: number, nowMs = Date.now()) {
  const caps = geoCaps(env);
  const day = utcDay(nowMs);
  if (!(await reserveScope(db, day, `user:${userId}`, credits, caps.user))) {
    throw new ApiError(429, 'geo_user_limit', 'Has llegado al límite diario de búsquedas y rutas del origen personalizado. Mañana se renueva; mientras tanto puedes usar Tarragona o Sabadell.');
  }
  if (!(await reserveScope(db, day, 'global', credits, caps.global))) {
    await db.prepare('UPDATE geo_usage SET credits = MAX(0, credits - ?3) WHERE day = ?1 AND scope = ?2').bind(day, `user:${userId}`, credits).run();
    throw new ApiError(429, 'geo_global_limit', 'Se ha llegado al tope diario de SkiTrip para el servicio de mapas gratuito. Mañana se renueva; mientras tanto puedes usar Tarragona o Sabadell.');
  }
}

/** Borra contadores de más de 35 días (cron diario). */
export async function purgeGeoUsage(db: D1Database, nowMs = Date.now()) {
  await db.prepare('DELETE FROM geo_usage WHERE day < ?1').bind(utcDay(nowMs - 35 * 86400_000)).run();
}

const providerError = (what: string) =>
  new ApiError(503, 'geo_provider', `El servicio de mapas no ha respondido (${what}). Inténtalo más tarde o usa Tarragona o Sabadell.`);

async function call(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  if (!env.GEOAPIFY_API_KEY) throw new ApiError(503, 'geo_disabled', 'El origen personalizado aún no está activado. Usa Tarragona o Sabadell.');
  const url = new URL(path, env.GEOAPIFY_BASE_URL || DEFAULT_BASE);
  url.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);
  let res: Response;
  try {
    res = await fetch(url.toString(), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw providerError('sin conexión o tiempo agotado');
  }
  if (res.status === 429) throw new ApiError(429, 'geo_provider_limit', 'El servicio de mapas gratuito ha llegado a su límite. Inténtalo más tarde o usa Tarragona o Sabadell.');
  if (!res.ok) throw providerError(`error ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw providerError('respuesta no válida');
  }
}

export interface GeoPlace { label: string; lat: number; lon: number; kind: string | null }

/** Búsqueda de una dirección (1 crédito). Solo España, Andorra y Francia, en castellano, hasta 5 resultados. */
export async function searchPlaces(env: Env, text: string): Promise<GeoPlace[]> {
  const q = new URLSearchParams({ text, lang: 'es', limit: '5', format: 'json', filter: 'countrycode:es,ad,fr' });
  const body = await call(env, `/v1/geocode/search?${q}`);
  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  return results
    .filter((r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lon))
    .map((r) => ({ label: String(r.formatted ?? [r.address_line1, r.address_line2].filter(Boolean).join(', ')).slice(0, 200), lat: r.lat, lon: r.lon, kind: r.result_type ?? null }));
}

export interface GeoTarget { id: string; lat: number; lon: number }
export interface GeoLeg { id: string; meters: number | null; seconds: number | null }

/** Distancia y tiempo en coche desde un punto a N destinos (N créditos con una sola fuente). */
export async function routeMatrix(env: Env, from: { lat: number; lon: number }, targets: GeoTarget[]): Promise<GeoLeg[]> {
  const body = await call(env, '/v1/routematrix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'drive', sources: [{ location: [from.lon, from.lat] }], targets: targets.map((t) => ({ location: [t.lon, t.lat] })) }),
  });
  const row: any[] = Array.isArray(body?.sources_to_targets?.[0]) ? body.sources_to_targets[0] : [];
  return targets.map((t, i) => {
    const cell = row.find((x) => x?.target_index === i) ?? row[i];
    const ok = cell && Number.isFinite(cell.distance) && cell.distance > 0;
    return { id: t.id, meters: ok ? cell.distance : null, seconds: ok && Number.isFinite(cell.time) ? cell.time : null };
  });
}
