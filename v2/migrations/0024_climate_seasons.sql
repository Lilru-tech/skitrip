-- Clima habitual (docs/METEO-AFLUENCIA.md §3): series diarias de ERA5 («Histórico reconstruido») por punto y
-- temporada (del 20/10 al 10/05), preparadas una vez desde GitHub Actions (tools/climate-prepare.ts) y enviadas por la
-- ingesta. La ficha resume la ventana de ±7 días leyendo estas filas: nunca descarga décadas al abrirse.
CREATE TABLE IF NOT EXISTS climate_seasons (
  area_id             TEXT NOT NULL REFERENCES areas(id),
  source              TEXT NOT NULL CHECK (source IN ('era5')),
  season              INTEGER NOT NULL,        -- año en que empieza la temporada (20/10)
  requested_elevation INTEGER,                 -- altitud del punto pedida al proveedor (m)
  cell_lat            REAL,
  cell_lon            REAL,
  cell_elevation      REAL,                    -- altitud a la que respondió el proveedor
  payload             TEXT NOT NULL,           -- JSON de core/climate.ts ClimateSeries (null = sin dato; 0 es cero)
  fetched_at          INTEGER NOT NULL,
  PRIMARY KEY (area_id, source, season)
);
