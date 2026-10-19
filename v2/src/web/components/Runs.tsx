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

const someColour = (v: ByColour | null | undefined) => !!v && RUN_COLOURS.some((c) => v[c] != null);

/**
 * Catálogo (Planificar): total comparable con su desglose; si no hay, lo publicado con por qué no puntúa. Un desglose
 * parcial muestra los colores conocidos y dice «sin dato» en los demás: nunca se inventa el total ni se rellena con ceros.
 */
export function CatalogRunsText({ cat, name }: { cat: EntryCatalogRuns; name: string }) {
  const own = cat.own;
  const partialLabel = `Colores conocidos de ${name} (desglose parcial)`;
  if (cat.comparableTotal != null) {
    const partial = cat.via === 'own' && own && !own.breakdownComplete && someColour(own.byColour);
    return (
      <>
        <strong>{cat.comparableTotal}</strong>{cat.via === 'members' && <span className="muted small"> (suma de sus estaciones)</span>}
        {cat.byColour ? <RunColours v={cat.byColour} label={`Pistas de ${name} por color`} />
          : partial ? <><span className="muted small"> · desglose parcial</span><RunColours v={own!.byColour} label={partialLabel} /></>
          : <span className="muted small"> · sin desglose por colores</span>}
      </>
    );
  }
  if (own?.total == null) {
    if (!someColour(own?.byColour)) return <>Sin dato</>;
    // Solo colores: se ven, pero sin total no hay cifra que puntúe.
    return (
      <>
        Total sin dato <span className="small muted">· desglose parcial · no puntúa</span>
        <RunColours v={own!.byColour} label={partialLabel} />
      </>
    );
  }
  // Resumen: la cifra publicada con una advertencia breve; el porqué va en los detalles (RunsIssueDetail).
  return (
    <>
      {plural(own.total, 'pista publicada', 'pistas publicadas')} <span className="small text-warn">· dato por revisar · no puntúa</span>
      {someColour(own.byColour) && <RunColours v={own.byColour} label={`Colores publicados de ${name}`} />}
    </>
  );
}

/**
 * Detalle de por qué una cifra no puntúa o de dónde sale: discrepancia, desglose que no cuadra, cifra importada
 * sustituida por una aportación manual y su explicación. Va en «Ver detalles»; el resumen solo dice «dato por revisar».
 */
export function RunsIssueDetail({ cat, runs, members = false }: { cat: EntryCatalogRuns; runs: RunCatalog | null | undefined; members?: boolean }) {
  const why = cat.comparableTotal == null && cat.own ? cat.own.issues.filter((i) => i !== 'sin_total').map((i) => RUN_CATALOG_ISSUE_LABEL[i]) : [];
  const items = [
    ...why.map((w) => `No puntúa: ${w}.`),
    cat.pendingDiscrepancy && members ? 'La cifra propia no se sustituye por la suma de sus estaciones hasta resolver la discrepancia con evidencia.' : null,
    runs?.limitations ?? null,
    runs?.manual?.resolution ? `Resolución con evidencia: ${runs.manual.resolution}` : null,
    runs?.superseded ? `Sustituye a la cifra importada (${runs.superseded.total != null ? plural(runs.superseded.total, 'pista publicada', 'pistas publicadas') : 'sin total'}${runs.superseded.comparable ? '' : ', no comparable'}${runs.superseded.limitations ? `: ${runs.superseded.limitations}` : ''}).` : null,
  ].filter((x): x is string => !!x);
  if (!items.length) return null;
  return <ul className="small muted run-notes">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
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
