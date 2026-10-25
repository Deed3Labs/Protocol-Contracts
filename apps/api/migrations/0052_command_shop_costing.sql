-- Command Center, Phase 10a: what goes into a product (docs/command-center-plan.md, "Phase 10").
-- A product's cost is made of inputs from one library, each line entered as an amount or as a cost.
-- The arithmetic is services/command/costing.ts. Money is in cents; a unit cost and a line's cost
-- keep fractions of a cent (12 ml at $0.0425/ml is 51¢, and 1 ml is 4.25¢), and are rounded to
-- cents only where they're shown or stored on an order. Quantities are NUMERIC.

-- The library: materials ("each", "m", "g", "ml"…), services bought per piece, and labour by the
-- hour. Only a material can be kept on hand (stocked); the rest are a cost per use. The unit cost
-- is set straight, or by a purchase (total ÷ quantity); NULL is "not known yet", which costs 0.
CREATE TABLE command.shop_inputs (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('material', 'service', 'labour')),
  unit            TEXT NOT NULL CHECK (unit ~ '^[a-z]{1,12}$'),
  stocked         BOOLEAN NOT NULL DEFAULT false,
  unit_cost_cents NUMERIC CHECK (unit_cost_cents >= 0),
  low_mark        NUMERIC CHECK (low_mark >= 0),
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ,
  CONSTRAINT shop_inputs_labour CHECK (kind <> 'labour' OR unit = 'h'),
  CONSTRAINT shop_inputs_stocked CHECK (kind = 'material' OR NOT stocked),
  CONSTRAINT shop_inputs_low CHECK (stocked OR low_mark IS NULL)
);

-- What was bought: "$164 for 20 blanks". Each is kept, so the unit cost has a history and stock has
-- a source. Recording one sets the input's unit cost, and for a stocked input adds a move.
CREATE TABLE command.shop_input_purchases (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  input_id    TEXT NOT NULL REFERENCES command.shop_inputs (id),
  at          TIMESTAMPTZ NOT NULL,
  quantity    NUMERIC NOT NULL CHECK (quantity > 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  supplier    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  who         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX shop_input_purchases_latest ON command.shop_input_purchases (input_id, at DESC, id DESC);

-- The stock ledger of the stocked inputs: + in, − out. On hand is the sum. `ref` is the purchase or
-- the run it came from (by reason); an adjustment or waste has none.
CREATE TABLE command.shop_input_moves (
  id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  input_id TEXT NOT NULL REFERENCES command.shop_inputs (id),
  at       TIMESTAMPTZ NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity <> 0),
  reason   TEXT NOT NULL CHECK (reason IN ('purchase', 'run', 'adjust', 'waste')),
  ref      INTEGER,
  note     TEXT NOT NULL DEFAULT '',
  CONSTRAINT shop_input_moves_ref CHECK ((reason IN ('purchase', 'run')) = (ref IS NOT NULL)),
  CONSTRAINT shop_input_moves_waste CHECK (reason <> 'waste' OR quantity < 0)
);
CREATE INDEX shop_input_moves_input ON command.shop_input_moves (input_id);

-- A product's recipe, one line an input. A line is stored as it was entered: an amount (input units
-- a product) or a cost a product, and the engine works out the other. If both are ever set, the
-- amount wins and the cost is worked out from it.
CREATE TABLE command.shop_recipe_lines (
  product_id TEXT NOT NULL REFERENCES command.shop_products (id),
  input_id   TEXT NOT NULL REFERENCES command.shop_inputs (id),
  position   INTEGER NOT NULL,
  amount     NUMERIC CHECK (amount > 0),
  cost_cents NUMERIC CHECK (cost_cents >= 0),
  -- which side was typed. A cost typed is stored with its amount whenever the input has a unit cost,
  -- so a later change to that cost flows through; with no unit cost yet, the amount comes when it does
  entered    TEXT NOT NULL DEFAULT 'amount' CHECK (entered IN ('amount', 'cost')),
  PRIMARY KEY (product_id, input_id),
  CONSTRAINT shop_recipe_lines_entered CHECK (amount IS NOT NULL OR cost_cents IS NOT NULL)
);
CREATE INDEX shop_recipe_lines_input ON command.shop_recipe_lines (input_id);

-- A line that differs by colour or size (an XXL blank, a second colour of thread), keyed as
-- shop_stock is: option and size, '' for "any". The most specific one wins: colour and size, then
-- size, then colour. Entered as an amount or a cost, as a line is.
CREATE TABLE command.shop_recipe_overrides (
  product_id TEXT NOT NULL,
  input_id   TEXT NOT NULL,
  option     TEXT NOT NULL DEFAULT '',
  size       TEXT NOT NULL DEFAULT '' CHECK (size IN ('', 'XS', 'S', 'M', 'L', 'XL', 'XXL')),
  amount     NUMERIC CHECK (amount > 0),
  cost_cents NUMERIC CHECK (cost_cents >= 0),
  entered    TEXT NOT NULL DEFAULT 'amount' CHECK (entered IN ('amount', 'cost')),
  PRIMARY KEY (product_id, input_id, option, size),
  FOREIGN KEY (product_id, input_id) REFERENCES command.shop_recipe_lines (product_id, input_id) ON DELETE CASCADE,
  CONSTRAINT shop_recipe_overrides_variant CHECK (option <> '' OR size <> ''),
  CONSTRAINT shop_recipe_overrides_entered CHECK (amount IS NOT NULL OR cost_cents IS NOT NULL)
);

-- Production runs: "made 12 Logo Tee · Short, Black M". A run uses up the stocked inputs by the
-- recipe (a 'run' move each) and adds the units to that colour and size's stock.
CREATE TABLE command.shop_runs (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id TEXT NOT NULL,
  option     TEXT NOT NULL,
  size       TEXT NOT NULL,
  units      INTEGER NOT NULL CHECK (units > 0),
  at         TIMESTAMPTZ NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  who        TEXT NOT NULL DEFAULT '',
  short      BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY (product_id, option, size) REFERENCES command.shop_stock (product_id, option, size)
);

-- What each order line cost when it sold, so past margins stay true when costs change. A table
-- beside the orders, not a column in them: an order's items stay as the shop sent them, a line's
-- cost is added once (Phase 10d, at ingest) and can be filled in later for older orders, and a
-- product's cost over time is one indexed read. `line` is the item's index in shop_orders.items;
-- `source` says whether it came from the recipe or the four cost boxes.
CREATE TABLE command.shop_order_costs (
  order_id        TEXT NOT NULL REFERENCES command.shop_orders (id),
  line            INTEGER NOT NULL CHECK (line >= 0),
  product_id      TEXT NOT NULL,
  option          TEXT NOT NULL DEFAULT '',
  size            TEXT NOT NULL DEFAULT '',
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  source          TEXT NOT NULL CHECK (source IN ('recipe', 'boxes', 'none')),
  costed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, line)
);
CREATE INDEX shop_order_costs_product ON command.shop_order_costs (product_id, costed_at);
