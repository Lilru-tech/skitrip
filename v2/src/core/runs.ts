// Pistas y variedad: número de pistas de esquí alpino por estación, separado en dos cosas que nunca se mezclan:
//  - Catálogo: total y desglose por colores publicados por la estación (ficha técnica, plano o parte oficial), con su
//    procedencia y fechas. Se carga de forma revisada desde data/catalog.json (`run_catalog`), no en cada parte.
//  - Parte actual: abiertas totales y por color, solo cuando la fuente lo publica y el dato es vigente (mismas reglas de
//    vigencia que «Nieve abierta ahora»).
// Un dato ausente no es cero; el desglose de abiertas nunca se rellena con los porcentajes del catálogo; si las cifras
// oficiales no cuadran, se conserva la discrepancia y lo que no es fiable no puntúa.
import { STALE_HOURS } from './analytics';
import { reportExclusion } from './compare';

export const RUN_COLOURS = ['green', 'blue', 'red', 'black'] as const;
export type RunColour = (typeof RUN_COLOURS)[number];
export type ByColour = Record<RunColour, number | null>;
export const RUN_COLOUR_LABEL: Record<RunColour, { one: string; many: string }> = {
  green: { one: 'verde', many: 'verdes' }, blue: { one: 'azul', many: 'azules' }, red: { one: 'roja', many: 'rojas' }, black: { one: 'negra', many: 'negras' },
};

// ---------- Listados individuales ----------

/**
 * Lo que no es una pista de esquí alpino aunque la fuente lo liste junto a ellas: snowparks, zonas o circuitos
 * infantiles, trineos, esquí de fondo, rutas o itinerarios de montaña, fuera pista o freeride, y la oferta nocturna de
 * una pista que ya se cuenta de día.
 */
export const EXCLUDED_KINDS = ['snowpark', 'kids', 'sledge', 'nordic', 'itinerary', 'freeride', 'night'] as const;
export type ExcludedKind = (typeof EXCLUDED_KINDS)[number];
export const EXCLUDED_KIND_LABEL: Record<ExcludedKind, string> = {
  snowpark: 'snowpark', kids: 'zona o circuito infantil', sledge: 'trineos', nordic: 'esquí de fondo', itinerary: 'itinerario o ruta de montaña',
  freeride: 'fuera pista o freeride', night: 'esquí nocturno (la misma pista ya cuenta de día)',
};

export interface ListedRun {
  /** Identificador oficial (número o código publicado). Sin él, el nombre exacto publicado, y se indica. */
  id: string;
  name: string;
  colour: RunColour | null;
  /** Presente = no es una pista alpina comparable y no se cuenta. */
  kind?: ExcludedKind | null;
}
export interface RunListCount {
  total: number; byColour: Record<RunColour, number>;
  /** Entradas sin color publicado: cuentan en el total, no en el desglose. */
  withoutColour: number;
  excluded: { id: string; name: string; kind: ExcludedKind }[];
  /** Mismo identificador repetido con los mismos datos (otro idioma, otro sector): se cuenta una vez. */
  duplicates: string[];
  /** Mismo identificador con datos distintos: no se adivina cuál vale; el listado no es fiable. */
  conflicts: string[];
}

/**
 * Cuenta un listado individual por identificador oficial. No deduce identidades por parecido de nombre: dos nombres
 * distintos son dos pistas (p. ej. tramos superior e inferior que la estación cuenta por separado).
 */
export function countRunList(runs: readonly ListedRun[]): RunListCount {
  const seen = new Map<string, ListedRun>();
  const out: RunListCount = { total: 0, byColour: { green: 0, blue: 0, red: 0, black: 0 }, withoutColour: 0, excluded: [], duplicates: [], conflicts: [] };
  for (const r of runs) {
    const prev = seen.get(r.id);
    if (prev) {
      const same = prev.colour === r.colour && (prev.kind ?? null) === (r.kind ?? null);
      (same ? out.duplicates : out.conflicts).push(r.id);
      continue;
    }
    seen.set(r.id, r);
    if (r.kind) { out.excluded.push({ id: r.id, name: r.name, kind: r.kind }); continue; }
    out.total++;
    if (r.colour) out.byColour[r.colour]++; else out.withoutColour++;
  }
  return out;
}

