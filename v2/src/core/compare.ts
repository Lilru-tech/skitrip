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

/** Por qué un parte no es vigente para puntuar (captura, fecha del parte, calidad, estado), o null si lo es. */
export function reportExclusion(s: Pick<SnowCandidate, 'observedAt' | 'opStatus' | 'quality' | 'sourceDate'>, nowMs: number): 'antiguo' | 'parte_antiguo' | 'dudoso' | 'estado_desconocido' | null {
  const c = { ...s, sourceId: '', priority: 0, openKm: null };
  if (!captured(c, nowMs)) return 'antiguo';
  if (reportOld(c, nowMs)) return 'parte_antiguo';
  if (s.quality !== 'ok' || reportFuture(c, nowMs)) return 'dudoso';
  if (s.opStatus === 'unknown') return 'estado_desconocido';
  return null;
}

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

const KM_ES = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }); // creado una vez: toLocaleString crea uno por llamada
const kmEs = (v: number) => `${KM_ES.format(v)} km`;

/**
 * Texto del estado de nieve para mostrar (no puntúa: eso es snowForRanking, que no cambia). Una estación cerrada o
 * fuera de temporada por confirmación de la fuente se dice como tal aunque la fuente no publique km, en lugar de
 * «sin dato abiertos de sin dato».
 */
