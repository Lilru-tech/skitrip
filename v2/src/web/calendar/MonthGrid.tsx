// Rejilla mensual accesible (lunes primero) con selección de días y rangos:
// - Tocar/clic en inicio y luego en fin; en escritorio también arrastrar con el ratón; Mayús+clic extiende.
// - Teclado: flechas mueven el foco, Mayús+flechas extienden el rango, Espacio/Intro seleccionan,
//   Inicio/Fin van al lunes/domingo, RePág/AvPág cambian de mes, Escape limpia la selección.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { monthTitle } from '../format';
import { addDays, addMonths, clamp, inSel, monthWeeks, monthsBetween, today, weekdayMon0, WEEKDAY_ABBR, WEEKDAYS, type Selection } from './dates';

export interface CellInfo { label: string; className: string; content: ReactNode }

interface Props {
  from: string;
  to: string;
  cell: (day: string) => CellInfo;
  selection: Selection | null;
  onSelectionChange: (s: Selection | null) => void;
  /** Descripción para lectores de pantalla (instrucciones). */
  describedBy?: string;
  idPrefix: string;
}

export function MonthGrid({ from, to, cell, selection, onSelectionChange, describedBy, idPrefix }: Props) {
  const t = today();
  const [focused, setFocused] = useState(() => clamp(t, from, to));
  const root = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const drag = useRef<{ anchor: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const selRef = useRef(selection);
  selRef.current = selection;

  useEffect(() => { setFocused((f) => clamp(f, from, to)); }, [from, to]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const el = root.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  const tap = useCallback((d: string) => {
    const s = selRef.current;
    if (s && s.pending) onSelectionChange({ anchor: s.anchor, end: d, pending: false });
    else onSelectionChange({ anchor: d, end: d, pending: true });
  }, [onSelectionChange]);

  useEffect(() => {
    const up = () => {
      const dr = drag.current;
      drag.current = null;
      if (dr?.moved) {
        // El clic que sigue a un arrastre no debe iniciar otra selección.
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let next: string | null = null;
    if (k === 'ArrowLeft') next = addDays(focused, -1);
    else if (k === 'ArrowRight') next = addDays(focused, 1);
    else if (k === 'ArrowUp') next = addDays(focused, -7);
    else if (k === 'ArrowDown') next = addDays(focused, 7);
    else if (k === 'Home') next = addDays(focused, -weekdayMon0(focused));
    else if (k === 'End') next = addDays(focused, 6 - weekdayMon0(focused));
    else if (k === 'PageUp') next = addMonths(focused, -1);
    else if (k === 'PageDown') next = addMonths(focused, 1);
    else if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && selection) onSelectionChange({ anchor: selection.anchor, end: focused, pending: false });
      else tap(focused);
      return;
    } else if (k === 'Escape') {
      if (selection) { e.preventDefault(); e.stopPropagation(); onSelectionChange(null); }
      return;
    }
    if (next === null) return;
    e.preventDefault();
    next = clamp(next, from, to);
    if (e.shiftKey && k.startsWith('Arrow')) {
      const anchor = selection?.anchor ?? focused;
      onSelectionChange({ anchor, end: next, pending: false });
    }
    moveFocus.current = true;
    setFocused(next);
  };

  return (
    <div className="months" ref={root} onKeyDown={onKeyDown}>
      {monthsBetween(from, to).map((m) => {
        const titleId = `${idPrefix}-${m}`;
        return (
          <section key={m} className="month" aria-labelledby={titleId}>
            <h3 className="month-title" id={titleId}>{monthTitle(m)}</h3>
            <div role="grid" className="grid" aria-labelledby={titleId} aria-describedby={describedBy} aria-multiselectable="true">
              <div role="row" className="grid-row grid-head">
                {WEEKDAY_ABBR.map((w, i) => (
                  <div key={w} role="columnheader" className="grid-colhead" aria-label={WEEKDAYS[i]}><abbr title={WEEKDAYS[i]}>{w}</abbr></div>
                ))}
              </div>
              {monthWeeks(m).map((week, wi) => (
                <div role="row" className="grid-row" key={wi}>
                  {week.map((d, di) => {
                    if (!d || d < from || d > to) return <div key={di} role="gridcell" className="cell cell-void" aria-hidden="true" />;
                    const info = cell(d);
                    const selected = inSel(selection, d);
                    return (
                      <div key={d} role="gridcell" data-date={d} tabIndex={d === focused ? 0 : -1}
                        aria-selected={selected} aria-label={info.label + (d === t ? ' (hoy)' : '')}
                        className={`cell ${info.className}${selected ? ' is-selected' : ''}${d === t ? ' is-today' : ''}${selection?.pending && selection.anchor === d ? ' is-anchor' : ''}`}
                        onFocus={() => setFocused(d)}
                        onPointerDown={(e) => {
                          if (e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey) return;
                          drag.current = { anchor: d, moved: false };
                        }}
                        onPointerEnter={() => {
                          const dr = drag.current;
                          if (!dr || dr.anchor === d) return;
                          dr.moved = true;
                          onSelectionChange({ anchor: dr.anchor, end: d, pending: false });
                        }}
                        onClick={(e) => {
                          if (suppressClick.current) { suppressClick.current = false; return; }
                          if (e.shiftKey && selection) onSelectionChange({ anchor: selection.anchor, end: d, pending: false });
                          else tap(d);
                        }}>
                        {info.content}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
