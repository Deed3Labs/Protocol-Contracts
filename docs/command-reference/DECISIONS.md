# Decisions taken over the reference

`clear-command-center.html` in this folder is the spec. Where the app departs from it, or where the
way it was built needs explaining, the decision is recorded here so a later reader doesn't undo it.
The answers to the plan's open questions are in [`../command-center-plan.md`](../command-center-plan.md).

Decided 2026-10-22, Phase 1.

## How the prototype became React

- **The markup is generated, not retyped.** `apps/command/scripts/port` turns the prototype's HTML
  template strings into JSX with Babel, so every tag, class, attribute and line of copy comes from
  the prototype itself. `npm run port` regenerates `src/sections` from this file; `npm run port --
  --to DIR` writes elsewhere, to diff a new version of the prototype against the port.
- **Data, functions and start-up are split.** `src/sections/data.tsx` holds every figure and row the
  prototype draws, in the prototype's order. Each section file (`home.tsx`, `growth.tsx`, …) holds
  only that section's functions. `startup.tsx` is the prototype's top-level statements: the event
  listeners, the theme and menu set-up, and the first draw. Phase 3 moves `data.tsx` into the
  database seed.
- **Drawing works the way the prototype's did.** The prototype assigned HTML to a few containers
  (`#main`, `#modalRoot`, `#pfRoot`, `#loginRoot`, the menu and the phone tabs) and listened for
  clicks on `document`. Each container is now a React root and `html(el, jsx)` replaces
  `el.innerHTML = …` (`src/runtime/dom.tsx`). Every draw builds fresh DOM, as innerHTML did, so
  entry animations replay, inputs reset, and anything the prototype changed by hand doesn't survive
  into the next draw.
- **Not typed yet.** The generated files start with `// @ts-nocheck`. The data is positional tuples
  that only make sense once they are real rows, and typing them twice would be waste: Phase 3
  replaces them with typed rows from the API, and each section is typed as it is wired.
- **React escapes text.** The prototype's `esc()` calls are gone; JSX escapes for us. That is also
  why markup is never built as a string anywhere in the port.

## Changes to the prototype's code

None of these change what is drawn. The DOM and pixel checks below prove it.

