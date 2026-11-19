// Festivos y vacaciones escolares de los calendarios que más pesan en el Pirineo (sustituye a la «afluencia histórica»:
// no hay ninguna fuente abierta con esquiadores por día y estación; ver docs/METEO-AFLUENCIA.md §1). Fuente:
// OpenHolidays API (openholidaysapi.org, datos ODbL 1.0). No es una cifra de gente: dice qué calendarios tienen fiesta o
// vacaciones en las fechas elegidas, y cuándo un calendario todavía no está publicado («sin calendario», nunca «sin fiesta»).

import { isValidDate } from './dates';

export type HolidayKind = 'public' | 'school';
export interface HolidayCalendar {
  id: string;
  label: string;
  /** País ISO de OpenHolidays. */
  country: 'ES' | 'FR' | 'AD';
  /** Subdivisión de OpenHolidays que define el calendario (comunidad o zona escolar francesa); null = todo el país. */
  region: string | null;
  /** Subdivisión para los festivos cuando no coincide con la de las vacaciones (Francia: los festivos son nacionales). */
  publicRegion?: string | null;
}

export const HOLIDAY_CALENDARS: readonly HolidayCalendar[] = [
  { id: 'es-ct', label: 'Cataluña', country: 'ES', region: 'ES-CT' },
  { id: 'es-ar', label: 'Aragón', country: 'ES', region: 'ES-AR' },
  { id: 'es-md', label: 'Madrid', country: 'ES', region: 'ES-MD' },
  { id: 'es-vc', label: 'Comunidad Valenciana', country: 'ES', region: 'ES-VC' },
  { id: 'es-pv', label: 'País Vasco', country: 'ES', region: 'ES-PV' },
  { id: 'es-nc', label: 'Navarra', country: 'ES', region: 'ES-NC' },
  { id: 'fr-za', label: 'Francia, zona A (Burdeos, Lyon, Grenoble…)', country: 'FR', region: 'FR-ZA', publicRegion: null },
  { id: 'fr-zb', label: 'Francia, zona B (Marsella, Niza, Lille…)', country: 'FR', region: 'FR-ZB', publicRegion: null },
  { id: 'fr-zc', label: 'Francia, zona C (Toulouse, Montpellier, París)', country: 'FR', region: 'FR-ZC', publicRegion: null },
  { id: 'ad', label: 'Andorra', country: 'AD', region: null },
];
export const HOLIDAY_COUNTRIES = ['ES', 'FR', 'AD'] as const;
export const HOLIDAY_LANG: Record<(typeof HOLIDAY_COUNTRIES)[number], string> = { ES: 'ES', FR: 'FR', AD: 'CA' };
export const HOLIDAY_SOURCE = 'Festivos y vacaciones escolares: OpenHolidays API (openholidaysapi.org), datos ODbL 1.0. Las vacaciones escolares de las comunidades españolas que OpenHolidays aún no tiene se añaden a mano desde el calendario de cada comunidad (fuentes en docs/METEO-AFLUENCIA.md).';
/** Como mucho tantos días por consulta (igual que la previsión y el clima). */
export const HOLIDAY_MAX_DAYS = 31;

/** Un elemento tal como lo devuelve OpenHolidays (/PublicHolidays o /SchoolHolidays). */
export interface OpenHolidayItem {
  startDate: string;
  endDate: string;
  name?: { language: string; text: string }[];
  nationwide?: boolean;
  subdivisions?: { code: string; shortName?: string }[];
  temporalScope?: string;
}
/** Periodo guardado por calendario. «part»: solo en parte del territorio (provincias o academias concretas). */
export interface HolidayPeriod { calendarId: string; kind: HolidayKind; start: string; end: string; name: string; scope: 'all' | 'part'; parts: string | null }


