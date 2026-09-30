// Utilidades de calendario para la web. La aritmética de fechas es la misma del núcleo (src/core/dates).
import { addDays, daysBetween, eachDay, seasonFor, todayMadrid, weekdayMon0 } from '../../core/dates';

export { addDays, daysBetween, eachDay, todayMadrid, weekdayMon0 };

export const today = () => todayMadrid();

export interface Season { start: string; end: string; label: string }
const label = (s: { start: string; end: string }) => `Temporada ${s.start.slice(0, 4)}–${s.end.slice(2, 4)}`;

/** Temporada actual (o la próxima si estamos fuera de ella) y la siguiente, calculadas desde hoy. */
export function seasons(): Season[] {
  const cur = seasonFor(today());
  const next = seasonFor(addDays(cur.end, 1));
  return [{ ...cur, label: label(cur) }, { ...next, label: label(next) }];
}

export const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = firstOfMonth(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Semanas (lunes a domingo) de un mes; null = hueco fuera del mes. */
export function monthWeeks(first: string): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(weekdayMon0(first)).fill(null);
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return weeks;
}

export const clamp = (d: string, from: string, to: string) => (d < from ? from : d > to ? to : d);
export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const WEEKDAY_ABBR = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export interface Selection { anchor: string; end: string; pending: boolean }
export const selRange = (s: Selection): [string, string] => (s.anchor <= s.end ? [s.anchor, s.end] : [s.end, s.anchor]);
export const inSel = (s: Selection | null, d: string) => {
  if (!s) return false;
  const [a, b] = selRange(s);
  return d >= a && d <= b;
};
