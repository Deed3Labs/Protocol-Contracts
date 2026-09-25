-- Tenders, refunds, the Stripe inbox, the outbox, and the drawer and Close the day
-- (card-processing prompt, Phase 2: `payments`, and "Drawer and close", which lives here because a
-- cash tender belongs to a drawer session and the two are written in one transaction).

CREATE SCHEMA payments;

CREATE FUNCTION payments.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% is immutable once written', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- ---- The drawer ---------------------------------------------------------------------------------

CREATE TABLE payments.drawer_sessions (
  id                  TEXT PRIMARY KEY,
  merchant            TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  business_date       DATE NOT NULL,
  opened_by           TEXT NOT NULL REFERENCES merchant.staff (id),
  starting_cash_cents BIGINT NOT NULL CHECK (starting_cash_cents >= 0),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','counting','closed')),
  closed_by           TEXT REFERENCES merchant.staff (id),
  closed_at           TIMESTAMPTZ,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
-- One drawer at a time per shop.
CREATE UNIQUE INDEX drawer_sessions_one_open ON payments.drawer_sessions (merchant) WHERE status <> 'closed';
CREATE INDEX drawer_sessions_day ON payments.drawer_sessions (merchant, business_date);

-- Blind counts. A row is one person's count. The API never returns one counter's figure, or what
-- the drawer should hold, to the other before both are saved: the read goes through a projection
-- (services/merchant/drawer/countsView.ts) whose output type has nowhere to put either.
--
-- When the two counts disagree with each other, both count again: the old pair is superseded, not
-- edited, so the record shows that it happened.
CREATE TABLE payments.drawer_counts (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES payments.drawer_sessions (id),
  counter       TEXT NOT NULL REFERENCES merchant.staff (id),
  method        TEXT NOT NULL CHECK (method IN ('notes','total')),
  -- {"10000": 1, "2000": 4, …} by denomination in cents, when counted note by note.
  notes         JSONB CHECK (notes IS NULL OR jsonb_typeof(notes) = 'object'),
  total_cents   BIGINT NOT NULL CHECK (total_cents >= 0),
  second        BOOLEAN NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  CHECK ((method = 'notes') = (notes IS NOT NULL))
);
CREATE UNIQUE INDEX drawer_counts_one_each ON payments.drawer_counts (session_id, second) WHERE superseded_at IS NULL;

-- The second count is someone else's. Checked here as well as in the service, because it's the
-- whole point of a second count.
CREATE FUNCTION payments.check_second_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.second AND EXISTS (
    SELECT 1 FROM payments.drawer_counts
     WHERE session_id = NEW.session_id AND NOT second AND superseded_at IS NULL AND counter = NEW.counter
  ) THEN
    RAISE EXCEPTION 'The second count must be someone other than the first counter' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drawer_counts_second_counter BEFORE INSERT ON payments.drawer_counts
  FOR EACH ROW EXECUTE FUNCTION payments.check_second_counter();

-- A difference is signed off by an owner or manager who wasn't the first counter.
CREATE TABLE payments.drawer_signoffs (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL UNIQUE REFERENCES payments.drawer_sessions (id),
  difference_cents BIGINT NOT NULL,
  note             TEXT NOT NULL CHECK (length(note) > 0),
  signed_by        TEXT NOT NULL REFERENCES merchant.staff (id),
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION payments.check_signoff() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payments.drawer_counts
     WHERE session_id = NEW.session_id AND NOT second AND superseded_at IS NULL AND counter = NEW.signed_by
  ) THEN
    RAISE EXCEPTION 'A difference is signed off by someone other than the first counter' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM merchant.staff WHERE id = NEW.signed_by AND role IN ('manager','owner') AND active
  ) THEN
    RAISE EXCEPTION 'A difference is signed off by a manager or an owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drawer_signoffs_signer BEFORE INSERT ON payments.drawer_signoffs
  FOR EACH ROW EXECUTE FUNCTION payments.check_signoff();
CREATE TRIGGER drawer_signoffs_immutable BEFORE UPDATE OR DELETE ON payments.drawer_signoffs
  FOR EACH ROW EXECUTE FUNCTION payments.refuse_change();

