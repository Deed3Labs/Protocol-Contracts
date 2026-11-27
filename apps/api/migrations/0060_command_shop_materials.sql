-- Command Center redesign, Shop (docs/ui-redesign-plan.md, decision 4 and the Shop gaps): the materials
-- library gets the reference's three kinds, an average cost beside the last price paid, and extras by
-- size or colour. New tables start empty: live shows only what someone records.

-- The three kinds, from what's stored: kept on hand (stocked), made to order (not stocked: a material
-- bought per piece, a service, labour) and once per order (per_order: packing for the whole order, which
-- may also be counted on hand, like mailers). on_pickup: used on an order that's picked up too (tissue
-- is; the mailer and the postage label aren't).
ALTER TABLE command.shop_inputs
  ADD COLUMN per_order BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN on_pickup BOOLEAN NOT NULL DEFAULT false,
  -- the last price paid a unit. unit_cost_cents stays the cost the engine uses: for a stocked input it's
  -- now the average of what's on hand (services/command/costing.ts, averageAfter)
  ADD COLUMN last_cost_cents NUMERIC CHECK (last_cost_cents >= 0),
  ADD CONSTRAINT shop_inputs_pickup CHECK (per_order OR NOT on_pickup);

-- The last price paid, from each input's newest purchase. The average starts as the unit cost it had,
-- so no product's cost changes until the next buy.
UPDATE command.shop_inputs i SET last_cost_cents = p.total_cents::numeric / p.quantity
FROM (SELECT DISTINCT ON (input_id) input_id, total_cents, quantity FROM command.shop_input_purchases ORDER BY input_id, at DESC, id DESC) p
WHERE p.input_id = i.id;

-- Extras: what a size or a colour adds to one unit of an input (an XXL blank +$1.20, Cobalt +$0.40), for
-- every product that uses it. One row is one size or one colour; a size's and a colour's extras add up.
-- A product's own override of the line (shop_recipe_overrides) wins over them.
CREATE TABLE command.shop_input_extras (
  input_id    TEXT NOT NULL REFERENCES command.shop_inputs (id),
  option      TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '' CHECK (size IN ('', 'XS', 'S', 'M', 'L', 'XL', 'XXL')),
  extra_cents NUMERIC NOT NULL CHECK (extra_cents >= 0),
  PRIMARY KEY (input_id, option, size),
  CONSTRAINT shop_input_extras_one CHECK ((option = '') <> (size = ''))
);

-- Packing used when an order is packed: a stock move of its own, its ref the order's number.
ALTER TABLE command.shop_input_moves DROP CONSTRAINT shop_input_moves_reason_check;
ALTER TABLE command.shop_input_moves ADD CONSTRAINT shop_input_moves_reason_check CHECK (reason IN ('purchase', 'run', 'adjust', 'waste', 'order'));
ALTER TABLE command.shop_input_moves DROP CONSTRAINT shop_input_moves_ref;
ALTER TABLE command.shop_input_moves ADD CONSTRAINT shop_input_moves_ref CHECK ((reason IN ('purchase', 'run', 'order')) = (ref IS NOT NULL));
