-- Origen personalizado (dirección o punto en el mapa) con Geoapify Free.
--
-- area_access: punto de llegada en coche de cada estación comparada, para calcular rutas desde un origen cualquiera en
-- vez del punto central del catálogo. Coordenadas consultadas el 16/10/2026 en las páginas citadas en `source` (ficha
-- «arrival-car» de skiresort.com, que las toma de Google Maps «sin garantía», contrastada cuando ha sido posible con la
-- web oficial, de turismo o park4night). docs/PUNTOS-DE-LLEGADA.md recoge el detalle. confidence:
--   'contrasted'    dos fuentes públicas independientes coinciden (a menos de ~0,5 km);
--   'single_source' una sola fuente pública, sin contrastar: la interfaz lo dice;
--   'approximate'   el punto no es el aparcamiento real o no se ha podido confirmar: la interfaz lo dice.
-- Ninguno se ha comprobado sobre el terreno. Una estación sin fila usa el punto central del catálogo y se indica que no
-- es un acceso verificado.
-- mode 'rack_railway': no se llega en coche a la estación (Vall de Núria). La ruta llega al aparcamiento del
-- cremallera y la nota explica el tramo que no incluye.
CREATE TABLE IF NOT EXISTS area_access (
  area_id  TEXT PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  lat      REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon      REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  mode     TEXT NOT NULL DEFAULT 'car' CHECK (mode IN ('car', 'rack_railway')),
  note     TEXT,
  source   TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'approximate' CHECK (confidence IN ('contrasted', 'single_source', 'approximate')),
  checked_on TEXT
);

-- Créditos de Geoapify gastados por día (UTC) y ámbito: 'global' o 'user:<id>'. Sirve para parar antes de agotar el
-- plan gratuito (3.000 créditos/día) y repartirlo entre personas. No guarda direcciones, coordenadas ni resultados.
CREATE TABLE IF NOT EXISTS geo_usage (
  day     TEXT NOT NULL,
  scope   TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope)
);

