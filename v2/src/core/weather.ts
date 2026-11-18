// Previsión meteorológica para las fechas del viaje (docs/METEO-AFLUENCIA.md). Lógica pura: zona horaria, agregación
// diaria por modelo, horizonte, caducidad y resumen sin mezclar modelos.
//
// - Es salida de modelos numéricos, nunca observación. La nieve nueva prevista (cm caídos) no es espesor en pistas,
//   calidad de nieve, apertura de remontes ni garantía de condiciones seguras.
// - Los modelos no se promedian: se muestran por separado o como rango (mín.–máx. entre modelos).
// - Un día cuenta como cubierto por un modelo solo si tiene todas las horas locales de ese día con dato. Un viaje cubierto
//   en parte da los días cubiertos, nunca un acumulado del viaje.
// - Ausente (null), antiguo (fuera de plazo) y cero son distintos.

export const FORECAST_MODELS = [
  { id: 'ecmwf_ifs', meta: 'ecmwf_ifs', label: 'ECMWF IFS (9 km)', provider: 'ECMWF' },
  { id: 'icon_seamless', meta: 'dwd_icon', label: 'DWD ICON (ICON-EU 7 km → global 11 km)', provider: 'DWD' },
  { id: 'meteofrance_seamless', meta: 'meteofrance_arome_france_hd', label: 'Météo-France (AROME → ARPEGE)', provider: 'Météo-France' },
] as const;
export type ModelId = (typeof FORECAST_MODELS)[number]['id'];
export const HOURLY_VARS = ['temperature_2m', 'precipitation', 'rain', 'snowfall', 'wind_speed_10m', 'wind_gusts_10m'] as const;
/** Días pedidos al proveedor: hoy y 7 más (D0–D7). Más allá no se muestra previsión diaria. */
export const FORECAST_DAYS = 8;
export const NEAR_MAX_LEAD = 3; // D0–D3: previsión próxima
export const TREND_MAX_LEAD = 7; // D4–D7: tendencia
/** Caché compartida: se reutiliza 3 h; pasadas 12 h sin refrescar es «antigua» (se muestra con aviso y no puntúa). */
export const FORECAST_TTL_MS = 3 * 3600_000;
export const FORECAST_STALE_MS = 12 * 3600_000;
/** Franja de esquí, hora local de Europe/Madrid: de 09:00 a 17:00. */
export const SKI_FROM_HOUR = 9;
export const SKI_TO_HOUR = 17;
/** Umbral informativo de SkiTrip (no es un límite oficial de seguridad ni de cierre de remontes). */
export const STRONG_GUST_KMH = 60;
/**
 * Unidades de Open-Meteo que cuesta una petición de un punto: más de 10 variables o más de 2 semanas cuentan como
 * varias (fraccionario). Se cuentan variables × modelos (estimación prudente: el proveedor no documenta los modelos).
 */
export const UNITS_PER_POINT = Math.max(1, (HOURLY_VARS.length * FORECAST_MODELS.length) / 10) * Math.max(1, FORECAST_DAYS / 14);

// ---------- Zona horaria ----------

/** Último domingo de un mes (UTC) a las 01:00 UTC: cambio de hora de la UE. */
function lastSundayUtc1(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
}
/** Límites del horario de verano de la UE de un año (ms UTC), memorizados: se consultan miles de veces por descarga. */
const dstCache = new Map<number, [number, number]>();
function dstBounds(y: number): [number, number] {
  let b = dstCache.get(y);
  if (!b) dstCache.set(y, (b = [lastSundayUtc1(y, 2), lastSundayUtc1(y, 9)]));
  return b;
}
/** Desfase de Europe/Madrid (peninsular) en horas para un instante: +2 en horario de verano de la UE, +1 el resto. */
export function madridOffsetHours(utcMs: number): number {
  const [a, b] = dstBounds(new Date(utcMs).getUTCFullYear());
  return utcMs >= a && utcMs < b ? 2 : 1;
}
const isoCache = new Map<number, string>();
const isoOfDay = (dayNum: number) => {
  let v = isoCache.get(dayNum);
  if (v === undefined) isoCache.set(dayNum, (v = new Date(dayNum * 86400_000).toISOString().slice(0, 10)));
  return v;
};
/** Fecha y hora local de Madrid de un instante (sin Intl: barato en el Worker). */
export function madridLocal(utcMs: number): { date: string; hour: number } {
  const local = utcMs + madridOffsetHours(utcMs) * 3600_000;
  const dayNum = Math.floor(local / 86400_000);
  return { date: isoOfDay(dayNum), hour: Math.floor((local - dayNum * 86400_000) / 3600_000) };
}
/** Horas que tiene un día local (23 el de marzo, 25 el de octubre, 24 el resto). */
export function hoursInMadridDay(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const [a, b] = dstBounds(new Date(ms).getUTCFullYear());
  return ms === a - 3600_000 ? 23 : ms === b - 3600_000 ? 25 : 24;
}
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}
export const daysBetweenIso = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

// ---------- Agregación diaria ----------