| Where | The prototype | The port | Why |
|---|---|---|---|
| Merchants map | Adds a `<script>` from unpkg for MapLibre | Imports the `maplibre-gl` npm package when the map first shows | No third-party script hosts under the CSP (Phase 8). |
| `spark()` | Declared twice; the second (Growth's) wins everywhere | Only Growth's is kept | The first was dead code. |
| `gCell(…).replace('class="c-body"', …)`, `miniSpark(…).replace(…)`, `areaKey().replace(/…/)` | Edits finished HTML strings | A parameter: `gCell(…, bodyCls)`, `miniSpark(…, cls)`, `areaKey(bare)` | Markup isn't a string any more. |
| `fund.replace('cell s-5', …)`, `appr.replace('cell s-4 wt', …)` | Edits finished HTML strings | `swapClass(el, from, to)` | Same reason. |
| Modals | `#mt` and `.m-mn` redrawn by setting their innerHTML | The title, body and foot are their own roots | So a flow can redraw one part, as before. |
| The board's side panel | `pane.innerHTML = kcHtml()` | The panel is its own root | Same reason. |
| Sign-in | Copies the top bar's logo with `outerHTML` | The `BrandMark` component | Same mark, drawn once in code. |
| `index.html` | No viewport tag (the prototype ran in a frame) | `width=device-width` | The 390 px phone layout needs it in a real browser. |

## Still the prototype's, on purpose

- **Hash routes** (`#home`, `#members`) and the pane state held in memory, exactly as drawn.
- **Sign-in is the prototype's simulation.** Privy, the server check and real sessions arrive in
  Phase 2.
- **Read-only views and "Preview this view"** still use the prototype's client-side rules, including
  `vScrub`. Phase 2 moves the rules to the server and deletes `vScrub`.
- **Demo data.** Everything on screen is the prototype's figures until Phase 3.

## How it's checked

`apps/command/e2e`, on the installed Chrome:

- `parity.spec.ts`: the canonical DOM of the menu, the phone tabs and the page, for every section and
  every pane tab, against the prototype.
- `signin.spec.ts`: every sign-in state against the prototype.
- `visual.spec.ts`: every section and pane at 1500, 1100 and 390 px in Paper and Ink. The
  prototype's screenshot is the baseline, so the baseline can't drift from the design.
- `crawl.spec.ts` (`npm run test:crawl`, slow): up to three of each kind of button on every page
  and pane, clicked in both, comparing what opens.

**The prototype is compared in standards mode.** The file has no `<!doctype html>`, so opened on its
own a browser renders it in quirks mode, where tables don't inherit `line-height` and every table
row's text sits a pixel lower. Claude's artifact viewer, where the design was drawn and reviewed,
adds the doctype, and so does the app; the checks serve the prototype with one.

## Phase 2: sign-in, people and permissions

Decided 2026-10-23.

- **Live and preview.** The app is live by default: Privy, the API, the real team. `?preview=1`
  (dev only) is the prototype as drawn, with its simulated sign-in and demo team; the checks against
  the prototype run on it. The live code sits behind `LIVE` in the sections, so the preview's DOM is
  unchanged.
- **The screens are the prototype's; Privy is headless behind them.** Passkey and email code use
  Privy's own hooks (`useLoginWithPasskey`, `useLoginWithEmail`).
- **Additions the prototype doesn't draw:**
  - An "Other ways to sign in" link under the email form opens Privy's window for SMS, Google and
    Apple, for members who joined that way.
  - A wrong code goes back to the code boxes with a toast; a refused sign-in ("no Clear account",
    "access is off") shows in the email box's own error line.
- **Who counts as a member.** A Privy login alone isn't a Clear account. The Members row goes to
  logins the member store recognises (`resolveCanonicalAuthSubject`); anyone else needs an invite.
  Without that, anyone could make a Privy login and read the member view.
- **The first admin** is whoever signs in with an address on `COMMAND_ADMIN_EMAILS`.
- **No wallet needed.** The Command Center checks the Privy token itself (`requireIdentity`), so an
  outside accountant or an investor with no Clear wallet can sign in. The member app's idle lock
  doesn't apply here; the Command Center has its own 12-hour sessions.
- **The second admin.** Giving anyone Approve, and anything proposed by someone who can only
  propose, waits in Home → Needs you for another admin. The proposer can't approve it: the API
  refuses, and so does a CHECK in the database.
- **People on the Permissions page get short ids** (initials, as the prototype's `K`, `DR`) mapped to
  their real ids, because the page draws avatars from them. Demo rows in sections still on demo data
  (Records, Contracts) keep naming the demo people until Phase 3.
- **Still client-side until Phase 3.** The read-only bar, the blocked buttons and `vScrub` (names
  hidden at Totals) still run in the browser for the sections, because those sections still draw
  demo data. Everything the API serves is enforced on the server already; `vScrub` goes when the
  sections' data does.
- **Ops Safe signers** show as none on the Permissions page until the Safe arrives (Phase 4).

## Phase 3: the database behind the pages

Decided 2026-10-23 (Kai: stored figures, one PR per section group).

- **Rows are tables; figures are stored figures.** What a section lists (members, batches, …) is
  in tables. The numbers it shows that aren't counted from its own rows (a weekly series, the
  waitlist's shape) are rows in `command.figures`, by name, with their source and when they were
  computed. The seed writes the prototype's values; live jobs overwrite them from real sources in
  Phases 5–7, and the seed never overwrites a figure a job wrote.
- **Anything the rows can count is counted.** "64 people are one step from active", the batch
  totals, "48% active in batch 1" and the like are computed from the rows, so they can't drift from
  them. The preview's DOM checks prove each computed figure matches the prototype's.
- **A seeded database is read as of the prototype's day** (21 Oct 2026), so days-left and "went out
  yesterday" match the design. Live data is read as of today.
- **One source for the sample data.** `apps/command/scripts/fixtures.ts` writes the prototype's rows
  into `packages/command-types/src/fixtures`; the API's seed loads them and its tests compare what it
  serves with them. The figures' seed values live in `packages/command-types/src/figures.ts`, which
  the preview draws from too.
- **Names are decided on the server.**
  - At See and above, names leave the API masked (`P••••`), and in full only when someone asks
    (`?reveal=1`), which writes an audit row. The prototype showed first names unmasked in the
    squares' tooltips; the live app doesn't.
  - At Totals, member rows carry no name, member number, poster or dates, since each of those could
    point to one person; only what the overview counts by (batch, stage, city, funding, first-spend
    shop) is sent. The Accounts tab, a list of people, isn't shown.
  - `vScrub` no longer runs on sections the API serves; it goes entirely when the last one is.
- **Until a section is served, the live app still draws its demo data.** Members is first (3a).
  Growth and Field, Merchants, Shop and Money, then Contracts, Governance and Records follow, with
  Home last because it summarises the others.

### 3b: Growth and Field

- **Rows:** the 102 posters and their three designs, the website's forms, and the day's route (its
  stops, tasks, the shops due later, and the route's own facts: who drives it, when it started, the
  miles). **Figures:** visits, sources, landing pages, the heat map, cohorts, per-shop 30-day numbers,
  devices, returning visits and the rest of Growth's analytics.
- **Design totals.** Posters per design are counted from the posters. The prototype's scans and joins
  per design don't equal its posters' sums, so they're stored figures.
- **Growth counts members without reading them.** Cohorts and the nudge card need how many members
  are invited, opened, active and how they funded. The API counts that and sends only the counts,
  because Growth at Totals (every member) has no access to Members.
- **The swap Growth suggests** (Redlands Tire & Lube, 12.0%) is worked out: the top shop whose scans
  turn into joins least often. So is the scans-to-joins line on the shops chart (all shops, boards
  and the rest).
- **Forms are personal.** Names and emails leave the API masked unless asked for (logged); at
  Totals the inbox isn't sent and the Forms tab isn't shown.
- **Field's actions** (saving a scan, adding a stop) still change only the page, as in the prototype;
  they're saved through the API in a later step, with the other sections' actions.

### 3c: Merchants

- **Rows:** partner shops (`command.merchants`: terms, fee, cap, founding seat, city and place),
  their cap hits, originations and losses, monthly sales, the $10 redemptions owed to each, the
  pipeline board's cards (`merchant_stage`, with `merchant_activity` ready for the board's log), and
  the hardware fleet with each shop's last check-in. The seed provider reads these; the live one will
  read the merchant app's own tables, as the plan decided.
- **The board's cards are rows, not a recipe.** The prototype built them in code from the prospect
  and signed lists plus hand-written due dates and contacts (`kbSeed`). The fixture script runs that
  code once and stores what it made; the live app draws the board from the rows.
- **Counted:** every stage count, "44 shops", the founding seats taken and open, what the shops in
  talks would finance, terms, fees and caps by shop, $10s owed and to how many, which shops are in
  each payout run and its total, the shops needing a visit, and the titles ("Seven shops are in
  talks.").
- **Stored figures:** the weekly series, the payout schedule (run dates and the next NET-14
  estimate), the share already collected, the pre-orders and unit cost. The pipeline tab's owners
  and shop kinds are stored too: the prototype's add up to 16 against 14 open shops.
- **Totals (every member)** sees the same shops and numbers. A shop's contact (name, phone, email)
  and address are its people's, so the board's cards leave the API without them.

### 3d: Shop and Money, with the yield pool

- **Money's rows:** the accounts and their weekly balances, each account's activity (written into
  the prototype's drawing code, now `ENTRIES` in its data), the bonds and the yield pool's
  depositors. **Figures:** the credit book, payouts due, the floor, the pool's principal, curve and
  history, the Assurance and credit weeks, the co-op's weeks, flows, the payout queue, aging and limit
  sizes.
- **The headline numbers are worked out on the server.** M (cash, savings, payout, Assurance, the
  floor, room, the shortfall) and the yield pool's Y (assets, utilisation, rates, APY, what it would
  cover) are computed in the API with the prototype's own formulas, in the same order, so the
  figures match to the cent; the brief's update says rates are never worked out in the browser.
  Phase 5 swaps these sums for the contracts' reads.
- **Depositors are never named.** A depositor is the last two hex characters of their address and
  the page masks even that (`M•••4f`), for everyone. The order deposits came in breaks ties.
- **Shop's rows:** the catalog, stock by colour and size, the shelf's periods and each product's
  history, the recent orders, hardware pre-orders, what's ordered and planned, and returns with their
  refunds. **Figures:** each product's weekly sales, weekly orders, what selling costs (shipping,
  card fees, the sales-tax rate on the taxable share), running the line, sizes sold, pickups by shop,
  days to ship, who buys and how they paid.
- **Counted, no longer written in:** the shop's 4-week totals (worked out again from the rows with
  the prototype's formulas), the share of member buyers and of mediums and larges, the cheapest,
  costliest, lowest- and highest-margin products, what earns most, the restock dates, what's back
  on, the next draft, what's archived, cover and the reorder list, batches arriving and planned,
  orders done, the median to ship and the share within 2 days, returns and refunds, unfinished
  pre-orders, and the refund waiting on a second person (who, and for how long).
- **Money's set-aside comes from the shop.** Sales tax held and pre-order deposits are worked out on
  the server from the shop's rows and sent with Money, so Money doesn't need Shop loaded.
- **Orders are personal.** The buyer is stored as a first name and last initial, which is how the
  prototype shows them while packing; addresses aren't stored (packing reads them from Stripe in
  Phase 7). At Totals the orders leave with no buyer, city or time, the returns aren't sent, and the
  Orders tab isn't shown. Unlike Members and Forms there's no masked view to reveal: the design
  shows a first name to the person packing, and nobody below See sees an order.
