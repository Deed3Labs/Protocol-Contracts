-- Command Center, Phase 3d: the rows behind Money (docs/command-center-plan.md).
-- Live sources: balances from Bridge, Plaid and the chain (Phases 5–6); the yield pool from
-- LendingPool's events (Phase 5). The seed writes the prototype's.

-- Every account the co-op holds, and whose money it is.
CREATE TABLE command.accounts (
  id          TEXT PRIMARY KEY,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  owner_group TEXT NOT NULL CHECK (owner_group IN ('members', 'set', 'coop')),
  source      TEXT NOT NULL CHECK (source IN ('bridge', 'protocol', 'plaid', 'lithic', 'stripe')),
  swatch      TEXT NOT NULL
);

-- Balances by account and time: one a week since launch, the last the latest.
CREATE TABLE command.account_snapshots (
  account_id    TEXT NOT NULL REFERENCES command.accounts (id),
  as_of         DATE NOT NULL,
  balance_cents BIGINT NOT NULL,
  PRIMARY KEY (account_id, as_of)
);

-- What moved in or out of an account. Money out is negative.
CREATE TABLE command.account_entries (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES command.accounts (id),
  at           DATE NOT NULL,
  what         TEXT NOT NULL,
  detail       TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
);
CREATE INDEX account_entries_account ON command.account_entries (account_id, at DESC);

-- Bonds the co-op owes: face, when issued and when it matures, the term and the internal rate.
CREATE TABLE command.bonds (
  id          TEXT PRIMARY KEY CHECK (id ~ '^BB-[0-9]{4}$'),
  face_cents  BIGINT NOT NULL CHECK (face_cents > 0),
  issued_on   DATE NOT NULL,
  matures_on  DATE NOT NULL,
  term_months INTEGER NOT NULL,
  rate_pct    NUMERIC(5, 2) NOT NULL,
  holder      TEXT NOT NULL,
  CONSTRAINT bonds_dates CHECK (matures_on > issued_on)
);

-- The yield pool's depositors (LendingPool, ERC-4626), derived from its Transfer, Deposit and
-- Withdraw events, never typed in. The depositor is the last two hex characters of their address:
-- the page shows them masked (M•••4f) to everyone.
CREATE TABLE command.yield_positions (
  depositor     TEXT PRIMARY KEY CHECK (depositor ~ '^[0-9a-f]{2}$'),
  assets_cents  BIGINT NOT NULL CHECK (assets_cents >= 0),
  first_deposit DATE NOT NULL,
  pledged_cents BIGINT NOT NULL DEFAULT 0 CHECK (pledged_cents >= 0),
  -- the order the deposits came in, which breaks ties in the depositor table
  position      INTEGER NOT NULL
);
