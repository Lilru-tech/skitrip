// Clima habitual (docs/METEO-AFLUENCIA.md §3): ERA5 vía Open-Meteo, rotulado «Histórico reconstruido» (modelo, no
// medición). Para unas fechas se toma, en cada año de 1996 a 2025, la ventana de 7 días antes a 7 después y se resume:
// medianas y percentiles 10–90 de temperatura, mediana de precipitación y frecuencias «X de Y días válidos (Z años)».
// Nunca «probabilidad», nunca relleno con ceros, nunca nieve deducida de la lluvia, nunca mezclado con la previsión.
import { addDays, daysBetween, isValidDate } from './dates';

export const CLIMATE_FIRST_YEAR = 1996;
export const CLIMATE_LAST_YEAR = 2025;
export const CLIMATE_WINDOW_DAYS = 7;
/** Temporada guardada de cada año: del 20/10 al 10/05 siguiente (la del año Y empieza el 20/10/Y). */
export const SEASON_START_MD = '10-20';
export const SEASON_END_MD = '05-10';
/** Temporadas necesarias: la de 1995 cubre enero–mayo de 1996; la de 2025, octubre–diciembre de 2025. */
export const CLIMATE_SEASONS = Array.from({ length: CLIMATE_LAST_YEAR - CLIMATE_FIRST_YEAR + 2 }, (_, i) => CLIMATE_FIRST_YEAR - 1 + i);
export const CLIMATE_DAILY_VARS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'rain_sum', 'snowfall_sum', 'wind_gusts_10m_max'] as const;
export const CLIMATE_SOURCE_LABEL = 'Histórico reconstruido: reanálisis ERA5 (ECMWF / Copernicus) servido por Open-Meteo.com (CC BY 4.0)';
export const PRECIP_DAY_MM = 1;
export const SNOW_DAY_CM = 1;
export const STRONG_GUST_KMH = 60;
/** Unidades de Open-Meteo de una temporada (6 variables diarias, ~203 días: cuenta como 203/14 llamadas). */
export const climateSeasonUnits = (days: number) => Math.max(1, CLIMATE_DAILY_VARS.length / 10) * Math.max(1, days / 14);

export const seasonStart = (season: number) => `${season}-${SEASON_START_MD}`;
export const seasonEnd = (season: number) => `${season + 1}-${SEASON_END_MD}`;
export const seasonLength = (season: number) => daysBetween(seasonStart(season), seasonEnd(season)) + 1;
/** Temporada a la que pertenece una fecha (o null si cae entre el 11/05 y el 19/10). */
export function seasonOf(date: string): number | null {
  const y = Number(date.slice(0, 4));
  const md = date.slice(5);
  if (md >= SEASON_START_MD) return y;
  if (md <= SEASON_END_MD) return y - 1;
  return null;
}

/** Serie diaria guardada de una temporada: arrays alineados con `start` (null = sin dato; 0 es cero). */
export interface ClimateSeries {
  start: string;
  tmax: (number | null)[]; tmin: (number | null)[]; precip: (number | null)[]; rain: (number | null)[];
  /** Nieve caída del modelo en cm (no espesor ni equivalente en agua). */
  snow: (number | null)[];
  gust: (number | null)[];
}
export type ClimateVar = Exclude<keyof ClimateSeries, 'start'>;
export const CLIMATE_VARS: readonly ClimateVar[] = ['tmax', 'tmin', 'precip', 'rain', 'snow', 'gust'];

export interface ClimateWindow { year: number; season: number; from: string; to: string }
export type WindowCheck = { ok: true; windows: ClimateWindow[]; spanDays: number } | { ok: false; reason: 'invalid' | 'out_of_season' | 'too_long' };

/**
 * Ventanas de cada año para un viaje [from, to] (solo cuentan mes y día de `from` y la duración): del día de inicio −7
 * al de fin +7 en cada año de 1996 a 2025. Si el viaje empieza el 29/02, en los años no bisiestos la ventana empieza
 * el 28/02 y dura un día más (cubre hasta el 01/03): no se inventa el día. Toda la ventana debe caer en la temporada
 * guardada (del 20/10 al 10/05); si no, se dice, en lugar de resumir con menos días.
 */
