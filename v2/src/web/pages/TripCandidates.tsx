// Candidaturas de alojamiento y votos (uno por persona, se puede cambiar). Votar no es reservar.
import { useEffect, useState } from 'react';
import { del, errorMessage, get, patch, post, put } from '../api';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Field, SelectField } from '../components/Field';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { TripShell } from '../components/TripTabs';
import { agesText, euros, humanDates, MODALITY_LABEL, parseAges, parseEuros, PRICE_KIND_LABEL, UNIT_LABEL } from '../format';
import type { Catalog } from '../catalog';
import { useResource } from '../hooks';
import { useProfile } from '../session';
import { setQuery, useLocation } from '../router';
import type { TripDetail } from '../types';

export interface Candidate {
  id: string; title: string; modality: string; url: string | null; amount_cents: number | null; unit: string | null; price_kind: string | null;
  check_in: string | null; check_out: string | null; people: number | null; forfait_days: number | null; conditions: string | null; pending_notes: string | null;
  area_id?: string | null; adults?: number | null; children_ages?: string | null; rooms?: number | null; forfait_included?: 'yes' | 'no' | 'unknown' | null;
  status: 'proposed' | 'chosen' | 'booked' | 'discarded'; proposed_by: string; proposed_by_alias: string; version: number; score: number; up: number; down: number; my_vote: 1 | -1 | null;
}
const STATUS_LABEL = { proposed: 'Propuesta', chosen: 'Elegida', booked: 'Reservada', discarded: 'Descartada' } as const;
const FORFAIT_LABEL = { yes: 'incluye forfait', no: 'sin forfait', unknown: 'no consta si incluye forfait' } as const;

const kidsOf = (c: Candidate): number[] | null => { try { return c.children_ages ? JSON.parse(c.children_ages) : null; } catch { return null; } };

/** Condiciones declaradas de la cotización, tal cual (null = no consta). */
function conditionsText(c: Candidate) {
  const parts: string[] = [];
  parts.push(c.check_in && c.check_out ? `${humanDates(c.check_in)} → ${humanDates(c.check_out)}` : 'fechas sin indicar');
  if (c.adults != null) parts.push(`${c.adults} adulto(s)`); else if (c.people != null) parts.push(`${c.people} personas`); else parts.push('ocupación sin indicar');
  const kids = kidsOf(c);
  if (kids) parts.push(kids.length ? `menores de ${agesText(kids)}` : 'sin menores');
  if (c.rooms != null) parts.push(`${c.rooms} hab.`);
  if (c.forfait_included) parts.push(FORFAIT_LABEL[c.forfait_included]);
  if (c.forfait_days != null) parts.push(`${c.forfait_days} días de forfait`);
  return parts.join(' · ');
}

export function TripCandidatesPage({ tripId }: { tripId: string }) {
  return <TripShell tripId={tripId} tab="candidaturas" title="Candidaturas y votos">{(d) => <Candidates tripId={tripId} detail={d} />}</TripShell>;
}

const emptyForm = { title: '', modality: 'lodging', url: '', amount: '', unit: 'per_person', priceKind: 'user_quote', areaId: '', checkIn: '', checkOut: '',
  adults: '', children: '', rooms: '', forfaitIncluded: 'no', forfaitDays: '', conditions: '', pendingNotes: '',
  ownForfait: '', ownRental: '', ownTolls: '', ownParking: '', costsNote: '' };
type CandForm = typeof emptyForm;

/** Formulario precargado con las condiciones del viaje (se corrigen si la cotización es para otras). */
export function candidateFormFor(d: TripDetail, over: Partial<CandForm> = {}): CandForm {
  const t = d.trip;
  const kids = t.childrenAges ?? [];
  const people = t.participantsPlanned ?? d.members.length;
  return { ...emptyForm, areaId: t.areaId ?? '', checkIn: t.startDate ?? '', checkOut: t.endDate ?? '', adults: people ? String(Math.max(1, people - kids.length)) : '',
    children: kids.join(', '), rooms: t.rooms?.toString() ?? '', ...over };
}

