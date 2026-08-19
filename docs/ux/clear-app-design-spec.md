# Clear App — Design Spec

Reference spec for rebuilding the member-facing app. Archive existing nav pages; build these.

---

## 1. Navigation

**Pages:** Home · Savings · Earn · Send · Activity · Card
(Assurance lives inside Savings. Settings behind avatar/menu. **No Borrow page** — borrowing is built into Home.)

**Desktop:** horizontal nav in a top bar, left-aligned lockup — the mark, then the wordmark "Clear" — nav items right-aligned. Active item uses primary text color, inactive uses secondary. Bottom border on the bar, 0.5px.

**The mark** sits to the right of the wordmark, 6px away, as a **28px** square — half the 56px bar, which is the proportion a logo in a top bar normally takes. At 22px it read as a favicon: the artwork carries its own padding, so the C inside a 22px square is barely 13px. Its corners are rounded to **22.37%** of its side with **60% smoothing**, and a **1px black at 10%** hairline so it doesn't dissolve into a light page. `border-radius` alone gives four quarter-circles that break where they meet the straight edges — `corner-shape` smooths that junction. Browsers without `corner-shape` fall back to plain 22.37% rounding: same silhouette, slightly less refined. One component for both layouts, so the lockup can't drift.

**Mobile:** **two floating elements**, not one bar — a nav pill hugging the left and an action button hugging the right, with `justify-content: space-between` so the page shows through the gap between them.

```
[ ⌂  ◎  ↗  ▭ ]                    [ + ]
```

**Both are 50px tall with a 17px radius** — matched height is what makes them read as one system. The container sits at `bottom: 20px`, `left/right: 16px`, respects `env(safe-area-inset-bottom)`, and content needs `padding-bottom: 96px`.

Corners are **rounded-square with 60% smoothing**, not a pill. CSS `border-radius` is a circular arc and cannot do smoothing — use the project's squircle token if one exists, otherwise an SVG or `mask-image` superellipse. 17px on 50px is the approximation used in the reference.

**Nav pill:** four items — Home · Savings · Earn · Card. Translucent with `backdrop-filter: blur(20px)` and a 0.5px border. Active item in primary color at 1.9 stroke weight; inactive muted at 1.75.

**Tier hairline:** a 2.5px rule on the pill's top edge, in the color of the tier currently being drawn from. Free savings-backed is green, Boost is purple, and so on. No competitor can copy this because none have tiers.

**Action button:** primary fill. On pages with one obvious action it labels itself and does that thing directly (`+ Save` on Savings, `+ Buy` on Earn), growing in width only — height stays locked. Everywhere else it's a bare `+` that fans quick actions upward.

**Quick actions**, in order, closest to the thumb first: Scan to pay · Send or request · Add to savings · Add money. Chips are 40px with a 14px radius — one step down in the same corner family. On expand the `+` rotates 45° to a close icon, the nav pill dims to 50% but stays put, and page content drops to ~12% opacity.

**Send has no nav item on mobile.** Sending is an action, not a destination — it lives in quick actions and opens the Send page.

---

## 1b. List rows — one pattern everywhere

Every list row in the app uses the same shape, so nothing needs a separate mobile variant:

```
[avatar/icon]  Primary line          [right slot]
               Secondary line
```

- Outer: `display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 0`
- Left group: `display:flex; gap:11px; min-width:0` — the `min-width:0` is what lets long names truncate instead of pushing the right slot off-screen
- Text block: `min-width:0`, primary line truncates with ellipsis
- Right slot: `flex-shrink:0` — a chevron, an amount, or one small button. **Never more than one element.**

**Do not use multi-column grids for rows that appear on mobile.** Secondary information (category, city, source, role) belongs on the secondary line, not in its own column. Desktop-only tables — Activity rows, card transactions — may use a 3-column grid, but the same data on mobile collapses to this pattern.

**Group headers replace per-row labels.** Contacts are grouped under *Members* / *Not members yet*, so no row needs a role tag. If every row in a group would carry the same label, the label belongs on the group.

## 2. Design tokens

**The project already has tokens defined for Light, Dusk and Dark. Use them.** The names below are the roles each surface needs — map them to the project's actual token names and never hardcode a value a token covers.

| Token | Use |
|---|---|
| `--surface-2` | Card and page surfaces |
| `--surface-0` | Empty progress-bar track |
| `--border` | 0.5px card borders, row dividers |
| `--border-accent` | Border on the Clear Credit card when credit is engaged |
| `--text-primary` | Values, active nav |
| `--text-secondary` | Labels |
| `--text-muted` | Sub-labels, legends |

**Tier colors — semantic, not decorative.** These encode cost and risk, so they must stay distinguishable in all three modes. If the project already has per-mode variants, use those. If it only has one set, flag it before building rather than reusing light-mode values on dark surfaces:

| Tier | Color |
|---|---|
| Savings-backed (free) | `#0F6E56` |
| Asset-backed | `#1D9E75` |
| Income-backed | `#BA7517` (fill) / `#854F0B` (text) |
| Clear Boost™ | `#7F77DD` (fill) / `#534AB7` (text) |
| Savings: cash / vested / vesting | `#0F6E56` / `#5DCAA5` / `#9FE1CB` |

Cards: `border-radius: 12px`, `padding: 13px 15px`.

**Currency always carries two decimal places** — `$0.00`, `$6,900.00`, `$2,140.00`. It's money, and a bare `$0` reads as a placeholder rather than a balance. Credits are counts, not currency, and take no decimals: `1,500 of 15,000 credits`. Exceptions: abbreviated figures (`$740k of $1.0M`), recurring prices (`$25 / month`), and rates.

**Bars are one component.** Every composition bar — the balance bar on Home, the credit tier bar, the savings cash/vested/vesting bar, the Earn pool/bonds bar — is `height: 8px`, `border-radius: 4px`, **full container width**, with `margin-bottom: 9px` before its legend. No page gets its own size or a max-width. Progress and time bars (cycle countdown, utilization, milestone progress) are the thinner `height: 5-6px` variant and are visually distinct on purpose.

