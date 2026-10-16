// Comparar estaciones: distancia por carretera (sin inventar la que falta), estado de apertura separado de la
// actualidad del dato, dominios con sus estaciones miembro (sin contar dos veces) y puntuación con pesos editables.
// Dos contextos: «Esquiar ahora» (solo recomienda estaciones con apertura confirmada) y «Planificar un viaje» (compara
// todas; el estado de hoy no predice las fechas del viaje).
import { useMemo, useState } from 'react';
import { get, post } from '../api';
import { Freshness, ReportDate, StatusBadge } from '../components/Badges';
import { ErrorState, Loading, Empty } from '../components/States';
import { AREA_KIND_LABEL, centsToInput, euros, kmText, MODALITY_LABEL, parseEuros, plural, range } from '../format';
import { useKeyedResource, useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import { topLevel, type Catalog, type CatalogArea } from '../catalog';
import { DEFAULT_WEIGHTS, scoreRows, type Weights } from '../../core/score';
import { combineStatus, costsByArea, countStatuses, noOpenNotice, RESORT_STATUS_LABEL, resortStatus, snowStateText, tripCostMissing, type AreaCost, type CostByAreaInput, type ResortStatusInfo, type StatusCounts } from '../../core/compare';
import type { Trip } from '../types';
import { routeProvenance } from '../../core/legacy';
import { OriginPicker } from '../components/OriginPicker';
import { customRouteMap, setCustomOrigin, useCustomOrigin } from '../origin';
import type { LegacyComment } from '../catalog';

type Mode = 'lodging' | 'lodging_forfait';
type Context = 'plan' | 'ahora';
/** Km que puntúan en «Nieve abierta ahora»: solo los del dato elegido si es reciente y fiable (snow.rank), nunca snow.openKm tal cual. */
const snowRankKm = (a: CatalogArea) => (a.snow?.rank ? a.snow.rank.openKm : null);
const WEIGHT_LABEL: Record<keyof Weights, string> = { snowNow: 'Nieve abierta ahora', size: 'Km de pistas', distance: 'Cercanía', vibe: 'Ambiente', cost: 'Coste' };
const SLIDERS: (keyof Weights)[] = ['snowNow', 'size', 'distance', 'vibe'];
// El coste solo puntúa con un viaje elegido y presupuestos completos (mismas fechas y condiciones); sin eso, su peso
// efectivo es 0. Al planificar, la nieve de hoy no puntúa por defecto (no dice nada de las fechas del viaje).
const INITIAL_WEIGHTS: Record<Context, Weights> = { plan: { ...DEFAULT_WEIGHTS, snowNow: 0 }, ahora: { ...DEFAULT_WEIGHTS } };

/** Estado de una entrada de primer nivel: su propio parte o, en un dominio sin parte, el de sus estaciones. */
function entryStatus(area: CatalogArea, members: CatalogArea[], nowMs: number): ResortStatusInfo {
  if (area.snow || members.length === 0) return resortStatus(area.snow, nowMs);
  return combineStatus(members.map((m) => resortStatus(m.snow, nowMs)));
}

export function ComparePage() {
  usePageTitle('Comparar');
  const { query } = useLocation();
  const originQ = query.get('origen');
  const origin = originQ === 'sabadell' || originQ === 'personal' ? originQ : 'tarragona';
  // Origen personalizado: el catálogo se pide sin rutas propias (base Tarragona) y sus rutas se sustituyen por las
  // calculadas para el punto elegido; sin punto confirmado no se muestra ninguna distancia como si fuera suya.
  const custom = useCustomOrigin();
  const customRoutes = useMemo(() => (origin === 'personal' && custom && custom.routes.length ? customRouteMap(custom) : null), [origin, custom]);
  const fixedOrigin = origin === 'personal' ? 'tarragona' : origin;
  const mode: Mode = query.get('modalidad') === 'lodging_forfait' ? 'lodging_forfait' : 'lodging';
  const ctx: Context = query.get('contexto') === 'ahora' ? 'ahora' : 'plan';
  const catalog = useResource(() => get<Catalog>(`/api/public/catalog?origin=${fixedOrigin}`), [fixedOrigin]);
  const [maxKmText, setMaxKmText] = useState('300');
  const maxKm = Math.max(0, Number(maxKmText) || 0);
  const [weightsBy, setWeightsBy] = useState(INITIAL_WEIGHTS);
  const setWeights = (w: Weights) => setWeightsBy((all) => ({ ...all, [ctx]: w }));

  // Coste por persona de un viaje: presupuestos completos de sus candidaturas, calculados cada uno en su estación.
  const tripId = query.get('viaje');
  const trips = useResource(() => get<{ trips: Trip[] }>('/api/trips').catch(() => ({ trips: [] as Trip[] })), []);
  const trip = trips.data?.trips.find((t) => t.id === tripId) ?? null;
  // Transporte del coste desde la salida elegida arriba. Desde una salida distinta de la del viaje, los peajes guardados
  // no valen: quedan pendientes salvo que se indiquen aquí para esa salida.
  const tripOrigin = trip?.originId ?? 'tarragona';
  const otherOrigin = !!trip && origin !== tripOrigin;
  const [fixedTolls, setFixedTolls] = useState<Record<string, number | null>>({});
  const tolls = origin === 'personal' ? custom?.tollsCentsPerCar ?? null : fixedTolls[origin] ?? null;
  const setTolls = (v: number | null) => (origin === 'personal' ? custom && setCustomOrigin({ ...custom, tollsCentsPerCar: v }) : setFixedTolls((t) => ({ ...t, [origin]: v })));
  const roadsKey = customRoutes ? `${custom!.lat},${custom!.lon},${custom!.checkedOn}` : '';
  // Los costes van ligados a la selección que los pidió (viaje, versión, salida, rutas y peajes): al cambiarla no se
  // reutilizan los anteriores; hasta que llegue la respuesta nueva (o si falla) el coste queda pendiente.
  const costKey = !trip || (origin === 'personal' && !customRoutes) ? null : JSON.stringify([trip.id, trip.version, origin, roadsKey, tolls]);
  const costs = useKeyedResource(costKey, () => {
    if (!trip) return Promise.resolve(null);
    const path = `/api/trips/${trip.id}/cost-comparison`;
    if (origin === 'personal') {
      if (!custom || !customRoutes) return Promise.resolve(null);
      return post<{ options: CostByAreaInput[] }>(path, { roads: Object.fromEntries(custom.routes.map((r) => [r.areaId, r.roadKm])), tollsCentsPerCar: tolls });
    }
    return otherOrigin ? post<{ options: CostByAreaInput[] }>(path, { originId: origin, tollsCentsPerCar: tolls }) : get<{ options: CostByAreaInput[] }>(path);
  });
  const costByArea = useMemo(() => {
    if (!trip || !costs.data || !catalog.data) return null;
    const parentOf = new Map(catalog.data.links.map((l) => [l.child_id, l.parent_id]));
    return costsByArea(costs.data.options, (id) => parentOf.get(id) ?? id);
  }, [trip, costs.data, catalog.data]);
  const tripMissing = trip ? tripCostMissing(trip) : [];
  const anyComplete = !!costByArea && [...costByArea.values()].some((c) => c.perPersonCents != null);
  const costActive = !!trip && tripMissing.length === 0 && anyComplete;
  const weights: Weights = costActive ? weightsBy[ctx] : { ...weightsBy[ctx], cost: 0 };

  const groups = useMemo(() => {
    if (!catalog.data) return null;
    const nowMs = Date.now();
    if (origin === 'personal' && !customRoutes) return null;
    const withRoute = (a: CatalogArea): CatalogArea => (customRoutes ? { ...a, route: customRoutes.get(a.id) ?? null } : a);
    const entries = topLevel(catalog.data).map((e) => ({ area: withRoute(e.area), members: e.members.map(withRoute), status: entryStatus(e.area, e.members, nowMs) }));
    const near = entries.filter((e) => e.area.route?.roadKm != null && e.area.route.roadKm <= maxKm);
    const far = entries.filter((e) => e.area.route?.roadKm != null && e.area.route.roadKm > maxKm);
    const noRoute = entries.filter((e) => e.area.route?.roadKm == null);
    // «Esquiar ahora»: solo se puntúan y recomiendan las abiertas confirmadas; el resto se lista aparte, sin puntuar.
    const candidates = ctx === 'ahora' ? near.filter((e) => e.status.status === 'open') : near;
    const scored = scoreRows(candidates.map((e) => ({
      id: e.area.id, costPerPersonCents: costActive ? costByArea?.get(e.area.id)?.perPersonCents ?? null : null, roadKm: e.area.route?.roadKm ?? null,
      totalKm: e.area.snow?.totalKm ?? e.area.officialTotalKm, openKmNow: snowRankKm(e.area), vibe: e.area.vibe,
    })), weights);
    const byId = new Map(candidates.map((e) => [e.area.id, e]));
    return {
      ranked: scored.map((s) => ({ ...byId.get(s.id)!, score: s })),
      unknownNow: ctx === 'ahora' ? near.filter((e) => e.status.status === 'unknown') : [],
      closedNow: ctx === 'ahora' ? near.filter((e) => e.status.status === 'closed' || e.status.status === 'off_season') : [],
      far, noRoute,
      counts: { all: countStatuses(entries.map((e) => e.status.status)), filtered: countStatuses(near.map((e) => e.status.status)) },
    };
  }, [catalog.data, maxKm, weights, ctx, costActive, costByArea, origin, customRoutes]);

  const originName = origin === 'tarragona' ? 'Tarragona' : origin === 'sabadell' ? 'Sabadell' : custom?.label ?? 'tu origen';
  const card = (e: { area: CatalogArea; members: CatalogArea[]; status: ResortStatusInfo }, extra: { rank?: number; score?: ReturnType<typeof scoreRows>[number] } = {}) => (
    <AreaCard key={e.area.id} area={e.area} members={e.members} status={e.status} mode={mode} origin={originName} ctx={ctx} cost={!trip ? undefined : costByArea ? costByArea.get(e.area.id) ?? null : costs.error ? 'error' : 'loading'} {...extra} />
  );

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>Comparar</h1>
        <Link to="/fuentes" className="btn btn-ghost btn-small">Fuentes de datos</Link>
      </div>

      <nav className="tabs context-tabs" aria-label="Para qué comparas">
        {([['plan', 'Planificar un viaje'], ['ahora', 'Esquiar ahora']] as [Context, string][]).map(([id, label]) => (
          <Link key={id} to={`/comparar${id === 'ahora' ? '?contexto=ahora' : ''}`} className="tab" aria-current={ctx === id ? 'page' : undefined}
            onClick={(ev) => { ev.preventDefault(); setQuery('contexto', id === 'plan' ? null : id); }}>{label}</Link>
        ))}
      </nav>
      <p className="muted">
        {ctx === 'ahora'
          ? 'Solo se recomiendan estaciones con apertura confirmada por su fuente y dato vigente. Las cerradas o con estado desconocido se listan aparte.'
          : 'Se comparan todas las estaciones, abiertas o no: el estado de hoy no predice cómo estarán en las fechas del viaje. Por eso la nieve de hoy no puntúa por defecto.'}
      </p>

      <section className="panel stack" aria-labelledby="cmp-f">
        <h2 id="cmp-f">Filtros</h2>
        <div className="filters">
          <div className="field field-inline">
            <label htmlFor="cmp-origin">Salida desde</label>
            <select id="cmp-origin" value={origin} onChange={(e) => setQuery('origen', e.target.value === 'tarragona' ? null : e.target.value)}>
              <option value="tarragona">Tarragona</option>
              <option value="sabadell">Sabadell</option>
              <option value="personal">{custom ? `Mi origen: ${custom.label.length > 28 ? `${custom.label.slice(0, 27)}…` : custom.label}` : 'Otra dirección o punto del mapa…'}</option>
            </select>
          </div>
          <div className="field field-inline">
            <label htmlFor="cmp-km">Máximo por carretera (km)</label>
            <input id="cmp-km" type="number" inputMode="numeric" min={0} max={2000} step={10} value={maxKmText} onChange={(e) => setMaxKmText(e.target.value)} />
          </div>
          <fieldset className="radio-group">
            <legend>Modalidad</legend>
            {(['lodging', 'lodging_forfait'] as Mode[]).map((m) => (
              <label key={m} className="radio"><input type="radio" name="cmp-mode" checked={mode === m} onChange={() => setQuery('modalidad', m === 'lodging' ? null : m)} /> {MODALITY_LABEL[m]}</label>
            ))}
          </fieldset>
          <div className="field field-inline">
            <label htmlFor="cmp-trip">Coste por persona de</label>
            <select id="cmp-trip" value={trip?.id ?? ''} onChange={(e) => setQuery('viaje', e.target.value || null)}>
              <option value="">Ningún viaje (el coste no puntúa)</option>
              {(trips.data?.trips ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        {origin === 'personal' && <OriginPicker key={custom ? `${custom.lat},${custom.lon}` : 'none'} origin={custom} />}
        <CostContext trip={trip} missing={tripMissing} loading={costs.loading} error={costs.error} active={costActive} anyCandidates={!!costs.data?.options.length}
          transport={otherOrigin ? { originName, tolls, setTolls, ready: origin !== 'personal' || !!customRoutes } : null} hasTrips={(trips.data?.trips.length ?? 0) > 0} />
        <details className="weights">
          <summary>Pesos de la puntuación</summary>
          <div className="weights-grid">
            {(costActive ? ['cost' as const, ...SLIDERS] : SLIDERS).map((k) => (
              <div key={k} className="field">
                <label htmlFor={`w-${k}`}>{WEIGHT_LABEL[k]}: <strong>{Math.round(weights[k] * 100)}</strong></label>
                <input id={`w-${k}`} type="range" min={0} max={100} step={5} value={Math.round(weights[k] * 100)}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) / 100 })} />
              </div>
            ))}
          </div>
          <p className="muted small">Un dato que falta puntúa 0 en ese criterio y se indica: un coste pendiente nunca cuenta como 0 € ni como el más barato. El coste solo puntúa con un viaje elegido y presupuestos completos. El après-ski se muestra, pero todavía no forma parte de la puntuación.</p>
          <p className="muted small">La <strong>cobertura</strong> dice qué parte de la puntuación se calcula con datos disponibles. No indica si la estación está abierta: eso lo dice su estado.</p>
        </details>
        <p className="muted small">Las ofertas de cada estación se muestran en su ficha en modo «{MODALITY_LABEL[mode]}». Son orientativas, con fechas del proveedor.</p>
      </section>

      {catalog.loading && !catalog.data && <Loading label="Cargando estaciones…" />}
      {origin === 'personal' && !customRoutes && catalog.data && (
        <p className="muted">Elige y confirma tu punto de salida para ver las distancias. No se muestran las de Tarragona o Sabadell como si fueran tuyas.</p>
      )}
      {catalog.error && !catalog.data && <ErrorState message={catalog.error} onRetry={catalog.reload} />}
      {groups && (
        <>
          <StatusOverview all={groups.counts.all} filtered={groups.counts.filtered} maxKm={maxKm} />
          <section className="stack" aria-labelledby="cmp-near">
            <h2 id="cmp-near">{ctx === 'ahora' ? `Abiertas a ${maxKm} km o menos` : `A ${maxKm} km o menos por carretera`} <span className="count">{groups.ranked.length}</span></h2>
            {groups.ranked.length === 0 ? (
              ctx === 'ahora'
                ? <Empty title="Ninguna estación abierta confirmada dentro de esa distancia"><p>Revisa las de estado desconocido más abajo o cambia a «Planificar un viaje» para comparar todas.</p></Empty>
                : <Empty title="Ninguna estación dentro de esa distancia"><p>Sube el máximo de kilómetros.</p></Empty>
            ) : (
              <ol className="area-list" aria-label={ctx === 'ahora' ? 'Estaciones abiertas dentro de la distancia' : 'Estaciones dentro de la distancia'}>
                {groups.ranked.map((e, i) => card(e, { rank: i + 1, score: e.score }))}
              </ol>
            )}
          </section>
          {groups.unknownNow.length > 0 && (
            <section className="stack" aria-labelledby="cmp-unknown">
              <h2 id="cmp-unknown">Estado desconocido <span className="count">{groups.unknownNow.length}</span></h2>
              <p className="muted small">No hay un dato vigente de apertura: pueden estar abiertas o no. No se recomiendan ni se dan por cerradas; consulta su web oficial.</p>
              <ul className="area-list" aria-label="Estaciones con estado desconocido">{groups.unknownNow.map((e) => card(e))}</ul>
            </section>
          )}
          {groups.closedNow.length > 0 && (
            <details className="panel">
              <summary>Cerradas o fuera de temporada ahora <span className="count">{groups.closedNow.length}</span></summary>
              <p className="muted small">Cierre confirmado por su fuente con dato vigente. Sus fichas siguen disponibles para planificar fechas futuras.</p>
              <ul className="area-list" aria-label="Estaciones cerradas ahora">{groups.closedNow.map((e) => card(e))}</ul>
            </details>
          )}
          {groups.far.length > 0 && (
            <details className="panel">
              <summary>Más lejos de {maxKm} km <span className="count">{groups.far.length}</span></summary>
              <ul className="area-list" aria-label="Estaciones fuera de la distancia">{groups.far.map((e) => card(e))}</ul>
            </details>
          )}
          {groups.noRoute.length > 0 && (
            <section className="stack" aria-labelledby="cmp-noroute">
              <h2 id="cmp-noroute">Sin distancia por carretera <span className="count">{groups.noRoute.length}</span></h2>
              <p className="muted small">No tenemos la ruta por carretera desde {originName}: no se filtran ni se tratan como cercanas.</p>
              <ul className="area-list" aria-label="Estaciones sin distancia por carretera">{groups.noRoute.map((e) => card(e))}</ul>
            </section>
          )}
        </>
      )}
      <GeneralTips />
    </div>
  );
}

