-- Command Center, Phase 3e: the rows behind Governance (docs/command-center-plan.md).
-- Command's own records: nothing upstream holds the structure, boards, filings or minutes. Ballots
-- come from the member app once votes run there (Phase 7). The seed writes the prototype's.

-- The entities: kind, status, role, where each sits on the chart, its parent, how much the parent
-- owns, and its facts (formed, tax, EIN masked, officers, formation steps, agreements).
CREATE TABLE command.entities (
  id        TEXT PRIMARY KEY,
  position  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('formed', 'forming', 'planned')),
  role      TEXT NOT NULL,
  map_x     NUMERIC(5, 1) NOT NULL,
  map_y     NUMERIC(5, 1) NOT NULL,
  parent_id TEXT REFERENCES command.entities (id),
  owned     TEXT,
  under     TEXT,
  facts     JSONB
);

-- Filings and meetings each entity owes, by due date.
CREATE TABLE command.filings (
  position  INTEGER PRIMARY KEY,
  id        TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES command.entities (id),
  title     TEXT NOT NULL,
  due_on    TIMESTAMPTZ NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('ready', 'draft', 'none', 'later', 'done')),
  owner     TEXT
);

-- Boards and their seats: the seat's class, who holds it (null: open), the term, and a note.
CREATE TABLE command.boards (
  position  INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  entity_id TEXT NOT NULL REFERENCES command.entities (id),
  note      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE command.board_seats (
  board     TEXT NOT NULL REFERENCES command.boards (name),
  position  INTEGER NOT NULL,
  class     TEXT NOT NULL CHECK (class IN ('c', 'm', 'r', 'i', 'n', 'f', 't')),
  holder    TEXT,
  starts_at TIMESTAMPTZ,
  ends_at   TIMESTAMPTZ,
  note      TEXT,
  PRIMARY KEY (board, position)
);

-- Who sits on which boards, and what they've disclosed.
CREATE TABLE command.board_people (
  position INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  boards   TEXT[] NOT NULL,
  note     TEXT NOT NULL DEFAULT ''
);

-- The next board meeting's agenda.
CREATE TABLE command.agenda_items (
  position INTEGER PRIMARY KEY,
  title    TEXT NOT NULL,
  minutes  INTEGER NOT NULL CHECK (minutes > 0),
  owner    TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('vote', 'report', 'discuss'))
);

-- Resolutions passed, with each seat's vote: y, n, r (recused) or a (absent).
CREATE TABLE command.resolutions (
  position  INTEGER PRIMARY KEY,
  passed_on TIMESTAMPTZ NOT NULL,
  body      TEXT NOT NULL,
  title     TEXT NOT NULL,
  votes     TEXT[] NOT NULL
);

-- Member votes: when it opens and closes, who's eligible, the quorum, ballots cast each day it's
-- been open, and the tally so far.
CREATE TABLE command.member_votes (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      TEXT NOT NULL,
  opens_at   TIMESTAMPTZ NOT NULL,
  closes_at  TIMESTAMPTZ NOT NULL,
  eligible   INTEGER NOT NULL CHECK (eligible > 0),
  quorum     NUMERIC(4, 3) NOT NULL,
  cast_daily INTEGER[] NOT NULL,
  yes        INTEGER NOT NULL DEFAULT 0,
  no         INTEGER NOT NULL DEFAULT 0,
  abstain    INTEGER NOT NULL DEFAULT 0
);

-- Each body's meetings: held, minutes due, next, a vote's span, later ([kind, at, …]).
CREATE TABLE command.meetings (
  position INTEGER PRIMARY KEY,
  body     TEXT NOT NULL UNIQUE,
  events   JSONB NOT NULL
);

-- Deals between our own entities: who pays whom, for what, each payment's date and amount, and the
-- day an open one goes for approval.
CREATE TABLE command.related_party (
  position     INTEGER PRIMARY KEY,
  payer        TEXT NOT NULL REFERENCES command.entities (id),
  payee        TEXT NOT NULL REFERENCES command.entities (id),
  what         TEXT NOT NULL,
  paid_on      TIMESTAMPTZ[] NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  opens_on     TIMESTAMPTZ
);

-- Who decides what: for each kind of decision, each body's part (2 decides, 1 must approve, 0 told,
-- -1 none), and a note while one is open.
CREATE TABLE command.reserved_matters (
  position INTEGER PRIMARY KEY,
  decision TEXT NOT NULL,
  roles    INTEGER[] NOT NULL,
  open     TEXT
);
