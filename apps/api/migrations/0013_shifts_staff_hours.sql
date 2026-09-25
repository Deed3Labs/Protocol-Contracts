-- Shifts, breaks and staff hours (merchant UI: Staff and Home).
--
-- A shift starts when someone's PIN goes in on the tablet and ends with End shift. At most one open
-- shift a person. A shift nobody ended is closed by the next read after its day, at the shop's
-- closing time (or eight hours in), and marked auto_ended so hours can say so.

CREATE TABLE IF NOT EXISTS merchant.shifts (
  id          TEXT PRIMARY KEY,
  merchant    TEXT NOT NULL,
  staff_id    TEXT NOT NULL,
  device_id   TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  ended_by    TEXT,
  auto_ended  BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open ON merchant.shifts (staff_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS shifts_by_shop ON merchant.shifts (merchant, started_at);

CREATE TABLE IF NOT EXISTS merchant.shift_breaks (
  id          TEXT PRIMARY KEY,
  shift_id    TEXT NOT NULL REFERENCES merchant.shifts(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_breaks_one_open ON merchant.shift_breaks (shift_id) WHERE ended_at IS NULL;

-- Booked hours. A row is a week's plan for a person: `once` rows are that week only; the others
-- are their usual hours from that week on (the latest one at or before a week applies).
CREATE TABLE IF NOT EXISTS merchant.staff_hours (
  staff_id    TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  week_of     DATE NOT NULL,
  once        BOOLEAN NOT NULL,
  days        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, week_of, once)
);
