// Ficha de estación: primero el estado actual, las ofertas y lo que se puede hacer (consultar al proveedor, registrar
// una cotización en un viaje); después cómo llegar con su procedencia. El diagnóstico técnico y los históricos
// antiguos quedan plegados, con sus fuentes, fechas y avisos a un clic.
import { useState } from 'react';
import { get } from '../api';
import { Freshness, ReportDate } from '../components/Badges';
import { Comments } from '../components/Comments';
import { ErrorState, Loading } from '../components/States';
import { AREA_KIND_LABEL, AVAILABILITY_LABEL, euros, healthText, instant, kmText, numDate, OP_STATUS_LABEL, PRICE_KIND_LABEL, PROVIDER_LABEL, RUN_STATUS_LABEL, SNOW_QUALITY_LABEL, SOURCE_KIND_LABEL, SOURCE_STATUS_LABEL, UNIT_LABEL } from '../format';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import { useSession } from '../session';
import type { AreaDetail, AreaRoute, Snow, SourceRow } from '../catalog';
import type { Trip } from '../types';
import { legacyAnomalyText, routeProvenance } from '../../core/legacy';
import { SnowKm } from './Compare';

type Forfait = 'yes' | 'no' | 'unknown';
const FORFAIT_LABEL: Record<Forfait, string> = { no: 'Solo alojamiento', yes: 'Alojamiento + forfait', unknown: 'Forfait sin confirmar' };
const FORFAIT_PARAM: Record<Forfait, string | null> = { no: null, yes: 'lodging_forfait', unknown: 'sin-confirmar' };

