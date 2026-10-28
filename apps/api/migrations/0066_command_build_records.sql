-- Command Center redesign, Build: the records Command keeps itself about the code and the contracts.
-- Incidents (what went wrong, who's on it, its timeline, when it was resolved), security findings (each
-- one's severity, state and the change that fixes it) and audits (which contracts were reviewed, by whom).
-- Nothing outside writes these: they're added from Build's Overview and Security tabs (actions.ts, contracts).

-- An incident: a sync behind, a deploy rolled back, a contract that paused itself. `area` is where it was
-- in words ("Member app", "Money"); `contract_id` the map's contract, when it was one. Who's on it is a team
-- member. It's open until resolved_at, with what resolved it.
CREATE TABLE command.build_incidents (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  area            TEXT NOT NULL DEFAULT '',
  contract_id     TEXT REFERENCES command.contracts (id),
  note            TEXT NOT NULL DEFAULT '',
  owner_id        UUID REFERENCES command.people (id),
  -- whether members saw it (a failed payment, a wrong balance), as the cell's foot says
  reached_members BOOLEAN NOT NULL DEFAULT false,
  -- when it began, which can be before it was opened here
  started_at      TIMESTAMPTZ NOT NULL,
  opened_by       UUID NOT NULL REFERENCES command.people (id),
  opened_at       TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT NOT NULL DEFAULT '',
  CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);
CREATE INDEX build_incidents_open ON command.build_incidents (started_at) WHERE resolved_at IS NULL;

-- Its timeline: opened, each update, who it was given to, resolved. Oldest first.
CREATE TABLE command.build_incident_updates (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES command.build_incidents (id) ON DELETE CASCADE,
  at          TIMESTAMPTZ NOT NULL,
  line        TEXT NOT NULL CHECK (length(btrim(line)) > 0),
  by_id       UUID REFERENCES command.people (id)
);
CREATE INDEX build_incident_updates_of ON command.build_incident_updates (incident_id, at);

-- A security finding. `area` is where in words (a function, a folder); `found_by` who found it, as they're
-- named (Internal review, Dependabot, an auditor). Its fix is a pull request's number or a change on Build
-- (an Ops Safe transaction, a proposed change), never both. Accepted is "won't fix", with why in state_note;
-- state_at is when it last changed state (the day it was fixed or accepted).
CREATE TABLE command.build_findings (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  severity    TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  contract_id TEXT REFERENCES command.contracts (id),
  area        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  found_by    TEXT NOT NULL CHECK (length(btrim(found_by)) > 0),
  found_at    TIMESTAMPTZ NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'fixing', 'fixed', 'accepted')),
  state_at    TIMESTAMPTZ,
  state_note  TEXT NOT NULL DEFAULT '',
  fix_pr      INTEGER CHECK (fix_pr > 0),
  fix_change  TEXT CHECK (fix_change IS NULL OR length(btrim(fix_change)) > 0),
  recorded_by UUID NOT NULL REFERENCES command.people (id),
  recorded_at TIMESTAMPTZ NOT NULL,
  CHECK (fix_pr IS NULL OR fix_change IS NULL)
);

-- An audit: internal or by an outside auditor, of these contracts (the map's ids), on this day. A day still
-- to come is one that's booked. The report is a link (https only).
CREATE TABLE command.build_audits (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('internal', 'external')),
  auditor     TEXT NOT NULL CHECK (length(btrim(auditor)) > 0),
  contracts   TEXT[] NOT NULL CHECK (cardinality(contracts) > 0),
  -- the scope in words: a version, a commit, what was left out
  scope       TEXT NOT NULL DEFAULT '',
  on_day      DATE NOT NULL,
  report_url  TEXT CHECK (report_url IS NULL OR report_url ~ '^https://'),
  note        TEXT NOT NULL DEFAULT '',
  recorded_by UUID NOT NULL REFERENCES command.people (id),
  recorded_at TIMESTAMPTZ NOT NULL
);
