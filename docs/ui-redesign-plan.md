# Command Center UI redesign: plan

The brief is [`design/command-center-ui/CLAUDE-CODE-PROMPT.md`](../design/command-center-ui/CLAUDE-CODE-PROMPT.md).
The reference is [`design/command-center-ui/command-center.html`](../design/command-center-ui/command-center.html),
copied from Kai's files on 2026-10-27, with its rules in
[`DESIGN-RULES.md`](../design/command-center-ui/DESIGN-RULES.md) and per-page sources in
[`pages/`](../design/command-center-ui/pages). Where `pages/` and the HTML differ, the HTML wins.

## What the reference is

It's the same design system the app was ported from (`docs/command-reference`), grown.

- **Tokens and fonts are the same.** The light and dark colour tokens match `src/styles/command.css`
  exactly. The fonts (Bricolage Grotesque, Instrument Sans, IBM Plex Mono) are already loaded.
- **The CSS has grown:** about 2,800 classes, up from about 1,200.
- **How it's stitched:** Home is drawn into the page directly. Every other page is a module drawn
  into a shadow root (`main > .g-host`), which keeps its CSS scoped.
- **It has 13 pages and 57 tabs:**

| Page | Tabs |
|---|---|
| Home | none (brief, needs you, heads-up, section pulse, timeline) |
| Growth | Overview, Traffic, Campaigns, Cohorts, Apps; filters for City, Source, Shop and Design |
| Members | People, Batches, Nudges, Waitlist |
| Field | Today, Plan, Visits, Posters, Placement |
| Merchants | Overview, Pipeline, Partners, Payouts, Devices |
| Shop | Overview, Products, Materials, Inventory, Orders |
| Money | Overview, Cash flow, Credit, Pools, Moves |
| Build | Overview, Changes, Contracts, Deploys, Security |
| Community | Overview, Forum, Live, Channel |
| Governance | Overview, Proposals, Boards, Entities, Agreements, Calendar |
| Records | Overview, Documents, Audit log, Reveals and exports |
| Team | Overview, People, Groups, Two-person rule |
| Settings | Rules and limits, Security, Connections, Organization |

## How it's ported

- **One page at a time, into the module that page already has** (`src/sections/<page>.tsx`). Each
  page's live code stays:
  - its `REAL` branches;
  - its apply step in `live/sections.ts`;
  - its flows' `live()` calls;
  - the costing and catalog modules (`costing.tsx`, `catalog.tsx`).
- **`scripts/port` isn't run in place.** It deletes every `.tsx` in `src/sections` before writing,
  which would wipe Phases 9–11. It also expects the old single-script layout, while the new pages are
  separate modules. Pages are ported by hand from `pages/*.js` and the HTML.
- **Pages in shadow roots, as the reference has them.**
  - Each page except Home is a module drawn into its own open shadow root (`main > .g-host`). The
    shadow root holds that page's chain of `<template>` sheets, copied verbatim: Growth's `g-tpl` is the
    base, and each page stacks its own on top (Money is `g`, `fm`, `n`; Shop and the Admin pages stack
    six).
  - Theme tokens inherit through the host; nothing else crosses in either direction. That matters
    because the page sheets reuse names the app's global CSS also has (`.cell`, `.bento`, `.lbl`,
    `.dot`, `.strip`) with different rules. In light DOM both would apply.
  - The app's global click delegation reads `e.composedPath()[0]`, so the `data-*` actions keep working
    inside a shadow root. A page's own lookups go through its root, not `document`.
  - Home stays in light DOM, as the reference draws it, styled by the main sheet in `command.css`. That
    sheet now has the redesign's main-sheet rules added and is maintained by hand rather than
    regenerated. Each old page's rules leave it when that page is ported.
- **Converter-assisted.** Each page module is ported whole into a new file (`src/sections/<page>2.tsx`)
  with `scripts/port/module.cjs`; the old page stays beside it until the new one is live (see the live
  gate, below).
- **Data:**
  - In prototype and preview mode, a page draws from its reference fixtures, kept inside its module as
    the reference has them.
  - Live, a page reads the API.
  - **Live never shows fixtures.** Kai, 2026-10-24: dev shows only real testnet data. Where a page
    needs data the API doesn't have yet, live shows that cell's empty state, and the gap is listed
    below.
- **The live gate.** `registerPage(routes, slot, make, { live })`: until a redesigned page's live wiring
  is done (its datasets from the API, its actions through the existing flows), the live app and the
  empty preview keep the page from before. Dev never shows the reference's figures and loses nothing
  it can do today. The prototype preview (`?preview=1`) always shows the redesign.
- **Checks:**
  - DOM parity (`e2e/parity.spec.ts`): a ported page is compared with the redesign. Light-DOM pages
    (`REDESIGNED` in `e2e/pages.ts`) compare `#main`; shadow pages (`SHADOWED`) compare `.gw` inside
    the shadow root, on every tab.
  - Pixels (`e2e/visual.spec.ts`): the same pages against the redesign at 1500, 1100 and 390, in Paper
    and Ink, every tab.
  - The empty crawl reads shadow roots and clicks redesigned tabs; it covers a page once its gate is on.
  - The old reference is retired once the last page moves.

### Porting a page (the recipe Growth set)

1. `node scripts/port/module.cjs <MODULE> <template id> src/sections/<page>2.tsx` (Node 22 on PATH).
   It cuts the module and its template's markup from the reference, converts both to JSX, and prints
   the module's free variables and the lines the converter left as strings.
