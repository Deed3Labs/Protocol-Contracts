-- Command Center, Phase 5a: the indexer (docs/command-center-plan.md).

-- The deployed contracts, from deployments/base-sepolia, with each one's deploy block, found once
-- (the deployment files record 0).
CREATE TABLE command.chain_contracts (
  chain_id     INTEGER NOT NULL,
  address      TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  name         TEXT NOT NULL,
  deploy_block BIGINT,
  found_at     TIMESTAMPTZ,
  PRIMARY KEY (chain_id, address)
);

-- Every event from every deployed contract, raw and decoded. A log is the same log however many
-- times it's read: unique on (chain, tx, log index). Only blocks 5 behind the head are indexed.
CREATE TABLE command.chain_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id     INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash   TEXT NOT NULL,
  block_time   TIMESTAMPTZ NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  address      TEXT NOT NULL,
  contract     TEXT NOT NULL,
  -- the decoded event, when the contract's ABI knows it; the raw log either way
  event        TEXT,
  args         JSONB,
  topics       TEXT[] NOT NULL,
  data         TEXT NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX chain_events_contract ON command.chain_events (chain_id, contract, event, block_number);
CREATE INDEX chain_events_block ON command.chain_events (chain_id, block_number);

-- How far each chain is indexed, and when it last ran.
CREATE TABLE command.chain_cursor (
  chain_id   INTEGER PRIMARY KEY,
  indexed_to BIGINT NOT NULL,
  head       BIGINT,
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  error      TEXT
);
