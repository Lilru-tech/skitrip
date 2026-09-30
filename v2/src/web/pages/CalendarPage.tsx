import { useEffect, useMemo, useState } from 'react';
import { errorMessage, get, put, qs } from '../api';
import { ErrorState, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import { useProfile } from '../session';
import type { CommonResponse, FriendsResponse, PublicUser, SharesResponse, Trip } from '../types';
import { seasons, type Selection } from '../calendar/dates';
import { MyAvailability } from '../calendar/MyAvailability';
import { GroupCalendar, RequirementNote, Unanswered, WindowsList } from '../calendar/GroupCalendar';
import { FiltersForm, type GroupFilters } from '../calendar/Filters';

const TABS = [
  { id: 'mia', label: 'Mi disponibilidad' },
  { id: 'grupo', label: 'Vista común' },
  { id: 'compartir', label: 'Compartir' },
] as const;

export function CalendarPage() {
  usePageTitle('Calendario');
  const { query } = useLocation();
  const tab = TABS.find((t) => t.id === query.get('vista'))?.id ?? 'mia';
  const all = useMemo(seasons, []);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const season = all[seasonIdx];

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>Calendario</h1>
        {tab !== 'compartir' && (
          <div className="field field-inline">
            <label htmlFor="season">Temporada</label>
            <select id="season" value={seasonIdx} onChange={(e) => setSeasonIdx(Number(e.target.value))}>
              {all.map((s, i) => <option key={s.start} value={i}>{s.label.replace('Temporada ', '')} (dic–abr)</option>)}
            </select>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Secciones del calendario">
        {TABS.map((t) => (
          <Link key={t.id} to={`/calendario?vista=${t.id}`} className="tab" aria-current={tab === t.id ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); setQuery('vista', t.id); }}>{t.label}</Link>
        ))}
      </nav>
      {tab === 'mia' && <MyAvailability season={season} />}
      {tab === 'grupo' && <CommonView from={season.start} to={season.end} />}
      {tab === 'compartir' && <SharingSettings />}
    </div>
  );
}

