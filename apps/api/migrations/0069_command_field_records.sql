-- Command Center (docs/ui-redesign-plan.md, Field): the records Field's Plan, Today and Placement keep.
--
-- Routes planned for the coming days: one person's stops on one day, in order, and whether the route has
-- been sent to them and accepted. A route planned for today that's been accepted becomes today's route
-- (command.routes, its stops and tasks, as the seed's day has them), the first time Field is read that day.
-- command.routes keeps one route a day, so a second accepted route for the same day stays a plan.

CREATE TABLE command.route_plans (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day         DATE NOT NULL,
  person_id   UUID NOT NULL REFERENCES command.people (id),
  -- where the day starts and ends: the office, or the person's own place
  start       TEXT NOT NULL DEFAULT 'office',
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted')),
  -- changed since it was last sent or saved, so it goes again
  changed     BOOLEAN NOT NULL DEFAULT false,
  -- the page's estimate as the stops were last put in order
  miles       INTEGER NOT NULL DEFAULT 0 CHECK (miles >= 0),
  minutes     INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  back_by     TEXT CHECK (back_by ~ '^[0-2][0-9]:[0-5][0-9]$'),
  note        TEXT,
  planned_by  UUID NOT NULL REFERENCES command.people (id),
  sent_at     TIMESTAMPTZ,
  sent_by     UUID REFERENCES command.people (id),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES command.people (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a route belongs to one person on one day
  UNIQUE (day, person_id)
);

-- A planned stop: what needs a visit it came from (`ref`: p12 a poster, c:<card> a merchant, d:<shop> a device,
-- y:<id> a shop that said yes), or a stop of its own (a:…), with what to do there as it was planned.
CREATE TABLE command.route_plan_stops (
  plan_id  INTEGER NOT NULL REFERENCES command.route_plans (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ref      TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('poster', 'new', 'merchant', 'device', 'visit')),
  shop     TEXT NOT NULL,
  city     TEXT NOT NULL,
  what     TEXT NOT NULL,
  why      TEXT NOT NULL DEFAULT '',
  mins     INTEGER NOT NULL CHECK (mins >= 0),
  poster   INTEGER REFERENCES command.posters (n),
  design   TEXT,
  eta      TEXT CHECK (eta ~ '^[0-2][0-9]:[0-5][0-9]$'),
  PRIMARY KEY (plan_id, position),
  UNIQUE (plan_id, ref)
);

-- today's route, started from a plan: which one, and its van may not be loaded yet
ALTER TABLE command.routes ADD COLUMN plan_id INTEGER REFERENCES command.route_plans (id);
ALTER TABLE command.routes ALTER COLUMN loaded_at DROP NOT NULL;
-- a planned merchant visit or a first poster is a task to mark done, as a device fix is
ALTER TABLE command.route_tasks DROP CONSTRAINT route_tasks_kind_check;
ALTER TABLE command.route_tasks ADD CONSTRAINT route_tasks_kind_check CHECK (kind IN ('poster', 'device', 'visit'));

-- What went in the van in the morning: posters by design, spare Point batteries and receipt rolls.
CREATE TABLE command.van_loads (
  day         DATE PRIMARY KEY,
  loaded_at   TEXT NOT NULL CHECK (loaded_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- design code → posters loaded
  posters     JSONB NOT NULL DEFAULT '{}',
  batteries   INTEGER NOT NULL DEFAULT 0 CHECK (batteries >= 0),
  rolls       INTEGER NOT NULL DEFAULT 0 CHECK (rolls >= 0),
  note        TEXT,
  recorded_by UUID REFERENCES command.people (id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shops that said yes to a poster: on a visit, from the pipeline, or added by hand, and when. Placed once the
-- poster is up (it's in command.posters from then).
CREATE TABLE command.poster_yes (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop       TEXT NOT NULL CHECK (shop <> ''),
  city       TEXT NOT NULL,
  -- the shop's pipeline card, when it has one
  card_id    TEXT,
  source     TEXT NOT NULL CHECK (source IN ('visit', 'pipeline', 'hand')),
  agreed_on  DATE NOT NULL,
  agreed_by  UUID REFERENCES command.people (id),
  design     TEXT REFERENCES command.poster_designs (code),
  note       TEXT,
  placed_on  DATE,
  poster     INTEGER REFERENCES command.posters (n),
  dropped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one open yes a shop
CREATE UNIQUE INDEX poster_yes_open ON command.poster_yes (lower(shop), lower(city)) WHERE placed_on IS NULL AND dropped_at IS NULL;
