-- Última observación legacy por ámbito sin recorrer la serie completa (catálogo público y ficha de estación).
-- Sin este índice, cada carga del catálogo leía la tabla entera dos veces (~11 000 filas con 5 394 registros).
CREATE INDEX IF NOT EXISTS legacy_snow_scope ON legacy_snow_observations(scope_area_id, obs_date);
