-- Reconciliation flags an owner or manager has looked into and explained ("Mike captured it in
-- Stripe", "a chargeback, see the dispute"). An explained flag is closed, and the nightly run
-- doesn't open it again while the figures it was explained at still hold.
ALTER TABLE payments.reconciliation_flags
  ADD COLUMN IF NOT EXISTS explained_by TEXT,
  ADD COLUMN IF NOT EXISTS explanation  TEXT,
  ADD COLUMN IF NOT EXISTS explained_at TIMESTAMPTZ;
