-- 0002: estaciones/sectores/dominios, fuentes, orígenes y rutas, nieve, ejecuciones de captura
-- e importación legacy (tablas separadas: nunca se mezclan con series nuevas verificadas).

-- Un «área» es una estación, un sector de estación o un dominio esquiable conjunto.
CREATE TABLE areas (
  id                TEXT PRIMARY KEY,           -- slug estable, p. ej. 'la-molina'
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('resort','sector','domain')),
  country           TEXT NOT NULL,
  region            TEXT,
  lat               REAL,
  lon               REAL,
  official_total_km REAL CHECK (official_total_km IS NULL OR official_total_km >= 0),
  total_km_source   TEXT,
  total_km_checked  TEXT,                       -- fecha de comprobación
  official_url      TEXT,
  vibe_score        INTEGER,                    -- valoraciones subjetivas heredadas (0–10)
  apres_score       INTEGER,
  active            INTEGER NOT NULL DEFAULT 1,
  notes             TEXT
);

-- Relación dominio ⊃ miembro. Una estación puede pertenecer a un dominio (Alp 2500 ⊃ La Molina, Masella).
CREATE TABLE area_links (
  parent_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  relation  TEXT NOT NULL CHECK (relation IN ('member','sector')),
  PRIMARY KEY (parent_id, child_id),
  CHECK (parent_id <> child_id)
);

-- Registro de fuentes por área: qué se puede extraer, cómo, con qué ámbito y cuándo se comprobó.
CREATE TABLE sources (
  id            TEXT PRIMARY KEY,               -- p. ej. 'grandvalira-official-snow'
  area_id       TEXT NOT NULL REFERENCES areas(id),
  scope_area_id TEXT NOT NULL REFERENCES areas(id), -- ámbito real de las cifras (puede ser el dominio)
  kind          TEXT NOT NULL CHECK (kind IN ('snow','offers','route')),
  provider      TEXT NOT NULL,                  -- 'official', 'esquiades', 'estiber', 'pirineu365', …
  url           TEXT NOT NULL,
  method        TEXT NOT NULL,                  -- 'html', 'json', 'playwright', 'manual'
  fields        TEXT NOT NULL,                  -- JSON: ["open_km","total_km","open_runs",…]
  priority      INTEGER NOT NULL DEFAULT 100,   -- menor = preferente
  status        TEXT NOT NULL CHECK (status IN ('verified','unverified','broken','unsupported','disabled')),
  checked_on    TEXT,                           -- fecha de la última comprobación manual/online
  limitations   TEXT,
  adapter       TEXT                            -- nombre del adaptador de código, si existe
);
CREATE INDEX sources_area ON sources(area_id, kind, priority);

CREATE TABLE origins (
  id   TEXT PRIMARY KEY,                        -- 'tarragona', 'sabadell'
  name TEXT NOT NULL,
  lat  REAL NOT NULL,
  lon  REAL NOT NULL
);

-- Rutas por carretera hasta el acceso elegido. `road_km` NULL = desconocido (nunca se sustituye por haversine).
CREATE TABLE routes (
  origin_id    TEXT NOT NULL REFERENCES origins(id),
  area_id      TEXT NOT NULL REFERENCES areas(id),
  access_name  TEXT NOT NULL,                   -- p. ej. 'Pas de la Casa', 'Tarter'
  road_km      REAL CHECK (road_km IS NULL OR road_km > 0),
  duration_min INTEGER,
  toll_cents   INTEGER,                         -- por coche y trayecto, si se conoce
  source       TEXT NOT NULL,                   -- 'manual', 'openrouteservice', 'legacy'
  checked_on   TEXT,
  validated    INTEGER NOT NULL DEFAULT 0,      -- 1 = comprobada contra una segunda fuente o manualmente
  notes        TEXT,
  PRIMARY KEY (origin_id, area_id)
);

-- Ejecuciones de captura (nieve, ofertas, precios): previstas, válidas, fallidas y no soportadas.
CREATE TABLE capture_runs (
  id            TEXT PRIMARY KEY,
  pipeline      TEXT NOT NULL CHECK (pipeline IN ('snow','offers','prices')),
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  expected      INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  unsupported   INTEGER NOT NULL DEFAULT 0,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('running','ok','partial','empty','error')),
  error_summary TEXT,
  runner        TEXT                            -- 'github-actions#123', 'local'
);
CREATE INDEX capture_runs_pipeline ON capture_runs(pipeline, started_at);

