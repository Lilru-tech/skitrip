// Comparar estaciones: distancia por carretera (sin inventar la que falta), nieve con frescura,
// dominios con sus estaciones miembro (sin contar dos veces) y puntuación con pesos editables.
import { useMemo, useState } from 'react';
import { get } from '../api';
import { Freshness } from '../components/Badges';
import { ErrorState, Loading, Empty } from '../components/States';
import { AREA_KIND_LABEL, kmText, MODALITY_LABEL } from '../format';
import { useResource } from '../hooks';
import { Link, setQuery, useLocation, usePageTitle } from '../router';
import { topLevel, type Catalog, type CatalogArea } from '../catalog';
import { DEFAULT_WEIGHTS, scoreRows, type Weights } from '../../core/score';

type Mode = 'lodging' | 'lodging_forfait';
/** Km que puntúan en «Nieve abierta ahora»: solo los del dato elegido si es reciente y fiable (snow.rank), nunca snow.openKm tal cual. */
const snowRankKm = (a: CatalogArea) => (a.snow?.rank ? a.snow.rank.openKm : null);
const WEIGHT_LABEL: Record<keyof Weights, string> = { snowNow: 'Nieve abierta ahora', size: 'Km de pistas', distance: 'Cercanía', vibe: 'Ambiente', cost: 'Coste' };
const SLIDERS: (keyof Weights)[] = ['snowNow', 'size', 'distance', 'vibe'];

