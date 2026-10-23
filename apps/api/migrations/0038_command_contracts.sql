-- Command Center, Phase 3e: the rows behind Contracts (docs/command-center-plan.md).
-- Live sources: the contract inventory from deployments/base-sepolia and the chain, releases and
-- changes from the indexer and GitHub (Phase 5), signatures from the Safe (Phase 4). Agreements are
-- Command's own records. The seed writes the prototype's.

-- Every agreement on file: the company's, providers', members' and each merchant partner's.
-- events: an agreement out for signature, as signature-lane events ([kind, at, …]; a null at is now).
CREATE TABLE command.agreements (
  id        TEXT PRIMARY KEY,
  position  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  party     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('company', 'provider', 'member', 'merchant')),
  status    TEXT NOT NULL CHECK (status IN ('signed', 'renew', 'out', 'sent', 'draft')),
  signed_at TIMESTAMPTZ,
  ends_at   TIMESTAMPTZ,
  sent_at   TIMESTAMPTZ,
  version   TEXT,
  note      TEXT NOT NULL DEFAULT '',
  rolls     BOOLEAN NOT NULL DEFAULT false,
  events    JSONB
);

-- The protocol's contracts: version, layer, status, address, what each does, its map position and
-- band (c credit · d deeds), and the status line the map shows, if any.
CREATE TABLE command.contracts (
  id       TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  name     TEXT NOT NULL UNIQUE,
  version  TEXT NOT NULL,
  layer    INTEGER NOT NULL CHECK (layer BETWEEN 0 AND 4),
  status   TEXT NOT NULL CHECK (status IN ('live', 'later', 'build', 'paused')),
  address  TEXT NOT NULL,
  purpose  TEXT NOT NULL,
  map_x    NUMERIC(5, 1) NOT NULL,
  map_y    NUMERIC(5, 1) NOT NULL,
  band     TEXT NOT NULL CHECK (band IN ('c', 'd')),
  note     TEXT
);

-- How they connect: reads from, moves money, mints. label null: listed in the panel, not drawn.
CREATE TABLE command.contract_links (
  position   INTEGER PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES command.contracts (id),
  to_id      TEXT NOT NULL REFERENCES command.contracts (id),
  kind       TEXT NOT NULL CHECK (kind IN ('reads', 'money', 'mint')),
  verb       TEXT NOT NULL,
  label      TEXT,
  label_side NUMERIC(5, 1)
);

-- Each contract's versions as they went live, and the next one while it waits for signatures.
CREATE TABLE command.contract_releases (
  contract_id TEXT NOT NULL REFERENCES command.contracts (id),
  version     TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL,
  pending     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (contract_id, version)
);

-- Changes drafted here and signed in the Safe: in flight or done. The detail (stage, state, who's
-- next) and the signature-lane events are the change's own.
CREATE TABLE command.contract_changes (
  id          TEXT PRIMARY KEY,
  position    INTEGER NOT NULL,
  done        BOOLEAN NOT NULL,
  title       TEXT NOT NULL,
  contract    TEXT NOT NULL,
  proposed_by TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  events      JSONB NOT NULL
);

-- The Safe's signers: their median time to sign, and what's next for them when nothing waits.
CREATE TABLE command.signers (
  key          TEXT PRIMARY KEY,
  position     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  who          TEXT NOT NULL,
  median_hours NUMERIC(6, 1) NOT NULL,
  idle_note    TEXT NOT NULL DEFAULT ''
);