/** Contexto del criterio de coste: viaje elegido, condiciones comparadas y qué falta para activarlo. */
type TransportInfo = { originName: string; tolls: number | null; setTolls: (v: number | null) => void; ready: boolean };
function CostContext({ trip, missing, loading, error, active, anyCandidates, transport, hasTrips }: {
  trip: Trip | null; missing: string[]; loading: boolean; error: string | null; active: boolean; anyCandidates: boolean; hasTrips: boolean;
  /** Salida distinta de la del viaje: el transporte se calcula desde ella y sus peajes se indican aparte. */
  transport: TransportInfo | null;
}) {
  if (!trip) {
    return <p className="muted small">{hasTrips ? 'Elige un viaje para comparar el coste completo por persona en sus fechas y condiciones.' : <>Para comparar costes, <Link to="/viajes">crea un viaje</Link> con fechas, noches y días de esquí y añade candidaturas con precio.</>} Los precios «desde» de las fichas son referencias aparte y no puntúan.</p>;
  }
  const people = trip.participantsPlanned;
  const cond = [
    trip.startDate && trip.endDate ? range(trip.startDate, trip.endDate) : null,
    trip.nights != null ? plural(trip.nights, 'noche', 'noches') : null,
    people != null ? `${plural(people, 'persona', 'personas')}${trip.childrenAges.length ? ` (${trip.childrenAges.length} menor${trip.childrenAges.length === 1 ? '' : 'es'})` : ''}` : 'personas: las del viaje',
    trip.rooms != null ? plural(trip.rooms, 'habitación', 'habitaciones') : null,
    trip.skiDays != null ? `${plural(trip.skiDays, 'día', 'días')} de forfait` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="notice stack-s" role="status" aria-label="Coste del viaje">
      <p><strong>Coste por persona de «{trip.name}»</strong>: {cond}.</p>
      <p className="small">Cada estación usa la candidatura con presupuesto completo más barata para esas mismas condiciones: alojamiento o paquete, forfait si no va incluido, alquiler, transporte y compra del viaje. Si falta alguna partida, el coste queda pendiente.</p>
      {transport && <TransportTolls t={transport} />}
      {loading && <p className="small muted">Calculando costes…</p>}
      {error && <p className="small text-warn">No se pudieron calcular los costes: {error} El coste queda pendiente: no se usan importes de otra selección.</p>}
      {!active && !loading && !error && (
        <p className="small text-warn">El coste no puntúa todavía: {missing.length ? `al viaje le faltan ${missing.join(', ')}` : anyCandidates ? 'ninguna candidatura tiene el presupuesto completo' : 'el viaje no tiene candidaturas con precio'}. <Link to={missing.length ? `/viajes/${trip.id}` : `/viajes/${trip.id}/presupuesto`}>{missing.length ? 'Completar el viaje' : 'Ver presupuesto'}</Link></p>
      )}
    </div>
  );
}

