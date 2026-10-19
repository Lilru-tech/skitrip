// Aportaciones manuales de administración al catálogo de pistas (total y colores) y resolución del dato efectivo.
//
// Hay dos procedencias que nunca se confunden:
//  - Catálogo importado (area_runs): lo carga la publicación desde data/catalog.json, revisado con fuente oficial.
//    Es la información «automática»: cada publicación lo reimporta.
//  - Aportación manual (area_run_contributions): la introduce un administrador con una fuente o referencia, la temporada
//    si se conoce y un motivo. Se guarda aparte, con historial, y la importación nunca la borra.
//
// resolveRunCatalog es la ÚNICA regla que decide qué cifra vale (fichas, Comparar, dominios y puntuación la reciben ya
// resuelta del Worker):
//  1. Si el catálogo importado tiene cifras válidas (enteros, desglose coherente, comparable) y no consta que sean de una
//     temporada anterior a la de la aportación, prevalece. La aportación solo completa los huecos (un color o el total
//     que falta), siempre que la combinación siga cuadrando y la aportación no se declare no comparable; si no cuadra,
//     no se mezcla y se explica.
//  2. Si el catálogo importado no tiene cifras, no es válido (discrepancia pendiente, desglose que no cuadra) o consta
//     que es de una temporada anterior, la aportación sustituye la cifra entera: nunca se mezclan colores y totales de
//     fuentes o temporadas distintas.
//  3. Una aportación retirada no cuenta; restaurarla vuelve a pasar por estas mismas reglas.
// Las cifras manuales se presentan siempre como «total publicado» (nunca como listado pista a pista verificado) y como
// aportación manual con su referencia, no como comprobación automática oficial.
import { RUN_COLOURS, runCatalogView, type RunCatalogEntry, type RunCatalogIssue } from './runs';

export const RUN_FIELDS = ['total', ...RUN_COLOURS] as const;
export type RunField = (typeof RUN_FIELDS)[number];
export const RUN_FIELD_LABEL: Record<RunField, string> = { total: 'total', green: 'verdes', blue: 'azules', red: 'rojas', black: 'negras' };
export type RunValues = Record<RunField, number | null>;

export interface ManualRunContribution extends RunValues {
  areaId: string;
  /** false = el administrador declara que la cifra no es comparable (mezcla zonas, criterio distinto…). */
  comparable: boolean;
  /** Explicación pública con evidencia cuando la aportación resuelve una discrepancia del catálogo importado. */
  resolution: string | null;
  season: string | null;
  /** Fecha de la fuente (documento, ficha o parte); null si no la publica. */
  sourceDate: string | null;
  /** Fuente o referencia comprobable (URL o cita). */
  sourceRef: string;
  /** Día en que el administrador introdujo el dato (no es la fecha de la fuente). */
  enteredOn: string;
  status: 'active' | 'withdrawn';
  version: number;
}

/** Por qué una aportación activa se aplica en parte o no se aplica. */
export type ManualNote =
  | 'automatica_prevalece' | 'temporada_anterior' | 'combinacion_incoherente' | 'no_comparable_no_se_mezcla' | 'sin_huecos'
  | 'sustituye_ausente' | 'sustituye_invalido' | 'sustituye_antiguo';
export const MANUAL_NOTE_LABEL: Record<ManualNote, string> = {
  automatica_prevalece: 'El catálogo importado tiene una cifra válida para este campo y prevalece; la aportación se conserva en el historial.',
  temporada_anterior: 'La aportación es de una temporada anterior a la del catálogo importado: no se aplica y se conserva.',
  combinacion_incoherente: 'Mezclada con el catálogo importado no cuadra (los colores superarían o no sumarían el total): no se aplica y se deja pendiente.',
  no_comparable_no_se_mezcla: 'La aportación está marcada como no comparable: no se usa para completar una cifra comparable.',
  sin_huecos: 'El catálogo importado ya tiene todos los campos: no hay nada que completar.',
  sustituye_ausente: 'No hay cifra importada: se usa la aportación manual.',
  sustituye_invalido: 'La cifra importada no es fiable (discrepancia o desglose que no cuadra): la aportación la sustituye entera, sin mezclar.',
  sustituye_antiguo: 'La cifra importada es de una temporada anterior: la aportación la sustituye entera, sin mezclar.',
};

export type ManualState = 'none' | 'withdrawn' | 'applied' | 'partial' | 'not_applied';
export const MANUAL_STATE_LABEL: Record<ManualState, string> = {
  none: 'Sin aportación manual', withdrawn: 'Aportación retirada', applied: 'Aportación aplicada', partial: 'Aportación aplicada en parte', not_applied: 'Aportación no aplicada',
};