function CommonView({ from, to }: { from: string; to: string }) {
  const me = useProfile();
  const friends = useResource(() => get<FriendsResponse>('/api/friends'), []);
  const visible = useResource(() => get<{ users: PublicUser[] }>('/api/availability/visible'), []);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [filters, setFilters] = useState<GroupFilters>({ nights: 2, mode: 'all', min: 2 });
  const [data, setData] = useState<CommonResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const people = useMemo(() => {
    const m = new Map<string, { id: string; alias: string; shares: boolean }>();
    const vis = new Set((visible.data?.users ?? []).map((u) => u.id));
    for (const f of friends.data?.friends ?? []) m.set(f.id, { id: f.id, alias: f.alias, shares: vis.has(f.id) });
    for (const u of visible.data?.users ?? []) m.set(u.id, { id: u.id, alias: u.alias, shares: true });
    return [...m.values()].sort((a, b) => a.alias.localeCompare(b.alias, 'es'));
  }, [friends.data, visible.data]);

  // Por defecto: todas las personas que comparten conmigo.
  useEffect(() => {
    if (chosen === null && friends.data && visible.data) setChosen(new Set(people.filter((p) => p.shares).map((p) => p.id)));
  }, [chosen, friends.data, visible.data, people]);

  const aliasMap = useMemo(() => new Map([[me.id, `${me.alias} (tú)`], ...people.map((p) => [p.id, p.alias] as [string, string])]), [people, me]);
  const alias = (id: string) => aliasMap.get(id) ?? data?.people.find((p) => p.id === id)?.alias ?? 'Persona';
  const ids = chosen ? [...chosen].sort().join(',') : null;

  const load = async () => {
    if (ids === null) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await get<CommonResponse>(`/api/availability/common?${qs({ from, to, nights: filters.nights, min: filters.mode === 'min' ? filters.min : undefined, ids })}`);
      setData(r);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [ids, from, to, filters.nights, filters.mode, filters.min]);

  if ((friends.loading && !friends.data) || (visible.loading && !visible.data)) return <Loading />;
  if (friends.error || visible.error) return <ErrorState message={friends.error ?? visible.error ?? ''} onRetry={() => { void friends.reload(); void visible.reload(); }} />;

  const toggle = (id: string) => setChosen((c) => {
    const n = new Set(c ?? []);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="who-h">
        <h2 id="who-h">¿Con quién?</h2>
        {people.length === 0 ? (
          <p className="muted">Aún no puedes ver el calendario de nadie. <Link to="/amigos">Añade amigos</Link> y pídeles que compartan su disponibilidad contigo.</p>
        ) : (
          <fieldset className="people-picker">
            <legend className="visually-hidden">Personas en la vista común (tú siempre estás incluido)</legend>
            {people.map((p) => (
              <label key={p.id} className="chip">
                <input type="checkbox" checked={chosen?.has(p.id) ?? false} onChange={() => toggle(p.id)} />
                <span>{p.alias}{!p.shares && <span className="muted"> · no compartido</span>}</span>
              </label>
            ))}
          </fieldset>
        )}
        <FiltersForm value={filters} onChange={setFilters} maxPeople={(chosen?.size ?? 0) + 1} />
      </section>

      {err && <ErrorState message={err} onRetry={load} />}
      {loading && !data && <Loading label="Calculando la vista común…" />}
      {data && (
        <div className={loading ? 'is-refreshing' : undefined} aria-busy={loading || undefined}>
          <section className="stack" aria-labelledby="win-h">
            <h2 id="win-h">Ventanas candidatas <span className="muted small">(llegada → salida, {filters.nights} noches)</span></h2>
            <RequirementNote data={data} />
            <WindowsList windows={data.windows} alias={alias} />
          </section>
          <section className="panel stack" aria-labelledby="ans-h">
            <h2 id="ans-h">Quién falta por responder</h2>
            <Unanswered data={data} alias={alias} from={from} to={to} />
          </section>
          <section className="stack" aria-labelledby="grid-h">
            <h2 id="grid-h">Día a día</h2>
            <GroupCalendar idPrefix="common" data={data} alias={alias} from={from} to={to} selection={selection} onSelectionChange={setSelection} />
          </section>
        </div>
      )}
    </div>
  );
}

function SharingSettings() {
  const toast = useToast();
  const shares = useResource(() => get<SharesResponse>('/api/availability/shares'), []);
  const trips = useResource(() => get<{ trips: Trip[] }>('/api/trips'), []);
  const [friends, setFriends] = useState<boolean | null>(null);
  const [tripIds, setTripIds] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (shares.data && friends === null) {
      setFriends(shares.data.friends);
      setTripIds(new Set(shares.data.trips.map((t) => t.id)));
    }
  }, [shares.data, friends]);

  if ((shares.loading && !shares.data) || (trips.loading && !trips.data)) return <Loading />;
  if (shares.error || trips.error) return <ErrorState message={shares.error ?? trips.error ?? ''} onRetry={() => { void shares.reload(); void trips.reload(); }} />;

  const dirty = shares.data && (friends !== shares.data.friends || [...(tripIds ?? [])].sort().join() !== shares.data.trips.map((t) => t.id).sort().join());

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await put('/api/availability/shares', { friends: !!friends, tripIds: [...(tripIds ?? [])] });
      toast.show('Preferencias de compartición guardadas.');
      await shares.reload();
    } catch (e) {
      setErr(errorMessage(e)); // se mantienen las casillas marcadas para reintentar
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack page-narrow-inner" aria-labelledby="share-h">
      <h2 id="share-h">¿Quién puede ver tu disponibilidad?</h2>
      <p className="muted">Solo se comparten los estados de cada día (libre, quizá, ocupado o sin indicar). Nunca motivos ni eventos. Puedes retirarlo cuando quieras y deja de verse al instante.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="check">
          <input id="share-friends" type="checkbox" checked={!!friends} onChange={(e) => setFriends(e.target.checked)} />
          <label htmlFor="share-friends">Todas mis amistades</label>
        </div>
        <fieldset className="stack-s">
          <legend>Miembros de estos viajes</legend>
          {trips.data!.trips.length === 0 ? <p className="muted">No tienes viajes todavía.</p> : trips.data!.trips.map((t) => (
            <div className="check" key={t.id}>
              <input id={`share-${t.id}`} type="checkbox" checked={tripIds?.has(t.id) ?? false}
                onChange={(e) => setTripIds((s) => { const n = new Set(s ?? []); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />
              <label htmlFor={`share-${t.id}`}>{t.name}</label>
            </div>
          ))}
        </fieldset>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div><button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </section>
  );
}
