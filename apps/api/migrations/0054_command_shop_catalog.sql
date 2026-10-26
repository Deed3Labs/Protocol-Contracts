-- Command Center, Phase 11a: Command runs the shop's catalog (docs/command-center-plan.md, "Phase 11").
-- The store's catalog moves here from the website's content file. Command keeps what an owner
-- changes; the site keeps how a product is drawn (its plate, renders and CAD sheets), by slug.
-- A product is the site's until it's imported (in_catalog): from then on Command's record is the
-- catalog, served at /api/command/catalog. The rest of a product (its shelf label, line, glyph,
-- costs, stock) is Command's as before.

ALTER TABLE command.shop_products
  ADD COLUMN in_catalog    BOOLEAN NOT NULL DEFAULT false,
  -- 'goods' sit on the shelf; 'for-shops' is the hardware, reserved with a deposit
  ADD COLUMN section       TEXT NOT NULL DEFAULT 'goods' CHECK (section IN ('goods', 'for-shops')),
  -- what the site draws it as ('tee', 'hoodie', 'point'…); NULL for a product the site doesn't sell
  ADD COLUMN kind          TEXT,
  -- the name the store shows ("Logo Long-Sleeve Tee"); `name` and `variant` stay Command's shelf labels
  ADD COLUMN title         TEXT,
  -- the line under the name
  ADD COLUMN tagline       TEXT NOT NULL DEFAULT '',
  ADD COLUMN description   TEXT NOT NULL DEFAULT '',
  ADD COLUMN details       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN category      TEXT NOT NULL DEFAULT '',
  ADD COLUMN also_in       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN featured      BOOLEAN NOT NULL DEFAULT false,
  -- the variant picker's label ("Size"); NULL for a one-size product
  ADD COLUMN variant_label TEXT,
  -- packed weight of one unit, for the shipping quote
  ADD COLUMN weight_oz     NUMERIC CHECK (weight_oz IS NULL OR weight_oz > 0),
  -- the month it ships, as shown ("Jan 2027"): goods made in one run, or hardware reserved now
  ADD COLUMN ships         TEXT,
  -- hardware awaiting FCC equipment authorization, and its notice
  ADD COLUMN fcc           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN fcc_notice    TEXT,
  -- the founding-partner note under the reserve button
  ADD COLUMN founding      TEXT,
  -- photographs, in order: [{ src, alt }]
  ADD COLUMN images        JSONB NOT NULL DEFAULT '[]';

-- A garment's colours, in display order (the first is the default). The swatch is product data; the
-- tone is the ground the site draws it on.
CREATE TABLE command.shop_colours (
  product_id TEXT NOT NULL REFERENCES command.shop_products (id) ON DELETE CASCADE,
  id         TEXT NOT NULL CHECK (id ~ '^[a-z0-9-]+$'),
  position   INTEGER NOT NULL,
  label      TEXT NOT NULL,
  swatch     TEXT NOT NULL CHECK (swatch ~ '^#[0-9A-Fa-f]{6}$'),
  tone       TEXT NOT NULL CHECK (tone IN ('ink', 'land', 'paper')),
  fill       BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, id)
);

-- What a buyer picks: a garment's colour × size ("black-m"), a hardware size ("counter"), a patch's
-- shape. Its price overrides the product's; a deposit is what a reservation holds now; `per` replaces
-- "each" after the price ("for ten").
CREATE TABLE command.shop_variants (
  product_id    TEXT NOT NULL REFERENCES command.shop_products (id) ON DELETE CASCADE,
  id            TEXT NOT NULL CHECK (id ~ '^[a-z0-9-]+$'),
  position      INTEGER NOT NULL,
  label         TEXT NOT NULL,
  colour        TEXT,
  size          TEXT,
  price_cents   INTEGER CHECK (price_cents IS NULL OR price_cents > 0),
  deposit_cents INTEGER CHECK (deposit_cents IS NULL OR deposit_cents > 0),
  per           TEXT,
  sold_out      BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, id)
);

-- Slugs that changed, old → new: the site redirects the old pages, and a saved bag or an order made
-- under the old slug still finds its product.
CREATE TABLE command.shop_moved (
  old_slug TEXT PRIMARY KEY,
  new_slug TEXT NOT NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
