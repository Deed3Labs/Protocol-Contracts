-- Command Center, the redesign (docs/ui-redesign-plan.md, Gaps → Merchants): the records the Merchants
-- page keeps that nothing held before. The payout runs a second person approved, the refurb line's
-- units, the shop and ship month of each hardware pre-order, and what was done with each shop enquiry.

-- A NET-30 payout run once a second person has approved it: the month of sales it pays, when it goes,
-- each shop's line and the total. Until it's approved a run is only its proposal (command.proposals,
-- the action merchants/run), which the page reads for proposed and sent back; it's sent when its
-- outbox row goes to the Ops Safe, and marked paid here once the Safe has executed it. One run a month.
CREATE TABLE command.payout_runs (
  proposal_id UUID PRIMARY KEY REFERENCES command.proposals (id),
  period      TEXT NOT NULL UNIQUE CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  goes_on     DATE NOT NULL,
  -- [{id, name, sales, fee, red, total}], as the run's table drew it when it was proposed
  lines       JSONB NOT NULL DEFAULT '[]',
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  shops       INTEGER NOT NULL CHECK (shops >= 0),
  proposed_by UUID NOT NULL REFERENCES command.people (id),
  proposed_at TIMESTAMPTZ NOT NULL,
  approved_by UUID NOT NULL REFERENCES command.people (id),
  approved_at TIMESTAMPTZ NOT NULL,
  paid_at     TIMESTAMPTZ,
  paid_by     UUID REFERENCES command.people (id),
  CONSTRAINT payout_runs_second_person CHECK (approved_by <> proposed_by),
  CONSTRAINT payout_runs_paid CHECK ((paid_at IS NULL) = (paid_by IS NULL))
);

-- The refurb line: used units bought, repaired, tested, ready, then shipped to a shop. Its shop is the
-- merchant app's (its address) or a pipeline card's, with the name it had then; a unit ships only to one.
CREATE TABLE command.refurb_units (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model      TEXT NOT NULL CHECK (model <> ''),
  serial     TEXT NOT NULL DEFAULT '',
  stage      TEXT NOT NULL DEFAULT 'bought' CHECK (stage IN ('bought', 'repair', 'testing', 'ready', 'shipped')),
  -- what the unit cost, bought and repaired, when it's known
  cost_cents INTEGER CHECK (cost_cents >= 0),
  shop_id    TEXT,
  shop_name  TEXT,
  ships_on   DATE,
  note       TEXT NOT NULL DEFAULT '',
  added_by   TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL,
  moved_at   TIMESTAMPTZ NOT NULL,
  shipped_at TIMESTAMPTZ,
  CONSTRAINT refurb_units_shipped CHECK ((stage = 'shipped') = (shipped_at IS NOT NULL)),
  CONSTRAINT refurb_units_shipped_to CHECK (stage <> 'shipped' OR shop_name IS NOT NULL),
  CONSTRAINT refurb_units_shop CHECK ((shop_id IS NULL) = (shop_name IS NULL))
);

-- A pre-order's shop (its org wallet, as the site's shop sign-in names it) and the month it ships, as
-- the reservation carries them (clearpath-website lib/shop/order.ts). Rows the shop feed read before
-- keep them empty until a sync reads their payment again; the ship month falls back to the product's.
ALTER TABLE command.shop_live_preorders ADD COLUMN shop_id TEXT, ADD COLUMN ships TEXT;

-- Shop enquiries: what they asked (the join form's note, kept for every answer now) and what was done:
-- answered, added to the pipeline (the card it became) or turned down (and why), by whom and when.
ALTER TABLE command.form_submissions ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE command.form_submissions ADD COLUMN card_id TEXT, ADD COLUMN why TEXT NOT NULL DEFAULT '', ADD COLUMN handled_by TEXT, ADD COLUMN handled_at TIMESTAMPTZ;
ALTER TABLE command.form_submissions DROP CONSTRAINT form_submissions_status_check;
ALTER TABLE command.form_submissions ADD CONSTRAINT form_submissions_status_check CHECK (status IN ('New', 'Replied', 'Invited', 'Added', 'Not a fit'));
