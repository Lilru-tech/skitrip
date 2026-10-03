// Identidad de una oferta: la MISMA en extracción, deduplicado del recolector, ingesta, persistencia e historial.
// Incluye todas las condiciones declaradas que distinguen una serie de precios; el importe nunca forma parte.
export interface OfferConditions {
  providerOfferId?: string | null; hotelName?: string | null; board?: string | null; cancellation?: string | null; unit: string;
  nights?: number | null; checkIn?: string | null; checkOut?: string | null; adults?: number | null; childrenAges?: readonly number[] | null;
  rooms?: number | null; forfaitIncluded?: 'yes' | 'no' | 'unknown'; forfaitDays?: number | null;
}

export const normName = (s: string | null | undefined) =>
  s == null ? null : s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || null;

/** Forfait declarado: sin dato NO significa «sin forfait». */
export function forfaitState(o: Pick<OfferConditions, 'forfaitIncluded' | 'forfaitDays'>): 'yes' | 'no' | 'unknown' {
  if (o.forfaitIncluded) return o.forfaitIncluded;
  return o.forfaitDays && o.forfaitDays > 0 ? 'yes' : 'unknown';
}

/** Quién (oferta del proveedor u hotel normalizado); null = no identificable. */
export const offerWho = (o: OfferConditions) => (o.providerOfferId ? `id:${o.providerOfferId}` : normName(o.hotelName) ? `h:${normName(o.hotelName)}` : null);

/** Lista canónica de identidad + condiciones (sin contexto ni ámbito, que añade quien la usa). null = no deduplicable. */
export function offerConditionsKey(o: OfferConditions): unknown[] | null {
  const who = offerWho(o);
  if (!who) return null;
  return [who, o.board ?? null, o.cancellation ?? null, o.unit, o.nights ?? null, o.checkIn ?? null, o.checkOut ?? null, o.adults ?? null,
    o.childrenAges ? [...o.childrenAges].sort((a, b) => a - b) : null, o.rooms ?? null, forfaitState(o), o.forfaitDays ?? null];
}
