-- Command Center, Phase 6a: the sandbox feeds (docs/command-center-plan.md).

-- One row per provider: when it last synced, how fresh the provider's own data is, its health, and
-- what it read. A sync asked for (Sync now, Plaid's webhook, a Stripe payout landing) is
-- requested_at, run by the next tick.
CREATE TABLE command.feeds (
  id           TEXT PRIMARY KEY CHECK (id IN ('plaid', 'bridge', 'lithic', 'stripe')),
  state        TEXT NOT NULL DEFAULT 'never' CHECK (state IN ('never', 'ok', 'error', 'off')),
  -- why it's off: not configured, or configured for something other than a sandbox
  off_reason   TEXT,
  synced_at    TIMESTAMPTZ,
  tried_at     TIMESTAMPTZ,
  -- the provider's own freshness (Plaid's last update from the bank); the sync time otherwise
  as_of        TIMESTAMPTZ,
  error        TEXT,
  figures      JSONB,
  requested_at TIMESTAMPTZ,
  requested_by TEXT
);
INSERT INTO command.feeds (id) VALUES ('plaid'), ('bridge'), ('lithic'), ('stripe');

-- The co-op's own bank link at Plaid, made by Command in the sandbox. The access token is
-- envelope-encrypted; the cursor is where /transactions/sync left off.
CREATE TABLE command.plaid_items (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL UNIQUE,
  access_token JSONB NOT NULL,
  institution  TEXT,
  sync_cursor  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- That link's transactions, as Plaid last said: added and modified kept, removed deleted.
CREATE TABLE command.bank_transactions (
  id         TEXT PRIMARY KEY,
  item       TEXT NOT NULL REFERENCES command.plaid_items (id),
  account_id TEXT NOT NULL,
  posted_on  DATE NOT NULL,
  name       TEXT NOT NULL,
  -- Plaid's sign: positive is money out
  amount     NUMERIC(14, 2) NOT NULL,
  pending    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX bank_transactions_posted ON command.bank_transactions (item, posted_on DESC);