---

## 3. Core display rules

These are product decisions, not styling. Do not deviate.

1. **Never show a negative balance.** Show "used of available."
2. **`available = cash + (limit − used)`.** Cash spends first; credit engages only at zero.
3. **The limit is fixed within a cycle.** Only `used` moves in realtime. Limit changes are announced as events at cycle boundaries.
4. **One bar means one thing.** The credit bar shows credit used out of limit — it sits empty while spending cash, fills only after crossing into credit.
5. **The ESA is never summed into "available to spend."** It's locked.
6. **Mark the crossing** from cash to credit visibly but not alarmingly: the `$0 cash` figure turns `#534AB7` and the credit card gains `--border-accent`.
7. **Tiers draw cheapest-first, automatically.**

---

## 4. Home

### Two states

**Day one** — see §4d. Two arrivals, two screens. Big number reads `$0.00` **in muted**, subtitle `Nothing saved yet`. No cycle card, no credit card.

**In use**: full layout below. Setup tasks that remain incomplete appear as a task strip under the balance and disappear when done.

### Desktop layout
- Top bar
- Balance block left (`40px` value), **quick actions** right in a 2×2 grid: Add money · Send · Save · Pay
- **Cycle strip** full width — see §4b
- Task strip (accent background) if any tasks pending
- 2-col grid: **Clear credit** stacked over **Term plans** left | **Cash account** stacked over **Savings** right. The Savings card mirrors the Savings page: composition bar, two legend lines, credits progress, and the projected date.
- **Recent activity** full width, 5 rows, showing the **tier name** per row rather than a generic "credit"

### Mobile layout
Stack in order: balance → task strip → cycle → cash account → clear credit → **term plans** → savings → recent activity → (floating nav)

### Cycle strip

**No progress bar, and no day marks either.** One component, **two rows, identical on desktop and mobile**. An earlier draft ran thirty day marks across a three-column desktop strip; it was decoration that had to be re-read every time.

Top row, and it never changes shape: the label `To clear this cycle`, the amount beneath it, and the days remaining as a large numeral on the right. **The label never changes and the amount never becomes prose** — nothing to clear reads `$0.00`, not "Nothing to clear" — so the eye lands in the same place every cycle.

**The figure is the UNSECURED drawn amount, never the full carried balance.** Savings- and asset-backed credit is covered by what the member holds and needs nothing to clear. Showing the total would make secured borrowing look like a debt problem.

Only the second row varies. **Three border levels: accent = something is needed · default = neutral, nothing required · green (`--tier-asset`) = fully clear.**

| State | Amount | Second row | Border |
|---|---|---|---|
| Unsecured, deposit short | `$700.00` | `Nov 1 deposit covers $500.00` / `$200.00 short` + `Repay` | accent |
| Unsecured, deposit covers | `$700.00` | ✓ `Nov 1 deposit covers it` + `Repay early` | default |
| Own savings, nothing owed | `$0.00` | `Using $5,400.00 of your own savings` / `Nothing owed · credits paused while drawn · carry $10.40` + `Top off` | default |
| All clear | `$0.00` | ✓ `All clear · nothing carried` | green |

State three is deliberately **not** green. The member is spending their own savings — nothing is owed, but it isn't the same as clear: it pauses housing progress and accrues carry on the asset-backed part. The sub-line says so outright (`credits paused while drawn`), because "nothing owed" on its own reads as good news and the paused credits are the actual cost. `Top off` rather than "pay down", because they didn't borrow.

Only the first state asks for anything. The direct-deposit line does real work here: most members are in state two and shouldn't be nudged.

### Repay / Move to cash — one modal

They are the same action; the only difference is whether a negative balance is in the way. **Same component, same source, same destination.**

- **Carrying a balance** → title reads `Repay`, and a `THIS CLEARS` section shows the tier unwind — most expensive first (`Clear Boost · 3%` then `Income-backed · 1.5%`). Quick-picks: `Clear cycle` (the unsecured amount), `Clear all`, `Custom`.
- **Not carrying** → title reads `Move to cash`, the clears section drops out, quick-picks reduce to `All` / `Custom`, and a line explains it's simply moving money.
- **Partial** → shows what each tier gets (`$400.00 of $500.00`, next tier `untouched`) plus an accent warning naming the shortfall and the date the limit contracts.
- **Overpayment** → a success block reads `Left over → Spendable` with the figure, and *"Clears everything you're carrying, and the rest lands in your cash account."* Money only spills to Spendable once **everything carried** is cleared — not once the cycle requirement is met.
- Footer when carrying: *"Most expensive credit clears first."*

Summary rows: `From` · `Still carrying` · `Cycle`. The cycle row is the one that matters — it tells the member whether this action actually resolves anything.

### Clear credit card

```
Clear credit used            $5,400 of $12,300
[███|███|░░░░░░░░|░░]   ← 4 segments
● Savings (CLRUSD) · free          $3,000 of $3,000
● Asset-backed · 0.65–0.75%        $2,400 of $8,300
● Income-backed · 1.5% / cycle     $0 of $1,000
● Boost · 3% / cycle               not added        (50% opacity)
─────────────────────────
Carry cost so far                  $10.40
Drops to $0 when you get back under $3,000
[ Add Clear Boost ] [ Limit breakdown ]
```

**Limit math must always reconcile.** Displayed limit = sum of *active* tier capacities. Boost is NOT counted until added:

| Tier | Capacity | Drawn |
|---|---|---|
| Savings-backed | $3,000 | $3,000 |
| Asset-backed | $8,300 | $2,400 |
| Income-backed | $1,000 | $0 |
| **Active limit** | **$12,300** | **$5,400** |
| Boost (not added) | +$500 | — |

Available to spend = cash $0 + ($12,300 − $5,400) = **$6,900**.

Bar segments as % of the $12,300 active limit, in draw order: savings drawn 24.4% (solid) · asset drawn 19.5% (solid) · asset remaining 48% (pale) · income remaining 8.1% (pale). Solid = drawn, pale = available, same hue per tier.

