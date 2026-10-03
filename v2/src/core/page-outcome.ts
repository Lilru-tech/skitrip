// Por qué una página de ofertas no dio ninguna tarjeta con precio. Cero nunca es un éxito, pero tampoco todo cero es
// un analizador roto: se distingue la ausencia confirmada (la página lo dice), el cierre de temporada (la página lo
// dice y no muestra ningún precio), lo que el robots.txt impidió cargar y la estructura que no reconocemos.
//
// El bloqueo (CAPTCHA, 403…) se detecta antes, al cargar (core/blocked.ts), y no llega aquí.

export type EmptyReason = 'no_offers' | 'off_season' | 'robots_subrequests' | 'unknown_structure';

/** Estado de salud que corresponde a cada motivo: solo la estructura desconocida cuenta como fallo del analizador. */
export const EMPTY_REASON_STATUS: Record<EmptyReason, 'empty' | 'unsupported' | 'error'> = {
  no_offers: 'empty', off_season: 'empty', robots_subrequests: 'unsupported', unknown_structure: 'error',
};

export const EMPTY_REASON_LABEL: Record<EmptyReason, string> = {
  no_offers: 'la página dice que no hay ofertas',
  off_season: 'fuera de temporada: la página no publica precios',
  robots_subrequests: 'las ofertas se cargan desde una dirección que el robots.txt prohíbe',
  unknown_structure: 'formato no reconocido: hay precios de oferta o ningún aviso propio, y no se reconocen tarjetas',
};

const NO_OFFERS = /no hemos encontrado ning[uú]n resultado|no hay ofertas|no tenemos ofertas|sin resultados|ninguna oferta disponible|no est[aá] disponible en este momento/i;
// «Cerrada - /42.75 km esquiables» es el estado de la estación en el widget de Estiber (03/10/2026, Port del Comte).
const OFF_SEASON = /apertura prevista|pr[oó]xima temporada|temporada[^.]{0,40}(finalizad|terminad|cerrad)|fuera de temporada|estaci[oó]n cerrada|\bcerrad[ao]\s*[-–·]\s*\/?\s*[\d.,]*\s*km/i;
/** Un precio de oferta va con su unidad o su «desde» (los precios del texto editorial, p. ej. aparcamiento o forfait de
 *  temporada en la página de Baqueira del 03/10/2026, no). */
const OFFER_PRICE = /(?:desde\s*)\d[\d.,]*\s?€|\d[\d.,]*\s?€\s*(?:\/\s*pers|por\s+persona|p\.\s?p\.|por\s+noche|\/\s*noche)|€\s?\d[\d.,]*\s*(?:\/\s*pers|por\s+persona)/gi;
/** Peticiones de analítica que el robots.txt prohíbe a menudo y que nunca traen ofertas. */
const ANALYTICS = /collect|stats|events?\b|track|beacon|analytics|pixel|gtm|\/g\/|impression/i;

export const visibleText = (html: string) =>
  html.replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();

/** Motivo de una página sin tarjetas con precio. `refusedPaths`: peticiones de la página que el robots.txt impidió. */
export function classifyEmptyOffersPage(html: string, refusedPaths: readonly string[] = []): EmptyReason {
  const text = visibleText(html);
  const prices = (text.match(OFFER_PRICE) ?? []).length;
  if (refusedPaths.some((p) => !ANALYTICS.test(p))) return 'robots_subrequests';
  if (prices > 0) return 'unknown_structure';
  if (NO_OFFERS.test(text)) return 'no_offers';
  if (OFF_SEASON.test(text)) return 'off_season';
  return 'unknown_structure';
}
