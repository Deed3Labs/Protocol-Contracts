-- Command Center (docs/ui-redesign-plan.md, Build): GitHub Actions on the watched branch, and each pull
-- request's checks and reviews, read by the GitHub poller (services/command/github.ts, pollChecks).
--
-- A workflow run on the branch (dev): its status, how it ended, and its jobs once it's complete (each
-- job's name, how it ended, when it started and finished). Build's Checks reads the last 30 days of them:
-- each job's pass rate, how many runs and how long one takes.

CREATE TABLE command.code_runs (
  repo        TEXT NOT NULL,
  id          BIGINT NOT NULL,
  workflow    TEXT NOT NULL,
  branch      TEXT NOT NULL,
  sha         TEXT NOT NULL,
  status      TEXT NOT NULL,
  conclusion  TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  url         TEXT NOT NULL,
  -- [{ name, conclusion, startedAt, completedAt }] (times in ms); null until the run is complete and read
  jobs        JSONB,
  PRIMARY KEY (repo, id)
);
CREATE INDEX code_runs_branch ON command.code_runs (repo, branch, created_at DESC);

-- A pull request's check runs at its head (which head they were read for, so a new push reads again),
-- its reviews, and who's been asked to review it; reviews_at is when they were read, against updated_at.
ALTER TABLE command.code_pulls
  ADD COLUMN checks      JSONB,
  ADD COLUMN checks_sha  TEXT,
  ADD COLUMN reviews     JSONB,
  ADD COLUMN requested   TEXT[],
  ADD COLUMN reviews_at  TIMESTAMPTZ;
