// Criterios opcionales de Comparar ligados a las fechas del viaje (docs/METEO-AFLUENCIA.md §4, aprobado por David el
// 18/11/2026). Cada uno se aplica a TODAS las estaciones comparadas o a ninguna (con el motivo): la falta de previsión
// nunca cuenta como buen tiempo, y el clima habitual no sustituye a la previsión.
import { addDaysIso, daysBetweenIso, NEAR_MAX_LEAD, type Freshness } from './weather';

/** Lluvia en la franja de esquí que cuenta como «del todo desfavorable» (mm) y racha fuerte (km/h): umbrales de SkiTrip. */
export const RAIN_FULL_MM = 10;

export interface SkiModelDay { id: string; rain: number | null; strong: number | null; hours: number }
export interface SkiForecast { freshness: Freshness | null; days: { date: string; models: SkiModelDay[] }[] }
/** Una entrada de Comparar: una estación (un punto) o un dominio (un punto por estación miembro). */
export interface CriterionEntry { id: string; name: string; points: { id: string; name: string }[] }

export type Criterion = { active: true; value: Map<string, number>; detail: Map<string, string> } | { active: false; reason: string };

const tripDays = (from: string, to: string) => Array.from({ length: daysBetweenIso(from, to) + 1 }, (_, i) => addDaysIso(from, i));
const pct = (x: number) => `${Math.round(x * 100)}`;

/**
 * Condiciones meteorológicas. Solo si todos los días del viaje están entre hoy y +3 días, todas las estaciones tienen
 * previsión vigente (menos de 12 h) y cada día lo cubren al menos 2 modelos comunes a todas. Por estación, día y modelo,
 * en la franja de esquí: índice = 0,5 · min(1, lluvia / 10 mm) + 0,5 · horas con racha ≥ 60 km/h / horas de la franja.
 * Entre modelos, el más desfavorable; varios días, la media; un dominio, su estación más desfavorable. Valor = 1 − índice.
 */
export function weatherCriterion(from: string | null, to: string | null, today: string, entries: readonly CriterionEntry[], forecasts: ReadonlyMap<string, SkiForecast>): Criterion {
  if (!from || !to) return { active: false, reason: 'Elige un viaje con fechas para que el tiempo pueda puntuar.' };
  const last = addDaysIso(today, NEAR_MAX_LEAD);
  const rule = `solo puntúa cuando todos los días del viaje están entre hoy y dentro de ${NEAR_MAX_LEAD} días (previsión próxima).`;
  if (from < today) return { active: false, reason: `El viaje ya ha empezado o ha pasado: el tiempo ${rule}` };
  if (from > last) return { active: false, reason: `El viaje empieza dentro de ${daysBetweenIso(today, from)} días: el tiempo ${rule}` };
  if (to > last) return { active: false, reason: `El viaje acaba dentro de ${daysBetweenIso(today, to)} días: el tiempo ${rule}` };
  if (!entries.length) return { active: false, reason: 'No hay estaciones que comparar.' };
  const days = tripDays(from, to);
  const missing = entries.filter((e) => !e.points.length || e.points.some((p) => { const f = forecasts.get(p.id); return !f || !f.freshness || f.freshness === 'stale'; }));
  if (missing.length) return { active: false, reason: `Falta previsión vigente de ${missing.slice(0, 4).map((e) => e.name).join(', ')}${missing.length > 4 ? ` y ${missing.length - 4} más` : ''}: el tiempo no puntúa para ninguna.` };
  const usable = (m: SkiModelDay) => m.rain != null && m.strong != null && m.hours > 0;
  const allPoints = entries.flatMap((e) => e.points.map((p) => p.id));
  const common = new Map<string, Set<string>>();
  for (const d of days) {
    let ids: Set<string> | null = null;
    for (const pid of allPoints) {
      const md = forecasts.get(pid)!.days.find((x) => x.date === d)?.models.filter(usable).map((m) => m.id) ?? [];
      ids = ids ? new Set(md.filter((id) => ids!.has(id))) : new Set(md);
    }
    if (!ids || ids.size < 2) return { active: false, reason: `El ${d.slice(8)}/${d.slice(5, 7)} no tiene previsión de al menos 2 modelos comunes a todas las estaciones: el tiempo no puntúa.` };
    common.set(d, ids);
  }
  const value = new Map<string, number>();
  const detail = new Map<string, string>();
  for (const e of entries) {
    let worst = -1, worstName = '';
    for (const p of e.points) {
      const f = forecasts.get(p.id)!;
      const perDay = days.map((d) => {
        const ms = f.days.find((x) => x.date === d)!.models.filter((m) => common.get(d)!.has(m.id));
        return Math.max(...ms.map((m) => 0.5 * Math.min(1, m.rain! / RAIN_FULL_MM) + 0.5 * (m.strong! / m.hours)));
      });
      const idx = perDay.reduce((a, b) => a + b, 0) / perDay.length;
      if (idx > worst) { worst = idx; worstName = p.name; }
    }
    value.set(e.id, Math.round((1 - worst) * 1000) / 1000);
    detail.set(e.id, `índice desfavorable ${pct(worst)} %${e.points.length > 1 ? ` (${worstName}, la más desfavorable)` : ''}`);
  }
  return { active: true, value, detail };
}
