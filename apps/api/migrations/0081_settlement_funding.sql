-- Automatic Settlement Funding (decision 54; jobs/fundingDesk.ts).
--
-- One row per move of money toward or back from the Credit Settlement Account (CSA):
--   book           Collection Account -> CSA, a Lithic book transfer;
--   deploy         a Yield Pool Deployment through the settlement lane (deploySettlement), then the
--                  SettlementForwarder's forward to the off-ramp, which pays the CSA;
--   return-margin  CSA -> the Savings-Backed Margin, a book transfer (surplus, first);
--   return-pool    CSA -> the on-ramp by ACH, then the USDC it delivers to the desk wallet is
--                  approved and Returned to the pool with returnFunds (surplus, second);
--   margin-advance the Margin covered a settlement at the bank; recorded by a person, nothing is sent.
--
-- A row is recorded before its first transaction or bank call and carries every hash and bank token,
-- so a restart finishes it rather than starting another. At most one row per pool is acting (sending
-- or about to send) at a time; rows waiting on the world (a book transfer or an off-ramp payout not
-- landed, an ACH not arrived) do not block. A 'failed' row stops the desk until a person clears it.
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.settlement_funding_moves (
  id            BIGSERIAL PRIMARY KEY,
  chain_id      INTEGER NOT NULL,
  pool          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('book', 'deploy', 'return-margin', 'return-pool', 'margin-advance')),
  -- the cut-off it funds, and the settlement ref (keccak256(cut-off, credit-portion total))
  cutoff_at     TIMESTAMPTZ,
  ref           TEXT,
  due           NUMERIC(78, 0) NOT NULL DEFAULT 0,
  need          NUMERIC(78, 0) NOT NULL DEFAULT 0,
  amount        NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
  -- what the lane's cap could not cover (for people, safe_batch) and what the pool could not (the Margin)
  cap_short     NUMERIC(78, 0) NOT NULL DEFAULT 0,
  pool_short    NUMERIC(78, 0) NOT NULL DEFAULT 0,
  safe_batch    JSONB,
  -- the forwarder's allowance nonce before forward, and the block before deploySettlement: how a
  -- restart tells a step landed whose hash was never recorded
  nonce_before  INTEGER,
  from_block    BIGINT,
  -- the Lithic book transfer or payment token (its idempotency key)
  bank_token    TEXT,
  deploy_tx     TEXT,
  forward_tx    TEXT,
  approve_tx    TEXT,
  return_tx     TEXT,
  forwarded_at  TIMESTAMPTZ,
  offramp_ref   TEXT,
  arrived_at    TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN (
                  'planned', 'booking', 'booked', 'deploying', 'deployed', 'forwarding', 'forwarded',
                  'sending', 'sent', 'approving', 'approved', 'returning', 'done', 'failed')),
  error         TEXT,
  recorded_by   TEXT,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  cleared_at    TIMESTAMPTZ,
  cleared_by    TEXT
);

-- One acting move per pool.
CREATE UNIQUE INDEX settlement_funding_one_acting ON ops.settlement_funding_moves (chain_id, lower(pool))
  WHERE status IN ('planned', 'booking', 'deploying', 'deployed', 'forwarding', 'sending', 'approving', 'approved', 'returning');
CREATE INDEX settlement_funding_moves_recent ON ops.settlement_funding_moves (chain_id, lower(pool), created_at DESC);

-- Every check, for the return window (how long surplus has been idle) and the Command Center.
CREATE TABLE ops.settlement_funding_checks (
  id          BIGSERIAL PRIMARY KEY,
  chain_id    INTEGER NOT NULL,
  pool        TEXT NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL,
  cutoff_at   TIMESTAMPTZ,
  need        NUMERIC(78, 0) NOT NULL DEFAULT 0,
  surplus     NUMERIC(78, 0) NOT NULL DEFAULT 0,
  csa         NUMERIC(78, 0),
  outcome     TEXT NOT NULL,
  snapshot    JSONB NOT NULL
);
CREATE INDEX settlement_funding_checks_recent ON ops.settlement_funding_checks (chain_id, lower(pool), checked_at DESC);

-- The daily reconciliation: credit authorized and settled, money funded and returned, and the CSA's
-- end-of-day balance.
CREATE TABLE ops.settlement_funding_days (
  chain_id         INTEGER NOT NULL,
  pool             TEXT NOT NULL,
  day              DATE NOT NULL,
  authorized       NUMERIC(78, 0) NOT NULL DEFAULT 0,
  settled          NUMERIC(78, 0) NOT NULL DEFAULT 0,
  funded_book      NUMERIC(78, 0) NOT NULL DEFAULT 0,
  funded_pool      NUMERIC(78, 0) NOT NULL DEFAULT 0,
  returned_margin  NUMERIC(78, 0) NOT NULL DEFAULT 0,
  returned_pool    NUMERIC(78, 0) NOT NULL DEFAULT 0,
  margin_advanced  NUMERIC(78, 0) NOT NULL DEFAULT 0,
  csa_close        NUMERIC(78, 0),
  snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, pool, day)
);
