// Disponibilidad de la hoja antigua asignada a tu cuenta: comparación con tu calendario actual e incorporación
// explícita. Nada se copia solo; por defecto no se sobrescriben días ya indicados.
import { useMemo, useState } from 'react';
import { errorMessage, post } from '../api';
import { useToast } from '../components/Toast';
import { dayShort, instant, STATUS_LABEL } from '../format';
import type { DayStatus } from '../types';

export interface LegacyAvailability {
  days: { day: string; legacyStatus: string; mappedStatus: DayStatus | null; currentStatus: DayStatus | null; incorporatedAt: number | null }[];
  note: string;
}
interface Result { incorporated: number; skippedExisting: number; skippedUnmapped: number; notAssigned: number }

export function LegacyAvailabilityView({ data, onChanged }: { data: LegacyAvailability; onChanged: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const selectable = useMemo(() => data.days.filter((d) => d.mappedStatus && d.mappedStatus !== d.currentStatus), [data.days]);
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
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Hoja antigua frente a tu calendario">
        <table className="data-table compact">
          <caption className="visually-hidden">Días de la hoja antigua y estado actual de tu calendario</caption>
          <thead><tr>
            <th scope="col"><input type="checkbox" aria-label="Elegir todos los días que se pueden incorporar" checked={allOn} disabled={!selectable.length}
              onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((d) => d.day)) : new Set())} /></th>
            <th scope="col">Día</th><th scope="col">En la hoja</th><th scope="col">En tu calendario</th>
          </tr></thead>
          <tbody>{data.days.map((d) => {
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
        </p>
      )}
    </section>
  );
}
