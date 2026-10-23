-- Command Center, Phase 3a: figures, and the Members section's rows (docs/command-center-plan.md).

-- Figures a section shows that aren't counted from its own rows (a weekly series, the waitlist's
-- shape), by name. The seed writes the prototype's values; jobs overwrite them from live sources,
-- saying which and when.
CREATE TABLE command.figures (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z0-9_]+)+$'),
  value       JSONB NOT NULL,
  source      TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members invited into the co-op. Mirrored from the member app's records (read-only here); the seed
-- writes the prototype's 300. Names are personal: the API sends them masked, or not at all at Totals.
CREATE TABLE command.members (
  id               INTEGER PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE CHECK (number ~ '^M-[0-9]{4,}$'),
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  batch            INTEGER NOT NULL,
  joined_at        TIMESTAMPTZ NOT NULL,
  invited_at       TIMESTAMPTZ NOT NULL,
  city             TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('poster', 'website')),
  poster           TEXT CHECK (poster IS NULL OR poster ~ '^P-[0-9]{3,}$'),
  status           TEXT NOT NULL CHECK (status IN ('invited', 'opened', 'active')),
  opened_at        TIMESTAMPTZ,
  funded_with      TEXT CHECK (funded_with IN ('bank', 'five', 'deposit')),
  active_at        TIMESTAMPTZ,
  first_spend_shop TEXT,
  first_spend_at   TIMESTAMPTZ,
  last_seen_at     TIMESTAMPTZ NOT NULL,
  CONSTRAINT members_opened CHECK ((status = 'invited') = (opened_at IS NULL)),
  CONSTRAINT members_active CHECK ((status = 'active') = (active_at IS NOT NULL AND funded_with IS NOT NULL))
);
CREATE INDEX members_batch ON command.members (batch);

-- Invite batches. A sent batch has a date; a proposed one waits for a second person.
CREATE TABLE command.batches (
  number         INTEGER PRIMARY KEY,
  size           INTEGER NOT NULL CHECK (size > 0),
  status         TEXT NOT NULL CHECK (status IN ('sent', 'proposed')),
  sent_at        TIMESTAMPTZ,
  proposed_by    TEXT,
  joined_from    DATE,
  joined_to      DATE,
  from_posters   INTEGER,
  from_website   INTEGER,
  window_ends    DATE,
  CONSTRAINT batches_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
