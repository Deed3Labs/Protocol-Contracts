# Deploying the server on Railway

Written after finding that this service is **92% of the Railway bill** ($61.85 of $67.04), holding
99.8% of all CPU and 100% of egress — while the running process measures **114 MB RSS**. That gap is
not the app. It is builds.

## 1. `watchPatterns` — applied

Railway redeploys on every commit to the watched branch. Without a filter that includes frontend
changes, contract changes, and documentation. A single day of frontend work can trigger a dozen full
server rebuilds that produce a byte-identical image.

`"watchPatterns": ["apps/api/**"]` is now in `railway.json`. Only server changes rebuild the
server.

## 2. Root Directory — already correct

Confirmed set to `apps/api`. Builds install the server's 21 dependencies, not the repository
root's 609 MB Hardhat toolchain. This was my leading theory and it was wrong.

## 3. Auto-deploy should watch `main`, not feature branches

A branch under active development pushes many times a day, and each push is a build. Let feature
branches merge before they cost anything.

## 4. The Dockerfile — fixed and measured

It used to start `FROM ubuntu:22.04`, apt-get curl and unzip, then download and run the Bun
installer over the network, all before touching a dependency — to reach a runtime the official image
already provides.

Measured cold-cache, same machine, same context:

| | build time | image |
|---|---|---|
| `ubuntu:22.04` + Bun download | **65s** | 705 MB |
| `oven/bun:1-slim` | **31s** | 730 MB |

Roughly half the build time for 25 MB more image. On a service where deploys are the cost, that is
the right side of the trade — and layer caching means the image size is paid once while the build
time is paid on every deploy.

Verified to boot in the container: 181 MB RSS, all routes registered, gates respected.

### Still running `bun src/index.ts`, not a bundle

Closer than it was. `@coinbase/cdp-sdk` ships x402 payment actions that import
`@x402/svm/exact/client`, which does not resolve in a clean install — so `bun build` succeeded
locally against a hoisted `node_modules` and failed in the container.

`coinbaseOnrampService` now loads the SDK lazily rather than importing it at module top level, which
is correct regardless: Coinbase is one of two onramp providers, off unless `RAMP_PROVIDER` selects
it, and the app uses Onramper. `sendRelayerService` already loaded it that way.

That alone is not enough — Bun follows dynamic imports when bundling — but this works:

```
bun build src/index.ts --outdir dist --target bun --external "@coinbase/cdp-sdk"
```

7.54 MB, and the source path boots at 181 MB against 114 MB for a bundle. The catch is that an
external package must still exist at runtime, so the runtime stage needs `node_modules` for that one
dependency rather than the bundle standing alone. Worth finishing; not finished.

Same reason `--frozen-lockfile` is absent: `bun.lock` is stale against `package.json`, and
regenerating it upgrades transitive versions. That drift is its own task.

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
