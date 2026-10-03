// Adaptadores de webs oficiales de estaciones. Trabajan sobre el TEXTO de la página (HTML sin etiquetas), así que
// sirven igual para el HTML completo o un extracto de texto. Probados con extractos reales de texto (test/fixtures/real);
// el HTML crudo no se ha podido capturar desde el entorno de desarrollo, por eso siguen «no verificada online» hasta la
// primera ejecución en Actions. Un 0 publicado no es «cerrado» salvo que la página lo diga con texto explícito.
import { parseHtml, textContent } from './html';
import type { OpStatus } from './snow';

export interface OfficialSnow {
  opStatus: OpStatus; openKm: number | null; totalKm: number | null; openRuns: number | null; totalRuns: number | null;
  openLifts: number | null; totalLifts: number | null; depthMinCm: number | null; depthMaxCm: number | null; sourceDate: string | null;
}

const toText = (input: string) => (/<[a-z][\s\S]*>/i.test(input) ? textContent(parseHtml(input)) : input).replace(/\s+/g, ' ');
// Límites de plausibilidad: la mayor estación del catálogo (Grandvalira) publica 215 km, 142 pistas y 73 remontes.
// Un total por encima de estos límites o un abierto mayor que el total es una lectura errónea, no un dato.
const LIMITS = { km: 400, runs: 300, lifts: 150 } as const;
type PairKind = keyof typeof LIMITS;
const INT = '(\\d{1,4})(?!\\d|[.,]\\d)';
const DEC = '(\\d{1,4}(?:[.,]\\d{1,2})?)(?!\\d|[.,]\\d)';
/**
 * «<etiqueta> abiertos / total». La etiqueta se agrupa entera, así que puede llevar alternativas («pistas abiertas|pistas»).
 * Solo los km admiten decimales, con coma o punto («12,5 / 215»); pistas y remontes son enteros.
 */
const pair = (t: string, label: RegExp, kind: PairKind): [number, number] | null => {
  const num = kind === 'km' ? DEC : INT;
  const m = new RegExp(`(?:${label.source})\\s*:?\\s*${num}\\s*(?:km)?\\s*/\\s*${num}`, 'i').exec(t);
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 && b <= LIMITS[kind] && a >= 0 && a <= b ? [a, b] : null;
};

