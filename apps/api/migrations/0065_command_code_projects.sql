-- Command Center: Build's Code tab watches every project in the monorepo, not just the contracts.
-- A commit or PR is tagged with the projects its files are in (services/command/github.ts,
-- PROJECTS). Commits are listed for the whole repo from now on; those already held keep their rows,
-- and get their projects from the files they have on the poller's next run.
ALTER TABLE command.code_commits ADD COLUMN projects TEXT[];
ALTER TABLE command.code_pulls ADD COLUMN projects TEXT[];
-- the PRs that didn't touch the contracts were kept without their files: read them again
UPDATE command.code_pulls SET touches = NULL, files_sha = NULL WHERE touches = false;
-- a PR that touched the contracts is in Protocol at least, until it's read again
UPDATE command.code_pulls SET projects = ARRAY['proto'] WHERE touches;
