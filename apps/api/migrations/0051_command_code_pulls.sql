-- Command Center: Contracts' Code tab (the GitHub activity behind the contracts).

-- A commit can be on more than one watched branch (dev, then main). It's one row, keyed by its sha;
-- `branch` stays the branch it was first seen on, and `branches` is every watched branch it's on.
ALTER TABLE command.code_commits ADD COLUMN branches TEXT[] NOT NULL DEFAULT '{}';
UPDATE command.code_commits SET branches = ARRAY[branch];
CREATE INDEX code_commits_newest ON command.code_commits (repo, committed_at DESC);

-- The pull requests that touch the contracts: open, and merged or closed lately. A PR is listed
-- first and its files asked for after (files NULL until then); `touches` says whether any of them
-- is under the path. A PR that doesn't keeps its row with no files, so they aren't asked for
-- again, and never leaves the API. `files_sha` is the head its files were read at: an open PR
-- that moves is read again.
CREATE TABLE command.code_pulls (
  repo       TEXT NOT NULL,
  number     INTEGER NOT NULL CHECK (number > 0),
  title      TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
  draft      BOOLEAN NOT NULL DEFAULT false,
  login      TEXT,
  head       TEXT NOT NULL,
  base       TEXT NOT NULL,
  head_sha   TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  merged_at  TIMESTAMPTZ,
  closed_at  TIMESTAMPTZ,
  url        TEXT NOT NULL,
  files      TEXT[],
  files_sha  TEXT,
  touches    BOOLEAN,
  contracts  TEXT[],
  PRIMARY KEY (repo, number)
);
CREATE INDEX code_pulls_updated ON command.code_pulls (repo, updated_at DESC);

-- Where the PR poller is: the ETag of the list's first page (an unchanged list costs nothing), when
-- it last ran, and its last error.
CREATE TABLE command.code_pull_cursor (
  repo   TEXT PRIMARY KEY,
  etag   TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error  TEXT
);
