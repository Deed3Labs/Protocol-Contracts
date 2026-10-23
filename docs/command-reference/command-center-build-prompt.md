# Build the Clear Command Center (live, on testnet and sandboxes)

You're building the production version of the **Clear Command Center**: the internal web app and PWA the Clear co-op runs on, which is also the read-only transparency view every member gets and the data room for investors and lenders. The design is finished. It lives in one file, `clear-command-center.html` (attached; put it in the repo at `design/clear-command-center.html`). **That file is the spec.** Every page, tab, panel, modal, state and the copy match it. Your job is to make it real: real auth, real permissions, a real database, and real data from Base Sepolia and the sandbox providers. The app should look and behave exactly like the prototype.

Read this whole brief before writing code, then start with **Phase 0**.

---

## 0. Where things are

- **Monorepo.** It already has `apps/api` (Node, on Railway, with Postgres) and `apps/web` (the member app). Look at both first: package manager, framework, lint and test setup, how `apps/api` is structured and deployed, and how `apps/web` does Privy auth. Match what's there. Don't introduce a second way of doing anything the repo already does.
- **New app:** `apps/command` is the Command Center frontend. API work goes into the existing `apps/api` under its own route namespace (`/command/*`). Shared types go in a shared package if the repo has one; create `packages/command-types` if not.
- **Contracts:** `github.com/Deed3Labs/Protocol-Contracts`, **`dev` branch** (not `main`). Most contracts are deployed on **Base Sepolia** from there. Read deployed addresses from that repo's deployment files. Don't hardcode addresses you didn't find there. Don't use, adapt or import anything from `KyngKai909/Lending`.
- **Brand assets:** the mark and lockups are in the `clearpath-website` repo under `public/brand/`. Use the solid mark at app sizes.
- **Domains:**
  - Frontend at **`command.useclear.org`**.
  - API stays wherever `apps/api` already serves from. If it has no custom domain yet, use `api.useclear.org`.
  - `merchants.useclear.org` (merchant app) and the marketing site are out of scope. Don't touch them.

## 1. Stack and rules

- **Frontend:** use whatever `apps/web` uses (React + TypeScript). If it's Next.js, you can use Next with static export or SPA routing. Otherwise use Vite + React + TS.
  - Port the prototype's CSS as-is into a design-token stylesheet: `:root` tokens, Paper and Ink themes, the bento grid, `.cell` / `.c-hd` / `.c-fig` / `.c-body` / `.c-ft`, `.ptabs`, panes, modals, charts.
  - **Don't restyle anything.** No component library. The prototype's markup and class names are the components; turn them into React components with the same DOM and classes.
- **Hosting:** deploy `apps/command` wherever `apps/web` is deployed. If it isn't deployed anywhere, use Vercel, with preview deploys per PR. Add `command.useclear.org` as the production domain and set up DNS instructions for it.
- **API:** extend `apps/api` on Railway. Postgres with migrations, using the repo's existing migration tool or Drizzle/Prisma if there is none. Use Railway's Postgres and Railway env vars for every secret.
- **No private keys anywhere.** The app never signs on-chain transactions. Money and on-chain actions are *proposed* here and *signed* in the Ops Safe (Safe{Wallet}) by a second person. The app reads Safe state and links out to it.
- **Environment flag:**
  - `CLEAR_ENV=testnet` drives the **TESTNET** chip in the header and the "Testnet · demo data" footer in the profile menu.
  - Sandbox and test keys only, except the shop (§6).
- **Money formatting:** always `$1,234.56`, two decimals, tabular numerals. That's how the prototype does it, and it's deliberate.
- **Accessibility:** keep what the prototype already does (keyboard focus, Escape closes panes and modals, `aria-current` on tabs, `role="switch"` and similar). Don't regress it.

## 2. Auth: one login for everyone

- **Provider:** **Privy**, the **same Privy app as the member app**, so a member's Clear app login works here unchanged. Sign-in methods are passkey (primary) and email code (fallback), exactly like the prototype's sign-in screen, including all its states:
  - passkey wait
  - six-box code entry: auto-advance, backspace, paste, 30-second resend
  - "Keep me signed in for 12 hours"
  - the welcome screen
  - the investor terms step
- **Verify on the server:** the API verifies the Privy access token on every request (Privy server SDK) and maps the Privy user to a `person` row. No token, no data.
- **Sessions:** 12 hours if the "keep me signed in" box is checked, otherwise browser-session. Sign out ends the session and returns to the sign-in page.
- **Logging:** log every sign-in with time, device (UA parsed), and coarse location (city from IP). These feed Permissions → People and Records.
- **New device:** a sign-in from a device we haven't seen for that person creates a "new device" record that shows in Permissions → People → Sign-ins.

