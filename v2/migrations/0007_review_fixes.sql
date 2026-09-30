-- Correcciones de la revisión del 30/09/2026.

-- 1. Ejecuciones en varias partes (cada POST de un recolector es una parte acotada e idempotente).
--    status 'running' = faltan partes por recibir (incompleta, visible).
ALTER TABLE capture_runs ADD COLUMN parts_total INTEGER NOT NULL DEFAULT 1;
ALTER TABLE capture_runs ADD COLUMN parts_received INTEGER NOT NULL DEFAULT 0;
ALTER TABLE capture_runs ADD COLUMN accepted INTEGER NOT NULL DEFAULT 0;   -- observaciones válidas (nuevas o ya guardadas)
ALTER TABLE capture_runs ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0;

CREATE TABLE capture_run_parts (
  run_id       TEXT NOT NULL REFERENCES capture_runs(id),
  part         INTEGER NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  unsupported  INTEGER NOT NULL DEFAULT 0,
  accepted     INTEGER NOT NULL DEFAULT 0,
  rejected     INTEGER NOT NULL DEFAULT 0,
  received_at  INTEGER NOT NULL,
  PRIMARY KEY (run_id, part)
);
CREATE INDEX snow_obs_run ON snow_observations(run_id);
CREATE INDEX snow_obs_source_area ON snow_observations(source_id, area_id, observed_at);

-- 4/5. Identidad de ofertas: contexto de captura, ámbito, escenario y condiciones explícitas.
ALTER TABLE offers ADD COLUMN context TEXT NOT NULL DEFAULT 'catalog' CHECK (context IN ('catalog','scenario','manual'));
ALTER TABLE offers ADD COLUMN scenario_id TEXT REFERENCES search_scenarios(id);   -- serie propia de cada búsqueda
ALTER TABLE offers ADD COLUMN rooms INTEGER;
-- Si el paquete incluye forfait: 'unknown' cuando la tarjeta no lo dice (null ≠ «sin forfait»).
ALTER TABLE offers ADD COLUMN forfait_included TEXT NOT NULL DEFAULT 'unknown' CHECK (forfait_included IN ('yes','no','unknown'));
-- 1 solo si la tarjeta declara fechas y ocupación que coinciden con lo pedido al proveedor.
ALTER TABLE offers ADD COLUMN conditions_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offer_observations ADD COLUMN warnings TEXT;
CREATE INDEX offer_obs_run ON offer_observations(run_id, observed_at);
CREATE INDEX offers_scenario ON offers(scenario_id);

-- 2. Condiciones exactas del viaje y de cada candidatura (null = no consta; nunca se asume).
ALTER TABLE trips ADD COLUMN children_ages TEXT NOT NULL DEFAULT '[]';   -- edades de los menores incluidos en participants_planned
ALTER TABLE trips ADD COLUMN rooms INTEGER CHECK (rooms IS NULL OR rooms BETWEEN 1 AND 30);
ALTER TABLE trip_candidates ADD COLUMN adults INTEGER;
ALTER TABLE trip_candidates ADD COLUMN children_ages TEXT;               -- JSON; NULL = no consta
ALTER TABLE trip_candidates ADD COLUMN rooms INTEGER;
ALTER TABLE trip_candidates ADD COLUMN forfait_included TEXT NOT NULL DEFAULT 'unknown' CHECK (forfait_included IN ('yes','no','unknown'));