2. Hand fixes, in the new file:
   - The shadow host: replace the module's own `attachShadow` and `cloneNode` lines with
     `const { host, R, W, into, $g } = shadowHost('<page>', skeleton());` (rename `SR`→`R` or alias it),
     and its mount's slot lookup with `if (!into('<slot id>')) return;`.
   - Turn the IIFE into `function make<Page>() { … return { mount, unmount, setTab: (route, sub) => …,
     tab: () => S.tab, host }; }`, and end the file with `registerPage([routes], '<slot id>', make<Page>);`.
   - String-built markup the converter left: `h += <x/>` becomes an array pushed and rendered;
     `.join('')` on JSX goes; `'<span>'` splits become JSX; unclosed-tag fragments are rewritten whole.
   - Free variables: `CC` (cc.ts) gives `go`, `route`, `level`, `viewing`, `scrub`. Map the
     reference's other globals to the app's: `toast` (shell.tsx), `vLevel` (shell.tsx), `S.view`
     (data.tsx `S`). Shared reference data a module reads (Field's `POSTERS`, `SHOPS`…) is ported into
     the module's file or a `<page>Data.tsx` beside it, as the reference has it.
3. Import the file from `shell.tsx` (beside `import './growth2'`), so it registers.
4. `npx tsc -b` and `npx vite build` (tsc doesn't see errors in `@ts-nocheck` files, such as a duplicate import), then add the route(s) to `SHADOWED` in `e2e/pages.ts` and run
   `npx playwright test e2e/parity.spec.ts e2e/visual.spec.ts -g <route>`: every tab must match.
5. Live wiring is its own step (below).

### Wiring a page live (the recipe Growth set)

1. **A live builder beside the page** (`<page>Live.ts`, like `growthLive.ts`): one function that returns
   every dataset the module declares, built from what `live/sections.ts` filled from the API (the old
   page's datasets in `data.tsx`, `vars`, and `vars.<page>Figures` for the raw figures). What the API
   doesn't have is zero or empty, never the reference's figures, and is listed under gaps below.
2. **In the module:** `const L = REAL ? <page>Live() : null;` at the top of `make<Page>()`, and each
   fixture declaration becomes `const X = L ? L.X : <fixture>`. The module is built after its section
   has loaded and built again when it reloads (pageHost's `dataStamp`), so a const is enough.
3. **Day indexes:** the reference counts days from a fixed start (Growth: 4 Aug, today is day 78). Live,
   `L` gives the start and today's index (Growth: twelve weeks back), and quick picks anchored to the
   reference's events are left out.
4. **Copy written for the reference's numbers** (a sentence, a foot, a strip) is worked out from the rows
   live, or says what's missing. Search the module for literal numbers, names and dates.
5. **Simulations** (timers that invent arrivals, modelled curves) don't run live. A tab or cell with no
   real source says "Not real yet", hatched, with what it needs (Growth's `notReal`); buttons into it are
   hidden.
6. **Actions:** every button that changes something goes through `live()` (`POST /actions/<section>/<kind>`),
   with the old page's flows as the reference for bodies; one with no API is hidden live, and listed.
7. **Turn the gate on** (`registerPage(…, { live: true })`), then run the empty crawl for the route
   (`e2e/empty.spec.ts -g <route>`), parity and pixels (the prototype must not change), and the API tests.

## Decisions taken

Each is a default I'm following. Say if you want it otherwise.

1. **Access sections.** The API checks levels against 11 section keys. The reference has 13 pages.
   - Build keeps the key `contracts` and Team keeps `access`, so no stored level changes.
   - Community and Settings get new keys, `community` and `settings`. A migration fills them from each
     group's (and each custom person's) Governance and Team levels.
   - The change is additive: nothing is renamed or deleted.
2. **Routes.**
   - `#build` replaces `#contracts`, and `#team` keeps its route (labelled Team, not Permissions).
   - Old links (`#contracts/...`) redirect.
   - `#settings` and `#community` are new.
3. **Branch and PR.** As the brief asks: one branch, `ui/command-center-redesign`, into `dev`. There's
   one commit per foundation step and per page, pushed as each one lands. A draft PR is open from the
   start, so CI runs on every push. It's marked ready, with the summary and screenshots, when the last
   page is done.
4. **Shop's unit cost becomes an average.** The brief: "Average cost with the last price paid;
   recording a buy updates the average."
   - Today a purchase sets the unit cost to its own price (Phase 10).
   - It becomes the weighted average of what's on hand: what's on hand at the old average, plus the
     new buy, divided by the new total. The last price paid shows beside it.
   - Costs already recorded on orders don't change.
5. **The reference's demo data stays out of live.** Fixtures power the prototype mode and the parity
   screenshots only.

## Page map

| Reference | Today | Files | What changes |
|---|---|---|---|
| `#home` | `#home` (Today) | `home.tsx` | Build replaces Contracts in the section pulse; the brief line, queue and timeline follow the reference. Today's view switcher (Live, Empty, Loading, Error, All clear) is kept for preview. |
| `#growth` | Overview, Acquisition, Cohorts, Shops and designs, Posters, Forms | `growth.tsx` | Tabs become Overview, Traffic, Campaigns, Cohorts, Apps, with page-wide filters. Posters move to Field (as the reference has them). Forms is kept, noted under gaps. |
| `#members` | Overview, Waitlist and batches, Accounts | `members.tsx` | People, Batches, Nudges, Waitlist. Details are masked, and each reveal gives a reason and is logged per person. |
| `#field` | (one view) | `field.tsx` | Today, Plan, Visits, Posters, Placement; the phone-first live route. |
| `#merchants` | Overview, Pipeline, Partners, Payouts, Hardware | `merchants.tsx` | Hardware becomes Devices. Overview is the map plus the city list. |
| `#shop` | Overview, Products, Inventory, Orders, Costs | `shop.tsx`, `costing.tsx`, `catalog.tsx` | The brief says this page replaces what's there: Materials replaces Costs (the library, suppliers, reorder), and products are costed from materials or one cost. **Kept:** Phase 11's "On the store" section (catalog edits, photos) and Phase 10d's cost at sale. The reference lacks them; noted below. |
| `#money` | Overview, Reserves, Yield pool, Credit, Bonds, Schedule | `money.tsx` | Tabs by question: Overview, Cash flow, Credit, Pools, Moves. Moves are proposed and approved inside Money. |
| `#build` | `#contracts`: Overview, Agreements, On-chain, Changes, Code | `contracts.tsx` | Overview, Changes, Contracts, Deploys, Security. Agreements move to Governance (as the reference has them). Code feeds Changes. |
| `#community` | none | new `community.tsx` | A new page: Overview, Forum, Live (List/Month), Channel. |
| `#governance` | Overview, Entities, Boards, Meetings and votes, Calendar | `governance.tsx` | Overview, Proposals, Boards, Entities, Agreements (with versions), Calendar (List/Month). |
| `#records` | Overview, Documents, Audit log | `records.tsx` | Adds Reveals and exports. |
| `#team` | Overview, Groups, People, Two-person rule | `team.tsx` | Same tabs, redrawn: who approves whom, how long a second person takes. |
| `#settings` | none | new `settings.tsx` | A new page: Rules and limits, Security, Connections, Organization. |

## Shared primitives

Built once, before any page, following `kit.tsx` and `core.tsx` conventions:

- **The app shell:**
  - top bar with search, TESTNET, inbox and profile menu;
  - left rail with the Grow, Hold, Rules and Admin groups, collapsing to icons;
  - phone bottom tabs with a More sheet;
  - read-only blocker and sign-in (existing).
- **Page header:** a mono context line, a one-sentence brief with links, and a strip of 4 vitals. Each
  vital has a label, a big number with a qualifier, a segmented mini-bar and a context line, and
  clicking one goes to its tab.
- **Tabs** synced to `#page/tab`.
- **Bento band:** a 12-column grid. Cells span 2 to 12 columns (the reference's `.s-2` to `.s-12`,
  mostly bands of 4/4/4, 6/6, 7/5 and 12), go to half width on tablet and full width on phone, and are
  equal height within a band. The rules' "4/5" doesn't add up to 12; the HTML's spans win.
- **Cell:** a 56px header and a 56px footer, aligned across a band.
- **List row,** a column header row (38px, right-aligned numbers), and a tinted section band (32px).
- **Smaller pieces:** status chip (a square swatch plus text); calendar-leaf date with a tie line for
  same-day items; hatch fill that also fills the space under short lists.
- **Panels and controls:** right-side panel (anchored header, scrolling body, actions in the footer);
  segmented control; legend (`f-key`); toast that says what happens next and where it's logged.
- **Calendar** with a List/Month switch, open arrowheads, and a "stops here" line.

## Security: what the server does

Built on this branch (migrations 0057–0059, `services/command/settings.ts`, `store.ts`, `routes/command.ts`),
tested in `routes/commandSecurity.test.ts`:

| Rule | How |
|---|---|
| Levels checked on every request | `need(section, level)` on each route; `community` and `settings` are sections of their own (0056). Tested: None refuses every section, the log, the reveals and every action. |
| Totals carries no names, emails or accounts | As before for each section (tested per section); Settings at Totals carries no staff names. |
| Details masked by default, every reveal logged with a reason | Reveals need **Approve** on the section (Settings → Who can reveal) and a reason; a blank one is allowed as a rush (`rush=1`) and flagged, or refused with `REASON_NEEDED`. Each is a row in `command.reveals` (append-only) and an audit entry. Per member: `POST /members/:id/reveal`; whole lists: `?reveal=1&reason=…`; an order's address: reason "To pack it" unless another is given. `GET /reveals` is Records → Reveals. |
| Data exports need a second person | A whole list with names (Members' people, Growth's join forms) is an export (migration 0064): asked for with a reason by someone at Approve on the section (`<section>/export`), always approved by a second person, and the approval writes a grant only the asker can use, once, within a day (`?reveal=1&export=<grant>`); each use is logged as a reveal with the reason it was approved for. Without one, a whole list is refused (`EXPORT_NEEDS_SECOND`). A CHECK refuses a grant approved by its asker. `GET /exports` (Records) and `GET /exports/mine`. Revealing one person stays a reveal with a reason. |
| Two-person rule in the API, nobody approves their own | As before (proposals, refused in the API and by a CHECK). |
| Limits from Settings; changing a setting needs a second person | `command.settings` holds every editable rule, first set to what the code enforced (refunds and shop buys over $50). Refunds and buys read their limit from it. A change is the `settings/change` action, which always waits for a second person; locks (set by a vote, the bylaws, the law) can't be changed, only shown with where they're decided. A CHECK refuses a change approved by its maker. |
| Audit log append-only and chained | Append-only (trigger, as before). Each entry has a `seq`, the previous entry's hash and its own (`command.audit_hash`), set by a trigger under a lock held to commit, so the chain follows commit order. `command.audit_verify()` finds the first entry that doesn't follow; `GET /audit` returns it as `chain`. Corrections are new entries with `corrects` pointing back (`POST /audit/:id/correct`). |
| Kept 7 years | Shown as a lock in Settings; nothing can delete log or reveal rows (triggers). |

## Gaps: data the reference needs that the API doesn't have

Filled in as each page is ported. Known before starting:

- **Shop** (live: `shop2.tsx` + `shopLive.ts`, its gate on). The data model is migrations 0060–0063
  (`services/command/shopModel.ts`): the three material kinds, average cost and last price paid, extras by
  size or colour, suppliers with lead times and price breaks, orders in and received, reorder suggestions
  (lead time plus the `buffer` setting), flat costs with an estimate flag and overrides, batches (planned,
  short, done, cost locked), per-order costs (supplies, shipping charged against the label, the card fee) and
  pickup points with the `hold` setting. Recorded buys over the `shopbuy` limit wait for a second person.
  - **Live now.** Products are the store's catalog with Command's costs (`COST_BY`: a recipe, one flat cost,
    the old per-item boxes, or "Not costed yet"); each margin is the API's cost for the colour and size
    (overrides and extras). Materials are the inputs library (`type`, `avg`, `last`, `var`, `supplier`, on
    hand, `ON_ORDER`, the purchases as buys), archived ones in a group of their own; reorder is `REORDER`;
    suppliers `SUPPLIERS`; batches `BATCHES` (with what a planned one needs); orders the Stripe orders with
    `ORDER_COSTS` (estimated at today's costs where none is recorded) and `PICKUP`/`POINTS`; cost changes are
    worked out from the purchases; On the way is `ON_ORDER` and `INCOMING`. `PER_ORDER` now also carries the
    Settings the page needs: `margin` (the target), `buffer`, `shopbuy` and `refund`.
  - **Actions.** Save costs (`recipe-line` per line, `flat-cost`; back to materials is `flat-cost` with no
    cost), the price and "Use $X" (`product-edit`, waits for a second person while on the shelf), "Add to it"
    (`input-apply`), "Record the buy" (`purchase`), a made-to-order price (`input`), "Order more" (`order-in`,
    asks how many), a received or cancelled buy (`receive`, `order-cancel`), a material's supplier
    (`input-supplier`), make a batch (`batch-plan` then `batch-done`), a planned batch made, made short or
    dropped (`batch-done`, `allowShort`, `batch-cancel`), "Mark packed" (`pack`), and the address for packing
    (`GET /shop/orders/:id/address`, a reveal logged "To pack it").
  - **Controls the reference has no drawing for, in its panels** (live, staff only): add or edit a supplier and
    its price breaks (Materials → Suppliers, "Add a supplier", a supplier's Edit: `supplier` then
    `supplier-breaks`); a material's kind, whether a once-per-order one is counted on hand and used on pickups
    (`input-kind`), and what it costs more in a size or colour (`input-extra`, add and take off), in its panel's
    "In the library" and "Costs more in"; one cost's own figure for a colour or size (`flat-override`, add and
    take off, once the one cost is saved); pickup points (Orders → Waiting for pickup: "Add a pickup point", a
    point's row to rename it, move it or stop it holding: `pickup-point`) and where a pickup order is held (its
    panel's Pickup, `order-pickup`); and what a shipped order's label cost (its panel's What it cost,
    `order-label`). Each saves through the page's `send()`, so the section loads again and the page is drawn
    from what the server holds; a supplier saved opens its panel.
  - **The old page's flows, drawn as the redesign's sheets** (opened from the new panels; the panel steps aside
    and comes back when the page is built again, as `tab()` carries it): the catalog's (Edit on the store,
    photos: add, first, describe, take off; colours, options, a variant, keep selling at 0; Add a product),
    the costing's (each line in full, a colour's or size's own line, copy a recipe, add a material, edit,
    archive and restore one, add to products, a buy with its date and note, count stock, write off) and the
    shop's (on and off the shelf, archive, restore, restock, the name and price of one not in the catalog,
    pre-orders' deposit refund and sign-up link, print labels, shipped, ready, picked up, remind, refund, see
    a refund). Their markup, ids, `#modalRoot` lookups and API calls are unchanged: `vModal` marks a Shop flow
    (`s:`, `c:`, `k:`) and `modalShell` draws it as `.scrim.sheet`, which command.css ("Flows as sheets")
    draws as the page's own side panel (`.panel.spanel`): docked right, 560px (the whole width on a phone),
    the panel's header, labels, inputs, ledgers, notes and buttons, its footer kept in view. Every other
    modal is still the centred dialog. Cost at sale (Phase 10d) and each order's cost and margin are in the
    panels.
  - **Still missing**, "Not real yet" or empty live: the shop's fixed costs (samples, photos, software: the
    overview's "Running the line"); the printer's bill for a batch; enforced supplier minimums; the real
    Stripe fee and label prices bought from a carrier (a label's cost is typed in, `order-label`); messaging a
    member when a pickup hold runs out; a list of cost changes of its own (purchases stand in); "on the way"
    items beyond buys on order and Command's incoming rows. Stock sizes are read as XS to XXL in order, as the
    old page read them.
- **Members** (live: `members2.tsx` + `membersLive.ts`, its gate on).
  - **Live now.** People is the API's members plus the waitlist's people (the members section's new
    `WAITLIST`: masked like members, never at Totals, with their place in line, join time, city, source and
    poster). Batches are `BATCHES` (each batch's size, opened, funded and first spends); the batch waiting
    for a second person is `NEXT_BATCH`, with who it would take (`ids`), its order and when it was proposed;
    the next number is `members.next_batch.number`. The join form is `FORMS` (the last 30 days, newest 20,
    masked; none at Totals) and `members.forms.month`. Days count from 1 Jan 2020 live (never day 0).
  - **Actions.** Resend (`resend {id}`), turn off access with a reason (`off {id, reason}`), nudge one
    person (`nudge {id}`), and propose a batch (`batch {size, order, cities | posters | ids, why}`: the
    page's oldest, by city, by poster shop and hand-picked are `oldest`, `cities`, `shops` and `picked`,
    each taking no one else, and a batch that skips people asks why). Approving or sending a batch back
    stays in Needs you. Showing a name is one person at a time, with a reason (`POST /members/:id/reveal`,
    W- numbers too), and logs in Records' Reveals when that page is live.
  - **Notes and tags** (migration 0068) are Command's own, keyed by the masked number the page shows
    (M-0001, W-0001), never a name: the section's `NOTES` (each note's text, who wrote it, when) and `TAGS`,
    none at Totals. A person's panel adds a note (`note {subject, text}`), tags them (`tag`, asked by prompt)
    and takes a tag off (its ×, `untag`). The API refuses a note or tag holding an email or a phone number.
    Someone waiting who is invited and opens an account changes number (W- to M-), so their notes stay
    on the W- number.
  - **Still missing:** Social and Search as sources (the API sends Poster or Website); whether someone has
    the app or a phone (so "best channel" and the channel mix); contact details on reveal (the endpoint
    returns the name); a history log and nudge counts per person; notes following someone from the
    waitlist (W-) to their account (M-); which shops are live in
    each city (the Waitlist table shows "—"); each group's last nudge (when, channel, sent, opened, acted),
    group nudges with a message, channel and time, the automatic follow-ups and which channels are set up
    (the Nudges tab's lower half says "Not real yet"); extending the invite window and closing an account
    (hidden live; turning off access is there); the join form's whole-list reveal (hidden: one person at a
    time from People); only the newest waiting batch proposal shows when there are two.
- **Growth** (ported): what campaigns cost (printing, ads, offers, credit) and who a tagged link brought past joining, cohorts by days since the invite with who
  stays active and spends, the apps' own events, bounce and time on page, browsers, the real-time view,
  and invites, opens and first spends by source, city, shop and design. Live, Cohorts and Apps
  say "Not real yet" with what they need; the waitlist count and median come from `command.waitlist`.
  Campaigns is live: each poster design (Command's posters, the waitlist joins they brought and, with Members
  live, who was invited, opened, activated and spent) and each `utm_campaign` the site feed counted (visits,
  joins, its source and medium, the days it ran); spend says "Spend isn't recorded".
- **Field** (live: `fm2.tsx` + `fmLive.ts`, one module with Merchants, its gate on). Each page loads the other's
  section too (they share the pipeline and the route), once, and is built again with it.
  - **Live now.** Today is the field section's route (`ROUTE`, `STOPS` with their tasks and `SHOP_INFO`), with
    what was found on earlier checks (`LATER`); Posters and Placement are its `POSTERS` and `DESIGNS` (a design
    the API doesn't name is "No name yet"). Visits are today's finished route tasks plus the merchant visits logged
    on the pipeline's cards (a card log line of kind `visit`: the outcome, the stage it moved, the note, written
    and read by `fmLive.ts`'s `visitText`). Follow-ups are the cards' next steps and due dates. Needs a visit is
    the posters due within 12 days or worse, the cards in Prospect, Talking or Signing, and the Points offline or
    low (from Merchants' fleet). People are the signed-in person, Team's people (when loaded) with Field access
    (edit on Field), and whoever the data names; waiting by city is Members' waitlist when that section has loaded.
  - **Actions.** Scan a poster (`scan {n, outcome, note, photo}`, the photo through `addFile`), mark a task done
    (`task-done {stop, position}`), skip a stop (`skip`), add a shop found earlier to today (`add-later {shop}`),
    and log a merchant visit (`card-save` with a `visit` log line and the stage, next step and due date it sets;
    Not interested takes the card off with `card-remove`).
  - **Field's own records (migration 0069).**
    - *Routes ahead* (`command.route_plans`, `route_plan_stops`; the section's `PLANS`): one person's stops on one
      day, in order, each the ref of what needs a visit it came from (`p12`, `c:<card>`, `d:<shop>`, `y:<id>`) or a
      stop of its own (`a:…`), with the page's estimate (miles, minutes, back by). Plan's week, route builder, new
      routes, Add/Move to a route, ↑↓ and drag, Best order, + Add a stop, Send, Take it back and Save my route are
      live: `route-plan {day, who, start, stops}`, `route-save {id, who, start, stops, …}` (the route whole; a sent or
      accepted route goes back to a draft, marked changed), `route-send {id, note}` (also in the outbox, for the
      phone), `route-take-back {id}`, `route-accept {id}` (the person's own Save, or an admin's Mark accepted). Your
      own routes, or anyone's with Approve on Field (the server checks). The lead panel's and a poster's "Add to a
      route" and Placement's "Add to route" put it on that person's next route, starting one for the next weekday.
    - *Today's route from a plan:* the first read of the field section on a day starts that day's accepted route as
      today's (`startPlannedRoute`: command.routes, its stops and tasks, as the seed's day has them; `routes.plan_id`
      says which), and accepting a route for today does it at once. A planned poster is a poster task (a scan marks
      it), a device fix a device task, anything else a `visit` task (a new kind) marked done. command.routes keeps
      one route a day, so a second accepted route on the same day stays a plan, and changes to a plan after its day
      has started don't reach today's route.
    - *In the van* (`command.van_loads`; `VAN`): today's load, posters by design, spare Point batteries and receipt
      rolls, recorded (and recorded again, replacing it) with `van {posters, batteries, rolls, note, at}`; it sets
      today's route's loaded time. The cell weighs it against what today's route still needs.
    - *Shops that could take a poster* (`command.poster_yes`; `POSTER_YES`): a yes logged on a merchant visit (the
      visit panel's "Said yes to one", `poster-yes` with the card), from the pipeline or by hand (+ A shop said yes),
      with when; waiting ones are also "Put up a first poster" in Needs a visit. `poster-placed {id, design}` puts the
      poster up (it joins the posters, as Growth's `poster-add`); `poster-no {id}` takes a shop that changed its mind
      off.
  - **Still missing ("Not real yet" or hidden):** placement scoring (suggested posters per city); daily scans per
    poster; a shop's hours and contact outside today's stops; snoozing or dropping something that needs a visit; the
    visit log before today for posters and devices (only today's route is sent); visit history per person beyond the
    cards' logs; photos shown back on a visit; what was used from the van (it's weighed against today's tasks, not
    recorded); where a person starts from other than the office (only the office is a start live); a yes read from
    poster scans (a scan is of a poster already up, so it says nothing about a new shop); a route deleted outright.
- **Merchants** (live, the same module): the merchant app's shops (`TX`, `SIGNED`), the pipeline's cards (`BOARD`)
  and the Points (`FLEET`). A shop the merchant app has and its card are one record (the card's `m`, else the same
  name); the other cards are the pipeline's own shops. Live, the API sends every card's owner, value, next step and flag whatever its
  stage (`merchantBoard(…, full)`), so saving a signing or signed card whole keeps them.
  - **Live now.** Overview's map, cities, stage counts, founding seats (`merchants.founding_seats`, else 5), what
    each shop cleared this month, and Needs you (signing shops, overdue follow-ups, Points offline or low).
    Pipeline is the cards, by stage; Partners the shops' terms, fees and this month's sales; Payouts the next
    monthly run worked out from last month's sales at the NET-30 shops less their fees; Devices the Points, the
    refurb line and the pre-orders.
  - **Actions.** Moving a card (drag, or Move to) is `card-save` with a stage log line, and to Signing also records
    `send-agreement {id, party}` (for the outside system); Not a fit is `card-remove`; a note is a `note` log line;
    + Prospect is a new card; Log a visit as in Field; Raise the cap is `cap {id, cap}` (two-person; shown only when
    the cap is known); Pause payments is `off {id}`; Propose the run is `run {total, shops}` (two-person). The
    board's order isn't saved (`board-order` is unused: the redesign orders by due date).
  - **Read from the chain now:** each shop's cap per sale (MerchantRegistry `approvalCapOf`) and the sales refused
    over it this week (the API logs each refusal in `charge_cap_hits`), in Caps to review and Partners' Caps; and
    what members have paid on last month's sales (the next run): paid at the counter, or repaid so far on each
    sale's TermIssuer plan (`COLLECTED`), in Payouts' Collected before it goes out.
  - **Merchants' own records now (migration 0067):**
    - *Payout runs.* Propose the run sends `run {total, shops, period, goes, lines}`; it's the proposal until a
      second person approves it, then a `command.payout_runs` row (one a month: a second approval for the month
      is refused, 409) and an outbox row for the Ops Safe. `RUNS` reads every run proposal with its record: waiting,
      sent back or taken back (from the proposal), approved by whom, in the Safe (its outbox row proposed to the
      Safe), and paid (`run-paid`, marked by hand once the Safe has executed it). The next run's state, Payouts'
      "Payout runs" table and Needs you come from it; Approve and Send back are `/proposals/:id/approve|decline`.
      A NET-30 run goes 30 days after its month's last day, or the weekday after (`runGoes`, the API's and the page's).
    - *When money goes out* is the PayoutPool's unpaid NET-14 claims (`CLAIMS`, credit.ts `payoutsLive`: the
      merchants route now passes the chain reader, which it hadn't, so caps and Collected weren't read either),
      the approved runs not paid yet, and next month's run.
    - *Refurb line* is `command.refurb_units` (`REFURB`): add a unit (`refurb-add`), move it a stage
      (`refurb-move`; shipped only with a shop), and the shop and day it goes to (`refurb-assign`), in a
      "Refurb units" table under the cell.
    - *Pre-orders* already had a real source: the shop's Stripe reservations from useclear.org/shop
      (`command.shop_live_preorders`, the shop feed). Its rows now keep the shop's id (its org wallet) and the
      ship month the reservation carries (else the product's); `PREORDERS` reads them (seeded: the shop's fixtures).
    - *Shop enquiries* already had a real source: the site's join form's "I run a shop" (`command.form_submissions`,
      details from the form's fields). The note they wrote is now kept; `ENQ` sends the business, kind, city,
      source, ticket and jobs a week, what they asked, and the state. Mark replied / Not a fit (with why) / Open
      again are `enquiry`; Add to pipeline is `card-save` with `enquiry` (marks it added with the card); Show name is
      `POST /merchants/enquiries/:id/reveal` (Approve, logged as a reveal).
  - **Still missing ("Not real yet" or hidden):** each shop's losses (so no raise-or-hold call on a cap);
    how fast shops move between stages (the reference's conversion rates); whether the Safe has executed a run
    (paid is marked by hand); replying to an enquiry from Command (Mark replied records that someone did); the
    $10 redemptions owed; devices other than Points (readers, tablets, printers report nothing); a refurb unit's
    cost against a new one; changing terms, handing a lead to someone else, planning a visit onto a route, undoing a move;
    a shop the merchant app has but the pipeline doesn't is read-only (no card to log to); shops in a city off the
    drawn map aren't on it.
- **Money** (ported, live): live it draws the money section (`moneyLive.ts`): the accounts with their
  sources' freshness (the feeds), the reserve check, the credit gate (the AssurancePool's target, exposure
  and room), the yield pool and its depositors (LendingPool), the bonds (BurnerBond) and what BondVault
  keeps back, the shop's set-asides, Lithic's card spend by shop, the Ops Safe's owners and threshold
  (`GET /safe`), and the moves: waiting from `GET /proposals?area=money`, done from the approvals in 30
  days. Proposing a top-up is `money/top` (it waits for a second person); approving, sending back and
  taking back go through `/proposals/:id/approve|decline`; Sync now is `money/sync`, the reserve check
  `money/reserve`. Still missing, and "Not real yet" live:
  - **Read from the chain now** (`services/command/credit.ts`): the next 30 days are the PayoutPool's
    unpaid claims, due their shop's payout window after the shop redeemed (out), and members' plan
    installments and revolving balances at their period's end (in); `M.owed14`, `M.dueMembers` and
    `M.payout` (the pool's `held()`) follow. The Credit tab is ClearCredit's book: the month from the
    events (owed on the 1st + spent + carry − repaid = owed now), how late each balance is (a plan
    behind since its first missed installment, a revolving period ended unpaid), losses written off
    and what the AssurancePool paid, limits by size and who's on autopay. Empty live is real: it says
    nothing is owed or due rather than "Not real yet". What a shop has earned but not redeemed has no
    due date yet, so it's counted (`M.unredeemed`), not scheduled;
  - the AssurancePool's and unsecured credit's weekly history and the co-op balance's weekly additions
    (stored figures, not written live);
  - moves that ran on their own (yield pool withdrawals, losses absorbed), declined moves, a note on a
    move, and naming the second person;
  - actions: using BondVault's spare, paying a bill from operating cash and moving between accounts
    (hidden live: the API's `money/top` only funds the PayoutPool from the Ops Safe).
- **Build** (ported, live): live it draws the contracts section (`buildLive.ts`). The map's contracts are
  the API's, drawn and counted as live when the indexer found them deployed (the section's `DEPLOYED`);
  their releases (the indexer's `Upgraded` events) are the Releases lanes and the Deploys list. Changes
  come from the GitHub poller (pull requests touching `contracts/`: drafts, open ones in review, merged in
  the last 7 days; commits on dev since a contract's last release, as its next version; releases in the
  last 7 days) and from the Ops Safe (`GET /safe`: the queue with each owner's signature, and what was
  executed in 7 days; `GET /safe/outbox`: on-chain acts waiting for their first signature). Commits and
  the 4-week activity are the poller's newest commits; the signers, their signatures a week and median
  hours to sign are the Safe's. People are only you, the Safe's owners and the GitHub authors. Signing is
  your own wallet (`safe.signQueued`, `safe.signAndSend`), linking it `safe.linkWallet`, and a contract's
  panel proposes a change through the old page's flow (`contracts/propose`, into the Safe); GitHub, the
  Safe and Safe{Wallet} open in a new tab.
  - **GitHub Actions and reviews now (migration 0070):** the poller also reads the workflow runs for pull requests into the watched branch (CI runs on pull requests, not pushes to dev): the
    runs (each complete run's jobs once) and each pull request's check runs at its head and its reviews (who
    reviewed, what they said, who's still asked), within a request budget. Deploys' Checks is a row per project
    from the job that covers its folder (Contracts' hardhat job for `contracts/`, the Apps job for the rest):
    pass rate, runs and median time in 30 days; coverage isn't measured. The header's Checks is how many
    projects' jobs last passed; Changes' Reviews is the median time to a first review, each reviewer's reviews
    and waits, and the spread; a change's panel shows its checks and reviews. The token needs Actions and Pull
    requests read (dev's has them). Still not read: the apps' deploys on Railway and Vercel (no API tokens set).
  - **Command's own records now (migration 0066):** incidents, security findings and audits, read with the
    section (`INCIDENTS`, `FINDINGS`, `AUDITS`, and `TEAM`: who can be given an incident, the team at Propose
    or more on Build) and written from Build. Overview's and Security's Incidents list the open ones and those
    of the last 30 days (open, who's on it, resolved in how long, how many reached members), and open ones that
    are yours or nobody's are in Needs you; an incident's panel has its timeline, gives it to someone, takes an
    update and resolves it (`incident-open`, `incident-update`, `incident-assign`, `incident-resolve`).
    Findings is the register (severity, where, state, its fix as a pull request or a change Build lists; a fix
    whose change waits in the Ops Safe shows as waiting on a signature), paged six at a time; a finding's panel
    links a fix (`finding-fix`: an open finding goes to in progress) and changes its state (`finding-state`:
    open, fixing, fixed, accepted with why; accepting a critical one waits for a second person). Audits counts
    the contracts an audit has covered (an outside auditor's or internal), lists the audits (a day still to
    come is booked) with their report links, and records one (`audit`). The header's Open findings tile is
    the open and fixing ones by severity, with the newest outside audit. All at Propose; at Totals the API
    sends no names, notes or timelines.
  Still missing, and "Not real yet" live:
  - **Who can do what is read now:** replayed from every contract's RoleGranted/RoleRevoked, owners,
    NetworkRegistry's issuers and the AssurancePool's allowed callers (`keyRolesLive`); six holders at most,
    the rest sharing one column;
  - check runs per monorepo folder (pass rate, runs, time, coverage) and each default branch's state;
  - the other projects (the member and merchant apps, API and SDK, the site, this app): the poller
    watches one path, so Build lists only the contracts; where the apps run and their deploys (Railway and
    Vercel history);
  - review state on pull requests (who's asked, approvals, changes asked for, time to a first review),
    line counts (+/−) and simulation results;
  - findings from outside tools (Dependabot, code scanning) aren't read in: each is recorded by hand;
  - AccessManager's roles (`contracts.key_roles`, written by nothing live);
  - actions: approving or asking for changes (GitHub reviews) and proposing a pause are hidden live; executing a fully signed Safe transaction is done in Safe{Wallet}.
- **Community** (live: `community2.tsx` + `communityLive.ts`, its gate on, with no backend yet). Live draws the
  redesign's four tabs with nothing in them; the backend is to be discussed.
  - **Live now.** The layout, empty: "No threads yet" (Every thread, Busiest in the forum, its categories still
    pick), "Nothing flagged", "No events scheduled" (Every event, its list and month views from this month, Coming
    up), "Nothing on air right now", "Nothing needs you", "Nothing on the channel yet" (On the channel today, Today on
    the channel with the hours and Now), "Nothing in the library yet"; each foot says "Not real yet · needs …". The
    header's four figures are "—", hatched, with what each needs; Taking part's "of N members" is Home's active
    members when it has loaded, else "—". Who hosts what (the co-op's rule) shows as the reference has it.
  - **"Not real yet", hatched:** Who's taking part, Posts a week, The last hearing, Watching.
  - **Hidden live** (nothing to act on, and no API): approve or decline a request to host, keep or hide a flagged
    post, end a space, remind members, open in Dial, schedule or add to the schedule, open a thread in the app, watch
    a recording; panels open only for a record that exists, so a link to an event or a thread opens nothing.
  - **Still missing:** forum categories, threads and posts with read counts, flags and a thread↔proposal link; a
    moderation queue (reports, automatic detection, hide or keep with a reason, telling the author, an audit entry);
    events and requests (town halls, spaces, hearings, board meetings: hosts, RSVPs, hands, questions, recordings)
    with a live provider (Dial or Opencast) for presence and Q&A; the channel (schedule, library, viewers by hour),
    all from Dial's station API; members taking part each week across forum, events and channel.
- **Governance** (live: `governance2.tsx` + `governanceLive.ts`, its gate on). The page loads Build's (contracts)
  section beside its own, once, for the agreements.
  - **Live now.** Entities, who owns what (the API's `OWN`, else what `UNDER` says), their facts (a formed date or the
    API's words for it, tax, EIN, officers) and formation steps when the API has them; the three boards and their seats
    (`GBOARDS`, keyed by the entity each governs; the board's note is who it answers to); meetings from `MEETS` (each
    board's held and next; a held meeting's minutes are "to approve" when the API marks minutes due after it; the
    members' own next meetings go on the calendar); the next meeting's agenda; resolutions (by seat; a logged decision
    with no seat votes says so); the reserved matters, as Entities' Reserved matters and Proposals' "Who decides what"
    (decides, must approve, is told, what's open); filings; the related-party log (a new Entities cell, "Between our
    companies"); the latest member vote (`VOTE`: turnout by day, quorum, the tally so far); and Build's agreements (with
    `sent`, Contracts' "Out for signature"). The vitals are the vote, the board's agenda, resolutions in 90 days, and the
    forum ("Not real yet"). Needs you is the data's: agreements waiting on your signature, filings due in 30 days or
    late, the open vote, a board meeting within 14 days, and open reserved matters. Dates and the calendar run from today.
  - **Actions** (each opens the old page's flow, `openVFlow`, or Contracts', `openCFlow`, which save through the API and
    build the page again): a filing's next step from any filing row (`filing-start`, `filing-ready`, `filing-filed`); an
    entity panel's Mark it done (`formation-step`) and Log a decision (`decision`); the next co-op board meeting's panel:
    Add an item (`agenda-item`, also in Boards' Next meeting), Start the minutes (`minutes`), Send the packet (`packet`);
    a held meeting's panel and Boards' Resolutions: Log a decision; a related-party deal: Log a payment or Put it on the
    agenda (`rp-payment`, `rp-agenda`); a reserved matter: Start the approval (`matter`, two-person); the vote: Remind
    them (`remind`) and its ballot; a resolution opens who voted how; an agreement waiting on you: Sign it
    (`contracts/esign`), one renewing: Start the renewal (`contracts/renew`). The old flows' reference-only words (the
    ballot's summary, "Logged by Kai", "Kai, secretary", "v2.2") are the data's, or left out, under REAL.
  - **Agreement versions** (migration 0068, the governance section's `VERS` and `TERMS`). Versions draws every
    agreement that has versions on one timeline (from the first on record, at least ten months back, to three
    months ahead): each version's dot (in force, replaced, draft), the one in force, the next draft, and
    who's on which. Who has accepted which is read where the apps record it, counted, never who: the member
    app's `member_terms_acceptances` (by document@version, when Members is live) and the data room's terms
    (`command.terms_acceptances`); a version links to one with `terms`, and what no version is linked to is
    drawn after the agreements, so nothing recorded is left out. An agreement's panel lists its versions
    (what changed, who adopts it, who asked and who approved, when it was replaced, how many accepted it),
    starts a new one (`version-draft {agreement, version, changes, decidedBy, terms}`, a line per change
    starting +, ~ or -) and proposes adopting a draft from a day (`version-adopt {agreement, version,
    onDay}`): always a second person, and the database refuses one in force without a second person who
    isn't the one who asked. Adopting replaces the version in force that day and sets the agreement's version.
  - **Still missing ("Not real yet" or hidden live):** proposals as a lifecycle (draft, co-signing, check, voting,
    decided, carried out; co-authors, co-signers and deadline, checker and check items, nominations, vote window per
    proposal, board recommendation, result, tasks with owners). Proposals draws the redesign's layout empty: Every
    proposal has its six steps (all 0, still filtering) and Open, Closed and All, with "No proposals yet"; Carried out
    says "Nothing carried out yet"; each foot says "Not real yet · needs …". The proposal panel, send back, check and
    open a vote, mark a task done, share the co-sign link and vote in the app are hidden. The forum (Discussion says
    "No discussion yet"; ideas and hidden posts: Community has no backend); comparing two versions side by side
    (the version's own text isn't kept, only what changed); a version on a member vote (a draft is adopted once
    the vote is decided outside Command); which shops accepted which merchant agreement (the merchant app records
    no acceptance) and which members accepted which version when the member database isn't reachable; per-seat names on agenda
    items and proposal links on agenda items and resolutions; the boards' Assembly and its "off" flag (live shows the
    three boards the API has); meeting times (the API keeps dates) and whether a held meeting's minutes were approved;
    the member vote isn't sealed (the API sends the running tally, shown as "So far"); a filing checklist beyond the old
    flow's stages; who signs for which entity and a related-party deal's conflicts ("Not recorded").
- **Records, Team and Settings** (ported, live: `admin2.tsx` + `adminLive.ts`, the gate on). One module
  draws the three; live, every dataset is the API's and the reference's people, dates and figures never show.
  - **Records, live now.** Documents, counts and papers by entity are the records section's. The log is
    `GET /audit` (its entries now carry `person_id`, so a person has one key across the page): each entry's
    panel shows its `seq`, its hash, the entry it's chained to, what it corrects and whether the chain holds
    (also in the log's foot, the header and Settings → Organization). "Correct it" (`POST /audit/:id/correct`,
    at Propose on Records) adds an entry pointing back. Reveals are `GET /reveals` (now with `person_id`):
    one person's details are Reveals, a whole list (`*`, or more than one row) is an export; a reveal with
    no reason is flagged. Download (`GET /documents/:id/file`), share a link and a new version (the old
    page's flows) and Add a document (`document-add`) are in the document panel and the paperwork table.
  - **Team, live now.** People, invites, groups (all thirteen sections' levels, from `vars.teamRaw`, which
    `loadTeam` keeps as `GET /groups` and `/people` send them), sign-ins per day, access that ends (invites
    and end dates), what waits for a second person (`GET /proposals?area=all`), who approved whom and the
    usual wait (`&approved=30`), the Ops Safe's owners (`GET /safe`) for who signs. The two-person rules are
    the API's: money, shop buys, refunds, on-chain changes, invite batches, access changes (only when they
    give Approve, or come from below Approve on Team) and settings. Someone with custom levels is a group of
    their own, not listed in Groups. Actions: invite (the old page's flow), resend, move to a group, turn
    off, sign out everywhere, and a group's levels (`PATCH /groups/:key` with all thirteen); the toast says
    when it went to a second admin.
  - **Settings, live now.** Rules and limits are `GET /sections/settings` (now a served section): each value,
    the change waiting on it and, new, `HISTORY`: each approved change with its old value (worked back from
    the values migration 0057 stored, `FIRST` in `services/command/settings.ts`), who proposed it and who
    approved it. Each row also says whether the server enforces it (`enforced`, new): only shop buys,
    refunds, shipping, the reorder buffer, the pickup hold and asking for a reveal's reason are read where
    they apply; the others say "Stored · nothing enforces it yet". A change is `settings/change` and always
    waits for a second person; you can't approve your own (the panel says so and offers Withdraw), and
    approve and decline are `/proposals/:id/approve|decline`. Connections are the feeds' health now
    (`GET /feeds`); Check now reads it again.
  - **Settings, recorded by Command** (migration 0068, in `GET /sections/settings`). Organization's Profile is
    six more settings (`sec: 'org'`: name, website, help email, time zone, fiscal year start, currency),
    unset until someone sets them, each opened from its row and changed like any other (`settings/change`,
    a second person; each is checked for what it is: a web address, an email, a time zone and currency
    the runtime knows); they're kept out of Rules and limits and its count. Key age is `KEYS`: each
    connection's last recorded key swap (when, by whom, the note, how many), as days against the rotate
    setting, "Never recorded" for one with none; a connection's panel records a swap (`settings/key-rotated
    {connection, on, note}`, a day today or before), since the keys are env vars the server can't date.
    Worth a look is `WORTH`, read from what's kept (no new table): someone's first sign-in, a sign-in from a
    device they hadn't used, a reveal with no reason, and a device not seen for 7 days, in the last 30. `adminSetting(id)` returns the real value live, and Members'
    `addReveal` loads the reveals again.
  - **Still missing, "Not real yet" or hidden live:** connections' hourly history; swapping a key from here
    (it's done in Railway, then recorded); alerts and who hears what (Worth a look is drawn, nothing sends
    it); devices' trust, confirming a new device (Worth a look says nothing confirms them) and signing out one
    device (sign out everywhere is there); showing the profile to members (it's kept, nothing reads it yet); backups; who each person
    signs for on the Ops Safe beyond its owners; a quarterly access review; cancelling an invite; turning
    someone back on (turned-off people aren't listed); exports' second person (a whole list needs Approve
    on its page and a reason, nothing more; the Settings lock "Data exports need a second person" is the
    API's own words and isn't enforced yet); the entities' tax ids unless Governance has loaded. Settings
    that are stored but not enforced: the wait before a change goes live, a new shop's starting cap, the
    batch size, the target margin, the discussion period, passkeys, session length, asking again, key
    rotation, new-device confirmation and the digest.

## Kept from today that the reference lacks

- **Shop** (all in the new page's panels, live):
  - "On the store" (catalog edits, photos, sold out from stock), Phase 11;
  - cost at sale and its history, Phase 10d;
  - order cost and margin.
- **Growth:** Forms (the site's join form inbox).
- **Home:** preview states (Empty, Loading, Error, All clear).
- **Contracts:** the Code tab's contributors view; it folds into Build → Changes (not drawn yet: Build
  live has the commits and pull requests, not the contributors).
