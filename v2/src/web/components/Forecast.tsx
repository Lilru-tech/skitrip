// Previsión para unas fechas (ficha de estación). Separada del parte actual y del clima habitual: aquí solo hay modelos
// de previsión, cada uno con su nombre, sin medias entre ellos y respetando su horizonte. Resumen sencillo arriba y el
// detalle por día y modelo, la altitud, la ubicación, las pasadas y la atribución en «Ver detalles».
import { useState } from 'react';
import { get, qs } from '../api';
import { dayShort, instant, numDate, plural } from '../format';
import { useKeyedResource, useResource } from '../hooks';
import { setQuery, useLocation } from '../router';
import { useSession } from '../session';
import { addDaysIso, daysBetweenIso, NEAR_MAX_LEAD, SKI_FROM_HOUR, SKI_TO_HOUR, STRONG_GUST_KMH, TREND_MAX_LEAD, type DayView, type Freshness, type Horizon, type TripForecastSummary } from '../../core/weather';
import { todayMadrid } from '../../core/dates';
import type { Trip } from '../types';

export interface ForecastPoint {
  areaId: string; name: string;
  point: { lat: number; lon: number; elevation: number; baseM: number; topM: number; altitudeSource: string; altitudeNote: string | null; location: string; locationSource: string };
  fetchedAt: number | null; freshness: Freshness | null; cell: { lat: number; lon: number; elevation: number } | null;
  models: { id: string; label: string; provider: string; runAt: number | null }[];
  lastError: string | null; days: DayView[]; summary: TripForecastSummary;
}
export interface ForecastResponse { today: string; from: string; to: string; attribution: string; horizonLabels: Record<Horizon, string>; notice: string | null; points: ForecastPoint[] }
export interface CompareForecast { areaId: string; fetchedAt: number | null; freshness: Freshness | null; summary: TripForecastSummary; horizons: Horizon[] }

const n1 = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
/** «0–9,6» o «4» si los extremos coinciden. */
export const spanText = (r: [number, number] | null, unit: string) => (r == null ? 'sin dato' : r[0] === r[1] ? `${n1(r[0])} ${unit}` : `${n1(r[0])} a ${n1(r[1])} ${unit}`);
const HORIZON_TAG: Record<Horizon, string> = { near: 'tag-ok', trend: 'tag-quiet', beyond: 'tag-quiet', past: 'tag-quiet' };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Resumen de una línea (lo que se ve sin abrir detalles), común a la ficha y a Comparar. */
export function ForecastSummaryText({ s }: { s: TripForecastSummary }) {
  if (s.state === 'none') return <>Todavía no hay previsión disponible para estas fechas.</>;
  const r = s.range;
  return (
    <>
      Nieve nueva {spanText(r.snow, 'cm')}/día · lluvia {spanText(r.rain, 'mm')}/día · {r.tMin && r.tMax ? `${n1(r.tMin[0])} a ${n1(r.tMax[1])} °C` : 'temperatura sin dato'} · rachas de hasta {spanText(r.gustMax, 'km/h')}
      {' '}<span className="muted">({plural(s.modelCount, 'modelo', 'modelos')}{s.state === 'partial' && `, ${s.coveredDays} de ${s.days} días`})</span>
    </>
  );
}

export function FreshnessNote({ freshness, fetchedAt }: { freshness: Freshness | null; fetchedAt: number | null }) {
  if (!freshness || fetchedAt == null) return null;
  if (freshness === 'fresh') return <span className="muted">Consultada {instant(fetchedAt)}.</span>;
  return <span className={freshness === 'stale' ? 'text-warn' : 'muted'}>{freshness === 'stale' ? 'Previsión antigua' : 'Previsión de hace unas horas'}: consultada {instant(fetchedAt)}.</span>;
}

