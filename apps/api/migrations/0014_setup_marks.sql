-- Set up the till (Home, owners and managers): which of the steps a shop has done that the rest of
-- its data can't show. Starting cash is marked when it's saved or a drawer is opened; tips and
-- discounts when either is saved or a code is made. Connecting cards, a reader, items and the team
-- are read from their own tables.
CREATE TABLE IF NOT EXISTS merchant.setup_marks (
  merchant   TEXT NOT NULL,
  mark       TEXT NOT NULL CHECK (mark IN ('cash', 'tips')),
  marked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant, mark)
);