Boost row renders at 50% opacity when not added. **Boost activation** appears in two places: an `Add Clear Boost` button on this card (paired with `Limit breakdown`), and an inline `Add $500` button on the Boost row inside the breakdown. Adding Boost is always an explicit opt-in — never automatic, never a silent limit increase.

### Limit breakdown (sub-view)
Grouped into **ASSET-BACKED** and **UNSECURED** headers. Each row: name, contribution to limit, and a sub-line showing `underlying position · LTV · rate`. Footer: total limit, then the line *"Your bonds are worth more each month, so this limit grows on its own."*

Boost sits in the UNSECURED group but is **excluded from both the group subtotal and the total limit** until added — its row shows an inline `Add $500` button instead of a contribution figure. Group subtotals and the total must always sum from the rows shown.

## 4c. Term plans — the fixed-term shelf

Everything with a **set amount and a schedule** lives here, beneath Clear credit: a merchant split, a cash plan, a ground lease, an ELPA mortgage. What makes an item a term plan is **what backs it** — an ACH authorisation on a linked external account. That's more direct than a card, and it's why the co-op is comfortable issuing to a member who may never route their paycheck to Clear.

Clearing is the same system as everywhere else: **balance first, then the linked account**. There is no fixed due date and carry accrues by time held, so **clearing early always costs less**.

**Locked rows are visible from the first minute, on both signup paths**, each stating its own unlock condition. A member who joined at a tire counter sees the home on the same shelf as the repair; a member who signed up directly learns what partner credit is before meeting a merchant. This is the point of the component, not a side effect of it.

**No bars anywhere.** Every figure here is an amount or a count.

**Card:** label + headline total, then the rows, then footer subrows.

- Headline is the sum of what the plans were **taken out for**, with `of $X` against the **balance cap** when one applies. Once the shelf carries an amortising plan the cap is replaced by `incl. ELPA` — a mortgage was never inside it.
- Active row: name (+ month opened) and **one figure — the amount the plan was taken out for**. How far through it is belongs on the sub-line as `50% cleared` **in `--tier-asset` green** — the one part of the line that's good news — not beside the name: a second figure there competes with the row's own name for the glance, and the amount a member recognises is the one they agreed to. A plan nothing has been paid on omits the segment entirely rather than reading `0% cleared`. Beneath: `Split in 4 · $246.75 a cycle · 50% cleared · 2% / cycle`.

  Easy to get backwards, and the Home figures won't catch it: a plan exactly half elapsed has the same paid and remaining. **Day one is the case that tells them apart** — a plan taken minutes ago reads `$0.00 / $940.00`, never `$940.00 / $940.00`. Amortising plans state one figure and count payments instead: `$1,410.00 a cycle · payment 7 of 360`.
- Locked row at 55% opacity: name and `Locked`, over the unlock condition.
- Footer is **two cells side by side**, split by a hairline: `Limit $850.00/cycle` and `Clears from Chase ····4471`, each a tap target with its own chevron. The label sits inline ahead of its value rather than opposite it, which is what lets two fit on a phone without either becoming a footnote-sized target; values truncate with an ellipsis. Both cells are always present — either alone leaves the other a mystery.
- Empty state: `$0.00` muted, every row locked, footer reads `Nothing scheduled yet` — no cells.
- Ordered by **how soon a member reaches them**, not by size — which is why a $248k mortgage sits last.

### Choosing the split (modal)
Offered at checkout and changeable any time after. Amount headline, then `HOW TO CLEAR IT · 2% A CYCLE ON WHAT YOU STILL OWE` — the rate stated once, with what it's charged on, rather than repeated per row leaving the member to guess whether it applies to the original amount or the balance. Then `In full` / `In 2` / `In 4` / `In 12` and five rows:

| Row | On $940 in 4 |
|---|---|
| `Each cycle` | `$246.75` — principal and carry together, levelled |
| `Carry this cycle` | `$18.80` — the cost of holding the balance once |
| `Carry over the whole plan` | `$47.00` |
| `Total` (medium weight) | `$987.00` |
| `Done by` | `Mar 14` |

**Each cycle is the payment, not the principal.** It's the only figure a member can check against their bank, so it's what the shelf row shows too — `$246.75 a cycle`, never `$235.00`. Two carry figures because they answer different questions: one without the other either hides the running cost or makes a small charge look large. Footer: *"Clearing early always costs less. You can change this any time."*

The three figures are what make the choice honest — spreading further costs more and the carry line says so in dollars, so no warning is needed. Carry is charged on what's still outstanding each cycle, which for an even split is `amount × rate × (n + 1) / 2`. On $940 at 2%: `$18.80` in full, `$28.20` in 2, `$47.00` in 4, `$122.20` in 12.

**`In full` is one cycle, not none.** The member still holds the balance for a cycle before clearing it, so it costs `$18.80` — the cheapest option, not a free one. "Clearing early always costs less" is a comparison between options, not a claim that one of them is free.

Picking an option only previews it. **A `Save changes` button commits**, disabled while the selection matches what the plan is already on — a schedule that rewrote itself under the member's finger would be the wrong kind of responsive.

### Your term limit (modal, from the `Limit` cell)
Leads with *"Set by the income landing in your accounts and what already goes out of them — not a credit score."* — the assumption otherwise is a score, and the whole point is that it isn't one.

**Two constraints, and the lower one applies. Both are shown**, because a member who sees only the binding figure can't tell what would move it — and the two move for different reasons:

| Constraint | Note |
|---|---|
| `Payments a cycle` — `$459.44 of $850.00` | *"Across every open plan."* |
| `Total open at once` — `$1,350.00 of $3,000.00` — the shelf headline, so the two can't disagree | *"A ceiling regardless of income."* |

Whichever sits closer to its ceiling carries `--border-accent` and gains *"This is the one binding you now."* Then `INCOME AND OUTGOINGS READ FROM` listing the accounts the limit is read from plus the Clear balance, `Manage linked accounts`, and: *"It grows as your income holds steady and plans clear on time. Nothing to apply for."*