export function ComparePage() {
  usePageTitle('Comparar');
  const { query } = useLocation();
  const origin = query.get('origen') === 'sabadell' ? 'sabadell' : 'tarragona';
  const mode: Mode = query.get('modalidad') === 'lodging_forfait' ? 'lodging_forfait' : 'lodging';
  const catalog = useResource(() => get<Catalog>(`/api/public/catalog?origin=${origin}`), [origin]);
  const [maxKmText, setMaxKmText] = useState('300');
  const maxKm = Math.max(0, Number(maxKmText) || 0);
  // El coste no puntúa aquí: el catálogo no tiene presupuestos completos por estación.
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS, cost: 0 });

  const groups = useMemo(() => {
    if (!catalog.data) return null;
    const entries = topLevel(catalog.data);
    const near = entries.filter((e) => e.area.route?.roadKm != null && e.area.route.roadKm <= maxKm);
    const far = entries.filter((e) => e.area.route?.roadKm != null && e.area.route.roadKm > maxKm);
    const noRoute = entries.filter((e) => e.area.route?.roadKm == null);
    const scored = scoreRows(near.map((e) => ({
      id: e.area.id, costPerPersonCents: null, roadKm: e.area.route?.roadKm ?? null,
      totalKm: e.area.snow?.totalKm ?? e.area.officialTotalKm, openKmNow: snowRankKm(e.area), vibe: e.area.vibe,
    })), weights);
    const byId = new Map(near.map((e) => [e.area.id, e]));
    return { ranked: scored.map((s) => ({ ...byId.get(s.id)!, score: s })), far, noRoute };
  }, [catalog.data, maxKm, weights]);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <h1>Comparar</h1>
        <Link to="/fuentes" className="btn btn-ghost btn-small">Fuentes de datos</Link>
      </div>

      <section className="panel stack" aria-labelledby="cmp-f">
        <h2 id="cmp-f">Filtros</h2>
        <div className="filters">
          <div className="field field-inline">
            <label htmlFor="cmp-origin">Salida desde</label>
            <select id="cmp-origin" value={origin} onChange={(e) => setQuery('origen', e.target.value === 'tarragona' ? null : e.target.value)}>
              <option value="tarragona">Tarragona</option>
              <option value="sabadell">Sabadell</option>
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
        </div>
        <details className="weights">
          <summary>Pesos de la puntuación</summary>
          <div className="weights-grid">
            {SLIDERS.map((k) => (
              <div key={k} className="field">
                <label htmlFor={`w-${k}`}>{WEIGHT_LABEL[k]}: <strong>{Math.round(weights[k] * 100)}</strong></label>
                <input id={`w-${k}`} type="range" min={0} max={100} step={5} value={Math.round(weights[k] * 100)}
                  onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) / 100 })} />
              </div>
            ))}
          </div>
          <p className="muted small">Un dato que falta puntúa 0 en ese criterio y se indica. El coste no puntúa en esta vista porque no hay presupuestos completos por estación. El après-ski se muestra, pero todavía no forma parte de la puntuación.</p>
        </details>
        <p className="muted small">Las ofertas de cada estación se muestran en su ficha en modo «{MODALITY_LABEL[mode]}». Son orientativas, con fechas del proveedor.</p>
      </section>

      {catalog.loading && !catalog.data && <Loading label="Cargando estaciones…" />}
      {catalog.error && !catalog.data && <ErrorState message={catalog.error} onRetry={catalog.reload} />}
      {groups && (
        <>
          <section className="stack" aria-labelledby="cmp-near">
            <h2 id="cmp-near">A {maxKm} km o menos por carretera <span className="count">{groups.ranked.length}</span></h2>
            {groups.ranked.length === 0 ? <Empty title="Ninguna estación dentro de esa distancia"><p>Sube el máximo de kilómetros.</p></Empty> : (
              <ol className="area-list" aria-label="Estaciones dentro de la distancia">
                {groups.ranked.map((e, i) => <AreaCard key={e.area.id} rank={i + 1} area={e.area} members={e.members} mode={mode} score={e.score} origin={origin} />)}
              </ol>
            )}
          </section>
          {groups.far.length > 0 && (
            <details className="panel">
              <summary>Más lejos de {maxKm} km <span className="count">{groups.far.length}</span></summary>
              <ul className="area-list" aria-label="Estaciones fuera de la distancia">
                {groups.far.map((e) => <AreaCard key={e.area.id} area={e.area} members={e.members} mode={mode} origin={origin} />)}
              </ul>
            </details>
          )}
          {groups.noRoute.length > 0 && (
            <section className="stack" aria-labelledby="cmp-noroute">
              <h2 id="cmp-noroute">Sin distancia por carretera <span className="count">{groups.noRoute.length}</span></h2>
              <p className="muted small">No tenemos la ruta por carretera desde {origin === 'tarragona' ? 'Tarragona' : 'Sabadell'}: no se filtran ni se tratan como cercanas.</p>
              <ul className="area-list" aria-label="Estaciones sin distancia por carretera">
                {groups.noRoute.map((e) => <AreaCard key={e.area.id} area={e.area} members={e.members} mode={mode} origin={origin} />)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AreaCard({ area, members, mode, score, rank, origin }: {
  area: CatalogArea; members: CatalogArea[]; mode: Mode; origin: string; rank?: number;
  score?: ReturnType<typeof scoreRows>[number];
}) {
  const href = `/estaciones/${area.id}${mode === 'lodging_forfait' ? '?modalidad=lodging_forfait' : ''}`;
  const r = area.route;
  return (
    <li className="area-card">
      <div className="area-card-head">
        <h3><Link to={href}>{rank != null && <span className="rank">{rank}.</span>} {area.name}</Link></h3>
        <span className="tag tag-quiet">{AREA_KIND_LABEL[area.kind] ?? area.kind}</span>
      </div>
      <dl className="area-facts">
        <div><dt>Carretera</dt><dd>{r?.roadKm != null ? <>{kmText(r.roadKm)}{r.durationMin != null && ` · ${Math.floor(r.durationMin / 60)} h ${r.durationMin % 60} min`}{!r.validated && <span className="muted"> (sin validar)</span>}</> : `sin distancia desde ${origin === 'tarragona' ? 'Tarragona' : 'Sabadell'}`}</dd></div>
        <div><dt>Nieve</dt><dd>{area.snow ? <><SnowKm open={area.snow.openKm} total={area.snow.totalKm} /> <Freshness state={area.snow.freshness} at={area.snow.observedAt} />
          {area.snow.rank?.excluded && <span className="snow-excluded small">no puntúa: {area.snow.rank.label ?? area.snow.rank.excluded}</span>}</> : 'sin dato'}</dd></div>
        <div><dt>Km totales</dt><dd>{kmText(area.officialTotalKm)}{area.totalKmSource && area.officialTotalKm != null && <span className="muted small"> ({area.totalKmSource})</span>}</dd></div>
        <div><dt>Ambiente / après</dt><dd>{area.vibe ?? 'sin dato'} / {area.apres ?? 'sin dato'} <span className="muted small">(0–10, subjetivo)</span></dd></div>
      </dl>
      {area.legacySnow && (
        <p className="legacy-ref small">Referencia legacy ({area.legacySnow.date}): {kmText(area.legacySnow.openKm)} de {kmText(area.legacySnow.totalKm)}. <em>{area.legacySnow.note}</em></p>
      )}
      {members.length > 0 && (
        <div className="members small">
          <span className="muted">Incluye:</span>{' '}
          {members.map((m, i) => (
            <span key={m.id}>{i > 0 && ', '}<Link to={`/estaciones/${m.id}${mode === 'lodging_forfait' ? '?modalidad=lodging_forfait' : ''}`}>{m.name}</Link>
              {m.snow && <span className="muted"> ({m.snow.openKm ?? 'sin dato'}/{m.snow.totalKm ?? 'sin dato'} km)</span>}</span>
          ))}
          <span className="muted"> · cuentan dentro del dominio, no por separado.</span>
        </div>
      )}
      {score && (
        <p className="score-line">
          <strong>Puntuación {score.score.toLocaleString('es-ES')}</strong> · cobertura {Math.round(score.coverage * 100)} %
          {score.missing.length > 0 && <span className="tag tag-warn">Falta: {score.missing.map((k) => WEIGHT_LABEL[k].toLowerCase()).join(', ')} (puntúa 0)</span>}
        </p>
      )}
    </li>
  );
}

export function SnowKm({ open, total }: { open: number | null; total: number | null }) {
  return <span>{open == null ? 'sin dato' : `${open.toLocaleString('es-ES')} km`} abiertos de {total == null ? 'sin dato' : `${total.toLocaleString('es-ES')} km`}</span>;
}
