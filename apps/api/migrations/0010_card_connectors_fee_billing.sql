-- The card-connector interface and Clear's fee billed monthly (card-processing prompt, Phase 9).

-- Replaces a CHECK found by what it says rather than by name: the originals were unnamed, and the
-- names Postgres gave them aren't something to depend on.
CREATE FUNCTION pg_temp.drop_check(tbl regclass, mentions text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  SELECT conname INTO STRICT c FROM pg_constraint
   WHERE conrelid = tbl AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%' || mentions || '%';
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl, c);
END $$;

-- A second provider can be recorded. Only a configured connector can open one (cards/registry.ts);
-- Square is a stub until it's built.
SELECT pg_temp.drop_check('merchant.card_connectors', 'provider');
ALTER TABLE merchant.card_connectors ADD CONSTRAINT card_connectors_provider CHECK (provider IN ('stripe','square'));
SELECT pg_temp.drop_check('merchant.readers', 'provider');
ALTER TABLE merchant.readers ADD CONSTRAINT readers_provider CHECK (provider IN ('stripe','square'));

-- Two ledger accounts: Clear's fee owed but not yet collected (a processor that can't take it off
-- each sale), and the shop's cash account, which the monthly bill is collected from.
SELECT pg_temp.drop_check('ledger.accounts', 'card_processing_expense');
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_code_type CHECK (CASE
  WHEN code IN ('drawer_cash','cash_in_transit_to_bank','bank','card_receivable','clear_receivable','cash_account')
    THEN type = 'asset' AND normal = 'debit'
  WHEN code IN ('tax_payable','clear_fees_payable') OR code LIKE 'tips_payable:%'
    THEN type = 'liability' AND normal = 'credit'
  WHEN code = 'sales'
    THEN type = 'income' AND normal = 'credit'
  WHEN code IN ('discounts','refunds')
    THEN type = 'income' AND normal = 'debit'
  WHEN code IN ('cash_over_short','card_processing_expense')
    THEN type = 'expense' AND normal = 'debit'
  ELSE false
END);

SELECT pg_temp.drop_check('ledger.journal_entries', 'drawer_session');
ALTER TABLE ledger.journal_entries ADD CONSTRAINT journal_entries_ref_type
  CHECK (ref_type IN ('order','tender','refund','drawer_session','bank_deposit','payout','entry','fee_bill'));

-- Clear's fee on a card sale whose processor couldn't take it: owed, and billed at month end.
-- `fee_billed` is decided when the tender is made (by its processor), so a capture that reaches us by
-- webhook accrues the fee the same as one we asked for. `application_fee_cents` stays what the
-- processor took (0 here), which is what reconciliation checks.
ALTER TABLE payments.tenders
  ADD COLUMN fee_billed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN clear_fee_billed_cents BIGINT NOT NULL DEFAULT 0 CHECK (clear_fee_billed_cents >= 0),
  ADD CONSTRAINT tenders_fee_billed_card CHECK (NOT fee_billed OR method = 'card');

-- A month's bill for Clear's fee, collected from the shop's cash account.
--   due         raised, not yet attempted (or collection isn't configured on this server)
--   collecting  a transfer was sent; its outcome isn't recorded yet. Never retried on its own: a
--               person checks the chain, because sending again could take it twice
--   short       the cash account didn't hold enough; tried again the next day
--   collected   taken, with its transaction
CREATE TABLE payments.clear_fee_bills (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  period        TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  status        TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','collecting','short','collected')),
  tx_hash       TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at  TIMESTAMPTZ,
  collected_at  TIMESTAMPTZ,
  UNIQUE (merchant, period),
  CHECK ((status = 'collected') = (collected_at IS NOT NULL))
);