/** Reparte los elementos de un país entre los calendarios. Ignora lo que no toca a ningún calendario y lo mal formado. */
export function periodsFromOpenHolidays(country: string, kind: HolidayKind, items: readonly OpenHolidayItem[]): HolidayPeriod[] {
  const out = new Map<string, HolidayPeriod>();
  for (const it of items) {
    if (!isValidDate(it.startDate ?? '') || !isValidDate(it.endDate ?? '') || it.endDate < it.startDate) continue;
    if (it.temporalScope && it.temporalScope !== 'FullDay') continue; // medias jornadas: no son un día de fiesta
    const name = (it.name?.[0]?.text ?? '').trim().slice(0, 120) || (kind === 'public' ? 'Festivo' : 'Vacaciones escolares');
    const codes = (it.subdivisions ?? []).map((s) => s.code);
    for (const cal of HOLIDAY_CALENDARS) {
      if (cal.country !== country) continue;
      const region = kind === 'public' && cal.publicRegion !== undefined ? cal.publicRegion : cal.region;
      let scope: 'all' | 'part' | null = null;
      let parts: string | null = null;
      if (it.nationwide || region == null && !codes.length) scope = 'all';
      else if (region == null) { scope = 'part'; parts = shortNames(it, (c) => c.startsWith(`${country}-`)); }
      else if (codes.includes(region)) scope = 'all';
      else if (codes.some((c) => c.startsWith(`${region}-`))) { scope = 'part'; parts = shortNames(it, (c) => c.startsWith(`${region}-`)); }
      if (!scope) continue;
      const key = `${cal.id}|${kind}|${it.startDate}|${name}`;
      const prev = out.get(key);
      // El mismo periodo para todo el calendario prevalece sobre el de solo una parte.
      if (!prev || (prev.scope === 'part' && scope === 'all')) out.set(key, { calendarId: cal.id, kind, start: it.startDate, end: it.endDate, name, scope, parts });
    }
  }
  return [...out.values()].sort((a, b) => a.calendarId.localeCompare(b.calendarId) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}
function shortNames(it: OpenHolidayItem, f: (code: string) => boolean): string {
  return (it.subdivisions ?? []).filter((s) => f(s.code)).map((s) => s.shortName ?? s.code).join(', ').slice(0, 120);
}

/** Estado de un calendario en las fechas elegidas. */
export interface CalendarDays {
  calendarId: string;
  label: string;
  /** Hasta qué día hay datos de cada tipo; null = ninguno guardado. */
  knownUntil: Record<HolidayKind, string | null>;
  /** Periodos que se solapan con las fechas, recortados a ellas. */
  periods: (HolidayPeriod & { from: string; to: string })[];
  /** Días de las fechas sin calendario publicado (de cualquiera de los dos tipos). */
  unknownDays: string[];
}

/**
 * Cruza las fechas con los periodos guardados. Un tipo cubre un día si hay algún periodo de ese tipo que acaba ese día o
 * después (el calendario de ese año ya está publicado); si no, el día queda «sin calendario» y nunca cuenta como sin fiesta.
 */
export function calendarDays(days: readonly string[], periods: readonly HolidayPeriod[], knownUntil: ReadonlyMap<string, Record<HolidayKind, string | null>>): CalendarDays[] {
  const first = days[0], last = days[days.length - 1];
  return HOLIDAY_CALENDARS.map((cal) => {
    const known = knownUntil.get(cal.id) ?? { public: null, school: null };
    const mine = periods.filter((p) => p.calendarId === cal.id && p.end >= first && p.start <= last)
      .map((p) => ({ ...p, from: p.start < first ? first : p.start, to: p.end > last ? last : p.end }))
      .sort((a, b) => a.from.localeCompare(b.from) || (a.kind === b.kind ? 0 : a.kind === 'public' ? -1 : 1));
    const unknownDays = days.filter((d) => !known.public || !known.school || known.public < d || known.school < d);
    return { calendarId: cal.id, label: cal.label, knownUntil: known, periods: mine, unknownDays };
  });
}

/** Curso escolar español añadido a mano (data/school-holidays-es.json) mientras OpenHolidays no lo publica. */
export interface ManualCourse { calendarId: string; course: string; source: string; url: string; periods: { start: string; end: string; name: string }[] }

/**
 * Periodos escolares a mano que hay que añadir: los de cada curso solo si OpenHolidays no trae ningún periodo escolar de
 * todo el territorio de ese calendario que empiece en ese curso (del 1/09 al 31/08). Cuando OpenHolidays lo publique,
 * manda lo suyo y lo manual deja de enviarse solo.
 */
export function manualSchoolPeriods(courses: readonly ManualCourse[], fromOpenHolidays: readonly HolidayPeriod[]): HolidayPeriod[] {
  const out: HolidayPeriod[] = [];
  for (const c of courses) {
    const y = Number(c.course.slice(0, 4));
    const a = `${y}-09-01`, b = `${y + 1}-08-31`;
    if (fromOpenHolidays.some((p) => p.calendarId === c.calendarId && p.kind === 'school' && p.scope === 'all' && p.start >= a && p.start <= b)) continue;
    for (const p of c.periods) out.push({ calendarId: c.calendarId, kind: 'school', start: p.start, end: p.end, name: p.name, scope: 'all', parts: null });
  }
  return out;
}

/** Año de festivos españoles a mano (tabla del BOE por comunidad) mientras OpenHolidays no lo publica. */
export interface ManualPublicYear { year: number; source: string; url: string; holidays: { date: string; name: string; calendars: string[] }[] }

/** Festivos a mano de cada calendario y año, solo si OpenHolidays no trae ningún festivo de ese calendario ese año. */
export function manualPublicPeriods(years: readonly ManualPublicYear[], fromOpenHolidays: readonly HolidayPeriod[]): HolidayPeriod[] {
  const out: HolidayPeriod[] = [];
  for (const y of years) {
    for (const cal of HOLIDAY_CALENDARS) {
      if (fromOpenHolidays.some((p) => p.calendarId === cal.id && p.kind === 'public' && p.start.startsWith(`${y.year}-`))) continue;
      for (const h of y.holidays) if (h.calendars.includes(cal.id)) out.push({ calendarId: cal.id, kind: 'public', start: h.date, end: h.date, name: h.name, scope: 'all', parts: null });
    }
  }
  return out;
}
