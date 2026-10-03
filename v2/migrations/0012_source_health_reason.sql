-- Motivo de una captura sin datos (src/core/page-outcome.ts): distingue la ausencia confirmada y el fuera de temporada
-- (no son fallos) de lo que el robots.txt impide cargar y de la estructura que el analizador no reconoce.
ALTER TABLE source_health ADD COLUMN reason TEXT CHECK (reason IS NULL OR reason IN ('no_offers','off_season','robots_subrequests','unknown_structure'));
