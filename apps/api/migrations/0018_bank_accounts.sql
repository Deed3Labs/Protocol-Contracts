-- A shop's bank accounts, for withdrawing to: linked with Plaid (the owner signs in to the bank),
-- registered with the rail that pays out to them (Bridge). Only what the screens show is kept: the
-- bank's name, the last four digits and the kind. The full numbers go from Plaid to Bridge and stay
-- there; the Plaid link is closed once they have.
CREATE TABLE IF NOT EXISTS merchant.bank_accounts (
  id                   TEXT PRIMARY KEY,
  merchant             TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  rail                 TEXT NOT NULL DEFAULT 'bridge',
  external_account_id  TEXT NOT NULL,
  bank_name            TEXT NOT NULL,
  mask                 TEXT NOT NULL,
  subtype              TEXT NOT NULL,
  added_by             TEXT NOT NULL,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bank_accounts_merchant ON merchant.bank_accounts (merchant) WHERE removed_at IS NULL;