### Payment account (modal, from the `Clears from` cell)
Leads with *"Your Clear balance is always used first. This is where the rest comes from."* — otherwise picking an account reads as choosing who gets paid. Selectable linked accounts, the active one carrying `--border-accent` and a check. `Link another account`, then: *"Changing this applies to every term plan. Nothing scheduled is missed — the next clearing uses the new account."*

Selecting a row previews it; **`Save changes` commits**, and it applies to every term plan at once — too broad to happen on a tap.

Same list as Settings › Linked accounts, scoped to the ACH fallback.

### Cash account card — two parts

The account holds money on two rails, and the card must make the difference legible without naming the rails. Members don't care about Lithic vs chain; they care what each can do.

| Part | What it is | Label | Can do |
|---|---|---|---|
| **Spendable** | Fiat in the bank account | `Spendable` — headline figure | Card, payments, bills |
| **Ready to allocate** | USDC moved on-chain, not yet placed | `Ready to allocate` | Savings and Earn only — **never the card** |

**Layout:** Spendable is the hero — label left, amount right at 17px, the same size as Clear credit's and Term plans' headline values so the three cards in that column rank equally. Directly beneath, a **split sub-line**: `Card and payments` left, `[next deposit date] · ~$X` right. Nothing runs the full width under the balance; a single long sub-line visually merges with the number above it and was the flaw in the first version of this card.

- **Spendable reads `$0.00` in the reference's Home state**, because that screen shows a member who has exhausted cash and is on credit. The cash figure must always agree with the credit bar and the available-to-spend line on the same screen.
- Ready to allocate sits below a divider. **At $0.00 it renders as a single muted row** — label and amount only, no sub-line, no actions. Present so the model is learnable, quiet so it isn't clutter. Non-zero, it expands **in place** — same shape as Spendable, with its own split sub-line (`Savings and Earn only` left, `Not spendable on your card` right) and three actions beneath: `Savings`, `Earn`, `Back to cash`. **No nested card.** A card inside a card reads as a foreign element; the two parts of one account should share one surface.
- Footer: direct deposit status left, `Details` right.
- **Do not total the two.** A combined figure implies fungibility they don't have.

**$0 is the correct resting state.** Money reaches Ready to allocate only when a sweep is mid-flight or has partially failed, or when a member deliberately parked funds without placing them. Every action on the block clears it.

### Account details
The `Account details` button opens a **modal** (bottom sheet on mobile) — not an inline expansion. The modal holds routing and account numbers with masked-by-default + reveal, copy-to-clipboard on each field, and the `Set up direct deposit` flow with employer instructions. Rationale: these are sensitive values and a task surface, so they shouldn't sit ambient on Home or push the layout down.

### Savings card
Total balance headline. 3-segment bar (cash / vested / vesting). Two legend lines: cash first, then vested + vesting together. Footer: `1,500 of 15,000 credits` + `[Add]` button.

---

## 4d. Day one — two arrivals, two screens

Both are day one, and they are **not the same screen**. The difference isn't cosmetic: one member has an active obligation and a reason to be here, the other has an empty shelf and a decision to make.

**Same components, reversed order** — whichever one they're here for leads:

| | Leads | Then |
|---|---|---|
| **From a counter** | Term plans, carrying the plan taken minutes ago | Accent card: `MAKE THIS FREE` — *"Borrowing against your own savings costs nothing. You're paying 2% because there's nothing behind it yet."* + `Start saving` |
| **Signed up directly** | Accent card: `Start with anything` — *"Saving is what makes everything else free. Most members start at $25 a paycheck."* + `Set up auto-save` | The locked shelf, showing what saving unlocks |

The counter arrival puts the savings pitch directly beneath the plan, where the cost of not saving is visible. The direct arrival leads with saving because there is nothing else.

**There is no flag for this.** The screen keys off whether anything is scheduled — a member with an active term plan arrived from a counter, by definition.

---

## 5. Savings page

**Desktop and mobile carry the same five blocks in the same order.** Only the arrangement differs — desktop puts the path beside a stacked right column; mobile stacks everything.

1. **Hero** — balance, the three-segment composition bar (cash / vested / vesting) with a single combined legend line, and the two actions. The composition bar belongs on **both** layouts; an earlier draft omitted it on desktop.
2. **Credits progress** — `1,500 of 15,000 credits` with a full-width track and `Clear Deed at 15,000` at the end. This is the page's real headline metric and deserves its own row, not a subtitle.
3. **Your path to a home** — a connected **spine**, not a checklist: a vertical rule through five milestone dots. Completed dots fill solid; the current one is a ring with an accent halo; future ones are hollow at reduced opacity. Right-aligned status per row (`Done`, `2,500 credits to go`, or the threshold).
4. **On track for** — projected date to reach 15,000 at the current rate, plus what a higher rate would do, and `Adjust auto-save`. This is what converts the milestone list from a status display into something a member can act on.
5. **Assurance** and **Credits vesting** — protections list with Active/Locked, and dated vesting rows.

*(Only "Home repair assurance" is a confirmed protection name; the other four are placeholders.)*

---

## 6. Earn page

Same structure on both layouts. **One bar on the whole page** — the composition bar in the hero. Everything else that was a bar is now a number, a ring, or a table.

1. **Hero** — total earning, two-segment composition bar (pool / bonds) with a combined legend, then two stat cards: **Earned to date** and **Backs your limit**. That second figure is the differentiator and belongs at the top.
2. **Liquidity callout** — one line: *"Locked doesn't mean unavailable — both products back your credit line at under 1% a cycle."*
3. **Your positions** — what the member owns, before anything they could buy.
4. **Buy a bond** — the ladder.

### Pool card — ring, not bar
Utilization is a **58px ring** sitting beside the APY, not a full-width track. It pairs the two numbers that belong together (what you earn, how hard the pool is working), costs no vertical space, and is a different visual family from the composition bars elsewhere. Caption beneath the rate: `Variable · $740k of $1.0M lent`.

