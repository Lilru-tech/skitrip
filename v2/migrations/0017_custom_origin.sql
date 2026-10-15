-- Origen personalizado (dirección o punto en el mapa) con Geoapify Free.
--
-- area_access: punto de llegada en coche de cada estación para calcular rutas desde un origen cualquiera, en vez del
-- punto central del catálogo. Coordenadas aproximadas anotadas a mano el 15/10/2026, sin revisión humana
-- (reviewed = 0): la interfaz lo dice. Una estación sin fila usa su punto del catálogo y se indica igual.
-- mode 'rack_railway': no se llega en coche a la estación (Vall de Núria). La ruta llega a la estación del cremallera
-- y la nota explica el último tramo.
CREATE TABLE IF NOT EXISTS area_access (
  area_id  TEXT PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  lat      REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon      REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  mode     TEXT NOT NULL DEFAULT 'car' CHECK (mode IN ('car', 'rack_railway')),
  note     TEXT,
  source   TEXT NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0
);

-- Créditos de Geoapify gastados por día (UTC) y ámbito: 'global' o 'user:<id>'. Sirve para parar antes de agotar el
-- plan gratuito (3.000 créditos/día) y repartirlo entre personas. No guarda direcciones, coordenadas ni resultados.
CREATE TABLE IF NOT EXISTS geo_usage (
  day     TEXT NOT NULL,
  scope   TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope)
);

-- Solo si la estación existe (las bases de prueba no tienen el catálogo real).
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Funicamp (Encamp)', 42.534, 1.5815, 'car', 'Primera entrada desde el sur; Soldeu, El Tarter y Pas de la Casa quedan más lejos.', 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'grandvalira';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Telecabina de La Massana', 42.545, 1.515, 'car', NULL, 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'pal-arinsal';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Aparcamiento de La Coma (Arcalís)', 42.631, 1.494, 'car', NULL, 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'ordino-arcalis';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'La Molina (estación base)', 42.3365, 1.942, 'car', 'Masella está a unos minutos más.', 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'alp-2500';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Baqueira 1500', 42.699, 0.936, 'car', NULL, 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'baqueira-beret';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Port Ainé 2000', 42.424, 1.205, 'car', NULL, 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'port-aine';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Estación del cremallera de Queralbs', 42.35, 2.162, 'rack_railway', 'Sin acceso en coche: se aparca en Queralbs (o Ribes de Freser) y se sube en el cremallera; el tiempo no incluye la subida.', 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'vall-de-nuria';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source)
  SELECT id, 'Formigal (Sextas)', 42.7755, -0.3636, 'car', 'Panticosa está a unos 20 min de Formigal.', 'anotado a mano (15/10/2026), aproximado' FROM areas WHERE id = 'formigal-panticosa';
