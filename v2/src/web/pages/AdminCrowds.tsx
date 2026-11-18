// Administración › Afluencia: añadir o corregir observaciones históricas verificables (estación o dominio, fecha, medida,
// cifra o cierre confirmado, muestra, fuente y motivo). Una activa por ámbito, fecha y medida; retirar no borra; cada
// cambio queda en el historial. El servidor repite permisos y validación y rechaza ediciones simultáneas (409).
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage, get, post, put } from '../api';
import { ConfirmDialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { dayLong, instant } from '../format';
import { useResource } from '../hooks';
import {
  CROWD_MEASURE_LABEL, CROWD_MEASURES, CROWD_SAMPLE_LABEL, CROWD_UNIT, validateCrowdDraft,
  type CrowdDraft, type CrowdMeasure, type CrowdObservation, type CrowdSample, type CrowdStatus,
} from '../../core/crowds';

interface AdminObs extends CrowdObservation { reason: string; origin: 'seed' | 'admin'; state: 'active' | 'withdrawn'; version: number; updatedAt: number; updatedByAlias: string | null }
interface AdminCrowds { today: string; areas: { id: string; name: string; kind: string }[]; observations: AdminObs[] }
interface HistoryRow { id: number; action: string; at: number; actor: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; sourceRef: string | null; reason: string | null; version: number | null }

const ACTION_LABEL: Record<string, string> = { seed: 'Carga inicial', create: 'Creada', update: 'Corregida', withdraw: 'Retirada', restore: 'Restaurada' };
const NUM = new Intl.NumberFormat('es-ES');
type Form = { areaId: string; date: string; measure: CrowdMeasure; status: CrowdStatus; value: string; sample: CrowdSample; sourceRef: string; sourceTitle: string; sourcePublished: string; note: string; reason: string };
const blank = (areaId: string): Form => ({ areaId, date: '', measure: 'daily_skiers', status: 'value', value: '', sample: 'regular', sourceRef: '', sourceTitle: '', sourcePublished: '', note: '', reason: '' });
const fromObs = (o: AdminObs): Form => ({
  areaId: o.areaId, date: o.date, measure: o.measure, status: o.status, value: o.value == null ? '' : String(o.value), sample: o.sample,
  sourceRef: o.sourceRef, sourceTitle: o.sourceTitle ?? '', sourcePublished: o.sourcePublished ?? '', note: o.note ?? '', reason: '',
});
const toDraft = (f: Form): CrowdDraft => ({
  areaId: f.areaId, date: f.date, measure: f.measure, status: f.status, value: f.status === 'closed' || f.value.trim() === '' ? null : Number(f.value.replace(/\./g, '')),
  sample: f.sample, sourceRef: f.sourceRef.trim(), sourceTitle: f.sourceTitle.trim() || null, sourcePublished: f.sourcePublished || null, note: f.note.trim() || null, reason: f.reason.trim(),
});

export function CrowdsAdmin() {
  const r = useResource(() => get<AdminCrowds>('/api/admin/crowds'), []);
  const [editing, setEditing] = useState<AdminObs | 'new' | null>(null);
  const [historyOf, setHistoryOf] = useState<number | null>(null);
  if (r.loading && !r.data) return <section className="panel"><Loading label="Cargando afluencia…" /></section>;
  if (r.error && !r.data) return <section className="panel"><ErrorState message={r.error} onRetry={r.reload} /></section>;
  const data = r.data!;
  const nameOf = new Map(data.areas.map((a) => [a.id, a.name]));
  return (
    <>
      <section className="panel stack" aria-labelledby="ac-list">
        <div className="page-head">
          <h2 id="ac-list">Observaciones de afluencia</h2>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setEditing('new')}>Añadir observación</button>
        </div>
        <p className="small muted">Solo cifras de un día y de una estación o dominio, publicadas en una fuente verificable. No se guardan cifras de grupo, de varios días ni de temporada.</p>
        {data.observations.length === 0 ? <Empty title="Sin observaciones" /> : (
          <ul className="list" aria-label="Observaciones">
            {data.observations.map((o) => (
              <li key={o.id} className="stack-s">
                <span><strong>{nameOf.get(o.areaId) ?? o.areaId}</strong> · {dayLong(o.date)} · {CROWD_MEASURE_LABEL[o.measure]}:{' '}
                  {o.status === 'closed' ? 'cierre confirmado' : `${NUM.format(o.value!)} ${CROWD_UNIT[o.measure]}`}
                  {o.sample !== 'regular' && <> <span className="tag tag-warn">{CROWD_SAMPLE_LABEL[o.sample]}</span></>}
                  {o.state === 'withdrawn' && <> <span className="tag tag-quiet">Retirada</span></>}</span>
                <span className="small muted">{o.origin === 'seed' ? 'Carga inicial' : `Editada por ${o.updatedByAlias ?? 'cuenta eliminada'}`} · {instant(o.updatedAt)} · versión {o.version} · <a href={o.sourceRef} target="_blank" rel="noopener noreferrer">fuente</a></span>
                <span className="row-wrap">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(o)}>Corregir</button>
                  <StateButton obs={o} onDone={r.reload} />
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setHistoryOf(historyOf === o.id ? null : o.id)} aria-expanded={historyOf === o.id}>Historial</button>
                </span>
                {historyOf === o.id && <History id={o.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && (
        <CrowdEditor key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`} obs={editing === 'new' ? null : editing} areas={data.areas} today={data.today}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void r.reload(); }} />
      )}
    </>
  );
}

function CrowdEditor({ obs, areas, today, onClose, onSaved }: { obs: AdminObs | null; areas: AdminCrowds['areas']; today: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => (obs ? fromObs(obs) : blank(areas[0]?.id ?? '')));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const draft = toDraft(f);
  const errors = validateCrowdDraft(draft, today);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    setError(null);
    try {
      await put('/api/admin/crowds', { ...draft, observationId: obs?.id ?? null, expectedVersion: obs?.version ?? null });
      toast.show(obs ? 'Observación corregida.' : 'Observación añadida.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? `${err.message}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel stack" aria-labelledby="ac-edit">
      <h2 id="ac-edit">{obs ? 'Corregir observación' : 'Nueva observación'}</h2>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="filters">
          <SelectField label="Estación o dominio" value={f.areaId} onChange={(e) => set('areaId', e.target.value)}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.kind === 'domain' ? ' (dominio)' : ''}</option>)}
          </SelectField>
          <Field label="Fecha del día observado" type="date" max={today} value={f.date} onChange={(e) => set('date', e.target.value)} required />
          <SelectField label="Medida" value={f.measure} onChange={(e) => set('measure', e.target.value as CrowdMeasure)}>
            {CROWD_MEASURES.map((m) => <option key={m} value={m}>{CROWD_MEASURE_LABEL[m]}</option>)}
          </SelectField>
          <SelectField label="Dato" value={f.status} onChange={(e) => set('status', e.target.value as CrowdStatus)}>
            <option value="value">Cifra publicada (0 solo si la fuente confirma cero)</option>
            <option value="closed">Cierre confirmado, sin cifra</option>
          </SelectField>
          {f.status === 'value' && <Field label={`Cifra (${CROWD_UNIT[f.measure]})`} inputMode="numeric" value={f.value} onChange={(e) => set('value', e.target.value)} />}
          <SelectField label="Tipo de muestra" value={f.sample} onChange={(e) => set('sample', e.target.value as CrowdSample)}>
            {(Object.keys(CROWD_SAMPLE_LABEL) as CrowdSample[]).map((s) => <option key={s} value={s}>{CROWD_SAMPLE_LABEL[s]}</option>)}
          </SelectField>
        </div>
        <Field label="Enlace a la fuente (https)" type="url" value={f.sourceRef} onChange={(e) => set('sourceRef', e.target.value)} />
        <div className="filters">
          <Field label="Título de la fuente (opcional)" value={f.sourceTitle} onChange={(e) => set('sourceTitle', e.target.value)} />
          <Field label="Publicada el (opcional)" type="date" max={today} value={f.sourcePublished} onChange={(e) => set('sourcePublished', e.target.value)} />
        </div>
        <Field label="Nota pública (opcional): cita literal o contexto" value={f.note} onChange={(e) => set('note', e.target.value)} />
        <Field label="Motivo del cambio (solo administración)" value={f.reason} onChange={(e) => set('reason', e.target.value)} />
        {tried && errors.length > 0 && <ul className="notice notice-warn small" role="alert">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        {error && <p className="notice notice-warn small" role="alert">{error}</p>}
        <div className="row-wrap">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </section>
  );
}

function StateButton({ obs, onDone }: { obs: AdminObs; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = obs.state === 'active';
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/admin/crowds/${obs.id}/${withdraw ? 'withdraw' : 'restore'}`, { expectedVersion: obs.version, reason: reason.trim() });
      toast.show(withdraw ? 'Observación retirada: se conserva en el historial.' : 'Observación restaurada.');
      setOpen(false);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(true)}>{withdraw ? 'Retirar' : 'Restaurar'}</button>
      <ConfirmDialog open={open} title={withdraw ? 'Retirar observación' : 'Restaurar observación'} danger={withdraw} busy={busy} error={error}
        confirmLabel={withdraw ? 'Retirar' : 'Restaurar'} onClose={() => setOpen(false)} onConfirm={() => { if (reason.trim().length >= 5) void go(); else setError('Explica el motivo (mínimo 5 caracteres).'); }}
        body={<Field label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />} />
    </>
  );
}

function History({ id }: { id: number }) {
  const h = useResource(() => get<{ history: HistoryRow[] }>(`/api/admin/crowds/${id}/history`), [id]);
  if (h.loading && !h.data) return <Loading label="Cargando historial…" />;
  if (h.error && !h.data) return <ErrorState message={h.error} onRetry={h.reload} />;
  return (
    <ul className="small run-notes" aria-label="Historial">
      {h.data!.history.map((x) => (
        <li key={x.id}>{ACTION_LABEL[x.action] ?? x.action} · {instant(x.at)} · {x.actor ?? 'sistema'} · versión {x.version ?? '—'}
          {x.before && x.after && ` · ${JSON.stringify(x.before.value ?? x.before.status)} → ${JSON.stringify(x.after.value ?? x.after.status)}`} · motivo: {x.reason ?? '—'}</li>
      ))}
    </ul>
  );
}
