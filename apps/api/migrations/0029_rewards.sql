-- Rewards (docs/rewards-reference): a shop's app, its earning rules and rewards, the points ledger,
-- counter codes, own domains and store build records; and what orders and discount codes gain.
--
-- A person here is anyone with rewards at a shop: a Clear member, or someone who joined with only a
-- phone number. They are kept apart from the Clear app's member records (which live in the main
-- database) so joining a shop never touches Clear onboarding. `member_subject` links the two once the
-- person is a Clear member.

CREATE SCHEMA rewards;

CREATE TABLE rewards.people (
  id             TEXT PRIMARY KEY,
  privy_did      TEXT NOT NULL UNIQUE,
  -- Their smart wallet, lowercased: what their code and their Clear charges carry.
  wallet         TEXT,
  first_name     TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 40),
  last_initial   TEXT CHECK (last_initial IS NULL OR length(last_initial) = 1),
  -- sha256 of the E.164 number they signed in with, for a number typed at the counter.
  phone_hash     TEXT,
  member_subject TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX people_wallet ON rewards.people (wallet) WHERE wallet IS NOT NULL;
CREATE INDEX people_phone ON rewards.people (phone_hash) WHERE phone_hash IS NOT NULL;

-- ---- The shop's app -----------------------------------------------------------------------------