Position rows below: your position, earned, `Backs limit at 70%`. **The withdrawal-queue warning does not live here** — it belongs in the withdraw modal, at the moment it matters.

### Owned bonds — face value is the hero
Every line is a **left value and a right value on the same axis**. No centred blocks inside two-column cards; that was the flaw in the first version and it made nothing align.

```
$5,000.00                              Mar 2028
at maturity · paid $4,325.00           19 months left
─────────────────────────────────────────────────
Worth today                            $4,459.00
```

Face value at 16px is the promise. **Worth today is divided off** because it's the one figure that changes, and it carries the accretion story that makes the limit grow on its own. Term and countdown are tertiary. Do not print the face value twice.

### Ladder — state face value per row
Five columns: `Term · You pay · Discount · You get · Yield`. Stating `$1,000.00` on every row removes the need for a "per $1,000" caption entirely, and the discount column states outright what used to be left as subtraction — it's the thing being offered, so the member shouldn't have to do the arithmetic. Mobile shortens the headers to `Pay · Disc · Get`.

**No yield curve.** Four points is too few to read as a shape — it looks like a line with dots. The table carries it.

### Bar discipline
Composition bars earn their place — a stacked bar is genuinely the best tool for showing what something is made of (credit tiers, savings cash/vested/vesting, Earn pool/bonds). **What's overused is a bar showing a single ratio**, where a number, a ring or a row would do. Before adding one, check it's showing composition and not a percentage.

## 7. Send page

**Left column:** search, pending claims banner, **Contacts**, then **Clear Partners near you** with a `See all` link. **Right rail:** the member's QR code, `Scan to pay`, and a `Kept in the network` figure for the cycle. On mobile the QR leads, since getting paid is the more common action.

**Contacts replaced "Recent."** A recent-payees list only works once someone has paid people; contacts work from day one, distinguish members from non-members, and give the invite loop a home.

### Clear Partners directory (own page)
Reached from Send. Search, category filters, and rows of `avatar · name · category · city`. Right rail carries a map and a `Refer a business` card — members refer most partners, and the pitch to a business is instant payment with no processing fee.

This page is what makes the network visible. Without it, a member has no way to answer *"where can I actually spend inside the loop?"* — which is the question the whole velocity thesis depends on. It also gives partners something concrete in return for joining: a listing where members look for places to spend.

*Implies two surfaces not yet designed: merchant onboarding and a partner profile page.*

### Contacts (settings sub-page + modal)
Grouped **Members** / **Not members yet**, with `Invite` on the latter. Search, `Add`, and `Sync phone contacts`. Footer: *"Sending to someone who isn't a member creates a claim link. They join to collect it."*

**Add a contact modal** — name, identifier, and a live status row showing whether they're a member, with the 14-day claim explanation when they're not.

## 7b. Send page (original notes)

- **Your Clear code** — QR, `@handle`, "Show to get paid". On mobile this leads.
- `Scan to pay` · `Request`
- Search by name / phone / @handle
- **Recent** — avatar circle with initials, name, and role badge (`Member` / `Clear Partner`)

---

## 8. Activity page

**Desktop is two columns.** Left: search, filters, export, pending-claim banner, and date-grouped rows. Right rail:
- **This cycle** — total spent, split cash vs credit, carry cost
- **Where it went** — category breakdown (needs MCC from the processor)
- **Inside the co-op** — *"$35 of $1,842 stayed with members and Clear Partners this cycle."* This is the velocity metric shown to the member as their own number, and it's the only place the network becomes visible before it's large.

## 8b. Activity page (row detail)

- Filter chips: All · Spending · Deposits · Savings · Sent
- **Pending claim banner** (accent bg) when money is sent to a non-member: `$40 waiting for Marcus T. to claim` / `Sent Oct 26 · expires in 12 days` + `Remind`
- Rows grouped by date header (`Today`, `Oct 25`)
- Every row shows a **source tag**: `credit` / `cash` / `savings` / `cash account` / `pending`
- Desktop: 3-col grid (name | source | amount). Mobile: source as sub-line.
- Credits/deposits in success color with `+`, debits in primary with `−`

---

## 9. Card page

- Card visual: dark fill `#2C2C2A`, **0.5px border `#5F5E5A`** (needed or the shape vanishes in dark mode), aspect ratio ≈ 1.586:1
- Contents: "Clear" wordmark, contactless icon (rotated 90°), chip rectangle (34×25, `#888780`, 4px radius), masked PAN in mono with last 4, cardholder name · expiry, network mark
- Actions: `Freeze` · `Details`
- Caption: *"Spends your cash first, then your credit line. No transfers needed."*
- **Card transactions** list (card only — distinct from Activity, which shows everything)
- **Desktop is two columns, not three** — a middle column squeezes. Left rail (270px): card visual, physical/virtual toggle, freeze/details, **Controls** (contactless, online payments, ATM, international) with spend limits, and add-to-wallet. Right: transactions at full remaining width.
- Card controls were missing entirely and are table stakes for a neobank.

---

## 10. Build order

1. Nav shell + floating mobile tab bar
2. Home (both states)
3. Savings
4. Activity
5. Card
6. Send
7. Earn

Sign-up, Add-to-savings, Account details, and Add Clear Boost are flows/modals, not nav pages.

---

## 11. Modals

Centered modal on desktop, bottom sheet on mobile. Both are task surfaces — never inline expansions.

### Account details (from Cash account card)
- Routing and account number rows, **masked by default**, each with a reveal toggle and a copy button
- Direct deposit status block with a line explaining that routing payroll raises the income-backed limit
- Actions: `Send instructions to my employer` · `Download prefilled form`

### Add Clear Boost (from Clear credit card, or the Boost row in the limit breakdown)
- Amount headline, rate, and `only charged on what you use`
- Comparison rows: limit today, limit with Boost, cost if used in full for a cycle
- Accent callout explaining Boost is drawn **last**, after everything cheaper
- Primary action `Add Clear Boost`, with a line noting it can be removed when not carrying a balance
- Adding is always explicit opt-in — never automatic, never a silent limit increase

