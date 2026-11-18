// Clima habitual para las fechas elegidas (las mismas que la previsión): ERA5, «Histórico reconstruido». Separado del
// parte actual y de la previsión; nunca dice «probabilidad» ni rellena días sin dato.
import { get, qs } from '../api';
import { numDate } from '../format';
import { useKeyedResource } from '../hooks';
import { useLocation } from '../router';
import { addDaysIso, NEAR_MAX_LEAD } from '../../core/weather';
import { todayMadrid } from '../../core/dates';
import type { ClimateSummary, Dist, Freq } from '../../core/climate';

interface ClimatePoint {
  areaId: string; name: string;
  point: { elevation: number; location: string };
  cell: { lat: number; lon: number; elevation: number; requestedElevation: number | null } | null;
  seasonsStored: number; seasonsNeeded: number; summary: ClimateSummary | null;
}
interface ClimateResponse {
  from: string; to: string; source: string; period: { from: number; to: number }; windowDays: number;
  thresholds: { precipMm: number; snowCm: number; gustKmh: number };
  state: 'ok' | 'out_of_season' | 'invalid' | 'too_long'; points: ClimatePoint[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const n1 = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
const distText = (d: Dist) => (d.median == null ? 'sin dato' : `${n1(d.median)} °C (${n1(d.p10!)} a ${n1(d.p90!)})`);
const freqText = (f: Freq) => (f.of === 0 ? 'sin dato' : `${f.days} de ${f.of} días`);

export function ClimateSection({ areaId, name }: { areaId: string; name: string }) {
  const { query } = useLocation();
  const today = todayMadrid();
  const qFrom = query.get('desde');
  const qTo = query.get('hasta');
  const from = qFrom && ISO.test(qFrom) ? qFrom : today;
  const to = qTo && ISO.test(qTo) && qTo >= from ? qTo : addDaysIso(from, NEAR_MAX_LEAD);
  const c = useKeyedResource(`${areaId}|${from}|${to}`, () => get<ClimateResponse>(`/api/public/areas/${encodeURIComponent(areaId)}/climate?${qs({ desde: from, hasta: to })}`));
  const d = c.data;
  return (
    <section className="panel stack" aria-labelledby="a-climate" data-testid="climate">
      <h2 id="a-climate">Clima habitual en estas fechas</h2>
      <p className="small muted">Del {numDate(from)} al {numDate(to)}, con 7 días antes y después, en años anteriores. No es una previsión.</p>
      {c.loading && !d ? <p className="small muted">Cargando el clima habitual…</p> : c.error ? (
        <p className="notice notice-warn small">No se ha podido cargar el clima habitual: {c.error} <button type="button" className="btn-link" onClick={() => void c.reload()}>Reintentar</button></p>
      ) : d && (
        d.state !== 'ok' ? <p className="small" data-testid="climate-summary">{d.state === 'out_of_season' ? 'El clima habitual solo está preparado para la temporada de esquí: fechas del 27/10 al 3/05.' : 'Fechas no válidas para el clima habitual.'}</p>
          : d.points.length === 0 ? <p className="small muted">Esta estación no tiene punto meteorológico definido.</p> : (
            <>
              <ul className="list stack-s" aria-label={`Clima habitual de ${name}`}>
                {d.points.map((p) => {
                  const s = p.summary;
                  return (
                    <li key={p.areaId} data-testid={`climate-${p.areaId}`}>
                      {d.points.length > 1 && <strong>{p.name}: </strong>}
                      <span data-testid="climate-summary">{!s || s.years === 0 ? 'Todavía no está preparado el histórico de este punto.' : (
                        <>Máximas {distText(s.tmax)} · mínimas {distText(s.tmin)} · nieve nueva ≥ {d.thresholds.snowCm} cm {freqText(s.snowDays)} · precipitación ≥ {d.thresholds.precipMm} mm {freqText(s.precipDays)} · rachas ≥ {d.thresholds.gustKmh} km/h {freqText(s.strongGustDays)}
                          {' '}<span className="muted">({s.years} {s.years === 1 ? 'año' : 'años'})</span></>
                      )}</span>
                      {s && s.years > 0 && s.years < s.expectedYears && <p className="small text-warn">Faltan {s.expectedYears - s.years} de {s.expectedYears} años: se resume con los que hay.</p>}
                    </li>
                  );
                })}
              </ul>
              <details className="area-more">
                <summary>Ver detalles<span className="visually-hidden"> del clima habitual de {name}</span></summary>
                <ul className="small muted run-notes">
                  <li>{d.source}. Es una reconstrucción de modelo, no una medición en la estación.</li>
                  <li>Años {d.period.from}–{d.period.to}: en cada uno, del día de inicio −{d.windowDays} al de fin +{d.windowDays}. Es un periodo reciente de 30 años, no la normal climatológica oficial.</li>
                  <li>Temperatura: mediana diaria y, entre paréntesis, de los días más fríos a los más cálidos (percentiles 10 y 90). Precipitación: mediana diaria {d.points.map((p) => p.summary?.precipMedian != null ? `${n1(p.summary.precipMedian)} mm${d.points.length > 1 ? ` (${p.name})` : ''}` : null).filter(Boolean).join(', ') || 'sin dato'}.</li>
                  <li>«X de Y días» cuenta días con dato; un día sin dato no cuenta ni se rellena con 0. La nieve es la que calcula el modelo (cm), no se deduce de la lluvia. {d.thresholds.gustKmh} km/h es una referencia de SkiTrip.</li>
                  {d.points.map((p) => p.cell && (
                    <li key={p.areaId}>{d.points.length > 1 && `${p.name}: `}punto {p.point.location}; altitud pedida {p.cell.requestedElevation ?? p.point.elevation} m, ajustado por Open-Meteo a {n1(p.cell.elevation)} m (celda de 0,25°, {n1(p.cell.lat)}, {n1(p.cell.lon)}). Temporadas guardadas: {p.seasonsStored} de {p.seasonsNeeded}.</li>
                  ))}
                  <li>El 29/02 solo existe en años bisiestos; en los demás la ventana va del 28/02 al 01/03 sin inventar el día. Fuera de la temporada (del 11/05 al 19/10) no hay datos preparados.</li>
                </ul>
              </details>
            </>
          )
      )}
    </section>
  );
}
