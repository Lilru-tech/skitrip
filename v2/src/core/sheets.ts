// Importadores de las exportaciones CSV de Google Sheets (comentarios, compra, disponibilidad).
// Funciones puras: validan y normalizan filas; el script tools/import-sheets.ts genera el SQL.
// Solo alimentan tablas legacy_*: nada se publica ni se asigna a una cuenta sin una acción administrativa.
import { csvRecords } from './csv';
import { isValidDate } from './dates';
import { GENERAL_SCOPE, isGeneralScope, normName } from './legacy';

export type SheetKind = 'comments' | 'availability' | 'shopping';
export interface RowIssue { line: number; message: string }
export interface Mapped<T> { rows: (T & { line: number; key: string })[]; errors: RowIssue[]; warnings: RowIssue[]; duplicates: number; headers: string[] }

const pick = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (r[n] != null && r[n] !== '') return r[n];
  return '';
};

/**
 * Fecha de calendario a partir de lo que exporta Sheets. Un instante ISO con hora (p. ej. «2026-01-09T23:00:00.000Z»,
 * típico de Apps Script con fechas a medianoche de Madrid) se convierte a la fecha de Madrid, con aviso.
 */
export function sheetDate(raw: string): { date: string | null; shifted: boolean } {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { date: isValidDate(s) ? s : null, shifted: false };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { date: isValidDate(d) ? d : null, shifted: false };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) return { date: null, shifted: false };
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
    return { date: d, shifted: d !== s.slice(0, 10) };
  }
  return { date: null, shifted: false };
}

function finish<T>(headers: string[], items: (T & { line: number; key: string })[], errors: RowIssue[], warnings: RowIssue[]): Mapped<T> {
  const seen = new Set<string>();
  const rows: (T & { line: number; key: string })[] = [];
  let duplicates = 0;
  for (const it of items) {
    if (seen.has(it.key)) { duplicates++; warnings.push({ line: it.line, message: 'fila duplicada: se importa una sola vez' }); continue; }
    seen.add(it.key);
    rows.push(it);
  }
  return { rows, errors, warnings, duplicates, headers };
}

function requireHeaders(headers: string[], groups: string[][], errors: RowIssue[]) {
  for (const g of groups) if (!g.some((h) => headers.includes(h))) errors.push({ line: 1, message: `falta la columna ${g.join(' o ')}` });
  return errors.length === 0;
}

// ---------- Comentarios ----------
export { GENERAL_SCOPE };
export interface LegacyComment { legacyId: string | null; resortId: string | null; author: string | null; body: string; createdText: string | null }

/**
 * `resortsByName` (nombre normalizado → identificador) permite escribir la estación por su nombre («Grandvalira»,
 * «Port del Comte») en lugar del identificador interno. «general», «global» o «consejo general» = consejo general.
 */
export function mapComments(csv: string, knownResortIds: ReadonlySet<string>, resortsByName: ReadonlyMap<string, string> = new Map()): Mapped<LegacyComment> {
  const { headers, records } = csvRecords(csv);
  const errors: RowIssue[] = [], warnings: RowIssue[] = [];
  if (!requireHeaders(headers, [['text', 'texto', 'comentario']], errors)) return { rows: [], errors, warnings, duplicates: 0, headers };
  const items: (LegacyComment & { line: number; key: string })[] = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const body = pick(r, 'text', 'texto', 'comentario');
    if (!body) { errors.push({ line, message: 'comentario vacío' }); return; }
    if (body.length > 4000) { errors.push({ line, message: 'comentario de más de 4000 caracteres' }); return; }
    const rawResort = pick(r, 'resort_id', 'resort', 'estacion') || null;
    // La hoja antigua usaba «global» para los comentarios generales (consejos del viaje), no para una estación.
    const resortId = !rawResort ? null : isGeneralScope(rawResort) ? GENERAL_SCOPE : knownResortIds.has(rawResort) ? rawResort : resortsByName.get(normName(rawResort)) ?? rawResort;
    if (resortId && resortId !== GENERAL_SCOPE && !knownResortIds.has(resortId)) warnings.push({ line, message: `estación desconocida «${rawResort}»: se guarda sin estación verificada (escribe el nombre como en Comparar o «general»)` });
    const author = pick(r, 'user', 'usuario', 'autor', 'author', 'name') || null;
    const createdText = pick(r, 'created', 'created_at', 'fecha', 'ts', 'timestamp', 'updated') || null;
    const legacyId = pick(r, 'id') || null;
    items.push({ line, legacyId, resortId, author, body, createdText, key: JSON.stringify(['comment', legacyId, resortId, author, body, createdText]) });
  });
  return finish(headers, items, errors, warnings);
}

