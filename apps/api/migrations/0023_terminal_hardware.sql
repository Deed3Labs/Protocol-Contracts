-- Clear Terminal: counter hardware (terminal reference, sections 1–4 and 14). Points, cash drawers
-- and printers, in one table with a kind and per-kind settings: the settings are the contract's own
-- shape (PointSettings, DrawerSettings, PrinterSettings), validated by the app layer, and nothing
-- queries inside them except a Point's table. Enrolled tablets stay in merchant.devices and readers
-- in merchant.readers.
CREATE TABLE IF NOT EXISTS merchant.hardware (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  kind        TEXT NOT NULL CHECK (kind IN ('point','drawer','printer')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  settings    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Unpaired. History (the drawer's log) keeps pointing at it.
  removed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hardware_shop ON merchant.hardware (merchant, kind) WHERE removed_at IS NULL;

-- Every Point made, by the code on its back. A row exists before any shop claims it (Clear adds
-- them as they're made), so a typed code can only claim a real, unclaimed Point. Claiming binds it
-- to a hardware row and sets a one-time provisioning secret; the Point trades that for its own key.
-- Only hashes are stored.
CREATE TABLE IF NOT EXISTS merchant.point_keys (
  code                     TEXT PRIMARY KEY CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{4}$'),
  model                    TEXT NOT NULL DEFAULT 'point' CHECK (model IN ('point','point_large')),
  device_id                TEXT UNIQUE REFERENCES merchant.hardware (id),
  provisioning_hash        TEXT,
  provisioning_expires_at  TIMESTAMPTZ,
  key_hash                 TEXT UNIQUE,
  -- What it last said about itself (PointHealthReport), and when.
  health                   JSONB,
  last_seen_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What was last sent to a Point: idle, a bill, a paid bill or the test screen. Holds, Call and Bill,
-- and alerts are layered over it from their own tables (pointShowing in the contracts).
CREATE TABLE IF NOT EXISTS merchant.point_states (
  device_id   TEXT PRIMARY KEY REFERENCES merchant.hardware (id),
  kind        TEXT NOT NULL DEFAULT 'idle' CHECK (kind IN ('idle','bill','paid','test')),
  order_id    TEXT REFERENCES commerce.orders (id),
  since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind IN ('bill','paid')) = (order_id IS NOT NULL))
);

-- The drawer's signing key, for enrolled tablets to keep so the drawer opens offline. Envelope-
-- encrypted where the keyring is configured (as member data is); the key id changes when re-paired.
CREATE TABLE IF NOT EXISTS merchant.drawer_keys (
  drawer_id   TEXT PRIMARY KEY REFERENCES merchant.hardware (id),
  key_id      TEXT NOT NULL,
  key_sealed  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A No sale's reason and PIN, checked before the drawer opens. Used once, by the open it allowed.
CREATE TABLE IF NOT EXISTS payments.no_sale_approvals (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  requested_by  TEXT NOT NULL REFERENCES merchant.staff (id),
  approved_by   TEXT REFERENCES merchant.staff (id),
  reason        TEXT NOT NULL CHECK (reason IN ('change_for_note','wrong_change','counting','other')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

-- The drawer's log: every open, with a sale, a refund, a No sale, the key or a test; and every shut.
-- The tablet makes each event's id and time, so a sync that repeats one (it was offline, or the
-- answer was lost) is a duplicate, never a second open.
CREATE TABLE IF NOT EXISTS payments.drawer_events (
  id                TEXT PRIMARY KEY,
  merchant          TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  client_id         TEXT NOT NULL,
  drawer_id         TEXT NOT NULL REFERENCES merchant.hardware (id),
  session_id        TEXT REFERENCES payments.drawer_sessions (id),
  kind              TEXT NOT NULL CHECK (kind IN ('opened','shut')),
  reason            TEXT CHECK (reason IN ('sale','refund','no_sale','key','test')),
  order_id          TEXT REFERENCES commerce.orders (id),
  no_sale_reason    TEXT CHECK (no_sale_reason IN ('change_for_note','wrong_change','counting','other')),
  no_sale_note      TEXT,
  approval_id       TEXT REFERENCES payments.no_sale_approvals (id),
  staff_id          TEXT NOT NULL REFERENCES merchant.staff (id),
  approved_by       TEXT REFERENCES merchant.staff (id),
  -- The tablet's own clock.
  at                TIMESTAMPTZ NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The order they arrived in: a batch is in the order they happened, so this breaks a tie of times.
  seq               BIGSERIAL,
  UNIQUE (merchant, client_id),
  CHECK ((kind = 'opened') = (reason IS NOT NULL)),
  CHECK ((reason = 'no_sale') = (no_sale_reason IS NOT NULL)),
  -- One open per approval.
  UNIQUE (approval_id)
);
CREATE INDEX IF NOT EXISTS drawer_events_session ON payments.drawer_events (session_id, at);
