-- Command Center, the redesign (docs/ui-redesign-plan.md, gaps): the records Command keeps for four cells
-- that had nothing to read. Governance → Agreements → Versions, Settings → Connections → Key age,
-- Settings → Organization → Profile, and Members' notes and tags. (Settings → Security → Worth a look
-- needs no table: it's read from the sign-ins, devices, people and reveals already kept.)

-- Each agreement's versions: drafted by one person, in force once a second person approves its adoption
-- (governance/version-adopt). Adopting one replaces the version in force before it. `decided_by` is who
-- adopts it outside Command (the co-op board, a member vote, both companies); `changes` is what changed,
-- each line '+ added', '~ changed' or '- removed'. `terms` is the document and version the apps record
-- acceptances under (the member app's member_terms_acceptances as document_type@document_version, or
-- the data room's terms as data-room@<version>), so who has accepted which version is read, not typed.
CREATE TABLE command.agreement_versions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES command.agreements (id) ON DELETE CASCADE,
  version      TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 20),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in', 'old')),
  decided_by   TEXT NOT NULL DEFAULT '',
  changes      JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(changes) = 'array'),
  terms        TEXT,
  -- a draft's target date, if it has one
  planned_for  TIMESTAMPTZ,
  drafted_by   UUID REFERENCES command.people (id),
  drafted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  adopted_at   TIMESTAMPTZ,
  adopted_by   UUID REFERENCES command.people (id),
  approved_by  UUID REFERENCES command.people (id),
  replaced_at  TIMESTAMPTZ,
  UNIQUE (agreement_id, version),
  -- a version in force (or replaced) was adopted, and a second person approved it: never the one who asked
  CONSTRAINT agreement_versions_adopted CHECK ((status = 'draft') = (adopted_at IS NULL)),
  CONSTRAINT agreement_versions_second_person CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_by IS DISTINCT FROM adopted_by))
);
-- one version in force per agreement
CREATE UNIQUE INDEX agreement_versions_in_force ON command.agreement_versions (agreement_id) WHERE status = 'in';

-- A connection's key swapped (settings/key-rotated). The keys are env vars on the server, which can't
-- see when one was set, so this is the record of it: which connection, when, who, and a note. The
-- newest per connection is its key's age; one with none says so.
CREATE TABLE command.key_rotations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection  TEXT NOT NULL CHECK (length(connection) BETWEEN 1 AND 40),
  rotated_at  TIMESTAMPTZ NOT NULL,
  person_id   UUID NOT NULL REFERENCES command.people (id),
  note        TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX key_rotations_latest ON command.key_rotations (connection, rotated_at DESC);

-- Members: notes and tags on a person, keyed by the masked number the page shows (M-0001 for a member,
-- W-0001 for someone waiting), never a name, email or phone number.
CREATE TABLE command.member_notes (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject   TEXT NOT NULL CHECK (subject ~ '^[MW]-[0-9]{4,9}$'),
  body      TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  person_id UUID NOT NULL REFERENCES command.people (id),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_notes_subject ON command.member_notes (subject, at DESC);

CREATE TABLE command.member_tags (
  subject   TEXT NOT NULL CHECK (subject ~ '^[MW]-[0-9]{4,9}$'),
  tag       TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 40),
  person_id UUID NOT NULL REFERENCES command.people (id),
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, tag)
);

-- Settings → Organization → Profile: six more settings (services/command/settings.ts), changed like the
-- others, by a second person. Nothing was recorded before, so each starts unset.
INSERT INTO command.settings (id, value) VALUES
  ('org_name', '""'),
  ('org_site', '""'),
  ('org_help', '""'),
  ('org_tz', '""'),
  ('org_fy', '""'),
  ('org_cur', '""');
