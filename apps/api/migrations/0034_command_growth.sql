-- Command Center, Phase 3b: the rows behind Growth and Field (docs/command-center-plan.md).
-- Growth's analytics (visits, sources, cohorts, per-shop numbers) are stored figures (0033); these
-- are the things it lists.

-- Poster designs: A "The neighbor", B "$10 on us", C "The map".
CREATE TABLE command.poster_designs (
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]$'),
  name TEXT NOT NULL
);

-- Every poster: where it hangs (a partner shop, another shop or a community board), its design,
-- and its life: hung, checked, due for a swap. scans_30d is refreshed by the scan job (Phase 7); the
-- seed writes the prototype's.
CREATE TABLE command.posters (
  n          INTEGER PRIMARY KEY CHECK (n > 0),
  place      TEXT NOT NULL,
  place_id   TEXT NOT NULL,
  city       TEXT NOT NULL,
  board      BOOLEAN NOT NULL DEFAULT false,
  design     TEXT NOT NULL REFERENCES command.poster_designs (code),
  scans_30d  INTEGER NOT NULL DEFAULT 0 CHECK (scans_30d >= 0),
  hung_at    TIMESTAMPTZ NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  swap_at    TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('up', 'due', 'faded', 'missing'))
);
CREATE INDEX posters_place ON command.posters (place_id);

-- Forms from the website: the waitlist, shop enquiries, land offers, work with us. Personal: the API
-- sends names and emails masked unless asked for (logged), and never at Totals.
CREATE TABLE command.form_submissions (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  form        TEXT NOT NULL CHECK (form IN ('Waitlist', 'Shop enquiry', 'Land offer', 'Work with us')),
  city        TEXT NOT NULL,
  source      TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('New', 'Replied', 'Invited'))
);

-- A day's route: who drives it and its own facts, its stops in order, each stop's tasks, and the
-- shops due a visit later.
CREATE TABLE command.routes (
  day              DATE PRIMARY KEY,
  staff            TEXT NOT NULL,
  staff_key        TEXT NOT NULL,
  loaded_at        TEXT NOT NULL CHECK (loaded_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  started_at       TEXT CHECK (started_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  miles            INTEGER NOT NULL,
  back_by          TEXT NOT NULL,
  minutes_per_stop INTEGER NOT NULL
);

CREATE TABLE command.route_stops (
  day        DATE NOT NULL REFERENCES command.routes (day) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  position   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  street     TEXT NOT NULL,
  eta        TEXT NOT NULL,
  closes     TEXT,
  contact    TEXT,
  last_visit DATE,
  PRIMARY KEY (day, id)
);

CREATE TABLE command.route_tasks (
  day      DATE NOT NULL,
  stop_id  TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('poster', 'device')),
  poster   INTEGER REFERENCES command.posters (n),
  title    TEXT NOT NULL,
  note     TEXT,
  done_at  TEXT,
  outcome  TEXT,
  photo    BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (day, stop_id, position),
  FOREIGN KEY (day, stop_id) REFERENCES command.route_stops (day, id) ON DELETE CASCADE
);

CREATE TABLE command.route_later (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop       TEXT NOT NULL,
  city       TEXT NOT NULL,
  note       TEXT NOT NULL,
  state      TEXT NOT NULL,
  poster     TEXT NOT NULL,
  wrong      TEXT NOT NULL,
  todo       TEXT NOT NULL,
  due        TEXT NOT NULL,
  detour     TEXT NOT NULL,
  last_visit TEXT NOT NULL
);
