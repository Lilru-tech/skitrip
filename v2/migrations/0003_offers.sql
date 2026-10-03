-- 0003: alojamientos, escenarios de búsqueda, ofertas y observaciones de precio.

CREATE TABLE providers (
  id              TEXT PRIMARY KEY,           -- 'esquiades', 'estiber', 'manual'
  name            TEXT NOT NULL,
  base_url        TEXT,
  enabled         INTEGER NOT NULL DEFAULT 0,
  terms_checked   TEXT,                       -- fecha de revisión de condiciones/robots
  terms_notes     TEXT
);

CREATE TABLE hotels (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  area_id   TEXT REFERENCES areas(id),
  locality  TEXT,
  lat       REAL,
  lon       REAL
);

-- Identidad por proveedor. Dos proveedores solo se consideran el mismo hotel con equivalencia verificada.
CREATE TABLE hotel_provider_ids (
  provider_id       TEXT NOT NULL REFERENCES providers(id),
  provider_hotel_id TEXT NOT NULL,
  hotel_id          TEXT NOT NULL REFERENCES hotels(id),
  verified_by       TEXT REFERENCES users(id),
  verified_at       INTEGER,
  PRIMARY KEY (provider_id, provider_hotel_id)
);

-- Escenario = búsqueda concreta. Cambiar fechas, noches, ocupación o modalidad = otro escenario.
CREATE TABLE search_scenarios (
  id              TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL REFERENCES providers(id),
  area_id         TEXT NOT NULL REFERENCES areas(id),
  modality        TEXT NOT NULL CHECK (modality IN ('lodging','lodging_forfait')),
  check_in        TEXT NOT NULL,
  check_out       TEXT NOT NULL,
  nights          INTEGER NOT NULL CHECK (nights BETWEEN 1 AND 30),
  adults          INTEGER NOT NULL CHECK (adults BETWEEN 1 AND 30),
  children_ages   TEXT NOT NULL DEFAULT '[]',
  rooms           INTEGER CHECK (rooms IS NULL OR rooms BETWEEN 1 AND 15),
  forfait_days    INTEGER CHECK (forfait_days IS NULL OR forfait_days BETWEEN 0 AND 30),
  scenario_key    TEXT NOT NULL UNIQUE,      -- hash canónico para deduplicar viajes con la misma búsqueda
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  last_run_at     INTEGER,
  CHECK (check_out > check_in),
  CHECK ((modality = 'lodging') = (forfait_days IS NULL OR forfait_days = 0))
);

CREATE TABLE trip_scenarios (
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES search_scenarios(id),
  PRIMARY KEY (trip_id, scenario_id)
);

-- Oferta = identidad + condiciones. El precio va en observaciones inmutables.
CREATE TABLE offers (
  id                    TEXT PRIMARY KEY,
  provider_id           TEXT NOT NULL REFERENCES providers(id),
  provider_offer_id     TEXT,
  hotel_id              TEXT REFERENCES hotels(id),
  hotel_name_raw        TEXT,
  area_id               TEXT REFERENCES areas(id),
  forfait_area_id       TEXT REFERENCES areas(id),
  modality              TEXT NOT NULL CHECK (modality IN ('lodging','lodging_forfait')),
  check_in              TEXT,
  check_out             TEXT,
  nights                INTEGER,
  adults                INTEGER,
  children_ages         TEXT,
  room_distribution     TEXT,
  board                 TEXT,                 -- 'SA','AD','MP','PC', o texto del proveedor
  cancellation          TEXT CHECK (cancellation IS NULL OR cancellation IN ('free','partial','non_refundable','unknown')),
  cancellation_deadline TEXT,
  taxes_note            TEXT,
  forfait_days          INTEGER,
  forfait_dates         TEXT,
  url                   TEXT,
  identity_hash         TEXT NOT NULL UNIQUE,  -- proveedor + id/hotel + condiciones (no el precio)
  first_seen_at         INTEGER NOT NULL
);
CREATE INDEX offers_area ON offers(area_id, modality);

