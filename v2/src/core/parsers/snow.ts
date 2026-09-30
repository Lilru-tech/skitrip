// Estado de pistas → observaciones. Corrige los fallos del scraper legado (tools/update-open-km.js):
//  - «-» en km abiertos era 0; aquí es null (desconocido).
//  - Deduplicaba por el texto «X / Y»: dos estaciones con las mismas cifras se perdían.
//  - Emparejaba por subcadena («formigal» ⊂ «formigal - panticosa»).
//  - Descartaba en silencio abiertos > totales; aquí se conserva y se marca.
import { classes, cleanText, findAll, isEl, leafTexts, parseHtml, textContent, type El } from './html';

export type OpStatus = 'open' | 'partial' | 'closed_confirmed' | 'out_of_season' | 'unknown';
export type SnowFlag = 'open_exceeds_total' | 'runs_open_exceeds_total' | 'km_missing';

export interface KmPair {
  open: number | null;
  total: number | null;
  flags: SnowFlag[];
}

export interface StatusRow {
  name: string;
  nameNorm: string;
  region: string | null;
  statusText: string | null;
  opStatus: OpStatus;
  openKm: number | null;
  totalKm: number | null;
  openRuns: number | null;
  totalRuns: number | null;
  flags: SnowFlag[];
}

/** Salida común de todos los adaptadores. */
export type ParsedSnow = StatusRow;

export interface Adapter {
  id: string;
  version: string;
  parse(input: string): ParsedSnow[];
}

// ---------- utilidades ----------

/** Normaliza nombres para comparación EXACTA: sin acentos, minúsculas, puntuación → espacio. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const DASHES = /[‐-―−-]/g;
const UNKNOWN_TOKEN = /^[‐-―−-]*$/;
const NUM = /^\d{1,4}(?:[.,]\d{1,2})?$/;

function parseNum(tok: string): number | null | undefined {
  const t = tok.trim();
  if (UNKNOWN_TOKEN.test(t)) return null; // «-», «—», «» → desconocido
  if (!NUM.test(t)) return undefined; // basura
  return Number(t.replace(',', '.'));
}

/** «12,5 / 32» → {open: 12.5, total: 32}. «- / 32» → open null (nunca 0). Basura → null. */
export function parseKmPair(text: string): KmPair | null {
  const s = cleanText(text);
  const m = /^(.*?)\s*\/\s*(.*)$/.exec(s);
  if (!m) return null;
  const open = parseNum(m[1]);
  const total = parseNum(m[2]);
  if (open === undefined || total === undefined) return null;
  const flags: SnowFlag[] = [];
  if (open !== null && total !== null && open > total) flags.push('open_exceeds_total');
  return { open, total, flags };
}

/** Palabras de estado → estado operativo. Lo que no se reconoce es 'unknown'. */
export function mapStatus(text: string | null | undefined): OpStatus {
  if (!text) return 'unknown';
  const t = normalizeName(text);
  if (/\bfuera de temporada\b/.test(t)) return 'out_of_season';
  if (/\bcierre (de )?temporada\b|\btemporada (finalizada|cerrada|terminada)\b/.test(t)) return 'out_of_season';
  if (/\b(proxima apertura|pendiente de apertura|apertura prevista)\b/.test(t)) return 'out_of_season';
  if (/\b(parcial|parcialmente)\b/.test(t)) return 'partial';
  if (/^cerrad[ao]\b/.test(t)) return 'closed_confirmed';
  if (/^abiert[ao]\b/.test(t)) return 'open';
  return 'unknown';
}

const REGION_RE =
  /^(andorra|pirineo( \w+)*|alpes( \w+)*|sierra( \w+)*|serra( \w+)*|sistema( \w+)*|cordillera( \w+)*|otras( \w+)*|espana|francia|italia|suiza|austria|portugal)$/;
const PAIR_SRC = '([\\u2010-\\u2015\\u2212-]|\\d{1,4}(?:[.,]\\d{1,2})?)?\\s*/\\s*([\\u2010-\\u2015\\u2212-]|\\d{1,4}(?:[.,]\\d{1,2})?)';
const KMS_LABEL = /^kms?\b\.?:?/i;
const RUNS_LABEL = /^pistas\b:?/i;

