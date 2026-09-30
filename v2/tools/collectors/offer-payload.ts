// Conversión de una tarjeta analizada a la carga de la ingesta. Sin efectos al importarla (se prueba en test/core).
import type { OfferCard } from '../../src/core/parsers/offers.ts';

export function cardToOffer(c: OfferCard, extractor: string) {
  return {
    providerOfferId: c.providerOfferId, hotelName: c.hotelName, board: c.board, nights: c.nights, forfaitDays: c.forfaitDays,
    forfaitIncluded: c.forfaitIncluded, adults: c.adults, childrenAges: c.childrenAges, rooms: c.rooms, checkIn: c.checkIn, checkOut: c.checkOut,
    cancellation: c.cancellation, unit: c.unit, priceKind: c.priceKind, amountCents: c.amount?.cents ?? null,
    warnings: c.warnings.slice(0, 10).map((w) => w.slice(0, 200)),
    availability: c.amount ? 'available' as const : 'unknown' as const, url: c.url && /^https?:\/\//.test(c.url) ? c.url.slice(0, 500) : null, extractor,
  };
}