-- Solo si la estación existe (las bases de prueba no tienen el catálogo real). Una sentencia por fila (D1 limita los
-- SELECT compuestos).
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Funicamp (Encamp), aparcamiento de pago', 42.53552, 1.58775, 'car', 'Primera entrada desde el sur; Canillo, Soldeu, El Tarter, Grau Roig y Pas de la Casa tienen sus propios aparcamientos, más lejos.', 'https://www.skiresort.com/en/ski-resort/grandvalira-pas-de-la-casa-grau-roig-soldeu-el-tarter-canillo-encamp/arrival-car/', 'single_source', '2026-10-16' FROM areas WHERE id = 'grandvalira';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Pal, aparcamiento de La Caubella', 42.53642, 1.49018, 'car', 'También se sube en telecabina desde La Massana (aparcamiento de pago) o desde Arinsal.', 'https://www.skiresort.com/en/ski-resort/pal-arinsal-la-massana/arrival-car/ · https://www.palarinsal.com/en/resort/parking', 'contrasted', '2026-10-16' FROM areas WHERE id = 'pal-arinsal';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Aparcamiento de La Basera / L''Hortell', 42.63123, 1.50014, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/ordino-arcalis/arrival-car/ · https://ordinoarcalis.com/en/resort/how-to-arrive-park', 'contrasted', '2026-10-16' FROM areas WHERE id = 'ordino-arcalis';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'La Molina, base del telecabina Cadí-Moixeró', 42.33468, 1.93492, 'car', 'Masella tiene su propio acceso, a unos minutos.', 'https://www.skiresort.com/en/ski-resort/la-molina-masella-alp2500/arrival-car/ · https://park4night.com/en/place/21060', 'contrasted', '2026-10-16' FROM areas WHERE id = 'alp-2500';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Baqueira 1500, aparcamiento del telecabina Baqueira II', 42.69868, 0.93438, 'car', 'Beret tiene otro acceso, más arriba.', 'https://www.skiresort.com/en/ski-resort/baqueira-beret/arrival-car/', 'single_source', '2026-10-16' FROM areas WHERE id = 'baqueira-beret';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Port Ainé 2000 (base)', 42.4284, 1.21384, 'car', 'En invierno se aparca en el nuevo aparcamiento de Rabasta, cuya ubicación exacta no está publicada: el punto es la base de la estación.', 'https://www.skiresort.com/en/ski-resort/port-aine/arrival-car/ · https://surtdecasa.cat/pirineus/llocs-interes/rialp/estacio-de-muntanya-de-port-aine', 'approximate', '2026-10-16' FROM areas WHERE id = 'port-aine';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Espot, base de La Roca', 42.56358, 1.09372, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/espot-esqui/arrival-car/', 'single_source', '2026-10-16' FROM areas WHERE id = 'espot-esqui';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Boí Taüll, base de Pla de Vaques', 42.47814, 0.87053, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/boi-tauell/arrival-car/ · https://femturisme.cat/es/establecimientos/estacio-muntanya-boi-taull', 'contrasted', '2026-10-16' FROM areas WHERE id = 'boi-taull';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Port del Comte, base de El Querol', 42.17227, 1.56126, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/port-del-comte/arrival-car/ · https://park4night.com/en/place/28482', 'contrasted', '2026-10-16' FROM areas WHERE id = 'port-del-comte';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Aparcamiento de la estación del cremallera de Queralbs', 42.35168, 2.1665, 'rack_railway', 'Sin acceso en coche: la ruta llega al aparcamiento del cremallera en Queralbs. No incluye la subida en cremallera de Queralbs a Núria (unos 17 min y unos 750 m de desnivel), con billete aparte que no se suma al transporte; horarios y precios en valldenuria.cat. También se puede subir desde Ribes de Freser (unos 39 min).', 'https://park4night.com/en/place/77715 · https://barcelonaurbana.com/ca/blog/vall-de-nuria-preu-del-cremallera-i-horaris', 'contrasted', '2026-10-16' FROM areas WHERE id = 'vall-de-nuria';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Cerler, aparcamiento de El Molino', 42.58692, 0.54021, 'car', 'Ampriú (1.900 m) tiene otro acceso por carretera.', 'https://www.skiresort.com/en/ski-resort/cerler/arrival-car/ · https://park4night.com/en/place/44187', 'contrasted', '2026-10-16' FROM areas WHERE id = 'cerler';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Valdelinares, aparcamiento del sector central', 40.37938, -0.63331, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/valdelinares-sierra-de-gudar/arrival-car/ · https://park4night.com/en/place/203111', 'contrasted', '2026-10-16' FROM areas WHERE id = 'valdelinares';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Javalambre, aparcamiento de la base (Camarena de la Sierra)', 40.11429, -1.01749, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/javalambre/arrival-car/ · https://park4night.com/es/place/169366', 'contrasted', '2026-10-16' FROM areas WHERE id = 'javalambre';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Font-Romeu, telecabina Airelles Express (aparcamiento cubierto)', 42.50558, 2.04176, 'car', 'Pyrénées 2000 (Bolquère) tiene su propio acceso.', 'https://www.skiresort.com/en/ski-resort/font-romeu-bolquere-pyrenees-2000/arrival-car/ · https://www.skipass.com/news/font-romeu-nouvelle-telecabine-airelles.html', 'contrasted', '2026-10-16' FROM areas WHERE id = 'font-romeu-pyrenees-2000';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Les Angles, aparcamiento de Pla del Mir', 42.5641, 2.06481, 'car', 'También hay telecabina desde el pueblo (Les Pèlerins).', 'https://www.skiresort.com/en/ski-resort/les-angles/arrival-car/ · https://www.visit-occitanie.com/en/fiche/hotellerie-plein-air/aire-de-stationnement-camping-car-les-angles_TFOACCAMLAR06600021/', 'contrasted', '2026-10-16' FROM areas WHERE id = 'les-angles';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Ax 3 Domaines, aparcamiento de Bonascre', 42.6995, 1.81292, 'car', 'También se sube en telecabina desde Ax-les-Thermes.', 'https://www.tourisme-occitanie.com/fr/fiche/equipement/station-d-ax-3-domaines-ax-les-thermes_TFOSITRA2_SKI_6250186/ · https://www.skiresort.com/en/ski-resort/ax-3-domaines-ax-les-thermes/arrival-car/', 'contrasted', '2026-10-16' FROM areas WHERE id = 'ax-3-domaines';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Formigal, aparcamiento de Sextas', 42.77481, -0.37275, 'car', 'Panticosa tiene su propio acceso (telecabina desde el pueblo), a unos 20 min.', 'https://www.skiresort.com/en/ski-resort/formigal/arrival-car/', 'single_source', '2026-10-16' FROM areas WHERE id = 'formigal-panticosa';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Astún, aparcamiento de la base', 42.80989, -0.50435, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/astun/arrival-car/ · https://park4night.com/fr/place/483267', 'contrasted', '2026-10-16' FROM areas WHERE id = 'astun';
INSERT OR IGNORE INTO area_access (area_id, name, lat, lon, mode, note, source, confidence, checked_on)
  SELECT id, 'Candanchú, aparcamiento de Tobazo', 42.78811, -0.52987, 'car', NULL, 'https://www.skiresort.com/en/ski-resort/candanchu/arrival-car/', 'single_source', '2026-10-16' FROM areas WHERE id = 'candanchu';
