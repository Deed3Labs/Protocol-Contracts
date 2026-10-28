-- Command Center redesign, Shop: a product costed at one flat cost, and batches.

-- One flat cost instead of materials (a quote before the sample, hardware not built yet), with whether
-- it's an estimate and a note. Set, it's the product's cost, over a recipe and the four cost boxes; the
-- recipe stays for when it's cleared. The boxes (shop_products.cost_cents) are kept as they are: with
-- neither a flat cost nor a recipe, they're the cost, as before.
ALTER TABLE command.shop_products
  ADD COLUMN flat_cost_cents NUMERIC CHECK (flat_cost_cents >= 0),
  ADD COLUMN cost_estimate   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cost_note       TEXT NOT NULL DEFAULT '';

-- A colour's or size's own flat cost, keyed as shop_stock is ('' is any). The most specific one wins.
CREATE TABLE command.shop_flat_overrides (
  product_id TEXT NOT NULL REFERENCES command.shop_products (id) ON DELETE CASCADE,
  option     TEXT NOT NULL DEFAULT '',
  size       TEXT NOT NULL DEFAULT '' CHECK (size IN ('', 'XS', 'S', 'M', 'L', 'XL', 'XXL')),
  cost_cents NUMERIC NOT NULL CHECK (cost_cents >= 0),
  PRIMARY KEY (product_id, option, size),
  CONSTRAINT shop_flat_overrides_variant CHECK (option <> '' OR size <> '')
);

-- An order line's cost can come from the flat cost now.
ALTER TABLE command.shop_order_costs DROP CONSTRAINT shop_order_costs_source_check;
ALTER TABLE command.shop_order_costs ADD CONSTRAINT shop_order_costs_source_check CHECK (source IN ('recipe', 'boxes', 'flat', 'none'));

-- Batches. A run is one colour and size; a batch is the runs that share a batch_id ("B-012"), planned
-- first or made straight away. A planned run uses nothing and adds nothing until it's done; done, its
-- unit cost is locked as it was then, so the batch's cost stays true when costs change. Runs from before
-- this were done, their unit cost not kept.
ALTER TABLE command.shop_runs
  ADD COLUMN state           TEXT NOT NULL DEFAULT 'done' CHECK (state IN ('planned', 'done')),
  ADD COLUMN unit_cost_cents INTEGER CHECK (unit_cost_cents >= 0),
  ADD COLUMN batch_id        TEXT,
  ADD COLUMN planned_on      DATE;
CREATE INDEX shop_runs_batch ON command.shop_runs (batch_id);
CREATE SEQUENCE command.shop_batch_number START 1;
