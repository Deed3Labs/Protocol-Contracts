-- Settings › Shop: what members see in Clear Partners (a line about the shop, how to reach it) and
-- when it's open, and Settings › Counter's breaks. Staff hours sit inside the shop's hours, and the
-- member app's "open now" reads them.

ALTER TABLE merchant.profiles
  -- The lazy store (src/config/merchantDb.ts) already has category; a database made from these
  -- migrations alone gets it here.
  ADD COLUMN IF NOT EXISTS category      TEXT,
  ADD COLUMN IF NOT EXISTS listing_line  TEXT CHECK (char_length(listing_line) <= 140),
  ADD COLUMN IF NOT EXISTS contact_phone TEXT CHECK (char_length(contact_phone) <= 40),
  ADD COLUMN IF NOT EXISTS contact_email TEXT CHECK (char_length(contact_email) <= 200);

-- The usual week: one row per open day (0 is Monday). A day with no row is closed.
CREATE TABLE merchant.shop_hours (
  merchant TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  weekday  SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens    TIME NOT NULL,
  closes   TIME NOT NULL CHECK (closes > opens),
  PRIMARY KEY (merchant, weekday)
);

-- A date that differs: closed all day (no times), or open other hours ("until noon").
CREATE TABLE merchant.shop_closures (
  merchant TEXT NOT NULL REFERENCES merchant.profiles (merchant),
  on_date  DATE NOT NULL,
  label    TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  opens    TIME,
  closes   TIME,
  CHECK ((opens IS NULL) = (closes IS NULL) AND (opens IS NULL OR closes > opens)),
  PRIMARY KEY (merchant, on_date)
);

-- Breaks: how long, and after how long on shift. Home shows who is due one; it isn't a timesheet.
ALTER TABLE merchant.shop_settings
  ADD COLUMN IF NOT EXISTS break_minutes       INTEGER NOT NULL DEFAULT 30  CHECK (break_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS break_after_minutes INTEGER NOT NULL DEFAULT 300 CHECK (break_after_minutes BETWEEN 60 AND 960);
