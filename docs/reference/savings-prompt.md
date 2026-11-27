# Clear member app: rebuild the Savings tab from the reference

You are updating the **Savings** tab of the Clear member app (this repo) to a new layout. The design is finished and lives in one file: `reference/savings-reference.html`. It shows the desktop layout on a 1200px canvas and the full-length phone layout at 390px, in four states (Day one, Saving, Paused and Path complete), with notes on structure, states and colour underneath.

Read that file in full before you write any code: its markup, its CSS and the three notes panels. It is the spec for layout and copy. Your job is a faithful port into the app's real components and real data. Do not reinterpret it.

## What changes and what does not

**Changes:** the layout and presentation of the Savings tab, on desktop, tablet and phone.

**Does not change:**
- How the numbers are calculated: balances, credits, vesting, matching, unlock thresholds, the credit-line contribution. Wire the new layout to the data and hooks the current page already uses. If a figure in the reference has no source in the app today, stop and list it in your report instead of inventing one.
- The move-money modal, auto-save and every other flow the page opens. The new buttons call the same handlers the old ones did.
- The app shell outside this tab (top bar, tabs, phone bottom bar), except where this page needs it.

## Before you start

1. Find the current Savings page, its components, its data hooks and its styles. Also find the app's design tokens (colours, type, spacing). The app may already have its own token names for the values in the reference's colour panel. Use the app's tokens wherever they exist and add only what is missing.
2. Map every element in the reference to its data source. Write the map as a short table at the top of your PR description: element, source, and any gap.
3. Work on a branch named `savings-redesign`. Open a pull request when done. Do not push to `main`.

## The layout

### Desktop (from tablet up; tablet scales the same layout)

**1. Balance header**
- Label: "Savings".
- The total, as a large figure.
- One caption line: "$X in cash · N credits, matched one-for-one".
- Right-aligned: **Auto-save** (outline pill) and **Move money** (solid pill).

**2. The slab**
- One bordered grid with two blocks side by side at 1.35fr / 1fr.
- The blocks share their seams: one line weight, and every internal rule runs wall to wall.
- Each block is header / main / footer:
  - The header row is a fixed 56px, with the label left and a quiet caption or figure right.
  - The main area takes the slack.
  - The footer pins to the bottom, with one line of text and one small pill button.

**Your home path** (left block)
- **Header:** "Your home path", with "On track for <month year>" on the right.
- **Main:**
  - The credit count, large, with "of 15,000 credits" beside it.
  - The five-step ladder.
  - The next-unlock bar: "Next unlock · <name>", with "<n> credits to go" on the right.
- **Footer:** "Saving <amount> a month · matched for <n> months", with a **Change** pill.

**What you hold** (right block)
- **Header:** "What you hold", with the total on the right.
- **Main:**
  - A thin composition bar in three segments: cash, then vested, then vesting.
  - Three rows in the same order:
    - "Cash (CLRUSD)" in the main text colour
    - "Vested credits" in green
    - "Vesting, about <n> days" in amber
- **Footer:** "Adds <amount> to your credit line", with a **Details** pill.

**3. Protections**
- A separate bordered block under the slab.
- **Header:** "Protections", with "Nothing on this list is ever paid back" on the right.
- **Main:** five equal columns, in this order:

| Protection | Line | Unlocks at |
|---|---|---|
| Cycle assurance | Two grace cycles a year | Day one |
| Home repair | Covered by the co-op | 1,500 credits |
| Income | Your limit holds a cycle | 4,000 credits |
| Deposit | Paid to your landlord | 8,000 credits |
| Rent | Two months on job loss | 15,000 credits |

- Each column has a small chip:
  - **"On"** in green once unlocked.
  - Otherwise the credit count that unlocks it, in a muted outline chip.

### Phone (390)

**Top and header**
- **Top bar:** the logo lockup, the bell and the avatar. No tabs; the bottom bar replaces them.
- **Balance header:** label, total and caption. **No buttons under the balance.**
  - Move money is the floating + button in the bottom bar.
  - Auto-save is reached through **Change** on the home-path footer.

**The slab** stacks into one column: home path, then what you hold.
- Both keep their footers.
- The ladder keeps all five steps, with short labels: Cycle, Repair, Income, Deposit, Rent and deed.
- The header caption shortens to "On track for Dec 2027".