export interface ModelDay {
  date: string;
  /** Horas locales con todas las variables (si es menor que las del día, el día no está cubierto). */
  hours: number;
  covered: boolean;
  tMin: number | null; tMax: number | null;
  /** Sumas del día completo (mm de agua, cm de nieve caída). */
  precip: number | null; rain: number | null; snow: number | null;
  windMax: number | null; gustMax: number | null;
  /** Franja de esquí (09–17 h locales): lluvia y nieve caídas, racha máxima y horas con racha ≥ 60 km/h. */
  ski: { hours: number; rain: number | null; snow: number | null; gustMax: number | null; strongGustHours: number | null };
}

type Hourly = { time: number[] } & Partial<Record<(typeof HOURLY_VARS)[number], (number | null)[]>>;
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Días locales de un modelo a partir de su serie horaria (time en segundos UTC; cada valor de lluvia/nieve/precipitación
 * es el acumulado de la hora ANTERIOR y las rachas el máximo de la hora anterior, según Open-Meteo). La hora con sello
 * HH:00 local se asigna al día de la hora que acumula (HH-1:00 a HH:00), así que 00:00 cierra el día anterior.
 * La franja de esquí 09–17 h usa las horas que acaban entre las 10:00 y las 17:00 (sumas y rachas) y las temperaturas
 * de 09:00 a 17:00. Una hora sin todas las variables no cuenta y deja el día sin cubrir: no se rellena con ceros.
 */
/** Día local de la hora que acumula cada valor y día y hora local de su sello. Los modelos de una descarga comparten la
 * serie de tiempos, así que se calcula una vez por serie (por primer sello y longitud). */
const localCacheTimes = new Map<string, { accDate: string[]; endDate: string[]; endHour: number[] }>();
function localTimes(time: number[]) {
  const key = `${time[0]}|${time.length}|${time[time.length - 1]}`;
  let v = localCacheTimes.get(key);
  if (!v) {
    v = { accDate: [], endDate: [], endHour: [] };
    for (const s of time) {
      const end = madridLocal(s * 1000);
      v.accDate.push(madridLocal(s * 1000 - 3600_000).date); v.endDate.push(end.date); v.endHour.push(end.hour);
    }
    if (localCacheTimes.size > 16) localCacheTimes.clear();
    localCacheTimes.set(key, v);
  }
  return v;
}
export function dailyFromHourly(h: Hourly): ModelDay[] {
  const byDay = new Map<string, { hours: number; tMin: number; tMax: number; precip: number; rain: number; snow: number; windMax: number; gustMax: number;
    ski: { hours: number; rain: number; snow: number; gustMax: number; strong: number } }>();
  const lt = localTimes(h.time);
  const cols = HOURLY_VARS.map((k) => h[k]);
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  for (let i = 0; i < h.time.length; i++) {
    const t = cols[0]?.[i], p = cols[1]?.[i], rain = cols[2]?.[i], snow = cols[3]?.[i], wind = cols[4]?.[i], gust = cols[5]?.[i];
    if (!ok(t) || !ok(p) || !ok(rain) || !ok(snow) || !ok(wind) || !ok(gust)) continue;
    const acc = { date: lt.accDate[i] }; // hora que acumula
    const end = { date: lt.endDate[i], hour: lt.endHour[i] };
    let d = byDay.get(acc.date);
    if (!d) byDay.set(acc.date, (d = { hours: 0, tMin: Infinity, tMax: -Infinity, precip: 0, rain: 0, snow: 0, windMax: 0, gustMax: 0, ski: { hours: 0, rain: 0, snow: 0, gustMax: 0, strong: 0 } }));
    d.hours++;
    d.tMin = Math.min(d.tMin, t); d.tMax = Math.max(d.tMax, t);
    d.precip += p; d.rain += rain; d.snow += snow;
    d.windMax = Math.max(d.windMax, wind); d.gustMax = Math.max(d.gustMax, gust);
    if (end.date === acc.date && end.hour > SKI_FROM_HOUR && end.hour <= SKI_TO_HOUR) {
      d.ski.hours++; d.ski.rain += rain; d.ski.snow += snow; d.ski.gustMax = Math.max(d.ski.gustMax, gust);
      if (gust >= STRONG_GUST_KMH) d.ski.strong++;
    }
  }
  const skiHours = SKI_TO_HOUR - SKI_FROM_HOUR;
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => {
    const covered = d.hours === hoursInMadridDay(date);
    const skiOk = d.ski.hours === skiHours;
    return {
      date, hours: d.hours, covered,
      tMin: covered ? r1(d.tMin) : null, tMax: covered ? r1(d.tMax) : null,
      precip: covered ? r1(d.precip) : null, rain: covered ? r1(d.rain) : null, snow: covered ? r1(d.snow) : null,
      windMax: covered ? r1(d.windMax) : null, gustMax: covered ? r1(d.gustMax) : null,
      ski: { hours: d.ski.hours, rain: skiOk ? r1(d.ski.rain) : null, snow: skiOk ? r1(d.ski.snow) : null, gustMax: skiOk ? r1(d.ski.gustMax) : null, strongGustHours: skiOk ? d.ski.strong : null },
    };
  });
}

