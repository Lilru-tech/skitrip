-- Motivos de nieve (src/core/snow-outcome.ts), con el mismo criterio en recolector, comprobación online y vistas:
-- sin parte publicado, estación que la página no incluye, identidad ajena (la API devuelve otra estación o ninguna) y
-- transporte. SQLite no permite cambiar un CHECK: se rehace la columna. Los motivos actuales se recalculan en la
-- siguiente captura (son el último resultado de cada fuente, no historial).
ALTER TABLE source_health DROP COLUMN reason;
ALTER TABLE source_health ADD COLUMN reason TEXT CHECK (reason IS NULL OR reason IN
  ('no_offers','off_season','robots_subrequests','unknown_structure','no_report','not_listed','identity_mismatch','transport'));

-- Esquiades publica La Molina y Masella por separado, y Formigal y Panticosa por separado (captura real del 15/10/2026):
-- el área combinada no tiene fila y sumar estaciones sería inventar el dominio. Quedan como no soportadas; las áreas
-- combinadas usan sus fuentes oficiales y las filas de cada estación. El catálogo no cambia el estado de una fuente
-- existente (import-legacy no lo pisa), por eso va aquí.
UPDATE sources SET status = 'unsupported', checked_on = '2026-10-15'
 WHERE id IN ('esquiades-status-alp-2500', 'esquiades-status-formigal-panticosa') AND status IN ('verified', 'unverified');
