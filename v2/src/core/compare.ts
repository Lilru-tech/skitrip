// Comparar: selección determinista de la observación de nieve, criterio «Nieve abierta ahora» solo con datos
// recientes y fiables, y comparación de coste completo por persona en la que un presupuesto incompleto nunca
// aparece como el más barato.
import { STALE_HOURS } from './analytics';
import { addDays, todayMadrid } from './dates';
import type { BudgetResult } from './budget';

export interface SnowCandidate {
  sourceId: string; priority: number; observedAt: number; opStatus: string; openKm: number | null; quality: string;
  /** Fecha del parte publicada por la fuente (AAAA-MM-DD, sin hora). null = la fuente no la publica. */
  sourceDate?: string | null;
}
export type SnowExclusion = 'sin_dato' | 'antiguo' | 'parte_antiguo' | 'dudoso' | 'estado_desconocido' | 'sin_km';
export const SNOW_EXCLUSION_LABEL: Record<SnowExclusion, string> = {
  sin_dato: 'sin dato', antiguo: `capturado hace más de ${STALE_HOURS.snow} h`, parte_antiguo: 'el parte de la fuente es anterior a ayer', dudoso: 'dato dudoso (totales incoherentes o sospechoso)',
  estado_desconocido: 'estado de apertura desconocido', sin_km: 'la fuente no publica km abiertos',
};

// Frescura = captura reciente Y, si la fuente publica fecha de parte, parte de hoy o de ayer. La fecha del parte no
// tiene hora: se compara por día natural en Europe/Madrid (las estaciones del catálogo están en esa zona horaria o
// en la misma hora civil). Sin fecha publicada solo cuenta la captura: una página sin actualizar re-descargada puede
// parecer reciente; es una limitación de la fuente, documentada en QUOTAS.md/VALIDATION.md.
const captured = (s: SnowCandidate, nowMs: number) => nowMs - s.observedAt <= STALE_HOURS.snow * 3600_000;
const reportOld = (s: SnowCandidate, nowMs: number) => !!s.sourceDate && s.sourceDate < addDays(todayMadrid(nowMs), -1);
const reportFuture = (s: SnowCandidate, nowMs: number) => !!s.sourceDate && s.sourceDate > todayMadrid(nowMs);
const fresh = (s: SnowCandidate, nowMs: number) => captured(s, nowMs) && !reportOld(s, nowMs);
const reliable = (s: SnowCandidate, nowMs: number) => s.quality === 'ok' && s.opStatus !== 'unknown' && !reportFuture(s, nowMs);

/**
 * Una observación por área, siempre la misma para los mismos datos: primero recientes y fiables por prioridad de
 * fuente (menor = preferente), luego más reciente e id de fuente; si no hay ninguna reciente y fiable, la más reciente
 * (se sigue mostrando con su fecha, pero no puntúa).
 */
export function pickSnow<T extends SnowCandidate>(cands: readonly T[], nowMs: number): T | null {
  const byPriority = (a: T, b: T) => a.priority - b.priority || b.observedAt - a.observedAt || a.sourceId.localeCompare(b.sourceId);
  const byRecency = (a: T, b: T) => b.observedAt - a.observedAt || a.priority - b.priority || a.sourceId.localeCompare(b.sourceId);
  const good = cands.filter((c) => fresh(c, nowMs) && reliable(c, nowMs)).sort(byPriority);
  return good[0] ?? [...cands].sort(byRecency)[0] ?? null;
}

/** Km abiertos que pueden puntuar en «Nieve abierta ahora», o el motivo de exclusión. */
export function snowForRanking(s: SnowCandidate | null, nowMs: number): { openKm: number | null; excluded: SnowExclusion | null } {
  if (!s) return { openKm: null, excluded: 'sin_dato' };
  if (!captured(s, nowMs)) return { openKm: null, excluded: 'antiguo' };
  if (reportOld(s, nowMs)) return { openKm: null, excluded: 'parte_antiguo' };
  if (s.quality !== 'ok' || reportFuture(s, nowMs)) return { openKm: null, excluded: 'dudoso' };
  if (s.opStatus === 'unknown') return { openKm: null, excluded: 'estado_desconocido' };
  if (s.openKm == null) return s.opStatus === 'closed_confirmed' || s.opStatus === 'out_of_season' ? { openKm: 0, excluded: null } : { openKm: null, excluded: 'sin_km' };
  return { openKm: s.openKm, excluded: null };
}

export interface CostOption {
  id: string; title: string; areaId: string | null; roadKm: number | null; roadValidated: boolean; budget: BudgetResult;
}
export interface RankedCost {
  id: string; title: string; areaId: string | null; roadKm: number | null; roadValidated: boolean;
  /** Posición solo entre presupuestos completos; null si falta algo. */
  rank: number | null; complete: boolean; perPersonCents: number | null; knownPerPersonCents: number | null;
  totalCents: number | null; knownSubtotalCents: number; pending: string[];
  lodging: { status: string; comparison: unknown; referenceCents: number | null } | null;
}

export function rankCosts(options: readonly CostOption[]): RankedCost[] {
  const rows: RankedCost[] = options.map((o) => {
    const l = o.budget.components.find((c) => c.key === 'lodging') as any;
    return {
      id: o.id, title: o.title, areaId: o.areaId, roadKm: o.roadKm, roadValidated: o.roadValidated, rank: null,
      complete: o.budget.complete && o.budget.perPersonCents != null, perPersonCents: o.budget.complete ? o.budget.perPersonCents : null,
      knownPerPersonCents: o.budget.knownPerPersonCents, totalCents: o.budget.complete ? o.budget.knownSubtotalCents : null,
      knownSubtotalCents: o.budget.knownSubtotalCents, pending: o.budget.pending,
      lodging: l ? { status: l.status, comparison: l.comparison ?? null, referenceCents: l.referenceCents ?? null } : null,
    };
  });
  const complete = rows.filter((r) => r.complete).sort((a, b) => a.perPersonCents! - b.perPersonCents! || a.id.localeCompare(b.id));
  complete.forEach((r, i) => { r.rank = i + 1; });
  // Los incompletos van después, en orden estable por título: no se ordenan por su subtotal parcial.
  const incomplete = rows.filter((r) => !r.complete).sort((a, b) => a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id));
  return [...complete, ...incomplete];
}
