// Formato es-ES. Las fechas de calendario (YYYY-MM-DD) se tratan como días sin zona: se
// interpretan a medianoche UTC y se formatean en UTC para que nunca se desplacen de día.
// Los instantes (ms) se muestran en Europe/Madrid.
import type { DayStatus, TripRole, TripStatus } from './types';

const utc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...o });
const fLong = f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fLongNoYear = f({ weekday: 'long', day: 'numeric', month: 'long' });
const fShort = f({ weekday: 'short', day: 'numeric', month: 'short' });
const fMonth = f({ month: 'long', year: 'numeric' });
const fDayMonth = f({ day: 'numeric', month: 'short' });
const fInstant = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fInstantDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' });
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export const dayLong = (d: string) => fLong.format(utc(d)).replace(',', '');
export const dayLongNoYear = (d: string) => fLongNoYear.format(utc(d)).replace(',', '');
export const dayShort = (d: string) => fShort.format(utc(d)).replace(/\./g, '').replace(',', '');
export const dayMonth = (d: string) => fDayMonth.format(utc(d)).replace(/\./g, '');
export const monthTitle = (d: string) => {
  const s = fMonth.format(utc(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const instant = (ms: number) => fInstant.format(new Date(ms));
export const instantDate = (ms: number) => fInstantDate.format(new Date(ms));
export const euros = (cents: number) => eur.format(cents / 100);
export const range = (a: string, b: string) => (a === b ? dayShort(a) : `${dayShort(a)} – ${dayShort(b)}`);

export const STATUS_LABEL: Record<DayStatus | 'unknown', string> = { free: 'libre', busy: 'ocupado', maybe: 'quizá', unknown: 'sin indicar' };
export const ROLE_LABEL: Record<TripRole, string> = { owner: 'Propietario', editor: 'Editor', member: 'Miembro' };
export const TRIP_STATUS_LABEL: Record<TripStatus, string> = { planning: 'En planificación', decided: 'Decidido', done: 'Hecho', cancelled: 'Cancelado' };
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «12,50» / «12.50» / «12» / «1.234,56 €» → céntimos; '' → null; texto no válido → NaN. */
export function parseEuros(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, '');
  if (!t) return null;
  const norm = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return NaN;
  return Math.round(Number(norm) * 100);
}
/** Céntimos → texto editable «12,50». */
export const centsToInput = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export const UNIT_LABEL: Record<string, string> = {
  per_person: 'por persona', per_room: 'por habitación (confirma cupo)', per_night: 'por noche (alojamiento completo)',
  per_person_night: 'por persona y noche', per_stay: 'estancia completa', unknown: 'unidad desconocida',
};
export const PRICE_KIND_LABEL: Record<string, string> = {
  advertised_from: 'desde, fechas del proveedor', quoted_for_search: 'cotizado para la búsqueda', manual_estimate: 'estimación manual', user_quote: 'cotización de un miembro',
};
export const MODALITY_LABEL: Record<string, string> = { lodging: 'Solo alojamiento', lodging_forfait: 'Alojamiento + forfait' };
export const AREA_KIND_LABEL: Record<string, string> = { resort: 'Estación', sector: 'Sector', domain: 'Dominio conjunto' };
export const AVAILABILITY_LABEL: Record<string, string> = {
  available: 'disponible', unavailable: 'no disponible', unknown: 'disponibilidad desconocida', not_observed: 'no observada en la última búsqueda (no significa agotada)',
};
export const SOURCE_STATUS_LABEL: Record<string, string> = { verified: 'verificada', unverified: 'sin verificar', broken: 'rota', unsupported: 'no soportada', disabled: 'desactivada' };
export const RUN_STATUS_LABEL: Record<string, string> = { ok: 'correcta', empty: 'sin datos', error: 'error', blocked: 'bloqueada', unsupported: 'no soportada' };
export const OP_STATUS_LABEL: Record<string, string> = { open: 'abierta', partial: 'parcial', closed_confirmed: 'cerrada', out_of_season: 'fuera de temporada', unknown: 'estado desconocido' };
export const kmText = (v: number | null | undefined) => (v == null ? 'sin dato' : `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`);
export const signedEuros = (cents: number) => (cents > 0 ? `+${euros(cents)}` : euros(cents));