/** Peajes desde una salida distinta de la del viaje: los guardados no se dan por buenos; se pueden indicar aquí. */
function TransportTolls({ t }: { t: TransportInfo }) {
  const [text, setText] = useState(centsToInput(t.tolls));
  const [bad, setBad] = useState(false);
  if (!t.ready) return <p className="small muted">El transporte se calculará desde tu origen cuando confirmes el punto de salida.</p>;
  const apply = () => {
    const v = parseEuros(text);
    setBad(v != null && Number.isNaN(v));
    if (v == null || !Number.isNaN(v)) { if (v !== t.tolls) t.setTolls(v); }
  };
  return (
    <div className="stack-s">
      <p className="small">Transporte desde <strong>{t.originName}</strong>, no desde la salida del viaje. Los peajes guardados en el viaje no se aplican a esta salida: {t.tolls != null ? 'se usan los que has indicado.' : 'quedan pendientes hasta que los indiques (0 si no hay).'}</p>
      <form className="field field-inline" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label htmlFor="cmp-tolls">Peajes por coche, ida y vuelta (€)</label>
        <input id="cmp-tolls" type="text" inputMode="decimal" value={text} aria-invalid={bad || undefined} onChange={(e) => setText(e.target.value)} onBlur={apply} />
        <button type="submit" className="btn btn-secondary btn-small">Aplicar</button>
      </form>
      {bad && <p className="small text-warn">Escribe un importe como 24,50 o déjalo vacío.</p>}
    </div>
  );
}

