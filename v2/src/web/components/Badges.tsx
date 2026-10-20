import { instant } from '../format';
import { RESORT_STATUS_LABEL, type ResortStatusInfo } from '../../core/compare';
import { addDays, todayMadrid } from '../../core/dates';

const STATUS_SYMBOL = { open: '✓', closed: '✕', off_season: '–', unknown: '?' } as const;

/** Estado de apertura: Abierta, Cerrada, Fuera de temporada o Estado desconocido, con símbolo y texto. */
export function StatusBadge({ info }: { info: ResortStatusInfo }) {
  const label = info.status === 'open' && info.partial ? 'Abierta en parte' : RESORT_STATUS_LABEL[info.status];
  return (
    <span className={`status-badge status-${info.status}`}>
      <span aria-hidden="true">{STATUS_SYMBOL[info.status]}</span> {label}
    </span>
  );
}

/**
 * Actualidad de un dato con su hora de captura. Nunca solo color: texto explícito. Es neutra a propósito: «dato
 * reciente» no significa «abierta» (eso es StatusBadge, el único verde de apertura).
 */
export function Freshness({ state, at }: { state: 'fresh' | 'stale' | 'never'; at?: number | null }) {
  const label = state === 'fresh' ? 'Dato reciente' : state === 'stale' ? 'Dato antiguo' : 'Sin datos';
  return (
    <span className={`badge badge-${state}`}>
      <span aria-hidden="true">{state === 'fresh' ? '●' : state === 'stale' ? '◐' : '○'}</span> {label}
      {at != null && <span className="badge-time"> · capturado {instant(at)}</span>}
    </span>
  );
}

export function StatusTag({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'quiet'; children: React.ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** Fecha del parte publicada por la fuente (sin hora). Se muestra aparte de la fecha de captura. */
export function ReportDate({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="small muted"> · la fuente no publica fecha de parte</span>;
  const [y, m, d] = date.split('-');
  return <span className="small"> · parte del {d}/{m}/{y}</span>;
}

/**
 * Antigüedad del parte para el resumen: la fecha que publica la fuente, no la de captura. Una captura reciente de un
 * parte viejo sigue siendo un parte viejo; sin fecha publicada se dice y solo entonces se da la hora de captura.
 */
export function ReportAge({ date, at, freshness }: { date: string | null | undefined; at?: number | null; freshness?: 'fresh' | 'stale' | 'never' }) {
  if (freshness === 'never' || (!date && at == null)) return <>Sin parte</>;
  if (!date) {
    return <>Sin fecha de parte{at != null && <span className="muted"> · capturado {instant(at)}</span>}
      {freshness === 'stale' && <span className="text-warn"> · dato antiguo</span>}</>;
  }
  const [y, m, d] = date.split('-');
  const old = date < addDays(todayMadrid(), -1) || freshness === 'stale';
  return <>Parte del {d}/{m}/{y}{old && <span className="text-warn"> · parte desactualizado</span>}</>;
}
