-- Command Center, the redesign (docs/ui-redesign-plan.md, Security): Settings → Rules and limits.
-- The numbers the app enforces live here instead of in code. Changing one is a proposal a second
-- person approves (services/command/settings.ts); the rules set somewhere else (a vote, the bylaws,
-- the law) aren't stored: Settings shows them locked, with where they're decided.
--
-- Each value starts as what the app enforced before this table, so nothing changes until someone
-- (and a second person) changes it: refunds and shop buys both needed a second person over $50.

CREATE TABLE command.settings (
  id          TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  UUID REFERENCES command.people (id),
  approved_by UUID REFERENCES command.people (id),
  -- the same rule as a proposal's: nobody approves their own change
  CONSTRAINT settings_second_person CHECK (approved_by IS NULL OR approved_by <> changed_by)
);

INSERT INTO command.settings (id, value) VALUES
  ('shopbuy', '50'),
  ('refund', '50'),
  ('wait', '24'),
  ('cap', '100'),
  ('batch', '25'),
  ('margin', '60'),
  ('buffer', '1'),
  ('hold', '14'),
  ('ship', '6'),
  ('quiet', '7'),
  ('passkey', 'true'),
  ('session', '12'),
  ('again', 'true'),
  ('rotate', '90'),
  ('newdev', 'true'),
  ('reason', 'true'),
  ('digest', '"07:00"');
