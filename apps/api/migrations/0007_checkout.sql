-- Checkout (card-processing prompt, Phase 6).

-- Prices before tax, or with tax included (Settings › Tax, "How prices show").
ALTER TABLE merchant.shop_settings ADD COLUMN prices_include_tax BOOLEAN NOT NULL DEFAULT false;

-- The rate for the shop's address, by kind of item, looked up once and kept: what sales carry
-- until the shop's own Stripe Tax is on. In millionths ("7.75%" is 77500). The address it was
-- looked up for, so a move looks it up again.
ALTER TABLE merchant.profiles
  ADD COLUMN tax_rates         JSONB,
  ADD COLUMN tax_rates_address TEXT,
  ADD COLUMN tax_rates_at      TIMESTAMPTZ;

ALTER TABLE commerce.order_lines
  -- The line's share of the order's discount; tax is on what's left.
  ADD COLUMN discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD CONSTRAINT order_lines_discount_within CHECK (discount_cents <= line_cents);

ALTER TABLE commerce.orders
  ADD COLUMN tax_included BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN tax_source TEXT NOT NULL DEFAULT 'none' CHECK (tax_source IN ('stripe','address_rate','none'));
