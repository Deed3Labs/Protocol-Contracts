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
