-- The Command Center's people, access and audit log (docs/command-center-plan.md, Phase 2).
-- Its own schema, beside merchant, payments and rewards.
--
-- Levels are an object keyed by section: {"home":0,"growth":1,…}. 0 None, 1 Totals, 2 See,
-- 3 Propose, 4 Approve. The sections are fixed by the app (src/services/command/levels.ts).

CREATE SCHEMA IF NOT EXISTS command;

-- Groups. Members is automatic: everyone with a Clear account has at least its levels.
CREATE TABLE command.groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]{1,31}$'),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  levels      JSONB NOT NULL CHECK (jsonb_typeof(levels) = 'object'),
  auto        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The brief's seed values (§3). Editable in the app; new groups can be made.
INSERT INTO command.groups (key, name, description, levels, auto) VALUES
  ('members',   'Members',   'Everyone with a Clear account',                               '{"home":0,"growth":1,"field":0,"members":0,"merchants":1,"shop":1,"money":1,"contracts":2,"governance":2,"records":2,"access":0}', true),
  ('admin',     'Admin',     'Runs the co-op day to day',                                   '{"home":4,"growth":4,"field":4,"members":4,"merchants":4,"shop":4,"money":4,"contracts":4,"governance":4,"records":4,"access":4}', false),
  ('protocol',  'Protocol',  'Contracts and the money they hold',                           '{"home":2,"growth":2,"field":0,"members":4,"merchants":2,"shop":1,"money":4,"contracts":4,"governance":2,"records":2,"access":0}', false),
  ('field',     'Field',     'Shops, posters and the route',                                '{"home":2,"growth":3,"field":4,"members":2,"merchants":3,"shop":3,"money":1,"contracts":2,"governance":2,"records":2,"access":0}', false),
  ('board',     'Board',     'Signs for the co-op board',                                   '{"home":2,"growth":1,"field":0,"members":0,"merchants":1,"shop":1,"money":2,"contracts":4,"governance":4,"records":2,"access":0}', false),
  ('outside',   'Outside',   'Read-only, for an accountant or counsel',                     '{"home":0,"growth":1,"field":0,"members":0,"merchants":1,"shop":2,"money":2,"contracts":2,"governance":2,"records":2,"access":0}', false),
  ('investors', 'Investors', 'Data room for investors, lenders and property contributors',  '{"home":0,"growth":1,"field":0,"members":0,"merchants":1,"shop":1,"money":2,"contracts":2,"governance":2,"records":2,"access":0}', false);

-- People on the team list: anyone with a group, custom access or an invite. A member with no team
-- access has no row until they first sign in.
CREATE TABLE command.people (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_id   TEXT UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT UNIQUE CHECK (email = lower(email)),
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per person. Effective access is custom_levels ?? the group's, and at least the Members row
-- for a Clear member. `off` turns everything off. expires_at ends it (investors); for an investor
-- invited "30 days after first sign-in", expires_after_days sets expires_at at that sign-in.
CREATE TABLE command.person_access (
  person_id          UUID PRIMARY KEY REFERENCES command.people (id) ON DELETE CASCADE,
  group_id           UUID REFERENCES command.groups (id),
  custom_levels      JSONB CHECK (custom_levels IS NULL OR jsonb_typeof(custom_levels) = 'object'),
  off                BOOLEAN NOT NULL DEFAULT false,
  expires_at         TIMESTAMPTZ,
  expires_after_days INTEGER CHECK (expires_after_days IS NULL OR expires_after_days > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An invite is an emailed link. Only a hash of its token is kept.
CREATE TABLE command.invites (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  token_hash         TEXT NOT NULL UNIQUE,
  invited_by         UUID REFERENCES command.people (id),
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices are keyed by a random id the browser keeps; the label is what its user agent says.
CREATE TABLE command.devices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  device_key TEXT NOT NULL CHECK (length(device_key) BETWEEN 16 AND 128),
  label      TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, device_key)
);

-- A Command Center session: 12 hours when "keep me signed in" is ticked, else the browser's session
-- (the browser ends it; the server still caps it at 12 hours).
CREATE TABLE command.sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  device_id        UUID REFERENCES command.devices (id),
  privy_session_id TEXT,
  keep             BOOLEAN NOT NULL,
  -- Has a Clear account, so gets at least the Members row. Checked once, at sign-in.
  member           BOOLEAN NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  ended_reason     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_person ON command.sessions (person_id) WHERE ended_at IS NULL;

-- Every sign-in: when, which device, roughly where (a city, never an address).
CREATE TABLE command.sign_ins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  device_id  UUID REFERENCES command.devices (id),
  method     TEXT NOT NULL CHECK (method IN ('passkey', 'email', 'other')),
  device     TEXT NOT NULL,
  city       TEXT,
  new_device BOOLEAN NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sign_ins_person ON command.sign_ins (person_id, at DESC);

-- The data room's confidentiality terms, by version.
CREATE TABLE command.terms_acceptances (
  person_id   UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, version)
);

-- Every page and panel an investor opens.
CREATE TABLE command.page_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  UUID NOT NULL REFERENCES command.people (id) ON DELETE CASCADE,
  session_id UUID REFERENCES command.sessions (id),
  route      TEXT NOT NULL,
  pane       TEXT,
  panel      TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX page_views_person ON command.page_views (person_id, at DESC);

-- The two-person rule. Phase 2 uses it for access that gives someone Approve; Phase 4 adds money
-- and on-chain kinds. Nobody approves their own.
CREATE TABLE command.proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL,
  area         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload      JSONB NOT NULL,
  proposed_by  UUID NOT NULL REFERENCES command.people (id),
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'approved', 'declined', 'withdrawn')),
  approved_by  UUID REFERENCES command.people (id),
  approved_at  TIMESTAMPTZ,
  safe_tx_hash TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proposals_second_person CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT proposals_approved CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX proposals_waiting ON command.proposals (area) WHERE status = 'waiting';

-- Records → Audit log. One row per change made in the app; nothing here can be edited, and the
-- trigger below makes that literally true for every role, the table's owner included.
CREATE TABLE command.audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  person_id   UUID REFERENCES command.people (id),
  who         TEXT NOT NULL,
  area        TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  from_where  TEXT NOT NULL DEFAULT '',
  before      JSONB,
  after       JSONB,
  result      TEXT NOT NULL CHECK (result IN ('done', 'waiting', 'approved', 'declined', 'refused')),
  approver    UUID REFERENCES command.people (id)
);
CREATE INDEX audit_log_at ON command.audit_log (at DESC);

CREATE FUNCTION command.audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'command.audit_log is append-only: % is not allowed', TG_OP;
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON command.audit_log
  FOR EACH ROW EXECUTE FUNCTION command.audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON command.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION command.audit_log_append_only();