const countsText = (c: StatusCounts) => [
  `${c.open} ${c.open === 1 ? 'abierta' : 'abiertas'}`, `${c.closed} ${c.closed === 1 ? 'cerrada' : 'cerradas'}`,
  `${c.off_season} fuera de temporada`, `${c.unknown} con estado desconocido`,
].join(' · ');

/** Resumen de apertura del catálogo completo y de los resultados del filtro, con aviso si no hay ninguna abierta. */
function StatusOverview({ all, filtered, maxKm }: { all: StatusCounts; filtered: StatusCounts; maxKm: number }) {
  const notice = noOpenNotice(all);
  const filteredNotice = noOpenNotice(filtered);
  return (
    <section className="stack-s" aria-label="Estado de apertura">
      {notice && (
        <div className="notice notice-warn" role="status">
          <p><strong>{notice.allClosed ? 'Todas las estaciones del catálogo están cerradas.' : 'No hay ninguna estación abierta confirmada en el catálogo.'}</strong> {notice.text}</p>
        </div>
      )}
      {!notice && filteredNotice && filtered.total > 0 && (
        <div className="notice notice-warn" role="status">
          <p><strong>{filteredNotice.allClosed ? `Todas las estaciones a ${maxKm} km o menos están cerradas.` : `Ninguna estación abierta confirmada a ${maxKm} km o menos.`}</strong> {filteredNotice.text}</p>
        </div>
      )}
      <dl className="status-summary">
        <div><dt>Catálogo completo ({all.total})</dt><dd>{countsText(all)}</dd></div>
        <div><dt>Con tu filtro ({filtered.total})</dt><dd>{countsText(filtered)}</dd></div>
      </dl>
    </section>
  );
}

