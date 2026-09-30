-- 0004: compra (productos exactos, listas por viaje, observaciones de precio, tickets) y gastos.

-- Producto exacto: formato y contenido explícitos. Un nombre genérico («leche») no es un producto.
CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  retailer    TEXT NOT NULL DEFAULT 'mercadona',
  retailer_ref TEXT,                          -- ID interno del comercio, si se conoce
  ean         TEXT CHECK (ean IS NULL OR ean GLOB '[0-9]*'),
  name        TEXT NOT NULL,
  brand       TEXT,
  format      TEXT,                           -- 'Brick 1 L', 'Paquete 6 x 125 g'
  net_qty     INTEGER CHECK (net_qty IS NULL OR net_qty > 0),   -- en la unidad base
  net_unit    TEXT CHECK (net_unit IS NULL OR net_unit IN ('g','ml','unit')),
  ref_url     TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  replaced_by TEXT REFERENCES products(id),   -- cambio de formato registrado, no sobrescrito
  CHECK ((net_qty IS NULL) = (net_unit IS NULL))
);
CREATE UNIQUE INDEX products_retailer_ref ON products(retailer, retailer_ref) WHERE retailer_ref IS NOT NULL;
CREATE INDEX products_ean ON products(ean);

CREATE TABLE shopping_lists (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  store_label TEXT NOT NULL DEFAULT 'Mercadona online',
  postal_code TEXT NOT NULL DEFAULT '43007',
  channel    TEXT NOT NULL DEFAULT 'online' CHECK (channel IN ('online','store')),
  created_at INTEGER NOT NULL
);

CREATE TABLE shopping_items (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  product_id   TEXT REFERENCES products(id),
  qty          INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),  -- nº de envases del producto (o unidades si genérico)
  note         TEXT,
  bought       INTEGER NOT NULL DEFAULT 0,
  assignee_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  legacy_name  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX shopping_items_list ON shopping_items(list_id);

-- Tickets propios: se guardan líneas y totales, no la imagen. Hash para no importar dos veces.
CREATE TABLE receipts (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  trip_id       TEXT REFERENCES trips(id) ON DELETE SET NULL,
  store_label   TEXT NOT NULL,
  postal_code   TEXT,
  channel       TEXT NOT NULL CHECK (channel IN ('online','store')),
  purchased_on  TEXT NOT NULL,
  total_cents   INTEGER NOT NULL CHECK (total_cents >= 0),
  content_hash  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (owner_id, content_hash)
);

CREATE TABLE receipt_lines (
  id           TEXT PRIMARY KEY,
  receipt_id   TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  raw_text     TEXT NOT NULL,
  product_id   TEXT REFERENCES products(id),
  qty          REAL NOT NULL DEFAULT 1,
  unit_cents   INTEGER,
  amount_cents INTEGER NOT NULL,
  UNIQUE (receipt_id, line_no)
);

-- Observaciones de precio: nunca se mezclan tipos. Un día sin observación no genera fila.
CREATE TABLE price_observations (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id),
  source          TEXT NOT NULL CHECK (source IN ('manual','csv','receipt','open_prices','licensed')),
  price_type      TEXT NOT NULL CHECK (price_type IN ('shelf','promo','personal_discount','receipt_effective')),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),   -- por envase
  currency        TEXT NOT NULL DEFAULT 'EUR',
  promo_note      TEXT,
  store_label     TEXT NOT NULL,
  postal_code     TEXT,
  channel         TEXT NOT NULL CHECK (channel IN ('online','store','unknown')),
  observed_on     TEXT NOT NULL,
  receipt_line_id TEXT REFERENCES receipt_lines(id) ON DELETE CASCADE,
  external_ref    TEXT,                       -- id de Open Prices, con atribución
  owner_id        TEXT REFERENCES users(id),  -- NULL solo para datos colaborativos públicos
  visibility      TEXT NOT NULL CHECK (visibility IN ('private','shared_trips','public_collab')),
  dedupe_hash     TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL
);
CREATE INDEX price_obs_product ON price_observations(product_id, observed_on);

-- Gastos reales del viaje.
CREATE TABLE expenses (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  concept      TEXT NOT NULL CHECK (length(concept) BETWEEN 1 AND 200),
  spent_on     TEXT NOT NULL,
  payer_id     TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  split_mode   TEXT NOT NULL CHECK (split_mode IN ('equal','custom')),
  category     TEXT,
  receipt_id   TEXT UNIQUE REFERENCES receipts(id),   -- un ticket se vincula como mucho a un gasto
  version      INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX expenses_trip ON expenses(trip_id, spent_on);

CREATE TABLE expense_shares (
  expense_id  TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

-- Transferencias compensatorias registradas a mano. No son gastos ni ejecutan pagos.
CREATE TABLE settlements (
  id           TEXT PRIMARY KEY,
  trip_id      TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_user    TEXT NOT NULL REFERENCES users(id),
  to_user      TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_on      TEXT NOT NULL,
  note         TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  CHECK (from_user <> to_user)
);

CREATE TABLE expense_history (
  id          TEXT PRIMARY KEY,
  expense_id  TEXT NOT NULL,
  trip_id     TEXT NOT NULL,
  actor_id    TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete','settle','unsettle')),
  before_json TEXT,
  after_json  TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX expense_history_trip ON expense_history(trip_id, at);
