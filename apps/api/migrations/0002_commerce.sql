-- The catalogue, stock, discount codes and orders (card-processing prompt, Phase 2: `commerce`).
--
-- Every table carries `merchant` (the shop's wallet address, as elsewhere in this database) so a
-- query can always be scoped to one shop. Staff are soft references to merchant.staff.

CREATE SCHEMA commerce;

-- A trigger function for tables that are history: nothing edits or deletes a row.
CREATE FUNCTION commerce.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: record a new row instead', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TABLE commerce.catalog_items (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  name          TEXT NOT NULL CHECK (length(name) > 0),
  detail        TEXT,
  category      TEXT NOT NULL CHECK (length(category) > 0),
  price_cents   BIGINT NOT NULL CHECK (price_cents >= 0),
  cost_cents    BIGINT CHECK (cost_cents >= 0),
  -- Maps to a Stripe tax code on the server.
  tax_kind      TEXT NOT NULL CHECK (tax_kind IN ('goods','labour','food','exempt')),
  stock_tracked BOOLEAN NOT NULL DEFAULT false,
  reorder_at    INTEGER CHECK (reorder_at >= 0),
  created_by    TEXT REFERENCES merchant.staff (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Archived, never deleted: old orders still point at it.
  archived_at   TIMESTAMPTZ
);
CREATE INDEX catalog_items_merchant ON commerce.catalog_items (merchant, category) WHERE archived_at IS NULL;

CREATE TABLE commerce.option_groups (
  id       TEXT PRIMARY KEY,
  item_id  TEXT NOT NULL REFERENCES commerce.catalog_items (id) ON DELETE CASCADE,
  name     TEXT NOT NULL CHECK (length(name) > 0),
  rule     TEXT NOT NULL CHECK (rule IN ('one','any')),
  required BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL CHECK (position >= 0)
);
CREATE INDEX option_groups_item ON commerce.option_groups (item_id, position);

CREATE TABLE commerce.options (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES commerce.option_groups (id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  -- The price change, which may be negative.
  delta_cents BIGINT NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL CHECK (position >= 0)
);
CREATE INDEX options_group ON commerce.options (group_id, position);

CREATE TABLE commerce.reorders (
  id                TEXT PRIMARY KEY,
  merchant          TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  item_id           TEXT NOT NULL REFERENCES commerce.catalog_items (id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  supplier          TEXT,
  expected_on       DATE,
  -- Kept in step with the 'receive' movements that reference this reorder, in the same transaction.
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partly_received','received','cancelled')),
  created_by        TEXT REFERENCES merchant.staff (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reorders_merchant ON commerce.reorders (merchant, status);

CREATE TABLE commerce.discount_codes (
  id                 TEXT PRIMARY KEY,
  merchant           TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  code               TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 24),
  percent            INTEGER CHECK (percent BETWEEN 1 AND 100),
  amount_cents       BIGINT CHECK (amount_cents > 0),
  -- NULL: everything. Otherwise items in these categories.
  applies_to         TEXT[] CHECK (applies_to IS NULL OR cardinality(applies_to) > 0),
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  once_per_customer  BOOLEAN NOT NULL DEFAULT false,
  created_by         TEXT REFERENCES merchant.staff (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at        TIMESTAMPTZ,
  CHECK ((percent IS NULL) <> (amount_cents IS NULL)),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
-- Uses are counted from order_discounts, not stored, so they can't drift.
CREATE UNIQUE INDEX discount_codes_code ON commerce.discount_codes (merchant, upper(code)) WHERE archived_at IS NULL;

CREATE TABLE commerce.orders (
  id             TEXT PRIMARY KEY,
  merchant       TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  -- For call-outs ("number 14"), where the shop uses them.
  number         INTEGER CHECK (number > 0),
  name           TEXT,
  raised_by      TEXT NOT NULL REFERENCES merchant.staff (id),
  customer       TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','paying','paid','voided','refunded','partly_refunded')),
  subtotal_cents BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents),
  tax_cents      BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    BIGINT NOT NULL DEFAULT 0,
  -- The sum of its tenders' tips, for display. Tips ride on tenders.
  tip_cents      BIGINT NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  -- The shop's day, in its own timezone.
  business_date  DATE NOT NULL,
  -- The Stripe Tax calculation the figures came from, when there was one.
  tax_calculation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_by      TEXT REFERENCES merchant.staff (id),
  voided_at      TIMESTAMPTZ,
  CHECK (total_cents = subtotal_cents - discount_cents + tax_cents),
  CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);
CREATE INDEX orders_day ON commerce.orders (merchant, business_date, created_at DESC);
CREATE INDEX orders_open ON commerce.orders (merchant, status) WHERE status IN ('open','paying');
CREATE UNIQUE INDEX orders_number ON commerce.orders (merchant, business_date, number) WHERE number IS NOT NULL;

CREATE TABLE commerce.order_lines (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES commerce.orders (id),
  -- NULL for a quick sale: a one-off amount with a note and a tax kind, and no stock.
  item_id    TEXT REFERENCES commerce.catalog_items (id),
  -- A snapshot of the name and price as they were, so a later price change doesn't rewrite a sale.
  name       TEXT NOT NULL CHECK (length(name) > 0),
  note       TEXT,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_cents BIGINT NOT NULL CHECK (unit_cents >= 0),
  -- [{groupId, optionId, name, deltaCents}], as chosen.
  options    JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array'),
  line_cents BIGINT NOT NULL,
  tax_kind   TEXT NOT NULL CHECK (tax_kind IN ('goods','labour','food','exempt')),
  tax_cents  BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  position   INTEGER NOT NULL DEFAULT 0,
  -- Changing an open order marks lines removed rather than deleting them: their stock holds point
  -- at them, and a release has to point at the same line.
  removed_at TIMESTAMPTZ,
  CHECK (line_cents = unit_cents * quantity)
);
CREATE INDEX order_lines_order ON commerce.order_lines (order_id, position) WHERE removed_at IS NULL;

-- One live discount per order. Removing it keeps the row, marked removed.
CREATE TABLE commerce.order_discounts (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES commerce.orders (id),
  kind         TEXT NOT NULL CHECK (kind IN ('code','manual')),
  code_id      TEXT REFERENCES commerce.discount_codes (id),
  label        TEXT NOT NULL,
  percent      INTEGER CHECK (percent BETWEEN 1 AND 100),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  reason       TEXT,
  applied_by   TEXT NOT NULL REFERENCES merchant.staff (id),
  -- Set when it was over the applier's limit and a manager or owner approved it with their PIN.
  approved_by  TEXT REFERENCES merchant.staff (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at   TIMESTAMPTZ,
  CHECK ((kind = 'code') = (code_id IS NOT NULL)),
  CHECK (kind = 'code' OR reason IS NOT NULL),
  CHECK (approved_by IS NULL OR approved_by <> applied_by)
);
CREATE UNIQUE INDEX order_discounts_one_live ON commerce.order_discounts (order_id) WHERE removed_at IS NULL;
CREATE INDEX order_discounts_code ON commerce.order_discounts (code_id) WHERE code_id IS NOT NULL;

-- Stock is movements. On hand, held and free are sums over this table (commerce.stock_levels),
-- never a number someone edits.
--
--   receive, return   +   on hand
--   damage, sell      −   on hand
--   count             ±   on hand (the difference the count found)
--   hold              +   held (an open order has it)
--   release           −   held (the order was paid, changed or voided)
--
-- A sale is a release and a sell together; a void is a release alone.
CREATE TABLE commerce.stock_movements (
  id            TEXT PRIMARY KEY,
  merchant      TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  item_id       TEXT NOT NULL REFERENCES commerce.catalog_items (id),
  kind          TEXT NOT NULL CHECK (kind IN ('receive','count','damage','hold','release','sell','return')),
  quantity      INTEGER NOT NULL CHECK (quantity <> 0),
  reason        TEXT,
  order_line_id TEXT REFERENCES commerce.order_lines (id),
  reorder_id    TEXT REFERENCES commerce.reorders (id),
  actor         TEXT REFERENCES merchant.staff (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (CASE kind
    WHEN 'receive' THEN quantity > 0
    WHEN 'return'  THEN quantity > 0
    WHEN 'hold'    THEN quantity > 0
    WHEN 'damage'  THEN quantity < 0
    WHEN 'sell'    THEN quantity < 0
    WHEN 'release' THEN quantity < 0
    ELSE true END),
  CHECK (kind NOT IN ('hold','release','sell') OR order_line_id IS NOT NULL)
);
CREATE INDEX stock_movements_item ON commerce.stock_movements (item_id, created_at);
CREATE INDEX stock_movements_line ON commerce.stock_movements (order_line_id) WHERE order_line_id IS NOT NULL;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON commerce.stock_movements
  FOR EACH ROW EXECUTE FUNCTION commerce.refuse_change();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON commerce.stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION commerce.refuse_change();

CREATE VIEW commerce.stock_levels AS
  SELECT i.id AS item_id,
         i.merchant,
         COALESCE(SUM(m.quantity) FILTER (WHERE m.kind NOT IN ('hold','release')), 0)::INTEGER AS on_hand,
         COALESCE(SUM(m.quantity) FILTER (WHERE m.kind IN ('hold','release')), 0)::INTEGER     AS held,
         (COALESCE(SUM(m.quantity) FILTER (WHERE m.kind NOT IN ('hold','release')), 0)
           - COALESCE(SUM(m.quantity) FILTER (WHERE m.kind IN ('hold','release')), 0))::INTEGER AS free
    FROM commerce.catalog_items i
    LEFT JOIN commerce.stock_movements m ON m.item_id = i.id
   WHERE i.stock_tracked
   GROUP BY i.id, i.merchant;