/** Consejos generales del grupo (comentarios «global» de la hoja antigua publicados por administración). */
function GeneralTips() {
  const r = useResource(() => get<{ tips: LegacyComment[]; note: string }>('/api/public/tips').catch(() => ({ tips: [], note: '' })), []);
  if (!r.data?.tips.length) return null;
  return (
    <section className="panel stack" aria-labelledby="cmp-tips">
      <h2 id="cmp-tips">Consejos generales <span className="count">{r.data.tips.length}</span></h2>
      <p className="small muted">{r.data.note}</p>
      <ul className="comment-list" aria-label="Consejos generales de la hoja antigua">
        {r.data.tips.map((c) => (
          <li key={c.id} className="comment comment-legacy">
            <p className="comment-meta">De la hoja antigua · escrito por «{c.legacyAuthorName ?? 'sin nombre'}»{c.dateText && ` · ${c.dateText}`}
              {c.linkedAlias && <> · <span className="tag tag-quiet">vinculado a {c.linkedAlias}</span></>}</p>
            <p className="comment-body">{c.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AreaCard({ area, members, status, mode, score, rank, origin, ctx, cost }: {
  area: CatalogArea; members: CatalogArea[]; status: ResortStatusInfo; mode: Mode; origin: string; ctx: Context; rank?: number;
  /** undefined = sin viaje elegido (no se muestra); null = el viaje no tiene candidaturas en esta estación;
   * 'loading' / 'error' = aún no hay costes de la selección actual (nunca se muestran los de otra). */
  cost?: AreaCost | null | 'loading' | 'error';
  score?: ReturnType<typeof scoreRows>[number];
}) {
  const href = `/estaciones/${area.id}${mode === 'lodging_forfait' ? '?modalidad=lodging_forfait' : ''}`;
  const r = area.route;
  const prov = r ? routeProvenance(r) : null;
  const closed = status.status === 'closed' || status.status === 'off_season';
  const snow = area.snow;
  // Principal: estado, distancia y km abiertos. Procedencia, fechas y detalles técnicos en el desplegable; las
  // advertencias que cambian la lectura del dato (ruta antigua, estado desconocido, criterio sin dato) siguen visibles.
  const openKm = !snow || status.status === 'unknown' ? null : snow.openKm;
  return (
    <li className={`area-card${closed ? ' is-closed' : ''}`}>
      <div className="area-card-head">
        <h3><Link to={href}>{rank != null && <span className="rank">{rank}.</span>} {area.name}</Link></h3>
        <StatusBadge info={status} />
      </div>
      {status.status === 'unknown' && (
        <p className="status-note">Estado desconocido: {status.reason}{status.lastKnown ? ` (último estado publicado: ${status.lastKnown})` : ''}. No se da por cerrada.</p>
      )}
      {ctx === 'plan' && closed && <p className="small muted">Cerrada hoy; puede estar abierta en las fechas de tu viaje.</p>}
      <dl className="area-facts">
        <div><dt>Distancia</dt><dd>{r?.roadKm != null ? <>{kmText(r.roadKm)}{r.durationMin != null && ` · ${Math.floor(r.durationMin / 60)} h ${r.durationMin % 60} min aprox.`}</> : `sin distancia desde ${origin}`}
          {prov?.level === 'legacy' && <span className="small text-warn"> · {prov.label}</span>}
          {r?.notes && r.source.startsWith('Geoapify') && <span className="small muted"> · {r.notes}</span>}</dd></div>
        <div><dt>Km abiertos</dt><dd>{openKm != null ? `${kmText(openKm)} de ${kmText(snow!.totalKm ?? area.officialTotalKm)}` : status.status === 'unknown' ? 'sin dato vigente' : 'la fuente no publica km abiertos'}
          {closed && openKm === 0 && <span className="muted small"> · 0 km abiertos no significa que no haya nieve</span>}</dd></div>
        {cost !== undefined && <div><dt>Coste por persona</dt><dd><CostText cost={cost} /></dd></div>}
      </dl>
      {score && (
        <p className="score-line">
          <strong>Puntuación {score.score.toLocaleString('es-ES')}</strong> <span className="muted small">(cobertura {Math.round(score.coverage * 100)} %)</span>
          {score.missing.length > 0 && <span className="tag tag-warn">Falta: {score.missing.map((k) => WEIGHT_LABEL[k].toLowerCase()).join(', ')} (puntúa 0)</span>}
        </p>
      )}
      <details className="area-more">
        <summary>Detalles y procedencia<span className="visually-hidden"> de {area.name}</span></summary>
        <dl className="area-facts">
          <div><dt>Tipo</dt><dd>{AREA_KIND_LABEL[area.kind] ?? area.kind}</dd></div>
          <div><dt>Parte de nieve</dt><dd>{snow ? <><SnowKm open={snow.openKm} total={snow.totalKm} opStatus={snow.opStatus} /> <Freshness state={snow.freshness} at={snow.observedAt} /><ReportDate date={snow.sourceDate} />
            {snow.rank?.excluded && <span className="snow-excluded small">no puntúa en «nieve abierta ahora»: {snow.rank.label ?? snow.rank.excluded}</span>}</> : 'sin dato'}</dd></div>
          <div><dt>Ruta</dt><dd>{r ? <>{r.accessName}{prov && <span className="muted small"> · {prov.label}</span>}</> : 'sin ruta'}</dd></div>
          <div><dt>Km totales</dt><dd>{kmText(area.officialTotalKm)}{area.totalKmSource && area.officialTotalKm != null && <span className="muted small"> ({area.totalKmSource})</span>}</dd></div>
          <div><dt>Ambiente / après</dt><dd>{area.vibe ?? 'sin dato'} / {area.apres ?? 'sin dato'} <span className="muted small">(0–10, subjetivo)</span></dd></div>
        </dl>
        {area.legacySnow && (
          <p className="legacy-ref small">Referencia legacy ({area.legacySnow.date}): {kmText(area.legacySnow.openKm)} de {kmText(area.legacySnow.totalKm)}. <em>{area.legacySnow.note}</em></p>
        )}
      </details>
      {members.length > 0 && (
        <div className="members small">
          <span className="muted">Incluye:</span>{' '}
          {members.map((m, i) => (
            <span key={m.id}>{i > 0 && ', '}<Link to={`/estaciones/${m.id}${mode === 'lodging_forfait' ? '?modalidad=lodging_forfait' : ''}`}>{m.name}</Link>
              <span className="muted"> ({memberText(m)})</span></span>
          ))}
          <span className="muted"> · cuentan dentro del dominio, no por separado.</span>
        </div>
      )}
    </li>
  );
}

function CostText({ cost }: { cost: AreaCost | null | 'loading' | 'error' }) {
  if (cost === 'loading') return <>coste pendiente <span className="muted small">· calculando</span></>;
  if (cost === 'error') return <>coste pendiente <span className="muted small">· no se ha podido calcular</span></>;
  if (!cost) return <>coste pendiente <span className="muted small">· sin candidaturas del viaje en esta estación</span></>;
  if (cost.perPersonCents == null) return <>coste pendiente <span className="muted small">· {cost.pending.length ? `falta: ${cost.pending.join(', ').toLowerCase()}` : 'ningún presupuesto completo'}</span></>;
  const v = cost.via!;
  return (
    <><strong>{euros(cost.perPersonCents)}</strong>{' '}
      <span className="muted small">· de «{v.title}» ({v.package ? 'paquete con forfait' : 'alojamiento + forfait aparte'}){cost.completeCount > 1 ? `, la más barata de ${cost.completeCount} completas` : ''}{v.hypothetical ? ', calculado en esta estación sin cambiar el viaje' : ''}</span></>
  );
}

/** Estado de una estación miembro de un dominio, con el mismo criterio de vigencia que la tarjeta. */
function memberText(m: CatalogArea): string {
  const st = resortStatus(m.snow, Date.now());
  if (st.status === 'open') return m.snow?.openKm != null ? `abierta, ${m.snow.openKm}/${m.snow.totalKm ?? 'sin dato'} km` : 'abierta';
  return RESORT_STATUS_LABEL[st.status].toLowerCase();
}

/** Km abiertos de totales; con el estado, un cierre confirmado se dice como tal (no «sin dato abiertos de sin dato»). */
export function SnowKm({ open, total, opStatus }: { open: number | null; total: number | null; opStatus?: string }) {
  return <span>{snowStateText({ opStatus: opStatus ?? 'unknown', openKm: open, totalKm: total }).text}</span>;
}
