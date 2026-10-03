import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, get, post, put, qs } from '../api';
import { Field } from '../components/Field';
import { ErrorState, Loading, Empty } from '../components/States';
import { useToast } from '../components/Toast';
import { dayShort, plural } from '../format';
import { useResource } from '../hooks';
import { Link, usePageTitle } from '../router';
import { useProfile } from '../session';
import type { CandidateWindow, Proposal, SharesResponse, TripCalendarResponse, TripDetail } from '../types';
import { daysBetween, seasons, type Selection } from '../calendar/dates';
import { GroupCalendar, RequirementNote, Unanswered, WindowsList } from '../calendar/GroupCalendar';
import { FiltersForm, type GroupFilters } from '../calendar/Filters';
import { TripTabs } from '../components/TripTabs';

const VOTE_LABEL = { yes: 'Sí', maybe: 'Quizá', no: 'No' } as const;
type Vote = keyof typeof VOTE_LABEL;

export function TripCalendarPage({ tripId }: { tripId: string }) {
  const me = useProfile();
  const toast = useToast();
  const detail = useResource(() => get<TripDetail>(`/api/trips/${tripId}`), [tripId]);
  const shares = useResource(() => get<SharesResponse>('/api/availability/shares'), []);
  usePageTitle(detail.data ? `Calendario · ${detail.data.trip.name}` : 'Calendario del viaje');

  const all = useMemo(seasons, []);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const season = all[seasonIdx];
  const [filters, setFilters] = useState<GroupFilters | null>(null);
  const [data, setData] = useState<TripCalendarResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [propStart, setPropStart] = useState('');
  const [propEnd, setPropEnd] = useState('');
  const [propErr, setPropErr] = useState<string | null>(null);

  // Noches por defecto: las del viaje si están definidas.
  useEffect(() => {
    if (detail.data && !filters) setFilters({ nights: detail.data.trip.nights ?? 2, mode: 'all', min: 2 });
  }, [detail.data, filters]);

  const load = async () => {
    if (!filters) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await get<TripCalendarResponse>(`/api/availability/trip/${tripId}?${qs({ from: season.start, to: season.end, nights: filters.nights, min: filters.mode === 'min' ? filters.min : undefined })}`);
      setData(r);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [tripId, season.start, season.end, filters?.nights, filters?.mode, filters?.min]);

  const aliasMap = useMemo(() => new Map((data?.members ?? detail.data?.members ?? []).map((m) => [m.id, m.id === me.id ? `${m.alias} (tú)` : m.alias])), [data, detail.data, me]);
  const alias = (id: string) => aliasMap.get(id) ?? 'Exmiembro';

  if (detail.loading && !detail.data) return <div className="page"><Loading /></div>;
  if (detail.error && !detail.data) return <div className="page"><h1>Calendario del viaje</h1><ErrorState message={detail.error} onRetry={detail.reload} /></div>;
  const trip = detail.data!.trip;
  const sharingHere = shares.data ? shares.data.friends || shares.data.trips.some((t) => t.id === tripId) : null;

  const shareWithTrip = async () => {
    if (!shares.data) return;
    setBusy('share');
    try {
      await put('/api/availability/shares', { friends: shares.data.friends, tripIds: [...new Set([...shares.data.trips.map((t) => t.id as string), tripId])] });
      toast.show('Ahora los miembros de este viaje pueden ver tu disponibilidad.');
      await Promise.all([shares.reload(), load()]);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const propose = async (start: string, end: string) => {
    setBusy(`prop:${start}:${end}`);
    setPropErr(null);
    try {
      await post(`/api/availability/trip/${tripId}/proposals`, { start, end });
      toast.show(`Fechas propuestas: ${dayShort(start)} → ${dayShort(end)}.`);
      setSelection(null);
      await load();
      return true;
    } catch (e) {
      toast.show(errorMessage(e), 'error');
      setPropErr(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const vote = async (p: Proposal, value: Vote | null) => {
    setBusy(`vote:${p.id}`);
    try {
      await put(`/api/availability/trip/${tripId}/proposals/${p.id}/vote`, { value });
      await load();
      toast.show(value ? `Voto guardado: ${VOTE_LABEL[value]}.` : 'Voto retirado.');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const submitProposal = async (e: FormEvent) => {
    e.preventDefault();
    if (!propStart || !propEnd) { setPropErr('Indica la llegada y la salida.'); return; }
    if (propEnd < propStart) { setPropErr('La salida no puede ser anterior a la llegada.'); return; }
    if (daysBetween(propStart, propEnd) > 30) { setPropErr('Como máximo 30 noches.'); return; }
    if (await propose(propStart, propEnd)) { setPropStart(''); setPropEnd(''); }
  };

  const windowAction = (w: CandidateWindow) => {
    const exists = data?.proposals.some((p) => p.start_date === w.start && p.end_date === w.end);
    return exists ? <span className="muted small">Ya propuesta</span> : (
      <button type="button" className="btn btn-small btn-secondary" disabled={busy !== null} onClick={() => void propose(w.start, w.end)}>
        Proponer<span className="visually-hidden"> {dayShort(w.start)} a {dayShort(w.end)}</span>
      </button>
    );
  };


  return (
    <div className="page page-wide">
      <p className="breadcrumb"><Link to="/viajes">Mis viajes</Link> <span aria-hidden="true">/</span> <Link to={`/viajes/${tripId}`}>{trip.name}</Link></p>
      <div className="page-head">
        <h1>Calendario del viaje</h1>
        <div className="field field-inline">
          <label htmlFor="trip-season">Temporada</label>
          <select id="trip-season" value={seasonIdx} onChange={(e) => setSeasonIdx(Number(e.target.value))}>
            {all.map((s, i) => <option key={s.start} value={i}>{s.label.replace('Temporada ', '')} (dic–abr)</option>)}
          </select>
        </div>
      </div>

      <TripTabs tripId={tripId} current="calendario" />

      {sharingHere === false && (
        <div className="notice notice-info cluster">
          <p>Los miembros de este viaje solo ven tu disponibilidad si la compartes (con este viaje o con todas tus amistades).</p>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void shareWithTrip()} disabled={busy !== null}>
            {busy === 'share' ? 'Compartiendo…' : 'Compartir con este viaje'}
          </button>
        </div>
      )}

      <section className="panel stack" aria-labelledby="filters-h">
        <h2 id="filters-h" className="visually-hidden">Filtros</h2>
        {filters && <FiltersForm value={filters} onChange={setFilters} maxPeople={detail.data!.members.length} />}
        <p className="muted small">Miembros: {detail.data!.members.map((m) => alias(m.id)).join(', ')}. <Link to="/calendario">Editar mi disponibilidad</Link></p>
      </section>

      {err && <ErrorState message={err} onRetry={load} />}
      {loading && !data && <Loading label="Calculando fechas en común…" />}
      {data && (
        <div className={loading ? 'is-refreshing' : undefined} aria-busy={loading || undefined}>
          <section className="stack" aria-labelledby="w-h">
            <h2 id="w-h">Ventanas candidatas <span className="muted small">(llegada → salida, {filters?.nights} noches)</span></h2>
            <RequirementNote data={data} />
            <WindowsList windows={data.windows} alias={alias} action={windowAction} />
          </section>

          <section className="panel stack" aria-labelledby="p-h">
            <h2 id="p-h">Propuestas de fechas</h2>
            {data.proposals.length === 0 ? (
              <Empty title="Todavía no hay propuestas"><p>Propón una ventana candidata o elige fechas abajo.</p></Empty>
            ) : (
              <ul className="list">
                {data.proposals.map((p) => {
                  const mine = p.votes.find((v) => v.userId === me.id)?.value ?? null;
                  const count = (v: Vote) => p.votes.filter((x) => x.value === v);
                  return (
                    <li key={p.id} className="proposal">
                      <div className="proposal-head">
                        <p><strong>{dayShort(p.start_date)} → {dayShort(p.end_date)}</strong> · {plural(daysBetween(p.start_date, p.end_date), 'noche', 'noches')} <span className="muted">· propone {alias(p.proposed_by) === 'Exmiembro' ? p.proposed_by_alias : alias(p.proposed_by)}</span></p>
                        <div className="vote-buttons" role="group" aria-label={`Tu voto para ${dayShort(p.start_date)} a ${dayShort(p.end_date)}`}>
                          {(Object.keys(VOTE_LABEL) as Vote[]).map((v) => (
                            <button key={v} type="button" className={`btn btn-small btn-vote vote-${v}`} aria-pressed={mine === v} disabled={busy !== null}
                              onClick={() => void vote(p, mine === v ? null : v)}>{VOTE_LABEL[v]}</button>
                          ))}
                        </div>
                      </div>
                      <p className="small">
                        {(Object.keys(VOTE_LABEL) as Vote[]).map((v) => {
                          const vs = count(v);
                          return <span key={v} className="vote-count">{VOTE_LABEL[v]}: {vs.length}{vs.length > 0 && ` (${vs.map((x) => alias(x.userId)).join(', ')})`}</span>;
                        })}
                        <span className="vote-count muted">Sin votar: {Math.max(0, data.members.length - p.votes.length)}</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="form-row form-row-end" onSubmit={submitProposal} noValidate>
              <Field label="Llegada" type="date" value={propStart} min={season.start} max={season.end} onChange={(e) => setPropStart(e.target.value)} />
              <Field label="Salida" type="date" value={propEnd} min={propStart || season.start} max={season.end} onChange={(e) => setPropEnd(e.target.value)} />
              <button type="submit" className="btn btn-secondary" disabled={busy !== null}>Proponer fechas</button>
            </form>
            {propErr && <p className="form-error" role="alert">{propErr}</p>}
          </section>

          <section className="panel stack" aria-labelledby="ua-h">
            <h2 id="ua-h">Quién falta por responder</h2>
            <Unanswered data={data} alias={alias} from={season.start} to={season.end} />
          </section>

          <section className="stack" aria-labelledby="d-h">
            <h2 id="d-h">Día a día</h2>
            <GroupCalendar idPrefix="trip" data={data} alias={alias} from={season.start} to={season.end} selection={selection} onSelectionChange={setSelection}
              selectionActions={([a, b]) => a !== b && !selection?.pending ? (
                <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void propose(a, b)}>
                  Proponer {dayShort(a)} → {dayShort(b)}
                </button>
              ) : null} />
          </section>
        </div>
      )}
    </div>
  );
}
