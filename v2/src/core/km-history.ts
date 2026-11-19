// Comparador de km esquiables entre temporadas: para unas fechas (día y mes, sin año) dice cuántos km había abiertos esas
// mismas fechas en cada temporada con datos. Reglas (David, 19/11/2026): solo cifras verificables o, si son del SkiTrip
// antiguo, marcadas «sin verificar»; «Sin dato» donde falte; nada se estima, interpola ni toma de otra fecha u otro ámbito.
//
// Procedencias, de más a menos preferente para un mismo día:
//   parte   → parte de nieve capturado por SkiTrip v2 con fecha publicada por la fuente igual a ese día y calidad ok
//             (la misma regla que la intensidad de afluencia: core/crowds.ts dailyIntensity).
//   antiguo → serie del SkiTrip antiguo (legacy_snow_observations): fecha de captura del recolector antiguo, sin verificar;
//             un 0 puede ser un «-» convertido, así que un 0 antiguo no es cifra: «0 o sin dato» y no entra en la media.
import { addDays, isValidDate } from './dates';
import { validMmdd } from './crowds';

export const KM_RANGE_MAX_DAYS = 31;

export type KmOrigin = 'parte' | 'antiguo';
export const KM_ORIGIN_LABEL: Record<KmOrigin, string> = {
  parte: 'parte de nieve capturado por SkiTrip',
  antiguo: 'SkiTrip antiguo (sin verificar)',
};

/** Estado de un día: con cifra, cierre confirmado por el parte (0 km esquiables), 0 antiguo dudoso, sin dato o futuro. */
export type KmDayStatus = 'value' | 'closed' | 'legacy_zero' | 'none' | 'future';

export interface KmDay {
  date: string;
  status: KmDayStatus;
  openKm: number | null;
  totalKm: number | null;
  origin: KmOrigin | null;
  /** Proveedor de la fuente del parte (official, esquiades, pirineu365…), solo para «parte». */
  provider: string | null;
}

export interface KmSeasonSummary {
  /** Días del intervalo que existen en esa temporada y ya han pasado. */
  days: number;
  /** Días con cifra o con cierre confirmado (estos cuentan como 0 km esquiables). */
  withData: number;
  closedDays: number;
  /** 0 del SkiTrip antiguo: no se sabe si era 0 o «sin dato», no cuentan. */
  doubtfulZeros: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Alguna cifra usada viene del SkiTrip antiguo. */
  usesLegacy: boolean;
}

export interface KmSeason { season: string; startYear: number; dates: KmDay[]; summary: KmSeasonSummary }

/** Fila de snow_observations con la prioridad y el proveedor de su fuente. */
export interface KmLiveRow {
  source_date: string | null; observed_at: number; op_status: string; open_km: number | null; total_km: number | null;
  quality: string; priority: number; provider: string;
}
export interface KmLegacyRow { obs_date: string; open_km: number | null; total_km: number | null }

/** Temporada que contiene una fecha: de julio a junio («2025-26» empieza en julio de 2025). */
export const seasonStartOf = (iso: string) => (Number(iso.slice(5, 7)) >= 7 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
export const seasonLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
const yearFor = (start: number, mmdd: string) => (Number(mmdd.slice(0, 2)) >= 7 ? start : start + 1);

/**
 * Días y meses del intervalo, en orden (puede cruzar el fin de año: 12-28 → 01-03). null si no es válido o si pasa del
 * máximo. Se cuenta sobre un año bisiesto para que el 29 de febrero forme parte del intervalo cuando toca.
 */
export function rangeMmdds(from: string, to: string): string[] | null {
  if (!validMmdd(from) || !validMmdd(to)) return null;
  // Temporada bisiesta de referencia: julio de 2023 a junio de 2024.
  const a = `${yearFor(2023, from)}-${from}`;
  const b = `${yearFor(2023, to)}-${to}`;
  if (b < a) return null; // p. ej. 03-10 → 02-01: dentro de una temporada el final no puede ir antes que el inicio
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) {
    out.push(d.slice(5));
    if (out.length > KM_RANGE_MAX_DAYS) return null;
  }
  return out;
}

