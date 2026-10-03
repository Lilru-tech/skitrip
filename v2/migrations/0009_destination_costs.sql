-- Costes que dependen de la estación (forfait, alquiler, peajes, parking) por destino del viaje y, si hace falta, por
-- candidatura. Cada importe lleva procedencia y fecha. NULL = sin dato (nunca 0). Solo añade tablas y columnas:
-- compatible hacia atrás (el código anterior las ignora) y sin tocar datos existentes.
CREATE TABLE trip_destination_costs (
  trip_id                TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  area_id                TEXT NOT NULL REFERENCES areas(id),
  forfait_cents_per_day  INTEGER CHECK (forfait_cents_per_day IS NULL OR forfait_cents_per_day >= 0),
  rental_cents_per_day   INTEGER CHECK (rental_cents_per_day IS NULL OR rental_cents_per_day >= 0),
  tolls_cents_per_car    INTEGER CHECK (tolls_cents_per_car IS NULL OR tolls_cents_per_car >= 0),   -- ida + vuelta por coche
  parking_cents_per_car  INTEGER CHECK (parking_cents_per_car IS NULL OR parking_cents_per_car >= 0), -- estancia por coche
  kind                   TEXT NOT NULL DEFAULT 'confirmed' CHECK (kind IN ('confirmed', 'estimate')),
  source_note            TEXT,          -- p. ej. «web oficial, tarifa adulto 2 días»
  checked_on             TEXT,          -- YYYY-MM-DD
  updated_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at             INTEGER NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (trip_id, area_id)
);

-- Diferencias propias de una candidatura (p. ej. un apartamento con parking incluido). Tienen prioridad sobre el destino.
ALTER TABLE trip_candidates ADD COLUMN forfait_cents_per_day INTEGER CHECK (forfait_cents_per_day IS NULL OR forfait_cents_per_day >= 0);
ALTER TABLE trip_candidates ADD COLUMN rental_cents_per_day INTEGER CHECK (rental_cents_per_day IS NULL OR rental_cents_per_day >= 0);
ALTER TABLE trip_candidates ADD COLUMN tolls_cents_per_car INTEGER CHECK (tolls_cents_per_car IS NULL OR tolls_cents_per_car >= 0);
ALTER TABLE trip_candidates ADD COLUMN parking_cents_per_car INTEGER CHECK (parking_cents_per_car IS NULL OR parking_cents_per_car >= 0);
ALTER TABLE trip_candidates ADD COLUMN costs_note TEXT;
