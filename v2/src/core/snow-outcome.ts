// Resultado de una fuente de nieve, con el MISMO criterio en el recolector (tools/collectors/snow.ts), la comprobación
// online (tools/online-check.ts), la ingesta (motivo guardado en source_health) y las vistas de Administración y
// pública (web/format.ts). Una página que carga pero no da filas no es «sin datos» ni un éxito: es un formato no
// reconocido, salvo que la fuente diga expresamente que no hay parte.
import { SourceIdentityError, type OfficialSnow } from './parsers/official-snow';
import { matchResortRow, normalizeName, type StatusRow } from './parsers/snow';

export type SnowReason = 'off_season' | 'no_report' | 'not_listed' | 'unknown_structure' | 'identity_mismatch' | 'transport';
export type HealthStatus = 'ok' | 'empty' | 'error' | 'blocked' | 'unsupported';

/** Motivos que NO son un fallo de la fuente (no suman fallos seguidos ni avisan): ausencia que la fuente confirma. */
export const LEGITIMATE_ABSENCE = ['no_offers', 'off_season', 'no_report'] as const;

export const SNOW_REASON_LABEL: Record<SnowReason, string> = {
  off_season: 'fuera de temporada confirmado por la fuente',
  no_report: 'sin parte publicado: la fuente responde, pero no tiene parte para esta estación',
  not_listed: 'la página se lee, pero no incluye esta estación',
  unknown_structure: 'formato no reconocido: la página carga y no se reconoce ninguna fila',
  identity_mismatch: 'la fuente devuelve otra estación o ninguna: no se usan sus cifras',
  transport: 'no se pudo descargar (red o error HTTP)',
};

export interface SnowOutcome<T> { status: HealthStatus; reason: SnowReason | null; error: string | null; data: T | null }

/** Error al cargar o leer: bloqueo, identidad ajena o transporte. `blocked` lo decide quien carga (core/blocked.ts). */
export function snowFailure(e: unknown, blocked: boolean): SnowOutcome<never> {
  const error = String((e as Error)?.message ?? e).slice(0, 300);
  if (blocked) return { status: 'blocked', reason: null, error, data: null };
  if (e instanceof SourceIdentityError) return { status: 'error', reason: 'identity_mismatch', error, data: null };
  return { status: 'error', reason: 'transport', error, data: null };
}

/** «Sin parte publicado» solo si la fuente lo dice con palabras; un 404 o un error de la API es un fallo de transporte
 *  (la dirección ya no existe o la API falla), que cuenta como fallo seguido. */
const NO_REPORT = /\b(sin parte|no hay parte|parte no disponible|no hay (datos|informaci[oó]n) de (nieve|pistas))\b/i;
const HTTP_ERROR = /^\s*404\s+no encontrad|\bnot found\b|"success"\s*:\s*false/i;
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Web o API oficial de una sola estación. Lanza solo si `parse` lanza (identidad): úsese con snowFailure. */
export function officialSnowOutcome(html: string, parse: (input: string) => OfficialSnow | null): SnowOutcome<OfficialSnow> {
  const r = parse(html);
  if (r) return { status: 'ok', reason: r.opStatus === 'out_of_season' ? 'off_season' : null, error: null, data: r };
  const text = visible(html);
  if (HTTP_ERROR.test(text)) return { status: 'error', reason: 'transport', error: `la fuente respondió con un error: «${text.slice(0, 120)}»`, data: null };
  if (NO_REPORT.test(text)) return { status: 'empty', reason: 'no_report', error: 'la fuente dice que no hay parte para esta estación', data: null };
  return { status: 'error', reason: 'unknown_structure', error: 'la página no contiene el parte en un formato reconocible', data: null };
}

/** Agregador con una fila por estación: emparejamiento EXACTO por alias, en orden de prioridad (nunca subcadenas). */
export function aggregatorSnowOutcome(rows: readonly StatusRow[], aliases: readonly string[]): SnowOutcome<StatusRow> {
  if (!rows.length) return { status: 'error', reason: 'unknown_structure', error: 'la página no devolvió filas reconocibles', data: null };
  for (const a of aliases) {
    const m = matchResortRow(rows, [a]);
    if (m.match) return { status: 'ok', reason: m.match.opStatus === 'out_of_season' ? 'off_season' : null, error: null, data: m.match };
    if (m.reason === 'ambiguous') return { status: 'error', reason: 'unknown_structure', error: `varias filas con el nombre «${a}»: ${m.candidates?.join(', ')}`, data: null };
  }
  return { status: 'error', reason: 'not_listed', error: `sin fila para ${aliases.map((a) => `«${normalizeName(a)}»`).join(', ')} entre ${rows.length}`, data: null };
}
