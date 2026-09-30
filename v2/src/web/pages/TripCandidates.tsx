// Candidaturas de alojamiento y votos (uno por persona, se puede cambiar). Votar no es reservar.
import { useState } from 'react';
import { del, errorMessage, get, patch, post, put } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { euros, MODALITY_LABEL, parseEuros, PRICE_KIND_LABEL, UNIT_LABEL } from '../format';
import { useResource } from '../hooks';
import { useProfile } from '../session';
import type { TripDetail } from '../types';

export interface Candidate {
  id: string; title: string; modality: string; url: string | null; amount_cents: number | null; unit: string | null; price_kind: string | null;
  check_in: string | null; check_out: string | null; people: number | null; forfait_days: number | null; conditions: string | null; pending_notes: string | null;
  status: 'proposed' | 'chosen' | 'booked' | 'discarded'; proposed_by: string; proposed_by_alias: string; version: number; score: number; up: number; down: number; my_vote: 1 | -1 | null;
}
const STATUS_LABEL = { proposed: 'Propuesta', chosen: 'Elegida', booked: 'Reservada', discarded: 'Descartada' } as const;

export function TripCandidatesPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="candidaturas" title="Candidaturas y votos">{(d) => <Candidates tripId={tripId} detail={d} />}</TripShell>;
}

const emptyForm = { title: '', modality: 'lodging', url: '', amount: '', unit: 'per_person', checkIn: '', checkOut: '', people: '', forfaitDays: '', conditions: '', pendingNotes: '' };

