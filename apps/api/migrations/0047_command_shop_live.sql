-- Command Center, Phase 7a: the shop, live and read-only (docs/command-center-plan.md).

-- Two more feeds: the shop's own Stripe account (a restricted, read-only key) and the site's catalog.
ALTER TABLE command.feeds DROP CONSTRAINT feeds_id_check;
ALTER TABLE command.feeds ADD CONSTRAINT feeds_id_check CHECK (id IN ('plaid', 'bridge', 'lithic', 'stripe', 'shop', 'catalog'));
INSERT INTO command.feeds (id) VALUES ('shop'), ('catalog');

-- Orders from the shop's Stripe Checkout land with the seed's, marked by where they came from. Command
-- numbers them; packing and shipping stay Command's own (the sync never moves an order back). No
-- address is kept: "pack" reads it from Stripe for that order.
ALTER TABLE command.shop_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'stripe'));
ALTER TABLE command.shop_orders ADD COLUMN stripe_session TEXT UNIQUE;
ALTER TABLE command.shop_orders ADD COLUMN payment_intent TEXT;
ALTER TABLE command.shop_orders ADD COLUMN total_cents INTEGER;
ALTER TABLE command.shop_orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE command.shop_orders ADD CONSTRAINT shop_orders_stripe CHECK ((source = 'stripe') = (stripe_session IS NOT NULL));
CREATE SEQUENCE command.shop_order_number START 1001;

-- Hardware reserved through the shop: one row a reserved line, by the site's product slug (the
-- catalog is the site's, so these don't point at Command's product rows).
CREATE TABLE command.shop_live_preorders (
  payment_intent TEXT NOT NULL,
  line           INTEGER NOT NULL,
  shop           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  variant        TEXT NOT NULL,
  units          INTEGER NOT NULL CHECK (units > 0),
  deposit_cents  INTEGER NOT NULL,
  state          TEXT NOT NULL,
  placed_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (payment_intent, line)
);
