-- Command Center redesign, Shop: suppliers, their price breaks, and buys ordered but not here yet.
-- Until now a supplier was free text on a purchase; that text stays, beside the supplier it names.

-- Who sells the shop what: lead time in days, payment terms and the minimum order as they say them.
CREATE TABLE command.shop_suppliers (
  id         TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name       TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT '',
  -- what they sell, as a line ("Tees, long sleeves and turtlenecks")
  sells      TEXT NOT NULL DEFAULT '',
  lead_days  INTEGER CHECK (lead_days >= 0),
  terms      TEXT NOT NULL DEFAULT '',
  minimum    TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Price breaks: from this many units, this much off the list price (0.04 is 4%). The first is usually
-- the minimum at list price.
CREATE TABLE command.shop_supplier_breaks (
  supplier_id TEXT NOT NULL REFERENCES command.shop_suppliers (id) ON DELETE CASCADE,
  quantity    NUMERIC NOT NULL CHECK (quantity > 0),
  discount    NUMERIC NOT NULL CHECK (discount >= 0 AND discount < 1),
  PRIMARY KEY (supplier_id, quantity)
);

ALTER TABLE command.shop_inputs ADD COLUMN supplier_id TEXT REFERENCES command.shop_suppliers (id);

-- A buy can be ordered before it's here: it changes neither stock nor the average until it's received.
-- Every purchase before this was received when it was recorded. received_at is when it came (a received
-- row without one came at `at`, as every older row did).
ALTER TABLE command.shop_input_purchases
  ADD COLUMN supplier_id TEXT REFERENCES command.shop_suppliers (id),
  ADD COLUMN state       TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('ordered', 'received', 'cancelled')),
  ADD COLUMN due_on      DATE,
  ADD COLUMN received_at TIMESTAMPTZ;
UPDATE command.shop_input_purchases SET received_at = at;
CREATE INDEX shop_input_purchases_ordered ON command.shop_input_purchases (input_id) WHERE state = 'ordered';
