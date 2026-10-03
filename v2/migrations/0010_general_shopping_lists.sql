-- 0010: listas de la compra generales (reutilizables, sin viaje) y procedencia de las copias en las listas de viaje.
-- Solo añade tablas, índices y una columna anulable: no reescribe ni borra datos existentes.

-- Lista general: pertenece a una persona y es privada (solo la ve y edita su propietario). No depende de ningún viaje.
CREATE TABLE general_lists (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  version    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX general_lists_owner ON general_lists(owner_id, created_at);

-- Artículo de la lista general. Puede estar incompleto (sin producto exacto, cantidad dudosa): se conserva y se
-- indica qué falta. Los datos de la hoja antigua se guardan como texto de procedencia, nunca como precio actual.
CREATE TABLE general_list_items (
  id                TEXT PRIMARY KEY,
  list_id           TEXT NOT NULL REFERENCES general_lists(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  product_id        TEXT REFERENCES products(id),
  qty               INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 999),  -- envases (o unidades si no hay producto)
  per_day           INTEGER NOT NULL DEFAULT 0 CHECK (per_day IN (0, 1)),       -- la cantidad es por día de esquí
  qty_unclear       INTEGER NOT NULL DEFAULT 0 CHECK (qty_unclear IN (0, 1)),   -- cantidad de la hoja no numérica: revisar
  note              TEXT CHECK (note IS NULL OR length(note) <= 300),
  legacy_item_id    TEXT REFERENCES legacy_shopping_items(id),
  legacy_name       TEXT,
  legacy_qty_text   TEXT,
  legacy_price_text TEXT,                                                       -- precio antiguo de la hoja: sin fecha ni tienda
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX general_list_items_list ON general_list_items(list_id, created_at);
-- Importar la hoja antigua dos veces en la misma lista no duplica.
CREATE UNIQUE INDEX general_list_items_legacy ON general_list_items(list_id, legacy_item_id) WHERE legacy_item_id IS NOT NULL;

-- Copia en un viaje: artículo independiente que solo recuerda de qué artículo general salió (para avisar de
-- coincidencias al volver a copiar). Borrar la lista general no borra las copias.
ALTER TABLE shopping_items ADD COLUMN source_list_item_id TEXT REFERENCES general_list_items(id) ON DELETE SET NULL;
CREATE INDEX shopping_items_source ON shopping_items(source_list_item_id) WHERE source_list_item_id IS NOT NULL;