/** Procedencia pública de la parte manual de la cifra efectiva (sin autoría ni motivo, que son de administración). */
export interface ManualProvenance {
  fields: RunField[]; sourceRef: string; season: string | null; sourceDate: string | null; enteredOn: string; resolution: string | null;
}
export type RunOrigin = 'catalog' | 'manual' | 'mixed';

export interface ResolvedRuns {
  /** Cifra efectiva (null si no hay ninguna). */
  entry: (RunCatalogEntry & { origin: RunOrigin; manual: ManualProvenance | null }) | null;
  fieldOrigin: Record<RunField, 'catalog' | 'manual' | null>;
  state: ManualState;
  /** Campos con valor manual distinto del importado que prevalece. */
  overridden: RunField[];
  notes: ManualNote[];
}

const valid = new Set<RunCatalogIssue>(['no_entero', 'desglose_no_cuadra', 'desglose_supera_total', 'no_comparable']);
const hasValues = (v: RunValues | null | undefined) => !!v && RUN_FIELDS.some((f) => v[f] != null);
const originOf = (e: RunValues | null, o: 'catalog' | 'manual') => Object.fromEntries(RUN_FIELDS.map((f) => [f, e?.[f] != null ? o : null])) as ResolvedRuns['fieldOrigin'];

/** Año de inicio de temporada: «2026-27» → 2026; una fecha de julio o posterior abre temporada (2026-09-30 → 2026). */
export function seasonStart(season: string | null | undefined, date: string | null | undefined): number | null {
  const m = season && /^(\d{4})-\d{2}$/.exec(season);
  if (m) return Number(m[1]);
  const d = date && /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (d) return Number(d[2]) >= 7 ? Number(d[1]) : Number(d[1]) - 1;
  return null;
}
export type SeasonRelation = 'same' | 'unknown' | 'imported_older' | 'imported_newer';
export function seasonRelation(imp: { season: string | null; sourceDate: string | null }, man: { season: string | null; sourceDate: string | null }): SeasonRelation {
  const a = seasonStart(imp.season, imp.sourceDate), b = seasonStart(man.season, man.sourceDate);
  if (a == null || b == null) return 'unknown';
  return a === b ? 'same' : a < b ? 'imported_older' : 'imported_newer';
}

/** La cifra importada sirve para prevalecer: tiene algún valor, enteros, desglose coherente y es comparable. */
export function importedIsValid(imp: RunCatalogEntry | null | undefined): boolean {
  if (!imp || !hasValues(imp)) return false;
  return !runCatalogView(imp)!.issues.some((i) => valid.has(i));
}
/** Hay una cifra importada que no es fiable: resolverla con una aportación comparable exige explicación con evidencia. */
export const importedNeedsResolution = (imp: RunCatalogEntry | null | undefined) => !!imp && hasValues(imp) && !importedIsValid(imp);

function manualEntry(imp: RunCatalogEntry | null | undefined, m: ManualRunContribution, fields: RunField[]): ResolvedRuns['entry'] {
  return {
    areaId: m.areaId, total: m.total, green: m.green, blue: m.blue, red: m.red, black: m.black, basis: 'aggregate', comparable: m.comparable,
    season: m.season, sourceDate: m.sourceDate, checkedOn: m.enteredOn, sourceUrl: m.sourceRef, mapUrl: imp?.mapUrl ?? null, limitations: null,
    origin: 'manual', manual: { fields, sourceRef: m.sourceRef, season: m.season, sourceDate: m.sourceDate, enteredOn: m.enteredOn, resolution: m.resolution },
  };
}