/** Open-Meteo con varios modelos devuelve `variable_modelo`. Separa la serie de cada modelo. */
export function splitModels(hourly: Record<string, unknown>, models: readonly string[] = FORECAST_MODELS.map((m) => m.id)): Record<string, Hourly> {
  const time = hourly.time as number[];
  return Object.fromEntries(models.map((m) => [m, { time, ...Object.fromEntries(HOURLY_VARS.map((v) => [v, (hourly[`${v}_${m}`] ?? (models.length === 1 ? hourly[v] : undefined)) as (number | null)[] | undefined])) }]));
}

// ---------- Horizonte y resumen ----------

export type Horizon = 'past' | 'near' | 'trend' | 'beyond';
export const HORIZON_LABEL: Record<Horizon, string> = {
  past: 'Fecha pasada: no hay previsión', near: 'Previsión próxima', trend: 'Tendencia', beyond: 'Todavía no hay previsión disponible',
};
export function horizonOf(date: string, today: string): { lead: number; horizon: Horizon } {
  const lead = daysBetweenIso(today, date);
  return { lead, horizon: lead < 0 ? 'past' : lead <= NEAR_MAX_LEAD ? 'near' : lead <= TREND_MAX_LEAD ? 'trend' : 'beyond' };
}

export interface StoredForecast {
  areaId: string; fetchedAt: number; lat: number; lon: number; elevation: number;
  /** Hora de la pasada usada de cada modelo (ms) y si respondió. */
  runs: Partial<Record<ModelId, number | null>>;
  days: Partial<Record<ModelId, ModelDay[]>>;
}

export type Freshness = 'fresh' | 'aging' | 'stale';
export const freshnessOf = (fetchedAt: number, nowMs: number): Freshness =>
  nowMs - fetchedAt <= FORECAST_TTL_MS ? 'fresh' : nowMs - fetchedAt <= FORECAST_STALE_MS ? 'aging' : 'stale';

export interface DayView {
  date: string; lead: number; horizon: Horizon;
  /** Modelos con el día completo; los demás no se muestran para ese día (sin rellenar). */
  models: { id: ModelId; label: string; day: ModelDay }[];
  /** Rango entre modelos (mín.–máx.) de cada magnitud, solo entre modelos que cubren el día. Nunca una media. */
  range: Record<'tMin' | 'tMax' | 'rain' | 'snow' | 'gustMax' | 'skiRain' | 'skiStrongGustHours', [number, number] | null>;
}

const span = (xs: (number | null)[]): [number, number] | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
};

/** Días pedidos (desde–hasta) con su horizonte y los modelos que los cubren. En «tendencia» no se dan datos horarios. */
export function forecastDays(f: StoredForecast | null, from: string, to: string, today: string): DayView[] {
  const out: DayView[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const { lead, horizon } = horizonOf(d, today);
    const models = f && (horizon === 'near' || horizon === 'trend')
      ? FORECAST_MODELS.flatMap((m) => { const day = f.days[m.id]?.find((x) => x.date === d); return day?.covered ? [{ id: m.id as ModelId, label: m.label, day }] : []; })
      : [];
    const pick = (g: (x: ModelDay) => number | null) => span(models.map((m) => g(m.day)));
    out.push({
      date: d, lead, horizon, models,
      range: {
        tMin: pick((x) => x.tMin), tMax: pick((x) => x.tMax), rain: pick((x) => x.rain), snow: pick((x) => x.snow), gustMax: pick((x) => x.gustMax),
        skiRain: horizon === 'near' ? pick((x) => x.ski.rain) : null, skiStrongGustHours: horizon === 'near' ? pick((x) => x.ski.strongGustHours) : null,
      },
    });
    if (out.length > 31) break;
  }
  return out;
}

export interface TripForecastSummary {
  days: number; coveredDays: number; uncoveredDays: string[];
  state: 'none' | 'partial' | 'complete';
  /** Modelos distintos que cubren algún día. */
  modelCount: number;
  range: DayView['range'];
}
/**
 * Resumen para Comparar: rangos entre modelos y días, solo de días cubiertos. Si hay días sin previsión, `partial` y
 * la lista de días; nunca una suma del viaje con días que faltan (por eso no se dan acumulados, solo máximos por día).
 */
export function tripSummary(days: readonly DayView[]): TripForecastSummary {
  const cov = days.filter((d) => d.models.length > 0);
  const ids = new Set(cov.flatMap((d) => d.models.map((m) => m.id)));
  const merge = (k: keyof DayView['range']) => span(cov.flatMap((d) => (d.range[k] ? [...d.range[k]!] : [])));
  return {
    days: days.length, coveredDays: cov.length, uncoveredDays: days.filter((d) => !d.models.length).map((d) => d.date),
    state: cov.length === 0 ? 'none' : cov.length < days.length ? 'partial' : 'complete', modelCount: ids.size,
    range: { tMin: merge('tMin'), tMax: merge('tMax'), rain: merge('rain'), snow: merge('snow'), gustMax: merge('gustMax'), skiRain: merge('skiRain'), skiStrongGustHours: merge('skiStrongGustHours') },
  };
}
