// Disponibilidad de la hoja antigua asignada a tu cuenta: comparación con tu calendario actual e incorporación
// explícita. Nada se copia solo; por defecto no se sobrescriben días ya indicados. Los días ya pasados son consulta
// histórica: se ven agrupados por temporada y mes, pero no se incorporan ni se trasladan a otra temporada.
import { useMemo, useState } from 'react';
import { errorMessage, post } from '../api';
import { useToast } from '../components/Toast';
import { dayShort, instant, monthTitle, plural, STATUS_LABEL } from '../format';
import type { DayStatus } from '../types';
import { seasonFor } from '../../core/dates';
import { seasons, today as todayLocal } from './dates';

export interface LegacyAvailability {
  days: { day: string; legacyStatus: string; mappedStatus: DayStatus | null; currentStatus: DayStatus | null; incorporatedAt: number | null }[];
  note: string;
  /** Hoy según el servidor (Europe/Madrid). */
  today?: string;
}
interface Result { incorporated: number; skippedExisting: number; skippedUnmapped: number; skippedPast?: number; notAssigned: number }
type Day = LegacyAvailability['days'][number];
const seasonLabel = (d: string) => { const s = seasonFor(d); return `${s.start.slice(0, 4)}–${s.end.slice(2, 4)}`; };

export function LegacyAvailabilityView({ data, onChanged }: { data: LegacyAvailability; onChanged: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const today = data.today ?? todayLocal();
  const past = useMemo(() => data.days.filter((d) => d.day < today), [data.days, today]);
  const upcoming = useMemo(() => data.days.filter((d) => d.day >= today), [data.days, today]);
  const selectable = useMemo(() => upcoming.filter((d) => d.mappedStatus && d.mappedStatus !== d.currentStatus), [upcoming]);
  const allOn = selectable.length > 0 && selectable.every((d) => sel.has(d.day));

  const toggle = (day: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(day); else n.delete(day); return n; });
  const incorporate = async () => {
    if (!sel.size) { setErr('Elige al menos un día.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post<Result>('/api/legacy/availability/mine/incorporate', { days: [...sel], overwrite });
      setResult(r);
      setSel(new Set());
      toast.show(`${r.incorporated} día(s) incorporado(s) a tu calendario.`);
      onChanged();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel stack" aria-labelledby="lg-av-h">
      <h2 id="lg-av-h">Disponibilidad de la hoja antigua</h2>
      <p className="small muted">{data.note}</p>
      <p className="small">Los días que no estaban en la hoja siguen «sin indicar» en tu calendario.</p>
      {upcoming.length > 0 && <>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Hoja antigua frente a tu calendario">
          <table className="data-table compact">
            <caption className="visually-hidden">Días de la hoja antigua y estado actual de tu calendario</caption>
            <thead><tr>
              <th scope="col"><input type="checkbox" aria-label="Elegir todos los días que se pueden incorporar" checked={allOn} disabled={!selectable.length}
                onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((d) => d.day)) : new Set())} /></th>
              <th scope="col">Día</th><th scope="col">En la hoja</th><th scope="col">En tu calendario</th>
            </tr></thead>
            <tbody>{upcoming.map((d) => {
              const can = !!d.mappedStatus && d.mappedStatus !== d.currentStatus;
              return (
                <tr key={d.day}>
                  <td><input type="checkbox" aria-label={`Incorporar ${dayShort(d.day)}`} checked={sel.has(d.day)} disabled={!can} onChange={(e) => toggle(d.day, e.target.checked)} /></td>
                  <th scope="row">{dayShort(d.day)}</th>
                  <td>«{d.legacyStatus}»{d.mappedStatus ? ` → ${STATUS_LABEL[d.mappedStatus]}` : <span className="muted"> (sin equivalencia, no se incorpora)</span>}</td>
                  <td>{d.currentStatus ? STATUS_LABEL[d.currentStatus] : <span className="muted">sin indicar</span>}
                    {d.incorporatedAt != null && <span className="small muted"> · incorporado {instant(d.incorporatedAt)}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="check"><input id="lg-ow" type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          <label htmlFor="lg-ow">Sobrescribir los días que ya tengo indicados</label></div>
        <div className="cluster-s">
          <button type="button" className="btn btn-primary" onClick={() => void incorporate()} disabled={busy || sel.size === 0}>{busy ? 'Incorporando…' : 'Incorporar a mi calendario'}</button>
          <span className="small muted" aria-live="polite">{sel.size} día(s) elegido(s)</span>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        {result && (
          <p className="notice notice-ok" role="status">
            Incorporados: {result.incorporated}. Ya indicados y no sobrescritos: {result.skippedExisting}. Sin equivalencia: {result.skippedUnmapped}.
            {result.notAssigned > 0 && ` No asignados a tu cuenta: ${result.notAssigned}.`}
            {!!result.skippedPast && ` Ya pasados (solo consulta): ${result.skippedPast}.`}
          </p>
        )}
      </>}
      {past.length > 0 && <History days={past} />}
    </section>
  );
}

/** Consulta histórica: resumen por temporada y mes y la tabla completa, sin acciones. */
function History({ days }: { days: Day[] }) {
  const next = seasons()[0].label.replace('Temporada ', '');
  const months = useMemo(() => {
    const m = new Map<string, Day[]>();
    for (const d of days) { const k = d.day.slice(0, 7); (m.get(k) ?? m.set(k, []).get(k)!).push(d); }
    return [...m.entries()];
  }, [days]);
  const count = (ds: Day[]) => {
    const c = new Map<string, number>();
    for (const d of ds) { const k = d.mappedStatus ? STATUS_LABEL[d.mappedStatus] : `«${d.legacyStatus}»`; c.set(k, (c.get(k) ?? 0) + 1); }
    return [...c.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
  };
  const seasonsSeen = [...new Set(days.map((d) => seasonLabel(d.day)))];
  return (
    <section className="stack-s" aria-labelledby="lg-hist-h">
      <h3 id="lg-hist-h">Consulta histórica <span className="count">{days.length}</span></h3>
      <p className="small">{plural(days.length, 'día', 'días')} de la temporada {seasonsSeen.join(' y ')}, ya pasados. Se conservan para consultarlos: no se copian a tu calendario ni se trasladan a la temporada {next}.</p>
      <ul className="small inline-list" aria-label="Resumen por mes">
        {months.map(([k, ds]) => <li key={k}><strong>{monthTitle(`${k}-01`)}</strong>: {count(ds)}</li>)}
      </ul>
      <details className="fold">
        <summary>Ver los {days.length} días</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Consulta histórica de la hoja antigua">
          <table className="data-table compact">
            <caption className="visually-hidden">Días ya pasados de la hoja antigua (solo consulta)</caption>
            <thead><tr><th scope="col">Día</th><th scope="col">En la hoja</th></tr></thead>
            <tbody>{days.map((d) => (
              <tr key={d.day}><th scope="row">{dayShort(d.day)} {d.day.slice(0, 4)}</th><td>«{d.legacyStatus}»{d.mappedStatus ? ` → ${STATUS_LABEL[d.mappedStatus]}` : <span className="muted"> (sin equivalencia)</span>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
