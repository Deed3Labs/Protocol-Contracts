-- Command Center, Phase 3e: the rows behind Records (docs/command-center-plan.md).
-- Documents are Command's own; files themselves live in object storage once uploads are saved (the
-- step after 3e). The activity log is command.audit_log (0032), which is never seeded.

CREATE TABLE command.documents (
  id        TEXT PRIMARY KEY,
  position  INTEGER NOT NULL,
  title     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('agreement', 'minutes', 'filing', 'policy', 'bond', 'report')),
  entity_id TEXT NOT NULL REFERENCES command.entities (id),
  dated     TIMESTAMPTZ NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('signed', 'filed', 'draft', 'waiting', 'final')),
  version   TEXT NOT NULL,
  by_whom   TEXT NOT NULL,
  pages     INTEGER NOT NULL CHECK (pages > 0)
);
CREATE INDEX documents_dated ON command.documents (dated DESC);
