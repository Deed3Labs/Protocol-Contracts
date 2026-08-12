# Clear App — Design Spec

Reference spec for rebuilding the member-facing app. Archive existing nav pages; build these.

**Visual reference:** [`docs/reference/clear-app-reference-screens.html`](../reference/clear-app-reference-screens.html) — static markup of every screen described here (open it in a browser). Its colors, spacing, and structure are authoritative; its implementation approach is not — build against the app's own component library and tokens.

---

## 1. Navigation

**Pages:** Home · Savings · Earn · Send · Activity · Card
(Assurance lives inside Savings. Settings behind avatar/menu. **No Borrow page** — borrowing is built into Home.)

**Desktop:** horizontal nav in a top bar, left-aligned wordmark "Clear", nav items right-aligned. Active item uses primary text color, inactive uses secondary. Bottom border on the bar, 0.5px.

**Mobile:** **floating tab bar** — iOS-style. Not flush to the bottom edge.
- Fixed position, `bottom: 24px`, horizontally centered, `left/right: 16px`
- Rounded pill container, `border-radius: 28px`
- Translucent background with backdrop blur (`backdrop-filter: blur(20px)`), semi-opaque surface fill
- Subtle border (0.5px) + soft shadow for lift
- 5 items, icon above 10px label, active item in primary color
- Content area needs `padding-bottom: 96px` so the last card clears the bar
- Respect `env(safe-area-inset-bottom)`

---

## 2. Design tokens

Follow the existing design system. Key usages:

| Token | Use |
|---|---|
| `--surface-2` | Card and page surfaces |
| `--surface-0` | Empty progress-bar track |
| `--border` | 0.5px card borders, row dividers |
| `--border-accent` | Border on the Clear Credit card when credit is engaged |
| `--text-primary` | Values, active nav |
| `--text-secondary` | Labels |
| `--text-muted` | Sub-labels, legends |

**Tier colors (fixed — these carry meaning, don't substitute):**

| Tier | Color |
|---|---|
| Savings-backed (free) | `#0F6E56` |
| Asset-backed | `#1D9E75` |
| Income-backed | `#BA7517` (fill) / `#854F0B` (text) |
| Boost | `#7F77DD` (fill) / `#534AB7` (text) |
| Savings: cash / vested / vesting | `#0F6E56` / `#5DCAA5` / `#9FE1CB` |

Cards: `border-radius: 12px`, `padding: 13px 15px`. Bars: `height: 8px`, `border-radius: 4px`.

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

**Day one** (no deposits): big number reads `$0`, subtitle "Add money to get started". Body is a setup checklist. Savings card shows an empty bar and the pitch line. No cycle card, no credit card.

**In use**: full layout below. Setup tasks that remain incomplete appear as a task strip under the balance and disappear when done.

### Desktop layout
- Top bar
- Balance block left (`38px` value, `-0.8px` letter-spacing), cycle card right (`220px` wide)
- Task strip (accent background) if any tasks pending
- 2-col grid: **Clear credit** left | **Cash account** stacked over **Savings** right
- **Recent activity** card full width below, 3 rows + "See all"

### Mobile layout
Stack in order: balance → task strip → cycle → cash account → clear credit → savings → recent activity → (floating nav)

### Clear credit card

```
Clear credit used            $3,200 of $4,000
[████████████░░░░░░]   ← 4 segments
● Savings (CLRUSD) · free          $3,000 of $3,000
● Asset-backed · 0.65–0.75%        $200 of $8,300
● Income-backed · 1.5% / cycle     $0 of $1,000
● Boost · 3% / cycle               not added        (50% opacity)
─────────────────────────
Carry cost so far                  $2.00
Drops to $0 when you get back under $3,000
[ View limit breakdown ]
```

Boost row and its button render at 45–50% opacity when not added.

### Limit breakdown (sub-view)
Grouped into **ASSET-BACKED** and **UNSECURED** headers. Each row: name, contribution to limit, and a sub-line showing `underlying position · LTV · rate`. Footer: total limit, then the line *"Your bonds are worth more each month, so this limit grows on its own."*

### Savings card
Total balance headline. 3-segment bar (cash / vested / vesting). Two legend lines: cash first, then vested + vesting together. Footer: `1,500 of 15,000 credits` + `[Add]` button.

---

## 5. Savings page

- Balance headline + subtitle `1,500 of 15,000 credits toward your Clear Deed`
- Actions: `Add money` · `Auto-save`
- **Your path to a home** — 5 milestones, each with icon (check / dashed / empty), title, credits threshold. Completed = success color, current = accent, future = 50% opacity.
- **Assurance** — named protections list with Active / credits-to-unlock status. *(Only "Home repair assurance" is a confirmed name; replace the other four with the real ones from Figma.)*
- **Credits vesting** — dated future rows

---

## 6. Earn page

Two distinct products, deliberately different visual languages.

**Yield pool** — large variable APY, utilization bar with `$X of $Y lent to members`, position + earned rows, `Deposit` / `Withdraw`.

**BurnerBonds** — term ladder rows: `12 mo | Pay $939 → get $1,000 | 6.5%`. Then `Buy a bond`, then **Your bonds** with face value, term, paid amount, maturity date, time remaining.

Header shows combined `Earning` total split as `$X in the pool + $Y in bonds`, with `Earned to date` right-aligned.

---

## 7. Send page

- **Your Clear code** — QR, `@handle`, "Show to get paid". On mobile this leads.
- `Scan to pay` · `Request`
- Search by name / phone / @handle
- **Recent** — avatar circle with initials, name, and role badge (`Member` / `Clear Partner`)

---

## 8. Activity page

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
- Desktop: 250px card column | transactions column

---

## 10. Build order

1. Nav shell + floating mobile tab bar
2. Home (both states)
3. Savings
4. Activity
5. Card
6. Send
7. Earn

Sign-up and Add-to-savings are flows/modals, not nav pages.
