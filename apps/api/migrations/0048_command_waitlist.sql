-- Command Center, Phase 7b: the waitlist and batches (docs/command-center-plan.md, question 10b).

-- Everyone who asked to join from the site's form, one row an email. A batch takes the next of
-- them, gives each an invite code (which the member app sends back at onboarding, so a sign-up is
-- matched to its invite: tracked, not gated), and emails them. Personal: names and emails leave the
-- API masked unless asked for (logged), never at Totals.
CREATE TABLE command.waitlist (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name        TEXT NOT NULL,
  zip         TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'poster')),
  poster      TEXT,
  note        TEXT NOT NULL DEFAULT '',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch       INTEGER REFERENCES command.batches (number),
  invite_code TEXT UNIQUE,
  invited_at  TIMESTAMPTZ,
  -- the invite email: queued by the batch, sent by the job, retried a few times if it fails
  email_state TEXT CHECK (email_state IN ('queued', 'sent', 'failed')),
  email_tries INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  emailed_at  TIMESTAMPTZ,
  CONSTRAINT waitlist_invited CHECK ((batch IS NULL) = (invite_code IS NULL) AND (batch IS NULL) = (invited_at IS NULL))
);
CREATE INDEX waitlist_waiting ON command.waitlist (joined_at) WHERE batch IS NULL;

-- A batch Command sent for real, as against the seed's samples.
ALTER TABLE command.batches ADD COLUMN live BOOLEAN NOT NULL DEFAULT false;

-- The site's other answers (shops, land, work) keep what they said.
ALTER TABLE command.form_submissions ADD COLUMN zip TEXT;
ALTER TABLE command.form_submissions ADD COLUMN details JSONB;
