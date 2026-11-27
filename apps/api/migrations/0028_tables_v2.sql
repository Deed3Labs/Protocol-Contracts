-- Tables v2 (the terminal reference's new sections 8–8d, 14).
--
-- Who is at a table, from seated until cleared: a wait-list party's first name and size, or a
-- walk-in's (a null name). The tile says "Diaz, 4" or "Walk-in, 2".
ALTER TABLE merchant.tables ADD COLUMN IF NOT EXISTS party_name TEXT;
ALTER TABLE merchant.tables ADD COLUMN IF NOT EXISTS party_size INTEGER CHECK (party_size IS NULL OR party_size BETWEEN 1 AND 40);

-- Each visit, seated to cleared: wait estimates come from how long tables took this week.
CREATE TABLE IF NOT EXISTS merchant.table_visits (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL,
  table_id    TEXT NOT NULL REFERENCES merchant.tables (id),
  party_size  INTEGER,
  seated_at   TIMESTAMPTZ NOT NULL,
  cleared_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS table_visits_recent ON merchant.table_visits (merchant, cleared_at);

-- Settings › Counter's three rules. A null clear_paid_after_minutes is "By hand"; a null
-- wait_estimate_minutes is "From this week".
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS clear_paid_after_minutes INTEGER DEFAULT 10
  CHECK (clear_paid_after_minutes IS NULL OR clear_paid_after_minutes BETWEEN 1 AND 120);
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS wait_estimate_minutes INTEGER
  CHECK (wait_estimate_minutes IS NULL OR wait_estimate_minutes BETWEEN 1 AND 240);
ALTER TABLE merchant.shop_settings ADD COLUMN IF NOT EXISTS text_waitlist BOOLEAN NOT NULL DEFAULT true;