-- Estado por fuente: último intento y último éxito por separado.
CREATE TABLE source_health (
  source_id        TEXT PRIMARY KEY REFERENCES sources(id),
  last_attempt_at  INTEGER,
  last_success_at  INTEGER,
  last_status      TEXT CHECK (last_status IN ('ok','empty','error','blocked','unsupported')),
  last_error       TEXT,
  consecutive_fail INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE snow_observations (
  id            TEXT PRIMARY KEY,
  area_id       TEXT NOT NULL REFERENCES areas(id),  -- ámbito de las cifras (= scope de la fuente)
  source_id     TEXT NOT NULL REFERENCES sources(id),
  run_id        TEXT REFERENCES capture_runs(id),
  observed_at   INTEGER NOT NULL,                     -- instante de captura (UTC ms)
  source_date   TEXT,                                 -- fecha publicada por la fuente, si existe
  op_status     TEXT NOT NULL CHECK (op_status IN ('open','partial','closed_confirmed','out_of_season','unknown')),
  open_km       REAL CHECK (open_km IS NULL OR open_km >= 0),
  total_km      REAL CHECK (total_km IS NULL OR total_km > 0),
  open_runs     INTEGER,
  total_runs    INTEGER,
  open_lifts    INTEGER,
  total_lifts   INTEGER,
  depth_min_cm  INTEGER,
  depth_max_cm  INTEGER,
  quality       TEXT NOT NULL DEFAULT 'ok' CHECK (quality IN ('ok','total_mismatch','suspicious')),
  quality_note  TEXT,
  content_hash  TEXT NOT NULL,                        -- idempotencia de ingesta
  extractor     TEXT NOT NULL,                        -- adaptador@versión
  CHECK (open_km IS NULL OR total_km IS NULL OR open_km <= total_km),
  UNIQUE (source_id, area_id, content_hash)
);
CREATE INDEX snow_obs_area ON snow_observations(area_id, observed_at);

-- ---------- Legacy ----------

CREATE TABLE legacy_import_files (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                  -- 'resorts', 'hotel_price_history', 'open_km_history', 'sheets_*'
  file_name    TEXT NOT NULL,
  sha256       TEXT NOT NULL UNIQUE,
  bytes        INTEGER NOT NULL,
  records      INTEGER NOT NULL,
  source_ref   TEXT,                           -- commit del repositorio de origen
  imported_at  INTEGER NOT NULL,
  report_json  TEXT
);

CREATE TABLE legacy_id_map (
  legacy_kind TEXT NOT NULL,
  legacy_id   TEXT NOT NULL,
  new_kind    TEXT NOT NULL,
  new_id      TEXT NOT NULL,
  note        TEXT,
  PRIMARY KEY (legacy_kind, legacy_id)
);

-- Observaciones hoteleras agregadas tal y como estaban: sin hotel, sin fechas de estancia, sin ocupación.
CREATE TABLE legacy_hotel_observations (
  id                   INTEGER PRIMARY KEY,
  file_id              TEXT NOT NULL REFERENCES legacy_import_files(id),
  obs_date             TEXT NOT NULL,
  ts                   TEXT NOT NULL,
  legacy_resort_id     TEXT NOT NULL,
  provider             TEXT NOT NULL,
  url                  TEXT,
  days                 INTEGER,
  nights               INTEGER,               -- siempre NULL en los datos actuales
  cheapest_unit_cents  INTEGER,
  top10_avg_unit_cents INTEGER,
  sample_count         INTEGER NOT NULL,
  samples_json         TEXT NOT NULL,
  anomalies            TEXT,                  -- JSON de avisos detectados en la importación
  UNIQUE (legacy_resort_id, provider, ts)
);
CREATE INDEX legacy_hotel_resort ON legacy_hotel_observations(legacy_resort_id, obs_date);

CREATE TABLE legacy_snow_observations (
  id               INTEGER PRIMARY KEY,
  file_id          TEXT NOT NULL REFERENCES legacy_import_files(id),
  legacy_resort_id TEXT NOT NULL,
  obs_date         TEXT NOT NULL,
  open_km          REAL,                      -- tal cual; un 0 legacy puede ser un «-» convertido
  total_km         REAL,
  anomalies        TEXT,
  UNIQUE (legacy_resort_id, obs_date)
);

-- Datos de Google Sheets (cuando llegue la exportación). Autoría legacy = texto; nunca se asigna sola.
CREATE TABLE legacy_comments (
  id                  TEXT PRIMARY KEY,
  file_id             TEXT NOT NULL REFERENCES legacy_import_files(id),
  row_hash            TEXT NOT NULL UNIQUE,
  legacy_author_name  TEXT,
  legacy_resort_id    TEXT,
  body                TEXT NOT NULL,
  created_at_text     TEXT,
  reconciled_user_id  TEXT REFERENCES users(id),  -- solo por acción administrativa explícita
  reconciled_by       TEXT REFERENCES users(id),
  reconciled_at       INTEGER,
  published           INTEGER NOT NULL DEFAULT 0  -- los legacy no se publican automáticamente
);

CREATE TABLE legacy_availability (
  id                 TEXT PRIMARY KEY,
  file_id            TEXT NOT NULL REFERENCES legacy_import_files(id),
  row_hash           TEXT NOT NULL UNIQUE,
  legacy_person_name TEXT NOT NULL,
  day                TEXT NOT NULL,
  legacy_status      TEXT NOT NULL,              -- valor original
  mapped_status      TEXT CHECK (mapped_status IN ('free','busy','maybe')),
  reconciled_user_id TEXT REFERENCES users(id)
);

CREATE TABLE legacy_shopping_items (
  id                 TEXT PRIMARY KEY,
  file_id            TEXT NOT NULL REFERENCES legacy_import_files(id),
  row_hash           TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  quantity_text      TEXT,
  price_text         TEXT,
  legacy_person_name TEXT,
  extra_json         TEXT
);
