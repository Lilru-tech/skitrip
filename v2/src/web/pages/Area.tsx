import { get } from '../api';
import { Freshness } from '../components/Badges';
import { Comments } from '../components/Comments';
import { ErrorState, Loading } from '../components/States';
import { AREA_KIND_LABEL, AVAILABILITY_LABEL, euros, instant, kmText, MODALITY_LABEL, OP_STATUS_LABEL, PRICE_KIND_LABEL, RUN_STATUS_LABEL, SOURCE_STATUS_LABEL, UNIT_LABEL } from '../format';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import { useSession } from '../session';
import type { AreaDetail, Snow } from '../catalog';
import { SnowKm } from './Compare';

export function AreaPage({ areaId }: { areaId: string }) {
  const { query } = useLocation();
  const mode = query.get('modalidad') === 'lodging_forfait' ? 'lodging_forfait' : 'lodging';
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
  const items = offers.items.filter((o) => o.modality === mode);

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
        <h2 id="a-snow">Nieve</h2>
        {latest ? (
          <p><SnowKm open={latest.openKm} total={latest.totalKm} /> · {OP_STATUS_LABEL[latest.opStatus] ?? latest.opStatus} <Freshness state={latest.freshness} at={latest.observedAt} />
            {latest.quality !== 'ok' && <span className="tag tag-warn"> Calidad: {latest.qualityNote ?? latest.quality}</span>}</p>
        ) : <p>Sin dato de nieve en los últimos 90 días.</p>}
        <p className="muted small">Km totales declarados: {kmText(area.official_total_km)}{area.total_km_source && ` (${area.total_km_source})`}. Las condiciones actuales no predicen las de un viaje futuro.</p>
        {snow.length > 1 && <SnowChart snow={snow} />}
        {snow.length > 0 && (
          <details>
            <summary>Historial de 90 días ({snow.length} observaciones)</summary>
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
      </section>

      <section className="panel stack" aria-labelledby="a-offers">
        <h2 id="a-offers">Ofertas orientativas</h2>
        <p className="notice notice-warn"><strong>{offers.note}</strong></p>
        <fieldset className="radio-group">
          <legend>Modalidad</legend>
          {(['lodging', 'lodging_forfait'] as const).map((m) => (
            <label key={m} className="radio"><input type="radio" name="area-mode" checked={mode === m} onChange={() => setQuery('modalidad', m === 'lodging' ? null : m)} /> {MODALITY_LABEL[m]}</label>
          ))}
        </fieldset>
        {items.length === 0 ? <p className="muted">No hay ofertas recientes (14 días) en modo «{MODALITY_LABEL[mode]}».</p> : (
          <ul className="list">
            {items.map((o) => (
              <li key={o.id} className="offer-row">
                <p><strong>{o.hotel_name_raw ?? 'Alojamiento sin nombre'}</strong> <span className="muted">· {o.provider_id}{o.board && ` · ${o.board}`}</span></p>
                <p>
                  {o.amount_cents == null ? 'Sin precio' : <strong>{euros(o.amount_cents)}</strong>} <span>{UNIT_LABEL[o.unit] ?? o.unit}</span>{' '}
                  <span className="tag tag-quiet">{PRICE_KIND_LABEL[o.price_kind] ?? o.price_kind}</span>
                </p>
                <p className="small muted">
                  Condiciones del proveedor: {o.check_in && o.check_out ? `${o.check_in} → ${o.check_out}` : 'fechas no indicadas'}{o.nights != null && ` · ${o.nights} noches`}{o.adults != null && ` · ${o.adults} adultos`}
                  {o.forfait_days != null && ` · ${o.forfait_days} días de forfait`} · {AVAILABILITY_LABEL[o.availability] ?? o.availability} · visto {instant(o.observed_at)}
                </p>
                {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="small">Consultar en el proveedor<span className="visually-hidden"> (se abre en otra pestaña)</span></a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-labelledby="a-src">
        <h2 id="a-src">Fuentes</h2>
        {sources.length === 0 ? <p className="muted">Sin fuentes registradas.</p> : (
          <ul className="list">
            {sources.map((s) => (
              <li key={s.id} className="list-row list-row-wrap">
                <span className="list-main"><strong>{s.provider}</strong> · {s.kind} · {SOURCE_STATUS_LABEL[s.status] ?? s.status}{s.limitations && <span className="muted small"> · {s.limitations}</span>}</span>
                <span className="small">
                  Último éxito: {s.last_success_at ? instant(s.last_success_at) : 'nunca'}
                  {s.last_status && s.last_status !== 'ok' && <> · <span className="text-bad">{RUN_STATUS_LABEL[s.last_status] ?? s.last_status}{s.last_error && `: ${s.last_error}`}</span></>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(legacy.snow.length > 0 || legacy.hotel.length > 0) && (
        <section className="panel stack" aria-labelledby="a-legacy">
          <h2 id="a-legacy">Datos legacy</h2>
          <p className="notice notice-warn">{legacy.warning}</p>
          {legacy.snow.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <caption>Nieve legacy (no verificada; un 0 puede ser un «-» convertido)</caption>
                <thead><tr><th scope="col">Fecha</th><th scope="col">Abiertos</th><th scope="col">Totales</th><th scope="col">Avisos</th></tr></thead>
                <tbody>{legacy.snow.slice(0, 30).map((r) => (
                  <tr key={r.obs_date}><th scope="row">{r.obs_date}</th><td>{kmText(r.open_km)}</td><td>{kmText(r.total_km)}</td><td>{r.anomalies.join('; ') || '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {legacy.hotel.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <caption>Precios hoteleros legacy agregados (sin hotel, fechas ni ocupación)</caption>
                <thead><tr><th scope="col">Fecha</th><th scope="col">Proveedor</th><th scope="col">Más barato</th><th scope="col">Media top 10</th><th scope="col">Muestras</th></tr></thead>
                <tbody>{legacy.hotel.slice(0, 30).map((r, i) => (
                  <tr key={i}><th scope="row">{r.obs_date}</th><td>{r.provider}</td><td>{r.cheapest_unit_cents != null ? euros(r.cheapest_unit_cents) : 'sin dato'}</td><td>{r.top10_avg_unit_cents != null ? euros(r.top10_avg_unit_cents) : 'sin dato'}</td><td>{r.sample_count}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

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
    </div>
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
