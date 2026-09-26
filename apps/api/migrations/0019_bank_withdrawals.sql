-- Withdrawals to a bank: the shop's USDC (its cash account) sent to Bridge, which pays the linked
-- bank by ACH, standard (free) or same-day (1%). One row per transfer, following Bridge's state.
CREATE TABLE IF NOT EXISTS merchant.bank_withdrawals (
  id                  TEXT PRIMARY KEY,
  merchant            TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  bank_account_id     TEXT NOT NULL REFERENCES merchant.bank_accounts (id),
  amount_cents        BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents           BIGINT NOT NULL DEFAULT 0,
  speed               TEXT NOT NULL CHECK (speed IN ('standard', 'same_day')),
  bridge_transfer_id  TEXT,
  state               TEXT NOT NULL DEFAULT 'created',
  tx_hash             TEXT,
  note                TEXT,
  requested_by        TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_withdrawals_merchant ON merchant.bank_withdrawals (merchant, created_at DESC);