export function snowStateText(s: { opStatus: string; openKm: number | null; totalKm: number | null }): { text: string; closed: boolean } {
  const total = s.totalKm == null ? null : kmEs(s.totalKm);
  if (s.opStatus === 'closed_confirmed' || s.opStatus === 'out_of_season') {
    const what = s.opStatus === 'closed_confirmed' ? 'Cerrada' : 'Fuera de temporada';
    const km = s.openKm != null ? ` · ${kmEs(s.openKm)} abiertos${total ? ` de ${total}` : ''}` : total ? ` · ${total} en total` : ' · la fuente no publica km';
    return { text: `${what} (confirmado por la fuente)${km}`, closed: true };
  }
  return { text: `${s.openKm == null ? 'sin dato' : kmEs(s.openKm)} abiertos de ${total ?? 'sin dato'}`, closed: false };
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

// ---------- Estado de apertura de una estación ----------
// Cuatro estados que se muestran por separado. Solo hay «Abierta», «Cerrada» o «Fuera de temporada» con un dato vigente
// (mismo criterio que «Nieve abierta ahora»: captura reciente, parte de hoy o de ayer, calidad ok). Un dato ausente,
// antiguo o dudoso es «Estado desconocido», nunca cierre. Tampoco se deduce el cierre de 0 km abiertos: decide el estado
// que publica la fuente.
export type ResortStatus = 'open' | 'closed' | 'off_season' | 'unknown';
export const RESORT_STATUS_LABEL: Record<ResortStatus, string> = { open: 'Abierta', closed: 'Cerrada', off_season: 'Fuera de temporada', unknown: 'Estado desconocido' };
export interface ResortStatusInfo {
  status: ResortStatus;
  /** Abierta solo en parte según la fuente. */
  partial: boolean;
  /** Por qué el estado es desconocido. */
  reason: string | null;
  /** Último estado publicado cuando ya no es vigente (p. ej. «cerrada»), solo como contexto. */
  lastKnown: string | null;
}
type StatusInput = Pick<SnowCandidate, 'observedAt' | 'opStatus' | 'quality' | 'sourceDate'>;
const OP_WORD: Record<string, string> = { open: 'abierta', partial: 'abierta en parte', closed_confirmed: 'cerrada', out_of_season: 'fuera de temporada' };

export function resortStatus(s: StatusInput | null | undefined, nowMs: number): ResortStatusInfo {
  const unknown = (reason: string, last = true): ResortStatusInfo => ({ status: 'unknown', partial: false, reason, lastKnown: last && s ? OP_WORD[s.opStatus] ?? null : null });
  if (!s) return unknown('no hay datos de la fuente', false);
  const c = { ...s, sourceId: '', priority: 0, openKm: null };
  if (!captured(c, nowMs)) return unknown(`último dato capturado hace más de ${STALE_HOURS.snow} h`);
  if (reportOld(c, nowMs)) return unknown('el parte de la fuente es anterior a ayer');
  if (s.quality !== 'ok' || reportFuture(c, nowMs)) return unknown('dato dudoso');
  if (s.opStatus === 'open' || s.opStatus === 'partial') return { status: 'open', partial: s.opStatus === 'partial', reason: null, lastKnown: null };
  if (s.opStatus === 'closed_confirmed') return { status: 'closed', partial: false, reason: null, lastKnown: null };
  if (s.opStatus === 'out_of_season') return { status: 'off_season', partial: false, reason: null, lastKnown: null };
  return unknown('la fuente no indica si está abierta', false);
}

/**
 * Estado de un dominio sin parte propio a partir de sus estaciones: abierto si alguna lo está; cerrado o fuera de
 * temporada solo si todas lo confirman; en otro caso, desconocido.
 */
export function combineStatus(parts: readonly ResortStatusInfo[]): ResortStatusInfo {
  if (!parts.length) return { status: 'unknown', partial: false, reason: 'no hay datos de la fuente', lastKnown: null };
  const open = parts.filter((p) => p.status === 'open');
  if (open.length) return { status: 'open', partial: open.length < parts.length || open.some((p) => p.partial), reason: null, lastKnown: null };
  if (parts.every((p) => p.status === 'closed' || p.status === 'off_season')) {
    return { status: parts.some((p) => p.status === 'closed') ? 'closed' : 'off_season', partial: false, reason: null, lastKnown: null };
  }
  return { status: 'unknown', partial: false, reason: 'no todas sus estaciones tienen un estado vigente', lastKnown: null };
}

export type StatusCounts = Record<ResortStatus, number> & { total: number };
export function countStatuses(list: readonly ResortStatus[]): StatusCounts {
  const c: StatusCounts = { open: 0, closed: 0, off_season: 0, unknown: 0, total: list.length };
  for (const s of list) c[s]++;
  return c;
}

/**
 * Aviso global cuando no hay ninguna estación abierta confirmada en un conjunto. «Todas cerradas» solo si todas
 * tienen cierre (o fin de temporada) confirmado y vigente; si alguna es desconocida se dice cuántas.
 * null = hay al menos una abierta confirmada (o el conjunto está vacío).
 */
export function noOpenNotice(c: StatusCounts): { allClosed: boolean; text: string } | null {
  if (c.total === 0 || c.open > 0) return null;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (c.unknown === 0) {
    return { allClosed: true, text: `Las ${c.total} están cerradas o fuera de temporada según su fuente, con dato vigente.` };
  }
  const known = [c.closed ? n(c.closed, 'cerrada', 'cerradas') : '', c.off_season ? `${c.off_season} fuera de temporada` : ''].filter(Boolean).join(' y ');
  return { allClosed: false, text: `Ninguna abierta confirmada: ${known ? `${known}, ` : ''}${c.unknown} con estado desconocido (${c.unknown === 1 ? 'puede estar abierta' : 'pueden estar abiertas'}; no hay dato vigente).` };
}

// ---------- Coste por persona de un viaje, por estación ----------
export interface CostByAreaInput {
  id: string; title: string; areaId: string | null; complete: boolean; perPersonCents: number | null; pending: string[];
  modality?: string | null; forfaitIncluded?: string | null; hypothetical?: boolean;
}
export interface AreaCost {
  /** Coste completo por persona de la candidatura más barata entre las completas; null = coste pendiente. */
  perPersonCents: number | null;
  /** Candidatura de la que sale el coste. */
  via: { id: string; title: string; package: boolean; hypothetical: boolean } | null;
  completeCount: number;
  candidateCount: number;
  /** Partidas que faltan en las candidaturas incompletas de la estación (sin repetir). */
  pending: string[];
}

/**
 * Coste por persona de cada estación (de primer nivel: `topOf` lleva una estación miembro a su dominio) con los
 * presupuestos completos del viaje (rankCosts/computeBudget: mismas fechas, noches, ocupación y días de forfait; un
 * alojamiento solo suma forfait aparte y un paquete no). Con varias completas se usa la más barata y se dice cuál. Una
 * estación sin presupuesto completo queda pendiente: nunca cuenta como 0 € ni como la más barata.
 */
export function costsByArea(rows: readonly CostByAreaInput[], topOf: (areaId: string) => string = (id) => id): Map<string, AreaCost> {
  const out = new Map<string, AreaCost>();
  for (const r of rows) {
    if (!r.areaId) continue;
    const key = topOf(r.areaId);
    const cur = out.get(key) ?? { perPersonCents: null, via: null, completeCount: 0, candidateCount: 0, pending: [] };
    cur.candidateCount++;
    if (r.complete && r.perPersonCents != null) {
      cur.completeCount++;
      if (cur.perPersonCents == null || r.perPersonCents < cur.perPersonCents || (r.perPersonCents === cur.perPersonCents && r.id < cur.via!.id)) {
        cur.perPersonCents = r.perPersonCents;
        cur.via = { id: r.id, title: r.title, package: r.forfaitIncluded === 'yes' || (r.forfaitIncluded == null && r.modality === 'lodging_forfait'), hypothetical: !!r.hypothetical };
      }
    } else {
      for (const p of r.pending) if (!cur.pending.includes(p)) cur.pending.push(p);
    }
    out.set(key, cur);
  }
  return out;
}

/** Qué le falta a un viaje para que el coste pueda puntuar (fechas, noches y días de esquí). */
export function tripCostMissing(t: { startDate: string | null; endDate: string | null; nights: number | null; skiDays: number | null }): string[] {
  const m: string[] = [];
  if (!t.startDate || !t.endDate) m.push('fechas de llegada y salida');
  if (t.nights == null) m.push('noches');
  if (t.skiDays == null) m.push('días de esquí');
  return m;
}