## 3. Permissions: groups, custom access, enforced on the server

This is the most important part to get right.

**Levels per section:** `0 None · 1 Totals · 2 See · 3 Propose · 4 Approve`.

**Sections:** `home, growth, field, members, merchants, shop, money, contracts, governance, records, access`.

**Groups:** these are the seed values. They're editable in the app, and new groups can be made.

| Group | home | growth | field | members | merchants | shop | money | contracts | gov | records | access |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Members (everyone with a Clear account, automatic) | 0 | 1 | 0 | 0 | 1 | 1 | 1 | 2 | 2 | 2 | 0 |
| Admin | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| Protocol | 2 | 2 | 0 | 4 | 2 | 1 | 4 | 4 | 2 | 2 | 0 |
| Field | 2 | 3 | 4 | 2 | 3 | 3 | 1 | 2 | 2 | 2 | 0 |
| Board | 2 | 1 | 0 | 0 | 1 | 1 | 2 | 4 | 4 | 2 | 0 |
| Outside (accountant, counsel) | 0 | 1 | 0 | 0 | 1 | 2 | 2 | 2 | 2 | 2 | 0 |
| Investors (data room) | 0 | 1 | 0 | 0 | 1 | 1 | 2 | 2 | 2 | 2 | 0 |

**How access works:**
- A person is in **one** team group, or has none and is just a member.
- A person can have **custom** access: a full level array that overrides their group. They then show as "Custom · from Field" everywhere.
- Effective access is `custom ?? group`. Every signed-in Clear account also gets at least the Members row.

**Enforcement is on the server, on every endpoint, not just in the UI:**
- **Level 0:** the endpoint returns 403. The frontend hides the section from the menu and tabs and redirects away from it.
- **Level 1 (Totals):** the endpoint returns **co-op aggregates only**. The data must come back from the server already without member names, emails, phone numbers, addresses or account/card identifiers. Don't send it and hide it in the UI.
  - Person-level tabs aren't served at all: Growth → Forms, Shop → Orders, Members → Accounts.
  - Member records don't open.
  - Staff names stay visible (who did what is part of the transparency).
  - The prototype's client-side `vScrub` is only a stand-in for this. Delete it once the server does it.
- **Level 2 (See):** read everything in the section, change nothing. Every mutating endpoint returns 403.
- **Level 3 (Propose):** can create proposals, drafts and edits that don't move money or chain state, but can't approve.
- **Level 4 (Approve):** can approve, but **never their own proposal** (the two-person rule, §5).
- **Granting Approve:** giving anyone Approve in a section they didn't already have needs a second admin's approval.

**Frontend behaviour** (it already exists in the prototype; port it):
- The menu shows only allowed sections.
- A read-only view shows the bar at the top ("You have the Members view · Co-op totals only…").
- Actions in read-only views are blocked with the toast ("Read-only · the Members view can look, not change").
- Search and the feed-status line are hidden for read-only views.
- Admins can **"Preview this view"** for any group, with an Exit preview button.

**Investors and the data room:**
- Investors are invited into the Investors group with an **expiry**. The default is 30 days after first sign-in, and admins can extend it.
- On first sign-in they must accept the confidentiality terms (the "Before you look" screen). Store the acceptance with a timestamp and the terms version.
- Log **every page and panel they open**, viewable in Records.
- Access ends automatically at expiry.

**Permissions page** (route `team`, labelled **Permissions**), with tabs Overview, Groups, People and Two-person rule:
- Make every flow real:
  - invite (any group, with investor-specific rows)
  - change group
  - customize access (click to cycle levels)
  - new group and edit group
  - turn access off and back on
  - sign someone out everywhere
- Invites email a link and sign in with the Clear app login, or create one.

## 4. Data model (Postgres)

Design it properly, but it must at least cover these. Use UUIDs and `created_at` / `updated_at` everywhere, and store money as integer cents.

- **People and access:**
  - `person`: Privy id, name, email, title.
  - `group`: name, description, levels jsonb, auto flag.
  - `person_access`: `group_id`, `custom_levels` jsonb nullable, `off`, `expires_at`.
  - `invite`
  - `device`, `session`, `sign_in`
  - `terms_acceptance`
  - `page_view` (data room)
- **Two-person rule:**
  - `proposal`: kind, payload jsonb, area, proposed_by, status, approved_by, approved_at, safe_tx_hash.
  - `rule`: the policy rows shown on the Two-person rule tab.