### Buy a bond (from Earn)
- Term selector (12 / 24 / 36 / 60 mo) as segmented buttons
- **You pay today** as the headline figure; face value, maturity date, fixed yield, and funding source below
- A row showing `Adds to your credit limit +$X` — 95% of the amount paid. This is the line that makes bonds feel liquid rather than locked.
- Accent callout: locked until maturity, but borrowable against at 0.65% per cycle
- **Reserve-date check**: compare bond maturity against the member's estimated 15,000-credit date and state it plainly. Never block the purchase — just surface the fact when the bond matures after their likely move-in.

### Add to savings (from Home or Savings)
- Amount with quick-pick chips
- Success-tinted block: `You'll get $X in equity credits` / matched 1:1, vests after 30 days
- Source, repeat schedule (**default: every payday**), and the resulting new credit limit
- Footer: `Locked until you reserve a home or leave`

### Transaction detail (from any Activity or Card row)
- Amount, merchant, location
- Date/time, **which tier it was paid from** (colored dot + name), the rate on that draw, card last 4, status
- Actions: receipt, report an issue

### Card details (from Card page `Details`)
- Card face with the **unmasked PAN** shown
- Copyable rows: card number, expiry, security code (CVV **masked by default** with a reveal toggle)
- Auto-hide countdown — details re-mask after ~5 minutes — plus a "Clear will never ask for these" line
- Action: `Add to Apple Wallet` / `Add to Google Wallet`
- Requires biometric or PIN re-auth before opening

### Deposit / withdraw — yield pool (from Earn)
- Amount with quick-picks including `Max`
- Source, current rate (marked **variable**), estimated 12-month earnings
- `Adds to your credit limit +$X` — 70% of the position
- Accent callout: withdraw any time, but at high utilization withdrawals may queue
- Withdraw variant mirrors this, and must state current queue status if utilization is high

### Send money (after picking a recipient)
- Recipient block, amount, optional note
- **Paying from** row showing which tier funds it — the same colored-dot treatment as transaction detail
- Fee (none for members and Clear Partners) and arrival time
- Footer for non-members: they get a link and have **14 days to claim**, after which it reverses to the sender

The paid-from row is Clear-specific and worth keeping — it's the only place a member can see, after the fact, exactly which tier a purchase drew on.

---

## 12. Onboarding

**Sign in and sign up are one screen and one component.** Privy resolves whether the identifier already exists — the member never chooses. Passwordless throughout: phone/email OTP, or Google/Apple. Returning members get passkey or biometric with OTP fallback.

**Desktop** is a split layout — static brand panel left (copy changes per step), flow panel right. **Mobile** is full-screen steps. The right panel and the mobile screen are the same components.

### 12b. At a merchant counter — a different flow, not a variant

Starts by scanning the shop's code rather than arriving at a site. **The pending total rides along on every step** — it's the strongest motivation in the product, and it's what makes a five-step flow tolerable while someone stands at a counter waiting.

