-- Command Center, Phase 3c: the rows behind Merchants (docs/command-center-plan.md).
-- The seed provider reads these; the live provider will read the merchant app's own tables
-- (merchant, payments, commerce), as decided in the plan.

-- Partner shops: signed or transacting. Terms, fee, cap and the founding seat are the agreement's;
-- position keeps the order the pages list them in.
CREATE TABLE command.merchants (
  id        TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  position  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  city      TEXT NOT NULL,
  lat       NUMERIC(8, 5),
  lng       NUMERIC(8, 5),
  status    TEXT NOT NULL CHECK (status IN ('signing', 'signed', 'transacting')),
  founding  BOOLEAN NOT NULL DEFAULT false,
  fee_pct   NUMERIC(4, 2) CHECK (fee_pct >= 0),
  terms     TEXT CHECK (terms IN ('NET-14', 'NET-30')),
  cap_cents INTEGER CHECK (cap_cents > 0),
  hardware  TEXT,
  CONSTRAINT merchants_transacting CHECK (status <> 'transacting' OR (fee_pct IS NOT NULL AND terms IS NOT NULL AND cap_cents IS NOT NULL))
);

-- A transacting shop's numbers: cap hits this week, originations and losses on its own book.
-- Refreshed by the payments job (Phase 6); the seed writes the prototype's.
CREATE TABLE command.merchant_stats (
  merchant_id  TEXT PRIMARY KEY REFERENCES command.merchants (id),
  cap_hits_7d  INTEGER NOT NULL DEFAULT 0,
  originations INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0
);

-- Sales cleared through Clear, by shop and month.
CREATE TABLE command.merchant_months (
  merchant_id   TEXT NOT NULL REFERENCES command.merchants (id),
  month         DATE NOT NULL CHECK (extract(day FROM month) = 1),
  cleared_cents BIGINT NOT NULL DEFAULT 0,
  sales         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (merchant_id, month)
);

-- $10 redemptions owed to a shop, paid with its next payout run.
CREATE TABLE command.redemptions_owed (
  merchant_id TEXT PRIMARY KEY REFERENCES command.merchants (id),
  owed_cents  INTEGER NOT NULL CHECK (owed_cents >= 0)
);

-- The pipeline board: one card per shop, from first walk-in to signed. A card for a signed shop
-- points at its merchant row. Contacts are a shop's people: their details stay off Totals.
CREATE TABLE command.merchant_stage (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT REFERENCES command.merchants (id),
  position        INTEGER NOT NULL,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  city            TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('prospect', 'talking', 'signing', 'signed')),
  owner           TEXT,
  per_month_cents INTEGER,
  next_step       TEXT,
  due_on          DATE,
  last_contact_at TIMESTAMPTZ,
  contact         JSONB NOT NULL DEFAULT '{"name":"","role":"","phone":"","email":""}',
  source          TEXT NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  flag            BOOLEAN NOT NULL DEFAULT false,
  founding        BOOLEAN NOT NULL DEFAULT false,
  posters         INTEGER,
  notes           TEXT NOT NULL DEFAULT '',
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What happened to a card: a note, call, visit, demo, stage change or edit, by whom and when.
CREATE TABLE command.merchant_activity (
  id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES command.merchant_stage (id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind     TEXT NOT NULL CHECK (kind IN ('note', 'call', 'visit', 'demo', 'stage', 'edit')),
  text     TEXT NOT NULL,
  who      TEXT NOT NULL
);

-- The hardware fleet: each device a shop has, by type, and its status from check-ins; and each
-- shop's latest check-in and what needs a visit.
CREATE TABLE command.device_fleet (
  merchant_id TEXT NOT NULL REFERENCES command.merchants (id),
  kind        TEXT NOT NULL CHECK (kind IN ('P', 't', 'T', 'C')),
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('on', 'low', 'off')),
  PRIMARY KEY (merchant_id, kind, seq)
);

CREATE TABLE command.fleet_checkins (
  merchant_id TEXT PRIMARY KEY REFERENCES command.merchants (id),
  position    INTEGER NOT NULL,
  issue       TEXT NOT NULL DEFAULT '',
  last_seen   TEXT NOT NULL
);
