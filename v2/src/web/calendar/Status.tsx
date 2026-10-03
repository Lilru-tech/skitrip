import type { DayStatus } from '../types';
import { STATUS_LABEL } from '../format';

export type Status = DayStatus | 'unknown';
export const SYMBOL: Record<Status, string> = { free: '✓', busy: '✕', maybe: '?', unknown: '' };

/** Muestra de estado para leyendas: símbolo + trama + texto, nunca solo color. */
export function StatusSwatch({ status }: { status: Status }) {
  return <span className={`swatch st-${status}`} aria-hidden="true">{SYMBOL[status]}</span>;
}

export function Legend({ extra }: { extra?: React.ReactNode }) {
  const order: Status[] = ['free', 'maybe', 'busy', 'unknown'];
  return (
    <ul className="legend" aria-label="Leyenda">
      {order.map((s) => (
        <li key={s}><StatusSwatch status={s} /> {STATUS_LABEL[s].charAt(0).toUpperCase() + STATUS_LABEL[s].slice(1)}</li>
      ))}
      {extra}
    </ul>
  );
}
