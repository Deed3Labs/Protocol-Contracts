# Claude Code prompt: rebuilding the Clear merchant app's UI from the reference files

You are working in the Clear monorepo (`github.com/Deed3Labs/Protocol-Contracts`). The merchant app lives at `apps/merchant`. It is a PWA, deployed to `merchant.useclear.org`, and it becomes an installed app through Capacitor. Your job is to rebuild its UI to match a set of finished HTML reference files. You'll run first on mock data, then switch to the real API as the backend lands.

Work on a branch. There are **hard stops** marked below. At each one, stop, summarise what you did and found, and wait for review.

---

## Where the spec is

The reference files are the spec for layout, copy, states and figures. Ask the user to place them in the repo at `docs/merchant-reference/` if they are not already there. Each file covers one page with every state, its modals and sub-screens, and its tablet, portrait and phone layouts:

| File | Covers |
|---|---|
| `clear-merchant-home.html` | Counter home in three states; the shift cell; the drawer (open, end shift, two blind counts, the three outcomes, sign-off); Close the day, balanced and short, before and after sign-off; the Closing up card; the phone + sheet |
| `clear-merchant-new-charge.html` | The whole charge flow, in its numbered order:<br>1. Start: amount, or items (list and tiles, options sheet, quick sale, not-enough-stock).<br>2. Checkout: discount, the discount sheets, card locked until Stripe is connected.<br>3. Tip.<br>4. Paying with Clear: code, scan, text, receipt on the customer's side, under the pay-over-time minimum, waiting and approved.<br>5. Paying by card: reader states, receipts, the receipt sheets.<br>6. Cash.<br>7. Split.<br>Then portrait, phone and failures (including offline). |
| `clear-merchant-inventory.html` | Items list; item page with the options strip; adjust stock; reordering (running low, mark reordered, on order, receiving); edit item; add item; options groups; sales tax per item; archiving; empty state; portrait; phone |
| `clear-merchant-staff.html` | This week schedule; team roster; what each role can do; refund limit |
| `clear-merchant-charges.html` | The Raised today and How it was paid top row; the grouped list with method marks; filter and sort menus; late in the day with every way to pay; a split charge opened; refunds by method; void and tip adjust; the Clear refund flow |
| `clear-merchant-settings.html` | Rail and panes, including the Selling group: Payments (before and after Stripe is connected), Tax, Tips, Discounts, Devices, Closing |
| `clear-merchant-payouts.html` | Clear payouts and card deposits, the cash account, Cash and tips, Mark deposited in both states, the card processing split sheet, withdraw |
| `clear-merchant-overview.html` | The month, till figures, end-of-day reports, statements and terms |
| `clear-merchant-onboarding.html` | Signup in six steps (start, your shop, your terms with codes, verify, where payouts go, the counter), each step's states, the done screen, the Set up the till checklist on Home, and the phone |
| `clear-merchant-sign-in.html` | The three levels (enrolled device, shift PIN, owner sign-in with Privy); enrolling a device by code; who's on the counter, PIN, first PIN, wrong PIN, idle lock; the owner sign-in sheets and the signed-in chip; resetting a PIN; removing a lost tablet; and the Privy organization mapping |

**Rules for using them:**
- **Copy is exact.** Do not rewrite labels, notes on screens, or button text.
- **Figures come from the files.** Use them as the mock seed. Do not invent numbers. Where two files disagree, flag it and ask; the later-edited file usually wins.
- The explanatory notes *between* frames in the reference files are design rationale, not UI. Read them; do not render them.
- Every frame in a file is a state the app must be able to show. Every modal is a real component.

---

## Who owns what

This prompt runs alongside `claude-code-card-processing-prompt.md`, which builds the backend.

- **This prompt owns** everything in `apps/merchant`: routing, components, screens, state, the data layer, the **Capacitor shell**, and **the Terminal plugin wiring** on the app side.
- **The backend prompt owns** the API, database, ledger, Stripe server work and jobs.
- **The seam is `packages/merchant-contracts`.** It holds the types, validation schemas, state machines, fee rule and a typed API client interface. It is written in the backend prompt's Phase 2 and approved at its Hard Stop 2. **Do not edit it here.** If the UI needs a change, stop and propose it.

---

## Design system (from useclear.org/style and the reference files)

- **Type:** Bricolage Grotesque for display and the wordmark; Instrument Sans for text and figures; IBM Plex Mono for labels only, never figures. Figures use tabular numerals, with the $ attached.
- **Shape:** square corners everywhere; **pill buttons only**. **Draw rules, not boxes**: a box means something interactive.
- **Colour:**
  - Ink tints on paper.
  - **Settled green** for done or paid, **underway amber** for waiting or pending (including cash not yet deposited), **absent red** for failed or out of stock.
  - **Cobalt once per view**, for the current step.
  - Payment-method colours: Clear is ink, Card is land green, Cash is light sage. The same colours appear on row marks, bars and detail text. Tips show in settled green.
