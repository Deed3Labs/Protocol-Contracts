-- The double-entry ledger (card-processing prompt, Phase 2: `ledger`).
--
-- Append-only: nothing is edited or deleted, and a correction is a reversing entry. Only the
-- ledger service (src/services/merchant/ledger) writes here; a test fails if anything else does.
-- The database backs that up: every entry balances, has at least two lines, and keeps to one shop,
-- or the transaction that wrote it doesn't commit.

CREATE SCHEMA ledger;

CREATE FUNCTION ledger.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The ledger is append-only: post a reversing entry instead' USING ERRCODE = 'restrict_violation';
END $$;

CREATE TABLE ledger.accounts (
  id         TEXT PRIMARY KEY,
  merchant   TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  -- drawer_cash, sales, … or tips_payable:<staff id>, one per person.
  code       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('asset','liability','income','expense')),
  -- Which side increases it. Discounts and refunds are income accounts that a debit increases
  -- (contra-revenue), which is why this isn't simply implied by the type.
  normal     TEXT NOT NULL CHECK (normal IN ('debit','credit')),
  staff_id   TEXT REFERENCES merchant.staff (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, code),
  CHECK ((code LIKE 'tips_payable:%') = (staff_id IS NOT NULL)),
  CHECK (staff_id IS NULL OR code = 'tips_payable:' || staff_id),
  CHECK (CASE
    WHEN code IN ('drawer_cash','cash_in_transit_to_bank','bank','card_receivable','clear_receivable')
      THEN type = 'asset' AND normal = 'debit'
    WHEN code = 'tax_payable' OR code LIKE 'tips_payable:%'
      THEN type = 'liability' AND normal = 'credit'
    WHEN code = 'sales'
      THEN type = 'income' AND normal = 'credit'
    WHEN code IN ('discounts','refunds')
      THEN type = 'income' AND normal = 'debit'
    WHEN code IN ('cash_over_short','card_processing_expense')
      THEN type = 'expense' AND normal = 'debit'
    ELSE false
  END)
);
-- Accounts are opened, never changed or closed.
CREATE TRIGGER accounts_append_only BEFORE UPDATE OR DELETE ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.refuse_change();

CREATE TABLE ledger.journal_entries (
  id              TEXT PRIMARY KEY,
  merchant        TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  occurred_at     TIMESTAMPTZ NOT NULL,
  -- cash_sale, card_capture, tip_paid_out, … (see postings.ts), or 'reversal'.
  kind            TEXT NOT NULL CHECK (kind ~ '^[a-z_]+$'),
  -- What it's about: an order, a tender, a drawer session, a deposit, a payout.
  ref_type        TEXT CHECK (ref_type IN ('order','tender','refund','drawer_session','bank_deposit','payout','entry')),
  ref_id          TEXT,
  memo            TEXT,
  created_by      TEXT REFERENCES merchant.staff (id),
  -- The same fact posted twice is the same entry: a retry finds the first one.
  idempotency_key TEXT NOT NULL,
  -- A hash of what was posted, so the same key with different lines is refused, not answered.
  content_hash    TEXT NOT NULL,
  -- A reversal names the entry it undoes; an entry is reversed at most once.
  reverses        TEXT UNIQUE REFERENCES ledger.journal_entries (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, idempotency_key),
  CHECK ((ref_type IS NULL) = (ref_id IS NULL)),
  CHECK ((kind = 'reversal') = (reverses IS NOT NULL))
);
CREATE INDEX journal_entries_ref ON ledger.journal_entries (merchant, ref_type, ref_id);
CREATE INDEX journal_entries_time ON ledger.journal_entries (merchant, occurred_at);

CREATE TABLE ledger.journal_lines (
  id           BIGSERIAL PRIMARY KEY,
  entry_id     TEXT NOT NULL REFERENCES ledger.journal_entries (id),
  account_id   TEXT NOT NULL REFERENCES ledger.accounts (id),
  debit_cents  BIGINT NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents BIGINT NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  -- Exactly one side, and never a zero line.
  CHECK ((debit_cents > 0) <> (credit_cents > 0))
);
CREATE INDEX journal_lines_entry ON ledger.journal_lines (entry_id);
CREATE INDEX journal_lines_account ON ledger.journal_lines (account_id);

CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON ledger.journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger.refuse_change();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON ledger.journal_lines
  FOR EACH ROW EXECUTE FUNCTION ledger.refuse_change();
CREATE TRIGGER accounts_no_truncate BEFORE TRUNCATE ON ledger.accounts
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.refuse_change();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON ledger.journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.refuse_change();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON ledger.journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.refuse_change();

-- Checked at COMMIT, once every line of the entry is in: the entry balances, has two lines or
-- more, touches only its own shop's accounts, and a reversal exactly mirrors what it reverses.
CREATE FUNCTION ledger.check_entry(p_entry TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  e        ledger.journal_entries%ROWTYPE;
  n        INTEGER;
  dr       BIGINT;
  cr       BIGINT;
  foreign_ INTEGER;
  mismatch INTEGER;
BEGIN
  SELECT * INTO e FROM ledger.journal_entries WHERE id = p_entry;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), COALESCE(sum(l.debit_cents), 0), COALESCE(sum(l.credit_cents), 0),
         count(*) FILTER (WHERE a.merchant <> e.merchant)
    INTO n, dr, cr, foreign_
    FROM ledger.journal_lines l JOIN ledger.accounts a ON a.id = l.account_id
   WHERE l.entry_id = p_entry;

  IF n < 2 THEN
    RAISE EXCEPTION 'Journal entry % has % line(s); an entry needs at least two', p_entry, n USING ERRCODE = 'check_violation';
  END IF;
  IF dr <> cr THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits % ≠ credits %', p_entry, dr, cr USING ERRCODE = 'check_violation';
  END IF;
  IF foreign_ > 0 THEN
    RAISE EXCEPTION 'Journal entry % posts to another shop''s account', p_entry USING ERRCODE = 'check_violation';
  END IF;

  IF e.reverses IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM ledger.journal_entries WHERE id = e.reverses AND merchant = e.merchant) THEN
      RAISE EXCEPTION 'Journal entry % reverses an entry from another shop', p_entry USING ERRCODE = 'check_violation';
    END IF;
    -- Per account, the reversal's net is the negative of the original's.
    SELECT count(*) INTO mismatch FROM (
      SELECT account_id, sum(debit_cents - credit_cents) AS net FROM ledger.journal_lines WHERE entry_id = p_entry GROUP BY account_id
    ) r FULL JOIN (
      SELECT account_id, sum(debit_cents - credit_cents) AS net FROM ledger.journal_lines WHERE entry_id = e.reverses GROUP BY account_id
    ) o USING (account_id)
    WHERE COALESCE(r.net, 0) <> -COALESCE(o.net, 0);
    IF mismatch > 0 THEN
      RAISE EXCEPTION 'Journal entry % does not exactly reverse %', p_entry, e.reverses USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END $$;

CREATE FUNCTION ledger.check_entry_on_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.check_entry(NEW.id);
  RETURN NULL;
END $$;

CREATE FUNCTION ledger.check_entry_on_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger.check_entry(NEW.entry_id);
  RETURN NULL;
END $$;

-- On the entry as well as its lines, so an entry with no lines at all is caught too.
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON ledger.journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.check_entry_on_entry();
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON ledger.journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.check_entry_on_line();
