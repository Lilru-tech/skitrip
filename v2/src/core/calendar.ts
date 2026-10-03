import { addDays, daysBetween, eachDay } from './dates';

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
 * Mismo resultado que aplicar `windowStatus` a cada intervalo, pero con la lista de días calculada una vez y sumas
 * acumuladas por persona: O(días × personas) en vez de recorrer cada intervalo día a día con aritmética de fechas
 * (en el Worker eso costaba ~12 ms de CPU con una sola persona y 150 días; límite de Free: 10 ms).
 */
export function findCandidateWindows(people: PersonDays[], o: FindOptions): CandidateWindow[] {
  if (o.nights < 0 || daysBetween(o.from, o.to) < o.nights) return [];
  const need = o.minPeople ?? people.length;
  const days = eachDay(o.from, o.to);
  // Por persona, recuentos acumulados de días ocupados, «quizá» y sin indicar: cnt[k][i] = días de [0, i).
  const acc = people.map((p) => {
    if (p.days === null) return null;
    const busy = new Int32Array(days.length + 1), maybe = new Int32Array(days.length + 1), unknown = new Int32Array(days.length + 1);
    for (let i = 0; i < days.length; i++) {
      const s = p.days.get(days[i]);
      busy[i + 1] = busy[i] + (s === 'busy' ? 1 : 0);
      maybe[i + 1] = maybe[i] + (s === 'maybe' ? 1 : 0);
      unknown[i + 1] = unknown[i] + (s === undefined ? 1 : 0);
    }
    return { busy, maybe, unknown };
  });
  const out: CandidateWindow[] = [];
  for (let i = 0; i + o.nights < days.length; i++) {
    const j = i + o.nights + 1; // fin exclusivo: incluye el día de salida
    const w: CandidateWindow = { start: days[i], end: days[j - 1], nights: o.nights, free: [], maybe: [], unknown: [], busy: [], hidden: [], meetsWithFree: false, meetsWithMaybe: false };
    people.forEach((p, k) => {
      const a = acc[k];
      // Misma precedencia que windowStatus: ocupado > sin indicar > quizá > libre.
      const status: WindowStatus = !a ? 'hidden' : a.busy[j] - a.busy[i] ? 'busy' : a.unknown[j] - a.unknown[i] ? 'unknown' : a.maybe[j] - a.maybe[i] ? 'maybe' : 'free';
      w[status].push(p.id);
    });
    w.meetsWithFree = w.free.length >= need && need > 0;
    w.meetsWithMaybe = w.free.length + w.maybe.length >= need && need > 0;
    if (w.meetsWithMaybe) out.push(w);
  }
  out.sort((a, b) => b.free.length - a.free.length || b.maybe.length - a.maybe.length || a.start.localeCompare(b.start));
  return o.limit ? out.slice(0, o.limit) : out;
}

/** Recuento por día para la vista común. */
export function dailyCounts(people: PersonDays[], from: string, to: string) {
  return eachDay(from, to).map((d) => {
    const r = { day: d, free: 0, maybe: 0, busy: 0, unknown: 0, hidden: 0 };
    for (const p of people) {
      if (p.days === null) r.hidden++;
      else {
        const s = p.days.get(d);
        if (s) r[s]++;
        else r.unknown++;
      }
    }
    return r;
  });
}
