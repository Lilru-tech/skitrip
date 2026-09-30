-- DATOS SINTÉTICOS SOLO PARA E2E (test/e2e/.state). No representan estaciones, rutas ni precios reales.
-- Todos los nombres llevan «(sintético)». Se aplican sobre la D1 local de pruebas en cada ejecución.
INSERT INTO origins (id, name, lat, lon) VALUES ('tarragona', 'Tarragona', 41.1189, 1.2445), ('sabadell', 'Sabadell', 41.5463, 2.1086);

INSERT INTO areas (id, name, kind, country, region, lat, lon, official_total_km, total_km_source, vibe_score, apres_score, notes) VALUES
  ('e2e-dominio', 'Dominio Alfa (sintético)', 'domain', 'ES', 'Pirineo sintético', 42.30, 1.90, 120, 'e2e', 8, 7, 'Dominio conjunto de prueba.'),
  ('e2e-alfa-norte', 'Alfa Norte (sintético)', 'resort', 'ES', 'Pirineo sintético', 42.31, 1.91, 70, 'e2e', 7, 6, NULL),
  ('e2e-alfa-sur', 'Alfa Sur (sintético)', 'resort', 'ES', 'Pirineo sintético', 42.29, 1.89, 50, 'e2e', 6, 5, NULL),
  ('e2e-beta', 'Beta (sintético)', 'resort', 'AD', 'Andorra sintética', 42.55, 1.60, 90, 'e2e', 9, 9, NULL),
  ('e2e-lejana', 'Gamma Lejana (sintético)', 'resort', 'FR', 'Alpes sintéticos', 45.30, 6.50, 300, 'e2e', 9, 8, NULL),
  ('e2e-sin-ruta', 'Delta Sin Ruta (sintético)', 'resort', 'ES', 'Pirineo sintético', 42.70, 0.90, NULL, NULL, NULL, NULL, NULL);

INSERT INTO area_links (parent_id, child_id, relation) VALUES ('e2e-dominio', 'e2e-alfa-norte', 'member'), ('e2e-dominio', 'e2e-alfa-sur', 'member');

INSERT INTO routes (origin_id, area_id, access_name, road_km, duration_min, source, checked_on, validated, notes) VALUES
  ('tarragona', 'e2e-dominio', 'Acceso Alfa', 190, 150, 'manual', '2026-09-01', 1, NULL),
  ('tarragona', 'e2e-alfa-norte', 'Alfa Norte', 195, 155, 'manual', '2026-09-01', 1, NULL),
  ('tarragona', 'e2e-alfa-sur', 'Alfa Sur', 185, 145, 'manual', '2026-09-01', 1, NULL),
  ('tarragona', 'e2e-beta', 'Beta', 250, 190, 'manual', '2026-09-01', 0, 'Pendiente de validar (sintético).'),
  ('tarragona', 'e2e-lejana', 'Gamma', 780, 480, 'manual', '2026-09-01', 1, NULL),
  ('sabadell', 'e2e-dominio', 'Acceso Alfa', 150, 120, 'manual', '2026-09-01', 1, NULL),
  ('sabadell', 'e2e-alfa-norte', 'Alfa Norte', 155, 125, 'manual', '2026-09-01', 1, NULL),
  ('sabadell', 'e2e-alfa-sur', 'Alfa Sur', 145, 115, 'manual', '2026-09-01', 1, NULL),
  ('sabadell', 'e2e-beta', 'Beta', 200, 160, 'manual', '2026-09-01', 1, NULL),
  ('sabadell', 'e2e-lejana', 'Gamma', 740, 450, 'manual', '2026-09-01', 1, NULL);

INSERT INTO sources (id, area_id, scope_area_id, kind, provider, url, method, fields, priority, status, checked_on, limitations, adapter) VALUES
  ('e2e-dominio-snow', 'e2e-dominio', 'e2e-dominio', 'snow', 'official', 'https://example.invalid/alfa', 'html', '["open_km","total_km"]', 10, 'verified', '2026-09-01', 'Fuente sintética.', 'e2e'),
  ('e2e-beta-snow', 'e2e-beta', 'e2e-beta', 'snow', 'official', 'https://example.invalid/beta', 'html', '["open_km","total_km"]', 10, 'unverified', '2026-09-01', NULL, 'e2e'),
  ('e2e-beta-offers', 'e2e-beta', 'e2e-beta', 'offers', 'esquiades', 'https://example.invalid/ofertas', 'html', '["price"]', 20, 'broken', '2026-09-01', 'Adaptador roto (sintético).', 'e2e');

