-- The shop as a business customer of Bridge (hosted KYB): needed before Bridge moves a shop's money
-- to its bank. Only Bridge's customer id and the address it was verified under are kept; the
-- business documents and owner details go to Bridge and stay there.
ALTER TABLE merchant.profiles
  ADD COLUMN IF NOT EXISTS bridge_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS kyb_email          TEXT;