// ---------- Catálogo ----------

export interface RunCatalogEntry {
  areaId: string;
  total: number | null;
  green: number | null; blue: number | null; red: number | null; black: number | null;
  /** 'individual' = contado por la estación pista a pista en un listado; 'aggregate' = solo una cifra publicada. */
  basis: 'individual' | 'aggregate';
  /** false = la fuente mezcla otras cosas que no se pueden separar: se muestra, no puntúa. */
  comparable: boolean;
  /** Temporada a la que dice referirse la fuente (p. ej. «2025-26»); null si no lo dice. */
  season: string | null;
  /** Fecha del documento o parte del que sale la cifra; null si no la publica. */
  sourceDate: string | null;
  /** Día en que se consultó la fuente (no es la fecha del dato). */
  checkedOn: string;
  sourceUrl: string;
  mapUrl: string | null;
  /** Qué se ha dejado fuera del recuento y cualquier otra limitación. */
  limitations: string | null;
}

export type RunCatalogIssue = 'no_entero' | 'desglose_no_cuadra' | 'desglose_supera_total' | 'no_comparable' | 'sin_total';
export const RUN_CATALOG_ISSUE_LABEL: Record<RunCatalogIssue, string> = {
  no_entero: 'alguna cifra no es un entero no negativo',
  desglose_no_cuadra: 'el desglose por colores no suma el total publicado',
  desglose_supera_total: 'los colores publicados suman más que el total',
  no_comparable: 'la fuente mezcla pistas con otras zonas y no se pueden separar',
  sin_total: 'no hay total publicado',
};