function labelledPair(rowText: string, label: string): KmPair | null {
  const after = new RegExp(`\\b${label}\\b\\.?:?\\s*${PAIR_SRC}`, 'i').exec(rowText);
  const before = after ? null : new RegExp(`${PAIR_SRC}\\s*${label}\\b`, 'i').exec(rowText);
  const m = after ?? before;
  if (!m) return null;
  return parseKmPair(`${m[1] ?? ''} / ${m[2]}`);
}

const hasClass = (el: El, re: RegExp) => classes(el).some((c) => re.test(c));
const firstByClass = (row: El, re: RegExp): string | null => {
  const el = findAll(row, (e) => hasClass(e, re))[0];
  const t = el ? textContent(el) : '';
  return t || null;
};

function buildRow(parts: {
  name: string | null;
  region: string | null;
  statusText: string | null;
  km: KmPair | null;
  runs: KmPair | null;
}): StatusRow | null {
  const name = parts.name ? cleanText(parts.name) : '';
  if (!name) return null;
  const flags: SnowFlag[] = [...(parts.km?.flags ?? [])];
  if (parts.runs?.flags.includes('open_exceeds_total')) flags.push('runs_open_exceeds_total');
  if (!parts.km) flags.push('km_missing');
  return {
    name,
    nameNorm: normalizeName(name),
    region: parts.region,
    statusText: parts.statusText,
    opStatus: mapStatus(parts.statusText),
    openKm: parts.km?.open ?? null,
    totalKm: parts.km?.total ?? null,
    openRuns: parts.runs?.open ?? null,
    totalRuns: parts.runs?.total ?? null,
    flags,
  };
}

// ---------- Esquiades ----------

function isLabelText(t: string) {
  return KMS_LABEL.test(t) || RUNS_LABEL.test(t);
}

/** Fila con etiquetas «Kms»/«Pistas» dentro de cada fila (estructura asumida por el scraper legado). */
function rowFromLabelled(row: El): StatusRow | null {
  const leaves = leafTexts(row).map((t) => t.replace(DASHES, '-'));
  const rowText = leaves.join(' ');
  const km = labelledPair(rowText, 'kms?');
  const runs = labelledPair(rowText, 'pistas');
  const isPair = (t: string) => new RegExp(`^${PAIR_SRC}$`).test(t) || /^[\d/ .,-]+$/.test(t);

  const statusByClass = firstByClass(row, /estado|status/i);
  const statusLeaf = leaves.find((t) => mapStatus(t) !== 'unknown') ?? null;
  const statusText = statusLeaf ?? statusByClass;

  const regionByClass = firstByClass(row, /region|zona|pais|country|area/i);
  const regionLeaf = leaves.slice(1).find((t) => REGION_RE.test(normalizeName(t))) ?? null;
  const region = regionByClass ?? regionLeaf;

  const nameByClass = firstByClass(row, /(^|[-_])(name|nombre|title|titulo)([-_]|$)/i);
  const nameLeaf =
    leaves.find(
      (t) => t !== statusText && t !== region && !isLabelText(t) && !isPair(t) && /\p{L}/u.test(t),
    ) ?? null;

  if (!km && !statusText) return null; // cabeceras, leyendas
  return buildRow({ name: nameByClass ?? nameLeaf, region, statusText, km, runs });
}

/** Variante tabla: cabecera <th>Kms</th> y filas <tr>. */
function rowsFromTables(doc: El): StatusRow[] {
  const out: StatusRow[] = [];
  for (const table of findAll(doc, (e) => e.tag === 'table')) {
    const trs = findAll(table, (e) => e.tag === 'tr', (e) => e.tag === 'table');
    const cellsOf = (tr: El) => tr.children.filter(isEl).filter((c) => c.tag === 'td' || c.tag === 'th');
    const headerIdx = trs.findIndex((tr) => cellsOf(tr).some((c) => KMS_LABEL.test(textContent(c))));
    if (headerIdx < 0) continue;
    const head = cellsOf(trs[headerIdx]).map((c) => normalizeName(textContent(c)));
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const cName = col(/^(estacion|nombre|name)/);
    const cRegion = col(/^(region|zona|pais)/);
    const cStatus = col(/^(estado|status)/);
    const cKm = col(/^kms?\b/);
    const cRuns = col(/^pistas\b/);
    for (const tr of trs.slice(headerIdx + 1)) {
      const cells = cellsOf(tr).map((c) => textContent(c));
      const get = (i: number) => (i >= 0 && i < cells.length ? cells[i] || null : null);
      const row = buildRow({
        name: get(cName >= 0 ? cName : 0),
        region: get(cRegion),
        statusText: get(cStatus),
        km: parseKmPair(get(cKm) ?? ''),
        runs: parseKmPair(get(cRuns) ?? ''),
      });
      if (row) out.push(row);
    }
  }
  return out;
}

