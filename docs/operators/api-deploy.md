# Deploying the server on Railway

The API (`apps/api`) runs on Railway as a Docker image. Its build and deploy settings are in
[`apps/api/railway.json`](../../apps/api/railway.json) and
[`apps/api/Dockerfile`](../../apps/api/Dockerfile). Which variables decide test or real money is in
[Going live](./going-live.md).

## What triggers a build

Railway redeploys on every commit to the watched branch that touches a path in `watchPatterns`:

- `apps/api/**`
- the packages the API links: `packages/domain`, `packages/merchant-contracts`,
  `packages/public-api-contracts`, `packages/command-types`
- `Dockerfile` and `railway.json`

Front-end, contract and documentation changes do not rebuild the server.

**Auto-deploy should follow `main` for production**, not a feature branch: every push to a watched
branch is a full build.

## The build

- **Base image:** `oven/bun:1-slim`, the official Bun image.
- **Build context:** the repository root, not `apps/api`, because the API imports workspace
  packages (`@clear/domain` for refund figures, the merchant and `/v1` API contracts, the Command
  Center's types). The Dockerfile copies only those packages and `apps/api`.
- **Install:** the linked packages first (so a contract change invalidates the install layer), then
  `bun install` in `apps/api`. It runs without `--frozen-lockfile`, because `bun.lock` is not in
  step with `package.json`.
- **Health check:** `GET /health` every 30 seconds, made by Bun itself.
- **Start:** `bun src/index.ts`, on port `3001`, restarting on failure up to 10 times.

### Why it runs the TypeScript entry, not a bundle

`bun build` fails in a clean install: `@coinbase/cdp-sdk` imports `@x402/svm/exact/client`, which
does not resolve. The services that use the CDP SDK load it lazily, and

```
bun build src/index.ts --outdir dist --target bun --external "@coinbase/cdp-sdk"
```

builds, but an external package must still be present at runtime, so the image would need
`node_modules` for that dependency. Until that is resolved, the image runs the source.

## Replicas

The API's background jobs start in every process. Some take a database lock so only one replica
does the work; others do not. Check the jobs in `apps/api/src/jobs` before running more than one
replica.

## Environment flags

Each defaults to the lighter setting.

| Variable | Default | What it gates |
|---|---|---|
| `PROTOCOL_EVENT_LISTENER` | off | Watches DeedNFT transfers. Set `on` when T-Deeds or bonds need it. |
| `PORTFOLIO_SNAPSHOTS` | off | A daily per-wallet portfolio snapshot. No current screen reads it. |
| `DATA_CHAIN_IDS` | the active chain | Chains to fetch balances and transfers for, comma-separated. |
| `MEMORY_MONITOR` | on | Logs memory every 5 minutes. `off` silences it. |
| `POSTGRES_POOL_MAX` | 5 | Connections per Postgres pool. Raise it if queries queue. |

## Reading the memory logs

```
[memory] rss=114MB heap=42/96MB external=8MB
```

`heap` is used over total.

- `rss` flat, heap used rising and falling — healthy; the collector is keeping up
- the lowest heap-used figure climbing across samples — a leak; watch the floor, not the peaks
- `rss` far above heap total — growth outside the JavaScript heap: buffers, sockets, native code
- heap used near heap total and staying there — collector pressure, which shows up as **CPU**, not
  memory

## Known limitations

- **`railway up` from the CLI** uploads what [`.railwayignore`](../../.railwayignore) allows, which
  leaves out `packages/command-types`, a package the Dockerfile copies.
