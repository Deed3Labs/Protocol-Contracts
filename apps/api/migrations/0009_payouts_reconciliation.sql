-- Card payouts and reconciliation (card-processing prompt, Phase 8).

-- A shop's card deposit: a payout from its processor, with what it settled. The figures are the
-- processor's own (its fee and Clear's application fee, from the balance transactions), never
-- recomputed from our fee rule.
CREATE TABLE payments.card_payouts (
  id                TEXT PRIMARY KEY,                       -- the processor's payout id
  merchant          TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  connector_id      TEXT NOT NULL REFERENCES merchant.card_connectors (id),
  status            TEXT NOT NULL CHECK (status IN ('pending','in_transit','paid','failed','canceled')),
  arrival_date      DATE NOT NULL,
  automatic         BOOLEAN NOT NULL,
  amount_cents      BIGINT NOT NULL,                        -- what reached (or will reach) the bank
  gross_cents       BIGINT NOT NULL DEFAULT 0,              -- charges less refunds
  processor_fee_cents BIGINT NOT NULL DEFAULT 0,
  clear_fee_cents   BIGINT NOT NULL DEFAULT 0,
  other_cents       BIGINT NOT NULL DEFAULT 0,              -- disputes and adjustments
  charge_count      INTEGER NOT NULL DEFAULT 0,
  -- False when the items don't add up to the payout (a manual or instant payout Stripe can't break
  -- down, or a mismatch): shown, never booked, and flagged.
  breakdown_ok      BOOLEAN NOT NULL DEFAULT false,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_payouts_merchant ON payments.card_payouts (merchant, arrival_date DESC);

-- Where our books and the processor's disagree. Found by the nightly reconciliation; one open flag
-- per thing, resolved when a later run no longer finds it.
CREATE TABLE payments.reconciliation_flags (
  id             TEXT PRIMARY KEY,
  merchant       TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  kind           TEXT NOT NULL,
  ref            TEXT NOT NULL,
  expected_cents BIGINT,
  actual_cents   BIGINT,
  detail         TEXT NOT NULL,
  found_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX reconciliation_flags_open ON payments.reconciliation_flags (merchant, kind, ref) WHERE resolved_at IS NULL;
