// Edición de la disponibilidad propia. Lo no marcado es «sin indicar» y nunca se trata como libre.
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, get, put, qs } from '../api';
import { Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { dayLongNoYear, dayShort, plural, range as fmtRange, STATUS_LABEL } from '../format';
import type { DayStatus } from '../types';
import { eachDay, selRange, weekdayMon0, WEEKDAYS, type Season, type Selection } from './dates';
import { MonthGrid } from './MonthGrid';
import { Legend, SYMBOL, type Status } from './Status';

type Days = Record<string, DayStatus>;

export function MyAvailability({ season }: { season: Season }) {
  const toast = useToast();
  const [days, setDays] = useState<Days | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);

  const load = async () => {
    setLoadErr(null);
    try {
      const r = await get<{ days: Days }>(`/api/availability/me?${qs({ from: season.start, to: season.end })}`);
      setDays(r.days);
    } catch (e) {
      setLoadErr(errorMessage(e));
    }
  };
  useEffect(() => { setDays(null); setSelection(null); void load(); }, [season.start, season.end]);

  const counts = useMemo(() => {
    const c = { free: 0, maybe: 0, busy: 0, unknown: 0 };
    if (!days) return c;
    for (const d of eachDay(season.start, season.end)) c[days[d] ?? 'unknown']++;
    return c;
  }, [days, season]);

  const apply = async (status: DayStatus | null) => {
    if (!selection || !days) return;
    const [a, b] = selRange(selection);
    const list = eachDay(a, b);
    const before = days;
    const after: Days = { ...days };
    for (const d of list) { if (status) after[d] = status; else delete after[d]; }
    setDays(after); // optimista
    setSaving(true);
    try {
      await put('/api/availability/me', { set: list.map((day) => ({ day, status })) });
      setSelection(null);
      toast.show(`Guardado: ${plural(list.length, 'día', 'días')} como «${STATUS_LABEL[status ?? 'unknown']}».`);
    } catch (e) {
      setDays(before); // se conserva la selección para reintentar
      toast.show(`No se ha guardado. ${errorMessage(e)}`, 'error', { label: 'Reintentar', run: () => void apply(status) });
    } finally {
      setSaving(false);
    }
  };

  if (loadErr && !days) return <ErrorState message={loadErr} onRetry={load} />;
  if (!days) return <Loading label="Cargando tu disponibilidad…" />;

  const cell = (d: string) => {
    const s: Status = days[d] ?? 'unknown';
    return {
      label: `${dayLongNoYear(d)}: ${STATUS_LABEL[s]}`,
      className: `st-${s}`,
      content: <><span className="cell-day">{Number(d.slice(8))}</span><span className="cell-sym" aria-hidden="true">{SYMBOL[s]}</span></>,
    };
  };

  const sel = selection ? selRange(selection) : null;
  const selCount = sel ? eachDay(sel[0], sel[1]).length : 0;

  return (
    <div className="stack">
      <div className="toolbar">
        <Legend />
        <button type="button" className="btn btn-secondary" onClick={() => setPatternOpen(true)}>Patrón semanal…</button>
      </div>
      <p className="summary-line" aria-live="polite">
        <span><strong>{counts.free}</strong> libres</span>
        <span><strong>{counts.maybe}</strong> quizá</span>
        <span><strong>{counts.busy}</strong> ocupados</span>
        <span><strong>{counts.unknown}</strong> sin indicar</span>
      </p>
      <p id="cal-help" className="muted small">
        Toca el primer día y después el último para elegir un rango (en ordenador también puedes arrastrar). Con teclado: flechas para moverte,
        Espacio o Intro para seleccionar y Mayúsculas + flechas para ampliar. Luego elige el estado.
      </p>
      <MonthGrid idPrefix="mine" from={season.start} to={season.end} cell={cell} selection={selection} onSelectionChange={setSelection} describedBy="cal-help" />

      {selection && sel && (
        <div className="action-bar" role="region" aria-label="Aplicar estado a la selección">
          <div className="action-bar-head">
            <p className="action-bar-text" aria-live="polite">
            {selection.pending
              ? <>Desde <strong>{dayShort(sel[0])}</strong>. Toca el día final o aplica un estado solo a este día.</>
              : <><strong>{plural(selCount, 'día', 'días')}</strong>: {fmtRange(sel[0], sel[1])}</>}
          </p>
            <button type="button" className="btn btn-small btn-ghost" disabled={saving} onClick={() => setSelection(null)}>Cancelar</button>
          </div>
          <div className="action-bar-buttons">
            <button type="button" className="btn btn-status st-free" disabled={saving} onClick={() => void apply('free')}><span aria-hidden="true">✓</span> Libre</button>
            <button type="button" className="btn btn-status st-maybe" disabled={saving} onClick={() => void apply('maybe')}><span aria-hidden="true">?</span> Quizá</button>
            <button type="button" className="btn btn-status st-busy" disabled={saving} onClick={() => void apply('busy')}><span aria-hidden="true">✕</span> Ocupado</button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void apply(null)}>Sin indicar</button>
          </div>
          {saving && <p className="muted small" role="status">Guardando…</p>}
        </div>
      )}

      <WeeklyPattern open={patternOpen} season={season} onClose={() => setPatternOpen(false)} onApplied={() => { setPatternOpen(false); void load(); }} />
    </div>
  );
}