function Candidates({ tripId, detail }: { tripId: string; detail: TripDetail }) {
  const me = useProfile();
  const toast = useToast();
  const r = useResource(() => get<{ candidates: Candidate[]; note: string }>(`/api/trips/${tripId}/candidates`), [tripId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<CandForm | null>(null);
  const [deleting, setDeleting] = useState<Candidate | null>(null);
  const role = detail.trip.role;
  // Desde la ficha de una estación («Apuntar cotización»): abre el formulario con la estación elegida, una sola vez.
  const quoteArea = useLocation().query.get('cotizar');
  useEffect(() => {
    if (!quoteArea) return;
    setForm(candidateFormFor(detail, { areaId: quoteArea, priceKind: 'user_quote' }));
    setQuery('cotizar', null);
  }, [quoteArea, detail]);

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
        <button type="button" className="btn btn-primary" onClick={() => setForm(candidateFormFor(detail))}>Nueva candidatura</button>
      </div>
      {list.length === 0 ? <Empty title="Aún no hay candidaturas"><p>Añade un alojamiento o paquete para que el grupo vote.</p></Empty> : (
        <ul className="card-list" aria-label="Candidaturas">
          {list.map((c) => {
            const canManage = c.proposed_by === me.id || role !== 'member';
            return (
              <li key={c.id} className={`card ${c.status === 'discarded' ? 'is-muted' : ''} ${c.price_kind === 'manual_estimate' ? 'is-estimate' : ''}`}>
                <div className="card-head"><h3>{c.title}</h3><span className={`tag ${c.status === 'booked' ? 'tag-ok' : c.status === 'discarded' ? 'tag-quiet' : ''}`}>{STATUS_LABEL[c.status]}</span></div>
                <p className="small">{c.forfait_included === 'unknown' ? 'Alojamiento (forfait sin confirmar)' : MODALITY_LABEL[c.modality] ?? c.modality} · propone {c.proposed_by_alias}</p>
                <p>{c.amount_cents != null ? <><strong>{c.price_kind === 'manual_estimate' ? '≈ ' : ''}{euros(c.amount_cents)}</strong> {c.unit ? UNIT_LABEL[c.unit] ?? c.unit : ''} {c.price_kind === 'manual_estimate'
                  ? <span className="tag tag-estimate">Estimación manual, no es una cotización</span>
                  : c.price_kind && <span className="tag tag-quiet">{PRICE_KIND_LABEL[c.price_kind] ?? c.price_kind}</span>}</> : <span className="muted">Sin precio</span>}</p>
                <p className="small muted">{conditionsText(c)}</p>
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

      <CandidateDialog tripId={tripId} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void r.reload(); }} />
      <ConfirmDialog open={deleting !== null} title={`¿Eliminar «${deleting?.title ?? ''}»?`} body={<p>Se borran también sus votos.</p>} confirmLabel="Eliminar" danger busy={busy === 'del'}
        onConfirm={() => void doDelete()} onClose={() => setDeleting(null)} />
    </div>
  );
}

/**
 * Alta de candidatura / cotización manual con sus condiciones exactas. Reutilizable (Búsquedas → «Guardar cotización manual»).
 * `initial` null = cerrado.
 */
export function CandidateDialog({ tripId, initial, onClose, onSaved, title = 'Nueva candidatura' }: {
  tripId: string; initial: CandForm | null; onClose: () => void; onSaved: () => void; title?: string;
}) {
  const toast = useToast();
  const catalog = useResource(() => get<Catalog>('/api/public/catalog'), []);
  const [form, setForm] = useState<CandForm | null>(initial);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setForm(initial); setFormErr(null); }

  const create = async () => {
    if (!form) return;
    if (!form.title.trim()) { setFormErr('Pon un título.'); return; }
    const amount = parseEuros(form.amount);
    if (Number.isNaN(amount)) { setFormErr('Importe no válido.'); return; }
    if (form.url && !/^https?:\/\//.test(form.url)) { setFormErr('El enlace debe empezar por http:// o https://'); return; }
    const kids = parseAges(form.children);
    if (!kids) { setFormErr('Edades de menores: números de 0 a 17 separados por comas.'); return; }
    if (form.checkIn && form.checkOut && form.checkOut <= form.checkIn) { setFormErr('La salida debe ser posterior a la entrada.'); return; }
    if (form.priceKind === 'manual_estimate' && amount == null) { setFormErr('Una estimación manual necesita un importe.'); return; }
    const own = { forfait: parseEuros(form.ownForfait), rental: parseEuros(form.ownRental), tolls: parseEuros(form.ownTolls), parking: parseEuros(form.ownParking) };
    if (Object.values(own).some((v) => Number.isNaN(v))) { setFormErr('Costes propios: importe no válido.'); return; }
    setBusy('create'); setFormErr(null);
    try {
      const n = (s: string) => (s.trim() ? Number(s) : null);
      await post(`/api/trips/${tripId}/candidates`, {
        title: form.title.trim(), modality: form.modality, url: form.url || null, amountCents: amount, unit: amount != null ? form.unit : null,
        priceKind: amount != null ? form.priceKind : null, areaId: form.areaId || null, checkIn: form.checkIn || null, checkOut: form.checkOut || null,
        adults: n(form.adults), childrenAges: kids, rooms: n(form.rooms), forfaitIncluded: form.forfaitIncluded,
        forfaitDays: form.forfaitIncluded === 'yes' ? n(form.forfaitDays) : null, conditions: form.conditions || null, pendingNotes: form.pendingNotes || null,
        forfaitCentsPerDay: own.forfait, rentalCentsPerDay: own.rental, tollsCentsPerCar: own.tolls, parkingCentsPerCar: own.parking, costsNote: form.costsNote.trim() || null,
      });
      toast.show(form.priceKind === 'manual_estimate' && amount != null ? 'Estimación manual añadida.' : 'Candidatura añadida.');
      onSaved();
    } catch (e) { setFormErr(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <Dialog open={initial !== null} title={title} size="wide" onClose={onClose} busy={busy === 'create'}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy === 'create'}>Cancelar</button>
        <button type="submit" form="cand-form" className="btn btn-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Guardando…' : 'Añadir'}</button>
      </>}>
      {form && (
        <form id="cand-form" className="form-grid" onSubmit={(e) => { e.preventDefault(); void create(); }} noValidate>
          <Field className="span-2" label="Título" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Por ejemplo: Apartamento en Soldeu" />
          <SelectField label="Modalidad" value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value, forfaitIncluded: e.target.value === 'lodging_forfait' ? 'yes' : 'no' })}>
            <option value="lodging">Solo alojamiento</option><option value="lodging_forfait">Alojamiento + forfait</option>
          </SelectField>
          <Field label="Enlace" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <Field label="Importe (€)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <SelectField label="El importe es" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectField>
          <fieldset className="span-2 choice-group">
            <legend>Tipo de precio</legend>
            <div className="check"><input id="ck-quote" type="radio" name="ck-kind" checked={form.priceKind === 'user_quote'} onChange={() => setForm({ ...form, priceKind: 'user_quote' })} />
              <label htmlFor="ck-quote">Cotización obtenida para estas condiciones</label></div>
            <div className="check"><input id="ck-est" type="radio" name="ck-kind" checked={form.priceKind === 'manual_estimate'} onChange={() => setForm({ ...form, priceKind: 'manual_estimate' })} />
              <label htmlFor="ck-est">Estimación manual (no es una cotización; se suma aparte y no completa el presupuesto)</label></div>
          </fieldset>
          <p className="span-2 small muted">Condiciones exactas de la cotización. Vienen del viaje: cámbialas si el precio es para otras.</p>
          <SelectField label="Estación" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
            <option value="">Sin indicar</option>
            {(catalog.data?.areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            {form.areaId && !catalog.data?.areas.some((a) => a.id === form.areaId) && <option value={form.areaId}>{form.areaId}</option>}
          </SelectField>
          <Field label="Entrada" type="date" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
          <Field label="Salida" type="date" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
          <Field label="Adultos de la cotización" type="number" min={1} max={60} value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value })} hint="Vacío = no consta" />
          <Field label="Edades de menores de la cotización" inputMode="numeric" value={form.children} onChange={(e) => setForm({ ...form, children: e.target.value })} hint="Separadas por comas. Vacío = sin menores" />
          <Field label="Habitaciones de la cotización" type="number" min={1} max={30} value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} hint="Vacío = no consta" />
          <SelectField label="¿Incluye forfait?" value={form.forfaitIncluded} onChange={(e) => setForm({ ...form, forfaitIncluded: e.target.value })}>
            <option value="yes">Sí</option><option value="no">No</option><option value="unknown">No consta</option>
          </SelectField>
          {form.forfaitIncluded === 'yes' && <Field label="Días de forfait incluidos" type="number" min={0} value={form.forfaitDays} onChange={(e) => setForm({ ...form, forfaitDays: e.target.value })} />}
          <Field className="span-2" label="Condiciones" value={form.conditions} maxLength={1000} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
          <Field className="span-2" label="Pendiente de confirmar" value={form.pendingNotes} maxLength={1000} onChange={(e) => setForm({ ...form, pendingNotes: e.target.value })} />
          <fieldset className="span-2 form-grid">
            <legend>Costes propios de esta opción (opcional)</legend>
            <p className="span-2 small muted">Solo si difieren de los de su estación, p. ej. parking incluido (0 €). Vacío = se usan los de la estación.</p>
            <Field label="Forfait por día y persona (€)" inputMode="decimal" value={form.ownForfait} onChange={(e) => setForm({ ...form, ownForfait: e.target.value })} />
            <Field label="Alquiler por día y persona (€)" inputMode="decimal" value={form.ownRental} onChange={(e) => setForm({ ...form, ownRental: e.target.value })} />
            <Field label="Peajes por coche, ida y vuelta (€)" inputMode="decimal" value={form.ownTolls} onChange={(e) => setForm({ ...form, ownTolls: e.target.value })} />
            <Field label="Parking por coche, estancia (€)" inputMode="decimal" value={form.ownParking} onChange={(e) => setForm({ ...form, ownParking: e.target.value })} />
            <Field className="span-2" label="Nota de los costes" maxLength={300} value={form.costsNote} onChange={(e) => setForm({ ...form, costsNote: e.target.value })} />
          </fieldset>
        </form>
      )}
      {formErr && <p className="form-error" role="alert">{formErr}</p>}
    </Dialog>
    </>
  );
}