INSERT INTO source_health (source_id, last_attempt_at, last_success_at, last_status, last_error, consecutive_fail) VALUES
  ('e2e-dominio-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, 'ok', NULL, 0),
  ('e2e-beta-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, CAST(strftime('%s','now') AS INTEGER) * 1000 - 5 * 86400000, 'error', 'HTTP 503 (sintético)', 3),
  ('e2e-beta-offers', CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, NULL, 'error', 'Selector no encontrado (sintético)', 9);

-- Nieve: dominio fresco (hace 1 h) con historial; Beta desactualizada (hace 5 días); sin datos para el resto.
INSERT INTO snow_observations (id, area_id, source_id, observed_at, source_date, op_status, open_km, total_km, content_hash, extractor) VALUES
  ('e2e-s1', 'e2e-dominio', 'e2e-dominio-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, NULL, 'open', 85, 120, 'h1', 'e2e'),
  ('e2e-s2', 'e2e-dominio', 'e2e-dominio-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 86400000 - 3600000, NULL, 'open', 80, 120, 'h2', 'e2e'),
  ('e2e-s3', 'e2e-dominio', 'e2e-dominio-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 2 * 86400000 - 3600000, NULL, 'partial', 60, 120, 'h3', 'e2e'),
  ('e2e-s4', 'e2e-beta', 'e2e-beta-snow', CAST(strftime('%s','now') AS INTEGER) * 1000 - 5 * 86400000, NULL, 'open', 40, 90, 'h4', 'e2e');

INSERT INTO legacy_import_files (id, kind, file_name, sha256, bytes, records, imported_at) VALUES ('e2e-legacy', 'open_km_history', 'sintetico.json', 'e2e-sha', 1, 1, 0);
INSERT INTO legacy_snow_observations (file_id, legacy_resort_id, obs_date, open_km, total_km, anomalies, scope_area_id) VALUES
  ('e2e-legacy', 'beta', '2026-02-10', 0, 90, '["cero posiblemente «-»"]', 'e2e-beta');

INSERT OR IGNORE INTO providers (id, name, base_url, enabled) VALUES ('esquiades', 'Esquiades', 'https://example.invalid', 0), ('estiber', 'Estiber', 'https://example.invalid', 0);
INSERT INTO offers (id, provider_id, hotel_name_raw, area_id, modality, check_in, check_out, nights, adults, board, url, identity_hash, first_seen_at) VALUES
  ('e2e-o1', 'esquiades', 'Hotel Uno (sintético)', 'e2e-beta', 'lodging', '2027-01-15', '2027-01-17', 2, 2, 'AD', 'https://example.invalid/o1', 'e2e-o1', 0),
  ('e2e-o2', 'estiber', 'Apartamentos Dos (sintético)', 'e2e-beta', 'lodging_forfait', '2027-02-05', '2027-02-07', 2, 4, 'SA', 'https://example.invalid/o2', 'e2e-o2', 0);
INSERT INTO offer_observations (id, offer_id, scenario_id, observed_at, price_kind, amount_cents, unit, availability, extractor, content_hash) VALUES
  ('e2e-ob1', 'e2e-o1', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000 - 7200000, 'advertised_from', 8900, 'per_person', 'available', 'e2e', 'c1'),
  ('e2e-ob2', 'e2e-o2', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000 - 7200000, 'advertised_from', 31000, 'per_room', 'unknown', 'e2e', 'c2');

-- Hoja antigua (sintético): compra recuperable y un comentario publicado por administración.
INSERT INTO legacy_shopping_items (id, file_id, row_hash, name, quantity_text, price_text, legacy_person_name, extra_json) VALUES
  ('e2e-ls1', 'e2e-legacy', 'e2e-ls-h1', 'Leche (hoja sintética)', '6', '5,40', NULL, NULL),
  ('e2e-ls2', 'e2e-legacy', 'e2e-ls-h2', 'Pan de molde (hoja sintética)', '2', NULL, NULL, NULL);
INSERT INTO legacy_comments (id, file_id, row_hash, legacy_author_name, legacy_resort_id, body, created_at_text, published) VALUES
  ('e2e-lc1', 'e2e-legacy', 'e2e-lc-h1', 'Pepe', 'e2e-beta', 'Buena nieve polvo por la mañana (sintético).', '2025-02-01', 1);