- **The live dot pulses only for something actually live or open**: the reader waiting for a card, someone on shift. Out of stock and waiting are still dots, never pulsing. Honour reduced motion.
- **Empty values are an em dash** ("—"). Keep "None" only where it is a claim (Overview's "Monthly fee: None") or a choice (a "None" option).
- **Controls:**
  - A **ticked box** is a small paper-coloured **square** in a dark or green box, not a drawn check.
  - Toggles are pill switches.
  - Segmented controls are full-height pills (44px in sheets).
- **Header lockup:** "Clear | [shop name]" (wordmark, thin vertical divider, shop name). Long names trim with an ellipsis.
- **Nav order:** Home, Charges, Inventory, Payouts, Staff, Overview. On a counter shift, Payouts and Overview are locked; Inventory is open. On the phone, a bottom bar with six icons plus the + action button.
- **Inside a flow** (new charge, card, cash, close the day), the nav is replaced by a slim flow header: close or back, what this is, and who is on shift.
- **Breakpoints:** above ~900px, two columns; 520–900px, one column with the action first; below 520px, the phone. **Nothing is removed at any width**; only the arrangement changes.
- **Settings:** rail and pane on the landscape tablet; index and drill-ins on narrower widths; modals only for actions.
- **Roles:** counter, manager, owner. Staff sign in with a **PIN, not a login**. Every screen must render correctly for each role, as the reference files' counter-shift frames show.

---

## Phase 1: Explore (no code changes)

1. Read `apps/merchant` as it is today: framework, routing, styling approach, state management, build and PWA setup, and what screens exist.
2. Read the member app for shared UI packages, tokens or components worth reusing. The merchant app follows the same brand guide.
3. Read the reference files and list the components they share. Starting points: cell and slab with header, body and footer; key–value row; figure styles; chips; pill buttons; stepper; segmented control; tick box; toggle; sheet/modal; number pad; the two-panel top row with bar and key; method mark; stock dot; search field; list/grid switch; item tile; receipt slip; step strip; PIN dots.
4. Check whether `packages/merchant-contracts` exists yet, and report the backend prompt's status if you can tell.

**HARD STOP 1.** Report the current state, what you will keep or replace, the component list, and any conflicts with this prompt. Wait for review.

---

## Phase 2: Design system and app shell

- Tokens (colour, type, spacing, rules), the three fonts, and the shared components from Phase 1.
- A **component gallery route** (development only) that shows every component in every state, at all three widths.
- **The app shell:**
  - The header lockup and nav, with role-based locking.
  - The shift pill and shift switcher.
  - PIN entry, the phone bottom bar with the + sheet, the flow header, and the breakpoint layouts.
- **No data calls yet.** Use static props in the gallery.

**HARD STOP 2.** Show the gallery and the shell at 1180×820 (tablet landscape), 820×1180 (tablet portrait) and 390×844 (phone). Wait for review.

---

## Phase 3: The data layer and the mock seed

Start this phase **once `packages/merchant-contracts` is approved** in the backend prompt.

- Implement the contracts' API client interface **twice**:
  - `mock`: in memory, with realistic delays and failure switches.
  - `real`: calls the API.
- One setting chooses between them, for example an environment variable. Screens never import either one directly.
- **The mock seed is the reference scenario.** Its core, with every other figure taken from the files:

**Shop and team**
- Mike's Tire. "Today" is **Tue, Sep 22**.
- Staff: **Jen R.** (counter), **Luis M.** (manager), **Mike R.** (owner), and Ana Ruiz, who has no hours yet.
- Clear fee **1.25% when paid now, 2.0% when paid over time** (founding). Standard is 1.5% and 2.5%. Both pairs are plan settings, not constants. Bank **Chase ••4417**. Sales tax **7.75%**.

**Charges**
- **Clear:** Nina P. $410 and Dana R. $940, both waiting; Marcus T. $412, Priya S. $188 and Ana V. $300, confirmed today; Ray C. $1,240 confirmed yesterday; Tom B. $310 expired.
- **Card:** a walk-in at 4:41pm, $937.52 including a $10.00 tip, on Visa ••4242.
- **Cash:** two walk-ins, $23.00 and $39.00.
- **The cart:** 4 × Michelin Defender2, 4 × Mount and balance, 1 × Valve stems, $927.52 with tax. Discount code **FALL10** gives $834.77.

**Inventory**
- The items and stock as in the Inventory file. Goodyear Assurance has 6 on the shelf with 2 held; it is low, and 8 are on order.

**The drawer**
- $150.00 to start. Expected $212.00; Luis and Mike both counted $208.00, so **short $4.00**, signed off by Mike. $150.00 is left for tomorrow and $53.00 goes to the bank, not yet deposited.
- Tips: Jen $10.00 on card (with payroll); Luis $5.00 in cash (paid from the drawer).

**Payouts**
- Oct 14 payout of $4,218.91: $2,400.00 released, $1,818.91 releasing on Oct 14.
- Cash account $612.40.
- A card deposit on Wed, Sep 23 of **$911.86**, after **$25.66 card processing** (Stripe $25.36, Clear $0.30).

**Card processing**
- Shown as one figure: **2.7% + 35¢** a sale, and 2.7% + 5¢ under $10.

- The mock must be able to switch **Stripe not connected / connected**, and **drawer balanced / short / counts disagree**, so every state in the files can be reached.

---

## Phase 4: Screens, file by file

Build in this order, one reference file at a time. For each file:
- Every frame is a state.
- Every sheet is a component.
- Every width works.
- Finish with screenshots at the three sizes, set beside the matching reference frames.

1. **Home.** The three states, the shift cell with its drawer row, the drawer sheets, the three count outcomes, sign-off, Close the day (balanced, short before and after sign-off), the Closing up card, and the phone + sheet.
2. **New Charge.**
   - Follow the file's own order: start (amount, items as list and tiles, options sheet, quick sale), checkout, tip, then Clear, card, cash and split, then failures.
   - **The blind counts and card states follow the contracts' state machines. Do not reimplement them.**
3. **Inventory.**
4. **Staff.**
5. **Charges.** Including the top row, which appears on tablet screens only, as drawn.
6. **Settings.**
7. **Payouts.**
8. **Overview.**
9. **Onboarding.** Build it once the shell and Home exist, since its checklist lives on Home.

**Sign-in is part of Phase 2's app shell**, not a later screen: device enrollment, the shift picker and PIN, the idle lock and the owner sign-in wrap every other screen, so build them with the shell and use `clear-merchant-sign-in.html` as their spec.

**Stop after Home and after New Charge** for review. The remaining files can run without stopping unless something conflicts.

---

## Phase 5: The Capacitor shell and the reader

- Wrap `apps/merchant` with Capacitor for iOS and Android. **The web build must keep working unchanged.**
- **Terminal plugin:** evaluate the community Capacitor Stripe Terminal plugin against the current native SDKs. If it lags or lacks Tap to Pay or offline support, write a thin custom plugin around the native iOS and Android Terminal SDKs.
- **Platform detection:**
  - In a browser: smart readers only (Stripe's web SDK, or server-driven).
  - In the installed app: also the **Stripe Reader M2** over Bluetooth, and **Tap to Pay**.
  - The Settings › Payments Readers list and the card screen's "Use another reader" show only what is available.
- **The card screen's states** (waiting, reading, declined, approved) map to the SDK's events. The server creates, captures and cancels the payment; the app collects it on the reader. Agree that flow with the backend prompt's Phase 5.
- **Offline:** store-and-forward on the M2 only when the shop setting is on, with its limit. Tap to Pay is online only, and the screen says so.
- **Permissions:** Bluetooth and location. **Apple's Tap to Pay entitlement** is a separate request; flag it in the PR as a blocker for iOS Tap to Pay.

---

## Phase 6: Switching to the real API

Switch endpoint by endpoint as the backend phases land, in this order:
1. Onboarding, device enrollment, shifts and owner sign-in.
2. Card availability and Stripe connection.
3. Catalog and stock.
4. Orders and checkout, and tax.
5. Card payments.
6. Cash and the drawer.
7. Close the day.
8. Payouts and card deposits.
9. Overview.

Keep the mock working throughout: it is the demo and test data.

---

## Phase 7: Checks

- **Visual regression:** Playwright screenshots of every state at 1180×820, 820×1180 and 390×844, compared against the reference frames. Differences need a reason.
- **Accessibility:**
  - Real buttons and labels. Screen readers must hear masked figures (the hidden expected total) as "Hidden".
  - Visible focus, reduced motion honoured, and contrast on every text colour.
- **Roles:** every screen checked as counter, manager and owner.
- **PWA:** installs, updates, and works as the Capacitor app's web layer.

---

## Out of scope

- Backend logic, database and Stripe server work: the backend prompt.
- The member app.
- Food-truck order call-out screens, and paid-plan pricing: not designed yet.
