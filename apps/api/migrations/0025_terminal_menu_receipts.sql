-- Clear Terminal: the menu, receipt codes, a card paid from the phone page, and the drawer and table
-- settings (terminal reference, sections 4, 10, 11 and 12).

-- On the menu: what phones and Points show. Off still sells at the counter.
ALTER TABLE commerce.catalog_items ADD COLUMN IF NOT EXISTS on_menu BOOLEAN NOT NULL DEFAULT true;
-- The order categories show in. Categories are still the items' own names; one not listed sorts
-- after, A–Z.
CREATE TABLE IF NOT EXISTS commerce.category_order (
  merchant    TEXT PRIMARY KEY REFERENCES merchant.profiles (merchant),
  names       TEXT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A receipt's own code, for the sticker's QR (useclear.org/r/<code>): random, made once per order.
ALTER TABLE payments.receipts ADD COLUMN IF NOT EXISTS code TEXT UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$');
CREATE UNIQUE INDEX IF NOT EXISTS receipts_one_code ON payments.receipts (order_id) WHERE code IS NOT NULL;

-- A card paid on the phone page: a Stripe Checkout Session on the shop's account. The tender knows
-- its session until the payment it made comes back.
ALTER TABLE payments.tenders ADD COLUMN IF NOT EXISTS checkout_session_id TEXT UNIQUE;

-- Devices › Cash drawer, and Settings › Counter's Tables.
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS drawer_no_sale_roles TEXT NOT NULL DEFAULT 'managers'
  CHECK (drawer_no_sale_roles IN ('managers', 'anyone'));
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS no_sale_needs_pin BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS table_service BOOLEAN NOT NULL DEFAULT false;
