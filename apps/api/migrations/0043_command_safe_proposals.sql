-- Command Center, Phase 4b: proposing to the Ops Safe (docs/command-center-plan.md).

-- A shop's wallet on chain: what MerchantRegistry knows it by. The merchant app's own row
-- (merchant.profiles) is keyed by the same address; until the live provider reads it, it's set here.
ALTER TABLE command.merchants ADD COLUMN wallet_address TEXT CHECK (wallet_address ~ '^0x[0-9a-f]{40}$');

-- Safe transactions Command built for an outbox row: prepared (built, waiting for the first
-- signature), proposed (in the Safe's queue), or superseded (rebuilt at a later nonce). The Safe and
-- its Transaction Service hold the signatures; this holds what was built and by whom.
CREATE TABLE command.safe_proposals (
  safe_tx_hash TEXT PRIMARY KEY CHECK (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  outbox_id    UUID REFERENCES command.outbox (id),
  safe_address TEXT NOT NULL,
  chain_id     INTEGER NOT NULL,
  nonce        INTEGER NOT NULL,
  tx           JSONB NOT NULL,
  summary      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'proposed', 'superseded')),
  prepared_by  UUID NOT NULL REFERENCES command.people (id),
  proposed_by  UUID REFERENCES command.people (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  proposed_at  TIMESTAMPTZ
);
CREATE INDEX safe_proposals_outbox ON command.safe_proposals (outbox_id);
