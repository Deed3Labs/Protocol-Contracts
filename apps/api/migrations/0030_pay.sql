-- Pay with Clear (docs/pay-reference): payment links, the public API's keys and allowed websites,
-- webhooks, and the modal's payment-scoped sessions and one-time codes. An online payment is an
-- order with the existing tenders, so orders say where they were raised and whether they're a test.

-- ---- Orders and tenders ------------------------------------------------------------------------

-- Where an order was raised. Everything before this was the counter's.
ALTER TABLE commerce.orders ADD COLUMN source TEXT NOT NULL DEFAULT 'counter'
  CHECK (source IN ('counter','point','phone','online','link'));
-- The website's origin ("https://micasatacos.com") or the link's slug.
ALTER TABLE commerce.orders ADD COLUMN source_detail TEXT;
-- A test payment: never in the books, stock, tax, payouts or statements.
ALTER TABLE commerce.orders ADD COLUMN livemode BOOLEAN NOT NULL DEFAULT true;

-- Nobody at the shop raises a website's or a link's order, and only those go without (pay
-- DECISIONS, Phase 1). There is no "Website" staff member: it would show in staff, shifts and tips.
ALTER TABLE commerce.orders ALTER COLUMN raised_by DROP NOT NULL;
ALTER TABLE commerce.orders ADD CONSTRAINT orders_staff_unless_online
  CHECK (raised_by IS NOT NULL OR source IN ('online','link'));
CREATE INDEX orders_source ON commerce.orders (merchant, source, source_detail) WHERE source IN ('online','link');

-- A tender has the same rule, held by its order's source.
ALTER TABLE payments.tenders ALTER COLUMN created_by DROP NOT NULL;
CREATE FUNCTION payments.tender_staff_unless_online() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL AND NOT EXISTS (
    SELECT 1 FROM commerce.orders WHERE id = NEW.order_id AND source IN ('online','link')
  ) THEN
    RAISE EXCEPTION 'tender % needs a staff member: its order is not online', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenders_staff_unless_online BEFORE INSERT OR UPDATE OF created_by ON payments.tenders
  FOR EACH ROW EXECUTE FUNCTION payments.tender_staff_unless_online();

-- An audit row a customer caused online: the merchant app reads "Online" for it.
ALTER TABLE payments.audit_log ADD COLUMN source TEXT CHECK (source IN ('online','link'));

-- ---- Payment links -----------------------------------------------------------------------------

