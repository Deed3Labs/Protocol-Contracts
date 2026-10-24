# Clear Command Center

The co-op's internal app, the members' read-only view and the investors' data room, at
`command.useclear.org`. The design is [`docs/command-reference/clear-command-center.html`](../../docs/command-reference/clear-command-center.html);
the plan is [`docs/command-center-plan.md`](../../docs/command-center-plan.md); where the build departs
from the design, and why, is [`docs/command-reference/DECISIONS.md`](../../docs/command-reference/DECISIONS.md).

The app is this folder. Its API is `/api/command/*` in [`apps/api`](../api) (Railway), with its tables
in Postgres's `command` schema.

## Run it

Node 22 (`PATH=/usr/local/bin:$PATH` on Kai's Mac).

```bash
npm install --workspace=@clear/command
```

```bash
npm run dev --workspace=@clear/command
```

It serves on http://localhost:5230.

- `http://localhost:5230/?preview=1` is the prototype as drawn: its simulated sign-in, its demo team and
  its demo data, with no API. The visual checks run on it.
- `http://localhost:5230/` is the live app: Privy sign-in against the API in `VITE_API_BASE_URL`.
  Against a local API (`npm run dev --workspace=@clear/api` with `COMMAND_SEED=on`), every section
  draws the seed, which is the prototype's rows loaded into the database.

`#login`, `#members`, `#merchants` and so on open a page.

## The app's variables

`apps/command/.env.local` locally (copy `.env.example`); the Vercel project's env when deployed.

| Variable | What |
|---|---|
| `VITE_PRIVY_APP_ID` | The Clear app's Privy app, the same one `apps/member` uses |
| `VITE_API_BASE_URL` | The API: `http://localhost:3001`, or `https://protocol-contracts-dev.up.railway.app` |
| `VITE_MAP_STYLE_URL` | The merchants map's style. OpenFreeMap's positron unless set |
| `VITE_MAPBOX_TOKEN` | A Mapbox style's public `pk.` token (a secret `sk.` one is never used) |

## The API's variables (Railway)

| Variable | What |
|---|---|
| `COMMAND_ADMIN_EMAILS` | Comma-separated. Each becomes Admin on first sign-in. |
| `COMMAND_APP_URL` | Where invite links point. Default `https://command.useclear.org`. |
| `CORS_ORIGIN` | Must include `https://command.useclear.org`, and `https://www.useclear.org` for the join form. |
| `RESEND_API_KEY`, `RESEND_FROM` | Team invites and waitlist invites go by email. |
| `COMMAND_SEED` | `on` seeds empty tables with the prototype's rows (dev). |
| `PROVIDER_<SECTION>` | `seed` (default) or `live`, per section: see below. |

Each live source has its own, all listed with their reasons in `DECISIONS.md`:

| Source | Variables |
|---|---|
| The Ops Safe (Phase 4) | `COMMAND_SAFE_ADDRESS`, `COMMAND_SAFE_CHAIN_ID`, `SAFE_TX_SERVICE_URL`, `SAFE_API_KEY` |
| The indexer (5a) | `ETHERSCAN_API_KEY`, `BASE_SEPOLIA_RPC_URL`; `COMMAND_INDEXER=off`, `COMMAND_INDEXER_MINUTES` |
| GitHub (5c) | `GITHUB_TOKEN` (read-only, Contents); `COMMAND_GITHUB_REPO`, `_BRANCH`, `_PATH`, `_MINUTES` |
| Plaid (6a) | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`, `PLAID_TOKEN_MASTER_KEY`, `COMMAND_PLAID_WEBHOOK_URL`, `COMMAND_PLAID_HOURS` |
| Bridge, Lithic, Stripe (6a) | `BRIDGE_ENV=sandbox` + `BRIDGE_SANDBOX_API_KEY`; `LITHIC_API_KEY`; `STRIPE_SECRET_KEY` or `COMMAND_STRIPE_KEY` (test keys only) |
| The shop (7a) | `COMMAND_SHOP_STRIPE_KEY` (restricted, read-only), `COMMAND_CATALOG_TOKEN`, `COMMAND_SHOP_CATALOG_URL` |
| Waitlist invites (7b) | `COMMAND_INVITE_URL` (else `APP_PUBLIC_URL`); `COMMAND_INVITES=off` |
| Site visits (Umami, Phase 9) | `UMAMI_API_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`, `COMMAND_SITE_MINUTES` |

## Turning a section live

Each section reads its seed until its source is switched on, so going live is configuration:

| Section | Live from |
|---|---|
| `PROVIDER_MONEY=live` | The yield pool and the savings reserve on chain; the bank (Plaid), card spend (Lithic), payouts (Stripe) |
| `PROVIDER_CONTRACTS=live` | Addresses, versions and releases on chain; changes from GitHub |
| `PROVIDER_SHOP=live` | The catalog from useclear.org; orders, reservations and refunds from the shop's Stripe |
| `PROVIDER_MEMBERS=live` | The member app's accounts; the waitlist from the join form; batches that send invites |
| `PROVIDER_GROWTH=live` | Site visits from Plausible; forms from the join form |

The menu's foot ("Plaid is 3h behind · 3 other feeds synced") and `GET /api/command/feeds` say how
each feed is doing; a feed whose keys aren't set says it's off and why.

## Deploying

A Vercel project in the deed3 team, `clear-command`: root directory `apps/command`, Node 22,
`vercel.json` here (install, build, the ignore step, the headers). Like `clear-merchant`, the
project's production branch is the repository's (`main`) and `command.useclear.org` is assigned to
the `dev` branch, so it follows dev, on testnet and the sandboxes; `main` is for when it's ready for
real money.

**DNS:** `command` is a CNAME at Namecheap (useclear.org's DNS is there), the same way
`api.useclear.org` was added: to the target Vercel gives under the project's Domains
(`959a2191de2aa52a.vercel-dns-016.com`, or `cname.vercel-dns.com`). Privy's dashboard needs `https://command.useclear.org` (and `http://localhost:5230`) under
allowed origins, or sign-in won't load.

**The Content-Security-Policy** is enforced (`vercel.json`): the app, its API, Privy's published
list, WalletConnect, Google Fonts and the map's tiles. A new outside host the page talks to has to be
added there, or the browser refuses it. The page can't be framed anywhere (`frame-ancestors 'none'`).

**It installs as an app** (`public/manifest.webmanifest`). Its service worker (`public/sw.js`) keeps
only the shell, so it opens fast and opens offline; nothing the API says is ever cached, since a
cached page of members or money would outlive the sign-out that should hide it. Each build is a new
worker with its own cache. The icons are drawn from the Clear mark by `node scripts/icons.mjs`.

## Where things are

- `src/App.tsx`: the shell's fixed parts (top bar, menu foot, empty containers).
- `src/runtime/dom.tsx`: how the sections draw into those containers.
- `src/sections/`: the prototype, as React, now edited by hand. `data.tsx` is every figure, each
  section file is that section's functions, `startup.tsx` wires the events and draws the first page.
- `src/live/`: what makes it live: Privy, the API client, sections loading from the API, actions,
  the Safe, the feeds, the map's style, the service worker.
- `src/styles/command.css`: the prototype's stylesheet.
- `scripts/port/`: the generator that first turned the prototype into `src/sections`. The sections
  are edited by hand now: diff with `npm run port -- --to /tmp/port`, never regenerate over them.

## Checks

```bash
npm run test --workspace=@clear/command
```

```bash
npm run test:visual --workspace=@clear/command
```

```bash
npm run test:crawl --workspace=@clear/command
```

`test` is the unit tests; CI runs them and the typecheck. `test:visual` runs the DOM, sign-in and
pixel checks against the prototype at 1500, 1100 and 390 px in Paper and Ink; it starts its own
servers on 5231 (the app) and 5233 (the prototype). `test:crawl` clicks every button on every page in
both and compares what opens; it takes a while, so run it with `--workers=1` and on its own.

The sample data the API seeds comes from the prototype: `npm run fixtures --workspace=@clear/command`
writes `packages/command-types/src/fixtures/*.json`; run `bun install` in `apps/api` afterwards (it
copies the package into its own `node_modules`).
