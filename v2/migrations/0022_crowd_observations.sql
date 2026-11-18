-- Afluencia histórica: observaciones verificables de un día, en una estación o dominio (docs/METEO-AFLUENCIA.md).
--
-- No hay ninguna fuente abierta con afluencia diaria: las observaciones las añade un administrador con su fuente, y
-- esta migración carga las tres encontradas (Pirineu365, 16/03/2026, días récord). Ninguna importación de la
-- publicación toca estas tablas (tools/import-legacy.ts reescribe catálogo y pistas, no esto), así que las aportaciones
-- sobreviven a cualquier reimportación.
--
-- Una fila por ámbito, fecha y tipo de medida ACTIVA (índice único): un duplicado se corrige editando la existente.
-- Retirar no borra (state = 'withdrawn'). version evita sobrescrituras silenciosas entre dos administradores.
-- status 'value' = cifra (0 = cero confirmado); 'closed' = cierre confirmado sin cifra. Sin fila = «Sin dato».
CREATE TABLE IF NOT EXISTS crowd_observations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id          TEXT NOT NULL REFERENCES areas(id),
  obs_date         TEXT NOT NULL,
  measure          TEXT NOT NULL CHECK (measure IN ('visitors', 'daily_skiers', 'skier_days_sold', 'lift_passages')),
  status           TEXT NOT NULL CHECK (status IN ('value', 'closed')),
  value            INTEGER CHECK (value IS NULL OR value >= 0),
  sample           TEXT NOT NULL DEFAULT 'regular' CHECK (sample IN ('regular', 'record', 'selected')),
  source_ref       TEXT NOT NULL,
  source_title     TEXT,
  source_published TEXT,
  note             TEXT,
  reason           TEXT NOT NULL,
  origin           TEXT NOT NULL CHECK (origin IN ('seed', 'admin')),
  state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'withdrawn')),
  version          INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT REFERENCES users(id),
  updated_by       TEXT REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK ((status = 'value' AND value IS NOT NULL) OR (status = 'closed' AND value IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS crowd_observations_active ON crowd_observations (area_id, obs_date, measure) WHERE state = 'active';
-- Consulta por estación y día-mes (la ficha): area_id + substr(obs_date, 6).
CREATE INDEX IF NOT EXISTS crowd_observations_area ON crowd_observations (area_id, obs_date);

-- Historial (solo administración): quién, qué, antes y después, fuente y motivo. Nunca se borra.
CREATE TABLE IF NOT EXISTS crowd_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  area_id        TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('seed', 'create', 'update', 'withdraw', 'restore')),
  actor_id       TEXT REFERENCES users(id),
  at             INTEGER NOT NULL,
  before_json    TEXT,
  after_json     TEXT,
  source_ref     TEXT,
  reason         TEXT,
  version        INTEGER
);
CREATE INDEX IF NOT EXISTS crowd_history_obs ON crowd_history (observation_id, id);

-- Observaciones iniciales: cifras diarias por estación citadas literalmente en
-- https://pirineu365.cat/es/noticia/las-estaciones-de-pirineu365-baten-records-historicos-de-nieve-y-visitantes/
-- (16/03/2026). Son días récord: muestra seleccionada, no afluencia habitual. Las cifras del grupo FGC (22.585 y 20.096
-- «personas») no se atribuyen a ninguna estación y no se guardan. Solo si el área existe en el catálogo.
INSERT INTO crowd_observations (area_id, obs_date, measure, status, value, sample, source_ref, source_title, source_published, note, reason, origin, created_at, updated_at)
SELECT v.area_id, v.obs_date, 'daily_skiers', 'value', v.value, 'record',
       'https://pirineu365.cat/es/noticia/las-estaciones-de-pirineu365-baten-records-historicos-de-nieve-y-visitantes/',
       'Las estaciones de Pirineu365 baten récords históricos de nieve y visitantes', '2026-03-16', v.note,
       'Carga inicial: cifra diaria por estación publicada por el operador (FGC / Pirineu365).', 'seed', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (SELECT 'la-molina' AS area_id, '2026-02-15' AS obs_date, 8564 AS value, '«el 15 de febrero se llegó a los 8.564 esquiadores». Año deducido: el artículo trata la temporada 2025-26.' AS note
      UNION ALL SELECT 'boi-taull', '2026-02-21', 4123, '«se llegó al récord, con 4.123 esquiadores, el 21 de febrero». Año deducido: temporada 2025-26.'
      UNION ALL SELECT 'port-aine', '2026-02-21', 3368, '«a los 3.368 el mismo sábado de febrero» (sábado 21/02/2026, el del récord del grupo).') v
WHERE EXISTS (SELECT 1 FROM areas a WHERE a.id = v.area_id)
  AND NOT EXISTS (SELECT 1 FROM crowd_observations c WHERE c.area_id = v.area_id AND c.obs_date = v.obs_date AND c.measure = 'daily_skiers' AND c.state = 'active');

INSERT INTO crowd_history (observation_id, area_id, action, at, after_json, source_ref, reason, version)
SELECT c.id, c.area_id, 'seed', c.created_at,
       json_object('date', c.obs_date, 'measure', c.measure, 'status', c.status, 'value', c.value, 'sample', c.sample),
       c.source_ref, c.reason, 1
FROM crowd_observations c WHERE c.origin = 'seed' AND NOT EXISTS (SELECT 1 FROM crowd_history h WHERE h.observation_id = c.id);