export function resolveRunCatalog(imp: RunCatalogEntry | null | undefined, man: ManualRunContribution | null | undefined): ResolvedRuns {
  const asCatalog = (state: ManualState, overridden: RunField[] = [], notes: ManualNote[] = []): ResolvedRuns => ({
    entry: imp ? { ...imp, origin: 'catalog', manual: null } : null, fieldOrigin: originOf(imp ?? null, 'catalog'), state, overridden, notes,
  });
  if (!man || man.status !== 'active') return asCatalog(man ? 'withdrawn' : 'none');
  const given = RUN_FIELDS.filter((f) => man[f] != null);
  if (!given.length) return asCatalog('not_applied');
  const rel = imp ? seasonRelation(imp, man) : 'unknown';
  if (imp && importedIsValid(imp) && rel !== 'imported_older') {
    const overridden = given.filter((f) => imp[f] != null && imp[f] !== man[f]);
    if (rel === 'imported_newer') return asCatalog('not_applied', overridden, ['temporada_anterior']);
    const gaps = given.filter((f) => imp[f] == null);
    const notes: ManualNote[] = overridden.length ? ['automatica_prevalece'] : [];
    if (!gaps.length) return asCatalog('not_applied', overridden, notes.length ? notes : ['sin_huecos']);
    if (!man.comparable) return asCatalog('not_applied', overridden, [...notes, 'no_comparable_no_se_mezcla']);
    const merged: RunCatalogEntry = { ...imp };
    for (const f of gaps) merged[f] = man[f];
    const issues = runCatalogView(merged)!.issues;
    if (issues.includes('desglose_no_cuadra') || issues.includes('desglose_supera_total')) return asCatalog('not_applied', overridden, [...notes, 'combinacion_incoherente']);
    const fieldOrigin = originOf(imp, 'catalog');
    for (const f of gaps) fieldOrigin[f] = 'manual';
    return {
      entry: { ...merged, origin: 'mixed', manual: { fields: gaps, sourceRef: man.sourceRef, season: man.season, sourceDate: man.sourceDate, enteredOn: man.enteredOn, resolution: man.resolution } },
      fieldOrigin, state: gaps.length === given.length ? 'applied' : 'partial', overridden, notes,
    };
  }
  const note: ManualNote = !imp || !hasValues(imp) ? 'sustituye_ausente' : importedIsValid(imp) ? 'sustituye_antiguo' : 'sustituye_invalido';
  return { entry: manualEntry(imp, man, given), fieldOrigin: originOf(man, 'manual'), state: 'applied', overridden: [], notes: [note] };
}

// ---------- Validación de una aportación (navegador y Worker) ----------

export interface ManualDraft extends RunValues {
  comparable: boolean; resolution: string | null; season: string | null; sourceDate: string | null; sourceRef: string; reason: string;
}
export const SEASON_RE = /^(\d{4})-(\d{2})$/;
export const MIN_RESOLUTION = 30;

/**
 * Errores que impiden guardar. Mismas reglas en el formulario y en el servidor: enteros no negativos (vacío = sin dato,
 * distinto de 0), al menos un valor, desglose completo = total y parcial ≤ total, fuente y motivo, temporada «2026-27»
 * y fecha de la fuente que no sea futura. Una cifra importada no fiable solo se resuelve como comparable con una
 * explicación con evidencia; nunca con una casilla sola.
 */
export function validateManualDraft(d: ManualDraft, ctx: { imported: RunCatalogEntry | null | undefined; today: string }): string[] {
  const errors: string[] = [];
  const isCount = (v: unknown) => v == null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2000);
  for (const f of RUN_FIELDS) if (!isCount(d[f])) errors.push(`${RUN_FIELD_LABEL[f]}: escribe un número entero de 0 en adelante o déjalo vacío`);
  if (errors.length) return errors;
  if (!RUN_FIELDS.some((f) => d[f] != null)) errors.push('Indica al menos una cifra (total o algún color).');
  const colours = RUN_COLOURS.map((c) => d[c]).filter((v): v is number => v != null);
  const sum = colours.reduce((a, b) => a + b, 0);
  if (d.total != null && colours.length === 4 && sum !== d.total) errors.push(`Los cuatro colores suman ${sum} y el total es ${d.total}: un desglose completo tiene que coincidir con el total.`);
  else if (d.total != null && sum > d.total) errors.push(`Los colores indicados suman ${sum}, más que el total (${d.total}).`);
  if (d.sourceRef.trim().length < 8) errors.push('Indica una fuente o referencia comprobable (enlace o cita del documento).');
  else if (/^https?:/i.test(d.sourceRef.trim()) && !/^https:\/\/[^\s/]+\.[^\s/]+\S*$/i.test(d.sourceRef.trim())) errors.push('El enlace de la fuente tiene que ser una dirección https completa.');
  if (d.reason.trim().length < 5) errors.push('Explica brevemente el motivo del cambio.');
  if (d.season != null) {
    const m = SEASON_RE.exec(d.season);
    if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) errors.push('La temporada se escribe como 2026-27.');
  }
  if (d.sourceDate != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.sourceDate) || Number.isNaN(Date.parse(d.sourceDate))) errors.push('La fecha de la fuente no es válida.');
    else if (d.sourceDate > ctx.today) errors.push('La fecha de la fuente no puede ser posterior a hoy.');
  }
  if (d.comparable && importedNeedsResolution(ctx.imported) && (d.resolution ?? '').trim().length < MIN_RESOLUTION) {
    errors.push(`La cifra importada tiene una discrepancia pendiente: para marcar la aportación como comparable explica con evidencia por qué estas cifras resuelven la discrepancia (al menos ${MIN_RESOLUTION} caracteres).`);
  }
  return errors;
}

/** Valores de una fila de area_run_contributions o area_runs en el formato del historial. */
export const valuesOf = (r: Partial<RunValues> | null | undefined): RunValues | null =>
  r ? Object.fromEntries(RUN_FIELDS.map((f) => [f, r[f] ?? null])) as RunValues : null;
