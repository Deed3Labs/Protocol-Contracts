-- Command Center redesign, Shop: what an order costs once (its packing, the postage label against the
-- shipping charged, the card fee), and pickup points.

-- Partner shops that hold orders for pickup. How long one holds an order is Settings' `hold`.
CREATE TABLE command.shop_pickup_points (
  id         TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where a pickup order is held, and since when (the hold runs from ready). pickup_at stays the label the
-- order shows. shipping_cents: what the buyer was charged for shipping, when the checkout says.
ALTER TABLE command.shop_orders
  ADD COLUMN pickup_point   TEXT REFERENCES command.shop_pickup_points (id),
  ADD COLUMN ready_at       TIMESTAMPTZ,
  ADD COLUMN shipping_cents INTEGER CHECK (shipping_cents >= 0);

-- What an order cost once, beside its lines' costs (shop_order_costs), recorded when it comes in so past
-- margins stay true: the once-per-order inputs at their cost then ([[input, cents]]), the shipping charged
-- and the label it took (null until it's bought), and the card fee. Whole cents.
CREATE TABLE command.shop_order_overheads (
  order_id       TEXT PRIMARY KEY REFERENCES command.shop_orders (id),
  fulfilment     TEXT NOT NULL CHECK (fulfilment IN ('ship', 'pickup')),
  supplies       JSONB NOT NULL DEFAULT '[]',
  supplies_cents INTEGER NOT NULL CHECK (supplies_cents >= 0),
  charged_cents  INTEGER NOT NULL DEFAULT 0 CHECK (charged_cents >= 0),
  label_cents    INTEGER CHECK (label_cents >= 0),
  fee_cents      INTEGER NOT NULL CHECK (fee_cents >= 0),
  costed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
