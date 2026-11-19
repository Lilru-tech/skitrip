-- Copias archivadas de partes de nieve (Wayback Machine, Internet Archive) para el comparador de km entre temporadas
-- (docs/KM-HISTORICO.md). Solo días sueltos de temporadas pasadas; cada fila guarda el enlace a su copia. Las carga un
-- workflow manual (v2 · km archivados) por /api/ingest/km-archive; nunca se mezclan con los partes de snow_observations.
CREATE TABLE IF NOT EXISTS km_archive_observations (
  id            INTEGER PRIMARY KEY,
  area_id       TEXT NOT NULL REFERENCES areas(id),
  obs_date      TEXT NOT NULL,                                   -- fecha del parte o, sin ella, de la copia (Madrid)
  date_basis    TEXT NOT NULL CHECK (date_basis IN ('report', 'copy')),
  op_status     TEXT NOT NULL CHECK (op_status IN ('open', 'partial', 'closed_confirmed', 'out_of_season')),
  open_km       REAL CHECK (open_km IS NULL OR open_km >= 0),
  total_km      REAL CHECK (total_km IS NULL OR total_km > 0),
  provider      TEXT NOT NULL,                                   -- 'esquiades', 'official'…
  original_url  TEXT NOT NULL,
  archive_url   TEXT NOT NULL,                                   -- https://web.archive.org/web/<marca>/<original>
  captured_at   INTEGER NOT NULL,                                -- instante de la copia (UTC ms)
  extractor     TEXT NOT NULL,
  imported_at   INTEGER NOT NULL,
  CHECK (open_km IS NULL OR total_km IS NULL OR open_km <= total_km),
  CHECK (op_status IN ('closed_confirmed', 'out_of_season') OR open_km IS NOT NULL),
  UNIQUE (area_id, obs_date, provider, archive_url)
);
CREATE INDEX IF NOT EXISTS km_archive_area_date ON km_archive_observations(area_id, obs_date);
