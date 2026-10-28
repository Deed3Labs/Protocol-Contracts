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
- **CSS:** each page's stylesheet is scoped under its page class, the way the shadow root scoped it in
  the reference. The shared rules go in `command.css`, which from now on is maintained by hand rather
  than regenerated.
- **Data:**
  - In prototype and preview mode, a page draws from its reference fixtures. These come from that
    page's `*-data.js`, kept in typed data modules, never inside components.
  - Live, a page reads the API.
  - **Live never shows fixtures.** Kai, 2026-10-24: dev shows only real testnet data. Where a page
    needs data the API doesn't have yet, live shows that cell's empty state, and the gap is listed
    below.
- **Checks:**
  - DOM parity (`e2e/parity.spec.ts`) compares the app with the old reference. As each page is ported,
    its check moves to the new one: screenshots side by side at 1440, 1024 and 390, in light and dark.
  - Plus structural checks: no horizontal overflow; headers and footers aligned within a band; no
    doubled borders; hatch only where something is pending, estimated or empty.
  - The empty crawl and every test suite run for each page.
  - The old reference is retired once the last page moves.

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

## Security: what the server does today, and what changes

| Rule | Today | Change |
|---|---|---|
| Levels checked on every request | Yes (`need(section, level)` on each route) | Add `community` and `settings`. Add tests that every new route checks its level. |
| Totals carries no names, emails or accounts | Yes for Members, Growth, Shop and Merchants (tested) | Extend to every new payload, with a test per page. |
| Details masked by default, every reveal logged with a reason | Masked by default. A reveal is logged **in bulk** ("Showed member names"), **with no reason** | Reveals become per person and per field, with a reason. A missing reason is flagged. Records' Reveals tab reads them. |
| Two-person rule in the API, nobody approves their own | Yes (proposals; own approval refused in the API and by a CHECK) | Limits come from Settings instead of code ($50 refunds and buys today). |
| Limits from Settings; changing a setting needs a second person | No settings store | A new `command.settings` table plus change proposals. Locked settings link to where they're decided. |
| Audit log append-only and chained | Append-only (trigger), **not chained**, no corrections | Each entry gets the previous entry's hash; corrections are new entries pointing back. Add a chain check and its test. |
| Kept 7 years | Not enforced | A retention note plus a check that nothing deletes rows (the trigger already refuses). |

## Gaps: data the reference needs that the API doesn't have

Filled in as each page is ported. Known before starting:

- **Shop:**
  - suppliers, with lead times, price breaks and payment terms (today a supplier is free text on a
    purchase);
  - the "once per order" material kind;
  - average cost and last price paid;
  - reorder points ("lead time plus a week");
  - per-order costs (mailer, tissue, label, payment fee, the shipping gap);
  - pickup points.
- **Members:** nudges (who's stuck at which step, and the message sent).
- **Field:** visit plans and placement scoring beyond what's recorded today.
- **Growth:** traffic by source and campaign, and the member app's install figures (the Apps tab).
  Umami gives some of it.
- **Money:** a Moves queue drawn from proposals (exists) and the cash-flow forecast.
- **Build:** deploys (Railway and Vercel history) and security findings. Changes and Contracts exist
  (the GitHub poller and the indexer).
- **Community:** everything (forum, live events, channel). There's no backend, so live shows empty
  states until it's decided what runs it.
- **Governance:** agreement versions; proposals beyond meetings and votes.
- **Records:** the reveals and exports log.
- **Settings:** the settings store; connections status exists (feeds).

## Kept from today that the reference lacks

- **Shop:**
  - "On the store" (catalog edits, photos, sold out from stock), Phase 11;
  - cost at sale and its history, Phase 10d;
  - order cost and margin.
- **Growth:** Forms (the site's join form inbox).
- **Home:** preview states (Empty, Loading, Error, All clear).
- **Contracts:** the Code tab's contributors view; it folds into Build → Changes.
