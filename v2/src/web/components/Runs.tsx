// Pistas y variedad: número de pistas del catálogo y abiertas del parte, siempre con número y etiqueta además del
// color. Un dato ausente se dice «sin dato»; la procedencia (fuente, temporada, fechas, criterio) va aparte.
import { numDate, plural } from '../format';
import { RUN_CATALOG_ISSUE_LABEL, RUN_COLOURS, RUN_COLOUR_LABEL, RUNS_NOW_EXCLUSION_LABEL, type ByColour, type EntryCatalogRuns, type RunsNow } from '../../core/runs';
import type { RunCatalog } from '../catalog';
import { RUN_FIELD_LABEL } from '../../core/runs-manual';

export const RUNS_CRITERION = 'Pistas de esquí alpino según las identifica cada estación; el criterio de recuento puede variar entre estaciones (p. ej. tramos contados por separado).';

/** Desglose por colores: un punto de color, el número y la etiqueta. Con `of`, «abiertas de total» por color. */
export function RunColours({ v, of = null, label }: { v: ByColour; of?: ByColour | null; label: string }) {
  return (
    <ul className="run-colours" aria-label={label}>
      {RUN_COLOURS.map((c) => (
        <li key={c} className={`run-colour run-${c}`}>
          <span className="run-dot" aria-hidden="true" />
          {v[c] == null ? `${RUN_COLOUR_LABEL[c].many}: sin dato` : <><strong>{v[c]}</strong>{of?.[c] != null && ` de ${of[c]}`} {v[c] === 1 && of?.[c] == null ? RUN_COLOUR_LABEL[c].one : RUN_COLOUR_LABEL[c].many}</>}
        </li>
      ))}
    </ul>
  );
}

/** Catálogo (Planificar): total comparable con su desglose; si no hay, lo publicado con por qué no puntúa. */
export function CatalogRunsText({ cat, name }: { cat: EntryCatalogRuns; name: string }) {
  if (cat.comparableTotal != null) {
    return (
      <>
        <strong>{cat.comparableTotal}</strong>{cat.via === 'members' && <span className="muted small"> (suma de sus estaciones)</span>}
        {cat.byColour ? <RunColours v={cat.byColour} label={`Pistas de ${name} por color`} /> : <span className="muted small"> · sin desglose por colores</span>}
      </>
    );
  }
  const own = cat.own;
  if (own?.total == null) return <>Sin dato</>;
  const why = own.issues.filter((i) => i !== 'sin_total').map((i) => RUN_CATALOG_ISSUE_LABEL[i])[0];
  // Se conservan las cifras publicadas (total y colores) aunque no puntúen.
  return (
    <>
      {own.total} publicadas <span className="small text-warn">· no puntúa: {why}</span>
      {RUN_COLOURS.some((c) => own.byColour[c] != null) && <RunColours v={own.byColour} label={`Colores publicados de ${name}`} />}
    </>
  );
}

/** Parte actual (Esquiar ahora): abiertas frente al total del mismo parte; sin parte vigente nunca se usa el catálogo. */
export function NowRunsText({ now, name, catalogTotal, reportDate }: { now: RunsNow; name: string; catalogTotal: number | null; reportDate: string | null | undefined }) {
  const cat = catalogTotal != null && <span className="muted small"> · catálogo: {plural(catalogTotal, 'pista', 'pistas')}</span>;
  if (now.open == null) return <>sin parte vigente de pistas <span className="muted small">({RUNS_NOW_EXCLUSION_LABEL[now.excluded ?? 'sin_dato']})</span>{cat}</>;
  if (now.derivedFromClosure) return <>0 abiertas <span className="muted small">· deducido del cierre que confirma la fuente</span>{cat}</>;
  return (
    <>
      <strong>{now.open}</strong> abiertas{now.total != null && <> de {now.total}</>}
      <span className="muted small">{reportDate ? ` · parte del ${numDate(reportDate)}` : ' · la fuente no publica fecha de parte'}</span>
      {now.byColour && <RunColours v={now.byColour} of={now.totalByColour} label={`Pistas abiertas de ${name} por color`} />}
      {now.colourIssue && <span className="small text-warn"> · desglose por colores no mostrado: {now.colourIssue}</span>}
      {now.totalColourIssue && <span className="small text-warn"> · totales por color no usados: {now.totalColourIssue}</span>}
      {now.total == null && cat}
    </>
  );
}

/** Enlace a una fuente solo si es una dirección https; una cita textual se muestra tal cual. */
function SourceRef({ refText, label }: { refText: string; label: string }) {
  return /^https:\/\//i.test(refText)
    ? <a href={refText} target="_blank" rel="noopener noreferrer">{label}<span className="visually-hidden"> (se abre en otra pestaña)</span></a>
    : <>{label}: «{refText}»</>;
}

/**
 * Procedencia de la cifra del catálogo: fuente, temporada o fecha del dato y día de consulta (no es la fecha del dato).
 * Una aportación manual de administración se dice como tal, con su referencia y el día en que se introdujo: nunca como
 * una comprobación automática oficial.
 */
export function RunsProvenance({ r, withLimits = false }: { r: RunCatalog; withLimits?: boolean }) {
  const when = (season: string | null, date: string | null) => [season ? `temporada ${season}` : null, date ? `dato del ${numDate(date)}` : 'sin fecha del dato publicada'].filter(Boolean).join(' · ');
  const m = r.manual;
  if (r.origin === 'manual' && m) {
    return (
      <span className="small">
        <SourceRef refText={m.sourceRef} label="Aportación manual de administración" />
        <span className="muted"> · total publicado · {when(m.season, m.sourceDate)} · introducido el {numDate(m.enteredOn)}</span>
        {withLimits && m.resolution && <span className="muted"> · {m.resolution}</span>}
      </span>
    );
  }
  return (
    <span className="small">
      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.basis === 'individual' ? 'Listado oficial' : 'Cifra oficial'}<span className="visually-hidden"> (se abre en otra pestaña)</span></a>
      <span className="muted"> · {r.basis === 'individual' ? 'contado pista a pista' : 'total publicado'} · {when(r.season, r.sourceDate)} · consultado el {numDate(r.checkedOn)}</span>
      {withLimits && r.limitations && <span className="muted"> · {r.limitations}</span>}
      {m && m.fields.length > 0 && (
        <span className="muted"> · completado con una aportación manual ({m.fields.map((f) => RUN_FIELD_LABEL[f]).join(', ')}: <SourceRef refText={m.sourceRef} label="referencia" />, {when(m.season, m.sourceDate)}, introducido el {numDate(m.enteredOn)})</span>
      )}
    </span>
  );
}
