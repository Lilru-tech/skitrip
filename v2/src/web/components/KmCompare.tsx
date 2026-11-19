// Ficha › Estado actual › «Comparar con otros años»: km esquiables de las mismas fechas (día y mes) en cada temporada con
// datos. Resumen sencillo por temporada; el día a día y la procedencia, plegados. Nada se estima: «Sin dato» donde falte.
import { get } from '../api';
import { useKeyedResource } from '../hooks';
import { setQuery } from '../router';
import { dayLong, kmText, numDate, PROVIDER_LABEL } from '../format';
import { ErrorState, Loading } from './States';
import { todayMadrid } from '../../core/dates';
import { KM_ORIGIN_LABEL, KM_RANGE_MAX_DAYS, rangeMmdds, validMmdd, seasonDates, seasonStartOf, type KmDay, type KmSeason } from '../../core/km-history';

interface KmHistoryResponse { areaId: string; from: string; to: string; today: string; firstDataDate: string | null; seasons: KmSeason[] }

const NUM = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const ddmm = (mmdd: string) => `${mmdd.slice(3)}/${mmdd.slice(0, 2)}`;

/** Texto de un día: cifra, cierre, 0 dudoso o «Sin dato». */
function dayText(d: KmDay) {
  if (d.status === 'value') return <>{kmText(d.openKm)}{d.totalKm != null && <span className="muted"> de {NUM.format(d.totalKm)}</span>}</>;
  if (d.status === 'closed') return <>Cerrada <span className="muted">(0 km)</span></>;
  if (d.status === 'legacy_zero') return <span className="muted">0 o sin dato</span>;
  if (d.status === 'future') return <span className="muted">aún no ha llegado</span>;
  return <span className="muted">Sin dato</span>;
}

function SeasonSummary({ s, single }: { s: KmSeason; single: boolean }) {
  const { summary: m } = s;
  if (single) {
    const d = s.dates.find((x) => x.status !== 'future')!;
    return <><strong>{s.season}</strong> · {dayLong(d.date)}: {dayText(d)}{d.origin === 'antiguo' && <> <span className="tag tag-quiet">sin verificar</span></>}</>;
  }
  if (m.withData === 0) return <><strong>{s.season}</strong> · <span className="muted">Sin dato</span> en {m.days === 1 ? 'el día' : `los ${m.days} días`}{m.doubtfulZeros > 0 && ` (${m.doubtfulZeros} con «0 o sin dato»)`}</>;
  return (
    <>
      <strong>{s.season}</strong> · <strong>{NUM.format(m.mean!)} km</strong> de media
      <span className="muted"> ({m.withData} de {m.days} días con dato{m.min !== m.max && `; de ${NUM.format(m.min!)} a ${NUM.format(m.max!)} km`}{m.closedDays > 0 && `; ${m.closedDays} cerrada`})</span>
      {m.usesLegacy && <> <span className="tag tag-quiet">sin verificar</span></>}
    </>
  );
}