| Step | Asks | Ends with |
|---|---|---|
| `1 · SCAN` | Nothing — the shop code opens `clear.coop/mikes-tire` | `Add to Home Screen`. No app store, no download |
| `2 · ENTER` | Phone number | `Continue` — *"No credit check. About three minutes."* |
| `3 · JOIN` | ZIP, invite code **pre-filled from the shop** | `Agree & join` |
| `4 · LINK — REQUIRED` | Bank connection | `Connect securely` — *"Read-only. We never see your login."* |
| `5 · CHOOSE` | The split (§4c's chooser, same five figures) | `Confirm & show the shop` |

**Linking is required here** where the direct path defers it: it's the underwriting, the repayment rail and the limit calculation at once, and it's the likeliest drop-off point — which is why step 4 spends its words on what the link is *for* rather than on the mechanics.

**The split is chosen here rather than later**, because the member is already deciding. Asking again that evening would be a second decision about a settled thing.

**Identity verification stays deferred** to the first deposit, exactly as on the direct path. A bank link is not a KYC substitute, but it's enough to extend a small term plan.

### The branch — one onboarding, two entries

The steps are the same; what differs is where they arrive from, whether a total is pending, and whether the bank link is required now or later.

| | At a counter | Directly |
|---|---|---|
| Arrives from | Shop QR → A2HS | Site, referral, search |
| Pending total | Shown on every step | None |
| Invite code | Pre-filled | Optional |
| Bank link | **Required** | Deferred to first plan |
| Ends at | Split choice | Start saving |

A direct signup who only wants to save doesn't need a linked account on day one. It becomes required the moment they want a term plan — which is also the moment they have a reason to give it.

### Three gates, deliberately separated

1. **Enter** — phone, email, or social. One field. They're in the app immediately.
2. **Join the co-op** — membership agreement, ZIP, optional invite code. Required before anything but looking around.
3. **Verify identity** — KYC, triggered at the **first deposit**, not at signup. Still a **full page**, not a modal, on both desktop and mobile — same as every other onboarding step.

Deferring KYC is the single most important decision here. Asking for an SSN and photo ID before someone understands the product is where fintech funnels die. Let them reach the day-one Home screen first.

### Membership — there is no buy-in
**The member's deposit IS their share.** That's what "Equity Savings Account" means. Never show a membership share as a separate cost, a deduction from a deposit, or a step in onboarding — joining is free.

**One member, one vote.** Not weighted by balance. Say this on the join screen; it's the clearest statement of what makes this a co-op rather than a bank.

The only fee anywhere is the **optional acceleration fee** (monthly or yearly), which moves a member toward benefits they would otherwise earn through time and behavior. It lives in the profile menu, never in onboarding — it is not a condition of membership.

### Details that carry weight
- Under the SSN field, always: *"Not a credit check. Doesn't affect your score."* That specific fear is the top abandonment cause on this step.
- The **day-one Home screen is the end of onboarding.** No welcome tour — the setup checklist is the tour.
- **The embedded wallet is invisible.** No addresses, seed phrases, chains, or crypto vocabulary anywhere in onboarding. It lives under Advanced in settings.

### Waitlist (ZIP outside the service area)
Not a dead end. Show position in line for their named metro, explain that regions open when enough people are waiting, capture email, and offer a share action. Allow changing the ZIP later.

### Claim variant
Same flow, different entry. First screen leads with the amount and sender. **The full amount lands in their account** — joining costs nothing, so `You receive $40.00 / Cost to join: None`. No invite code is needed either — the sender is the invite. This is the primary acquisition loop; treat it as a first-class path, not an edge case.

---

## 13. Profile & settings

Two surfaces, same content model.

**Profile menu** — dropdown anchored to the avatar on desktop, bottom sheet on mobile. Quick access only.

Layout rules: **every menu row is 38px** so the list has an even rhythm; the avatar is a **42px squircle at 14px radius**, matching the nav; the identity block carries a chevron since it's tappable; the `APPEARANCE` label sits above the theme control rather than leaving it floating; and **acceleration is a row, not a card** — as a card it competed with the identity block for weight. Sign out is divided off below.

**Settings page** — the full surface. Desktop is a 190px section rail beside a content pane; mobile is grouped drill-in rows. Sections:

| Section | Contents |
|---|---|
| Personal information | Legal name, phone, email, home address |
| Membership | Member since, `Your stake: your savings balance`, `Your vote: 1 of 1 — same as everyone`, region, agreement & bylaws |
| Acceleration | Status, one line on what it does, `See what it unlocks`. The only place the optional fee appears. |
| Appearance | Light · Dusk · Dark segmented control |
| Security | Face ID, trusted devices, login history |
| Linked accounts | Direct deposit status, external bank, employer |
| Advanced | Wallet address, export data, close account |
| Help / Legal | Support, agreements |

**The Membership card is the ideological anchor.** `Your stake: your savings balance` and `Your vote: 1 of 1 — same as everyone` are the two lines that make co-op membership concrete for someone who has only ever used a bank app. Keep them visible rather than buried in a legal doc.

### Settings sub-pages

Same content, two presentations: **mobile pushes a page** with a back affordance; **desktop swaps the right-hand pane** when the matching rail item is selected. The desktop rail is a real selector — it should never render every section stacked at once.

**Every sub-page has both layouts in the reference.** Membership documents (bylaws, patronage, voting) render in the settings shell under the Membership rail item. Assurance, its reserve explainer, and Alerts are standalone pages with the main top nav, not settings panes — they are reached from Savings and the bell, not from settings.

**Modals need no separate desktop version.** Centered on desktop, bottom sheet on mobile, same content and same width.

| Sub-page | Contents |
|---|---|
| Personal information | **Profile photo** block at the top, then legal name, DOB, address, phone, email. Name and DOB **locked after identity verification** — say so, with a support path. |
| Membership | Member since, stake, `Your vote: 1 of 1`, region, agreement, bylaws, patronage, voting history |
| Notifications | Grouped toggles under Money / Credit / Savings. The credit group is the important one: *using credit*, *rebalance reminder*, *limit changes*. |
| Linked accounts | Direct deposit status with `Account details`, external bank, employer, link another |
| Security | Face ID, require Face ID for payments over a threshold, trusted devices, login history, recovery contacts. State plainly: *"There's no password on your account."* |
| Legal & agreements | Versioned document list — membership agreement, bylaws, deposit terms, Clear Credit terms, cardholder agreement, privacy, Earn disclosures. Show version and accepted/updated date per document. Download all as PDF. |
| Help | Search, common questions, message support with expected reply time, report a transaction, dispute resolution |

### Membership sub-pages

| Page | Contents |
|---|---|
| Document viewer | Rendered agreement or bylaws with version header, jump-to-article, search, download. Article I should state the two facts that define the co-op: no separate share purchase, and one vote per member regardless of balance. |
| Patronage & distributions | Fiscal year status, the member's patronage basis (**activity, not balance**), declared amounts, history, and a link explaining the calculation. Empty state is normal for year one — say so. |
| Voting | Open votes with a close date and a `Cast your vote` action, plus past votes with outcome and whether the member participated. Footer: one member, one vote regardless of balance. |

**Cast your vote modal** — question, close date, participation count, options as selectable rows including Abstain, and a footer noting the vote is recorded on the co-op ledger and can't be changed after submitting.

### Assurance detail page

Reached from the Assurance card on Savings. One row per protection: name, what it actually covers in plain language, and either `Active since N credits` or `N credits to go`. Locked rows render at reduced opacity with a lock icon; active rows use the asset-tier green shield.

**Four of the five protection names in the reference are placeholders.** Only "Home repair assurance" is confirmed. Replace the rest before this page ships — placeholder names hardening into the codebase is the main risk on this screen.

Two lines worth keeping verbatim: on Membership, *"However much you save, your vote counts the same as every other member's."* On Linked accounts, *"We never move money without you asking."*

**Rebalance reminder defaults on.** It's the notification that prevents the equilibrium miss that shrinks someone's limit — the one message where sending it is unambiguously in the member's interest.

### Profile photo

A block at the top of Personal information: 60px avatar at 20px radius with a small pencil badge overlapping the corner, a one-line explanation (*"Members see this when you send or request money"*), and a `Change` button. The avatar itself is tappable.

**Photo modal** — large preview (96px, 30px radius), then three options: take a photo, choose from library, and remove photo (secondary styling, subtitled *"Go back to initials"*). Footer: *"Visible to members and Clear Partners you transact with. Not shown publicly."*

**Crop step** — a squircle mask over the image with pinch-to-zoom and drag-to-reposition, then Cancel / Save photo. The mask must be the **same corner family as the avatar**, not a circle, or the crop won't match where the photo lands.

**Initials are the default, not a placeholder to apologize for.** Every avatar in the reference renders as initials on a tinted squircle — that's the resting state, and a photo is an optional upgrade.

### Settings modals

Only these six need modals; every other settings row is a drill-in sub-page.

**Acceleration** — a comparison table (Standard vs Accelerated) covering Boost size, credit vesting speed, income-backed rate, and community priority. Monthly and yearly price options. **Always show how close the member is to earning the same benefit for free** (`You're 4 clean cycles from the Boost increase anyway`) — acceleration is a shortcut, not a gate, and saying so is what keeps it from reading as a paywall. Footer: `Your vote is unaffected either way.`

**Change phone / email** — new value plus OTP re-verification before the switch. Warn that this is the sign-in credential and that losing both phone and email means a multi-day recovery.

**Trusted devices** — list with location and last-active, per-device remove, and `Sign out everywhere else`.

**Advanced** — wallet address with copy, data and transaction exports, and the entry to account closure. One line framing the wallet: *"Your account is a smart wallet. You don't need this for anything in the app."*

**Close account** — the highest-stakes surface in the app. Must itemize, before any confirmation: savings returned, credit balance settled first, bonds held to maturity, **equity credits forfeited**, and the resulting net figure — which can be negative. Explain plainly that credits are earned by staying and don't transfer out. Offer `Talk to someone first` above the destructive action, and make the destructive action secondary styling, never primary.

**Sign out** needs no modal.

**The wallet address lives under Advanced and nowhere else.** No chain names, no seed phrases, no crypto vocabulary anywhere else in the app.

---

## 14. Remaining flows

**Auto-save** (Savings) — amount, cadence (**default: every payday**), next run, match per run, and a projected date to reach 15,000 credits. Skip rather than overdraw if the balance is short on the day. This is the highest-leverage modal in the app: recurring contribution is what makes the savings product work.

**Withdraw from pool** (Earn) — amount, destination, arrival, current utilization, and **how much the credit limit drops**. If the member is carrying credit backed by that position, say so and confirm they'll still be under their limit.

**Request money** (Send) — recipient, amount, note, expiry. Footer: *"They choose whether to pay. Nothing moves until they do."*

**Scan to pay** (Send) — full-screen camera with a framing reticle and a manual-code fallback.

**Link an account** (Linked accounts) — instant connect vs manual entry, with *"We never store your bank password, and we never move money without you asking."*

**Recovery contacts** (Security) — pick a member who can vouch for you. Must state the limit of their power: *"They can't see your balances or move your money — only confirm it's you."*

**Inbox** (bell icon) — alerts and XMTP messages in one surface with a segmented control and unread counts per tab. Two streams of "things waiting on me" belong in one place, not two header icons.

*Alerts tab:* grouped by recency (TODAY / THIS WEEK), colored dot per category, `Mark all read` in the header. **Swipe reveals Read and Clear.** Actionable alerts carry the action inline — `View cycle`, `Cast vote`. An alert about an open vote that can't be voted on from the alert is just noise.

*Messages tab:* XMTP conversations with squircle avatars, preview, timestamp, and an unread dot. **Payment events appear inline with conversation** — "Diego R. sent you $35 — thanks for covering lunch" — so a payment and the talk around it live in one thread. Footer: *"Messages are end-to-end encrypted and tied to your account, not your phone number."*

**Alert row anatomy** — same shape as a message row so the two tabs feel like one system:
- `padding: 12px 0` with **no horizontal padding** — rows align to the container, they don't inset from it
- 7px status dot, `margin-top: 7px` to sit on the first text line
- **Title and timestamp share the top line**, title left and time right-aligned with `flex-shrink: 0`. The timestamp is not a third stacked line.
- Body beneath at 12px, `line-height: 1.5`
- Action button, when present, `margin-top: 9px`
- Group labels (`TODAY`, `THIS WEEK`) carry `margin: 16px 0 0`, no bottom margin — the row's own top padding provides the gap

*Thread view:* exists on **both** desktop and mobile. Desktop is list left (340px) + thread pane right; mobile is a pushed page with a back affordance, avatar, name, reply-time line, and a composer with a square send button.

Threads can carry **structured cards, not just text** — the reference shows support answering a tier question with an inline breakdown card (date, amount, a single-segment tier bar, tier name and cost). Support will field "why did this come off credit?" constantly, so answering it with the same visual language the app uses everywhere else is worth building.

No bulk `Clear all`. Destructive bulk operations without undo are how people lose things they needed. Also consider blocking dismissal of unresolved actionable alerts — clearing "rebalance by Nov 12" removes a warning the member still needs.

### Explainer sub-pages

**How patronage works** — itemize what counts as activity (carry cost paid, interchange from card spend, acceleration fee), show the member's basis, then the four-step process. Close with the distinction that matters: *"Saving more doesn't increase your patronage — it increases your credit limit and your progress toward a home."*

**The assurance reserve** — balance, members covered, claims paid, and where the money comes from. State plainly: **retained surplus, not member deposits.** *"Your savings are never used to cover someone else's claim."* This is the trust-critical screen in the whole app.

**Login history** — device, location, method, timestamp, plus `Sign out everywhere`.

**Dispute resolution** — the four-step process, and the key structural fact: an independent third party decides; The Deed & Title Co administers but does not judge.

---

## 15. Profile menu (dropdown)

**Desktop:** dropdown anchored to the avatar in the top bar. **Mobile:** bottom sheet from the avatar or a nav overflow.

Contents, in order:
1. Identity block — avatar, name, `Member since YYYY · @handle`
2. **Appearance** — three-way segmented control: **Light · Dusk · Dark**. Not a toggle. Persist to storage and respect `prefers-color-scheme` on first load only.
3. **Acceleration** card — current status, one line on what it does, and a `See what it unlocks` action. This is the only place the optional fee appears.
4. Profile & membership · Security · Notifications · Help
5. Sign out (divided from the group above)

Dusk is a real third theme, not an auto setting. **The project already defines tokens for all three modes — use them as-is.** Do not introduce new theme variables, redefine existing ones, or hardcode colors that a token already covers.
