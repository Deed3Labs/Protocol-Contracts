-- Command Center, Phase 7c: site visits from Plausible, as one more feed (docs/command-center-plan.md).
ALTER TABLE command.feeds DROP CONSTRAINT feeds_id_check;
ALTER TABLE command.feeds ADD CONSTRAINT feeds_id_check CHECK (id IN ('plaid', 'bridge', 'lithic', 'stripe', 'shop', 'catalog', 'site'));
INSERT INTO command.feeds (id) VALUES ('site');

-- A submission the site's join form really sent (Phase 7b's endpoint), as against the seed's samples:
-- live, Growth counts and lists only these.
ALTER TABLE command.form_submissions ADD COLUMN live BOOLEAN NOT NULL DEFAULT false;
