# The API

`@clear/api` — the one backend both apps talk to. Express on **Bun**, with Postgres, Redis and
socket.io. Deployed as a Docker image on Railway.

It does four things: aggregates chain and bank data behind a cache, holds the off-chain state the
chain does not (members, charges, contacts, the equity ledger), brokers every money provider
(Bridge, Lithic, Plaid, Stripe, Onramper, Coinbase), and runs the background jobs that keep all of
that from going stale.

---

## Setup

`apps/api` is **not** an npm workspace — the root `workspaces` list is `apps/member`,
`apps/merchant`, `packages/*`. It installs its own dependencies and pulls `@clear/domain` through
`file:../../packages/domain`, so `npm run dev --workspace @clear/api` will not resolve. Run it from
its own directory:

```bash
cd apps/api
npm install
cp env.example .env
npm run dev      # bun --watch src/index.ts → http://localhost:3001
```

Requires **Bun**. Postgres and Redis are both optional to boot and required in practice: the server
starts and logs a warning without either, health reports `redis: disconnected`, and routes backed by
the member store return `503` until `DATABASE_URL` is set.

Local Redis, whichever you prefer:

```bash
docker run -d -p 6379:6379 redis:7-alpine     # or: brew services start redis
```

| Script | |
|---|---|
| `npm run dev` | `bun --watch src/index.ts` |
| `npm start` | `bun src/index.ts` — what Railway runs |
| `npm run build` | `bun build src/index.ts --outdir dist` (not used in the image; see below) |
| `npm run test` | `bun test-api.ts` — an end-to-end smoke script against a running server |
| `npm run lint` | ESLint |
| `npm run lithic:test` | `bun test src/services` — the colocated unit tests |

Unit tests also sit beside the code they cover (`src/routes/*.test.ts`, `src/services/**/*.test.ts`)
and run under `bun test`.

### Docker and Railway

The build context is the **repository root**, not `apps/api`, because the API imports
`@clear/domain` — a refund's figures must be the same number on the counter tablet, on the member's
phone, and in the row this service writes, and one implementation is the only way to guarantee that.
`.railwayignore` keeps the context narrow (`apps/api` and `packages/domain`).

The image runs the TypeScript entry directly rather than a bundle. Bundling was tried and reverted:
`@coinbase/cdp-sdk` imports a specifier that does not resolve in a clean install, so `bun build`
succeeds locally against hoisted `node_modules` and fails in the container.