function WeeklyPattern({ open, season, onClose, onApplied }: { open: boolean; season: Season; onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const [weekdays, setWeekdays] = useState<number[]>([4, 5]);
  const [from, setFrom] = useState(season.start);
  const [to, setTo] = useState(season.end);
  const [status, setStatus] = useState<DayStatus | 'clear'>('free');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFrom(season.start); setTo(season.end); }, [season.start, season.end]);

  const affected = useMemo(() => (from && to && to >= from ? eachDay(from, to).filter((d) => weekdays.includes(weekdayMon0(d))).length : 0), [from, to, weekdays]);

  const submit = async () => {
    setError(null);
    if (!weekdays.length) { setError('Elige al menos un día de la semana.'); return; }
    if (!from || !to || to < from) { setError('Revisa las fechas: «hasta» no puede ser anterior a «desde».'); return; }
    setBusy(true);
    try {
      await put('/api/availability/me', { range: { from, to, status: status === 'clear' ? null : status, weekdays } });
      toast.show(`Patrón aplicado a ${plural(affected, 'día', 'días')}.`);
      onApplied();
    } catch (e) {
      setError(errorMessage(e)); // se mantiene lo elegido para reintentar
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()));

  return (
    <Dialog open={open} title="Patrón semanal" onClose={onClose} busy={busy}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" form="pattern-form" className="btn btn-primary" disabled={busy}>{busy ? 'Aplicando…' : `Aplicar a ${plural(affected, 'día', 'días')}`}</button>
      </>}>
      <form id="pattern-form" className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <p className="muted">Por ejemplo: todos los viernes y sábados de la temporada, libre. Sustituye lo que hubiera en esos días; después puedes cambiar días sueltos como excepción.</p>
        <fieldset className="weekday-picker">
          <legend>Días de la semana</legend>
          {WEEKDAYS.map((w, i) => (
            <label key={w} className="chip">
              <input type="checkbox" checked={weekdays.includes(i)} onChange={() => toggle(i)} />
              <span>{w}</span>
            </label>
          ))}
        </fieldset>
        <div className="form-row">
          <Field label="Desde" type="date" value={from} min={season.start} max={season.end} onChange={(e) => setFrom(e.target.value)} />
          <Field label="Hasta" type="date" value={to} min={from} max={season.end} onChange={(e) => setTo(e.target.value)} />
        </div>
        <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value as DayStatus | 'clear')}>
          <option value="free">Libre</option>
          <option value="maybe">Quizá</option>
          <option value="busy">Ocupado</option>
          <option value="clear">Sin indicar (borrar)</option>
        </SelectField>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
