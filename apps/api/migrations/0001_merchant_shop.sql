-- The shop, its settings, and how it takes cards (card-processing prompt, Phase 2: `merchant`).
--
-- The shop row is the existing merchant.profiles, keyed by the organization wallet's address
-- (HARD STOP 1, decision 2). Staff, devices and sessions already exist and stay as they are; the
-- discount limit per role lives in shop_settings, beside the rest of the role settings.
--
-- The lazy store in src/config/merchantDb.ts creates profiles; this file only adds to it, so it
-- runs after ensureMerchantSchema().

ALTER TABLE merchant.profiles
  ADD COLUMN IF NOT EXISTS address_line1       TEXT,
  ADD COLUMN IF NOT EXISTS address_line2       TEXT,
  ADD COLUMN IF NOT EXISTS address_city        TEXT,
  ADD COLUMN IF NOT EXISTS address_region      TEXT,
  ADD COLUMN IF NOT EXISTS address_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS address_country     TEXT NOT NULL DEFAULT 'US',
  -- The shop's day turns over at midnight here, so a 11pm sale lands on the right business date.
  ADD COLUMN IF NOT EXISTS timezone            TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  ADD COLUMN IF NOT EXISTS currency            TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  -- Clear's fee per card sale: 'payg' is the free plan (30¢); 'paid' carries its own fee, which is
  -- a plan setting rather than a constant because the paid price isn't decided (20–25¢).
  ADD COLUMN IF NOT EXISTS card_plan           TEXT NOT NULL DEFAULT 'payg' CHECK (card_plan IN ('payg','paid')),
  ADD COLUMN IF NOT EXISTS card_plan_fee_cents INTEGER CHECK (card_plan_fee_cents >= 0),
  -- Which Clear credit pricing the shop is on. The rate itself is on chain (MerchantRegistry), and
  -- that is the authority; merchant.clear_tiers is a display copy.
  ADD COLUMN IF NOT EXISTS clear_tier          TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE merchant.profiles DROP CONSTRAINT IF EXISTS profiles_card_plan_fee_check;
ALTER TABLE merchant.profiles ADD CONSTRAINT profiles_card_plan_fee_check
  CHECK ((card_plan = 'payg' AND card_plan_fee_cents IS NULL) OR (card_plan = 'paid' AND card_plan_fee_cents IS NOT NULL));

-- Founding shops were already flagged; keep the two in step for existing rows.
UPDATE merchant.profiles SET clear_tier = 'founding' WHERE founding AND clear_tier = 'standard';

-- The Clear credit fee, by how the member pays. A display mirror of the chain (HARD STOP 1,
-- decision 3): the fee on a given charge is only known once the member approves, and the chain
-- decides it.
CREATE TABLE merchant.clear_tiers (
  tier          TEXT PRIMARY KEY,
  paid_now_bps  INTEGER NOT NULL CHECK (paid_now_bps BETWEEN 0 AND 10000),
  over_time_bps INTEGER NOT NULL CHECK (over_time_bps BETWEEN 0 AND 10000)
);
INSERT INTO merchant.clear_tiers (tier, paid_now_bps, over_time_bps) VALUES
  ('founding', 125, 200),
  ('standard', 150, 250);
ALTER TABLE merchant.profiles ADD CONSTRAINT profiles_clear_tier_fkey
  FOREIGN KEY (clear_tier) REFERENCES merchant.clear_tiers (tier);

-- One row per shop. Columns rather than a JSON blob: the server enforces these (principle 7), and a
-- CHECK is the cheapest place to keep a nonsense setting out.
CREATE TABLE merchant.shop_settings (
  merchant                  TEXT PRIMARY KEY REFERENCES merchant.profiles (merchant),
  accept_card               BOOLEAN NOT NULL DEFAULT true,
  accept_cash               BOOLEAN NOT NULL DEFAULT true,
  accept_split              BOOLEAN NOT NULL DEFAULT true,
  tips_enabled              BOOLEAN NOT NULL DEFAULT true,
  tips_mode                 TEXT NOT NULL DEFAULT 'amounts' CHECK (tips_mode IN ('amounts','percentages')),
  -- Up to four presets: cents when 'amounts', whole percents when 'percentages'.
  tips_presets              INTEGER[] NOT NULL DEFAULT '{500,1000,2000}'
                              CHECK (cardinality(tips_presets) <= 4 AND 0 < ALL (tips_presets)),
  -- Who a tip goes to: whoever raised the sale, or split by hours worked.
  tips_go_to                TEXT NOT NULL DEFAULT 'raiser' CHECK (tips_go_to IN ('raiser','hours')),
  starting_cash_cents       BIGINT NOT NULL DEFAULT 15000 CHECK (starting_cash_cents >= 0),
  two_counts                BOOLEAN NOT NULL DEFAULT true,
  one_person_close          TEXT NOT NULL DEFAULT 'owner_next_morning'
                              CHECK (one_person_close IN ('owner_next_morning','wait_for_second')),
  offline_cards_enabled     BOOLEAN NOT NULL DEFAULT false,
  offline_cards_limit_cents BIGINT NOT NULL DEFAULT 50000 CHECK (offline_cards_limit_cents >= 0),
  -- The most each role can take off an order without someone else's PIN, in percent. NULL: no limit.
  discount_limit_counter    INTEGER NOT NULL DEFAULT 10 CHECK (discount_limit_counter BETWEEN 0 AND 100),
  discount_limit_manager    INTEGER NOT NULL DEFAULT 25 CHECK (discount_limit_manager BETWEEN 0 AND 100),
  discount_limit_owner      INTEGER CHECK (discount_limit_owner BETWEEN 0 AND 100),
  updated_by                TEXT REFERENCES merchant.staff (id),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The shop's card processor. History is kept: a disconnected account stays, with disconnected_at,
-- and a reconnect is a new row. At most one live connector per shop.
CREATE TABLE merchant.card_connectors (
  id                   TEXT PRIMARY KEY,
  merchant             TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  provider             TEXT NOT NULL CHECK (provider IN ('stripe')),
  external_account_id  TEXT NOT NULL,
  charges_enabled      BOOLEAN NOT NULL DEFAULT false,
  details_submitted    BOOLEAN NOT NULL DEFAULT false,
  -- One Terminal Location per shop, created on the connected account.
  terminal_location_id TEXT,
  connected_by         TEXT REFERENCES merchant.staff (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX card_connectors_one_live ON merchant.card_connectors (merchant) WHERE disconnected_at IS NULL;
CREATE UNIQUE INDEX card_connectors_account ON merchant.card_connectors (provider, external_account_id) WHERE disconnected_at IS NULL;

CREATE TABLE merchant.readers (
  id                 TEXT PRIMARY KEY,
  merchant           TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  connector_id       TEXT REFERENCES merchant.card_connectors (id),
  provider           TEXT NOT NULL CHECK (provider IN ('stripe')),
  type               TEXT NOT NULL CHECK (type IN ('m2','smart','tap_to_pay')),
  -- The processor's id: a smart reader's registered id, or an M2's serial number. A Tap to Pay
  -- "reader" is the phone, identified by the device it runs on.
  external_reader_id TEXT NOT NULL,
  device_id          TEXT REFERENCES merchant.devices (id),
  label              TEXT NOT NULL,
  location_id        TEXT,
  last_seen_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX readers_external ON merchant.readers (merchant, provider, external_reader_id) WHERE removed_at IS NULL;