CREATE TABLE rewards.shop_apps (
  merchant       TEXT PRIMARY KEY REFERENCES merchant.profiles (merchant),
  slug           TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$'),
  enabled        BOOLEAN NOT NULL DEFAULT false,
  -- {logoUrl, monogram, colour, onColour, paper, paper2, headingFont, textFont}
  brand          JSONB NOT NULL CHECK (jsonb_typeof(brand) = 'object'),
  points_name    JSONB NOT NULL DEFAULT '{"kind":"points"}' CHECK (jsonb_typeof(points_name) = 'object'),
  -- Discount codes shown as offers, in this order.
  offer_code_ids TEXT[] NOT NULL DEFAULT '{}',
  -- Where Add a shop measures from: geocoded once, when the address is saved.
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An uploaded font, after its checks, converted to WOFF2. The licence is the shop's declaration.
CREATE TABLE rewards.shop_app_fonts (
  id                   TEXT PRIMARY KEY,
  merchant             TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  name                 TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  file_name            TEXT NOT NULL,
  size_bytes           INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  uploaded_as          TEXT NOT NULL CHECK (uploaded_as IN ('woff2','otf','ttf')),
  woff2                BYTEA NOT NULL,
  -- {glyphs: 'passed'|'failed', missing: [], legibility: 'passed'|'failed'}
  checks               JSONB NOT NULL,
  used_for             TEXT NOT NULL CHECK (used_for IN ('headings','everything')),
  licence_declared_at  TIMESTAMPTZ NOT NULL,
  licence_declared_by  TEXT NOT NULL REFERENCES merchant.staff (id),
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at           TIMESTAMPTZ
);
CREATE INDEX shop_app_fonts_merchant ON rewards.shop_app_fonts (merchant) WHERE removed_at IS NULL;

CREATE TABLE rewards.shop_domains (
  domain       TEXT PRIMARY KEY CHECK (domain = lower(domain)),
  merchant     TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')),
  -- {type, name, value}: what the shop adds where it bought the domain.
  record       JSONB NOT NULL,
  checked_at   TIMESTAMPTZ,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX shop_domains_one_live ON rewards.shop_domains (merchant) WHERE removed_at IS NULL;

-- A store app build: a record only. Nothing here builds or submits.
CREATE TABLE rewards.store_builds (
  id             TEXT PRIMARY KEY,
  merchant       TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  platform       TEXT NOT NULL CHECK (platform IN ('ios','android')),
  bundle_id      TEXT NOT NULL,
  version        TEXT NOT NULL,
  config_version INTEGER NOT NULL CHECK (config_version >= 1),
  review         TEXT NOT NULL DEFAULT 'not_submitted' CHECK (review IN ('not_submitted','in_review','approved','rejected','live')),
  note           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Earning and rewards ------------------------------------------------------------------------

-- Versioned: a save is a new version, effective from then. Entries keep the version that made them.
CREATE TABLE rewards.earn_rules (
  merchant     TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  version      INTEGER NOT NULL CHECK (version >= 1),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The rest of EarnRules: unit, rate, keep the change, boosts, bonuses, expiry.
  rules        JSONB NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  created_by   TEXT REFERENCES merchant.staff (id),
  PRIMARY KEY (merchant, version)
);
CREATE TRIGGER earn_rules_immutable BEFORE UPDATE OR DELETE ON rewards.earn_rules
  FOR EACH ROW EXECUTE FUNCTION payments.refuse_change();

CREATE TABLE rewards.rewards (
  id                 TEXT PRIMARY KEY,
  merchant           TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- {kind: 'item', itemIds, maxCents} | {kind: 'amount', amountCents, categories} | {kind: 'percent', percent, categories}
  gives              JSONB NOT NULL CHECK (gives->>'kind' IN ('item','amount','percent')),
  cost               INTEGER NOT NULL CHECK (cost >= 1),
  limit_per          TEXT NOT NULL DEFAULT 'none' CHECK (limit_per IN ('none','daily','weekly')),
  clear_members_only BOOLEAN NOT NULL DEFAULT false,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at        TIMESTAMPTZ
);
CREATE INDEX rewards_merchant ON rewards.rewards (merchant, cost) WHERE archived_at IS NULL;

-- Who has joined which shop, and their consent to share name, number and purchases with it.
CREATE TABLE rewards.loyalty_memberships (
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  person_id       TEXT NOT NULL REFERENCES rewards.people (id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_version TEXT NOT NULL,
  texts           TEXT NOT NULL DEFAULT 'codes' CHECK (texts IN ('codes','codes_and_offers')),
  birth_month     INTEGER CHECK (birth_month BETWEEN 1 AND 12),
  referred_by     TEXT REFERENCES rewards.people (id) ON DELETE SET NULL,
  -- Their own code for Bring a friend.
  ref_code        TEXT NOT NULL UNIQUE,
  -- Keep the change: leftover cents toward the next point. Cents, not points.
  carry_cents     BIGINT NOT NULL DEFAULT 0 CHECK (carry_cents >= 0),
  last_visit_at   TIMESTAMPTZ,
  PRIMARY KEY (merchant, person_id)
);

-- The points ledger. A member's points at a shop are the sum of their entries. Rows are never
-- changed; they are only deleted when the person leaves the shop or deletes their rewards account.
CREATE TABLE rewards.loyalty_entries (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  person_id     TEXT NOT NULL REFERENCES rewards.people (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('earn','redeem','refund','bonus_join','bonus_birthday','bonus_referral','adjust','expire')),
  points        INTEGER NOT NULL CHECK (points <> 0),
  order_id      TEXT REFERENCES commerce.orders (id),
  reward_id     TEXT REFERENCES rewards.rewards (id),
  rules_version INTEGER NOT NULL CHECK (rules_version >= 1),
  reason        TEXT,
  by_staff      TEXT REFERENCES merchant.staff (id),
  -- A repeated event (a paid order seen twice) writes nothing the second time.
  dedupe_key    TEXT NOT NULL UNIQUE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'adjust' OR reason IS NOT NULL),
  CHECK (kind NOT IN ('earn','bonus_join','bonus_birthday','bonus_referral') OR points > 0),
  CHECK (kind NOT IN ('redeem','expire') OR points < 0)
);
CREATE INDEX loyalty_entries_member ON rewards.loyalty_entries (merchant, person_id, at);
CREATE INDEX loyalty_entries_order ON rewards.loyalty_entries (order_id) WHERE order_id IS NOT NULL;
CREATE TRIGGER loyalty_entries_append_only BEFORE UPDATE ON rewards.loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION payments.refuse_change();

-- Each paid event, once: a repeat (the same order's paid event seen twice) changes nothing, even when
-- it earned nothing and only moved the keep-the-change leftover.
CREATE TABLE rewards.processed_events (
  dedupe_key TEXT PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A reward claimed for the counter: good for 15 minutes; its points come off when its order is paid.
CREATE TABLE rewards.reward_claims (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  person_id   TEXT NOT NULL REFERENCES rewards.people (id) ON DELETE CASCADE,
  reward_id   TEXT NOT NULL REFERENCES rewards.rewards (id),
  code        TEXT NOT NULL CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),
  expires_at  TIMESTAMPTZ NOT NULL,
  order_id    TEXT REFERENCES commerce.orders (id),
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reward_claims_code ON rewards.reward_claims (merchant, code);

-- A number typed at the counter: nothing shows until the person confirms on their phone.
CREATE TABLE rewards.counter_confirms (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  order_id    TEXT NOT NULL REFERENCES commerce.orders (id),
  staff_id    TEXT NOT NULL REFERENCES merchant.staff (id),
  phone_hash  TEXT NOT NULL,
  -- Null when the number is on nobody: the answer looks the same either way.
  person_id   TEXT REFERENCES rewards.people (id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined','expired')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX counter_confirms_order ON rewards.counter_confirms (order_id, created_at DESC);

-- ---- What orders and discount codes gain ---------------------------------------------------------

-- The member added at the cart. `customer` stays the free-text name it always was.
ALTER TABLE commerce.orders ADD COLUMN member_person TEXT REFERENCES rewards.people (id) ON DELETE SET NULL;
ALTER TABLE commerce.orders ADD COLUMN member_added_by TEXT;
ALTER TABLE commerce.orders ADD COLUMN member_added_via TEXT CHECK (member_added_via IN ('code','phone','claim','app'));
ALTER TABLE commerce.orders ADD COLUMN member_added_at TIMESTAMPTZ;
CREATE INDEX orders_member ON commerce.orders (merchant, member_person, created_at DESC) WHERE member_person IS NOT NULL;

-- A reward is the third kind of the order's one discount. A customer applying their own reward from
-- a Point's bill has no staff member, so a reward's applied_by can be empty.
ALTER TABLE commerce.order_discounts DROP CONSTRAINT order_discounts_kind_check;
ALTER TABLE commerce.order_discounts ADD CONSTRAINT order_discounts_kind_check CHECK (kind IN ('code','manual','reward'));
ALTER TABLE commerce.order_discounts ALTER COLUMN applied_by DROP NOT NULL;
ALTER TABLE commerce.order_discounts ADD CONSTRAINT order_discounts_applied_by CHECK (kind = 'reward' OR applied_by IS NOT NULL);
ALTER TABLE commerce.order_discounts ADD COLUMN reward_id TEXT REFERENCES rewards.rewards (id);
ALTER TABLE commerce.order_discounts ADD COLUMN reward_points INTEGER CHECK (reward_points IS NULL OR reward_points >= 1);
ALTER TABLE commerce.order_discounts ADD COLUMN claim_id TEXT REFERENCES rewards.reward_claims (id) ON DELETE SET NULL;
ALTER TABLE commerce.order_discounts ADD CONSTRAINT order_discounts_reward CHECK ((kind = 'reward') = (reward_id IS NOT NULL AND reward_points IS NOT NULL));

-- Offers: a code shown in the shop's app, to whom, how it's worded, and on which weekdays (Monday 0).
ALTER TABLE commerce.discount_codes ADD COLUMN show_in_app BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commerce.discount_codes ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone','members','clear_members'));
ALTER TABLE commerce.discount_codes ADD COLUMN offer_title TEXT CHECK (offer_title IS NULL OR length(offer_title) BETWEEN 1 AND 40);
ALTER TABLE commerce.discount_codes ADD COLUMN offer_detail TEXT CHECK (offer_detail IS NULL OR length(offer_detail) <= 80);
ALTER TABLE commerce.discount_codes ADD COLUMN days INTEGER[] CHECK (days IS NULL OR (cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[0,1,2,3,4,5,6]));
