Update the Command Center's UI to match the redesign in `design/command-center-ui/`.

## What's in that folder

- `command-center.html`: the redesigned Command Center as one self-contained file. It is the visual and behavioural source of truth. All data in it is demo data.
- `DESIGN-RULES.md`: the layout and component rules, plus the security behaviour the server must enforce. Read this first.
- `README.md`: every route, its tabs, and where its code lives in `pages/`.
- `pages/`: per-page source (data, render and events, CSS) that is easier to read than the single file. Where it differs from the HTML, the HTML wins.

This is a reference to port, not code to ship. Rebuild it in this repo's stack and conventions. Don't paste the HTML or its inline scripts into the app.

## How to work

1. **Look before building.**
   - Open `command-center.html` with Playwright at 1440, 1024 and 390 wide, in light and dark (`document.documentElement.dataset.theme='dark'`).
   - Go to every route and tab (`#shop/materials`, `#team/rule` and so on). Open a few panels on each page.
   - Read `DESIGN-RULES.md` and `README.md`.
2. **Survey this repo.**
   - Work out the framework, routing, styling approach, existing components, data layer and API, and how auth and permissions work today.
   - Write `docs/ui-redesign-plan.md` covering:
     - each reference page mapped to the existing route and files;
     - the shared primitives you'll build;
     - every place the UI needs data or endpoints that don't exist yet.
   - Then carry on. Don't wait for approval unless something would delete data or change an API other code depends on.
3. **Build the foundations first.**
   - Copy the colour tokens exactly from `:root` and `:root[data-theme="dark"]` in the HTML; same for the fonts (Bricolage Grotesque, Instrument Sans, IBM Plex Mono).
   - Build the app shell: top bar, left rail with Grow, Hold, Rules and Admin groups, a collapsible icon rail, phone bottom tabs with a More sheet, the inbox and the profile menu.
   - Build the primitives the pages share:
     - page header with brief and 4-vital strip;
     - tabs synced to `#page/tab`;
     - 12-column bento band;
     - cell with 56px header and footer;
     - list row, column header row and tinted section band;
     - status chip, calendar-leaf date and hatch fill;
     - right-side panel, segmented control, legend (`f-key`) and toast.
   - Follow the repo's component conventions and naming.
4. **Then the pages, one at a time,** in this order: Home, Growth, Members, Field, Merchants, Shop, Money, Build, Community, Governance, Records, Team, Settings. For each page:
   - Match the layout, tabs, cells, lists, charts, panels, empty states and phone layout.
   - Wire it to real data where endpoints exist.
   - Where they don't, add a typed data adapter backed by fixtures taken from that page's `*-data.js`, and list the gap in the plan doc. Never hard-code demo data inside components.
   - Keep any feature the current app has that the reference lacks, and note it in the plan doc rather than deleting it.
5. **Make the behaviour real, not just the look:**
   - URL-synced tabs and panels;
   - read-only views that hide actions;
   - every propose → waiting on a second person → approve or decline flow;
   - toasts that say what happens next;
   - links between pages (Shop to Money, Team to Settings, Governance to Community and so on).
6. **Security is server-side.** This is in `DESIGN-RULES.md`, and is non-negotiable:
   - Group levels (None, Totals, See, Propose, Approve) are checked on every API request.
   - Totals responses carry no names, emails or accounts.
   - Personal details are masked by default; every reveal is logged with a reason.
   - The two-person rule is enforced in the API. Nobody approves their own; the limits are read from Settings; changing a setting needs a second person.
   - The audit log is append-only and chained.
   - Add tests for these.
7. **The Shop page replaces what's there.**
   - It needs a materials library (kept on hand, made to order, or once per order).
   - Product costs come either from materials × amount or from one cost; overrides by size and colour.
   - Average cost with the last price paid; recording a buy updates the average.
   - Batches use up on-hand materials and add finished stock; suppliers with lead times and price breaks; reorder points.
   - Per-order costs (mailer, tissue, label, payment fee, shipping gap); pickup points.
   - Add the data model and endpoints if they're missing.
8. **Check each page against the reference before moving on.**
   - Playwright screenshots of the app and the reference side by side, at 1440, 1024 and 390, in light and dark.
   - No horizontal overflow; headers and footers aligned within each band; no doubled borders; hatch used only for pending, estimated or empty.
   - Run the tests, lint and type-check.

## Delivery

- Work on a branch named `ui/command-center-redesign`, with one commit per foundation step and per page.
- Open a PR with:
  - a summary per page;
  - before and after screenshots;
  - the gaps list from `docs/ui-redesign-plan.md`, covering missing endpoints, fixtures still in use, and anything you couldn't match and why.