export function parseGrandvalira(input: string): OfficialSnow | null {
  const t = toText(input);
  const km = pair(t, /km esquiables|kil[oó]metros esquiables/, 'km');
  if (!km) return null;
  const runs = pair(t, /pistas(?!\s+(?:verde|azul|roja|negra))/, 'runs');
  const lifts = pair(t, /instalaciones/, 'lifts');
  const depth = /espesores de nieve \(cm\)\s*(\d{1,4})\s*-\s*(\d{1,4})/i.exec(t);
  const d = /[úu]ltima actualizaci[oó]n:?\s*(?:[a-záéíóú]{2,4}\.?,?\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
  const [openKm, totalKm] = km;
  // Un 0 publicado puede ser fuera de temporada o cierre: sin texto explícito, el estado queda desconocido.
  const opStatus: OpStatus = openKm === 0 ? 'unknown' : openKm >= totalKm ? 'open' : 'partial';
  return {
    opStatus, openKm, totalKm, openRuns: runs?.[0] ?? null, totalRuns: runs?.[1] ?? null, openLifts: lifts?.[0] ?? null, totalLifts: lifts?.[1] ?? null,
    depthMinCm: depth ? Number(depth[1]) : null, depthMaxCm: depth ? Number(depth[2]) : null,
    sourceDate: d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null,
  };
}

const dmy = (d: string, m: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ratio = (open: number | null, total: number | null): OpStatus | null =>
  open == null || !total ? null : open === 0 ? null : open >= total ? 'open' : 'partial';

// ---------- Plantilla común de las estaciones de Andorra (Grandvalira, Ordino Arcalís, Pal Arinsal) ----------

export type SectorState = 'closed' | 'open' | 'partial' | 'forecast';
export interface SectorStatus { name: string; state: SectorState; openLifts: number | null; totalLifts: number | null; openRuns: number | null; totalRuns: number | null }
const SECTOR_STATE: Record<string, SectorState> = { cerrado: 'closed', abierto: 'open', 'parcialmente abierto': 'partial', 'previsión de apertura': 'forecast' };
const STATE_RE = 'cerrado|parcialmente abierto|abierto|previsi[oó]n de apertura';

/** Sectores con su estado y sus cifras. Solo los nombres indicados: nunca se reparten km del dominio entre sectores. */
export function parseAndorraSectors(input: string, names: readonly string[]): SectorStatus[] {
  const t = toText(input);
  const found = names.flatMap((name) => {
    const m = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(${STATE_RE})\\b`, 'i').exec(t);
    return m ? [{ name, state: SECTOR_STATE[m[1].toLowerCase().replace('ó', 'o').replace('prevision', 'previsión')] ?? 'closed', at: m.index + m[0].length }] : [];
  }).sort((a, b) => a.at - b.at);
  return found.map((f, i) => {
    const block = t.slice(f.at, found[i + 1]?.at ?? t.length);
    const lifts = pair(block, /instalaciones/, 'lifts');
    const runs = pair(block, /pistas/, 'runs');
    return { name: f.name, state: f.state, openLifts: lifts?.[0] ?? null, totalLifts: lifts?.[1] ?? null, openRuns: runs?.[0] ?? null, totalRuns: runs?.[1] ?? null };
  });
}

/** Dominio completo: km si se publican (Arcalís y Pal no los publican), pistas, instalaciones, espesores y fecha. */
export function parseAndorra(input: string, sectorNames: readonly string[]): OfficialSnow | null {
  const t = toText(input);
  const km = pair(t, /km esquiables|kil[oó]metros esquiables/, 'km');
  const runs = pair(t, /pistas(?!\s+(?:verde|azul|roja|negra))/, 'runs');
  const lifts = pair(t, /instalaciones/, 'lifts');
  if (!km && !runs) return null;
  const depth = /espesores de nieve \(cm\)\s*(\d{1,4})\s*-\s*(\d{1,4})/i.exec(t);
  const d = /[úu]ltima actualizaci[oó]n:?\s*(?:[a-záéíóú]{2,4}\.?,?\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
  const sectors = parseAndorraSectors(input, sectorNames);
  const allClosed = sectors.length === sectorNames.length && sectors.every((x) => x.state === 'closed');
  const opStatus: OpStatus = allClosed ? 'closed_confirmed' : (km ? ratio(km[0], km[1]) : ratio(runs?.[0] ?? null, runs?.[1] ?? null)) ?? 'unknown';
  return {
    opStatus, openKm: km?.[0] ?? null, totalKm: km?.[1] ?? null, openRuns: runs?.[0] ?? null, totalRuns: runs?.[1] ?? null,
    openLifts: lifts?.[0] ?? null, totalLifts: lifts?.[1] ?? null, depthMinCm: depth ? Number(depth[1]) : null, depthMaxCm: depth ? Number(depth[2]) : null,
    sourceDate: d ? dmy(d[1], d[2], d[3]) : null,
  };
}

export const GRANDVALIRA_SECTORS = ['Encamp', 'Canillo', 'El Tarter', 'Soldeu', 'Peretol', 'Grau Roig', 'Pas de la Casa'] as const;
export const ARCALIS_SECTORS = ['Ordino Arcalís'] as const;
export const PAL_ARINSAL_SECTORS = ['Pal', 'Arinsal'] as const;

// ---------- Port del Comte (catalán, una ficha por pista y por remonte) ----------

export function parsePortDelComte(input: string): OfficialSnow | null {
  const t = toText(input);
  const km = /km\.?\s*esquiables\s*(\d{1,3}(?:[.,]\d)?)\s*km/i.exec(t);
  const d = /[úu]ltima actualitzaci[oó]:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(t);
  if (!km && !d) return null;
  const openRunsM = /total pistes obertes:?\s*(\d{1,3})/i.exec(t);
  const runStates = [...t.matchAll(/\bestat:\s*([a-zàèéíòóú]+)/gi)].map((m) => m[1].toLowerCase());
  const liftStates = [...t.matchAll(/\bestado:\s*([a-zàèéíòóú]+)/gi)].map((m) => m[1].toLowerCase());
  const isOpen = (x: string) => x === 'obert' || x === 'oberta' || x === 'abierto';
  const gMax = /gruix m[àa]xim\s*(\d{1,4})\s*cm/i.exec(t);
  const gMin = /gruix m[íi]nim\s*(\d{1,4})\s*cm/i.exec(t);
  const openKm = km ? Number(km[1].replace(',', '.')) : null;
  const closedText = /estaci[oó]\s+tanca(?:t|da)\b/i.test(t);
  const totalRuns = runStates.length || null;
  const openRuns = openRunsM ? Number(openRunsM[1]) : totalRuns ? runStates.filter(isOpen).length : null;
  return {
    opStatus: closedText ? 'closed_confirmed' : ratio(openRuns, totalRuns) ?? 'unknown',
    openKm, totalKm: null, openRuns, totalRuns,
    openLifts: liftStates.length ? liftStates.filter(isOpen).length : null, totalLifts: liftStates.length || null,
    depthMinCm: gMin ? Number(gMin[1]) : null, depthMaxCm: gMax ? Number(gMax[1]) : null,
    sourceDate: d ? dmy(d[1], d[2], d[3]) : null,
  };
}

// ---------- Aramón (Cerler, Formigal-Panticosa): «Emitido a las HH:MM h del D de mes de AAAA» ----------

export function parseAramon(input: string): OfficialSnow | null {
  const t = toText(input);
  const d = new RegExp(`emitido a las\\s+\\d{1,2}:\\d{2}\\s*h\\s+del\\s+(\\d{1,2})\\s+de\\s+(${ES_MONTHS.join('|')})\\s+de\\s+(\\d{4})`, 'i').exec(t);
  if (!d) return null;
  const sourceDate = dmy(d[1], String(ES_MONTHS.indexOf(d[2].toLowerCase()) + 1), d[3]);
  const seasonOver = /temporada[^.]{0,40}(finalizad|ha finalizado|terminad)/i.test(t);
  const closed = /estaci[oó]n cerrada/i.test(t);
  const km = pair(t, /km esquiables|kil[oó]metros esquiables|km abiertos/, 'km');
  const runs = pair(t, /pistas abiertas|pistas/, 'runs');
  const lifts = pair(t, /remontes abiertos|remontes|instalaciones/, 'lifts');
  return {
    opStatus: seasonOver ? 'out_of_season' : closed ? 'closed_confirmed' : (km ? ratio(km[0], km[1]) : ratio(runs?.[0] ?? null, runs?.[1] ?? null)) ?? 'unknown',
    openKm: km?.[0] ?? null, totalKm: km?.[1] ?? null, openRuns: runs?.[0] ?? null, totalRuns: runs?.[1] ?? null,
    openLifts: lifts?.[0] ?? null, totalLifts: lifts?.[1] ?? null, depthMinCm: null, depthMaxCm: null, sourceDate,
  };
}

// ---------- FGC · Pirineu365 (La Molina, Vall de Núria, Espot): JSON de api.pirineu365.cat/api/v1/web/stations/<n>/status ----------
// La web carga los datos de esta API pública (robots.txt «Disallow:» vacío, comprobado el 03/10/2026). El navegador
// la muestra dentro de un <pre>; también se acepta el JSON tal cual. Cada estación tiene un número fijo, pero fuera de
// temporada algunas devuelven el nombre vacío: el adaptador exige el nombre esperado y si no coincide lanza un error
// (nunca se atribuyen cifras de otra estación). Un total 0 es «no publicado», no «0 km»: queda nulo.

interface P365Pair { is_open?: number; total?: number }
interface P365Status {
  station_name?: string; is_active?: boolean; is_winter?: boolean; report_type?: string; open_status?: string; updated?: string;
  skislopes?: P365Pair; km?: P365Pair; skilifts?: P365Pair; snow?: { min?: number; max?: number };
}

const p365Pair = (p: P365Pair | undefined, kind: PairKind): [number, number] | null => {
  const a = Number(p?.is_open), b = Number(p?.total);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 && b <= LIMITS[kind] && a >= 0 && a <= b ? [a, b] : null;
};

export function parsePirineu365Status(input: string, expectedName: string): OfficialSnow | null {
  const raw = /<pre\b/i.test(input) ? textContent(parseHtml(input)).trim() : input.trim();
  let json: { success?: boolean; data?: P365Status };
  try { json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const d = json?.data;
  if (!json?.success || !d || typeof d !== 'object') return null;
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (norm(d.station_name ?? '') !== norm(expectedName)) throw new Error(`Pirineu365: se esperaba «${expectedName}» y la API devuelve «${d.station_name ?? ''}»`);
  const km = p365Pair(d.km, 'km'), runs = p365Pair(d.skislopes, 'runs'), lifts = p365Pair(d.skilifts, 'lifts');
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d.updated ?? '');
  // Fuera de la temporada de esquí (parte de verano o estación inactiva) las cifras de pistas no describen la nieve.
  const offSeason = d.is_winter === false || d.is_active === false;
  const opStatus: OpStatus = offSeason ? 'out_of_season' : d.open_status === 'closed' ? 'closed_confirmed'
    : (km ? ratio(km[0], km[1]) : ratio(runs?.[0] ?? null, runs?.[1] ?? null)) ?? 'unknown';
  const depth = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 1000 ? Number(v) : null);
  return {
    opStatus,
    openKm: offSeason ? null : km?.[0] ?? null, totalKm: offSeason ? null : km?.[1] ?? null,
    openRuns: offSeason ? null : runs?.[0] ?? null, totalRuns: offSeason ? null : runs?.[1] ?? null,
    // Los remontes de verano (telecabina, cremallera) no son remontes de esquí: fuera de temporada no se guardan.
    openLifts: offSeason ? null : lifts?.[0] ?? null, totalLifts: offSeason ? null : lifts?.[1] ?? null,
    depthMinCm: offSeason ? null : depth(d.snow?.min), depthMaxCm: offSeason ? null : depth(d.snow?.max),
    sourceDate: date ? dmy(date[1], date[2], date[3]) : null,
  };
}

/** Número de estación en la API de Pirineu365 y nombre que debe devolver (comprobados el 03/10/2026). */
export const PIRINEU365_STATIONS = { 'la-molina': [15, 'La Molina'], 'vall-de-nuria': [16, 'Vall de Núria'], 'espot-esqui': [18, 'Espot'] } as const;

/** Adaptadores oficiales por id de la columna `adapter` de sources. */
export const OFFICIAL_ADAPTERS: Record<string, { version: string; parse: (input: string) => OfficialSnow | null }> = {
  'grandvalira-official': { version: '1.2.0', parse: (i) => parseAndorra(i, GRANDVALIRA_SECTORS) },
  'ordino-arcalis-official': { version: '1.1.0', parse: (i) => parseAndorra(i, ARCALIS_SECTORS) },
  'pal-arinsal-official': { version: '1.1.0', parse: (i) => parseAndorra(i, PAL_ARINSAL_SECTORS) },
  'port-del-comte-official': { version: '1.0.0', parse: parsePortDelComte },
  'aramon-official': { version: '1.1.0', parse: parseAramon },
  'pirineu365-la-molina': { version: '1.0.0', parse: (i) => parsePirineu365Status(i, PIRINEU365_STATIONS['la-molina'][1]) },
  'pirineu365-vall-de-nuria': { version: '1.0.0', parse: (i) => parsePirineu365Status(i, PIRINEU365_STATIONS['vall-de-nuria'][1]) },
  'pirineu365-espot': { version: '1.0.0', parse: (i) => parsePirineu365Status(i, PIRINEU365_STATIONS['espot-esqui'][1]) },
};