**Protections**
- Protections becomes a list, one row per protection.
- Each row has the name and line stacked on the left, and the chip centred on the right.
- The header caption shortens to "Never paid back".

**Bottom bar**
- Use the app's existing bottom nav: the five icon tabs Home, Savings, Earn, Activity and Card, with the same icons and the same routes.
- Restyle it to the reference:
  - The tabs sit in one bordered, rounded container (17px radius).
  - The selected tab gets a light key behind its icon (the paper colour, 13px radius), with the icon drawn in the dark ground colour.
- The action button is a separate 50px rounded square (17px radius) in the light colour, with a plus. On this page it opens Move money.
  - The live app labels it "+ Save". Keep that label if other pages rely on it; the reference shows the icon-only shape.
- The page's bottom padding clears the bar, so the last protection row is never hidden.

**Phone type scale**
- The credit count on the home path is smaller than the balance: 26px against the balance's 38px. It must never compete with the balance.

## States

The reference has a switcher at the top with four states. Each one is a full screen, desktop and phone. Build all four, driven by real account data, not by a flag.

| State | When | What changes |
|---|---|---|
| **Day one** | Nothing saved yet | See below |
| **Saving** | The normal case | One step is "next", filled in cobalt (`#7C8CC5`) to the member's progress between the previous threshold and this one. Vesting credits show in amber. |
| **Paused** | Some of the member's savings is backing their spending, so the vesting clock is stopped | The header caption, the next step and the vesting row turn amber. The next-unlock bar reads "Paused · $X of your savings is backing spending" with a **Top off** pill, wired to the app's existing top-off flow. |
| **Path complete** | 15,000 credits | The caption reads "Path complete" in green, and all five steps and protections are on. The next-unlock bar becomes the hand-off: "Ready · Your Clear Deed", with a solid **Start the ELPA** pill, wired to the ELPA flow if it exists or flagged if not. The footer reads "match complete". |

What changes on **Day one**:
- The total reads $0.00. The ladder still shows, with Cycle assurance on and a sliver of cobalt on Home repair.
- The desktop header shows a single solid **Add money** button instead of Auto-save and Move money.
- The path footer reads "Not saving yet" with a solid **Set up auto-save** pill. That is the only place auto-save is offered in this state.
- What you hold shows an empty bar, the cash row at $0.00, and "Your first deposit starts your credits."

**Rules across every state:**
- **The ladder.** Each step is one of:
  - **unlocked:** green fill, label in full colour
  - **next:** cobalt, or amber when paused
  - **locked:** empty track, muted label

  There is never more than one next step.
- **Protections.** A chip reads "On" exactly when its threshold is reached. Use the same threshold source as the ladder so the two can never disagree.
- **Nothing vesting.** If nothing is vesting, drop the amber segment and its row, rather than showing "$0".

Before you build the Paused state, confirm how the app already detects savings backing spending (the secured-credit state the cycle card's "Top off" uses). Use that exact source. If there is none, flag it.

## Display rules (the app's own, keep them)

- **Money:** figures always carry decimals ("$3,000.00").
- **Credits:** take no decimals but keep the "$" where they are shown as money ("$1,500"). Counts of credits on the ladder are plain numbers ("1,500").
- **Icons:** no emoji or Unicode symbols. Use the app's icon set: bell, plus, the solid logo mark.
- **Corners:** square everything except interactive controls, which are pills.
- **Header heights:** the 56px header row is fixed on every block, so headers line up across the slab.
- **Inline styles:** no inline font sizes on figures. Use the app's existing type classes, or add one.

## Check your work

1. Run the app's typecheck, lint and tests. All must pass.
2. Screenshot the Savings tab at 1440, 1024, 768, 390 and 360 wide, in all four states: Day one, Saving, Paused and Path complete.

   Compare each against the reference at the same width, then fix spacing, alignment and line breaks until they match.
3. Confirm that nothing scrolls sideways at 360, and that no ladder label or protection line is clipped.
4. Confirm that Move money, Auto-save, Change and Details still open what they opened before.

## Report back with

- The data map table, and any figure you could not source.
- Screenshots for each width and state.
- Anything in the reference you could not reproduce, and why.
- The pull request link.
