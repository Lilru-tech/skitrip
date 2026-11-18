-- Previsión meteorológica (docs/METEO-AFLUENCIA.md): caché compartida por estación, una descarga a la vez por punto
-- y tope propio de unidades de Open-Meteo al día. Solo se guarda la agregación diaria por modelo (no las series
-- horarias), con la hora de cada pasada. Nadie edita previsiones a mano.
CREATE TABLE IF NOT EXISTS weather_forecasts (
  area_id           TEXT PRIMARY KEY REFERENCES areas(id),
  fetched_at        INTEGER,                 -- última descarga correcta (ms); NULL = nunca
  payload           TEXT,                    -- JSON de core/weather.ts StoredForecast
  last_error        TEXT,                    -- último fallo (cuota, red, proveedor), sin datos personales
  last_error_at     INTEGER,
  refreshing_until  INTEGER,                 -- descarga en curso hasta este instante (evita duplicadas simultáneas)
  last_requested_at INTEGER                  -- última consulta desde la web: el cron solo refresca lo que se mira
);
CREATE TABLE IF NOT EXISTS weather_usage (
  day      TEXT PRIMARY KEY,                 -- día UTC (el proveedor cuenta por día)
  units    REAL NOT NULL DEFAULT 0,          -- unidades estimadas de Open-Meteo reservadas antes de llamar
  requests INTEGER NOT NULL DEFAULT 0
);
