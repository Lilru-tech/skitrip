import { useState } from 'react';
import { ApiError, errorMessage, get, post } from '../api';
import { Dialog } from '../components/Dialog';
import { Empty, ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { euros, range, ROLE_LABEL, TRIP_STATUS_LABEL, plural } from '../format';
import { useBusy, useResource } from '../hooks';
import { Link, navigate, usePageTitle } from '../router';
import type { MyInvitation, Trip } from '../types';
import { emptyTripForm, formToPayload, TripForm, validateTripForm, type TripFormValues } from './TripForm';
import { GettingStarted, LegacyPendingNotice } from '../components/GettingStarted';

export function TripsPage() {
  usePageTitle('Mis viajes');
  const toast = useToast();
  const trips = useResource(() => get<{ trips: (Trip & { role: 'owner' | 'editor' | 'member' })[] }>('/api/trips'), []);
  const invs = useResource(() => get<{ invitations: MyInvitation[] }>('/api/trips/invitations/mine'), []);
  const { busy, run } = useBusy();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TripFormValues>(emptyTripForm);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [nightsErr, setNightsErr] = useState<string | null>(null);

  const create = async () => {
    const v = validateTripForm(form);
    if (v) { setFormErr(v); return; }
    setFormErr(null);
    setNightsErr(null);
    try {
      const r = await run('create', () => post<{ trip: Trip }>('/api/trips', formToPayload(form, false)));
      if (!r) return;
      toast.show('Viaje creado.');
      setCreating(false);
      setForm(emptyTripForm());
      navigate(`/viajes/${r.trip.id}`);
    } catch (e) {
      // Se conservan los datos del formulario para reintentar.
      if (e instanceof ApiError && e.code === 'nights_mismatch') setNightsErr(e.message);
      else setFormErr(errorMessage(e));
    }
  };

  const openCreate = () => { setFormErr(null); setNightsErr(null); setCreating(true); };

  const respond = async (inv: MyInvitation, action: 'accept' | 'decline') => {
    try {
      await run(`${action}:${inv.id}`, () => post(`/api/trips/invitations/${inv.id}/${action}`));
      toast.show(action === 'accept' ? `Te has unido a «${inv.trip_name}».` : 'Invitación rechazada.');
      await Promise.all([invs.reload(), trips.reload()]);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Mis viajes</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>Nuevo viaje</button>
      </div>

      <LegacyPendingNotice />
      {trips.data && <GettingStarted tripCount={trips.data.trips.length} onCreateTrip={openCreate} />}

      {invs.data && invs.data.invitations.length > 0 && (
        <section className="panel panel-accent stack" aria-labelledby="inv-h">
          <h2 id="inv-h">Invitaciones pendientes</h2>
          <ul className="list">
            {invs.data.invitations.map((i) => (
              <li key={i.id} className="list-row list-row-wrap">
                <span className="list-main"><strong>{i.trip_name}</strong> <span className="muted">· te invita {i.inviter_alias}</span></span>
                <span className="cluster-s">
                  <button type="button" className="btn btn-small btn-primary" disabled={busy !== null} onClick={() => void respond(i, 'accept')}>
                    {busy === `accept:${i.id}` ? 'Uniéndote…' : 'Aceptar'}<span className="visually-hidden"> invitación a {i.trip_name}</span>
                  </button>
                  <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null} onClick={() => void respond(i, 'decline')}>
                    Rechazar<span className="visually-hidden"> invitación a {i.trip_name}</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trips.loading && !trips.data && <Loading />}
      {trips.error && !trips.data && <ErrorState message={trips.error} onRetry={trips.reload} />}
      {trips.data && (trips.data.trips.length === 0 ? (
        <Empty title="Aún no tienes viajes">
          <p>Un viaje reúne al grupo: fechas en común, estación, alojamiento, presupuesto, compra y gastos. Créalo aunque falten datos, o acepta una invitación cuando te llegue.</p>
          <p><button type="button" className="btn btn-secondary" onClick={openCreate}>Crear el primer viaje</button></p>
        </Empty>
      ) : (
        <ul className="trip-list" aria-label="Tus viajes">
          {trips.data.trips.map((t) => (
            <li key={t.id} className="trip-card">
              <Link to={`/viajes/${t.id}`} className="trip-card-link">
                <span className="trip-card-name">{t.name}</span>
                <span className="trip-card-meta">
                  {t.startDate && t.endDate ? range(t.startDate, t.endDate) : 'Fechas por decidir'}
                  {t.nights != null && ` · ${plural(t.nights, 'noche', 'noches')}`}
                  {t.budgetCents != null && ` · ${euros(t.budgetCents)}/persona`}
                </span>
                <span className="cluster-s">
                  <span className="tag">{TRIP_STATUS_LABEL[t.status]}</span>
                  <span className="tag tag-quiet">{ROLE_LABEL[t.role]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ))}

      <Dialog open={creating} title="Nuevo viaje" onClose={() => setCreating(false)} busy={busy === 'create'} size="wide"
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)} disabled={busy === 'create'}>Cancelar</button>
          <button type="submit" form="trip-create" className="btn btn-primary" disabled={busy === 'create'} aria-busy={busy === 'create' || undefined}>
            {busy === 'create' ? 'Creando…' : 'Crear viaje'}
          </button>
        </>}>
        <TripForm id="trip-create" values={form} onChange={setForm} onSubmit={() => void create()} nightsError={nightsErr} />
        {formErr && <p className="form-error" role="alert">{formErr}</p>}
      </Dialog>
    </div>
  );
}
