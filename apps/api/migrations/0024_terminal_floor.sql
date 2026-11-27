-- Clear Terminal: tables, the wait list, Call and Bill, alerts (terminal reference, sections 8, 8b,
-- 9 and 13b). Tables are only shown to shops with table service on.
CREATE TABLE IF NOT EXISTS merchant.tables (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  number          INTEGER NOT NULL CHECK (number BETWEEN 1 AND 999),
  label           TEXT,
  area            TEXT,
  seats           INTEGER NOT NULL DEFAULT 2 CHECK (seats BETWEEN 1 AND 40),
  -- Seated (by staff, or once its party's hold ends) and its tab, until it is cleared.
  seated_at       TIMESTAMPTZ,
  tab_order_id    TEXT REFERENCES commerce.orders (id),
  -- Held for a party just seated from the wait list (seating addendum).
  hold_party_id   TEXT,
  hold_show_name  BOOLEAN,
  hold_seated_at  TIMESTAMPTZ,
  hold_expires_at TIMESTAMPTZ,
  removed_at      TIMESTAMPTZ,
  CHECK ((hold_party_id IS NULL) = (hold_expires_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tables_number ON merchant.tables (merchant, number) WHERE removed_at IS NULL;

-- An order can be a table's tab, and says how it leaves, and Order ready's two times. An order rung
-- up offline keeps the tablet's figures and says so; its key makes the queue's retries one order.
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS table_id TEXT REFERENCES merchant.tables (id);
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS service_type TEXT CHECK (service_type IN ('dine_in','to_go','delivery'));
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS delivery_partner TEXT;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS offline BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE commerce.orders ADD COLUMN IF NOT EXISTS bill_sent_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS orders_key ON commerce.orders (merchant, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_table ON commerce.orders (table_id) WHERE table_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS merchant.waitlist_parties (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  size            INTEGER NOT NULL CHECK (size BETWEEN 1 AND 20),
  phone           TEXT,
  text_consent    BOOLEAN NOT NULL DEFAULT false,
  -- A member who joined signed in, from the Clear app: "Your table is ready" is also a notification.
  member_wallet   TEXT,
  -- Order on the list; the earliest joined first unless staff move someone.
  rank            DOUBLE PRECISION NOT NULL,
  quoted_minutes  INTEGER NOT NULL CHECK (quoted_minutes >= 0),
  state           TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','ready','seated','left')),
  table_id        TEXT REFERENCES merchant.tables (id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at        TIMESTAMPTZ,
  seated_at       TIMESTAMPTZ,
  left_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS waitlist_live ON merchant.waitlist_parties (merchant, state, rank);
ALTER TABLE merchant.tables ADD CONSTRAINT tables_hold_party FOREIGN KEY (hold_party_id) REFERENCES merchant.waitlist_parties (id);

-- Call and Bill from a table's Pay case. One open of each kind per table: a second press is the same
-- request.
CREATE TABLE IF NOT EXISTS merchant.table_requests (
  id           TEXT PRIMARY KEY,
  merchant     TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  table_id     TEXT NOT NULL REFERENCES merchant.tables (id),
  point_id     TEXT NOT NULL REFERENCES merchant.hardware (id),
  kind         TEXT NOT NULL CHECK (kind IN ('call','bill')),
  at           TIMESTAMPTZ NOT NULL,
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','bill_sent')),
  answered_by  TEXT REFERENCES merchant.staff (id),
  answered_at  TIMESTAMPTZ,
  bill_cents   BIGINT CHECK (bill_cents >= 0),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS table_requests_one_open ON merchant.table_requests (table_id, kind) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS table_requests_recent ON merchant.table_requests (merchant, at DESC);

-- Table ready and Order ready: on a Point, and texted when there's a number with consent.
CREATE TABLE IF NOT EXISTS merchant.alerts (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  kind        TEXT NOT NULL CHECK (kind IN ('table_ready','order_ready')),
  point_id    TEXT REFERENCES merchant.hardware (id),
  party_id    TEXT REFERENCES merchant.waitlist_parties (id),
  order_id    TEXT REFERENCES commerce.orders (id),
  label       TEXT NOT NULL,
  texted_to   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  cleared_at  TIMESTAMPTZ,
  CHECK ((kind = 'table_ready') = (party_id IS NOT NULL)),
  CHECK ((kind = 'order_ready') = (order_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS alerts_point ON merchant.alerts (point_id, expires_at) WHERE cleared_at IS NULL;
