#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" for the apps in this monorepo.
#
#   "ignoreCommand": "bash ../../scripts/vercel-ignore.sh apps/merchant"
#
# Vercel's contract: exit 0 skips the build, exit 1 builds it. Anything this script can't decide
# (missing history, no node, an unknown app) builds, so the worst a bug here costs is minutes,
# never a site that silently stops deploying.
#
# The rules, in order:
#   1. Production always builds.
#   2. A commit message with [skip preview] skips.
#   3. A preview with no pull request skips, except on `dev`: demo.useclear.org and
#      merchant.useclear.org are pinned to that branch, so it deploys like production does.
#   4. Otherwise build only if something this app's build reads changed since the last deployment
#      of this branch: the app's folder, the packages/* it depends on, or the root install inputs.
#
# Every input is a Vercel system env var, so a dry run is just setting them, e.g.
#   VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=dev VERCEL_GIT_COMMIT_SHA=<sha> \
#   VERCEL_GIT_PREVIOUS_SHA=<sha~1> bash scripts/vercel-ignore.sh apps/member

set -uo pipefail

APP="${1:-}"
BUILD=1
SKIP=0
DEPLOY_BRANCHES=" dev "
ROOT_INPUTS=(package.json package-lock.json turbo.json tsconfig.json .npmrc)

build() { echo "vercel-ignore: BUILD $APP: $*"; exit $BUILD; }
skip() { echo "vercel-ignore: SKIP $APP: $*"; exit $SKIP; }

# Vercel runs this from the project's root directory (apps/<name>); git paths are repo-relative.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || build "not in a git checkout"
[ -n "$APP" ] && [ -f "$APP/package.json" ] || build "no package.json at '$APP'"

ENVIRONMENT="${VERCEL_ENV:-}"
REF="${VERCEL_GIT_COMMIT_REF:-}"
PR="${VERCEL_GIT_PULL_REQUEST_ID:-}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
PREV_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
MESSAGE="${VERCEL_GIT_COMMIT_MESSAGE:-}"

[ "$ENVIRONMENT" = "production" ] && build "production"
case "$MESSAGE" in *"[skip preview]"*) skip "commit message says [skip preview]" ;; esac
if [[ "$DEPLOY_BRANCHES" != *" $REF "* ]] && [ -z "$PR" ]; then
  skip "preview of '$REF' with no pull request"
fi

# The workspace packages this app depends on, transitively, from the @clear/* names in each
# package.json. Derived rather than listed so a new dependency can't be forgotten here.
PACKAGES="$(node -e '
  const fs = require("fs"), path = require("path");
  const byName = {};
  for (const dir of fs.readdirSync("packages")) {
    const file = path.join("packages", dir, "package.json");
    if (fs.existsSync(file)) byName[JSON.parse(fs.readFileSync(file, "utf8")).name] = path.join("packages", dir);
  }
  const seen = new Set(), queue = [process.argv[1]];
  while (queue.length) {
    const pkg = JSON.parse(fs.readFileSync(path.join(queue.shift(), "package.json"), "utf8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      const dir = byName[dep];
      if (dir && !seen.has(dir)) { seen.add(dir); queue.push(dir); }
    }
  }
  console.log([...seen].sort().join(" "));
' "$APP")" || build "couldn't read workspace dependencies"

# shellcheck disable=SC2206
PATHS=("$APP" $PACKAGES "${ROOT_INPUTS[@]}")

HEAD_SHA="$(git rev-parse --verify --quiet "$HEAD_SHA^{commit}")" || build "commit $HEAD_SHA isn't in the clone"
has_commit() { git cat-file -e "$1^{commit}" 2>/dev/null; }
REMOTE="https://github.com/${VERCEL_GIT_REPO_OWNER:-Deed3Labs}/${VERCEL_GIT_REPO_SLUG:-Protocol-Contracts}.git"

# Vercel's clone is shallow. --depth is only ever passed to a shallow clone: on a full one (a
# laptop running a dry run) it would make the repository shallow.
fetch() {
  local depth="$1"; shift
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    git fetch --quiet --no-tags --depth="$depth" "$REMOTE" "$@" 2>/dev/null
  else
    git fetch --quiet --no-tags "$REMOTE" "$@" 2>/dev/null
  fi
}

if [ -n "$PREV_SHA" ]; then
  # A diff only needs the two trees, so one commit is enough; GitHub serves any reachable SHA.
  has_commit "$PREV_SHA" || fetch 1 "$PREV_SHA"
  has_commit "$PREV_SHA" || build "previous deployment $PREV_SHA isn't fetchable"
  BASE="$PREV_SHA"
  SINCE="the last deployment of '$REF' (${PREV_SHA:0:8})"
elif [[ "$DEPLOY_BRANCHES" == *" $REF "* ]]; then
  build "no previous deployment of '$REF' to compare with"
else
  # First deployment of a pull request's branch. Compare with where it left dev rather than
  # building unconditionally, or every new branch would build every app once.
  # Deepen this branch first, then fetch dev last so FETCH_HEAD names dev (no refs are written).
  fetch 200 "$HEAD_SHA"
  fetch 200 dev && BASE="$(git merge-base "$HEAD_SHA" FETCH_HEAD 2>/dev/null)" || BASE=""
  [ -n "$BASE" ] || build "first deployment of '$REF' and no merge base with dev"
  SINCE="where '$REF' left dev (${BASE:0:8})"
fi

if git diff --quiet "$BASE" "$HEAD_SHA" -- "${PATHS[@]}"; then
  skip "nothing it builds from changed since $SINCE"
fi
build "$(git diff --name-only "$BASE" "$HEAD_SHA" -- "${PATHS[@]}" | head -5 | paste -sd ' ' -) changed since $SINCE"
