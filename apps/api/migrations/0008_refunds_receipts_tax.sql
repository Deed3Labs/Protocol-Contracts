-- Refunds, receipts and recording tax at Stripe (card-processing prompt, Phase 6).

-- A receipt sent or opened: an unguessable token the link carries. The receipt itself is built
-- from the order each time it's read, so a later refund shows on it.
CREATE TABLE payments.receipts (
  token        TEXT PRIMARY KEY,
  merchant     TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  order_id     TEXT NOT NULL REFERENCES commerce.orders (id),
  channel      TEXT NOT NULL CHECK (channel IN ('text','email','link')),
  -- Where it went, as typed at the counter. Kept so "resend" needs no retyping; never shown back
  -- to anyone but the shop.
  sent_to      TEXT,
  sent_by      TEXT REFERENCES merchant.staff (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered    BOOLEAN NOT NULL DEFAULT false,
  error        TEXT
);
CREATE INDEX receipts_order ON payments.receipts (order_id);

-- The outbox retries with backoff, like the Stripe inbox.
ALTER TABLE payments.outbox ADD COLUMN next_attempt_at TIMESTAMPTZ;
DROP INDEX payments.outbox_pending;
CREATE INDEX outbox_pending ON payments.outbox (next_attempt_at, id) WHERE published_at IS NULL;

-- The Stripe Tax transaction a paid order was recorded as, and a refund's reversal of it.
ALTER TABLE commerce.orders ADD COLUMN tax_transaction_id TEXT;
ALTER TABLE payments.refunds ADD COLUMN tax_transaction_id TEXT;