-- The cash that leaves the drawer for the bank at close. Marked when someone takes it in.
CREATE TABLE payments.bank_deposits (
  id           TEXT PRIMARY KEY,
  merchant     TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  session_id   TEXT NOT NULL UNIQUE REFERENCES payments.drawer_sessions (id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by    TEXT REFERENCES merchant.staff (id),
  marked_at    TIMESTAMPTZ,
  CHECK ((marked_by IS NULL) = (marked_at IS NULL))
);
CREATE INDEX bank_deposits_unmarked ON payments.bank_deposits (merchant) WHERE marked_at IS NULL;

-- Locked at Close the day: a snapshot, never recomputed and never edited.
CREATE TABLE payments.day_reports (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  session_id    TEXT NOT NULL UNIQUE REFERENCES payments.drawer_sessions (id),
  business_date DATE NOT NULL,
  -- The DayReport contract, as it was at close.
  report        JSONB NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  closed_by     TEXT NOT NULL REFERENCES merchant.staff (id),
  closed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX day_reports_day ON payments.day_reports (merchant, business_date);
CREATE TRIGGER day_reports_immutable BEFORE UPDATE OR DELETE ON payments.day_reports
  FOR EACH ROW EXECUTE FUNCTION payments.refuse_change();

-- ---- Tenders and refunds ------------------------------------------------------------------------

CREATE TABLE payments.tenders (
  id                TEXT PRIMARY KEY,
  merchant          TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  order_id          TEXT NOT NULL REFERENCES commerce.orders (id),
  method            TEXT NOT NULL CHECK (method IN ('clear','card','cash')),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  tip_cents         BIGINT NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                      ('pending','authorised','approved','declined','captured','cancelled','refunded','partly_refunded')),
  refunded_cents    BIGINT NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  -- The retry key the app sent, and a hash of the request it came with: the same key with a
  -- different body is a bug on the client, and is refused rather than silently answered.
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  -- Who the tip goes to: whoever raised the sale unless the shop splits by hours.
  tip_staff_id      TEXT REFERENCES merchant.staff (id),
  created_by        TEXT NOT NULL REFERENCES merchant.staff (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Card. Card data never reaches us: only what the processor reports back.
  connector_id      TEXT REFERENCES merchant.card_connectors (id),
  payment_intent_id TEXT UNIQUE,
  reader_id         TEXT REFERENCES merchant.readers (id),
  card_brand        TEXT,
  card_last4        TEXT CHECK (card_last4 ~ '^[0-9]{4}$'),
  -- Clear's fee on this card sale (clearCardFee), fixed when the PaymentIntent was created.
  application_fee_cents BIGINT CHECK (application_fee_cents >= 0),
  captured_at       TIMESTAMPTZ,

  -- Clear: the charge the member approves, in public.charges. Not a foreign key, for the reason
  -- given at the top of src/config/merchantDb.ts.
  clear_charge_code TEXT UNIQUE,

  -- Cash: into which drawer, what was handed over and what went back.
  drawer_session_id TEXT REFERENCES payments.drawer_sessions (id),
  handed_over_cents BIGINT CHECK (handed_over_cents > 0),
  change_cents      BIGINT CHECK (change_cents >= 0),

  UNIQUE (merchant, idempotency_key),
  CHECK (refunded_cents <= amount_cents + tip_cents),
  CHECK (method = 'card' OR (payment_intent_id IS NULL AND card_last4 IS NULL AND application_fee_cents IS NULL)),
  CHECK (method = 'clear' OR clear_charge_code IS NULL),
  CHECK (method = 'cash' OR (handed_over_cents IS NULL AND change_cents IS NULL AND drawer_session_id IS NULL)),
  CHECK (method <> 'cash' OR (drawer_session_id IS NOT NULL AND handed_over_cents = amount_cents + tip_cents + change_cents)),
  CHECK (CASE method
    WHEN 'card'  THEN status IN ('pending','authorised','declined','captured','cancelled','refunded','partly_refunded')
    WHEN 'cash'  THEN status IN ('pending','approved','cancelled','refunded','partly_refunded')
    WHEN 'clear' THEN status IN ('pending','approved','declined','cancelled')
  END)
);
CREATE INDEX tenders_order ON payments.tenders (order_id);
-- What Close the day captures.
CREATE INDEX tenders_to_capture ON payments.tenders (merchant, created_at) WHERE method = 'card' AND status = 'authorised';
CREATE INDEX tenders_drawer ON payments.tenders (drawer_session_id) WHERE drawer_session_id IS NOT NULL;

-- Card and cash refunds. A Clear refund stays in merchant.refunds and its own flow (HARD STOP 1,
-- decision 9); unwinding a member's plan is the protocol's open question.
CREATE TABLE payments.refunds (
  id                 TEXT PRIMARY KEY,
  merchant           TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  tender_id          TEXT NOT NULL REFERENCES payments.tenders (id),
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  -- [{orderLineId, quantity, backInStock}]
  items              JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested','approved','declined','succeeded','failed')),
  idempotency_key    TEXT NOT NULL,
  request_hash       TEXT NOT NULL,
  requested_by       TEXT NOT NULL REFERENCES merchant.staff (id),
  approved_by        TEXT REFERENCES merchant.staff (id),
  decided_at         TIMESTAMPTZ,
  external_refund_id TEXT UNIQUE,
  -- A cash refund comes out of this drawer.
  drawer_session_id  TEXT REFERENCES payments.drawer_sessions (id),
  failure_reason     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, idempotency_key)
);
CREATE INDEX refunds_tender ON payments.refunds (tender_id);
CREATE INDEX refunds_waiting ON payments.refunds (merchant) WHERE status = 'requested';

-- ---- The Stripe inbox, and the outbox -----------------------------------------------------------

-- Every webhook lands here first: stored, acknowledged, then processed by a job, keyed on Stripe's
-- event id so a redelivery is a no-op (principle 4).
CREATE TABLE payments.stripe_events (
  event_id     TEXT PRIMARY KEY,
  -- 'platform' or 'connect': which endpoint (and signing secret) it came through.
  endpoint     TEXT NOT NULL CHECK (endpoint IN ('platform','connect')),
  type         TEXT NOT NULL,
  -- The connected account, for Connect events.
  account      TEXT,
  livemode     BOOLEAN NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  error        TEXT
);
CREATE INDEX stripe_events_pending ON payments.stripe_events (received_at) WHERE processed_at IS NULL;

-- Internal events ("order paid") for notifications and reports, written in the same transaction as
-- the change they describe and published after.
CREATE TABLE payments.outbox (
  id           BIGSERIAL PRIMARY KEY,
  merchant     TEXT NOT NULL,
  topic        TEXT NOT NULL,
  -- Makes a repeated publish of the same fact a no-op.
  dedupe_key   TEXT NOT NULL UNIQUE,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  error        TEXT
);
CREATE INDEX outbox_pending ON payments.outbox (id) WHERE published_at IS NULL;
