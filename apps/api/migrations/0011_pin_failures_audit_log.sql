-- Hardening (card-processing prompt, Phase 10): PIN attempts that hold across instances, and an
-- audit log of every money-moving action.

-- Every wrong PIN at a shop, kept for the lockout window. In the database rather than in memory so
-- every API instance sees the same count, and a restart doesn't hand out fresh guesses. A correct
-- PIN doesn't clear it: a counter worker could otherwise type their own PIN between guesses at a
-- manager's and never be locked out.
CREATE TABLE merchant.pin_failures (
  id        BIGSERIAL PRIMARY KEY,
  merchant  TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'session' (starting a shift) or 'approval' (a manager's PIN on a refund, override, void, sign-off)
  source    TEXT NOT NULL CHECK (source IN ('session','approval')),
  -- The person named, when a name was picked first; never whose PIN it turned out to be.
  staff_id  TEXT
);
CREATE INDEX pin_failures_recent ON merchant.pin_failures (merchant, at DESC);

CREATE FUNCTION payments.refuse_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = 'restrict_violation';
END $$;

-- Who did what to the money, and when: every ledger booking (written by the ledger service) and
-- every money action that books nothing itself (a card hold, a capture, a void, a refund asked for
-- or decided, an override, a count, a sign-off, a close, a fee collected). Append-only.
CREATE TABLE payments.audit_log (
  id           BIGSERIAL PRIMARY KEY,
  merchant     TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The staff member who acted; null for the system (a job, a processor webhook).
  actor        TEXT,
  -- Whoever approved it with their PIN, when it needed one.
  approver     TEXT,
  action       TEXT NOT NULL CHECK (action ~ '^[a-z_.]+$'),
  ref_type     TEXT,
  ref_id       TEXT,
  amount_cents BIGINT,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((ref_type IS NULL) = (ref_id IS NULL))
);
CREATE INDEX audit_log_merchant ON payments.audit_log (merchant, at DESC);
CREATE INDEX audit_log_ref ON payments.audit_log (ref_type, ref_id);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON payments.audit_log
  FOR EACH ROW EXECUTE FUNCTION payments.refuse_audit_change();
