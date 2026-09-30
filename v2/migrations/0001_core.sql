-- 0001: identidad, permisos, amigos, viajes, calendario, comentarios, auditoría.
-- Convenciones: IDs TEXT (UUID), instantes en epoch ms UTC (INTEGER),
-- fechas de calendario 'YYYY-MM-DD' locales (TEXT), importes en céntimos (INTEGER).


CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  firebase_uid       TEXT NOT NULL UNIQUE,
  alias              TEXT NOT NULL,
  alias_norm         TEXT NOT NULL UNIQUE,
  email              TEXT,                       -- privado; nunca se expone a terceros
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  tokens_valid_after INTEGER NOT NULL DEFAULT 0,   -- epoch s; tokens emitidos antes se rechazan
  home_origin_id     TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE user_prefs (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  detail_json TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX audit_log_target ON audit_log(target_type, target_id);

-- Amistad: par canónico (user_a < user_b) para impedir duplicados.
CREATE TABLE friendships (
  user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX friendships_b ON friendships(user_b);

CREATE TABLE friend_requests (
  id           TEXT PRIMARY KEY,
  from_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (from_user <> to_user)
);
CREATE UNIQUE INDEX friend_requests_one_pending ON friend_requests(from_user, to_user) WHERE status = 'pending';
CREATE INDEX friend_requests_to ON friend_requests(to_user, status);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks(blocked_id);

CREATE TABLE trips (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL REFERENCES users(id),
  name                 TEXT NOT NULL,
  origin_id            TEXT,
  start_date           TEXT,
  end_date             TEXT,
  nights               INTEGER CHECK (nights IS NULL OR nights BETWEEN 0 AND 60),
  ski_days             INTEGER CHECK (ski_days IS NULL OR ski_days BETWEEN 0 AND 60),
  participants_planned INTEGER CHECK (participants_planned IS NULL OR participants_planned BETWEEN 1 AND 60),
  cars                 INTEGER CHECK (cars IS NULL OR cars BETWEEN 0 AND 20),
  budget_cents         INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0),
  area_id              TEXT,
  status               TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','decided','done','cancelled')),
  members_can_invite   INTEGER NOT NULL DEFAULT 0,
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE trip_members (
  trip_id   TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','editor','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX trip_members_user ON trip_members(user_id);
CREATE UNIQUE INDEX trip_one_owner ON trip_members(trip_id) WHERE role = 'owner';

CREATE TABLE trip_invitations (
  id              TEXT PRIMARY KEY,
  trip_id         TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  inviter_id      TEXT NOT NULL REFERENCES users(id),
  invitee_id      TEXT REFERENCES users(id) ON DELETE CASCADE,  -- invitación directa
  link_token_hash TEXT UNIQUE,                                   -- invitación por enlace (solo hash)
  status          TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  expires_at      INTEGER NOT NULL,
  max_uses        INTEGER NOT NULL DEFAULT 1,
  uses            INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  responded_at    INTEGER,
  CHECK ((invitee_id IS NULL) <> (link_token_hash IS NULL))
);
CREATE UNIQUE INDEX trip_invite_one_pending ON trip_invitations(trip_id, invitee_id) WHERE status = 'pending' AND invitee_id IS NOT NULL;
CREATE INDEX trip_invite_invitee ON trip_invitations(invitee_id, status);

-- Disponibilidad: ausencia de fila = «sin indicar». Nunca cuenta como libre.
CREATE TABLE availability (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  status     TEXT NOT NULL CHECK (status IN ('free','busy','maybe')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Compartición explícita de disponibilidad: con todos mis amigos o con los miembros de un viaje.
CREATE TABLE availability_shares (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('friends','trip')),
  trip_id    TEXT REFERENCES trips(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  CHECK ((scope = 'trip') = (trip_id IS NOT NULL))
);
CREATE UNIQUE INDEX availability_shares_uniq ON availability_shares(owner_id, scope, IFNULL(trip_id, ''));

CREATE TABLE date_proposals (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  CHECK (end_date >= start_date),
  UNIQUE (trip_id, start_date, end_date)
);
CREATE TABLE date_votes (
  proposal_id TEXT NOT NULL REFERENCES date_proposals(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       TEXT NOT NULL CHECK (value IN ('yes','maybe','no')),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id),
  scope      TEXT NOT NULL CHECK (scope IN ('area_public','trip_private')),
  area_id    TEXT,
  trip_id    TEXT REFERENCES trips(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  hidden     INTEGER NOT NULL DEFAULT 0,    -- moderación administrativa
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK ((scope = 'area_public' AND area_id IS NOT NULL AND trip_id IS NULL) OR
         (scope = 'trip_private' AND trip_id IS NOT NULL))
);
CREATE INDEX comments_area ON comments(area_id, created_at);
CREATE INDEX comments_trip ON comments(trip_id, created_at);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  read_at    INTEGER,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user ON notifications(user_id, read_at, created_at);
