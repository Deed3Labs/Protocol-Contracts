-- Settings › Payouts › Statements: each month's statement emailed on the 2nd, to this address; and
-- which months have gone, so a statement is sent once however often the job runs.
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS statements_email TEXT;
CREATE TABLE IF NOT EXISTS merchant.statement_sends (
  merchant  TEXT NOT NULL,
  period    TEXT NOT NULL,
  sent_to   TEXT NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant, period)
);
