-- Command Center, Merchants: what kind of shop a pipeline card is, by where it sells. In person is a storefront,
-- so the card's street address is where Field's routes send someone; online is an e-commerce shop, which wants
-- Pay with Clear's API, so it has no stop on the routes. Every card so far was a storefront.
ALTER TABLE command.merchant_stage
  ADD COLUMN sells TEXT NOT NULL DEFAULT 'in_person' CHECK (sells IN ('in_person', 'online'));
