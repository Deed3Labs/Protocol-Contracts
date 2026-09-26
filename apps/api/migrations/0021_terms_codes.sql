-- Onboarding › Your terms › Have a code?: codes Clear gives out that put a shop on a tier (founding
-- partners today), each with a number of places. A shop that signs up with one takes a place, and
-- the shop's row says which code it used. Clear adds codes (scripts/terms-code.ts); nothing in the
-- app does.
CREATE TABLE IF NOT EXISTS merchant.terms_codes (
  code        TEXT PRIMARY KEY CHECK (code = upper(code) AND code ~ '^[A-Z0-9-]{3,32}$'),
  tier        TEXT NOT NULL REFERENCES merchant.clear_tiers (tier),
  places      INTEGER NOT NULL CHECK (places >= 0),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at  TIMESTAMPTZ
);
ALTER TABLE merchant.profiles ADD COLUMN IF NOT EXISTS terms_code TEXT REFERENCES merchant.terms_codes (code);
CREATE INDEX IF NOT EXISTS profiles_by_terms_code ON merchant.profiles (terms_code) WHERE terms_code IS NOT NULL;
