-- Command Center (docs/ui-redesign-plan.md, Security): data exports need a second person, as Settings
-- says. A whole list with names (Members' people, Growth's join forms) is an export: asking for one is
-- a proposal (the section's `export` action), and a second person's approval writes a grant here.
-- The grant is the asker's alone, for that section, used once, within a day. Revealing one person
-- stays a reveal with a reason (0059); every use of a grant is logged there too.

CREATE TABLE command.export_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section     TEXT NOT NULL CHECK (section IN ('members', 'growth')),
  person_id   UUID NOT NULL REFERENCES command.people (id),
  reason      TEXT NOT NULL CHECK (reason <> ''),
  approved_by UUID NOT NULL REFERENCES command.people (id),
  approved_at TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  -- the same rule as a proposal's: nobody approves their own
  CONSTRAINT export_grants_second_person CHECK (approved_by <> person_id),
  CONSTRAINT export_grants_window CHECK (expires_at > approved_at)
);
CREATE INDEX export_grants_person ON command.export_grants (person_id, section) WHERE used_at IS NULL;
