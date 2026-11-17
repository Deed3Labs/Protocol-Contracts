-- Command Center, Money: what Clear Lending pays into the co-op's Assurance Pool (IV-03 Parts 7 and 8;
-- docs/operators/assurance-fee-payer.md). Amounts are USDC base units (6 decimals), whole numbers.

-- The pool's figures once a day (UTC): the Credit Enhancement Fee is 8% a year on the average of
-- available_coverage. A day the job missed is filled by its next run with the value it reads then, and
-- marked filled. A day with no row (before the pool was watched) counts as zero.
CREATE TABLE command.assurance_snapshots (
  chain_id           INTEGER NOT NULL,
  day                DATE NOT NULL,
  pool               TEXT NOT NULL CHECK (pool ~ '^0x[0-9a-f]{40}$'),
  available_coverage NUMERIC(78, 0) NOT NULL CHECK (available_coverage >= 0),
  backstop_balance   NUMERIC(78, 0) NOT NULL CHECK (backstop_balance >= 0),
  backstop_floor     NUMERIC(78, 0) NOT NULL CHECK (backstop_floor >= 0),
  coverage_cap       NUMERIC(78, 0) NOT NULL CHECK (coverage_cap >= 0),
  filled             BOOLEAN NOT NULL DEFAULT false,
  block_number       BIGINT,
  read_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, day)
);

-- What Clear Lending owes the pool and pays from its CL Fees wallet: each month's fee (one per month,
-- worked out by the job), and the Spread Repayments and recoveries an admin enters. Every one goes
-- due -> funding_proposed (CL Operating's transfer to the CL Fees wallet, for its signers) -> funded
-- (the wallet holds it) -> sending -> paid, oldest first. A revert stops everything at failed until a
-- person looks. A fee of zero is recorded as nothing_due.
CREATE TABLE command.assurance_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id            INTEGER NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('fee', 'spread_repayment', 'recovery')),
  month               DATE NOT NULL CHECK (extract(day FROM month) = 1),
  -- the pool's SourceTag: CREDIT_ENHANCEMENT_FEE (0) for the fee, RECOVERY (1) for the rest
  source_tag          SMALLINT NOT NULL CHECK ((kind = 'fee' AND source_tag = 0) OR (kind <> 'fee' AND source_tag = 1)),
  amount              NUMERIC(78, 0) NOT NULL CHECK (amount >= 0),
  basis               JSONB,
  note                TEXT NOT NULL DEFAULT '',
  evidence            TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'due'
                      CHECK (status IN ('nothing_due', 'due', 'funding_proposed', 'funded', 'sending', 'paid', 'failed')),
  funding             JSONB,
  funding_proposed_at TIMESTAMPTZ,
  funding_proposed_by UUID REFERENCES command.people (id),
  funded_at           TIMESTAMPTZ,
  -- each claim to send counts one; the CDP idempotency keys are per attempt
  attempt             INTEGER NOT NULL DEFAULT 0,
  send_started_at     TIMESTAMPTZ,
  send_block          BIGINT,
  payer               TEXT CHECK (payer ~ '^0x[0-9a-f]{40}$'),
  approve_tx          TEXT CHECK (approve_tx ~ '^0x[0-9a-f]{64}$'),
  deposit_tx          TEXT UNIQUE CHECK (deposit_tx ~ '^0x[0-9a-f]{64}$'),
  paid_at             TIMESTAMPTZ,
  error               TEXT,
  created_by          UUID REFERENCES command.people (id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount > 0 OR status = 'nothing_due'),
  CHECK (status <> 'paid' OR deposit_tx IS NOT NULL)
);
CREATE UNIQUE INDEX assurance_items_one_fee ON command.assurance_items (chain_id, month) WHERE kind = 'fee';
CREATE INDEX assurance_items_queue ON command.assurance_items (chain_id, month, created_at) WHERE status NOT IN ('paid', 'nothing_due');

-- The co-op treasury's interchange contribution (policy: 25%): proposed to the Clear Treasury Safe as
-- approve + deposit(INTERCHANGE), one per month. Its owners sign; nothing here sends it.
CREATE TABLE command.assurance_interchange (
  chain_id    INTEGER NOT NULL,
  month       DATE NOT NULL CHECK (extract(day FROM month) = 1),
  interchange NUMERIC(78, 0) NOT NULL CHECK (interchange > 0),
  bps         INTEGER NOT NULL CHECK (bps > 0 AND bps <= 10000),
  amount      NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
  note        TEXT NOT NULL DEFAULT '',
  safe        TEXT NOT NULL CHECK (safe ~ '^0x[0-9a-f]{40}$'),
  batch       JSONB NOT NULL,
  proposed_by UUID REFERENCES command.people (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, month)
);