export interface RunCatalogView {
  /** Total que se muestra tal como se publicó (aunque no puntúe). */
  total: number | null;
  byColour: ByColour;
  /** Los cuatro colores publicados y suman el total. */
  breakdownComplete: boolean;
  /** Total que puede puntuar en «Variedad de pistas» (Planificar); null con el motivo en issues. */
  comparableTotal: number | null;
  issues: RunCatalogIssue[];
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function runCatalogView(e: RunCatalogEntry | null | undefined): RunCatalogView | null {
  if (!e) return null;
  const issues: RunCatalogIssue[] = [];
  const raw = [e.total, ...RUN_COLOURS.map((c) => e[c])];
  if (raw.some((v) => v != null && !isCount(v))) issues.push('no_entero');
  const clean = (v: number | null) => (isCount(v) ? v : null);
  const total = clean(e.total);
  const byColour = Object.fromEntries(RUN_COLOURS.map((c) => [c, clean(e[c])])) as ByColour;
  const given = RUN_COLOURS.map((c) => byColour[c]).filter((v): v is number => v != null);
  const sum = given.reduce((a, b) => a + b, 0);
  const allFour = given.length === 4;
  if (total == null) issues.push('sin_total');
  else if (allFour && sum !== total) issues.push('desglose_no_cuadra');
  else if (!allFour && sum > total) issues.push('desglose_supera_total');
  if (!e.comparable) issues.push('no_comparable');
  // Un total que no cuadra con su propio desglose no se sabe cuál de las dos cifras es la buena: no puntúa.
  const reliable = total != null && e.comparable && !issues.includes('no_entero') && !issues.includes('desglose_no_cuadra') && !issues.includes('desglose_supera_total');
  return { total, byColour, breakdownComplete: allFour && total != null && sum === total, comparableTotal: reliable ? total : null, issues };
}

/**
 * Total de un dominio sin cifra propia: suma de sus estaciones solo si TODAS tienen un total comparable (cada pista es
 * de una estación; el dominio no se suma junto con ellas). Si falta alguna, no hay total del dominio.
 */
export function domainRunTotal(members: readonly (RunCatalogView | null)[]): number | null {
  if (!members.length || members.some((m) => m?.comparableTotal == null)) return null;
  return members.reduce((s, m) => s + m!.comparableTotal!, 0);
}

// ---------- Parte actual ----------

export interface RunReportInput {
  observedAt: number; opStatus: string; quality: string; sourceDate?: string | null;
  openRuns: number | null; totalRuns: number | null;
  /** Abiertas por color publicadas por la fuente en el mismo parte. */
  openRunsByColour?: Partial<ByColour> | null;
}
export type RunsNowExclusion = 'sin_dato' | 'antiguo' | 'parte_antiguo' | 'dudoso' | 'estado_desconocido' | 'sin_pistas' | 'abiertas_superan_total';
export const RUNS_NOW_EXCLUSION_LABEL: Record<RunsNowExclusion, string> = {
  sin_dato: 'sin parte', antiguo: `parte capturado hace más de ${STALE_HOURS.snow} h`, parte_antiguo: 'el parte de la fuente es anterior a ayer',
  dudoso: 'dato dudoso', estado_desconocido: 'estado de apertura desconocido', sin_pistas: 'el parte no publica pistas abiertas',
  abiertas_superan_total: 'el parte publica más pistas abiertas que totales',
};
export interface RunsNow {
  /** Abiertas que pueden mostrarse como vigentes y puntuar en «Esquiar ahora»; null con el motivo. */
  open: number | null;
  /** Total del mismo parte (mismo ámbito y fecha); null si el parte no lo publica. */
  total: number | null;
  /** Abiertas por color del mismo parte; null si no lo publica o no cuadra con las abiertas. */
  byColour: ByColour | null;
  /** Total por color del mismo parte, si lo publica. */
  totalByColour: ByColour | null;
  /** 0 abiertas deducido de un cierre confirmado (la fuente no publica la cifra). */
  derivedFromClosure: boolean;
  excluded: RunsNowExclusion | null;
  /** Discrepancia visible del desglose (se muestra, no se ajusta). */
  colourIssue: string | null;
}

const NONE: Omit<RunsNow, 'excluded'> = { open: null, total: null, byColour: null, totalByColour: null, derivedFromClosure: false, colourIssue: null };

/**
 * Pistas abiertas ahora según el parte elegido, con las mismas reglas de vigencia que «Nieve abierta ahora»: captura
 * reciente, parte de hoy o de ayer, calidad correcta y estado conocido. Nunca se usa el total del catálogo en lugar de
 * las abiertas ni se reparte por colores con sus porcentajes.
 */
export function runsNow(s: RunReportInput | null | undefined, nowMs: number, totalByColour: Partial<ByColour> | null = null): RunsNow {
  if (!s) return { ...NONE, excluded: 'sin_dato' };
  const why = reportExclusion(s, nowMs);
  if (why) return { ...NONE, excluded: why };
  const closed = s.opStatus === 'closed_confirmed' || s.opStatus === 'out_of_season';
  const total = isCount(s.totalRuns) && s.totalRuns > 0 ? s.totalRuns : null;
  if (!isCount(s.openRuns)) {
    // Cierre confirmado sin cifra: 0 abiertas derivado del cierre, sin inventar colores.
    return closed ? { ...NONE, open: 0, total, derivedFromClosure: true, excluded: null } : { ...NONE, total, excluded: 'sin_pistas' };
  }
  if (total != null && s.openRuns > total) return { ...NONE, total, excluded: 'abiertas_superan_total' };
  const cleanColours = (src: Partial<ByColour> | null | undefined): ByColour | null => {
    if (!src) return null;
    const v = Object.fromEntries(RUN_COLOURS.map((c) => [c, isCount(src[c]) ? src[c]! : null])) as ByColour;
    return RUN_COLOURS.some((c) => v[c] != null) ? v : null;
  };
  const totals = cleanColours(totalByColour);
  let byColour = cleanColours(s.openRunsByColour);
  let colourIssue: string | null = null;
  if (byColour) {
    const given = RUN_COLOURS.map((c) => byColour![c]).filter((v): v is number => v != null);
    const sum = given.reduce((a, b) => a + b, 0);
    const over = totals && RUN_COLOURS.some((c) => byColour![c] != null && totals[c] != null && byColour![c]! > totals[c]!);
    if ((given.length === 4 && sum !== s.openRuns) || sum > s.openRuns || over) {
      colourIssue = over ? 'alguna cifra por color supera su total' : `las abiertas por color suman ${sum} y el parte publica ${s.openRuns} abiertas`;
      byColour = null;
    }
  }
  return { open: s.openRuns, total, byColour, totalByColour: totals, derivedFromClosure: false, excluded: null, colourIssue };
}

/** «12 verdes · 20 azules · …» con etiquetas; null si no hay ningún color. Un color sin dato se dice como tal. */
export function colourText(v: ByColour | null, of: ByColour | null = null): string | null {
  if (!v || RUN_COLOURS.every((c) => v[c] == null)) return null;
  return RUN_COLOURS.map((c) => {
    const n = v[c];
    if (n == null) return `${RUN_COLOUR_LABEL[c].many}: sin dato`;
    const t = of?.[c];
    return `${n}${t != null ? ` de ${t}` : ''} ${n === 1 && t == null ? RUN_COLOUR_LABEL[c].one : RUN_COLOUR_LABEL[c].many}`;
  }).join(' · ');
}

// ---------- Carga revisada desde data/catalog.json ----------

/** Fila de `run_catalog` en data/catalog.json (nombres de columna de area_runs). */
export interface RunCatalogJson {
  area: string; total: number | null; green: number | null; blue: number | null; red: number | null; black: number | null;
  basis: 'individual' | 'aggregate'; comparable: boolean; season: string | null; source_date: string | null; checked_on: string;
  source_url: string; map_url: string | null; limitations: string | null;
}
/** Listado oficial de data/run-lists.json. */
export interface RunListJson { area: string; source: string; sourceDate: string | null; checkedOn: string; idKind: string; runs: ListedRun[] }

export const runEntryFromJson = (j: RunCatalogJson): RunCatalogEntry => ({
  areaId: j.area, total: j.total, green: j.green, blue: j.blue, red: j.red, black: j.black, basis: j.basis, comparable: j.comparable,
  season: j.season, sourceDate: j.source_date, checkedOn: j.checked_on, sourceUrl: j.source_url, mapUrl: j.map_url, limitations: j.limitations,
});

/**
 * Revisión antes de importar. `errors` impide la importación (área inexistente o repetida, cifras que no son enteros,
 * un recuento «individual» que no coincide con su listado o un listado con identificadores contradictorios);
 * `warnings` se conserva y se muestra (desglose que no cuadra, total sin desglose…).
 */
export function auditRunCatalog(entries: readonly RunCatalogJson[], lists: readonly RunListJson[], areaIds: ReadonlySet<string>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  const listBy = new Map(lists.map((l) => [l.area, l]));
  for (const j of entries) {
    if (!areaIds.has(j.area)) errors.push(`${j.area}: no es un área del catálogo`);
    if (seen.has(j.area)) errors.push(`${j.area}: repetida`);
    seen.add(j.area);
    if (!j.source_url || !j.checked_on) errors.push(`${j.area}: falta la fuente o la fecha de consulta`);
    const v = runCatalogView(runEntryFromJson(j))!;
    if (v.issues.includes('no_entero')) errors.push(`${j.area}: ${RUN_CATALOG_ISSUE_LABEL.no_entero}`);
    for (const i of v.issues) if (i !== 'no_entero' && i !== 'sin_total' && i !== 'no_comparable') warnings.push(`${j.area}: ${RUN_CATALOG_ISSUE_LABEL[i]}`);
    if (j.basis === 'individual') {
      const l = listBy.get(j.area);
      if (!l) { errors.push(`${j.area}: recuento individual sin listado en data/run-lists.json`); continue; }
      const c = countRunList(l.runs);
      if (c.conflicts.length) errors.push(`${j.area}: identificadores con datos distintos en el listado (${c.conflicts.join(', ')})`);
      const want = [c.total, ...RUN_COLOURS.map((k) => c.byColour[k])];
      const got = [j.total, ...RUN_COLOURS.map((k) => j[k])];
      if (want.some((n, i) => n !== got[i])) errors.push(`${j.area}: el catálogo (${got.join('/')}) no coincide con el recuento del listado (${want.join('/')})`);
    }
  }
  for (const l of lists) if (!entries.some((j) => j.area === l.area && j.basis === 'individual')) errors.push(`${l.area}: listado sin entrada individual en run_catalog`);
  return { errors, warnings };
}

// ---------- Entradas de Comparar (estación o dominio con sus estaciones) ----------

export interface EntryCatalogRuns {
  /** Cifra propia del área tal como se publicó (aunque no puntúe). */
  own: RunCatalogView | null;
  /** Total que puntúa en Planificar: el propio si es comparable; si no, la suma de las estaciones (todas con dato). */
  comparableTotal: number | null;
  via: 'own' | 'members' | null;
  /** Desglose del total que puntúa (solo si viene completo de la misma cifra). */
  byColour: ByColour | null;
}

export function entryCatalogRuns(own: RunCatalogEntry | null | undefined, members: readonly (RunCatalogEntry | null | undefined)[] = []): EntryCatalogRuns {
  const view = runCatalogView(own);
  if (view?.comparableTotal != null) return { own: view, comparableTotal: view.comparableTotal, via: 'own', byColour: view.breakdownComplete ? view.byColour : null };
  const mv = members.map((m) => runCatalogView(m));
  const sum = domainRunTotal(mv);
  if (sum == null) return { own: view, comparableTotal: null, via: null, byColour: null };
  const complete = mv.every((m) => m!.breakdownComplete);
  const byColour = complete ? Object.fromEntries(RUN_COLOURS.map((c) => [c, mv.reduce((s, m) => s + m!.byColour[c]!, 0)])) as ByColour : null;
  return { own: view, comparableTotal: sum, via: 'members', byColour };
}

/**
 * Abiertas ahora de una entrada: su propio parte o, en un dominio sin parte propio, la suma de sus estaciones solo si
 * todas tienen un parte vigente con abiertas (si falta una, no hay cifra del dominio: no se completa con nada).
 */
export function entryRunsNow(ownSnow: (RunReportInput & { totalRunsByColour?: Partial<ByColour> | null }) | null | undefined,
  memberSnows: readonly ((RunReportInput & { totalRunsByColour?: Partial<ByColour> | null }) | null | undefined)[], nowMs: number): RunsNow & { via: 'own' | 'members' } {
  if (ownSnow || memberSnows.length === 0) return { ...runsNow(ownSnow, nowMs, ownSnow?.totalRunsByColour ?? null), via: 'own' };
  const parts = memberSnows.map((s) => runsNow(s, nowMs, s?.totalRunsByColour ?? null));
  const bad = parts.find((p) => p.open == null);
  if (bad) return { ...bad, open: null, total: null, byColour: null, totalByColour: null, derivedFromClosure: false, via: 'members' };
  const total = parts.every((p) => p.total != null) ? parts.reduce((s, p) => s + p.total!, 0) : null;
  return { open: parts.reduce((s, p) => s + p.open!, 0), total, byColour: null, totalByColour: null, derivedFromClosure: parts.every((p) => p.derivedFromClosure),
    excluded: null, colourIssue: null, via: 'members' };
}
