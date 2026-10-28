-- Command Center, the redesign (docs/ui-redesign-plan.md, Security): every reveal of personal details,
-- with its reason. Details are masked by default; showing them is one row here (and one in the audit
-- log), naming who, what (a section, the person or row, the field) and why. A reveal without a reason
-- is allowed when Settings says so, and flagged. Records → Reveals reads this; nothing edits it.

CREATE TABLE command.reveals (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  person_id UUID NOT NULL REFERENCES command.people (id),
  who       TEXT NOT NULL,
  section   TEXT NOT NULL,
  -- the row shown ('*' for a whole list), and the field
  subject   TEXT NOT NULL,
  field     TEXT NOT NULL,
  -- how many people's details it showed
  rows      INTEGER NOT NULL DEFAULT 1 CHECK (rows >= 0),
  reason    TEXT NOT NULL DEFAULT '',
  flagged   BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX reveals_at ON command.reveals (at DESC);

CREATE FUNCTION command.reveals_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'command.reveals is append-only: % is not allowed', TG_OP;
END;
$$;
CREATE TRIGGER reveals_append_only BEFORE UPDATE OR DELETE ON command.reveals
  FOR EACH ROW EXECUTE FUNCTION command.reveals_append_only();
CREATE TRIGGER reveals_no_truncate BEFORE TRUNCATE ON command.reveals
  FOR EACH STATEMENT EXECUTE FUNCTION command.reveals_append_only();
