-- Command Center, Phase 3d: the rows behind Shop (docs/command-center-plan.md).
-- Live sources (Phase 7): the catalog from clearpath-website's content/shop.ts, orders and refunds from
-- Stripe (a restricted read-only key). Stock has no other home, so it lives here. The seed writes the
-- prototype's.

-- The catalog: what shows on useclear.org/shop. Hardware is a refundable deposit, merchants only.
-- cost_cents is one item's cost: the blank or base, making, label, packing.
CREATE TABLE command.shop_products (
  id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9]+$'),
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  variant     TEXT NOT NULL,
  line        TEXT NOT NULL CHECK (line IN ('logo', 'graphic', 'layers', 'patch', 'hw')),
  glyph       TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  cost_cents  INTEGER[] CHECK (cost_cents IS NULL OR cardinality(cost_cents) = 4),
  status      TEXT NOT NULL CHECK (status IN ('on', 'off', 'draft', 'arch')),
  options     TEXT[] NOT NULL,
  lead_weeks  INTEGER,
  slug        TEXT NOT NULL UNIQUE,
  why         TEXT,
  deposit     BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT shop_products_cost CHECK (deposit OR cost_cents IS NOT NULL)
);

-- Stock on hand by product, colour (or option) and size; size is '' for one size.
CREATE TABLE command.shop_stock (
  product_id TEXT NOT NULL REFERENCES command.shop_products (id),
  option     TEXT NOT NULL,
  option_pos INTEGER NOT NULL,
  size       TEXT NOT NULL CHECK (size IN ('', 'XS', 'S', 'M', 'L', 'XL', 'XXL')),
  size_pos   INTEGER NOT NULL,
  on_hand    INTEGER NOT NULL CHECK (on_hand >= 0),
  PRIMARY KEY (product_id, option, size)
);

-- Each product's time on and off the shelf. A null start is "from now" (a planned period); a null
-- end is "still".
CREATE TABLE command.shop_shelf (
  product_id TEXT NOT NULL REFERENCES command.shop_products (id),
  position   INTEGER NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('on', 'off', 'draft', 'proj')),
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  PRIMARY KEY (product_id, position)
);

-- What happened to a product, by whom.
CREATE TABLE command.shop_history (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES command.shop_products (id),
  at         TIMESTAMPTZ NOT NULL,
  what       TEXT NOT NULL,
  who        TEXT NOT NULL
);

-- Recent orders. Personal: the buyer is kept as a first name and last initial, the city is theirs,
-- and neither leaves the API at Totals. Addresses are never stored here; packing reads them from
-- Stripe. items: [product, colour, size, quantity].
CREATE TABLE command.shop_orders (
  id         TEXT PRIMARY KEY CHECK (id ~ '^[0-9]+$'),
  paid_at    TIMESTAMPTZ NOT NULL,
  buyer      TEXT NOT NULL,
  member     BOOLEAN NOT NULL,
  items      JSONB NOT NULL,
  paid_with  TEXT NOT NULL CHECK (paid_with IN ('clear', 'card', 'wallet')),
  fulfilment TEXT NOT NULL CHECK (fulfilment IN ('ship', 'pickup')),
  pickup_at  TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL CHECK (state IN ('paid', 'packed', 'shipped', 'ready', 'done', 'picked', 'refund')),
  city       TEXT NOT NULL,
  CONSTRAINT shop_orders_pickup CHECK (fulfilment = 'ship' OR pickup_at <> '')
);

-- Hardware pre-orders from shops: the deposit is held, or the shop still needs to sign up or sign.
CREATE TABLE command.shop_preorders (
  id         TEXT PRIMARY KEY,
  shop       TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES command.shop_products (id),
  option     TEXT NOT NULL DEFAULT '',
  units      INTEGER NOT NULL CHECK (units > 0),
  state      TEXT NOT NULL CHECK (state IN ('held', 'signup', 'agreement')),
  placed_at  TIMESTAMPTZ NOT NULL
);

-- Ordered and planned stock: each batch's stages ([kind, from, to], a null from is "from now") and
-- when it lands.
CREATE TABLE command.shop_incoming (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position    INTEGER NOT NULL,
  what        TEXT NOT NULL,
  units_label TEXT NOT NULL,
  stages      JSONB NOT NULL,
  lands       TEXT NOT NULL,
  product_id  TEXT NOT NULL REFERENCES command.shop_products (id)
);

-- Returns and their refunds. Over $50.00 needs a second person: who proposed it, who approves it, and
-- the refund once paid.
CREATE TABLE command.shop_returns (
  order_id      TEXT PRIMARY KEY,
  item          TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('Wrong size', 'Damaged in shipping', 'Changed their mind')),
  returned_on   TIMESTAMPTZ NOT NULL,
  condition     TEXT NOT NULL DEFAULT '',
  proposed_by   TEXT NOT NULL,
  proposed_at   TIMESTAMPTZ NOT NULL,
  second_person TEXT,
  refunded_at   TIMESTAMPTZ,
  amount_cents  INTEGER CHECK (amount_cents > 0),
  CONSTRAINT shop_returns_refunded CHECK ((refunded_at IS NULL) = (amount_cents IS NULL))
);