Details in [`DEPLOY.md`](./DEPLOY.md) (Railway, and what this service costs), [`DOCKER.md`](./DOCKER.md)
and [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Auth

**Privy JWT.** `middleware/auth.ts` verifies the access token locally, resolves the user's linked
wallets through `getUser` (cached, because that call is rate-limited), and trusts the
`X-Wallet-Address` header only when the address belongs to the verified user. Needs `PRIVY_APP_ID`
and `PRIVY_APP_SECRET`.

> `env.example` still documents `REOWN_PROJECT_ID` as *"required for protected routes"*. It is not —
> nothing in `src/` reads a `REOWN_*` variable. That block is left over from the AppKit era.

`requireMemberCapability(key)` gates on a per-member capability flag from the member store. Only
`/api/plaid` uses it today (`canUsePlaid`). Bridge routes deliberately do **not**: that capability is
`verified`, Bridge now owns verification, and gating on it would be circular — a member could never
reach `/kyc-link` to become verified, because being unverified blocked the call.

**The merchant surface authenticates separately.** `middleware/merchantAuth.ts` issues opaque bearer
tokens — against a staff PIN, or against a verified Privy token whose staff row has the `owner`
role — and shares no cookie, no storage and no middleware
with the member session — different product, different origin, different threat model. An enrolled
tablet identifies itself with its own `X-Clear-Device` header, on a separate lifetime from the shift
token: the device token lasts until an owner revokes it, the bearer token expires overnight.
The four guards are `requireDevice`, `requireMerchant`, `requireManager` and `requireOwner`, and the
last two are server-side checks rather than nav decisions — a counter tablet is a shared device, and
a URL somebody typed once is a URL somebody can type again. A Privy token proves who someone is; the
staff row proves the shop is theirs, and both are required.

Rate limiting is Redis-backed and applied at `/api`, bucketed per IP + method + path by default
(`RATE_LIMIT_SCOPE=path`). `req.ip` is proxy-aware — `trust proxy` is on for Railway.

---

## Route map

Thirty-five groups, all mounted in [`src/index.ts`](./src/index.ts). **Auth** is what the *mount*
applies; several groups attach their own per-route checks instead, and those are called out.

### Chain and market data — public

| Mount | |
|---|---|
| `/api/prices` | Token prices, cached; `POST /batch` for many at once |
| `/api/balances` | Native balances |
| `/api/token-balances` | ERC-20 balances — same service as `/balances`, consolidated |
| `/api/nfts` | NFT holdings, Alchemy with an OpenSea floor-price fallback |
| `/api/transactions` | Transaction history |

### The member

| Mount | Auth | |
|---|---|---|
| `/api/members` | Privy | Profile, onboarding, capabilities, verification, security, socials, linked wallets, wallet-link challenge/verify, membership checkout, served regions |
| `/api/avatars` | public | Avatar images |
| `/api/member-links` | public | Public wallet-link lookup |
| `/api/contacts` | Privy | Directory, handles, availability, opt-out |
| `/api/notifications` | Privy | Feed, read/archive, web-push subscribe |
| `/api/requests` | Privy | Money requests |
| `/api/portfolio` | Privy | Portfolio history and snapshots |

### Money

| Mount | Auth | |
|---|---|---|
| `/api/savings` | Privy | ESA deposits — gasless prepare/submit, savings intents (create/finalize/refund), wallet transfers, pool and bond records |
| `/api/credit` | Privy | The member's credit line and Earn view. The app reads this rather than the contracts directly because two of the four tiers — income and Boost — are underwritten off-chain and reach the chain as attestations, so a client reading contracts would get a line missing half its tiers with no way to know it |
| `/api/pay` | Privy | Billers, payments, payouts, reminders, reconcile, merchant metadata — the equity ledger |
| `/api/autopay` | Privy | Rules, and running one on demand |
| `/api/withdraw` | Privy | Cash out — USDC on Base to a Plaid-linked bank via the Bridge off-ramp. The Bridge customer is resolved from the session, never the body, so a caller cannot point a payout at someone else's |
| `/api/sweeps` | Privy | Sweeps and auto-save |
| `/api/send` | per-route | Link-based send. Sender routes (`/transfers/prepare`, `/confirm-lock`, `/lock-authorization`, `/submit-authorization`) require Privy; the recipient's claim routes (`/claim/start`, `/verify-otp`, `/resend-otp`, `/payout/{debit,bank,wallet}`) are public by necessity — a recipient has no account — and carry their own per-endpoint rate limiters |

### Merchant and charges

| Mount | Auth | |
|---|---|---|
| `/api/charges` | per-route | `POST /` is a merchant **device** authenticating by signature, with no member session to check, so the mount cannot require auth. `GET /:code`, `/approve` and `/decline` attach `requireAuth` themselves |
| `/api/merchant` | per-route | The merchant app's own surface — sessions, roster, charges, refunds, payouts, staff, devices, profile. `POST /session` starts a shift and has no session yet, so the checks (`requireDevice`, `requireMerchant`, `requireManager`, `requireOwner`) are per route |
| `/api/cards` | Privy | Card list, activation, freeze, ephemeral key |

### Providers

| Mount | Auth | |
|---|---|---|
| `/api/bridge` | Privy | Hosted KYC links, onboarding, virtual accounts, funding URLs |
| `/api/lithic` | Privy | Financial account, KYC documents |
| `/api/lithic/cards` | Privy | Card issuing |
| `/api/plaid` | Privy + `canUsePlaid` | Link token, exchange, balances, identity, transactions, recurring, spend, liabilities, investments |
| `/api/stripe` | Privy | Crypto on-ramp session |
| `/api/onramper` | Privy | Quotes and checkout, buy and sell |
| `/api/ramp` | Privy | Coinbase — config, quotes, limits, orders, sessions, status |

**The split:** Bridge does fiat → USDC deposits and hosted KYC. Lithic does card issuing, JIT
authorization and ACH push/pull. Plaid does bank linking and identity. Stripe and Coinbase are
card/crypto on-ramps.

### Webhooks — public, signature-verified, mounted outside auth

| Mount | Verified by |
|---|---|
| `/api/webhooks/lithic/auth-stream` | standard-webhooks HMAC. **Mounted before the rate limiter on purpose** — throttling this declines a member's card at a till, and it is already authenticated by signature. It refuses to approve anything while `LITHIC_WEBHOOK_SECRET` is unset |
| `/api/webhooks/lithic` | standard-webhooks HMAC — async events, including inbound ACH |
| `/api/webhooks/bridge` | `X-Webhook-Signature` (RSA). Deposits into a virtual account are pushed from the member's own bank, so this webhook is the **only** way we learn they happened |
| `/api/webhooks/onramper` | Signature |
| `/api/webhooks/coinbase-ramp` | `X-Hook0-Signature` |
| `/api/stripe/webhooks` | Stripe signature — includes membership billing |

### Health

```text
GET /health     → { status, timestamp, redis: 'connected' | 'disconnected' }
```

Mounted before the rate limiter, so it always answers. Unknown `/api/*` paths return a JSON 404; the
error handler runs every message through `utils/redact.ts` before logging, because a provider SDK
hangs the failed request off the error and one of these routes carries an SSN.

---

## Realtime and background work

`services/websocketService.ts` runs socket.io on the same HTTP server. Clients `identify` with an
address and `subscribe` to chains and topics; balances, transactions, NFTs and prices are then
pushed on their own intervals. `services/eventListenerService.ts` watches chain events.

Twelve jobs start with the server, each non-blocking and each logging rather than crashing the
process:

| Job | |
|---|---|
| `priceUpdater` | Refreshes popular token prices on a schedule |
| `portfolioSnapshotter` | Writes portfolio history points |
| `chargeReconciler` | Repairs charges left mid-flight by a crash or a dropped RPC connection — self-healing, because the failure is invisible until a member says Approve did nothing |
| `autopayRunner` | Runs due autopay rules |
| `dueBillNotifier` | Bill reminders |
| `greetingNotifier` | Scheduled member greetings |
| `sendExpiryNotifier` | Warns before a send link expires |
| `pulledFundsReleaser` | Releases funds pulled and held |
| `sweepRunner` | Executes sweeps and auto-save |
| `reconciler` | General reconciliation |
| `memoryMonitor` | Cheap, and the only thing that reports the *shape* of memory use rather than its peak |
| `relayerGas` | A signer with no gas fails silently — every figure downstream goes quietly stale. This is the only thing that would say so |

Shutdown is graceful on `SIGTERM`/`SIGINT`: listeners and sockets cleaned up, Redis and the Postgres
pool closed. An unhandled rejection is logged and the server keeps serving — one bad request must not
502 every user until Railway restarts.

---

## Source layout

```
src/
  index.ts        CORS, health, mounts, jobs, shutdown — the whole wiring, in order
  routes/         one file per mount
  services/       the work: chain/, deposits/, lithic/, merchant/, savings/, sweeps/, reconciliation/
  jobs/           the twelve above
  middleware/     auth (Privy), merchantAuth, memberCapabilities, rateLimiter, asyncRouter
  config/         postgres, redis, merchantDb, contracts, dataChains, servedRegions
  utils/          redact, and friends
  scripts/
scripts/          operational one-offs — CDP relayer account, Lithic verification steps, backfills
```

Stores (`*Store.ts`) own Postgres access and table creation; services hold the rules. Anything the
member app and the merchant app must both agree on is computed in `@clear/domain`, not here.

---

## Environment

Everything is in [`env.example`](./env.example), which is long because the provider surface is.
The ones without which nothing works:

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres. Without it the member store is unconfigured and its routes return 503 |
| `REDIS_URL` (or `REDIS_HOST`/`PORT`/`PASSWORD`) | Cache and rate limiting |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Member auth |
| `ALCHEMY_API_KEY` | Chain data. **Server-side only** — never a `VITE_` variable; see the member app's README for why |
| `CORS_ORIGIN` | Comma-separated. Unset falls back to allow-all with a warning; set `STRICT_CORS=true` to fail closed instead |

Then, per provider as you enable it: `PLAID_*`, `BRIDGE_*` (including `BRIDGE_WEBHOOK_PUBLIC_KEY`),
`LITHIC_*` (`LITHIC_API_KEY`, `LITHIC_WEBHOOK_SECRET`; production needs **both** `LITHIC_ENV=production`
and `LITHIC_ALLOW_PRODUCTION=true`, because one mistyped variable should not move real money),
`STRIPE_*`, `SEND_*` and `SAVINGS_*` for the relayers, and the at-rest encryption keys
(`PLAID_TOKEN_MASTER_KEY`, `MEMBER_PRIVATE_DATA_MASTER_KEY`, `SEND_CONTACT_ENCRYPTION_KEY`), each
32 bytes, base64 or hex, with an optional keyring for rotation.

### Relayers

Send claim settlement and savings deposits are signed by a relayer. `SEND_RELAYER_MODE` picks how:

- `local_key` — signs with `SEND_RELAYER_PRIVATE_KEY`. Dev only.
- `managed_webhook` — delegates to `SEND_RELAYER_MANAGED_SIGNER_URL`.
- `cdp_server_wallet` — Coinbase CDP Server Wallets, and no raw private key in the app env.
  Recommended. Set `SEND_CDP_*` (or fall back to the default `CDP_*`), then:

  ```bash
  npm run send:cdp:account    # creates or fetches the managed account, prints the address to fund
  ```

Savings has its own set (`SAVINGS_RELAYER_MODE`, `SAVINGS_CDP_*`) so the two can be funded and
rotated independently.

---

## Further reading

- Root [`README.md`](../../README.md) — the monorepo, the contracts, the deployed addresses
- [`DEPLOY.md`](./DEPLOY.md) · [`DOCKER.md`](./DOCKER.md) · [`DEPLOYMENT.md`](./DEPLOYMENT.md) — running it
- [`TEST_GUIDE.md`](./TEST_GUIDE.md) · [`QUICK_TEST.md`](./QUICK_TEST.md) — poking at it
- [`docs/integrations/lithic-integration-spec.md`](../../docs/integrations/lithic-integration-spec.md)
  — the card and banking rail, and the two rails it must not blur
- [`docs/contracts/clrusd-esa-bootstrap.md`](../../docs/contracts/clrusd-esa-bootstrap.md) — the savings path this API settles against
- [`apps/member/README.md`](../member/README.md) — the app on the other end

---

## License

Proprietary — all rights reserved. See [`NOTICE.md`](../../NOTICE.md).
