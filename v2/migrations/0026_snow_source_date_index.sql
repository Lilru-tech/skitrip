-- Comparador de km esquiables entre temporadas (docs/KM-HISTORICO.md): lee los partes de un área por fecha publicada
-- (source_date) para unas pocas fechas concretas. Sin este índice recorría toda la serie del área en cada consulta.
CREATE INDEX IF NOT EXISTS snow_obs_area_source_date ON snow_observations(area_id, source_date);