function Candidates({ tripId, detail }: { tripId: string; detail: TripDetail }) {
  const me = useProfile();
  const toast = useToast();
  const r = useResource(() => get<{ candidates: Candidate[]; note: string }>(`/api/trips/${tripId}/candidates`), [tripId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Candidate | null>(null);
  const role = detail.trip.role;

  const vote = async (c: Candidate, v: 1 | -1) => {
    const value = c.my_vote === v ? null : v;
    setBusy(`vote:${c.id}`);
    try {
      await put(`/api/trips/${tripId}/candidates/${c.id}/vote`, { value });
      toast.show(value === null ? 'Voto retirado.' : value === 1 ? 'Voto a favor guardado.' : 'Voto en contra guardado.');
      await r.reload();
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const setStatus = async (c: Candidate, status: Candidate['status']) => {
    setBusy(`st:${c.id}`);
    try {
      await patch(`/api/trips/${tripId}/candidates/${c.id}`, { status, version: c.version });
      toast.show(`Estado: ${STATUS_LABEL[status]}.`);
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); await r.reload(); }
  };

  const create = async () => {
    if (!form) return;
    if (!form.title.trim()) { setFormErr('Pon un título.'); return; }
    const amount = parseEuros(form.amount);
    if (Number.isNaN(amount)) { setFormErr('Importe no válido.'); return; }
    if (form.url && !/^https?:\/\//.test(form.url)) { setFormErr('El enlace debe empezar por http:// o https://'); return; }
    setBusy('create'); setFormErr(null);
    try {
      const n = (s: string) => (s.trim() ? Number(s) : null);
      await post(`/api/trips/${tripId}/candidates`, {
        title: form.title.trim(), modality: form.modality, url: form.url || null, amountCents: amount, unit: amount != null ? form.unit : null,
        priceKind: amount != null ? 'user_quote' : null, checkIn: form.checkIn || null, checkOut: form.checkOut || null, people: n(form.people),
        forfaitDays: form.modality === 'lodging_forfait' ? n(form.forfaitDays) : null, conditions: form.conditions || null, pendingNotes: form.pendingNotes || null,
      });
      setForm(null);
      toast.show('Candidatura añadida.');
      await r.reload();
    } catch (e) { setFormErr(errorMessage(e)); } finally { setBusy(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy('del');
    try { await del(`/api/trips/${tripId}/candidates/${deleting.id}`); setDeleting(null); toast.show('Candidatura eliminada.'); await r.reload(); }
    catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  if (r.loading && !r.data) return <Loading />;
  if (r.error && !r.data) return <ErrorState message={r.error} onRetry={r.reload} />;
  const list = r.data!.candidates;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="notice notice-info"><strong>Votar no es reservar.</strong> {r.data!.note}</p>
        <button type="button" className="btn btn-primary" onClick={() => { setForm({ ...emptyForm, people: String(detail.trip.participantsPlanned ?? detail.members.length) }); setFormErr(null); }}>Nueva candidatura</button>
      </div>
      {list.length === 0 ? <Empty title="Aún no hay candidaturas"><p>Añade un alojamiento o paquete para que el grupo vote.</p></Empty> : (
        <ul className="card-list" aria-label="Candidaturas">
          {list.map((c) => {
            const canManage = c.proposed_by === me.id || role !== 'member';
            return (
              <li key={c.id} className={`card ${c.status === 'discarded' ? 'is-muted' : ''}`}>
                <div className="card-head"><h3>{c.title}</h3><span className={`tag ${c.status === 'booked' ? 'tag-ok' : c.status === 'discarded' ? 'tag-quiet' : ''}`}>{STATUS_LABEL[c.status]}</span></div>
                <p className="small">{MODALITY_LABEL[c.modality] ?? c.modality} · propone {c.proposed_by_alias}</p>
                <p>{c.amount_cents != null ? <><strong>{euros(c.amount_cents)}</strong> {c.unit ? UNIT_LABEL[c.unit] ?? c.unit : ''} {c.price_kind && <span className="tag tag-quiet">{PRICE_KIND_LABEL[c.price_kind] ?? c.price_kind}</span>}</> : <span className="muted">Sin precio</span>}</p>
                <p className="small muted">{c.check_in && c.check_out ? `${c.check_in} → ${c.check_out}` : 'Fechas sin indicar'}{c.people != null && ` · ${c.people} personas`}{c.forfait_days != null && ` · ${c.forfait_days} días de forfait`}</p>
                {c.conditions && <p className="small">Condiciones: {c.conditions}</p>}
                {c.pending_notes && <p className="small">Pendiente de confirmar: {c.pending_notes}</p>}
                {c.url && <a className="small" href={c.url} target="_blank" rel="noopener noreferrer nofollow">Ver enlace<span className="visually-hidden"> de {c.title} (otra pestaña)</span></a>}
                <div className="vote-row" role="group" aria-label={`Tu voto para ${c.title}`}>
                  <button type="button" className="btn btn-small btn-vote" aria-pressed={c.my_vote === 1} disabled={busy !== null} onClick={() => void vote(c, 1)}>A favor</button>
                  <button type="button" className="btn btn-small btn-vote" aria-pressed={c.my_vote === -1} disabled={busy !== null} onClick={() => void vote(c, -1)}>En contra</button>
                  <span className="small" aria-live="polite">{c.up} a favor · {c.down} en contra</span>
                </div>
                {canManage && (
                  <div className="cluster-s">
                    <label className="visually-hidden" htmlFor={`st-${c.id}`}>Estado de {c.title}</label>
                    <select id={`st-${c.id}`} className="select-small" value={c.status} disabled={busy !== null} onChange={(e) => void setStatus(c, e.target.value as Candidate['status'])}>
                      <option value="proposed">Propuesta</option>
                      {role !== 'member' && <option value="chosen">Elegida</option>}
                      {role !== 'member' && <option value="booked">Reservada</option>}
                      <option value="discarded">Descartada</option>
                    </select>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(c)}>Eliminar<span className="visually-hidden"> {c.title}</span></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={form !== null} title="Nueva candidatura" size="wide" onClose={() => setForm(null)} busy={busy === 'create'}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy === 'create'}>Cancelar</button>
          <button type="submit" form="cand-form" className="btn btn-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Guardando…' : 'Añadir'}</button>
        </>}>
        {form && (
          <form id="cand-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void create(); }} noValidate>
            <Field className="span-2" label="Título" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Por ejemplo: Apartamento en Soldeu" />
            <SelectField label="Modalidad" value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })}>
              <option value="lodging">Solo alojamiento</option><option value="lodging_forfait">Alojamiento + forfait</option>
            </SelectField>
            <Field label="Enlace" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <Field label="Importe (€)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <SelectField label="El importe es" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectField>
            <Field label="Entrada" type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            <Field label="Salida" type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            <Field label="Personas de la cotización" type="number" min={1} value={form.people} onChange={(e) => setForm({ ...form, people: e.target.value })} />
            {form.modality === 'lodging_forfait' && <Field label="Días de forfait incluidos" type="number" min={0} value={form.forfaitDays} onChange={(e) => setForm({ ...form, forfaitDays: e.target.value })} />}
            <Field className="span-2" label="Condiciones" value={form.conditions} maxLength={1000} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
            <Field className="span-2" label="Pendiente de confirmar" value={form.pendingNotes} maxLength={1000} onChange={(e) => setForm({ ...form, pendingNotes: e.target.value })} />
          </form>
        )}
        {formErr && <p className="form-error" role="alert">{formErr}</p>}
      </Dialog>
      <ConfirmDialog open={deleting !== null} title={`¿Eliminar «${deleting?.title ?? ''}»?`} body={<p>Se borran también sus votos.</p>} confirmLabel="Eliminar" danger busy={busy === 'del'}
        onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
    </div>
  );
}