export function ForecastSection({ areaId, name }: { areaId: string; name: string }) {
  const { query } = useLocation();
  const today = todayMadrid();
  const qFrom = query.get('desde');
  const qTo = query.get('hasta');
  const from = qFrom && ISO.test(qFrom) ? qFrom : today;
  const to = qTo && ISO.test(qTo) && qTo >= from ? qTo : addDaysIso(from, NEAR_MAX_LEAD);
  const key = `${areaId}|${from}|${to}`;
  const f = useKeyedResource(key, () => get<ForecastResponse>(`/api/public/areas/${encodeURIComponent(areaId)}/forecast?${qs({ desde: from, hasta: to })}`));
  const setRange = (a: string, b: string) => { setQuery('desde', a); setQuery('hasta', b); };
  const data = f.data;
  return (
    <section className="panel stack" aria-labelledby="a-forecast" data-testid="forecast">
      <h2 id="a-forecast">Previsión para tus fechas</h2>
      <ForecastDates from={from} to={to} today={today} onChange={setRange} />
      {f.loading && !data ? <p className="small muted">Cargando la previsión…</p> : f.error ? (
        <p className="notice notice-warn small">No se ha podido cargar la previsión: {f.error} <button type="button" className="btn-link" onClick={() => void f.reload()}>Reintentar</button></p>
      ) : data && (
        <>
          {data.notice && <p className="notice notice-warn small" role="status">{data.notice}</p>}
          {data.points.length === 0 ? <p className="small muted">Esta estación no tiene punto de previsión definido.</p> : (
            <ul className="list stack-s" aria-label={`Previsión de ${name}`}>
              {data.points.map((p) => (
                <li key={p.areaId} data-testid={`forecast-${p.areaId}`}>
                  {data.points.length > 1 && <strong>{p.name}: </strong>}
                  <span data-testid="forecast-summary">{p.summary.state === 'none' && !p.fetchedAt && p.days.some((d) => d.horizon === 'near' || d.horizon === 'trend')
                    ? 'No hay ninguna previsión guardada para este punto: no se puede decir nada de estas fechas.' : <ForecastSummaryText s={p.summary} />}</span>
                  {p.summary.state === 'partial' && <p className="small text-warn">Sin previsión para {p.summary.uncoveredDays.map((d) => dayShort(d)).join(', ')}: esos días no cuentan como buen tiempo.</p>}
                  <p className="small"><FreshnessNote freshness={p.freshness} fetchedAt={p.fetchedAt} /></p>
                </li>
              ))}
            </ul>
          )}
          {data.points.length > 0 && (
            <details className="area-more">
              <summary>Ver detalles<span className="visually-hidden"> de la previsión de {name}</span></summary>
              <div className="stack">
                {data.points.map((p) => <PointDetail key={p.areaId} p={p} labels={data.horizonLabels} multi={data.points.length > 1} />)}
                <ul className="small muted run-notes">
                  <li>Previsión próxima: de hoy a {NEAR_MAX_LEAD} días. Tendencia: de {NEAR_MAX_LEAD + 1} a {TREND_MAX_LEAD} días, solo totales del día y con menos modelos. Más allá no se muestra nada.</li>
                  <li>Cada modelo se muestra por separado; los rangos van del modelo más bajo al más alto, sin medias. Un día que un modelo no cubre entero no se rellena.</li>
                  <li>Franja de esquí: {SKI_FROM_HOUR}:00 a {SKI_TO_HOUR}:00 (hora peninsular). Racha fuerte: {STRONG_GUST_KMH} km/h o más, referencia de SkiTrip, no el límite de cierre de ningún remonte.</li>
                  <li>La nieve nueva es la que da cada modelo (cm); no se calcula a partir de la lluvia.</li>
                  <li>{data.attribution}</li>
                </ul>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ForecastDates({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (a: string, b: string) => void }) {
  const { state } = useSession();
  const signedIn = state.status === 'ready';
  const trips = useResource(() => (signedIn ? get<{ trips: Trip[] }>('/api/trips') : Promise.resolve({ trips: [] as Trip[] })), [signedIn]);
  const dated = (trips.data?.trips ?? []).filter((t) => t.startDate && t.endDate && (t.status === 'planning' || t.status === 'decided') && t.endDate >= today);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const span = ISO.test(a) && ISO.test(b) ? daysBetweenIso(a, b) : -1;
  const valid = span >= 0 && span < 31;
  return (
    <div className="stack-s">
      {dated.length > 0 && (
        <p className="row-wrap small">
          <span>Fechas de tus viajes:</span>
          {dated.map((t) => (
            <button key={t.id} type="button" className={`btn btn-small ${t.startDate === from && t.endDate === to ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setA(t.startDate!); setB(t.endDate!); onChange(t.startDate!, t.endDate!); }}>
              {t.name} ({numDate(t.startDate!)}–{numDate(t.endDate!)})
            </button>
          ))}
        </p>
      )}
      <form className="row-wrap small" onSubmit={(e) => { e.preventDefault(); if (valid) onChange(a, b); }}>
        <label>Desde <input type="date" value={a} onChange={(e) => setA(e.target.value)} required /></label>
        <label>Hasta <input type="date" value={b} min={a} onChange={(e) => setB(e.target.value)} required /></label>
        <button type="submit" className="btn btn-secondary btn-small" disabled={!valid}>Ver previsión</button>
        {span >= 31 && <span className="text-warn">Como mucho 31 días.</span>}
      </form>
    </div>
  );
}

function PointDetail({ p, labels, multi }: { p: ForecastPoint; labels: Record<Horizon, string>; multi: boolean }) {
  const pt = p.point;
  return (
    <div className="stack-s" data-testid={`forecast-detail-${p.areaId}`}>
      {multi && <h3>{p.name}</h3>}
      <ul className="list stack-s" aria-label={`Previsión por día${multi ? ` de ${p.name}` : ''}`}>
        {p.days.map((d) => (
          <li key={d.date}>
            <p><strong>{dayShort(d.date)}</strong> <span className={`tag ${HORIZON_TAG[d.horizon]}`}>{labels[d.horizon]}</span></p>
            {d.models.length === 0 ? (
              <p className="small muted">{d.horizon === 'near' || d.horizon === 'trend' ? 'Ningún modelo cubre este día entero: sin dato.' : labels[d.horizon]}</p>
            ) : (
              <ul className="small run-notes">
                {d.models.map((m) => {
                  const x = m.day;
                  return (
                    <li key={m.id}>
                      <strong>{m.label}</strong>: nieve {x.snow == null ? 'sin dato' : `${n1(x.snow)} cm`}, lluvia {x.rain == null ? 'sin dato' : `${n1(x.rain)} mm`}, {x.tMin == null || x.tMax == null ? 'temperatura sin dato' : `${n1(x.tMin)} a ${n1(x.tMax)} °C`}, viento hasta {x.windMax == null ? 'sin dato' : `${n1(x.windMax)} km/h`}, rachas hasta {x.gustMax == null ? 'sin dato' : `${n1(x.gustMax)} km/h`}
                      {d.horizon === 'near' && x.ski.hours > 0 && <> · en horario de esquí: lluvia {x.ski.rain == null ? 'sin dato' : `${n1(x.ski.rain)} mm`}, {x.ski.strongGustHours == null ? 'rachas sin dato' : plural(x.ski.strongGustHours, 'hora', 'horas') + ` con racha ≥ ${STRONG_GUST_KMH} km/h`}</>}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <ul className="small muted run-notes">
        <li>Punto: {pt.location} ({pt.locationSource}). Altitud pedida: {pt.elevation.toLocaleString('es-ES')} m, en pistas (base {pt.baseM.toLocaleString('es-ES')} m, cima {pt.topM.toLocaleString('es-ES')} m; {pt.altitudeSource}){pt.altitudeNote && `. ${pt.altitudeNote}`}.</li>
        {p.cell && <li>Ajustado por Open-Meteo a {p.cell.elevation.toLocaleString('es-ES')} m (celda {n1(p.cell.lat)}, {n1(p.cell.lon)}). SkiTrip no aplica correcciones propias.</li>}
        <li>Modelos: {p.models.map((m) => `${m.label}, pasada ${m.runAt ? instant(m.runAt) : 'sin dato'}`).join('; ')}.</li>
        {p.lastError && <li className="text-warn">Último error al actualizar: {p.lastError}</li>}
      </ul>
    </div>
  );
}