CREATE TABLE offer_observations (
  id                TEXT PRIMARY KEY,
  offer_id          TEXT NOT NULL REFERENCES offers(id),
  scenario_id       TEXT REFERENCES search_scenarios(id),
  run_id            TEXT REFERENCES capture_runs(id),
  observed_at       INTEGER NOT NULL,
  price_kind        TEXT NOT NULL CHECK (price_kind IN ('advertised_from','quoted_for_search','manual_estimate','user_quote')),
  amount_cents      INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  unit              TEXT NOT NULL CHECK (unit IN ('per_person','per_room','per_night','per_person_night','per_stay','unknown')),
  currency          TEXT NOT NULL DEFAULT 'EUR',
  availability      TEXT NOT NULL CHECK (availability IN ('available','unavailable','unknown')),
  extractor         TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  UNIQUE (offer_id, content_hash)
);
CREATE INDEX offer_obs_offer ON offer_observations(offer_id, observed_at);

-- Resultado de cada búsqueda: distingue búsqueda vacía de error y de no observada.
CREATE TABLE scenario_runs (
  id           TEXT PRIMARY KEY,
  scenario_id  TEXT NOT NULL REFERENCES search_scenarios(id),
  run_id       TEXT REFERENCES capture_runs(id),
  observed_at  INTEGER NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('results','empty','error','blocked','unsupported')),
  offers_found INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  UNIQUE (scenario_id, run_id)
);

-- Candidaturas del viaje (oferta capturada o cotización introducida por un usuario) y votos.
CREATE TABLE trip_candidates (
  id            TEXT PRIMARY KEY,
  trip_id       TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  offer_id      TEXT REFERENCES offers(id),
  title         TEXT NOT NULL,
  area_id       TEXT REFERENCES areas(id),
  modality      TEXT NOT NULL CHECK (modality IN ('lodging','lodging_forfait')),
  url           TEXT,
  amount_cents  INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  unit          TEXT CHECK (unit IS NULL OR unit IN ('per_person','per_room','per_night','per_person_night','per_stay','unknown')),
  price_kind    TEXT CHECK (price_kind IS NULL OR price_kind IN ('advertised_from','quoted_for_search','manual_estimate','user_quote')),
  check_in      TEXT,
  check_out     TEXT,
  people        INTEGER,
  forfait_days  INTEGER,
  conditions    TEXT,
  pending_notes TEXT,                       -- qué falta confirmar
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','chosen','booked','discarded')),
  proposed_by   TEXT NOT NULL REFERENCES users(id),
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX trip_candidates_trip ON trip_candidates(trip_id);

CREATE TABLE candidate_votes (
  candidate_id TEXT NOT NULL REFERENCES trip_candidates(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value        INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, user_id)
);

-- Parámetros de presupuesto del viaje (todo explícito; NULL = pendiente, nunca 0 implícito).
CREATE TABLE trip_budget (
  trip_id                 TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  fuel_cents_per_litre    INTEGER,
  litres_per_100km_x10    INTEGER,          -- 65 = 6,5 l/100 km
  tolls_cents_per_car     INTEGER,          -- ida + vuelta por coche
  parking_cents_per_car   INTEGER,          -- total de la estancia por coche
  forfait_cents_per_day   INTEGER,          -- por persona y día (solo modalidad «solo alojamiento»)
  rental_cents_per_day    INTEGER,          -- por persona que alquila y día
  skiers                  INTEGER,
  renters                 INTEGER,
  groceries_cents         INTEGER,          -- total grupo (estimado desde la lista de compra o manual)
  chosen_candidate_id     TEXT REFERENCES trip_candidates(id) ON DELETE SET NULL,
  version                 INTEGER NOT NULL DEFAULT 1,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE saved_offers (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id   TEXT NOT NULL REFERENCES offers(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, offer_id)
);