/** Fechas concretas del intervalo en una temporada (sin el 29 de febrero de los años no bisiestos). */
export function seasonDates(start: number, mmdds: readonly string[]): string[] {
  return mmdds.map((m) => `${yearFor(start, m)}-${m}`).filter(isValidDate);
}

/** Cifra de un día a partir de los partes de esa fecha: fuente más preferente; en ella, la última captura del día. */
export function liveDay(rows: readonly KmLiveRow[]): Omit<KmDay, 'date'> | null {
  const ok = rows.filter((r) => r.quality === 'ok' && r.op_status !== 'unknown');
  if (!ok.length) return null;
  const best = [...ok].sort((x, y) => x.priority - y.priority || y.observed_at - x.observed_at)[0];
  if (best.op_status === 'closed_confirmed' || best.op_status === 'out_of_season') {
    return { status: 'closed', openKm: 0, totalKm: best.total_km, origin: 'parte', provider: best.provider };
  }
  if (best.open_km == null) return null; // el parte no publica km
  return { status: 'value', openKm: best.open_km, totalKm: best.total_km, origin: 'parte', provider: best.provider };
}

export function legacyDay(r: KmLegacyRow | undefined): Omit<KmDay, 'date'> | null {
  if (!r || r.open_km == null || !(r.open_km >= 0)) return null;
  if (r.open_km === 0) return { status: 'legacy_zero', openKm: null, totalKm: r.total_km, origin: 'antiguo', provider: null };
  return { status: 'value', openKm: r.open_km, totalKm: r.total_km, origin: 'antiguo', provider: null };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(dates: readonly KmDay[]): KmSeasonSummary {
  const past = dates.filter((d) => d.status !== 'future');
  const counted = past.filter((d) => d.status === 'value' || d.status === 'closed');
  const vals = counted.map((d) => d.openKm!);
  return {
    days: past.length,
    withData: counted.length,
    closedDays: counted.filter((d) => d.status === 'closed').length,
    doubtfulZeros: past.filter((d) => d.status === 'legacy_zero').length,
    mean: vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    usesLegacy: past.some((d) => d.origin === 'antiguo' && d.status !== 'none'),
  };
}

/**
 * Temporadas a mostrar para el intervalo, de la más reciente a la más antigua: desde la primera temporada con algún dato
 * del área hasta la actual. La temporada actual solo aparece si alguno de sus días ya ha llegado.
 */
export function compareSeasons(input: {
  mmdds: readonly string[]; today: string; firstDataDate: string | null;
  live: readonly KmLiveRow[]; legacy: readonly KmLegacyRow[];
}): KmSeason[] {
  if (!input.firstDataDate) return [];
  const liveBy = new Map<string, KmLiveRow[]>();
  for (const r of input.live) if (r.source_date) (liveBy.get(r.source_date) ?? liveBy.set(r.source_date, []).get(r.source_date)!).push(r);
  const legacyBy = new Map(input.legacy.map((r) => [r.obs_date, r]));
  const out: KmSeason[] = [];
  for (let s = seasonStartOf(input.today); s >= seasonStartOf(input.firstDataDate); s--) {
    const dates = seasonDates(s, input.mmdds).map((date): KmDay => {
      if (date > input.today) return { date, status: 'future', openKm: null, totalKm: null, origin: null, provider: null };
      const d = liveDay(liveBy.get(date) ?? []) ?? legacyDay(legacyBy.get(date));
      return d ? { date, ...d } : { date, status: 'none', openKm: null, totalKm: null, origin: null, provider: null };
    });
    if (!dates.some((d) => d.status !== 'future')) continue;
    out.push({ season: seasonLabel(s), startYear: s, dates, summary: summarize(dates) });
  }
  return out;
}

/** Todas las fechas concretas que hay que leer para las temporadas posibles (para una sola consulta por tabla). */
export function datesToRead(mmdds: readonly string[], today: string, firstDataDate: string | null): string[] {
  if (!firstDataDate) return [];
  const out: string[] = [];
  for (let s = seasonStartOf(today); s >= seasonStartOf(firstDataDate); s--) for (const d of seasonDates(s, mmdds)) if (d <= today) out.push(d);
  return out;
}
