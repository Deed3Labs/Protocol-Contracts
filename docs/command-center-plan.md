# Command Center: Phase 0 plan

The brief is [`docs/command-reference/command-center-build-prompt.md`](command-reference/command-center-build-prompt.md).
The spec is the prototype, [`docs/command-reference/clear-command-center.html`](command-reference/clear-command-center.html).
This file records what the repo already has, where the brief and the repo disagree, and the plan.
Written 2026-10-22 against `dev` at `e2eb23aa`.

## What's in the repo

### The monorepo

- This is `Deed3Labs/Protocol-Contracts`. It is both the contracts repo and the app monorepo, so the
  brief's "contracts repo, `dev` branch" and "the monorepo" are the same checkout.
- npm workspaces (`npm@10`) and turbo. The workspaces are `apps/member`, `apps/merchant`,
  `apps/rewards`, `apps/pay` and `packages/*`. `apps/api` is **not** a workspace: it uses bun and
  ships as a Docker image to Railway.
- `dev` is the deploy branch. demo.useclear.org and merchant.useclear.org follow it, on testnet with
  sandbox providers. `main` is real money. PRs go into `dev`, squash-merged, behind the required
  `ci` check (`.github/workflows/ci.yml`).
- Vercel builds are billed, so `scripts/vercel-ignore.sh` skips previews that have no PR, and skips
  apps whose inputs didn't change. Vercel runs `build:vercel` (no `tsc`); type checks and tests run
  in CI.
- Design prototypes live in `docs/<app>-reference/` with a `DECISIONS.md` for where the build departs
  from the drawing (see `docs/merchant-reference/`). The prototype is filed there, not in `design/`.

### The API (`apps/api`)

