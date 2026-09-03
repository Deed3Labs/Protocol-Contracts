# Official Bun image, not ubuntu plus a download.
#
# The previous build started FROM ubuntu:22.04, ran apt-get update, installed curl, unzip and
# ca-certificates, then fetched the Bun installer over the network and executed it — all before
# touching a single dependency, to arrive at a runtime this image already provides. Every one of
# those steps is CPU, memory and network on Railway's meter, and Railway bills build time on the
# same meter as the running service. With a service that redeploys often, the build IS the cost.
FROM oven/bun:1-slim

WORKDIR /app

# The build context is the REPOSITORY ROOT, not apps/api.
#
# It was apps/api until the merchant app arrived. The api now imports @clear/domain — a refund's
# figures must be the same number on the counter tablet, on the member's phone and in the row this
# service writes, and the only way to guarantee that is one implementation. A container that can
# only see apps/api cannot resolve it.
#
# The cost is a larger context, which is why .railwayignore is narrow: apps/api and packages/domain
# and nothing else.
COPY packages/domain ./packages/domain

# Dependencies first, so a source-only change reuses this layer instead of reinstalling.
# Deliberately not --frozen-lockfile: bun.lock is currently stale against package.json, and
# regenerating it upgrades transitive versions. Same install semantics as before — the lockfile
# drift is a separate problem and should not be smuggled into a build change.
COPY apps/api/package.json apps/api/bun.lock* ./apps/api/
WORKDIR /app/apps/api
RUN bun install

COPY apps/api/ ./

EXPOSE 3001

# Bun makes the request itself, so this image needs no curl.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun --eval "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Still running the TypeScript entry rather than a bundle. Bundling was attempted and reverted:
# @coinbase/cdp-sdk imports "@x402/svm/exact/client", which does not resolve in a clean install, so
# `bun build` fails in the container while succeeding locally against a hoisted node_modules. That
# is worth fixing — the bundle is 9.5 MB and boots at 114 MB RSS — but it needs the dependency
# sorted out first, and a build that only works on one machine is worse than no bundle at all.
CMD ["bun", "src/index.ts"]