- **Refunds and shop actions** (restock, pack, refund, nudge) still change only the page; they're
  saved through the API in the step after 3e.

### 3e: Contracts, Governance, Records and Home

- **Contracts' rows:** every agreement (the merchant ones built by the same function the app runs at
  start, and the one out for signature with its lane), the contracts with their map status lines,
  how they connect, releases and the next one waiting, changes in flight and done, and the Safe's
  signers. **Figures:** the chain and Safe rule (network, block, 2 of 3, 24-hour wait), who holds each
  role, draft-to-live days, signatures a week and the days shops were added to MerchantRegistry, all
  of which Phases 4–5 read from the chain and the Safe.
- **Governance's rows:** the entities and their facts, filings, boards and seats, who sits where, the
  agenda, resolutions, the member vote, every body's meetings, related-party deals and who decides
  what. **Figures:** past turnout, meetings held and minutes filed (the prototype says 12 held and its
  own lanes show 11, so it's stored), and the next meeting's packet and replies.
- **Counted, no longer written in:** live and not funded contracts, renewals and the first one,
  what waits on your signature and who signed last, each signer's queue and speed, releases this
  week and the fastest-moving contract, the open door in the roles, the median and averages of
  draft-to-live; seats on the ballot and when, investor seats, the longest term, recusals and
  conflicts, resolutions by board, open matters and what the co-op seats can stop, the next meeting,
  quorum day, turnout, the next filing, the busiest month and who files; approvals and what's
  waiting, drafts, documents by entity, new devices and the busiest person; and on Home the funnel's
  rates, activation (counted from the members), posters, the $10s owed by shop with today's payout
  shop, the next payout run and the next filing.
- **Still the prototype's words:** a few clauses that name a reason the rows don't carry ("when the
  Graphic Tees were new", "confirmed by Kai", "he steps out of votes between them", a document's
  access list, the agenda's clock times).
- **The log is never seeded.** Records' log, its activity heat map and the approvals matrix read
  `command.audit_log` and `command.proposals`, live and in the seeded database alike: an append-only
  record shouldn't hold sample rows. People get the same short keys Team gives them. At Totals the
  log and approvals aren't sent and the Audit log tab isn't shown; documents and counts are.
- **Home counts on the server.** `/sections/home` sends the member counts, the $10s owed with shop
  names, the poster count, the filings due in 30 days and its figures, so Home needs no other section
  loaded. Its deadlines now come from Governance's filings, so live they read "Annual report ·
  ClearLabs Inc." where the prototype wrote "Wyoming annual report · ClearLabs Inc".
- **`vScrub` is preview-only.** Every section is served now, so live the API decides what Totals
  gets. The preview's simulated Totals view still scrubs, as the prototype did.
- **Actions** (sign, renew, log a decision, send the packet, upload) still change only the page; the
  next step saves them through the API.

## Saving each section's actions

Decided 2026-10-23 (Kai: record outside acts without carrying them out; store files for real; save
what's typed, not the prototype's samples).

- **One endpoint, three outcomes.** `POST /api/command/actions/:section/:kind`
  (`services/command/actions.ts`) needs Propose on that section, validates the body, and then:
  - **Command's own record** (a poster replaced or added, a field scan, a route task, a board card,
    the shelf, an order's packing state, a filing's status, the agenda, a formation step, a
    related-party payment, documents): saved, with an audit row.
  - **An outside act** (a payout or payout run, a refund, a restock order, postage, a PayoutPool
    top-up, a Safe signature, e-signature, invites and member messages, a Plaid sync, the live shop's
    catalog): recorded in `command.outbox` and **not carried out**. Phases 4–7 connect the Safe,
    Stripe, Shippo, the e-signature tool and messaging, and work through the outbox. The flow's
    closing words say so.
  - **A second person first**, where the action's own copy says so: money over $50 (refunds,
    restocks, deposits), every on-chain change (caps, the payout run, a top-up), invite batches and
    pace, a member vote, a reserved matter. It waits as a proposal in Needs you and runs when someone
    else approves it; the proposer can't, by the API and by the database.
- **Needs you is real.** Live, it lists every waiting proposal in every area the person can see
  (`GET /proposals?area=all`), not the prototype's four samples.
- **A seeded section's actions happen on the prototype's day** (21 Oct, 14:00), so a replaced poster
  reads "today" on the seeded pages; the audit log keeps the real time.
- **The board saves card by card.** Its cards are edited on the page as before; each change saves the
  whole card and the log lines added since, and a drag saves the order. A card taken off the board is
  kept (`removed_at`, with why) and Undo puts it back.