- Express 4 on bun, `pg`, Redis, zod. Routes are mounted under `/api/*` (plus `/v1` for Pay with
  Clear's public API). `api.useclear.org` already points at the **dev** API on Railway.
- Auth is `middleware/auth.ts`: `@privy-io/server-auth` verifies the Privy access token, resolves
  the user's wallets with `getUser` (cached), and sets `req.auth` (`profileUuid` = Privy DID).
  `requireAuth` is the middleware every member route uses. There's also a server idle lock
  (`sessionLock.ts`) and server-verified step-up (`stepUp.ts`).
- Migrations: numbered SQL files in `apps/api/migrations/` (31 so far), run by `src/db/migrate.ts`
  under an advisory lock, checksummed, history-only. Tests use PGlite (`src/db/testDb.ts`). Older
  member stores still create their own tables lazily.
- Existing schemas: `merchant` (shops, staff, hardware, readers, firmware, bank accounts, terms
  codes, hours), `commerce` (catalog, orders, stock), `payments` (tenders, refunds, payouts, an
  `audit_log`, webhooks), `ledger`, `rewards`, plus the member tables in `public`.
- Rate limiting (`rateLimiterMiddleware` on `/api`), CORS with an allowlist plus opt-in Vercel
  previews.
- Providers already wired, sandbox on dev: Lithic, Bridge, Plaid, Stripe, Alchemy (public RPC first,
  Alchemy on rate limit, Multicall3), Resend, Coinbase/Onramper. On-chain readers exist under
  `services/chain/` (for example `payoutReader.ts`).

### The frontends

- All four apps are **Vite + React 19 + TypeScript + react-router-dom**, each its own Vercel project
  with a `vercel.json` that installs one workspace and runs `turbo run build:vercel`.
- They all use the same Privy app (`VITE_PRIVY_APP_ID`). The member app signs in with email, SMS and
  socials; the merchant app's owner sign-in already uses `passkey`, so passkeys are on in that app.
- Member and merchant use Tailwind. Command won't: the brief ports the prototype's CSS as is.

### Contracts on Base Sepolia

- `deployments/base-sepolia/*.json` has 37 contracts (address + ABI): AccessManager, AssurancePool,
  AssuranceOracle, BondVault, BurnerBond(+Factory, Deposit), ClearCredit, ClearUSD(+Upgradeable),
  CLRUSDTokenPool, ClaimEscrow, CollateralRegistry, DeedNFT, ESADepositVault, FundManager,
  LendingPool, MembershipRegistry, MerchantRegistry, PayoutPool, RevolvingIssuer, SavingsIntentFactory,
  TermIssuer, TokenRegistry, Validator(+Registry) and others.
- **Every `blockNumber` is `0`.** The deploy blocks were never recorded.
- Nothing in the repo names an Ops Safe or uses the Safe Transaction Service.

### Other sources the brief names

- **Brand:** `clearpath-website/public/brand/` has `clear-mark-solid-paper.svg` and
  `clear-mark-solid-ink.svg`. These get copied into `apps/command/public/`.
- **Shop:** useclear.org/shop is Next.js on `clearpath-website`. The catalog is a content file
  (`content/shop.ts`). Orders are Stripe Checkout with Shippo rates and labels
  (`app/api/shop/{checkout,webhook,rates}`). There's no stock store; stock is a note in content.
- **Site visits and forms:** the marketing site has no analytics and no form store. Its only outward
  link is to demo.useclear.org. (The member app has Plausible, PR #352.)
- **Members, waitlist, batches:** the member app has accounts and an `inviteCode` on sign-up, but no
  waitlist and no invite batches. `merchant.waitlist_parties` is the restaurant table waitlist,
  unrelated.

## Where the brief and the repo disagree

These need Kai's answer before Phase 1. Each has the default I'd take.

1. **Branches.** The brief says "keep `main` deployable" and a PR per phase. Here, phase PRs go into
   `dev`, and `command.useclear.org` follows `dev` like demo and merchant do (testnet,
   `CLEAR_ENV=testnet`). `main` only gets it when the whole app is ready for real money.
   *Default: PRs into `dev`; the Vercel project's production branch is `dev`.*
2. **API path.** The brief says `/command/*`. Every route here lives under `/api/*`, which is where
   the rate limiter, CORS and the 404 handler sit.
   *Default: `/api/command/*`.*
3. **`apps/web`.** It's `apps/member`. Nothing to decide, noted so the brief's wording isn't followed
   literally.
4. **Merchant tables already exist.** The brief lists `merchant`, `payout_run`, `payout_line`,
   `device_fleet`, `hardware_inventory` and `preorder` as new tables. The `merchant`, `payments` and
   `commerce` schemas already hold shops, hardware, readers, firmware, payouts and hardware orders,
   and the merchant app runs on them. Making copies would give two answers to "how many shops are
   transacting".
   *Default: Command's `live` merchant provider reads the existing schemas. New tables are only for
   what doesn't exist: the pipeline (`merchant_stage`, `merchant_activity`), prospects that aren't
   shops yet, and the founding/cap terms if they aren't already on the shop.*
5. **A new `command` schema.** People, groups, proposals, the audit log and everything else
   Command-only go in a `command` Postgres schema, beside `merchant`, `payments` and `rewards`. Its
   audit log is separate from `payments.audit_log`.
6. **Append-only audit log.** The API connects to Railway Postgres as one role that owns its tables,
   and an owner can't be denied UPDATE by a GRANT.
   *Default: a `BEFORE UPDATE OR DELETE` trigger that raises, plus REVOKE for any non-owner role, plus
   a test that both an UPDATE and a DELETE fail. If Kai wants it airtight against the owner too, the
   API needs a second, non-owner DB role for Command; that's a Railway change.*
7. **Deploy blocks are missing.** The indexer has to backfill "from each contract's deploy block",
   and every deployment file says `0`.
   *Default: find each contract's creation block once (binary search on `eth_getCode`), store it in
   `command.contract`, and backfill from there. Don't edit the deployment files.*
8. **There is no Ops Safe yet**, as far as the repo shows. Phase 4 needs its Base Sepolia address
   and its three signers' addresses (Kai, Dana Ruiz, the board signer).
   *Question for Kai: does the Safe exist? If not, should I write a script that creates a 2-of-3 on
   Base Sepolia for you to run from your own wallet?*
9. **Sign-in methods.** The brief wants passkey first and email code as the fallback. Many members
   signed up with SMS, Google or Apple, and may have no passkey or email. With only passkey and
   email offered, they can't reach their read-only view.
   *Default: passkey and email code on the sign-in screen exactly as drawn; members who signed up
   another way get a small "Other ways to sign in" link that opens Privy's SMS, Google and Apple.
   That's one link the prototype doesn't draw, so it goes in `DECISIONS.md`.*
10. **No live source for site visits, forms, waitlist or batches.** The marketing site stores no
    forms and runs no analytics, and the member app has no waitlist or batches.
    *Default: those stay on `seed` until a source exists. Batches and approvals become Command
    tables (the brief already says so). The live source for site visits and forms is a decision:
    Plausible on useclear.org plus a small forms endpoint in `apps/api`, or something else.*
11. **The shop has no stock or product admin.** The catalog is a TypeScript file in another repo and
    stock isn't stored anywhere. The brief says the shop is read-only from here, but the prototype's
    Products tab adds, edits and archives products, and Inventory tracks stock by size and colour.
    *Default: orders and refunds read live from Stripe (restricted read-only key); the catalog reads
    `content/shop.ts` at build time; inventory becomes a Command table. Edits to products and refunds
    become proposals, never writes to the live shop. Kai to confirm that's the intent.*
12. **The team.** The seed has Kai, Dana Ruiz, Marcus Lee, a board signer, an outside accountant and
    an investor (Lena Park). On dev those are seed rows. For anyone real to sign in, I need their
    emails, or Kai invites them from Permissions once Phase 2 lands.

## Kai's answers

Decided 2026-10-22. These replace the defaults above where they differ.

| # | Question | Decision |
|---|---|---|
| 1 | Branches | PRs into `dev`; `command.useclear.org` follows `dev` (testnet). `main` only when ready for real money. |
| 2 | API path | `/api/command/*`. |
| 3 | `apps/web` | It's `apps/member`. No decision needed. |
| 4 | Merchant data | Read the existing `merchant`, `payments` and `commerce` tables. New tables only for the pipeline, prospects and activity. |
| 5 | Schema | A new `command` Postgres schema, with its own audit log. |
| 6 | Audit log | A trigger that rejects UPDATE and DELETE, plus a test. No second DB role. |
| 7 | Deploy blocks | Find each creation block once and store it in `command.contract`. Deployment files stay untouched. |
| 8 | Ops Safe | Open until Phase 4. Phases 1–3 don't need it. |
| 9 | Sign-in | Passkey and email code as drawn, plus an "Other ways to sign in" link (SMS, Google, Apple). Recorded in `docs/command-reference/DECISIONS.md` when Phase 1 starts. |
| 10 | Site visits and forms | Plausible on useclear.org, and a small forms endpoint in `apps/api` that the site posts to. |
| 10b | Waitlist and batches | Built in Command. Waitlist joins land in a Command table from the site's form; batches are proposed and approved here and send invite codes the member app already accepts. |
| 11 | Shop | Orders and refunds read live from Stripe (restricted read-only key). Catalog read from `content/shop.ts`. Stock in a Command table. Product edits and refunds become proposals, never live writes. |
| 12 | Team | Seed people stay demo rows on `dev`. Real people are invited by email from Permissions once Phase 2 lands. |

Questions 10 and 10b touch `clearpath-website` (the Plausible script and the form posting to the API).
That work goes in its own PR on that repo, in Phase 7.

## Brief update 1 (2026-10-23)

[`command-reference/command-center-brief-update-1.md`](command-reference/command-center-brief-update-1.md)
changed the design and the brief while Phase 1 was open. Phase 1 wasn't merged, so it was applied
there rather than after.

- **New design:** replaced and re-ported. The DOM, sign-in and pixel checks pass against it.
- **Repo layout:** this plan already found `apps/member`; nothing changes.
- **Column charts:** the new design already sizes bars with `calc(var(--colh) * value / max)` and
  `flex: none`, and the port copies its stylesheet and markup, so the fix came with it.
- **Money and the yield pool:** the new tab, layouts and copy came with the port, on demo data. The
  data work is in Phases 3 and 5 below. Every function and event the update names is in the deployed
  Base Sepolia ABIs (`LendingPool`, `PayoutPool`, `RevolvingIssuer`), so there is no conflict to raise.

## Plan

One PR per phase into `dev`. Commits as each piece verifies; push at the end of each phase.

### Phase 1: shell and design system (built)

What was built differs from the first plan in three places; `docs/command-reference/DECISIONS.md`
has the detail.

- The markup is generated from the prototype by `apps/command/scripts/port` (`npm run port`),
  not retyped, so the DOM is the prototype's. The stylesheet is copied by the same script.
- The data stays in `apps/command/src/sections/data.tsx` for now, not `packages/command-types`. Phase
  3 moves it into the seed, typed, when the API serves it.
- Routes stay the prototype's hash routes (`#members`). Path routes can come with Phase 2's router.
- The checks compare with the prototype itself: DOM (every section and pane), sign-in (every
  state), pixels (1500, 1100 and 390 px, Paper and Ink) and a click crawl. The prototype's screenshot
  is the baseline, so no app baselines are stored.

### Phase 2: auth, people and permissions (built)

Built as planned, with the decisions in `command-reference/DECISIONS.md` (Phase 2). Two changes to
the plan: the read-only rules for the sections' own data stay in the browser until Phase 3 serves
that data (the API's own endpoints are enforced already), and Ops Safe signers wait for Phase 4.


- `/api/command/*` router behind `requireAuth`, then a `commandAccess` middleware: map the Privy DID
  to `command.person`, load effective levels (`custom ?? group`, at least the Members row), and expose
  `requireLevel(section, n)`.
- Level 1 handlers return co-op aggregates only, built by the server; person-level tabs aren't
  served. `vScrub` goes once that's true.
- Sign-ins, devices and sessions logged; 12-hour or browser-session sessions; sign out everywhere.
- Permissions page end to end, preview-as-group, investor invites with expiry, terms acceptance,
  data-room page views. Granting Approve becomes a proposal for a second admin.
- `command.audit_log`, append-only, written by one helper every mutating handler calls.

### Phase 3: database and seed (in progress)

Kai chose stored figures refreshed by jobs, and one PR per section group: 3a the foundation and
Members, 3b Growth and Field, 3c Merchants, 3d Shop and Money with the yield pool, 3e Contracts,
Governance, Records and Home. 3a is the pattern the rest follow (DECISIONS.md, Phase 3). After 3e, one
more step saves each section's own actions (a scan, a stage move, a document upload) through the API.


- Migrations for the rest of the `command` schema. Money in integer cents, UUIDs, timestamps.
- A seed that loads every row the prototype renders, from the shared fixtures.
- A provider interface per source with a `seed` implementation; `PROVIDER_<SOURCE>=seed|live`.
- Aggregates as views or materialized views refreshed by a job (`jobs/` has the pattern).
- Money: `yield_position` (per depositor: shares, assets, pledged, first deposit), and the yield
  pool's sample data in the seed: 18 depositors, daily balances since 15 Oct, the 4 Nov loan.

### Phase 4: two-person rule and the Safe (built: 4a #753, 4b #754, 4c; the handover waits on Kai)

Kai, 2026-10-23: Kai creates the Ops Safe (2 of 3 on Base Sepolia, the signers' own wallets) in
Safe{Wallet}; Command is built address-agnostic and tested against a throwaway Safe on a fork until
then. Signers sign in the app with their own wallet; Command never holds a key. The admin-role
handover is written and fork-tested now, and run by Kai later.

Already true: `command.proposals` refuses self-approval in the database and the API (Phase 2), and
the section actions' outbox records every on-chain act without carrying it out.

- **4a · Reading the Safe.** Config by env, never in code: `COMMAND_SAFE_ADDRESS`,
  `COMMAND_SAFE_CHAIN_ID` (84532), `SAFE_TX_SERVICE_URL` (default
  `https://api.safe.global/tx-service/basesep`, so a self-hosted service works too) and
  `SAFE_API_KEY` (Railway only; the hosted service wants one for real use). Owners, threshold and
  nonce read from the chain, pending and executed transactions and their confirmations from the
  service. Each Command person can link a wallet; a signer is a person whose linked wallet is an
  owner. Contracts' signers, "waiting on you" and signing speed come from here. Unset, Contracts
  says no Safe is connected and keeps the seeded rows.
- **4b · Proposing.** Each on-chain outbox kind gets a builder that ABI-encodes the call from
  `deployments/base-sepolia` (MerchantRegistry caps and on/off, the PayoutPool top-up as a USDC
  transfer, the monthly run, and a contract change picked by contract, function and arguments,
  checked against the ABI). Command builds the SafeTx and its EIP-712 hash at the Safe's next
  nonce; the signer signs it with their wallet in the browser; Command posts it to the service and
  marks the outbox row sent. Further signers confirm the same way, or in Safe{Wallet}. Executing
  links out to Safe{Wallet} at first. The prototype's "24-hour wait" needs a delay module on the
  Safe: noted, not built.
- **4c · Handing admin to the Safe.** `scripts/command/safe-handover.ts`: a dry run that lists
  every AccessControl role and Ownable owner across the deployed contracts and who holds it, and a
  run that grants each to the Safe and renounces it from the deployer, in that order, refusing to
  renounce anything the Safe doesn't hold yet. A fork test makes a 2-of-3 Safe with the canonical
  factory, runs the handover, and has the Safe execute an admin call with two test signers.

### Phase 5: indexer and contracts (in progress)

Kai, 2026-10-23: a polling job, not webhooks (efficient: one request covers every contract, and only
new blocks are read); GitHub polled with a read-only token; every deployed contract's events kept.

- **5a · The indexer.** `command.chain_contracts` holds the inventory from
  `deployments/base-sepolia`, with each contract's deploy block found once by a binary search on
  `eth_getCode` (the deployment files say 0). `command.chain_events` keeps every event from every
  contract, raw and decoded, unique on (chain, tx, log index). One `eth_getLogs` per page covers
  all 37 addresses; pages use the span each RPC allows (`logScan`), public RPC first, Alchemy only
  on rate limits. It indexes only to 5 blocks behind the head, and each run re-reads the last 30
  indexed blocks in the same request and reconciles them, so a reorg can't leave a ghost event.
  Every 5 minutes (`COMMAND_INDEXER_MINUTES`), plus a catch-up when someone opens Contracts or
  Money, at most once a minute. The first run backfills from the earliest deploy block.
- **5b · What Command reads from it.** Yield positions from LendingPool's Transfer, Deposit and
  Withdraw; the PayoutPool's loans and draws; releases from each proxy's `Upgraded` events; rates
  read on the server (`utilizationBps`, `borrowRatePerCycle`, `supplyRatePerCycle`,
  `RevolvingIssuer.cycleLength()`). Money's yield pool and Contracts' releases switch to these live
  (`PROVIDER_MONEY`, `PROVIDER_CONTRACTS`). Built: `services/command/onchain.ts`; the rest of each
  section stays on the tables until its source comes.
- **5c · Changes from GitHub.** A job asks GitHub for commits touching `contracts/` on `dev` every
  few minutes, with a fine-grained read-only `GITHUB_TOKEN` in Railway, into Contracts' changes.
  Built: `services/command/github.ts`, `jobs/commandGithub.ts`.

### Phase 6: sandboxes

- Lithic, Bridge, Plaid, Stripe test providers, reusing the API's existing clients. The feed-status
  line reads one row per provider.

### Phase 7: live shop and the rest

- The shop read-only from Stripe live with a restricted key. Members from the member tables. Site
  and forms depending on question 10. Map style URL and token to env.

### Phase 8: launch

- A new Vercel project for `apps/command` with `command.useclear.org`, the CSP, the PWA, the README.
  DNS is a CNAME at Namecheap, the same way `api.useclear.org` was added.

## Size

The prototype is 6,981 lines: 2,280 of CSS and about 4,650 of JavaScript across 11 sections,
roughly 45 tabs, and their panes and flows. Phase 1 alone is a port of most of that. I'll build it
section by section, with the visual test for each section passing before the next one starts.