- **Audit log:** `audit_log` is **append-only**. The app's DB role gets no UPDATE or DELETE on it; enforce that with a grant or a trigger.
  - Every mutation in the app writes one row with who, when, from where, area, action, before/after, and result.
  - This is Records → Audit log, and "Nothing here can be edited" has to be literally true.
- **Members and growth:**
  - `member`: mirrored from the member app or its DB, read-only here.
  - `batch`, `waitlist_entry`
  - `poster`, `poster_scan`
  - `site_visit` aggregates
  - `form_submission`
- **Merchants:**
  - `merchant`: terms, fee, cap, founding, city, lat/lng.
  - `merchant_stage`: the pipeline board. Columns are stage, position, owner_person_id, per_month_cents, next_step, due_on, last_contact_at, contact jsonb, source, address, flag, notes.
  - `merchant_activity`: note, call, visit, demo, stage, edit; with who and when.
  - `payout_run`, `payout_line`
  - `device_fleet` (hardware), `hardware_inventory`, `preorder`
- **Shop:** `shop_product`, `shop_order`, `shop_inventory`. The shop is live (§6), so these are a cache of the live source.
- **Money:** `account_snapshot` (balances by source and time) and `reserve_check`.
- **Governance:** `entity`, `board_seat` (the Holdings board has **7 seats**), `vote`, `meeting`, `filing`, `calendar_event`.
- **Records:** `document` (uploads in object storage; use Railway volumes or S3-compatible).
- **Contracts:**
  - `contract`: address, name, version, network.
  - `contract_change`: from GitHub.
  - `chain_event`: the indexer output.

**Seed data:** write a seed that loads **every sample row the prototype renders** (members, batches, posters, merchants, pipeline, payouts, fleet, shop, entities, votes, documents, log, people, groups) so that, before any live source is wired, the app renders exactly like the prototype from the database. The data sits behind a provider interface per source (§6), so going live is a configuration change, not a redesign.

## 5. Two-person rule and the Ops Safe

- **Proposals:** anything that moves money or changes chain state is a `proposal`:
  - payout runs and top-ups
  - bond issues
  - contract upgrades
  - cap changes and shop terms
  - invite batches
  - member data exports
  - refunds over $50.00
- **Approving:** a different person with Approve in that area approves it. The proposer can never approve their own; enforce this in the API and with a DB check.
- **On-chain proposals:** these become **Safe transactions**. Use the **Safe Transaction Service API on Base Sepolia** to create the transaction for the Ops Safe (2 of 3: Kai, Dana Ruiz, the board signer), show its signatures and status live, and link to Safe{Wallet} to sign. The app never holds a signer key.
- **Where they show:** Home → Needs you, Waiting, Permissions → Two-person rule, Contracts → Changes. Use the prototype's waiting times and "usual wait" ticks, computed from real timestamps.

## 6. Data sources: provider interface, then live

Put each source behind a provider with two implementations, `seed` and `live`, picked per source by env var, for example `PROVIDER_MONEY=live`. Build all `seed` providers first, then turn sources live one at a time.

| Area | Live source (testnet / sandbox) |
|---|---|
| Chain state and events | **Alchemy** (Base Sepolia RPC and Webhooks). Build an indexer service in `apps/api`: backfill with `eth_getLogs` (paged `logScan`) from each contract's deploy block, then keep current with Alchemy webhooks. **Persist** to `chain_event` with block, tx, log index and decoded args, so pages read Postgres, not the RPC. It must be idempotent and reorg-safe (confirmations ≥ 5, re-check the last N blocks). |
| Contract inventory and change history | Deed3Labs/Protocol-Contracts `dev`: deployment files for addresses, ABIs from build artifacts. **GitHub webhooks** (push / PR on `contracts/**`) into `contract_change`, linked to the upgrade proposal it relates to. |
| Ops Safe | Safe Transaction Service API (Base Sepolia). |
| Cards and accounts | **Lithic sandbox**. |
| USDC rails and balances | **Bridge sandbox**. |
| Bank links and balances | **Plaid sandbox** (Money → "Plaid is 3h behind" uses real sync times). |
| Payments | **Stripe test mode**. |
| Shop | **Live, read-only.** Find how useclear.org/shop takes orders (check the repos). If it's Stripe, use a **restricted live key with read-only scopes**. Never write to it from here. Customer addresses stay hidden until "pack" is opened by someone with Shop ≥ 3 (as in the prototype). |
| Members, batches, waitlist | The member app's database or API (read-only), plus Command Center tables for batches and approvals. |
| Site visits and forms | The marketing site's analytics and form store (check `clearpath-website`). Personal details stay hidden until asked for (logged). |
| Map | **MapLibre GL + OpenFreeMap** now, exactly as built. Put the style URL and token in env (`MAP_STYLE_URL`, `MAPBOX_TOKEN`) so switching to **Mapbox** later is config only. Keep the drawn fallback map for when tiles fail. |