- **Files are stored.** `command.files` in Postgres for now, behind one interface
  (`services/command/files.ts`) so a bucket can take over: PDF, images, Word, Excel and text, up to
  25 MB, fingerprinted. Documents keep every version. Downloads are logged. A share link is
  view-only, expires after 1, 7 or 30 days, keeps only the token's hash, opens without signing in at
  `/api/command/shared/:token`, and logs each open. Field scans keep their photo.
- **What's typed is saved.** Adding a product, a poster or a document takes its name, price, city,
  kind and entity from the flow; the prototype's sample rows only appear in the preview.
- **Not yet:** the download isn't watermarked (the flow still says it is), share links can't be
  revoked from the page, and the outbox has no page of its own (`GET /outbox` lists it).

## Phase 4: the two-person rule and the Safe

Decided 2026-10-23 (Kai: he creates the Ops Safe, Command stays address-agnostic; signers sign in
the app with their own wallet; the admin handover is written now and run by him later).

- **The Safe is config.** `COMMAND_SAFE_ADDRESS`, `COMMAND_SAFE_CHAIN_ID`, `SAFE_TX_SERVICE_URL`
  (hosted at `api.safe.global/tx-service/basesep`, or self-hosted) and `SAFE_API_KEY` (Railway; the
  hosted service wants a key for real use). Without them Contracts says no Safe is connected.
- **Command never holds a key.** It builds each Safe transaction and its EIP-712 hash; the signer's
  own wallet signs it (Privy shows the prompt); Command checks the signature recovers to that
  person's linked wallet and that the wallet is an owner, then hands it to the Transaction Service.
- **A signer is a person with a linked wallet that owns the Safe.** Linking signs a one-time,
  10-minute message; one wallet per person.
- **Calls come from the deployed ABIs** (`packages/command-types/src/chain`, written by
  `apps/command/scripts/abis.ts` from `deployments/base-sepolia`; functions only, no Solidity).
  Builders: a shop's cap (`updateTerms`, keeping its window and fee as they are on chain), shop
  on/off (`setActive`), the payout run (`payQueue`), the PayoutPool top-up (the reserve token's
  `approve` then `fund`, as one transaction through MultiSendCallOnly 1.4.1), and a contract change
  picked by contract, function and arguments, checked against the ABI.
- **Nonces:** the next after the chain's nonce and anything already queued. Building again
  supersedes what was built and not yet proposed.
- **Checked against the chain:** the Safe contracts' own `getTransactionHash` on Base Sepolia (1.4.1
  and 1.3.0) matches Command's hash for one call and for a batch (`CHAIN_CHECK=1`).
- **Not yet:** executing happens in Safe{Wallet} (linked); the prototype's 24-hour wait needs a
  delay module on the Safe; shops need their wallet on Command's merchant row
  (`command.merchants.wallet_address`) until the live provider reads the merchant app's.

### 4c: handing admin to the Safe

- **`scripts/command/safe-handover.ts`** (Kai runs it; Command never does). Dry run by default,
  needing no key: every deployed contract, who holds each role and `owner()` now, and the exact
  plan. `MODE=run CONFIRM=handover` carries it out with the deployer's key from Kai's own env.