-- A stored payment the shop can text, email or print: an amount, or an Inventory item and a quantity.
-- Each time it's paid it makes a new order (source 'link', source_detail its slug).
CREATE TABLE payments.payment_links (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  -- pay.useclear.org/l/<slug>: the shop's slug and six random characters, unique everywhere.
  slug            TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  livemode        BOOLEAN NOT NULL DEFAULT true,
  -- An amount link: what the customer pays, no tax added.
  amount_cents    BIGINT CHECK (amount_cents >= 50),
  -- An item link: the item, and how many. Its price and tax are worked out when it's paid.
  item_id         TEXT REFERENCES commerce.catalog_items (id),
  quantity        INTEGER CHECK (quantity BETWEEN 1 AND 99),
  note            TEXT CHECK (char_length(note) <= 200),
  expires_at      TIMESTAMPTZ,
  allow_over_time BOOLEAN NOT NULL DEFAULT false,
  -- Staff, or null when the public API made it.
  created_by      TEXT REFERENCES merchant.staff (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_by  TEXT REFERENCES merchant.staff (id),
  deactivated_at  TIMESTAMPTZ,
  CHECK ((amount_cents IS NULL) <> (item_id IS NULL)),
  CHECK ((item_id IS NULL) = (quantity IS NULL))
);
CREATE INDEX payment_links_shop ON payments.payment_links (merchant, created_at DESC);

-- ---- The public API: keys and allowed websites -------------------------------------------------

-- A publishable key is kept in full (it's public). A secret key is kept only as a hash and shown once.
-- Rolling a secret key makes a new row; the old one has rolled_at and works until expires_at.
CREATE TABLE payments.api_keys (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  kind            TEXT NOT NULL CHECK (kind IN ('publishable','secret')),
  livemode        BOOLEAN NOT NULL,
  token           TEXT UNIQUE,
  secret_hash     TEXT UNIQUE,
  last4           TEXT NOT NULL CHECK (last4 ~ '^[0-9A-Za-z]{4}$'),
  pinned_version  TEXT NOT NULL,
  created_by      TEXT REFERENCES merchant.staff (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  CHECK ((kind = 'publishable') = (token IS NOT NULL)),
  CHECK ((kind = 'secret') = (secret_hash IS NOT NULL)),
  CHECK ((rolled_at IS NULL) = (expires_at IS NULL))
);
-- One current key of each kind per shop and mode.
CREATE UNIQUE INDEX api_keys_current ON payments.api_keys (merchant, kind, livemode) WHERE rolled_at IS NULL;

-- Where the script may open and the modal may be framed: origins only.
CREATE TABLE payments.allowed_sites (
  merchant   TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  origin     TEXT NOT NULL CHECK (origin ~ '^https?://[^/]+$'),
  -- localhost and other loopback origins: test keys only.
  test_only  BOOLEAN NOT NULL DEFAULT false,
  added_by   TEXT REFERENCES merchant.staff (id),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant, origin),
  CHECK (test_only OR origin LIKE 'https://%')
);

-- ---- The public API's payments and refunds ---------------------------------------------------------

-- A payment is the public view of one online or link order (rule 2): its id, the shop's reference and
-- metadata, the ways it may be paid, and its client secret (kept encrypted, to give back to the secret
-- key that reads it, and hashed, to find it when a page hands it to the script).
CREATE TABLE payments.api_payments (
  id                 TEXT PRIMARY KEY,
  merchant           TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  order_id           TEXT NOT NULL UNIQUE REFERENCES commerce.orders (id),
  livemode           BOOLEAN NOT NULL,
  created_via        TEXT NOT NULL CHECK (created_via IN ('api','link','modal')),
  key_id             TEXT REFERENCES payments.api_keys (id),
  reference          TEXT CHECK (char_length(reference) <= 100),
  methods            TEXT[] NOT NULL CHECK (cardinality(methods) > 0 AND methods <@ ARRAY['clear','card']),
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  client_secret_hash TEXT NOT NULL UNIQUE,
  client_secret_enc  TEXT NOT NULL,
  idempotency_key    TEXT,
  request_hash       TEXT,
  canceled_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((idempotency_key IS NULL) = (request_hash IS NULL))
);
-- The shop's reference is unique per shop and mode; so is a retry key.
CREATE UNIQUE INDEX api_payments_reference ON payments.api_payments (merchant, livemode, reference) WHERE reference IS NOT NULL;
CREATE UNIQUE INDEX api_payments_idempotency ON payments.api_payments (merchant, livemode, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX api_payments_list ON payments.api_payments (merchant, livemode, created_at DESC);

-- A refund asked for through the API: the card refund (payments.refunds) it became. A Clear payment
-- is refunded from Charges, where the owner approves it (pay DECISIONS, Phase 4), so `clear_refund_id`
-- is for when the API can ask for one.
CREATE TABLE payments.api_refunds (
  id               TEXT PRIMARY KEY,
  merchant         TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  payment_id       TEXT NOT NULL REFERENCES payments.api_payments (id),
  livemode         BOOLEAN NOT NULL,
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  reason           TEXT CHECK (char_length(reason) <= 200),
  method           TEXT NOT NULL CHECK (method IN ('clear','card')),
  card_refund_id   TEXT UNIQUE REFERENCES payments.refunds (id),
  clear_refund_id  TEXT UNIQUE,
  require_approval BOOLEAN NOT NULL DEFAULT false,
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, livemode, idempotency_key),
  CHECK (method = 'card' OR card_refund_id IS NULL),
  CHECK (method = 'clear' OR clear_refund_id IS NULL)
);

-- A card refund the API asked for has nobody at the shop behind it; anything else still does.
ALTER TABLE payments.refunds ADD COLUMN via_api BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payments.refunds ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE payments.refunds ADD CONSTRAINT refunds_staff_unless_api CHECK (requested_by IS NOT NULL OR via_api);

-- ---- Webhooks ----------------------------------------------------------------------------------

CREATE TABLE payments.webhook_endpoints (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  livemode    BOOLEAN NOT NULL,
  url         TEXT NOT NULL CHECK (url LIKE 'https://%'),
  events      TEXT[] NOT NULL CHECK (cardinality(events) > 0),
  status      TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  -- The signing secret, encrypted at rest (AES-256-GCM under PAY_WEBHOOK_KEY): it has to be read to sign.
  secret_enc  TEXT NOT NULL,
  created_by  TEXT REFERENCES merchant.staff (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX webhook_endpoints_shop ON payments.webhook_endpoints (merchant, livemode) WHERE deleted_at IS NULL;

-- An event, written in the transaction of the change it describes. `data` is the object as it was.
CREATE TABLE payments.webhook_events (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  livemode    BOOLEAN NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('payment.succeeded','payment.failed','payment.canceled','refund.succeeded')),
  data        JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  -- A change happens once: one event for it, whatever retries the transaction.
  dedupe_key  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_shop ON payments.webhook_events (merchant, created_at DESC);

-- One event to one endpoint, retried with backoff for 3 days; each attempt is logged for Developers.
CREATE TABLE payments.webhook_deliveries (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES payments.webhook_events (id),
  endpoint_id     TEXT NOT NULL REFERENCES payments.webhook_endpoints (id),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  response_code   INTEGER,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, endpoint_id),
  CHECK ((status = 'pending') = (next_attempt_at IS NOT NULL))
);
CREATE INDEX webhook_deliveries_due ON payments.webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- ---- The modal and the link page ---------------------------------------------------------------

-- A payment-scoped session: one payment (an order), from one website or one link. Signing in inside it
-- gives a token good for this session only; nothing about who signed in outlives it.
CREATE TABLE payments.pay_sessions (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  livemode        BOOLEAN NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('modal','link')),
  order_id        TEXT REFERENCES commerce.orders (id),
  link_id         TEXT REFERENCES payments.payment_links (id),
  -- The allowed website that made a modal session: the only origin the frame posts to.
  origin          TEXT,
  -- What the shop set: accent, logo, locale, methods, email.
  options         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  -- Step 1 of joining, encrypted, for 30 minutes. Never an SSN.
  join_basics_enc TEXT,
  join_handoff    TEXT UNIQUE,
  join_state      TEXT CHECK (join_state IN ('waiting','done','failed','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  CHECK ((kind = 'link') = (link_id IS NOT NULL)),
  CHECK (kind = 'link' OR origin IS NOT NULL)
);
CREATE INDEX pay_sessions_order ON payments.pay_sessions (order_id);

-- A one-time code, kept hashed: six digits, five tries, ten minutes.
CREATE TABLE payments.pay_codes (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES payments.pay_sessions (id),
  channel       TEXT NOT NULL CHECK (channel IN ('phone','email')),
  -- sha256 of the E.164 number or the lower-cased email, for rate limits and finding the member.
  contact_hash  TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);
CREATE INDEX pay_codes_contact ON payments.pay_codes (contact_hash, sent_at DESC);
