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
//  La temporada solo se compara con la que declaran las dos fuentes («2026-27»). No se deduce de la fecha del documento,
//  que puede describir otra temporada, y «desconocida» nunca equivale a «la misma». El resultado no cambia solo porque
//  pase el tiempo: una cifra sin temporada nunca recupera la prioridad al empezar otra temporada.
//  0. Aportación de una temporada que aún no ha empezado (ficha publicada por adelantado): se guarda, pero no se aplica
//     hasta que empiece; no sustituye los datos de la temporada en curso.
//  1. Catálogo importado válido (enteros, desglose coherente, comparable) y de la MISMA temporada que la aportación:
//     prevalece. La aportación solo completa los huecos (un color o el total que falta), si la combinación cuadra y la
//     aportación no se declara no comparable; si no cuadra, no se mezcla y se explica.
//  2. Importado válido de una temporada POSTERIOR a la de la aportación: prevalece y la aportación no se aplica.
//  3. Importado de una temporada ANTERIOR, o sin temporada frente a una aportación con temporada explícita: la aportación
//     sustituye la cifra entera. Si su temporada ya pasó, se mantiene con su temporada y queda marcada para revisar; no
//     se presenta como dato de la temporada nueva.
//  4. Importado válido y aportación sin temporada, o importado con temporada y aportación sin ella: prevalece el
//     importado, pero NO se mezclan sus campos; las dos fuentes quedan separadas y se explica.
//  5. Importado ausente o no fiable (discrepancia pendiente, desglose que no cuadra): la aportación lo sustituye entera.
//     Nunca se mezclan colores y totales de fuentes cuya temporada común no consta.
//  6. Una aportación retirada no cuenta; restaurarla vuelve a pasar por estas mismas reglas.
// Un área puede tener varias aportaciones activas, una por temporada (la vigente y una ficha ya publicada para la
// próxima). pickManual elige cuál entra en estas reglas: la de la temporada más reciente que ya ha empezado (una con
// temporada antes que una sin ella); las de temporadas futuras esperan. Guardar, editar o retirar la futura no cambia la
// cifra vigente; cuando empieza su temporada pasa a ser la elegida y entra en las reglas de prioridad. Ninguna se borra.
// Las cifras manuales se presentan siempre como «total publicado» (nunca como listado pista a pista verificado) y como
// aportación manual con su referencia, no como comprobación automática oficial.
import { todayMadrid } from './dates';
import { RUN_COLOURS, runCatalogView, type RunCatalogEntry, type RunCatalogIssue } from './runs';

export const RUN_FIELDS = ['total', ...RUN_COLOURS] as const;
export type RunField = (typeof RUN_FIELDS)[number];
export const RUN_FIELD_LABEL: Record<RunField, string> = { total: 'total', green: 'verdes', blue: 'azules', red: 'rojas', black: 'negras' };
export type RunValues = Record<RunField, number | null>;