- **What moves:** admin roles (`DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `UPGRADER_ROLE`,
  `REGISTRY_ADMIN_ROLE`, `PAUSER_ROLE`) and ownership. Grants and transfers first; each renounce
  only after the Safe is seen to hold that role, a contract's default admin last. The Safe is also
  granted the operational roles its own proposals need (MerchantRegistry `OPERATOR_ROLE`,
  PayoutPool `FUNDER_ROLE`) without taking them from anyone.
- **Three kinds of handover, all found by rehearsing it:** a plain grant; ClearUSDUpgradeable's
  timed default-admin transfer (begun by the deployer, accepted by the Safe after its 48-hour
  delay); and two-step ownership on CLRUSDTokenPool (Chainlink-style, no `pendingOwner()`), which
  the Safe accepts. `owner()` alone isn't ownership: on ClearUSDUpgradeable it only reports the
  default admin.
- **The drill** (`FORK_RPC_URL=https://sepolia.base.org npx hardhat run
  scripts/command/drill_safe_handover.ts`) makes a 2-of-3 Safe through Safe's own factory on a fork,
  runs the handover as the impersonated deployer, has the Safe accept what it must, and checks the
  Safe holds all 31 admin roles and owns all 14 contracts, the deployer holds none and can't grant
  roles, two signers can make the Safe call MerchantRegistry, and one can't. It passes.
- **Worth knowing:** the deployer wallet also holds every operational role (operators, settlers,
  minters, the funder). The handover leaves those where they are, so the deployer stays a powerful
  key until they're moved to dedicated service wallets (or the Safe, with `INCLUDE_ROLES`).

### Moving the operational roles off the deployer

The deployer wallet held every admin role and every operational one. The handover above moves the
admin roles; `scripts/command/ops-roles.ts` moves the rest, to the wallet that does each job.

- **The map** (`scripts/command/ops-roles.map.json`), from reading the API and the contracts:
  - **credit operator** (`CREDIT_OPERATOR_PRIVATE_KEY`): AccessManager `OPERATOR`
  - **savings relayer** (a Coinbase CDP wallet by default): ESADepositVault `OPERATOR_ROLE`,
    SavingsIntentFactory `SETTLER_ROLE`, and CollateralRegistry `OPERATOR_ROLE` (the savings sync
    signs collateral writes as the savings relayer unless `COLLATERAL_SIGNER_MODE=local_key`)
  - **send relayer**: ClaimEscrow `SETTLER_ROLE`
  - **card settler** (`CARD_SETTLER_PRIVATE_KEY`): LendingPool `BORROWER_ROLE`
  - **membership registrar** (`MEMBERSHIP_REGISTRAR_PRIVATE_KEY`): MembershipRegistry `REGISTRAR_ROLE`
  - **the Ops Safe**: every config-only operator role, MerchantRegistry `OPERATOR_ROLE` and PayoutPool
    `FUNDER_ROLE` (Command proposes those), FundManager's and Validator's managers
  - **renounced**, used by nothing off-chain: AccessManager `MEMBER`, LendingPool `LOSS_REPORTER_ROLE`,
    LimitCalculator `ATTESTOR_ROLE`, SavingsIntentFactory `CREATOR_ROLE`, DeedNFT `MINTER_ROLE` and
    `VALIDATOR_ROLE`, MetadataRenderer `VALIDATOR_ROLE` (never checked there), FundManager
    `MINTER_ROLE` (checked by nothing), the legacy vault's operator
- **Order:** this first, while the deployer can still grant; then the admin handover.
- **AccessManager:** `isOperator` is true for its default admin too, so the deployer stops being an
  operator only once the admin handover moves that admin to the Safe.
- **Found on chain:** the Liquidator contract doesn't hold LendingPool's `LIQUIDATOR_ROLE`, which
  `liquidateShares` needs; no script ever granted it. `FIX_CHECKS=1` grants it during a run.
- **The API no longer falls back to the deployer's key.** Each job signs with its own key or does
  nothing (`DEPLOYER_PRIVATE_KEY` was the fallback in eight services).
- **The drill** (`scripts/command/drill_ops_roles.ts`) runs both scripts on a fork and passes: the
  deployer ends holding no role and owning nothing, and each job's wallet can still do its job.

## Phase 5: the indexer and contracts

Decided 2026-10-23 (Kai: a polling job, made as cheap as it can be; GitHub polled with a read-only
token; every deployed contract's events kept).

### 5a: the indexer

- **Every event from every deployed contract**, raw and decoded, in `command.chain_events`, unique
  on (chain, tx, log index). The inventory is `deployments/base-sepolia` (37 contracts).
- **Cheap by design.** One `eth_getLogs` covers all 37 addresses. Only blocks not read before are
  asked for. Every 5 minutes (`COMMAND_INDEXER_MINUTES`), plus a catch-up when someone opens
  Contracts or Money, at most once a minute. Measured against Base Sepolia: a quiet run is one
  request.
- **Two sources, each for what it's good at.** Base's public RPC answers `eth_getLogs` 200 blocks at
  a time (it says so, and the indexer reads the cap from the refusal): right for keeping up, since 5
  minutes is 150 blocks. History comes from a block explorer, a contract at a time over any range:
  the whole history (3,359 events) took 37 calls and 98 seconds. Etherscan V2 when
  `ETHERSCAN_API_KEY` is set; Blockscout otherwise, which rate-limits callers without a key.
- **Deploy blocks** (the deployment files say 0) come from the explorer's contract-creation API, five
  a call, each checked against the chain (code at that block, none the block before); a halving
  search on `eth_getCode` finds any the explorer doesn't know. 37 found with 74 chain reads.
- **Reorg-safe.** Indexed only to 5 blocks behind the head; each run reads the last 30 indexed
  blocks again in the same request and reconciles them.
- **The public RPC first, Alchemy only on a rate limit**, as the API does elsewhere. Any other
  refusal is the public RPC's answer.
- **Status:** `GET /api/command/chain/status`: how far it's read, how far behind, the last error.

### 5b: the yield pool and releases, live

`PROVIDER_MONEY=live` and `PROVIDER_CONTRACTS=live` (`services/command/onchain.ts`). Only the parts
with a source so far switch: the rest of Money (the bank accounts, bonds, the credit book) and of
Contracts (the map's layout, notes, changes) are still the tables' until their sources come.

- **The contract says where it stands; the events say how it got there.** Assets, shares, what's
  lent, cash, the queue, utilization and both rates are the LendingPool's own views, read on the
  server in one multicall with each holder's `balanceOf` and `encumberedOf`. The events (Deposit,
  Withdraw, the queue, Borrowed, Repaid, LossAbsorbed) are replayed for the daily history and the
  account's lines. Today's point is always the read, so a token sent to the pool outside any event
  still counts.
- **Depositors are whoever holds shares now**, from the Transfer events, worth the share price,
  masked to the last four characters of the address. Since: their first deposit, or when shares
  first came to them.
- **Principal is deposits less withdrawals** (paid at once or queued); earned is the assets above
  it. The share price is assets over shares (the seed, having no shares, keeps assets over
  principal).
- **The rates are the contract's.** The curve (base, both slopes, the kink) is read too, only to say
  what a draw for shop payouts would do to them. The cycle is `RevolvingIssuer.cycleLength()`, 30
  days until the issuer has a tier.
- **The PayoutPool's draws** show as "Lent to shop payouts", its repayments as "Repaid", and a
  repayment in the same transaction as the PayoutPool's `InterestPaid` to the pool as "Interest
  from credit". What it owes the pool now is `borrowedFromYield`, and what it would draw next is its
  own `shortfall()` (queued claims beyond what it holds), never the tables' sample gap set against
  real cash: that showed a 219% rate on Base Sepolia's $335 pool.
- **Releases are each proxy's `Upgraded` events**, the implementation and when. The contracts don't
  name their versions, so they're counted: v1.0 is the first. The same implementation twice in a
  row (an initializer run again) is one release. A contract with no proxy is v1.0. Real version
  names can come with 5c's commits.
- **Map names find deployed contracts by name, never by address:** `<name>Upgradeable`, then the
  name, then `<name>Factory` (ClearUSD is ClearUSDUpgradeable; SavingsIntent its factory).
- **Nothing is pending live**: Command doesn't propose upgrades yet.
- **Measured against Base Sepolia on 2026-10-23**, a fresh database indexed from scratch: 3,359
  events from the explorer, then one RPC run to the head. The pool is $335 from one member (31
  deposits, one $5 withdrawal), which the lines reconcile to the cent; nothing lent; 0.25% a cycle
  to borrow. 51 `Upgraded` events give 30 contracts their versions (RevolvingIssuer and TermIssuer
  are at v1.5).

### 5c: changes from GitHub

`services/command/github.ts`, `jobs/commandGithub.ts`, migration `0045_command_code`.

- **The commits on `dev` that touch `contracts/`**, polled every 5 minutes (`COMMAND_GITHUB_MINUTES`)
  plus a catch-up when someone opens Contracts, at most once a minute. Repository, branch and path
  are env (`COMMAND_GITHUB_REPO`, `_BRANCH`, `_PATH`), defaulting to Deed3Labs/Protocol-Contracts,
  `dev`, `contracts`. Off with `COMMAND_GITHUB=off`.
- **Cheap by design.** The list is asked for with the last answer's ETag: unchanged is a 304, which
  costs nothing against the token's rate limit. It asks from a week before the newest commit it has,
  so a merge that lands with an older time is still seen. Each new commit's files are asked for once.
- **`GITHUB_TOKEN`** (Railway): fine-grained, read-only, Contents on this repository. The repository
  is public, so without one it still runs at 60 requests an hour; the first backfill then spreads
  over a few runs, a commit's files being read by whichever run has the budget (20 a run).
- **A commit's contracts** are the Solidity files it changed under the path, by name, leaving out
  mocks, tests and interfaces. A library's name is kept but matches no contract on the map.
- **Changes, live (`PROVIDER_CONTRACTS=live`):** a commit goes to the first release after it landed
  (a proxy's `Upgraded`; a contract with no proxy releases once, when it was deployed, its time
  worked out from its deploy block). The commits after a contract's last release are one change in
  flight, a draft of the next version; each release in the last 30 days is a change done, by whoever
  wrote its commits (Command's name for them when their email is a person here). Command's own
  changes (`command.contract_changes`, from the propose action) stay, before GitHub's.
- **The page**, live, draws its change lanes around the API's now rather than the prototype's
  fixed dates, and takes whichever changes exist rather than the first five by index.
- **Status:** `GET /api/command/code/status`.

## Phase 6: the sandboxes

Decided 2026-10-24 (Kai): Command makes the co-op's own Plaid sandbox link; the reserve check
compares CLRUSD with the vault's USDC on chain, Bridge being the deposit rail (6b); Lithic, Bridge
and Stripe every 5 minutes, Plaid once a day plus whenever something says the bank moved.

### 6a: the feeds

`services/command/feeds.ts`, `feedSources.ts`, `jobs/commandFeeds.ts`, migration `0046_command_feeds`.

- **One row per provider** in `command.feeds`: state, when it last synced, how fresh its data is
  (Plaid's own last update from the bank; the sync time for the rest), the last error, and what it
  read. `GET /api/command/feeds` gives each one's health and the menu's line.
- **Sandboxes only.** Each feed refuses anything else and its row says why: `PLAID_ENV` must be
  `sandbox`, `BRIDGE_ENV` `sandbox` (with `BRIDGE_SANDBOX_API_KEY`), Lithic's environment sandbox,
  Stripe's key `sk_test_`/`rk_test_` (`COMMAND_STRIPE_KEY`, else `STRIPE_SECRET_KEY`).
- **Reads only**, but for one sandbox-only write: the first Plaid sync makes the co-op's test bank
  link (`/sandbox/public_token/create`, `COMMAND_PLAID_INSTITUTION`, default First Platypus Bank),
  its access token envelope-encrypted like the members' (`PLAID_TOKEN_MASTER_KEY`).
- **What each reads:** Plaid the link's accounts and transactions (`/transactions/sync` from its
  cursor, into `command.bank_transactions`); Bridge its wallets' balances and the transfers still in
  flight; Lithic this month's card spend by merchant, declines and voids left out; Stripe the balance
  and the last 20 payouts.
- **When:** a tick a minute runs what's due. Lithic, Bridge, Stripe every 5 minutes
  (`COMMAND_FEEDS_MINUTES`); Plaid every 24 hours (`COMMAND_PLAID_HOURS`), and at the next tick when:
  - Plaid's webhook says the link has news (`COMMAND_PLAID_WEBHOOK_URL`, set on the link when it's
    made, pointing at `/api/command/webhooks/plaid`). Believed only with Plaid's signature: an ES256
    JWT with a key Plaid serves by id, issued in the last 5 minutes, over this exact body.
  - a Stripe payout has landed since the bank was last read.
  - someone presses Sync (Money's action now asks the feed instead of only recording it).
  An asked-for sync never runs twice a minute; a failed feed waits a tenth of its schedule.
- **Health:** behind once its data is older than twice its schedule; failing when the last attempt
  failed; off or never run. The chain is the indexer's (Phase 5a), on the same line.
- **The page**, live: the menu's foot is the worst feed ("Plaid is 3h behind · 3 other feeds
  synced"), each figure's freshness label is its feed's real age, Money's late chips follow the
  feeds, and Home's sources list them. Read with every section load and every 5 minutes.
- **Checked against the Lithic sandbox** (the one key on this machine): a sync is one request,
  202 ms. The other three need Railway's keys.
- **6b next:** the figures into Money (operating cash from Plaid, the reserve check against the vault
  on chain and the copy that says so, Stripe's payouts into the operating account's lines, Lithic's
  spend into "Where it was spent").

### 6b: the feeds' figures in Money

`services/command/moneyFeeds.ts`, `onchain.ts` (`reserveLive`), with `PROVIDER_MONEY=live`.

- **The savings reserve is the vault's, on chain** (Kai): CLRUSD's supply against the USDC
  ESADepositVault holds, the comparison the vault itself makes. The USDC is the protocol's reserve
  token (`LendingPool.asset()`), so no address is written down. Member savings' balance is the
  vault's USDC; its weeks are CLRUSD's mints and burns from the indexer; the reserve figure is the
  vault's USDC per CLRUSD ("1 : 1" to the cent), checked with the page. The copy that said "USDC at
  Bridge" says "USDC in the savings vault" when live, and Money shows Bridge for what it is: the
  deposits still on their way through it.
- **Operating cash is the bank's**, from Plaid: the balance of the link's depository accounts (a
  credit card at the same bank isn't the operating account), each week before it worked back from
  the posted transactions, and the account's lines its transactions, pending ones marked. Stripe's
  payouts not yet in the bank come first, as on their way; paid ones are already the bank's.
- **Where it was spent** is Lithic's card spend this month, by merchant; "no card spend yet" when
  there's none.
- **A feed that hasn't read anything gives nothing**, and Money keeps its own records there.

## Phase 7: the live shop and the rest

Split like Phases 5 and 6: 7a the shop, 7b members with the waitlist and batches, 7c site visits and
forms (with the site's PR), 7d the map's style in env. The answers to questions 10, 10b and 11 (above)
stand.

### 7a: the shop, live and read-only

`PROVIDER_SHOP=live`. Migration `0047_command_shop_live`; `feedSources.ts` (`shopFeed`,
`catalogFeed`, `shopAddress`); `shopLive` in `sections.ts`.

- **What it sells is the site's** (Kai, 2026-10-24: the site serves it rather than Command keeping a
  copy that would drift). clearpath-website PR #94 adds `GET /api/shop/catalog`, read from
  `content/shop.ts`: live products for anyone, drafts too with `COMMAND_CATALOG_TOKEN` (same value
  in both envs), and the renamed slugs. Command reads it every 5 minutes (`COMMAND_SHOP_CATALOG_URL`,
  default `https://www.useclear.org/api/shop/catalog`). The site's price, status, colours and variants
  win; Command's own record of a product (costs, glyph, lead time, stock), matched by slug or a
  renamed slug, rides along. A product with no costs here says "Not entered yet" rather than showing
  a 100% margin. Hardware's price is the smallest deposit it reserves, as the prototype's is, with
  its full price alongside.
- **Orders, reservations and refunds are the shop's Stripe Checkout**, read with
  `COMMAND_SHOP_STRIPE_KEY` (a restricted key, `rk_…`; scopes, all read: Checkout Sessions, Payment
  Intents, Refunds, Charges) when one is set, else the site's secret key the API already holds for
  hardware orders, `SHOP_STRIPE_SECRET_KEY` (Kai, 2026-10-28: use the key we have). GETs only either way.
  - A paid session with items is an order. Command numbers it (from 1001) and keeps its packing and
    shipping; the sync only adds orders and marks refunds (a full refund is state `refund`).
  - A paid reservation's reserved lines (the payment's `r1…`, as the site writes them) are
    hardware pre-orders, in `command.shop_live_preorders`, by the site's slug.
  - It asks from a day before the newest order it has: a session can complete up to a day after it
    opened.
