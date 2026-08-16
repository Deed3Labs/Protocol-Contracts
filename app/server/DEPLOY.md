# Deploying the server on Railway

Written after finding that this service is **92% of the Railway bill** ($61.85 of $67.04), holding
99.8% of all CPU and 100% of egress — while the running process measures **114 MB RSS**. That gap is
not the app. It is builds.

## 1. `watchPatterns` — applied

Railway redeploys on every commit to the watched branch. Without a filter that includes frontend
changes, contract changes, and documentation. A single day of frontend work can trigger a dozen full
server rebuilds that produce a byte-identical image.

`"watchPatterns": ["app/server/**"]` is now in `railway.json`. Only server changes rebuild the
server.

## 2. Root Directory must be `app/server` — check this

The repository root is a Hardhat project: 45 dependencies including the Solidity toolchain, and
`node_modules` there is **609 MB**. The server needs 21 dependencies.

If Railway's root directory is the repository root, every deploy installs a compiler toolchain to
run an Express app that never touches it. The service being named *Protocol-Contracts* is a hint
worth checking. **On Railway, build time bills as CPU and memory on the same meter as the running
service**, so a heavy install on every push appears on the invoice as though the app were doing it.

## 3. Auto-deploy should watch `main`, not feature branches

A branch under active development pushes many times a day, and each push is a build. Let feature
branches merge before they cost anything.

## 4. The Dockerfile is expensive — recommended, NOT applied

The current build:

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y curl unzip ca-certificates
RUN curl -fsSL https://bun.sh/install | bash    # downloads Bun, every build
...
CMD ["bun", "src/index.ts"]                      # transpiles TypeScript at boot
```

It starts from a bare OS, installs a package manager, then fetches Bun over the network — all before
touching a dependency, and all to reach a runtime that `oven/bun:1` already provides. Then it
transpiles TypeScript at boot, paying that cost again on every restart.

The replacement is a two-stage build on `oven/bun:1`, bundling to `dist` and running
`bun dist/index.js`. **The bundle step is verified** — 3,575 modules, 9.5 MB, under a second, and the
built server boots cleanly at 114 MB RSS. The Docker build is **not** verified: `bun.lock` is stale
relative to `package.json`, so `--frozen-lockfile` fails, and regenerating the lockfile upgraded
`@coinbase/cdp-sdk` and broke the typecheck. That needs resolving on its own before the Dockerfile
changes.

Order: fix the lockfile drift first, then switch the Dockerfile, then verify a real build.

## 5. Check the replica count

73,856 vCPU-minutes is ~2.5 vCPU sustained. If the service runs multiple replicas, each process is
doing something ordinary and the fix is a number in a settings panel.

## Environment flags

Each defaults to the cheap setting, because the work it gates serves surfaces that are archived or
not yet built.

| Variable | Default | What it gates |
|---|---|---|
| `PROTOCOL_EVENT_LISTENER` | off | Watches DeedNFT transfers. Set `on` when T-Deeds or bonds need it. |
| `PORTFOLIO_SNAPSHOTS` | off | Daily per-wallet snapshot. Its only reader is an archived chart. |
| `DATA_CHAIN_IDS` | active chain | Chains to fetch balances and transfers for. Widen only when funds move. |
| `MEMORY_MONITOR` | on | Logs rss and heap every 5 minutes. Leave on. |
| `POSTGRES_POOL_MAX` | 5 | Connections per pool. Raise if a query backlog appears. |

## Reading the memory logs

```
[memory] rss=114MB heap=42/96MB external=8MB
```

- `rss` flat, `heapUsed` sawtoothing — healthy, the collector is keeping up
- `heapUsed` floor climbing across samples — a leak; the floor is the tell, not the peaks
- `rss` far above `heapTotal` — growth outside the JS heap: buffers, sockets, native
- `heapUsed` near `heapTotal` and staying — GC pressure, which bills as **CPU**, not memory