export interface ManualRunContribution extends RunValues {
  /** Identificador de la aportación (varias por área: una activa por temporada). */
  id?: number;
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
  | 'vigencia_desconocida' | 'temporada_futura' | 'revisar_temporada'
  | 'sustituye_ausente' | 'sustituye_invalido' | 'sustituye_antiguo' | 'sustituye_sin_temporada';
export const MANUAL_NOTE_LABEL: Record<ManualNote, string> = {
  automatica_prevalece: 'El catálogo importado tiene una cifra válida para este campo y prevalece; la aportación se conserva en el historial.',
  temporada_anterior: 'La aportación es de una temporada anterior a la del catálogo importado: no se aplica y se conserva.',
  combinacion_incoherente: 'Mezclada con el catálogo importado no cuadra (los colores superarían o no sumarían el total): no se aplica y se deja pendiente.',
  no_comparable_no_se_mezcla: 'La aportación está marcada como no comparable: no se usa para completar una cifra comparable.',
  sin_huecos: 'El catálogo importado ya tiene todos los campos: no hay nada que completar.',
  vigencia_desconocida: 'No consta que el catálogo importado y la aportación sean de la misma temporada: prevalece el importado, no se mezclan sus cifras y la aportación se conserva aparte. Indica la temporada de la fuente si la publica.',
  sustituye_ausente: 'No hay cifra importada: se usa la aportación manual.',
  sustituye_invalido: 'La cifra importada no es fiable (discrepancia o desglose que no cuadra): la aportación la sustituye entera, sin mezclar.',
  sustituye_antiguo: 'La cifra importada es de una temporada anterior: la aportación la sustituye entera, sin mezclar.',
  sustituye_sin_temporada: 'La cifra importada no indica temporada y la aportación sí: la aportación la sustituye entera, sin mezclar. Una cifra sin temporada no recupera la prioridad con el paso del tiempo.',
  temporada_futura: 'La aportación es de una temporada que aún no ha empezado: se guarda y se aplicará cuando empiece. Hasta entonces no sustituye los datos de la temporada en curso.',
  revisar_temporada: 'La aportación es de una temporada anterior a la actual: se mantiene con su temporada y necesita revisión para la temporada en curso.',
};

export type ManualState = 'none' | 'withdrawn' | 'applied' | 'partial' | 'not_applied' | 'scheduled';
export const MANUAL_STATE_LABEL: Record<ManualState, string> = {
  none: 'Sin aportación manual', withdrawn: 'Aportación retirada', applied: 'Aportación aplicada', partial: 'Aportación aplicada en parte', not_applied: 'Aportación no aplicada',
  scheduled: 'Aportación programada para su temporada',
};

/** Procedencia pública de la parte manual de la cifra efectiva (sin autoría ni motivo, que son de administración). */
export interface ManualProvenance {
  fields: RunField[]; sourceRef: string; season: string | null; sourceDate: string | null; enteredOn: string; resolution: string | null;
  /** Temporada en curso cuando la de la aportación ya pasó: el dato se mantiene, pendiente de revisar para esa temporada. */
  reviewFor?: string | null;
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

/** Año de inicio de la temporada que declara la fuente («2026-27» → 2026); null si no la declara. No se deduce de fechas. */
export function seasonStart(season: string | null | undefined): number | null {
  const m = season && /^(\d{4})-\d{2}$/.exec(season);
  return m ? Number(m[1]) : null;
}
/** Temporada en curso según el día (julio o después abre la siguiente): 2026-10-19 → 2026 («2026-27»). */
export function currentSeasonStart(today: string): number {
  const [y, m] = today.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}
export const seasonLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
export type SeasonRelation = 'same' | 'unknown' | 'imported_older' | 'imported_newer';
export function seasonRelation(imp: { season: string | null }, man: { season: string | null }): SeasonRelation {
  const a = seasonStart(imp.season), b = seasonStart(man.season);
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

function manualEntry(imp: RunCatalogEntry | null | undefined, m: ManualRunContribution, fields: RunField[], reviewFor: string | null): ResolvedRuns['entry'] {
  return {
    areaId: m.areaId, total: m.total, green: m.green, blue: m.blue, red: m.red, black: m.black, basis: 'aggregate', comparable: m.comparable,
    season: m.season, sourceDate: m.sourceDate, checkedOn: m.enteredOn, sourceUrl: m.sourceRef, mapUrl: imp?.mapUrl ?? null, limitations: null,
    origin: 'manual', manual: { fields, sourceRef: m.sourceRef, season: m.season, sourceDate: m.sourceDate, enteredOn: m.enteredOn, resolution: m.resolution, reviewFor },
  };
}

export function resolveRunCatalog(imp: RunCatalogEntry | null | undefined, man: ManualRunContribution | null | undefined, today = todayMadrid()): ResolvedRuns {
  const asCatalog = (state: ManualState, overridden: RunField[] = [], notes: ManualNote[] = []): ResolvedRuns => ({
    entry: imp ? { ...imp, origin: 'catalog', manual: null } : null, fieldOrigin: originOf(imp ?? null, 'catalog'), state, overridden, notes,
  });
  if (!man || man.status !== 'active') return asCatalog(man ? 'withdrawn' : 'none');
  const given = RUN_FIELDS.filter((f) => man[f] != null);
  if (!given.length) return asCatalog('not_applied');
  const now = currentSeasonStart(today);
  const manSeason = seasonStart(man.season);
  // Ficha publicada por adelantado: no sustituye nada hasta que empiece su temporada.
  if (manSeason != null && manSeason > now) return asCatalog('scheduled', [], ['temporada_futura']);
  const rel = imp ? seasonRelation(imp, man) : 'unknown';
  // Importado sin temporada frente a una aportación con temporada explícita: la cifra sin temporada no acredita su
  // vigencia, y no la recupera porque cambie la temporada en curso (no depende de la fecha de hoy).
  const undatedVsDated = rel === 'unknown' && imp != null && seasonStart(imp.season) == null && manSeason != null;
  if (imp && importedIsValid(imp) && rel !== 'imported_older' && !undatedVsDated) {
    const overridden = given.filter((f) => imp[f] != null && imp[f] !== man[f]);
    if (rel === 'imported_newer') return asCatalog('not_applied', overridden, ['temporada_anterior']);
    // Sin temporada común acreditada no se combinan campos: cada fuente queda por separado.
    if (rel === 'unknown') return asCatalog('not_applied', overridden, ['vigencia_desconocida']);
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
  const note: ManualNote = !imp || !hasValues(imp) ? 'sustituye_ausente' : !importedIsValid(imp) ? 'sustituye_invalido' : rel === 'imported_older' ? 'sustituye_antiguo' : 'sustituye_sin_temporada';
  // Se mantiene con su temporada explícita; si ya pasó, se avisa de que necesita revisión para la temporada en curso.
  const reviewFor = manSeason != null && manSeason < now ? seasonLabel(now) : null;
  const notes: ManualNote[] = reviewFor ? [note, 'revisar_temporada'] : [note];
  return { entry: manualEntry(imp, man, given, reviewFor), fieldOrigin: originOf(man, 'manual'), state: 'applied', overridden: [], notes };
}

/** Papel de cada aportación de un área hoy: la que entra en la regla, las que esperan su temporada y las desplazadas. */
export type ContributionRole = 'current' | 'scheduled' | 'superseded' | 'withdrawn';
export const CONTRIBUTION_ROLE_LABEL: Record<ContributionRole, string> = {
  current: 'Vigente', scheduled: 'Programada', superseded: 'Sustituida por una de temporada posterior', withdrawn: 'Retirada',
};
export interface ManualPick<M extends ManualRunContribution = ManualRunContribution> {
  /** La que entra en resolveRunCatalog (null si ninguna ha empezado). */
  current: M | null;
  /** Activas de temporadas que aún no han empezado, de la más próxima a la más lejana. */
  scheduled: M[];
  role: (m: M) => ContributionRole;
}

/**
 * Elige entre las aportaciones de un área: de las activas cuya temporada ya ha empezado (o que no la declaran), la de
 * temporada más reciente; una con temporada explícita antes que una sin ella. Las futuras esperan. Solo depende de las
 * temporadas declaradas y de la temporada en curso, nunca del orden en que se guardaron.
 */
export function pickManual<M extends ManualRunContribution>(list: readonly M[], today = todayMadrid()): ManualPick<M> {
  const now = currentSeasonStart(today);
  const active = list.filter((m) => m.status === 'active');
  const scheduled = active.filter((m) => (seasonStart(m.season) ?? -Infinity) > now).sort((a, b) => seasonStart(a.season)! - seasonStart(b.season)!);
  const started = active.filter((m) => !scheduled.includes(m));
  const current = started.reduce<M | null>((best, m) => (!best || (seasonStart(m.season) ?? -Infinity) > (seasonStart(best.season) ?? -Infinity) ? m : best), null);
  return { current, scheduled, role: (m) => (m.status !== 'active' ? 'withdrawn' : m === current ? 'current' : scheduled.includes(m) ? 'scheduled' : 'superseded') };
}

export interface ResolvedArea extends ResolvedRuns {
  /** Aportación que entra en la regla (id), si hay. */
  currentId: number | null;
  /** Fichas programadas: se aplicarán cuando empiece su temporada. */
  scheduled: { id: number | null; season: string | null; total: number | null }[];
}

/** Resolución de un área con todas sus aportaciones (activas y retiradas): pickManual y después resolveRunCatalog. */
export function resolveArea(imp: RunCatalogEntry | null | undefined, list: readonly ManualRunContribution[], today = todayMadrid()): ResolvedArea {
  const pick = pickManual(list, today);
  // Sin vigente: la programada explica por qué no se aplica nada; si no, la retirada más reciente.
  const shown = pick.current ?? pick.scheduled[0] ?? [...list].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
  return {
    ...resolveRunCatalog(imp, shown, today),
    currentId: pick.current?.id ?? null,
    scheduled: pick.scheduled.map((m) => ({ id: m.id ?? null, season: m.season, total: m.total })),
  };
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
    // Una ficha de la próxima temporada puede publicarse antes de que empiece; más allá no hay fichas publicadas.
    else if (Number(m[1]) > currentSeasonStart(ctx.today) + 1) errors.push(`Como mucho, la próxima temporada (${seasonLabel(currentSeasonStart(ctx.today) + 1)}).`);
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