export function climateWindows(from: string, to: string): WindowCheck {
  if (!isValidDate(from) || !isValidDate(to) || to < from) return { ok: false, reason: 'invalid' };
  const span = daysBetween(from, to);
  if (span > 30) return { ok: false, reason: 'too_long' };
  const md = from.slice(5);
  const windows: ClimateWindow[] = [];
  for (let year = CLIMATE_FIRST_YEAR; year <= CLIMATE_LAST_YEAR; year++) {
    let start = `${year}-${md}`;
    let len = span;
    if (md === '02-29' && !isValidDate(start)) { start = `${year}-02-28`; len = span + 1; }
    const a = addDays(start, -CLIMATE_WINDOW_DAYS);
    const b = addDays(start, len + CLIMATE_WINDOW_DAYS);
    const season = seasonOf(a);
    if (season === null || seasonOf(b) !== season || a < seasonStart(season) || b > seasonEnd(season)) return { ok: false, reason: 'out_of_season' };
    windows.push({ year, season, from: a, to: b });
  }
  return { ok: true, windows, spanDays: span + 1 };
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 10) / 10;
};
export interface Dist { median: number | null; p10: number | null; p90: number | null; n: number }
export interface Freq { days: number; of: number }
export interface ClimateSummary {
  /** Años con al menos un día válido y días de ventana con dato de cada magnitud (cada una con su denominador). */
  years: number; expectedYears: number; windowDays: number;
  tmax: Dist; tmin: Dist;
  precipMedian: number | null;
  precipDays: Freq; snowDays: Freq; strongGustDays: Freq;
}
const dist = (xs: number[]): Dist => { const s = [...xs].sort((a, b) => a - b); return { median: quantile(s, 0.5), p10: quantile(s, 0.1), p90: quantile(s, 0.9), n: s.length }; };

/** Posiciones (desde el 20/10 de su temporada) del primer y último día de cada ventana: lo que se lee de cada fila. */
export const windowSlices = (windows: readonly ClimateWindow[]) =>
  windows.map((w) => ({ year: w.year, season: w.season, a: daysBetween(seasonStart(w.season), w.from), b: daysBetween(seasonStart(w.season), w.to) }));

export type ClimateSlice = { year: number; vals: Record<ClimateVar, (number | null)[]> };
/**
 * Resumen con los días de cada ventana ya recortados (en el Worker, el recorte lo hace D1 para no analizar temporadas
 * enteras). El orden de los días no importa. Las temporadas que faltan simplemente no están.
 */
export function summarizeSlices(slices: readonly ClimateSlice[], expectedYears: number, windowDays: number): ClimateSummary {
  const vals: Record<ClimateVar, number[]> = { tmax: [], tmin: [], precip: [], rain: [], snow: [], gust: [] };
  const years = new Set<number>();
  for (const sl of slices) {
    for (const k of CLIMATE_VARS) {
      for (const v of sl.vals[k] ?? []) if (typeof v === 'number' && Number.isFinite(v)) { vals[k].push(v); years.add(sl.year); }
    }
  }
  const freq = (xs: number[], ok: (v: number) => boolean): Freq => ({ days: xs.filter(ok).length, of: xs.length });
  return {
    years: years.size, expectedYears, windowDays,
    tmax: dist(vals.tmax), tmin: dist(vals.tmin),
    precipMedian: dist(vals.precip).median,
    precipDays: freq(vals.precip, (v) => v >= PRECIP_DAY_MM),
    snowDays: freq(vals.snow, (v) => v >= SNOW_DAY_CM),
    strongGustDays: freq(vals.gust, (v) => v >= STRONG_GUST_KMH),
  };
}

/** Resumen de las ventanas con las series completas de cada temporada (mismo resultado que recortando en D1). */
export function climateSummary(windows: readonly ClimateWindow[], seasons: ReadonlyMap<number, ClimateSeries>): ClimateSummary {
  const slices = windowSlices(windows).flatMap((w) => {
    const s = seasons.get(w.season);
    return s ? [{ year: w.year, vals: Object.fromEntries(CLIMATE_VARS.map((k) => [k, s[k].slice(Math.max(0, w.a), w.b + 1)])) as ClimateSlice['vals'] }] : [];
  });
  return summarizeSlices(slices, windows.length, windows.length ? daysBetween(windows[0].from, windows[0].to) + 1 : 0);
}

/** Comprueba y compacta la respuesta diaria de Open-Meteo de una temporada (usado por la preparación y la ingesta). */
export function seriesFromDaily(daily: Record<string, unknown>, season: number): ClimateSeries {
  const time = daily.time as string[] | undefined;
  const n = seasonLength(season);
  if (!Array.isArray(time) || time.length !== n || time[0] !== seasonStart(season) || time[n - 1] !== seasonEnd(season)) throw new Error(`Serie diaria incompleta para la temporada ${season}`);
  const col = (k: (typeof CLIMATE_DAILY_VARS)[number]) => {
    const a = daily[k];
    if (!Array.isArray(a) || a.length !== n) throw new Error(`Falta ${k} en la temporada ${season}`);
    return a.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null));
  };
  return {
    start: seasonStart(season), tmax: col('temperature_2m_max'), tmin: col('temperature_2m_min'), precip: col('precipitation_sum'),
    rain: col('rain_sum'), snow: col('snowfall_sum'), gust: col('wind_gusts_10m_max'),
  };
}
