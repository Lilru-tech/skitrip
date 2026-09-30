-- Recorridos de migración legacy (revisión del 30/09/2026).
-- Procedencia de artículos de compra recuperados de la hoja antigua; un artículo legacy entra una sola vez por lista.
ALTER TABLE shopping_items ADD COLUMN legacy_item_id TEXT REFERENCES legacy_shopping_items(id);
CREATE UNIQUE INDEX shopping_items_legacy ON shopping_items(list_id, legacy_item_id) WHERE legacy_item_id IS NOT NULL;
-- Cuándo incorporó la persona un día legacy a su calendario (solo informativo; la incorporación es explícita).
ALTER TABLE legacy_availability ADD COLUMN incorporated_at INTEGER;
CREATE INDEX legacy_availability_user ON legacy_availability(reconciled_user_id, day);
CREATE INDEX legacy_comments_resort ON legacy_comments(legacy_resort_id) WHERE published = 1;
-- Proveedores de ofertas: antes solo los creaba el importador legacy y, sin él, crear un escenario daba error 500.
INSERT OR IGNORE INTO providers (id, name, base_url, enabled) VALUES
  ('esquiades', 'Esquiades', 'https://www.esquiades.com', 0),
  ('estiber', 'Estiber', 'https://www.estiber.com', 0),
  ('manual', 'Cotización manual', NULL, 0);