// ---------- Disponibilidad ----------
export interface LegacyAvailability { person: string; day: string; legacyStatus: string; mapped: 'free' | 'busy' | 'maybe' | null }

/**
 * La hoja legacy solo guardaba los días marcados («ocupado»). Una fila sin columna de estado significa «marcado»
 * y se mapea a ocupado. Los días ausentes NO se rellenan: siguen sin indicar, nunca libres.
 */
export function mapLegacyStatus(raw: string): 'free' | 'busy' | 'maybe' | null {
  const s = raw.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  if (['ocupado', 'busy', 'x', '1', 'true', 'marcado'].includes(s)) return 'busy';
  if (['libre', 'free', 'disponible'].includes(s)) return 'free';
  if (['quiza', 'quizas', 'maybe', 'tal vez', '?'].includes(s)) return 'maybe';
  return null;
}

export function mapAvailability(csv: string): Mapped<LegacyAvailability> {
  const { headers, records } = csvRecords(csv);
  const errors: RowIssue[] = [], warnings: RowIssue[] = [];
  if (!requireHeaders(headers, [['date', 'fecha', 'dia'], ['user', 'usuario', 'name', 'username', 'persona']], errors)) return { rows: [], errors, warnings, duplicates: 0, headers };
  const hasStatus = ['status', 'estado'].some((h) => headers.includes(h));
  const items: (LegacyAvailability & { line: number; key: string })[] = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const person = pick(r, 'user', 'usuario', 'name', 'username', 'persona');
    if (!person) { errors.push({ line, message: 'persona vacía' }); return; }
    const { date, shifted } = sheetDate(pick(r, 'date', 'fecha', 'dia'));
    if (!date) { errors.push({ line, message: `fecha no válida «${pick(r, 'date', 'fecha', 'dia')}»` }); return; }
    if (shifted) warnings.push({ line, message: `instante con hora convertido a la fecha de Madrid ${date}` });
    const legacyStatus = hasStatus ? pick(r, 'status', 'estado') : 'marcado';
    if (!legacyStatus) { errors.push({ line, message: 'estado vacío' }); return; }
    const mapped = mapLegacyStatus(legacyStatus);
    if (!mapped) warnings.push({ line, message: `estado «${legacyStatus}» sin equivalencia: se conserva el original sin interpretar` });
    items.push({ line, person, day: date, legacyStatus, mapped, key: JSON.stringify(['availability', person.trim().toLowerCase(), date, legacyStatus]) });
  });
  return finish(headers, items, errors, warnings);
}

// ---------- Compra ----------
export interface LegacyShopping { name: string; quantityText: string | null; priceText: string | null; person: string | null; extra: Record<string, string> }

export function mapShopping(csv: string): Mapped<LegacyShopping> {
  const { headers, records } = csvRecords(csv);
  const errors: RowIssue[] = [], warnings: RowIssue[] = [];
  if (!requireHeaders(headers, [['name', 'nombre', 'producto']], errors)) return { rows: [], errors, warnings, duplicates: 0, headers };
  const known = new Set(['name', 'nombre', 'producto', 'quantity', 'cantidad', 'qty', 'price', 'precio', 'user', 'usuario', 'persona']);
  const items: (LegacyShopping & { line: number; key: string })[] = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const name = pick(r, 'name', 'nombre', 'producto');
    if (!name) { errors.push({ line, message: 'producto vacío' }); return; }
    const priceText = pick(r, 'price', 'precio') || null;
    // El precio legacy era libre y sin fecha/tienda: se guarda como texto, nunca como observación de precio.
    if (priceText && !/^\d+([.,]\d{1,2})?$/.test(priceText)) warnings.push({ line, message: `precio «${priceText}» no numérico: se guarda como texto` });
    const extra = Object.fromEntries(Object.entries(r).filter(([k, v]) => !known.has(k) && v !== ''));
    const item = { line, name, quantityText: pick(r, 'quantity', 'cantidad', 'qty') || null, priceText, person: pick(r, 'user', 'usuario', 'persona') || null, extra };
    items.push({ ...item, key: JSON.stringify(['shopping', extra.id ?? null, name, item.quantityText, priceText, item.person]) });
  });
  return finish(headers, items, errors, warnings);
}
