-- Motivo de una captura sin datos (src/core/page-outcome.ts): distingue la ausencia confirmada y el fuera de temporada
-- (no son fallos) de lo que el robots.txt impide cargar y de la estructura que el analizador no reconoce.
ALTER TABLE source_health ADD COLUMN reason TEXT CHECK (reason IS NULL OR reason IN ('no_offers','off_season','robots_subrequests','unknown_structure'));

-- Páginas de Esquiades que el 01/10/2026 cargaban las ofertas desde /*/hotel/offer/load (prohibido por robots.txt) y
-- el 03/10/2026 las traen en el HTML, sin ninguna petición prohibida: cada tarjeta nombra la estación del forfait
-- («2 días de forfait en Grandvalira»), noches, régimen y precio por persona. Se habilitan como orientativas.
-- El catálogo no cambia el estado de una fuente existente (import-legacy no lo pisa), por eso va aquí.
UPDATE sources SET status = 'unverified', checked_on = '2026-10-03'
 WHERE status = 'unsupported' AND id IN ('offers-grandvalira','offers-pal-arinsal','offers-ordino-arcalis','offers-boi-taull','offers-vall-de-nuria','offers-cerler');