/**
 * Página «estado de pistas» de Esquiades. Una fila = el mayor elemento que contiene UNA sola
 * etiqueta «Kms». Sin deduplicar por cifras; solo se colapsan filas idénticas en TODO
 * (misma estación renderizada dos veces, p. ej. versión móvil y escritorio).
 */
export function parseEsquiadesStatusHtml(html: string): StatusRow[] {
  const doc = parseHtml(html);
  const anchors = findAll(doc, (el) => el.children.some((c) => !isEl(c) && KMS_LABEL.test(cleanText(c))));
  // Cuántas etiquetas «Kms» hay bajo cada elemento.
  const count = new Map<El, number>();
  for (const a of anchors) for (let e: El | null = a; e; e = e.parent) count.set(e, (count.get(e) ?? 0) + 1);
  const stop = new Set(['#root', 'html', 'body', 'table', 'thead', 'tbody']);
  const rowEls: El[] = [];
  for (const a of anchors) {
    if (a.tag === 'th') continue; // cabecera de tabla
    let row = a;
    while (row.parent && !stop.has(row.parent.tag) && count.get(row.parent) === 1) row = row.parent;
    if (!rowEls.includes(row)) rowEls.push(row);
  }
  const rows: StatusRow[] = [];
  for (const el of rowEls) {
    // Un contenedor con más de 2 pares «X / Y» no es una fila de estación.
    const pairs = leafTexts(el).join(' ').match(new RegExp(PAIR_SRC, 'g')) ?? [];
    if (pairs.length > 2) continue;
    const r = rowFromLabelled(el);
    if (r) rows.push(r);
  }
  const all = rows.length ? rows : rowsFromTables(doc);
  const seen = new Set<string>();
  return all.filter((r) => {
    const key = JSON.stringify([r.nameNorm, r.region, r.statusText, r.openKm, r.totalKm, r.openRuns, r.totalRuns]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const esquiadesAdapter: Adapter = {
  id: 'esquiades_estado_pistas',
  version: '2.0.0',
  parse: parseEsquiadesStatusHtml,
};

// ---------- Manual (JSON) ----------

const OP_STATUSES: readonly OpStatus[] = ['open', 'partial', 'closed_confirmed', 'out_of_season', 'unknown'];

function manualNum(v: unknown, field: string, i: number): number | null {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && NUM.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new Error(`Entrada ${i + 1}: «${field}» no es un número válido.`);
  return n;
}

/** Entrada manual: array JSON (o {resorts: [...]}) de {name, region?, status?, openKm?, totalKm?, openRuns?, totalRuns?}. */
export const manualAdapter: Adapter = {
  id: 'manual',
  version: '1.0.0',
  parse(input: string): ParsedSnow[] {
    let data: unknown;
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('El JSON manual no es válido.');
    }
    const list = Array.isArray(data) ? data : (data as { resorts?: unknown })?.resorts;
    if (!Array.isArray(list)) throw new Error('Se esperaba una lista de estaciones.');
    return list.map((raw, i) => {
      if (!raw || typeof raw !== 'object') throw new Error(`Entrada ${i + 1}: formato no válido.`);
      const o = raw as Record<string, unknown>;
      const name = typeof o.name === 'string' ? cleanText(o.name) : '';
      if (!name) throw new Error(`Entrada ${i + 1}: falta el nombre.`);
      const status = typeof o.status === 'string' ? o.status : null;
      const openKm = manualNum(o.openKm, 'openKm', i);
      const totalKm = manualNum(o.totalKm, 'totalKm', i);
      const openRuns = manualNum(o.openRuns, 'openRuns', i);
      const totalRuns = manualNum(o.totalRuns, 'totalRuns', i);
      const flags: SnowFlag[] = [];
      if (openKm !== null && totalKm !== null && openKm > totalKm) flags.push('open_exceeds_total');
      if (openRuns !== null && totalRuns !== null && openRuns > totalRuns) flags.push('runs_open_exceeds_total');
      if (openKm === null && totalKm === null) flags.push('km_missing');
      return {
        name,
        nameNorm: normalizeName(name),
        region: typeof o.region === 'string' ? o.region : null,
        statusText: status,
        opStatus: status && (OP_STATUSES as readonly string[]).includes(status) ? (status as OpStatus) : mapStatus(status),
        openKm,
        totalKm,
        openRuns,
        totalRuns,
        flags,
      };
    });
  },
};

// ---------- emparejado y calidad ----------

export type MatchResult =
  | { match: StatusRow; reason: 'exact' }
  | { match: null; reason: 'no_match' | 'ambiguous'; candidates: string[] };

/** Solo coincidencia exacta de alias normalizado. 0 o >1 filas → sin emparejar. */
export function matchResortRow(rows: readonly StatusRow[], aliases: readonly string[]): MatchResult {
  const wanted = new Set(aliases.map(normalizeName).filter(Boolean));
  const hits = rows.filter((r) => wanted.has(r.nameNorm));
  if (hits.length === 1) return { match: hits[0], reason: 'exact' };
  return { match: null, reason: hits.length ? 'ambiguous' : 'no_match', candidates: hits.map((r) => r.name) };
}

export type SnowQuality = 'ok' | 'total_mismatch' | 'suspicious';

export interface SnowObservationLike {
  openKm: number | null;
  totalKm: number | null;
  opStatus?: OpStatus;
  flags?: readonly string[];
}

export interface ClassifyOptions {
  /** Km totales del catálogo/oficiales para el MISMO ámbito (dominio conjunto vs. estación). */
  catalogTotalKm?: number | null;
  /** Tolerancia relativa; por defecto 0,05 (5 %). */
  tolerance?: number;
}

/**
 * 'suspicious' (abiertos > totales, total fuera de rango, cerrada con km abiertos) tiene prioridad sobre
 * 'total_mismatch' (total difiere > 5 % del catálogo o de la observación anterior).
 */
export function classifySnow(
  obs: SnowObservationLike,
  previous?: SnowObservationLike | null,
  opts: ClassifyOptions = {},
): { quality: SnowQuality; reasons: string[] } {
  const tol = opts.tolerance ?? 0.05;
  const suspicious: string[] = [];
  const mismatch: string[] = [];
  const { openKm, totalKm } = obs;
  if (obs.flags?.includes('open_exceeds_total') || (openKm !== null && totalKm !== null && openKm > totalKm)) {
    suspicious.push('Los km abiertos superan los km totales.');
  }
  if (totalKm !== null && (totalKm <= 0 || totalKm > 600)) suspicious.push('Km totales fuera de rango.');
  if ((obs.opStatus === 'closed_confirmed' || obs.opStatus === 'out_of_season') && openKm !== null && openKm > 0) {
    suspicious.push('Estación cerrada con km abiertos.');
  }
  const differs = (ref: number | null | undefined) =>
    totalKm !== null && ref !== null && ref !== undefined && ref > 0 && Math.abs(totalKm - ref) / ref > tol;
  if (differs(opts.catalogTotalKm)) mismatch.push(`Km totales (${totalKm}) distintos del catálogo (${opts.catalogTotalKm}).`);
  if (differs(previous?.totalKm)) mismatch.push(`Km totales (${totalKm}) distintos de la observación anterior (${previous?.totalKm}).`);
  if (suspicious.length) return { quality: 'suspicious', reasons: [...suspicious, ...mismatch] };
  if (mismatch.length) return { quality: 'total_mismatch', reasons: mismatch };
  return { quality: 'ok', reasons: [] };
}
