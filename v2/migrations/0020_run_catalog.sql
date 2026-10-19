-- Pistas y variedad (número de pistas de esquí alpino por estación).
--
-- area_runs: catálogo de pistas de cada estación tal como lo publica la propia estación (ficha técnica, plano o parte
-- oficial), con procedencia y fechas. Lo carga la importación del catálogo curado (data/catalog.json, `run_catalog`):
-- se revisa a mano de vez en cuando, no en cada parte. Un número ausente es NULL («sin dato»), nunca 0.
--   basis 'individual' = recuento de un listado oficial pista a pista (data/run-lists.json); 'aggregate' = cifra publicada.
--   comparable 0 = la fuente mezcla otras zonas o sus cifras no cuadran: se muestra con su limitación y no puntúa.
--   source_date = fecha del documento o parte del que sale la cifra; checked_on = día en que se consultó.
CREATE TABLE IF NOT EXISTS area_runs (
  area_id     TEXT PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
  total       INTEGER CHECK (total IS NULL OR total >= 0),
  green       INTEGER CHECK (green IS NULL OR green >= 0),
  blue        INTEGER CHECK (blue IS NULL OR blue >= 0),
  red         INTEGER CHECK (red IS NULL OR red >= 0),
  black       INTEGER CHECK (black IS NULL OR black >= 0),
  basis       TEXT NOT NULL CHECK (basis IN ('individual', 'aggregate')),
  comparable  INTEGER NOT NULL DEFAULT 1 CHECK (comparable IN (0, 1)),
  season      TEXT,
  source_date TEXT,
  checked_on  TEXT NOT NULL,
  source_url  TEXT NOT NULL,
  map_url     TEXT,
  limitations TEXT
);

-- Parte actual: abiertas y totales por color cuando la fuente los publica en el mismo parte (JSON
-- {"green":n,"blue":n,"red":n,"black":n}, con null en el color que no publica). NULL = la fuente no los publica.
ALTER TABLE snow_observations ADD COLUMN open_runs_by_colour TEXT;
ALTER TABLE snow_observations ADD COLUMN total_runs_by_colour TEXT;
