-- Índices para lecturas que recorrían tablas enteras (wrangler d1 insights, 15/10/2026: el 80 % de las filas leídas
-- en 24 h salía de estas tres consultas y de la del catálogo).
-- Última observación legacy de nieve por ámbito (catálogo público) y serie de la ficha de estación.
CREATE INDEX IF NOT EXISTS legacy_snow_scope ON legacy_snow_observations(scope_area_id, obs_date);
-- Serie legacy de precios de hotel de la ficha de estación (ORDER BY ts DESC LIMIT 120).
CREATE INDEX IF NOT EXISTS legacy_hotel_scope ON legacy_hotel_observations(scope_area_id, ts);
-- Observaciones de las búsquedas de un viaje (pantalla de escenarios): filtro por escenario y fecha.
CREATE INDEX IF NOT EXISTS offer_obs_scenario ON offer_observations(scenario_id, observed_at);