export function AreaPage({ areaId }: { areaId: string }) {
  const { query } = useLocation();
  const q = query.get('modalidad');
  const mode: Forfait = q === 'lodging_forfait' ? 'yes' : q === 'sin-confirmar' ? 'unknown' : 'no';
  const { state } = useSession();
  const profile = state.status === 'ready' ? state.profile : null;
  const d = useResource(() => get<AreaDetail>(`/api/public/areas/${encodeURIComponent(areaId)}`), [areaId]);
  usePageTitle(d.data?.area.name ?? 'Estación');

  if (d.loading && !d.data) return <div className="page"><Loading /></div>;
  if (d.error && !d.data) return <div className="page"><h1>Estación</h1><ErrorState message={d.error} onRetry={d.reload} /><p><Link to="/comparar">Volver a comparar</Link></p></div>;
  const { area, links, sources, snow, legacy, comments, offers } = d.data!;
  const parents = links.filter((l) => l.child_id === area.id);
  const children = links.filter((l) => l.parent_id === area.id);
  const latest = snow.at(-1) ?? null;
  const count = (f: Forfait) => offers.items.filter((o) => o.forfaitIncluded === f).length;
  const items = offers.items.filter((o) => o.forfaitIncluded === mode);
  const offerSources = sources.filter((s) => s.kind === 'offers' && s.url);
  const legacyCount = legacy.snow.length + legacy.hotel.length;

  return (
    <div className="page page-wide">
      <p className="breadcrumb"><Link to="/comparar">Comparar</Link></p>
      <div className="page-head">
        <div>
          <h1>{area.name}</h1>
          <p className="muted">{AREA_KIND_LABEL[area.kind] ?? area.kind}{area.region && ` · ${area.region}`} · {area.country}</p>
        </div>
        {area.official_url && <a className="btn btn-secondary btn-small" href={area.official_url} target="_blank" rel="noopener noreferrer">Web oficial<span className="visually-hidden"> (se abre en otra pestaña)</span></a>}
      </div>
      {(parents.length > 0 || children.length > 0) && (
        <p className="panel small">
          {parents.map((p) => <span key={p.parent_id}>Forma parte de <Link to={`/estaciones/${p.parent_id}`}>{p.parent_name}</Link>. </span>)}
          {children.length > 0 && <>Incluye: {children.map((c, i) => <span key={c.child_id}>{i > 0 && ', '}<Link to={`/estaciones/${c.child_id}`}>{c.child_name}</Link></span>)}.</>}
        </p>
      )}

      <section className="panel stack" aria-labelledby="a-snow">
        <h2 id="a-snow">Estado actual</h2>
        {latest ? (
          <>
            <p className="status-line">
              <SnowStatus snow={latest} />
              <Freshness state={latest.freshness} at={latest.observedAt} /><ReportDate date={latest.sourceDate} />
            </p>
            {latest.quality !== 'ok' && <p className="notice notice-warn small">Dato con avisos: {latest.qualityNote ?? SNOW_QUALITY_LABEL[latest.quality] ?? latest.quality}. No puntúa en Comparar.</p>}
            {(latest.openRuns != null || latest.openLifts != null) && (
              <p className="small">{latest.openRuns != null && `Pistas ${latest.openRuns}${latest.totalRuns != null ? ` de ${latest.totalRuns}` : ''}`}{latest.openRuns != null && latest.openLifts != null && ' · '}
                {latest.openLifts != null && `remontes ${latest.openLifts}${latest.totalLifts != null ? ` de ${latest.totalLifts}` : ''}`}</p>
            )}
          </>
        ) : <p>Sin dato de nieve en los últimos 90 días.</p>}
        <p className="muted small">Km totales declarados: {kmText(area.official_total_km)}{area.total_km_source && ` (${area.total_km_source})`}. Las condiciones actuales no predicen las de un viaje futuro.</p>
        {area.notes && <p className="small muted">Nota del catálogo: {area.notes}</p>}
        {snow.length > 1 && <SnowChart snow={snow} />}
      </section>

      <section className="panel stack" aria-labelledby="a-offers">
        <h2 id="a-offers">Ofertas y qué hacer</h2>
        {offers.items.length === 0 ? (
          <div className="stack-s" data-testid="no-offers">
            <p><strong>No hay ofertas automáticas recientes para esta estación.</strong> {offerSources.length ? 'El recolector no ha traído ninguna en los últimos 14 días.' : 'No tiene ningún proveedor con lectura automática.'}</p>
            <p className="small muted">Puedes buscar directamente en el proveedor y apuntar el precio que te den como cotización en un viaje: así entra en el presupuesto con sus fechas y condiciones.</p>
            <ProviderLinks sources={offerSources} officialUrl={area.official_url} />
          </div>
        ) : (
          <>
            <p className="notice notice-warn"><strong>{offers.note}</strong></p>
            <fieldset className="radio-group">
              <legend>Forfait</legend>
              {(['no', 'yes', 'unknown'] as const).map((f) => (
                <label key={f} className="radio">
                  <input type="radio" name="area-mode" checked={mode === f} onChange={() => setQuery('modalidad', FORFAIT_PARAM[f])} /> {FORFAIT_LABEL[f]} <span className="muted">({count(f)})</span>
                </label>
              ))}
            </fieldset>
            {mode === 'unknown' && <p className="small muted">La tarjeta del proveedor no indica si incluye forfait, o lo indica de forma contradictoria. No se asume «solo alojamiento».</p>}
            {items.length === 0 ? <p className="muted">No hay ofertas recientes (14 días) en «{FORFAIT_LABEL[mode]}».</p> : (
              <ul className="list">
                {items.map((o) => (
                  <li key={o.id} className="offer-row">
                    <p><strong>{o.hotel_name_raw ?? 'Alojamiento sin nombre'}</strong> <span className="muted">· {PROVIDER_LABEL[o.provider_id] ?? o.provider_id}{o.board && ` · ${o.board}`}</span></p>
                    <p>
                      {o.amount_cents == null ? 'Sin precio' : <strong>{euros(o.amount_cents)}</strong>} <span>{UNIT_LABEL[o.unit] ?? o.unit}</span>{' '}
                      <span className="tag tag-quiet">{PRICE_KIND_LABEL[o.price_kind] ?? o.price_kind}</span>
                      {o.forfaitIncluded === 'unknown' && <> <span className="tag tag-warn">Forfait sin confirmar</span></>}
                    </p>
                    <p className="small muted">
                      Condiciones del proveedor: {o.check_in && o.check_out ? `${o.check_in} → ${o.check_out}` : 'fechas no indicadas'}{o.nights != null && ` · ${o.nights} noches`}{o.adults != null && ` · ${o.adults} adultos`}
                      {o.childrenAges && (o.childrenAges.length ? ` · menores de ${o.childrenAges.join(', ')} años` : ' · sin menores')}{o.rooms != null && ` · ${o.rooms} hab.`}
                      {o.forfait_days != null && ` · ${o.forfait_days} días de forfait`} · {AVAILABILITY_LABEL[o.availability] ?? o.availability} · visto {instant(o.observed_at)}
                    </p>
                    {o.warnings.length > 0 && <ul className="small text-warn offer-warnings">{o.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                    {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="small">Consultar en el proveedor<span className="visually-hidden"> (se abre en otra pestaña)</span></a>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <QuoteInTrip areaId={area.id} areaName={area.name} />
      </section>

      <section className="panel stack" aria-labelledby="a-route">
        <h2 id="a-route">Cómo llegar</h2>
        <RoutesList routes={d.data!.routes ?? []} />
      </section>

      <section className="panel stack" aria-labelledby="a-com">
        <h2 id="a-com">Comentarios públicos</h2>
        <Comments comments={comments} meId={profile?.id ?? null} target={{ scope: 'area_public', areaId: area.id }} onChanged={() => void d.reload()}
          isAdmin={profile?.role === 'admin'} emptyText="Aún no hay comentarios sobre esta estación." />
      </section>

      {(d.data!.legacyComments?.length ?? 0) > 0 && (
        <section className="panel stack legacy-comments" aria-labelledby="a-lcom">
          <h2 id="a-lcom">De la hoja antigua <span className="count">{d.data!.legacyComments!.length}</span></h2>
          {d.data!.legacyCommentsNote && <p className="small muted">{d.data!.legacyCommentsNote}</p>}
          <ul className="comment-list" aria-label="Comentarios de la hoja antigua">
            {d.data!.legacyComments!.map((c) => (
              <li key={c.id} className="comment comment-legacy">
                <p className="comment-meta">De la hoja antigua · escrito por «{c.legacyAuthorName ?? 'sin nombre'}»{c.dateText && ` · ${c.dateText}`}
                  {c.linkedAlias && <> · <span className="tag tag-quiet">vinculado a {c.linkedAlias}</span></>}</p>
                <p className="comment-body">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snow.length > 0 && (
        <details className="fold">
          <summary>Historial de nieve de 90 días <span className="muted">· {snow.length} observaciones</span></summary>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">Observaciones de nieve de los últimos 90 días</caption>
              <thead><tr><th scope="col">Observado</th><th scope="col">Abiertos</th><th scope="col">Totales</th><th scope="col">Estado</th></tr></thead>
              <tbody>{[...snow].reverse().map((s) => (
                <tr key={s.observedAt}><th scope="row">{instant(s.observedAt)}</th><td>{kmText(s.openKm)}</td><td>{kmText(s.totalKm)}</td><td>{OP_STATUS_LABEL[s.opStatus] ?? s.opStatus}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}

      <SourcesFold sources={sources} />

      {legacyCount > 0 && (
        <details className="fold" aria-label="Históricos antiguos">
          <summary>Históricos del SkiTrip antiguo <span className="muted">· {legacyCount} filas, sin verificar</span></summary>
          <div className="fold-body">
            <p className="notice notice-warn small">{legacy.warning} La serie de nieve tampoco está verificada: un 0 puede ser un «-» (sin dato) convertido.</p>
            {legacy.snow.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>Nieve del SkiTrip antiguo (no verificada)</caption>
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Abiertos</th><th scope="col">Totales</th><th scope="col">Avisos</th></tr></thead>
                  <tbody>{legacy.snow.slice(0, 30).map((r) => (
                    <tr key={r.obs_date}><th scope="row">{numDate(r.obs_date)}</th><td>{kmText(r.open_km)}</td><td>{kmText(r.total_km)}</td><td>{r.anomalies.map(legacyAnomalyText).join(' ') || '—'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {legacy.hotel.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <caption>Precios hoteleros antiguos agregados (sin hotel, fechas ni ocupación)</caption>
                  <thead><tr><th scope="col">Fecha</th><th scope="col">Proveedor</th><th scope="col">Más barato</th><th scope="col">Media top 10</th><th scope="col">Muestras</th></tr></thead>
                  <tbody>{legacy.hotel.slice(0, 30).map((r, i) => (
                    <tr key={i}><th scope="row">{numDate(r.obs_date)}</th><td>{PROVIDER_LABEL[r.provider] ?? r.provider}</td><td>{r.cheapest_unit_cents != null ? euros(r.cheapest_unit_cents) : 'sin dato'}</td><td>{r.top10_avg_unit_cents != null ? euros(r.top10_avg_unit_cents) : 'sin dato'}</td><td>{r.sample_count}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** Estado de nieve en una línea: un cierre confirmado se dice como tal aunque la fuente no publique km. */
function SnowStatus({ snow }: { snow: Snow }) {
  const closed = snow.opStatus === 'closed_confirmed' || snow.opStatus === 'out_of_season';
  return (
    <span className={`status-main ${closed ? 'is-closed' : ''}`}>
      <SnowKm open={snow.openKm} total={snow.totalKm} opStatus={snow.opStatus} />
      {!closed && <span className="small muted"> · {OP_STATUS_LABEL[snow.opStatus] ?? snow.opStatus}</span>}
    </span>
  );
}

function ProviderLinks({ sources, officialUrl }: { sources: SourceRow[]; officialUrl: string | null }) {
  const seen = new Set<string>();
  const links = sources.filter((s) => !seen.has(s.provider) && seen.add(s.provider));
  if (!links.length && !officialUrl) return <p className="small muted">No hay ningún proveedor registrado para esta estación: consulta en la web de tu agencia habitual y apunta el precio en un viaje.</p>;
  return (
    <ul className="row-wrap" aria-label="Buscar en el proveedor">
      {links.map((s) => (
        <li key={s.id}><a className="btn btn-secondary btn-small" href={s.url} target="_blank" rel="noopener noreferrer nofollow">Buscar en {PROVIDER_LABEL[s.provider] ?? s.provider}<span className="visually-hidden"> (se abre en otra pestaña)</span></a></li>
      ))}
      {officialUrl && <li><a className="btn btn-ghost btn-small" href={officialUrl} target="_blank" rel="noopener noreferrer">Web oficial<span className="visually-hidden"> (se abre en otra pestaña)</span></a></li>}
    </ul>
  );
}

/** Registrar una cotización manual en un viaje (candidatura con la estación ya elegida). */
function QuoteInTrip({ areaId, areaName }: { areaId: string; areaName: string }) {
  const trips = useResource(() => get<{ trips: Trip[] }>('/api/trips'), []);
  const [tripId, setTripId] = useState('');
  const open = (trips.data?.trips ?? []).filter((t) => t.status === 'planning' || t.status === 'decided');
  const chosen = tripId || open[0]?.id || '';
  return (
    <div className="stack-s">
      <h3 id="a-quote">Apuntar una cotización en un viaje</h3>
      {trips.loading && !trips.data ? <p className="small muted">Cargando tus viajes…</p> : open.length === 0 ? (
        <p className="small">No tienes viajes en planificación. <Link to="/viajes">Crea un viaje</Link> y desde «Candidaturas» apunta el precio que te den para {areaName}.</p>
      ) : (
        <div className="row-wrap">
          <label className="visually-hidden" htmlFor="quote-trip">Viaje</label>
          <select id="quote-trip" className="select-small" value={chosen} onChange={(e) => setTripId(e.target.value)}>
            {open.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Link className="btn btn-primary btn-small" to={`/viajes/${chosen}/candidaturas?cotizar=${encodeURIComponent(areaId)}`}>Apuntar cotización</Link>
        </div>
      )}
      <p className="small muted">Se guarda como «cotización de un miembro», con las fechas y condiciones que te dieron. Votar o apuntarla no es reservar.</p>
    </div>
  );
}

function RoutesList({ routes }: { routes: AreaRoute[] }) {
  if (!routes.length) return <p className="muted">Sin ruta por carretera registrada: no se calcula combustible ni se filtra por distancia.</p>;
  return (
    <ul className="route-list" aria-label="Rutas por carretera">
      {routes.map((r) => {
        const p = routeProvenance(r);
        return (
          <li key={r.originId}>
            <p><strong>Desde {r.originName}:</strong> {kmText(r.roadKm)}{r.durationMin != null && ` · ${Math.floor(r.durationMin / 60)} h ${r.durationMin % 60} min`}{' '}
              <span className={`tag ${p.level === 'reviewed' ? 'tag-ok' : p.level === 'legacy' ? 'tag-legacy' : 'tag-quiet'}`}>{p.label}</span></p>
            <p className="small muted">{p.detail}{r.notes && ` ${r.notes}`}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Fuentes y diagnóstico, plegados: proveedor, tipo, estado, última lectura correcta y el error si lo hubo. */
function SourcesFold({ sources }: { sources: SourceRow[] }) {
  const bad = sources.filter((s) => s.last_status && s.last_status !== 'ok' && s.reason !== 'no_offers' && s.reason !== 'off_season').length;
  return (
    <details className="fold">
      <summary>Fuentes y diagnóstico <span className="muted">· {sources.length === 0 ? 'sin fuentes' : `${sources.length} ${sources.length === 1 ? 'fuente' : 'fuentes'}`}{bad > 0 && `, ${bad} con problemas`}</span></summary>
      <div className="fold-body">
        {sources.length === 0 ? <p className="muted">Sin fuentes registradas.</p> : (
          <ul className="list">
            {sources.map((s) => (
              <li key={s.id} className="list-row list-row-wrap">
                <span className="list-main"><strong>{PROVIDER_LABEL[s.provider] ?? s.provider}</strong> · {SOURCE_KIND_LABEL[s.kind] ?? s.kind} · {SOURCE_STATUS_LABEL[s.status] ?? s.status}{s.checked_on && ` · revisada el ${numDate(s.checked_on)}`}{s.limitations && <span className="muted small"> · {s.limitations}</span>}</span>
                <span className="small">
                  Última lectura correcta: {s.last_success_at ? instant(s.last_success_at) : 'nunca'}
                  {s.last_status && s.last_status !== 'ok' && <> · <span className={s.reason === 'no_offers' || s.reason === 'off_season' ? 'muted' : 'text-bad'}>{healthText(s.last_status, s.reason)}{!s.reason && s.last_error && `: ${s.last_error}`}</span></>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small"><Link to="/fuentes">Todas las fuentes de datos</Link></p>
      </div>
    </details>
  );
}

/** Barras de km abiertos (decorativas: el historial en tabla es la alternativa accesible). */
function SnowChart({ snow }: { snow: Snow[] }) {
  const pts = snow.slice(-90);
  const max = Math.max(1, ...pts.map((s) => s.totalKm ?? s.openKm ?? 0));
  const w = 100 / pts.length;
  return (
    <figure className="snow-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {pts.map((s, i) => s.openKm == null ? (
          <rect key={i} x={i * w + w * 0.15} y={38} width={w * 0.7} height={2} className="bar-missing" />
        ) : (
          <rect key={i} x={i * w + w * 0.15} y={40 - (s.openKm / max) * 40} width={w * 0.7} height={(s.openKm / max) * 40} className="bar" />
        ))}
      </svg>
      <figcaption className="muted small">Km abiertos por observación (las marcas bajas grises son «sin dato», no cero). Detalle en el historial.</figcaption>
    </figure>
  );
}
