import { addDays, daysBetween } from './dates';

export type DayStatus = 'free' | 'busy' | 'maybe';
/** Estado de una persona para un intervalo completo. `unknown` = algún día sin indicar (nunca cuenta como libre). */
export type WindowStatus = 'free' | 'maybe' | 'busy' | 'unknown' | 'hidden';

export interface PersonDays {
  id: string;
  /** null = no compartido con quien consulta. */
  days: Map<string, DayStatus> | null;
}

export interface CandidateWindow {
  start: string; // día de llegada
  end: string; // día de salida
  nights: number;
  free: string[];
  maybe: string[];
  unknown: string[];
  busy: string[];
  hidden: string[];
  /** true si llega al mínimo solo con «libre»; los «quizá» no se convierten en confirmación. */
  meetsWithFree: boolean;
  /** true si llega al mínimo contando «quizá» como posibles. */
  meetsWithMaybe: boolean;
}

export function windowStatus(days: Map<string, DayStatus> | null, start: string, end: string): WindowStatus {
  if (days === null) return 'hidden';
  let sawMaybe = false;
  let sawUnknown = false;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const s = days.get(d);
    if (s === 'busy') return 'busy';
    if (s === 'maybe') sawMaybe = true;
    else if (s === undefined) sawUnknown = true;
  }
  if (sawUnknown) return 'unknown';
  return sawMaybe ? 'maybe' : 'free';
}

export interface FindOptions {
  from: string;
  to: string;
  nights: number;
  /** Mínimo de participantes libres; `undefined` = todos. */
  minPeople?: number;
  limit?: number;
}

/**
 * Busca intervalos completos [llegada, salida] de `nights` noches dentro de [from, to].
 * Cada persona debe estar disponible TODOS los días del intervalo, llegada y salida incluidas.
 */
export function findCandidateWindows(people: PersonDays[], o: FindOptions): CandidateWindow[] {
  if (o.nights < 0 || daysBetween(o.from, o.to) < o.nights) return [];
  const need = o.minPeople ?? people.length;
  const out: CandidateWindow[] = [];
  for (let start = o.from; daysBetween(start, o.to) >= o.nights; start = addDays(start, 1)) {
    const end = addDays(start, o.nights);
    const w: CandidateWindow = { start, end, nights: o.nights, free: [], maybe: [], unknown: [], busy: [], hidden: [], meetsWithFree: false, meetsWithMaybe: false };
    for (const p of people) w[windowStatus(p.days, start, end)].push(p.id);
    w.meetsWithFree = w.free.length >= need && need > 0;
    w.meetsWithMaybe = w.free.length + w.maybe.length >= need && need > 0;
    if (w.meetsWithMaybe) out.push(w);
  }
  out.sort((a, b) => b.free.length - a.free.length || b.maybe.length - a.maybe.length || a.start.localeCompare(b.start));
  return o.limit ? out.slice(0, o.limit) : out;
}

/** Recuento por día para la vista común. */
export function dailyCounts(people: PersonDays[], from: string, to: string) {
  const rows: { day: string; free: number; maybe: number; busy: number; unknown: number; hidden: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = { day: d, free: 0, maybe: 0, busy: 0, unknown: 0, hidden: 0 };
    for (const p of people) {
      if (p.days === null) r.hidden++;
      else {
        const s = p.days.get(d);
        if (s) r[s]++;
        else r.unknown++;
      }
    }
    rows.push(r);
  }
  return rows;
}
