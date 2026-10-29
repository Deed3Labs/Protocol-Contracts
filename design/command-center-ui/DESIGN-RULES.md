# Command Center: design rules

These are the rules the redesign settled on. `command-center.html` is the visual source of truth; where this file and the HTML disagree, the HTML wins.

## Foundations

- **Paper layout, flat on the page.** Grids sit on the page. Cells touch, sharing 1px lines, with no gutters, no cards inside cards and no drop shadows.
- **Sharp edges.** Only interactive things are rounded: buttons, segmented controls and chips use full pills. Nothing else has a radius.
- **Fonts.**
  - Bricolage Grotesque for display: page briefs, big numbers, panel titles.
  - Instrument Sans for text.
  - IBM Plex Mono for labels, column headers, IDs and times. Labels are uppercase with wide letter-spacing.
- **Colour tokens.** Copy these exactly from `:root` and `:root[data-theme="dark"]` in the HTML:
  - `--ground` and `--raised` for paper;
  - `--fg`, `--fg-70` and `--fg-50` for ink;
  - `--line` and `--hair` for rules;
  - `--live`, `--settled`, `--underway`, `--absent` and `--land` for state;
  - every page also works in dark mode.
- **Breakpoints.** Desktop first, then ≤1180 and ≤1024 for tablet, then ≤760 for phone.

## Page anatomy (every page)

1. **Header.**
   - A small mono line: a green dot, then "Page · context · Demo data".
   - A one-sentence brief written from the data, with links inside it.
   - A strip of 4 vitals. Each vital is a label, a big number with a small qualifier, a segmented mini-bar and one line of context. Clicking a vital goes to the tab it describes.
2. **Tabs** under the header (`gtabs`). The current tab is underlined. Tabs are reflected in the URL hash as `#page/tab`.
3. **Bands of cells** on a 12-column bento grid, with widths of 4/5, 6/6, 7/5 or 12. Cells in one band are equal height.

## Cell anatomy

- **Header:** 56px, one line, title left (h2) and a mono label or control right.
- **Body:** whatever the cell needs.
- **Footer:** 56px, one line, with a full-width divider above it. A note or legend sits left and one action link sits right.
- **Alignment:** headers and footers in the same band line up exactly.
- **Dividers inside a cell** run the full height between the header line and the footer line, never a short floating rule. The October cell on Money → Credit is the example.

## Lists

- **Row height:** rows keep their natural height; never stretch rows to fill a cell.
- **Leftover space** below a short list is filled with the diagonal hatch (see Hatch). A sliver under about 12px gets no hatch.
- **No double lines:** the last row has no bottom divider before the footer, and nothing draws a top border directly under a header that already has a bottom border.
- **Column header rows:** 10px mono uppercase in `--fg-50`, a hairline under the row, about 38px tall.
  - Each label sits exactly over its column.
  - Numbers and status are right-aligned, with right-aligned headers.
- **Section bands** group rows inside a list. Each is a 32px tinted band (fg at 4%) with a hairline above and below, the name on the left and a count on the right.
  - Use them for days in a log, months in documents, or "On the team" versus "Invited".
  - Don't use one band per single item.
- **Row content:**
  - Primary text is 13.5px semibold; secondary is 12px in `--fg-50`.
  - A right-side stack is a bold value over an 11px note.
- **Status chips:** a small square swatch plus text, always at the end of the row.
- **Colour means status only.** Categories (kind, area, group) are plain text in lists. Category colours live in charts and legends.

## Hatch (diagonal lines) means "not real yet"

Use the hatch only for:

- **Pending or not real yet:** an invite not accepted, a setting change waiting on a second person, stock on the way, mainnet not live, an export waiting.
- **Estimated values:** estimated costs, for example.
- **Empty or leftover space:** "nothing to show" states and the space under short lists.

Never use it for decoration or as a category colour.

## Dates, time and flow

- **Calendar-leaf dates** (weekday, then the day number, then the month) at the left of dated rows.
  - Same-day items share one leaf, joined by a tie line.
- **Calendars** have a List / Month switcher.
- **Arrows** use open, line-drawn arrowheads.
- **"Stops here"** is drawn as a dotted line ending in a bar.

## Panels and actions

- **Details** open in a right-side panel: an anchored header (mono label plus a close button), a scrolling body, and a footer holding the actions. The primary action goes on the right.
- **Read-only views** hide action buttons entirely; they are not just disabled. Opening and reading still work.
- **Toasts** confirm an action, say what happens next ("waits on Dana Ruiz in Money") and mention when it was logged in Records.

## Maps

- Real street maps: MapLibre 4.7 with the OpenFreeMap positron style, restyled to the paper palette, with OSRM for routing.
- Maps fill their container.
- City tiles on the map are clickable and open that city in the side list.

## Navigation

- **Left rail groups:**
  - Grow: Home, Growth, Field, Members, Merchants, Shop
  - Hold: Money
  - Rules: Build, Community, Governance
  - Admin: Records, Team, Settings
- **Rail behaviour:** it collapses to icons. On phone there are bottom tabs plus a More sheet.
- **Icons:** 20px, 1.5px stroke, square caps and miter joins. Settings is a gear.

## Behaviour that must be real (server-side, not just hidden buttons)

- **Permissions** are set per group, never per person, with five levels per page: None, Totals, See, Propose and Approve. Optional per-person custom access is allowed.
  - The server enforces the level on every API request.
  - Totals returns co-op numbers only: no names, emails or accounts.
- **One login:** the Clear member-app login for everyone. Every member gets a read-only view, and the same read-only mode serves as the investor data room.
- **Personal details** are masked everywhere by default. Every reveal is logged with who revealed it, whose details, which fields and the reason. A missing reason is flagged.
- **Two-person rule:** money moves, on-chain changes, access changes, settings changes, member data exports, shop buys over the limit and refunds over the limit all need a second person. Nobody approves their own.
  - The limits come from Settings; Shop's buy limit is the live example.
  - Changing a setting itself needs a second person.
- **The audit log** is append-only, with each entry chained to the previous one, and kept 7 years. A correction is a new entry pointing back to the old one.
- **Locked settings** are not editable in Settings. They link to where they are decided: a Governance vote, the bylaws, a policy or the law.
- **Testnet:** everything runs on Base Sepolia and the sandbox or demo modes of Lithic, Bridge and Plaid until mainnet is approved.
