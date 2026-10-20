-- Aportaciones manuales de administración al catálogo de pistas (total y colores).
--
-- area_runs lo reescribe la importación en cada publicación (data/catalog.json): una edición guardada ahí desaparecería
-- en el siguiente despliegue. Por eso las aportaciones viven aparte, con su historial, y la cifra que se muestra y puntúa
-- se resuelve al leer (src/core/runs-manual.ts, resolveRunCatalog): el catálogo importado válido prevalece; la
-- aportación completa sus huecos o lo sustituye si falta, no es fiable o es de una temporada anterior.
--
-- Varias aportaciones por área, como mucho una ACTIVA por temporada declarada (o sin temporada): la vigente y una ficha
-- ya publicada para la próxima temporada conviven, y guardar, editar o retirar una no toca la otra. Cuál se aplica se
-- decide al leer (pickManual). Retirar no borra: status = 'withdrawn'. version evita sobrescrituras silenciosas entre
-- dos administradores. NULL = sin dato; 0 = cero confirmado.
CREATE TABLE IF NOT EXISTS area_run_contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     TEXT NOT NULL REFERENCES areas(id),
  total       INTEGER CHECK (total IS NULL OR total >= 0),
  green       INTEGER CHECK (green IS NULL OR green >= 0),
  blue        INTEGER CHECK (blue IS NULL OR blue >= 0),
  red         INTEGER CHECK (red IS NULL OR red >= 0),
  black       INTEGER CHECK (black IS NULL OR black >= 0),
  comparable  INTEGER NOT NULL DEFAULT 1 CHECK (comparable IN (0, 1)),
  resolution  TEXT,
  season      TEXT,
  source_date TEXT,
  source_ref  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  entered_on  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS area_run_contributions_active_season ON area_run_contributions (area_id, COALESCE(season, '')) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS area_run_contributions_area ON area_run_contributions (area_id);

-- Historial (solo administración): quién, qué, valores anteriores y nuevos, fuente, fecha y motivo. Nunca se borra.
-- contribution_id = aportación a la que se refiere la entrada. action 'import_change' = la importación cambió la cifra
-- importada de un área con alguna aportación activa (actor y aportación NULL: afecta al área).
CREATE TABLE IF NOT EXISTS area_run_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     TEXT NOT NULL,
  contribution_id INTEGER,
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'withdraw', 'restore', 'import_change')),
  actor_id    TEXT REFERENCES users(id),
  at          INTEGER NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  source_ref  TEXT,
  reason      TEXT,
  version     INTEGER
);
CREATE INDEX IF NOT EXISTS area_run_history_area ON area_run_history (area_id, id);