export function KmCompare({ areaId, name, fromParam, toParam }: { areaId: string; name: string; fromParam: string | null; toParam: string | null }) {
  const today = todayMadrid();
  const from = fromParam && validMmdd(fromParam) ? fromParam : today.slice(5);
  const to = toParam && validMmdd(toParam) ? toParam : from;
  const mmdds = rangeMmdds(from, to);
  const key = mmdds ? `${areaId}|${from}|${to}` : null;
  const r = useKeyedResource(key, () => get<KmHistoryResponse>(`/api/public/areas/${encodeURIComponent(areaId)}/km-history?desde=${from}&hasta=${to}`));
  // Fechas de la temporada actual para los selectores (el año no cuenta: se compara día y mes).
  const season = seasonStartOf(today);
  // El 29/02 en una temporada sin él se muestra sobre 2024 (bisiesto).
  const asDate = (mmdd: string) => seasonDates(season, [mmdd])[0] ?? seasonDates(2023, [mmdd])[0];
  const setRange = (f: string, t: string) => { setQuery('kmdesde', f); setQuery('kmhasta', t === f ? null : t); };
  const onFrom = (v: string) => { if (v) { const f = v.slice(5); setRange(f, rangeMmdds(f, to) ? to : f); } };
  const onTo = (v: string) => { if (v) setRange(from, v.slice(5)); };
  const data = r.data && r.data.from === from && r.data.to === to ? r.data : null;
  const single = mmdds?.length === 1;
  const withRows = data?.seasons.filter((s) => s.summary.withData > 0 || s.summary.doubtfulZeros > 0) ?? [];
  const providers = [...new Set((data?.seasons ?? []).flatMap((s) => s.dates).map((d) => d.provider).filter((p): p is string => !!p))];
  return (
    <div className="stack-s km-compare" data-testid="km-compare">
      <h3>Comparar con otros años</h3>
      <div className="filters">
        <div className="field field-inline">
          <label htmlFor="km-from">Desde</label>
          <input id="km-from" type="date" value={asDate(from)} onChange={(e) => onFrom(e.target.value)} />
        </div>
        <div className="field field-inline">
          <label htmlFor="km-to">Hasta</label>
          <input id="km-to" type="date" value={asDate(to)} onChange={(e) => onTo(e.target.value)} />
        </div>
      </div>
      <p className="small muted">Solo cuentan el día y el mes: {single ? `el ${ddmm(from)}` : `del ${ddmm(from)} al ${ddmm(to)}`} de cada temporada.</p>
      {!mmdds ? (
        <p className="notice notice-warn small" role="alert">Elige un intervalo de como máximo {KM_RANGE_MAX_DAYS} días dentro de una misma temporada (puede cruzar el año: del 28/12 al 03/01).</p>
      ) : r.error && !data ? <ErrorState message={r.error} onRetry={r.reload} /> : !data ? <Loading label="Cargando km de otros años…" /> : data.seasons.length === 0 ? (
        <p className="small" data-testid="km-compare-empty"><strong>Sin dato</strong>: todavía no hay ningún parte guardado de {name}.</p>
      ) : (
        <>
          <ul className="list km-compare-list" aria-label={`Km esquiables ${single ? `el ${ddmm(from)}` : `del ${ddmm(from)} al ${ddmm(to)}`} por temporada`}>
            {data.seasons.map((s) => <li key={s.season} data-testid="km-season"><SeasonSummary s={s} single={single} /></li>)}
          </ul>
          {!single && withRows.length > 0 && (
            <details className="area-more">
              <summary>Ver día a día</summary>
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="visually-hidden">Km abiertos por día y temporada</caption>
                  <thead><tr><th scope="col">Día</th>{data.seasons.map((s) => <th key={s.season} scope="col">{s.season}</th>)}</tr></thead>
                  <tbody>{mmdds.map((m) => (
                    <tr key={m}><th scope="row">{ddmm(m)}</th>{data.seasons.map((s) => {
                      const d = s.dates.find((x) => x.date.slice(5) === m);
                      return <td key={s.season}>{d ? <>{dayText(d)}{d.origin === 'antiguo' && d.status === 'value' && <span className="muted"> *</span>}</> : <span className="muted">no existe</span>}</td>;
                    })}</tr>
                  ))}</tbody>
                </table>
              </div>
              {data.seasons.some((s) => s.dates.some((d) => d.origin === 'antiguo' && d.status === 'value')) && <p className="small muted">* Dato del SkiTrip antiguo, sin verificar.</p>}
            </details>
          )}
          <details className="area-more">
            <summary>Ver detalles<span className="visually-hidden"> de la comparación de km de {name}</span></summary>
            <ul className="small muted run-notes">
              <li>Temporadas revisadas: desde la primera con algún dato de {name}{data.firstDataDate && ` (${numDate(data.firstDataDate)})`} hasta la actual. Antes no hay ninguna fuente diaria que se pueda leer.</li>
              <li>{KM_ORIGIN_LABEL.parte[0].toUpperCase() + KM_ORIGIN_LABEL.parte.slice(1)}: solo partes con la fecha publicada por la fuente igual a ese día, del mismo ámbito y sin avisos de calidad. Si hay varias fuentes, la preferente (la oficial antes que un agregador){providers.length > 0 && `; usadas aquí: ${providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}`}.</li>
              <li>«Cerrada»: el parte confirma la estación cerrada o fuera de temporada; cuenta como 0 km esquiables.</li>
              <li>{KM_ORIGIN_LABEL.antiguo}: la serie que guardaba la versión anterior de SkiTrip (Esquiades, desde el 21/12/2025), con la fecha en que se capturó y sin comprobar. Un 0 de esa serie puede ser un «-» (sin dato), así que se muestra como «0 o sin dato» y no entra en la media.</li>
              <li>La media es la de los días con dato de cada temporada; no se rellenan días que faltan ni se toman de otra fecha o de otra estación.</li>
              <li>Lo que había otros años no predice lo que habrá en un viaje futuro.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
