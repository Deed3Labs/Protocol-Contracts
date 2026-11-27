-- Command Center, Phase 5c: changes from GitHub (docs/command-center-plan.md).

-- Every commit on the watched branch that touches the contracts, with the files it changed and the
-- contracts those files are. A commit is listed first and its files asked for after, so a run that
-- runs out of rate limit leaves files NULL for the next one to fill.
CREATE TABLE command.code_commits (
  repo         TEXT NOT NULL,
  sha          TEXT NOT NULL CHECK (sha ~ '^[0-9a-f]{40}$'),
  branch       TEXT NOT NULL,
  -- when it landed on the branch (the committer's time: a squash merge's is the merge)
  committed_at TIMESTAMPTZ NOT NULL,
  author       TEXT NOT NULL,
  author_email TEXT,
  login        TEXT,
  message      TEXT NOT NULL,
  url          TEXT NOT NULL,
  pr           INTEGER,
  files        TEXT[],
  contracts    TEXT[],
  PRIMARY KEY (repo, sha)
);
CREATE INDEX code_commits_time ON command.code_commits (repo, branch, committed_at);

-- Where the poller is: the newest commit it has, the ETag of its last answer (so an unchanged
-- answer costs nothing), and its last error.
CREATE TABLE command.code_cursor (
  repo      TEXT NOT NULL,
  branch    TEXT NOT NULL,
  path      TEXT NOT NULL,
  since     TIMESTAMPTZ,
  etag      TEXT,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  error     TEXT,
  PRIMARY KEY (repo, branch, path)
);
