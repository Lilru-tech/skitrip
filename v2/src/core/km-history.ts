// Comparador de km esquiables entre temporadas: para unas fechas (día y mes, sin año) dice cuántos km había abiertos esas
// mismas fechas en cada temporada con datos. Reglas (David, 19/11/2026): solo cifras verificables o, si son del SkiTrip
// antiguo, marcadas «sin verificar»; «Sin dato» donde falte; nada se estima, interpola ni toma de otra fecha u otro ámbito.
//
// Procedencias, de más a menos preferente para un mismo día:
//   parte   → parte de nieve capturado por SkiTrip v2 con fecha publicada por la fuente igual a ese día y calidad ok
//             (nunca la fecha de captura: un parte capturado hoy puede ser de ayer).
//   archivo → copia de un parte guardada por la Wayback Machine (Internet Archive), con enlace a la copia. Fecha = la
//             publicada en el parte; si la copia no la trae, la de la copia (hora de Madrid, solo copias de las 09:00 en
//             adelante) y se dice. Varias copias del mismo día: oficial antes que agregador, fecha publicada antes que
//             fecha de copia y, a igualdad, la copia más tardía.
//   antiguo → serie del SkiTrip antiguo (legacy_snow_observations): fecha de captura del recolector antiguo, sin verificar;
//             un 0 puede ser un «-» convertido, así que un 0 antiguo no es cifra: «0 o sin dato» y no entra en la media.
import { addDays, isValidDate, madridDate } from './dates';

export const KM_RANGE_MAX_DAYS = 31;

const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** ¿Existe ese día y mes en algún año? (02-29 sí, 02-30 y 04-31 no). */
export const validMmdd = (mmdd: string) => MMDD_RE.test(mmdd) && isValidDate(`2024-${mmdd}`);

export type KmOrigin = 'parte' | 'archivo' | 'antiguo';
export const KM_ORIGIN_LABEL: Record<KmOrigin, string> = {
  parte: 'parte de nieve capturado por SkiTrip',
  archivo: 'copia archivada de un parte (Wayback Machine)',
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
  /** Proveedor de la fuente del parte (official, esquiades, pirineu365…), para «parte» y «archivo». */
  provider: string | null;
  /** Solo «archivo»: enlace a la copia y si la fecha es la del parte o la de la copia. */
  archiveUrl?: string;
  dateBasis?: 'report' | 'copy';
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
  /** Alguna cifra usada viene de una copia archivada. */
  usesArchive: boolean;
}

export interface KmSeason { season: string; startYear: number; dates: KmDay[]; summary: KmSeasonSummary }

/** Fila de snow_observations con la prioridad y el proveedor de su fuente. */
export interface KmLiveRow {
  source_date: string | null; observed_at: number; op_status: string; open_km: number | null; total_km: number | null;
  quality: string; priority: number; provider: string;
}
export interface KmLegacyRow { obs_date: string; open_km: number | null; total_km: number | null }
/** Fila de km_archive_observations (migración 0027). */
export interface KmArchiveRow {
  obs_date: string; date_basis: 'report' | 'copy'; op_status: string; open_km: number | null; total_km: number | null;
  provider: string; archive_url: string; captured_at: number;
}

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

/** Cifra de un día a partir de las copias archivadas de esa fecha. */
export function archiveDay(rows: readonly KmArchiveRow[]): Omit<KmDay, 'date'> | null {
  const ok = rows.filter((r) => r.op_status === 'closed_confirmed' || r.op_status === 'out_of_season' || r.open_km != null);
  if (!ok.length) return null;
  const rank = (r: KmArchiveRow) => (r.provider === 'official' ? 0 : 2) + (r.date_basis === 'report' ? 0 : 1);
  const best = [...ok].sort((x, y) => rank(x) - rank(y) || y.captured_at - x.captured_at)[0];
  const base = { origin: 'archivo' as const, provider: best.provider, archiveUrl: best.archive_url, dateBasis: best.date_basis, totalKm: best.total_km };
  if (best.op_status === 'closed_confirmed' || best.op_status === 'out_of_season') return { status: 'closed', openKm: 0, ...base };
  return { status: 'value', openKm: best.open_km, ...base };
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
    usesArchive: past.some((d) => d.origin === 'archivo'),
  };
}

/**
 * Temporadas a mostrar para el intervalo, de la más reciente a la más antigua: desde la primera temporada con algún dato
 * del área hasta la actual. La temporada actual solo aparece si alguno de sus días ya ha llegado.
 */
export function compareSeasons(input: {
  mmdds: readonly string[]; today: string; firstDataDate: string | null;
  live: readonly KmLiveRow[]; legacy: readonly KmLegacyRow[]; archive?: readonly KmArchiveRow[];
}): KmSeason[] {
  if (!input.firstDataDate) return [];
  const liveBy = new Map<string, KmLiveRow[]>();
  for (const r of input.live) if (r.source_date) (liveBy.get(r.source_date) ?? liveBy.set(r.source_date, []).get(r.source_date)!).push(r);
  const legacyBy = new Map(input.legacy.map((r) => [r.obs_date, r]));
  const archiveBy = new Map<string, KmArchiveRow[]>();
  for (const r of input.archive ?? []) (archiveBy.get(r.obs_date) ?? archiveBy.set(r.obs_date, []).get(r.obs_date)!).push(r);
  const out: KmSeason[] = [];
  for (let s = seasonStartOf(input.today); s >= seasonStartOf(input.firstDataDate); s--) {
    const dates = seasonDates(s, input.mmdds).map((date): KmDay => {
      if (date > input.today) return { date, status: 'future', openKm: null, totalKm: null, origin: null, provider: null };
      const d = liveDay(liveBy.get(date) ?? []) ?? archiveDay(archiveBy.get(date) ?? []) ?? legacyDay(legacyBy.get(date));
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

const hourMadrid = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(ms));

/**
 * Día que representa una copia archivada (tools/collectors/km-archive.ts): la fecha publicada en el parte si es de los 3
 * días anteriores a la copia como mucho; sin fecha publicada, la de la copia en Madrid solo si es de las 09:00 o más tarde
 * (antes la página podría mostrar aún el parte del día anterior). null si no se puede asignar con seguridad.
 */
export function archiveDayOf(sourceDate: string | null | undefined, capturedAt: number): { obsDate: string; dateBasis: 'report' | 'copy' } | null {
  const copyDay = madridDate(capturedAt);
  if (sourceDate) return sourceDate <= copyDay && sourceDate >= addDays(copyDay, -3) ? { obsDate: sourceDate, dateBasis: 'report' } : null;
  return hourMadrid(capturedAt) >= 9 ? { obsDate: copyDay, dateBasis: 'copy' } : null;
}
