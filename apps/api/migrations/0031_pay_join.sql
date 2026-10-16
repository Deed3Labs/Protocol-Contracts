-- Joining from the modal (pay spec §3; pay DECISIONS, Phase 6). Step 1's basics are already kept
-- (join_basics_enc); these say whose contact the code confirmed, how long each piece lasts, and who
-- joined once the Clear window is done.
ALTER TABLE payments.pay_sessions
  -- The phone or email the code confirmed, for a person with no account: Privy signs up with it.
  ADD COLUMN join_contact_enc        TEXT,
  -- Its hash, kept after joining: only the token for that contact gets the new member's token.
  ADD COLUMN join_contact_hash       TEXT,
  -- Step 1's basics are kept 30 minutes; the window's link lasts 15.
  ADD COLUMN join_expires_at         TIMESTAMPTZ,
  ADD COLUMN join_handoff_expires_at TIMESTAMPTZ,
  -- The new member's wallet, once the window hands back.
  ADD COLUMN join_wallet             TEXT,
  ADD CONSTRAINT pay_sessions_join_done CHECK ((join_state = 'done') = (join_wallet IS NOT NULL));