The feed-status line at the bottom of the menu ("Plaid is 3h behind · 3 other feeds synced") is real: one row per provider, with last sync and health.

## 7. What "done" looks like for each section

The prototype already defines each screen. Wire it to the API, and make every button do its real thing (or create the real proposal):

- **Home:** Needs you (real proposals), Moving (live jobs), Changed (audit log).
- **Growth:** visits, joins, cohorts, posters (inventory, scans, swaps), shops and designs, forms.
- **Field:** the phone route mode: this stop, route, today's log, adding posters, scanning a code.
- **Members:** the squares chart (fixed rows; each square stands for more people past 360, as built), batches (propose and approve), accounts.
- **Merchants:**
  - Overview with the partner map.
  - **Pipeline board:**
    - Drag and drop (pointer events, touch-and-hold, with FLIP animations as built).
    - The shop side panel (stage track with confirm steps, owner picker from Permissions, due dates, Done, activity log, contact, source, take off the board with a reason).
    - "Add a prospect".
    - Every change writes `merchant_activity` and the audit log.
  - Partners, payouts (real payout lines; runs need two people), hardware fleet (device status from check-ins).
- **Shop:** live catalog, inventory, orders, pre-orders and refunds.
- **Money:** where it sits (account snapshots), reserves (on-chain pools from the indexer), credit, bonds, schedule.
- **Contracts:** agreements, the on-chain map, and changes (GitHub plus Safe).
- **Governance:** entities, boards (7 Holdings seats), meetings and votes, calendar, filings.
- **Records:** activity, documents (upload and versions), the audit log (append-only), the data-room page views.
- **Permissions:** §3.

## 8. Non-functional requirements

- **PWA:** manifest, icons (solid mark), installable, offline shell. Field mode works with a weak signal: queue actions and sync later.
- **Security:**
  - Strict CSP, allowing only the map tile and style hosts and Privy.
  - CORS locked to `command.useclear.org`.
  - Rate limits on auth and writes.
  - Secrets only in Railway and Vercel env.
  - Dependabot.
  - No PII in logs.
- **Performance:** the first page interactive in under 2s on a mid phone. Aggregates come from Postgres views or materialized views refreshed by jobs, not computed per request.
- **Tests:**
  - API: permission matrix tests for every endpoint and every level (0–4) for at least Members, Investors, Field and Admin.
  - Two-person rule tests, including that self-approval is impossible.
  - Audit log append-only test.
  - **Playwright visual tests:** each route and tab against the prototype at 1500, 1100 and 390 px in Paper and Ink, so the design can't drift.
- **Docs:** `apps/command/README.md` covering env vars, how to run locally against seed data, how to flip each provider to live, and the DNS steps for `command.useclear.org`.

## 9. Phases (open a PR per phase; keep `main` deployable)

0. **Read and plan.** Inspect the repo (`apps/api`, `apps/web`, the existing Privy setup, the deploy targets) and the contracts repo's `dev` deployments. Write `docs/command-center-plan.md` with what you found, any conflicts with this brief, and the plan. **Stop and ask Kai before building if something here conflicts with what's in the repo.**
1. **Shell and design system.** Port the CSS and shell (top bar, menu, sticky tabs, panes, modals, toasts, themes), the sign-in page and routing. Visual tests against the prototype.
2. **Auth, people and permissions.** Privy server verification, `person` / `group` / `person_access`, enforcement middleware, the Permissions page fully working, preview-as-group, investor invites with expiry and terms, audit log.
3. **Database and seed.** Full schema and migrations, the seed from the prototype, `seed` providers. Every page renders from the DB and matches the prototype.
4. **Two-person rule and Safe.** Proposals end to end, Safe Transaction Service integration, Needs you and Waiting.
5. **Indexer and contracts.** Alchemy backfill and webhooks into `chain_event`, the contract inventory from `dev` deployments, GitHub webhooks into `contract_change`. Money → Reserves and Contracts read real Base Sepolia data.
6. **Sandboxes.** Lithic, Bridge, Plaid and Stripe test providers live, plus the feed-status line.
7. **Live shop and the rest.** The shop goes live read-only, then the member app, site and forms sources. The map style goes to env.
8. **Launch on `command.useclear.org`.** DNS, PWA, CSP, the visual tests green, the README done.

At the end of each phase, report what's live, what's still on seed data, and anything you had to decide that Kai should know about.
