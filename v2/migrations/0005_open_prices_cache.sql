-- 0005: caché de Open Prices (datos colaborativos ODbL). Capa separada de los datos privados.
CREATE TABLE open_prices_cache (
  ean        TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok','empty','error')),
  payload    TEXT NOT NULL            -- JSON normalizado (sin datos de usuarios de Open Prices)
);
