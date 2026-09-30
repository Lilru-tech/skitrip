import { instant } from '../format';

/** Frescura de un dato con su hora de observación. Nunca solo color: texto explícito. */
export function Freshness({ state, at }: { state: 'fresh' | 'stale' | 'never'; at?: number | null }) {
  const label = state === 'fresh' ? 'Actualizado' : state === 'stale' ? 'Desactualizado' : 'Sin datos';
  return (
    <span className={`badge badge-${state}`}>
      <span aria-hidden="true">{state === 'fresh' ? '●' : state === 'stale' ? '◐' : '○'}</span> {label}
      {at != null && <span className="badge-time"> · {instant(at)}</span>}
    </span>
  );
}

export function StatusTag({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'quiet'; children: React.ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
