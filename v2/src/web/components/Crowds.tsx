// Ficha › Afluencia histórica: el mismo día y mes de años anteriores, solo observaciones verificables. Cada estación de
// un dominio aparece por separado (nada se suma ni se atribuye al dominio). Mientras llega la respuesta de un día nuevo
// no se muestra nada del anterior (useKeyedResource).
import { get } from '../api';
import { useKeyedResource } from '../hooks';
import { setQuery } from '../router';
import { dayLong } from '../format';
import { Loading, ErrorState } from './States';
import { todayMadrid } from '../../core/dates';
import {
  CROWD_MEASURE_LABEL, CROWD_SAMPLE_LABEL, CROWD_UNIT, INTENSITY_MISSING_LABEL, validMmdd,
  type CrowdObservation, type IntensityMissing, type SameDaySummary,
} from '../../core/crowds';

type Intensity = { value: number; openKm: number; sourceId: string } | { value: null; missing: IntensityMissing; openKm: number | null };
interface CrowdScope { areaId: string; name: string; observations: (CrowdObservation & { weekday: string; intensity: Intensity })[]; summary: SameDaySummary[] }
interface CrowdResponse { mmdd: string; yearsChecked: number[]; scopes: CrowdScope[] }

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUM = new Intl.NumberFormat('es-ES');
const pad = (n: number) => String(n).padStart(2, '0');
const mmddText = (mmdd: string) => `${Number(mmdd.slice(3))} de ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}`;
const daysIn = (month: number) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
const years = (ys: number[]) => (ys.length ? ys.join(', ') : 'ninguno');