- **Addresses are never stored** (Kai). The buyer is kept masked ("Ana R.") with the city. Packing a
  live order at Shop ≥ 3 reads its address from Stripe for that order (`GET
  /api/command/shop/orders/:id/address`), logs it, and writes it into the open flow; the page asks
  once a visit.
- **Worked out from the live orders:** each product's weekly units, orders a week, the size mix,
  how buyers paid, and Money's set-asides (the deposits held, the sales tax on 4 weeks). Still
  Command's own until a source has them: stock, the shelf, what's on the way, returns, ship times,
  pickups. Whether a buyer is a member waits for 7b.
- **Checked against the real catalog** (the site's dev server): 18 products at the site's prices;
  Command's records found for the Logo Tee, Turtleneck, Hoodie (by its old slug) and Clear Point.

### 7b: members, the waitlist and batches

`PROVIDER_MEMBERS=live`. Migration `0048_command_waitlist`; `services/command/waitlist.ts`,
`memberSource.ts`, `jobs/commandInvites.ts`; `membersLive` in `sections.ts`; the member app's
`lib/invite.ts`.

- **The member app checked no invite codes**, and had no waitlist (its waitlist step is a screen).
  Kai, 2026-10-24: codes are **tracked, not gated**. Nobody needs one to join; a code just matches a
  sign-up to its invite and batch.
- **The waitlist is the site's join form.** It already posts JSON to `NEXT_PUBLIC_JOIN_ENDPOINT`;
  that's `POST /api/command/join` (no sign-in, 5 a minute an address). Every answer is kept as a form
  submission (Growth's Forms), with the other answers' fields as they came; "I want to join" is also
  a place on `command.waitlist`, one an email (asking again keeps the place, and the answer is the
  same either way). The city comes from the ZIP (an Inland Empire table; anything else shows as its
  ZIP). No site change: Kai sets the variable on Vercel.
- **A batch, once a second person approves, sends for real** (Kai). The next people waiting, in the
  chosen order (oldest, posters first, Redlands first), each get a code (10 characters, nothing to
  misread) and their email is queued; the batch is recorded with its window (90 days). A job emails
  them through Resend a minute later, outside the approval, and tries a failure again 10 minutes
  later, 5 times at most. On the seed, the batch is only recorded, as before.
- **The invite link is the member app's** (`COMMAND_INVITE_URL`, else `APP_PUBLIC_URL`) with
  `?invite=CODE`. It lands before sign-in, so the member app keeps the code on the device (90 days)
  and onboarding sends it back in the field it already had.
- **Members are the member app's accounts**, read when the page is: their invite code from
  onboarding, their wallets, and, decrypted only for See and above, their legal name; the city at
  every level, since Totals counts by city. An account with a code gets its batch, invite date and
  source; one without came another way (batch 0). Opened is the account; active is the first deposit
  (a Lithic ACH pull is "bank", a Bridge virtual account "deposit"); the first spend is the first
  approved card purchase or charge code. People invited and not yet signed up show as invited.
  Nothing personal is copied into Command's tables.
- **Worked out live:** the waitlist's figures (how many wait and how long, sources, cities, the 12
  weeks, who the next batch would take), each batch's opened and active, the 12 weeks of opened,
  active and first spends, and the next batch from a batch proposal waiting for its second person.
  No source yet says which first spends were a poster's $10 (shown as 0). Home's counts and Money's
  member summary still read Command's own `members` table: they follow.
- **Not checked against the real member database** from here: it holds members' personal data. The
  source's SQL is tested against tables with the member app's columns.

### 7c: site visits and forms

`PROVIDER_GROWTH=live`. Migration `0049_command_site`; `services/command/siteFeed.ts`; `growthLive`
and `liveRange` in `sections.ts`. clearpath-website PR #95.

- **useclear.org had no analytics.** Kai, 2026-10-24: Plausible, with the site's own snippet
  (`NEXT_PUBLIC_PLAUSIBLE_SCRIPT` on Vercel, its `pa-….js` id; nothing loads without it, and only on
  the live site), and Command reads it back through the Stats API v2 with `PLAUSIBLE_API_KEY`
  (`PLAUSIBLE_SITE_ID`, default `useclear.org`). Events leave with only their `utm_` parameters; the
  join form sends a `Join` goal once the API has kept the answer.
- **One more feed, `site`**, every 15 minutes (`COMMAND_SITE_MINUTES`), about two dozen queries a sync:
  today by the hour against the same day last week, 7 and 30 days by the day against the period
  before, each with its sources, cities and top landing page; and over 30 days the sources and
  landing pages with their joins, referrers (by site), cities, devices, pages, the hour of the week
  (each hour's share of 4 weeks), and 12 weeks of sources and of phone share.
- **Four sources, as the prototype has them:** Posters (`utm_source=poster`, so the QR codes carry
  it), Search, Social, and Direct, which is everything else. Three cities (Redlands, San Bernardino,
  Riverside), then the rest.
- **From Command's own records:** each range's forms (the join form's submissions, now marked `live`
  so the seed's samples aren't counted or listed), the join rate the period before, members who
  became active in it, and the weeks of joins, invites and activations from the waitlist and members.
  Poster scans are the Posters visits; which shop's poster isn't known yet (`top` is empty).
- **Plausible keeps no returning visitors:** visits by someone already counted that month stand in.
- **Every section's member counts** (Growth, Home, Money) are the member app's once Members is live,
  which closes 7b's follow-up.
- **Not checked against Plausible** from here: the key isn't on this machine.

### 7d: the map's style in env

`apps/command/src/live/map.ts`.

- **The merchants map's style is env's:** `VITE_MAP_STYLE_URL`, OpenFreeMap's positron unless set, so
  moving to Mapbox later is configuration. The brief's `MAP_STYLE_URL` and `MAPBOX_TOKEN` are
  `VITE_` here, since the page reads them.
- **A Mapbox style's token** (`VITE_MAPBOX_TOKEN`) is used only if it's a public `pk.` token (a
  secret one never reaches the page) and goes only on requests to `api.mapbox.com`, never on
  OpenFreeMap's. The `mapbox://` addresses inside a Mapbox style (styles, sprites, fonts, tilesets)
  are turned into the API's, as Mapbox's own library does.
- **Mapbox's terms** say which libraries may draw its tiles: check them before pointing this at a
  Mapbox style.
- **The drawn map** still takes over when tiles fail, as before.
- **Checked in the browser:** the map draws OpenFreeMap's style, tiles and sprites through the new
  request hook, and asks Mapbox for nothing.

## Phase 8: launch

Decided 2026-10-24 (Kai): Claude creates the Vercel project and adds the domain; the
Content-Security-Policy is enforced from the first deploy.

- **The Vercel project** `clear-command` (deed3), root `apps/command`, Node 22, made by Claude through
  the Vercel CLI. As with `clear-merchant`, its production branch is the repository's (`main`, which
  has no `apps/` yet) and `command.useclear.org` is assigned to the `dev` branch, so it follows dev:
  testnet and the sandboxes (Vercel's API can't set a project's production branch; the dashboard
  can, if that's ever wanted). Env: `VITE_PRIVY_APP_ID`, `VITE_API_BASE_URL` (the dev API). DNS is a
  CNAME at Namecheap, as `api.useclear.org` was, to `959a2191de2aa52a.vercel-dns-016.com`.
- **Headers** (`vercel.json`): an enforced CSP built from Privy's published list (Cloudflare
  Turnstile, Privy's auth frame and RPC, WalletConnect) plus the app's own hosts (the dev API and
  `api.useclear.org`, Google Fonts, OpenFreeMap and Mapbox for the map); `img-src` allows any
  `https:` image (wallet and map icons come from many places); no inline scripts, `object-src
  'none'`, `frame-ancestors 'none'`. Also `X-Frame-Options: DENY`, `nosniff`, a strict referrer,
  HSTS, and a Permissions-Policy that turns off what Command never uses and keeps passkeys (for the
  page and Privy's frame) and clipboard writes (share links).
- **The PWA:** a manifest with icons drawn from the Clear mark, unaltered, on the paper ground
  (`scripts/icons.mjs`); a service worker that keeps only the shell and the hashed assets, one cache
  per build, and never anything the API says: Command's data is personal, and a cached page would
  outlive the sign-out that should hide it. Registered in production builds only, never the preview.
- **CI** now checks `apps/command` (its typecheck and tests): its path wasn't in the filter, so a
  change only to the app skipped the apps job.
- **Checked:** the production build served with exactly these headers, in Chrome: nothing refused by
  the CSP (only Privy's own frame policy refuses localhost, as it will until the origin is allowed),
  the worker activates and caches only the shell, the app opens offline, and the manifest is read.

## Phase 9: real data only (dev)

Kai, 2026-10-24: dev is the real thing on testnet. No seed, no demo people, no prototype figures.

- **The app empties the prototype's data at start-up** (`src/live/empty.ts`), live and in the dev-only
  empty preview (`?preview=1&empty=1`), and every page draws an honest empty state. Dates are today's.
  `e2e/empty.spec.ts` crawls every page, tab and the first controls on each under the empty preview
  and fails on a thrown error, a prototype name, or NaN / Infinity / undefined on screen.
- **The structure stays** (`services/command/structure.ts`, written on every start into empty tables,
  seed or not): the protocol's 31 contracts and their links, the nine entities, every one not formed,
  each board's seats with no one in them, and who decides what. No people, no dates, no events.
- **Permissions is worked out from the real team:** who can approve in each section, the two-person
  rule per section with its approvals and median wait in the last 30 days (`GET
  /proposals?area=all&approved=30`), and what's waiting now.
- **Live providers for every section:** Field and Governance read Command's own tables as of today;
  Merchants reads the merchant app's tables (`merchantsLive`).
- **Site visits from Umami, not Plausible.** Self-hosted on Railway (`umami` on Umami 3.4.0, with its
  own Postgres), open source and cookie-free; lighter to host than Plausible Community Edition, which
  needs ClickHouse. Command signs in as a view-only Umami user (`UMAMI_API_URL` over the private
  network, `UMAMI_WEBSITE_ID`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`). Umami's breakdowns count visitors,
  so the visits Growth shows are visitors. The site loads the tracker from `NEXT_PUBLIC_UMAMI_SRC` and
  `NEXT_PUBLIC_UMAMI_WEBSITE_ID` (clearpath-website PR #96); every event leaves with no hash and only
  `utm_` parameters, its referrer too.
