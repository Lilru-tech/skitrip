-- Estado persistente de la vigilancia diaria (tools/watch.ts + tools/watch-policy.ts). Una fila por comprobación o
-- fuente prioritaria: «aislado» es un aviso de un día, «degradado» el mismo aviso en días seguidos y «fallo» un fallo
-- real. Solo la escribe el workflow «v2 · vigilar» con wrangler; la API solo la lee para Administración.
CREATE TABLE watch_findings (
  key          TEXT PRIMARY KEY,                     -- 'check:<nombre>' o 'source:<id>'
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('check','regression','pending','absence')),
  state        TEXT NOT NULL CHECK (state IN ('ok','aislado','degradado','fallo')),
  streak_days  INTEGER NOT NULL DEFAULT 0,           -- días distintos seguidos sin OK
  first_seen   TEXT,                                 -- AAAA-MM-DD del primer día sin OK de la racha
  last_day     TEXT NOT NULL,                        -- último día vigilado
  last_value   TEXT,
  issue_number INTEGER,                              -- aviso abierto en GitHub (etiqueta «vigilancia»)
  updated_at   INTEGER NOT NULL
);
