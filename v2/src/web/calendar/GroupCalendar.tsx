// Vista común: recuento por día, detalle de quién está en cada estado y ventanas candidatas.
// «Quizá» nunca se presenta como confirmado; «sin indicar» nunca cuenta como libre;
// quien no comparte aparece como «no compartido», sin datos.
import { useMemo, type ReactNode } from 'react';
import { dayLongNoYear, dayShort, plural, range as fmtRange, STATUS_LABEL } from '../format';
import type { CandidateWindow, CommonResponse } from '../types';
import { eachDay, selRange, type Selection } from './dates';
import { MonthGrid } from './MonthGrid';
import { Legend, StatusSwatch } from './Status';

interface Props {
  data: CommonResponse;
  alias: (id: string) => string;
  from: string;
  to: string;
  selection: Selection | null;
  onSelectionChange: (s: Selection | null) => void;
  idPrefix: string;
  /** Acciones adicionales para la selección (p. ej. proponer fechas). */
  selectionActions?: (range: [string, string]) => ReactNode;
}

export function GroupCalendar({ data, alias, from, to, selection, onSelectionChange, idPrefix, selectionActions }: Props) {
  const byDay = useMemo(() => new Map(data.daily.map((d) => [d.day, d])), [data]);
  const total = data.people.length;

  const cell = (d: string) => {
    const c = byDay.get(d);
    if (!c) return { label: dayLongNoYear(d), className: 'gc', content: <span className="cell-day">{Number(d.slice(8))}</span> };
    const parts = [
      `${c.free} ${c.free === 1 ? 'libre' : 'libres'}`,
      c.maybe ? `${c.maybe} quizá` : '',
      c.busy ? `${c.busy} ${c.busy === 1 ? 'ocupado' : 'ocupados'}` : '',
      c.unknown ? `${c.unknown} sin indicar` : '',
      c.hidden ? `${c.hidden} no compartido${c.hidden === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    const level = total ? (c.free === total ? 'all' : c.free + c.maybe === total ? 'maybe' : c.free > 0 ? 'some' : 'none') : 'none';
    return {
      label: `${dayLongNoYear(d)}: ${parts.join(', ')}`,
      className: `gc gc-${level}`,
      content: (
        <>
          <span className="cell-day">{Number(d.slice(8))}</span>
          <span className="gc-counts" aria-hidden="true">
            <span className="gc-free">{c.free}✓</span>
            {(c.maybe > 0 || c.unknown > 0) && <span className="gc-rest">{c.maybe > 0 && `${c.maybe}?`}{c.unknown > 0 && ` ${c.unknown}·`}</span>}
          </span>
        </>
      ),
    };
  };

  const sel = selection ? selRange(selection) : null;

  return (
    <div className="stack">
      <Legend extra={<li><span className="swatch st-hidden" aria-hidden="true">—</span> No compartido</li>} />
      <p className="muted small" id={`${idPrefix}-help`}>
        Cada día muestra cuántas personas están libres (✓), quizá (?) y sin indicar (·). Selecciona un día o un rango para ver el detalle.
      </p>
      <MonthGrid idPrefix={idPrefix} from={from} to={to} cell={cell} selection={selection} onSelectionChange={onSelectionChange} describedBy={`${idPrefix}-help`} />
      {sel && <SelectionDetail data={data} alias={alias} range={sel} onClear={() => onSelectionChange(null)} actions={selectionActions?.(sel)} />}
    </div>
  );
}

function SelectionDetail({ data, alias, range, onClear, actions }: { data: CommonResponse; alias: (id: string) => string; range: [string, string]; onClear: () => void; actions?: ReactNode }) {
  const days = eachDay(range[0], range[1]);
  // Estado de cada persona en todo el rango: ocupado si algún día lo está; sin indicar si falta alguno.
  const groups: Record<'free' | 'maybe' | 'busy' | 'unknown' | 'hidden', string[]> = { free: [], maybe: [], busy: [], unknown: [], hidden: [] };
  for (const p of data.people) {
    if (!p.shared || !p.days) { groups.hidden.push(p.id); continue; }
    let st: 'free' | 'maybe' | 'busy' | 'unknown' = 'free';
    for (const d of days) {
      const s = p.days[d];
      if (s === 'busy') { st = 'busy'; break; }
      if (!s) st = 'unknown';
      else if (s === 'maybe' && st === 'free') st = 'maybe';
    }
    groups[st].push(p.id);
  }
  return (
    <section className="detail-panel" aria-live="polite" aria-label="Detalle de la selección">
      <div className="detail-head">
        <h3>{days.length === 1 ? dayLongNoYear(range[0]) : `${fmtRange(range[0], range[1])} (${plural(days.length, 'día', 'días')})`}</h3>
        <button type="button" className="btn btn-small btn-ghost" onClick={onClear}>Cerrar detalle</button>
      </div>
      <PeopleGroups groups={groups} alias={alias} />
      {days.length > 1 && <p className="muted small">Para todo el rango: «libre» solo si lo está todos los días; «ocupado» si lo está alguno.</p>}
      {actions}
    </section>
  );
}

export function PeopleGroups({ groups, alias }: { groups: Record<'free' | 'maybe' | 'busy' | 'unknown' | 'hidden', string[]>; alias: (id: string) => string }) {
  const rows: { key: keyof typeof groups; label: string }[] = [
    { key: 'free', label: 'Libre' },
    { key: 'maybe', label: 'Quizá (sin confirmar)' },
    { key: 'unknown', label: 'Sin indicar' },
    { key: 'busy', label: 'Ocupado' },
    { key: 'hidden', label: 'No compartido' },
  ];
  return (
    <dl className="people-groups">
      {rows.filter((r) => groups[r.key].length > 0).map((r) => (
        <div key={r.key}>
          <dt>{r.key === 'hidden' ? <span className="swatch st-hidden" aria-hidden="true">—</span> : <StatusSwatch status={r.key} />} {r.label} ({groups[r.key].length})</dt>
          <dd>{groups[r.key].map(alias).join(', ')}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Personas que no han marcado ningún día del rango y cuántos días sin indicar tiene cada una. */
export function Unanswered({ data, alias, from, to }: { data: CommonResponse; alias: (id: string) => string; from: string; to: string }) {
  const total = eachDay(from, to).length;
  const rows = data.people.filter((p) => p.shared && p.days).map((p) => {
    const marked = Object.keys(p.days!).filter((d) => d >= from && d <= to).length;
    return { id: p.id, unknown: total - marked };
  });
  const none = rows.filter((r) => r.unknown === total);
  const partial = rows.filter((r) => r.unknown > 0 && r.unknown < total);
  const hidden = data.people.filter((p) => !p.shared);
  return (
    <div className="stack-s">
      {none.length === 0 && partial.length === 0 && hidden.length === 0 && <p>Todas las personas elegidas han marcado todos los días.</p>}
      {none.length > 0 && <p><strong>No han marcado ningún día:</strong> {none.map((r) => alias(r.id)).join(', ')}</p>}
      {partial.length > 0 && <p><strong>Con días sin indicar:</strong> {partial.map((r) => `${alias(r.id)} (${r.unknown})`).join(', ')}</p>}
      {hidden.length > 0 && <p><strong>No comparten su calendario contigo:</strong> {hidden.map((p) => alias(p.id)).join(', ')}</p>}
    </div>
  );
}

export function WindowsList({ windows, alias, action, emptyHint }: { windows: CandidateWindow[]; alias: (id: string) => string; action?: (w: CandidateWindow) => ReactNode; emptyHint?: ReactNode }) {
  if (!windows.length) {
    return (
      <div className="state state-empty">
        <p className="state-title">No hay ventanas que encajen</p>
        <p>Prueba con menos noches, un mínimo de personas más bajo o pide al grupo que marque sus días.</p>
        {emptyHint}
      </div>
    );
  }
  const names = (ids: string[]) => (ids.length ? ids.map(alias).join(', ') : '—');
  return (
    <>
      <ol className="window-cards" aria-label="Ventanas candidatas">
        {windows.map((w) => (
          <li key={w.start} className="window-card">
            <p className="window-dates"><strong>{dayShort(w.start)}</strong> <span aria-hidden="true">→</span><span className="visually-hidden">hasta</span> <strong>{dayShort(w.end)}</strong> · {plural(w.nights, 'noche', 'noches')}</p>
            <p>{w.meetsWithFree ? <span className="tag tag-ok">Encaja con quien está libre</span> : <span className="tag tag-warn">Solo si se confirman los «quizá»</span>}</p>
            <PeopleGroups groups={w} alias={alias} />
            {action?.(w)}
          </li>
        ))}
      </ol>
      <div className="table-wrap">
        <table className="window-table">
          <caption className="visually-hidden">Ventanas candidatas: llegada, salida y estado de cada persona</caption>
          <thead>
            <tr><th scope="col">Llegada → salida</th><th scope="col">Noches</th><th scope="col">Encaje</th><th scope="col">Libre</th><th scope="col">Quizá</th><th scope="col">Sin indicar / ocupado / no compartido</th>{action && <th scope="col"><span className="visually-hidden">Acciones</span></th>}</tr>
          </thead>
          <tbody>
            {windows.map((w) => (
              <tr key={w.start}>
                <th scope="row">{dayShort(w.start)} → {dayShort(w.end)}</th>
                <td>{w.nights}</td>
                <td>{w.meetsWithFree ? 'Con libres' : 'Si se confirman los quizá'}</td>
                <td>{names(w.free)}</td>
                <td>{names(w.maybe)}</td>
                <td>{[w.unknown.length ? `Sin indicar: ${names(w.unknown)}` : '', w.busy.length ? `Ocupado: ${names(w.busy)}` : '', w.hidden.length ? `No compartido: ${names(w.hidden)}` : ''].filter(Boolean).join(' · ') || '—'}</td>
                {action && <td>{action(w)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const statusWord = (s: keyof typeof STATUS_LABEL) => STATUS_LABEL[s];