export function CrowdSection({ areaId, name, mmddParam }: { areaId: string; name: string; mmddParam: string | null }) {
  const mmdd = mmddParam && validMmdd(mmddParam) ? mmddParam : todayMadrid().slice(5);
  const month = Number(mmdd.slice(0, 2)), day = Number(mmdd.slice(3));
  const r = useKeyedResource(`${areaId}|${mmdd}`, () => get<CrowdResponse>(`/api/public/areas/${encodeURIComponent(areaId)}/crowds?dia=${mmdd}`));
  const set = (m: number, d: number) => setQuery('afluencia', `${pad(m)}-${pad(Math.min(d, daysIn(m)))}`);
  const data = r.data && r.data.mmdd === mmdd ? r.data : null;
  const own = data?.scopes[0];
  const members = data?.scopes.slice(1) ?? [];
  const sources = data ? [...new Map(data.scopes.flatMap((s) => s.observations).map((o) => [o.sourceRef, o])).values()] : [];
  return (
    <section className="panel stack" aria-labelledby="a-crowd">
      <h2 id="a-crowd">Afluencia histórica</h2>
      <div className="filters">
        <div className="field field-inline">
          <label htmlFor="crowd-day">Día</label>
          <select id="crowd-day" value={day} onChange={(e) => set(month, Number(e.target.value))}>
            {Array.from({ length: daysIn(month) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <div className="field field-inline">
          <label htmlFor="crowd-month">Mes</label>
          <select id="crowd-month" value={month} onChange={(e) => set(Number(e.target.value), day)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <p className="small muted">El {mmddText(mmdd)} de años anteriores. Solo cifras publicadas y verificables; el histórico no predice cuánta gente habrá en una fecha futura.</p>
      {r.error && !data ? <ErrorState message={r.error} onRetry={r.reload} /> : !data ? <Loading label="Cargando afluencia…" /> : (
        <>
          <ScopeBlock scope={own!} checked={data.yearsChecked} mmdd={mmdd} heading={null} />
          {members.map((m) => <ScopeBlock key={m.areaId} scope={m} checked={data.yearsChecked} mmdd={mmdd} heading={m.name} />)}
          <details className="area-more">
            <summary>Ver detalles<span className="visually-hidden"> de la afluencia de {name}</span></summary>
            <div className="stack-s small">
              {sources.length > 0 && (
                <ul className="list" aria-label="Fuentes de la afluencia">
                  {sources.map((o) => (
                    <li key={o.sourceRef}><a href={o.sourceRef} target="_blank" rel="noopener noreferrer">{o.sourceTitle ?? o.sourceRef}<span className="visually-hidden"> (se abre en otra pestaña)</span></a>
                      {o.sourcePublished && ` · publicada el ${dayLong(o.sourcePublished)}`}</li>
                  ))}
                </ul>
              )}
              <ul className="muted run-notes">
                <li>Años revisados para este día: {years(data.yearsChecked)} (desde el primer año con alguna observación guardada).{mmdd === '02-29' && ' El 29 de febrero solo existe en años bisiestos: no se sustituye por otra fecha.'}</li>
                <li>Se distinguen esquiadores del día, visitantes, días de esquí vendidos y pasos por remontes; no se mezclan ni se comparan entre sí.</li>
                <li>Las cifras de un grupo de estaciones, de varios días o de toda la temporada no se atribuyen a una estación ni se reparten entre días.</li>
                <li>«Cierre confirmado» no es cero visitantes; «Sin dato» es falta de información.</li>
                <li>Intensidad diaria = esquiadores del día ÷ km abiertos ese mismo día según el parte de la estación (mismo ámbito). No es densidad simultánea en pistas ni tiempo de espera. No se usan los km del catálogo ni de otro día.</li>
                <li>Porcentaje de capacidad: no se calcula. No hay un aforo documentado compatible con la asistencia diaria (la capacidad de remontes por hora, los aparcamientos o los récords no son aforo).</li>
                <li>Las medias solo usan cifras de la misma medida y estación, con al menos dos años. Con muestras de récord, la media no representa la afluencia habitual.</li>
              </ul>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function ScopeBlock({ scope, checked, mmdd, heading }: { scope: CrowdScope; checked: number[]; mmdd: string; heading: string | null }) {
  const body = !scope.observations.length ? (
    <p className="small" data-testid="crowd-empty"><strong>Sin dato</strong> para el {mmddText(mmdd)}{checked.length ? ` en ${checked.length === 1 ? 'el año revisado' : `los ${checked.length} años revisados`}` : ''}.</p>
  ) : (
    <>
      <ul className="list crowd-list" aria-label={`Afluencia del ${mmddText(mmdd)}${heading ? ` en ${heading}` : ''}`}>
        {scope.observations.map((o) => (
          <li key={o.id} className="stack-s">
            <span><strong>{dayLong(o.date)}</strong> · {o.status === 'closed' ? 'Cierre confirmado (sin cifra)' : <>{NUM.format(o.value!)} {CROWD_UNIT[o.measure]}</>}
              {o.sample !== 'regular' && <> <span className="tag tag-warn">{CROWD_SAMPLE_LABEL[o.sample]}</span></>}</span>
            <span className="small">Km abiertos ese día: {o.intensity.openKm != null ? `${NUM.format(o.intensity.openKm)} km` : 'Sin dato'}
              {' · '}Intensidad diaria: {o.intensity.value != null ? `${NUM.format(o.intensity.value)} esquiadores por km abierto` : <span className="muted">no calculable ({INTENSITY_MISSING_LABEL[o.intensity.missing]})</span>}</span>
          </li>
        ))}
      </ul>
      <ul className="small run-notes">
        {scope.summary.map((s) => (
          <li key={s.measure}>
            <strong>{CROWD_MEASURE_LABEL[s.measure]}</strong>: {s.observations} {s.observations === 1 ? 'observación' : 'observaciones'}; con cifra en {years(s.yearsWithValue)}
            {s.yearsClosed.length > 0 && `; cierre confirmado en ${years(s.yearsClosed)}`}; sin dato en {years(s.yearsWithout)}.
            {' '}{s.mean != null ? `Media de ${s.yearsWithValue.length} años: ${NUM.format(s.mean)} ${CROWD_UNIT[s.measure]} (de ${NUM.format(s.min!)} a ${NUM.format(s.max!)}).` : 'Sin media: hace falta más de un año con cifra.'}
            {s.selectedSample && <span className="text-warn"> Incluye muestras de récord o seleccionadas: no representan la afluencia habitual.</span>}
          </li>
        ))}
      </ul>
    </>
  );
  return heading ? <div className="stack-s"><h3>{heading}</h3>{body}</div> : body;
}
