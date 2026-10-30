-- Command Center, Merchants: how a pipeline card's shop is reached. In person is a walk-in, so the card's
-- street address is where Field's routes send someone; online is worked by email, phone or video and stays
-- off the routes. Every card so far was added as a walk-in.
ALTER TABLE command.merchant_stage
  ADD COLUMN reach TEXT NOT NULL DEFAULT 'in_person' CHECK (reach IN ('in_person', 'online'));
