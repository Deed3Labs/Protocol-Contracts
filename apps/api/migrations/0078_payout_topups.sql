-- Bounded automatic PayoutPool top-ups (decision 51; jobs/payoutTopUp.ts).
--
-- One row per top-up: what triggered it, what the pool was short at each horizon, how much it moved and what
-- was left for people, and each of its three transactions. A row is in flight from 'planned' until 'funded' or
-- 'failed'; at most one per pool is, so one trigger is never funded twice. After a restart the job finishes an
-- in-flight row from the chain (receipts, the allowance's nonce, the wallet's balance), never by starting another.
-- A 'failed' row stops the job until a person clears it (cleared_at).
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.payout_topups (
  id            BIGSERIAL PRIMARY KEY,
  chain_id      INTEGER NOT NULL,
  payout_pool   TEXT NOT NULL,
  -- overdue / low-water: the low horizon was short; wallet-balance: USDC already in the wallet (a remainder people sent)
  trigger       TEXT NOT NULL CHECK (trigger IN ('overdue', 'low-water', 'wallet-balance')),
  low_short     NUMERIC(78, 0) NOT NULL DEFAULT 0,
  target_short  NUMERIC(78, 0) NOT NULL DEFAULT 0,
  need          NUMERIC(78, 0) NOT NULL DEFAULT 0,
  amount        NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
  -- what the cap could not cover, for CL Operating's owners (safe_batch is the Transaction Builder file)
  remainder     NUMERIC(78, 0) NOT NULL DEFAULT 0,
  safe_batch    JSONB,
  -- the allowance's nonce before the pull: once the chain's is past it, the pull happened
  nonce_before  INTEGER,
  pull_tx       TEXT,
  approve_tx    TEXT,
  fund_tx       TEXT,
  status        TEXT NOT NULL CHECK (status IN ('planned', 'pulling', 'pulled', 'approving', 'approved', 'funding', 'funded', 'failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  cleared_at    TIMESTAMPTZ,
  cleared_by    TEXT
);

-- One top-up in flight per pool.
CREATE UNIQUE INDEX payout_topups_one_in_flight ON ops.payout_topups (chain_id, lower(payout_pool))
  WHERE status NOT IN ('funded', 'failed');
CREATE INDEX payout_topups_recent ON ops.payout_topups (chain_id, lower(payout_pool), created_at DESC);

-- The latest check per pool, for the Command Center: the projections, the allowance and what was decided.
CREATE TABLE ops.payout_topup_checks (
  chain_id     INTEGER NOT NULL,
  payout_pool  TEXT NOT NULL,
  checked_at   TIMESTAMPTZ NOT NULL,
  snapshot     JSONB NOT NULL,
  PRIMARY KEY (chain_id, payout_pool)
);
