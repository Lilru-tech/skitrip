import { addDays, daysBetween, eachDay } from './dates';

export type DayStatus = 'free' | 'busy' | 'maybe';
/** Estado de una persona para un intervalo completo. `unknown` = algún día sin indicar (nunca cuenta como libre). */
export type WindowStatus = 'free' | 'maybe' | 'busy' | 'unknown' | 'hidden';

/** Consulta de un día: un Map o un objeto { día: estado } (lo que devuelve D1 con json_group_object). */
export interface DayLookup { get(day: string): DayStatus | undefined }
export const recordLookup = (r: Record<string, DayStatus>): DayLookup => ({ get: (d) => r[d] });

export interface PersonDays {
  id: string;
  /** null = no compartido con quien consulta. */
  days: DayLookup | null;
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

export function windowStatus(days: DayLookup | null, start: string, end: string): WindowStatus {
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

// Códigos por día: 0 sin indicar, 1 libre, 2 quizá, 3 ocupado. Se calculan una vez por persona y sirven para el
// recuento diario y para los intervalos (antes cada uno recorría los días de cada persona por separado).
const CODE: Record<DayStatus, number> = { free: 1, maybe: 2, busy: 3 };
function dayCodes(people: PersonDays[], days: string[]): (Uint8Array | null)[] {
  return people.map((p) => {
    if (p.days === null) return null;
    const c = new Uint8Array(days.length);
    for (let i = 0; i < days.length; i++) { const s = p.days.get(days[i]); c[i] = s ? CODE[s] : 0; }
    return c;
  });
}

/**
 * Busca intervalos completos [llegada, salida] de `nights` noches dentro de [from, to].
 * Cada persona debe estar disponible TODOS los días del intervalo, llegada y salida incluidas.
 * Mismo resultado que aplicar `windowStatus` a cada intervalo, pero con la lista de días calculada una vez y sumas
 * acumuladas por persona: O(días × personas) en vez de recorrer cada intervalo día a día con aritmética de fechas
 * (en el Worker eso costaba ~12 ms de CPU con una sola persona y 150 días; límite de Free: 10 ms). Solo se crean
 * los objetos de los intervalos que llegan al mínimo (con 16 personas, crear los 148 costaba más que contarlos).
 */
export function findCandidateWindows(people: PersonDays[], o: FindOptions): CandidateWindow[] {
  return summarize(people, o).windows;
}

/** Recuento diario e intervalos candidatos con una sola pasada de códigos por persona. */
export function summarize(people: PersonDays[], o: FindOptions): { daily: DailyCount[]; windows: CandidateWindow[] } {
  const days = eachDay(o.from, o.to);
  const codes = dayCodes(people, days);
  return { daily: dailyFromCodes(codes, days), windows: windowsFromCodes(people, codes, days, o) };
}

function windowsFromCodes(people: PersonDays[], codes: (Uint8Array | null)[], days: string[], o: FindOptions): CandidateWindow[] {
  if (o.nights < 0 || days.length - 1 < o.nights) return [];
  const need = o.minPeople ?? people.length;
  if (need <= 0) return [];
  // Por persona, recuentos acumulados de días ocupados, «quizá» y sin indicar: cnt[k][i] = días de [0, i).
  const acc = codes.map((c) => {
    if (c === null) return null;
    const busy = new Int32Array(days.length + 1), maybe = new Int32Array(days.length + 1), unknown = new Int32Array(days.length + 1);
    for (let i = 0; i < days.length; i++) {
      busy[i + 1] = busy[i] + (c[i] === 3 ? 1 : 0);
      maybe[i + 1] = maybe[i] + (c[i] === 2 ? 1 : 0);
      unknown[i + 1] = unknown[i] + (c[i] === 0 ? 1 : 0);
    }
    return { busy, maybe, unknown };
  });
  // Misma precedencia que windowStatus: ocupado > sin indicar > quizá > libre.
  const statusOf = (k: number, i: number, j: number): WindowStatus => {
    const a = acc[k];
    return !a ? 'hidden' : a.busy[j] - a.busy[i] ? 'busy' : a.unknown[j] - a.unknown[i] ? 'unknown' : a.maybe[j] - a.maybe[i] ? 'maybe' : 'free';
  };
  const out: CandidateWindow[] = [];
  for (let i = 0; i + o.nights < days.length; i++) {
    const j = i + o.nights + 1; // fin exclusivo: incluye el día de salida
    let free = 0, maybe = 0;
    for (let k = 0; k < people.length; k++) { const st = statusOf(k, i, j); if (st === 'free') free++; else if (st === 'maybe') maybe++; }
    if (free + maybe < need) continue;
    const w: CandidateWindow = { start: days[i], end: days[j - 1], nights: o.nights, free: [], maybe: [], unknown: [], busy: [], hidden: [], meetsWithFree: free >= need, meetsWithMaybe: true };
    for (let k = 0; k < people.length; k++) w[statusOf(k, i, j)].push(people[k].id);
    out.push(w);
  }
  out.sort((a, b) => b.free.length - a.free.length || b.maybe.length - a.maybe.length || a.start.localeCompare(b.start));
  return o.limit ? out.slice(0, o.limit) : out;
}

export interface DailyCount { day: string; free: number; maybe: number; busy: number; unknown: number; hidden: number }
const KEY = ['unknown', 'free', 'maybe', 'busy'] as const;
function dailyFromCodes(codes: (Uint8Array | null)[], days: string[]): DailyCount[] {
  return days.map((day, i) => {
    const r = { day, free: 0, maybe: 0, busy: 0, unknown: 0, hidden: 0 };
    for (const c of codes) { if (c === null) r.hidden++; else r[KEY[c[i]]]++; }
    return r;
  });
}

/** Recuento por día para la vista común. */
export function dailyCounts(people: PersonDays[], from: string, to: string): DailyCount[] {
  const days = eachDay(from, to);
  return dailyFromCodes(dayCodes(people, days), days);
}
