-- The card credit fee (decision 55; docs/audit/specs/card-credit-fee.md). 30¢ by default in the API,
-- charged only while the chain's maxCardCreditFee covers it. Note L-02 §2.6C on the plan of business.
--
-- A Clear Visa purchase that draws on a credit tier adds a flat fee on top (30¢ once switched on).
-- The fee is stored beside the authorization, never inside it: `draws` and `credit_cents` keep
-- meaning the purchase, which settlement funding (the fiat owed to the merchant) relies on.
--
--   fee_cents                the fee decided at the swipe, in cents (0: none).
--   fee_draws                the credit tiers it was drawn from, cheapest first, after the purchase.
--   fee_status               held | charged | released | waived | returned (services/lithic/cardCreditFee.ts).
--   fee_at                   when fee_status last changed.
--   fee_return_target_cents  how much of a charged fee should be credited back in all
--                            (returnCardCreditFee: the CFL cap, MB-04 §5.4(f)).
--   fee_returned_cents       how much the chain says has been given back (cardCreditFeeOf).
--   fee_return_status, _tx, _error, _attempts   the last credit-back attempt's outcome.
--
-- Covered borrowers under the Military Lending Act pay no fee (MB-04 §5.10):
--   lithic_covered_borrowers  per member; no row or NULL is not covered. Nothing sets it yet.
--   lithic_tier_snapshots.covered_borrower  copied onto each card's snapshot, which is the one row
--                            the Auth Stream reads.
--
-- These tables belong to the Pay ledger, which creates them lazily (services/lithic/authStore.ts)
-- and may live in its own database (PAY_DATABASE_URL). The auth store adds the same columns and
-- table there itself; this migration adds them where the ledger shares this database, and does
-- nothing where it does not exist (yet).
DO $$
BEGIN
  IF to_regclass('public.lithic_auth_decisions') IS NOT NULL THEN
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_draws JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_status TEXT;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_at TIMESTAMPTZ;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_return_target_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_returned_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_return_status TEXT;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_return_tx TEXT;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_return_error TEXT;
    ALTER TABLE public.lithic_auth_decisions ADD COLUMN IF NOT EXISTS fee_return_attempts INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS public.lithic_covered_borrowers (
      wallet     TEXT PRIMARY KEY,
      covered    BOOLEAN,
      source     TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  END IF;
  IF to_regclass('public.lithic_tier_snapshots') IS NOT NULL THEN
    ALTER TABLE public.lithic_tier_snapshots ADD COLUMN IF NOT EXISTS covered_borrower BOOLEAN;
  END IF;
END
$$;
