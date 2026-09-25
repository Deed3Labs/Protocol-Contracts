# Decisions taken over the reference

The reference files in this folder are the spec. Where they conflict with each other, with the
build prompt's rules, or with arithmetic, the decision is recorded here, so a later reader (or a
regenerated stylesheet) doesn't quietly undo it. The app's overrides live in
`apps/merchant/src/styles/app.css`. The seed data follows the figures below.

Decided 2026-09-24.

## Figures

| Where | The reference says | Use | Why |
|---|---|---|---|
| Home, Overview: sales tax collected | $60.45 | **$62.31** | Overview's top items include 4 sets of valve stems ($48). Tax is (756 + 48) × 7.75%. |
| Charges: the valve-stem cash sale | $39.00 | **$38.79** | 3 × $12.00 plus 7.75% tax. |
| Charges and Home: cash, paid and taken today | $62.00, $1,899.52 | **$61.79, $1,899.31** | Follow from the valve stems; the drawer expects $211.79, so Close the day's short count is $3.79. |
| Overview: the month, average, change on August | $5,295.44, $155.75, up $2,113.40 | **$5,295.23, $155.74, up $2,113.19** | The same 21 cents; the close reads "Short $3.79". |
| Charges: the split sale's card part | settled Saturday | **settled Sunday** | Follows from Sun, Sep 20. |
| Charges: the split sale | Sat, Sep 20 | **Sun, Sep 20** | The Staff calendar has Mon 21 to Sun 27, so Sep 20 is a Sunday. |
| Inventory: on order | due Fri, Sep 26 | **due Sat, Sep 26** | Same calendar. |
| Onboarding vs Settings: tax ID | ••-•••4829 / ••-•••4821 | **••-•••4829** | The onboarding file was edited later. |

## The prompt's rules over the drawings

- **Square corners everywhere, sheets included.** The reference rounds sheets (26px), the phone's +
  sheet (22px) and two scrims. All square. Pill buttons and round dots stay.
- **Toggles are pill switches.** Charges drew a small rounded switch (30 × 18); it takes the Settings
  pill (40 × 24).
- **A tick is a small paper square**, never a drawn check. Tick boxes whose first rule draws a check
  are already overridden to the square later in the same reference files, and the transcription
  keeps that order.
- **Only something live pulses.** The dots on "Mike's Tire is set up" (onboarding), "Signed in as Mike"
  (sign-in) and Inventory's stock level hold still. The glow stays, because every dot in the brand
  has one.
- **Empty values are an em dash.** "None today" (Home) and "Items None yet" (Inventory) become "—"
  when those pages are built.

## Between files

- **Entering a PIN follows sign-in, not Home.** Home's "Your PIN" sheet draws boxes and a gridded
  keypad; the sign-in file, which the prompt names as the spec for sign-in and which was edited later,
  draws dots and a ruled pad. Every PIN uses sign-in's.
- **Where drawings of the same rule differ, most files win.** The transcription script lists every
  such case in a comment above the rule in `reference.css`.

## Copy

- **Neutral pronouns.** The reference writes about its example people ("making him sign in",
  "Her shift keeps running", "She picks a new one"). In the app those sentences describe whoever
  is on the tablet, so they say "them", "their" and "they".
- **Two lines the reference doesn't have**, kept by decision: "That is not it. Try again in 30
  seconds." after a third wrong PIN, and "Coming with the Inventory page." on the placeholder.

## Home

- **"Dana R. has seen hers" is "Dana R. has seen it"**, by the neutral-pronoun rule above.
- **"None today" under a name in Who raised what is "—"**, by the em-dash rule.
- **A padlocked nav item opens the owner's sign-in**, the proposal in the Home file's Open list.
- **What a live shop sees.** Home is built from what the API answers: today's charges, the payout
  position and the roster. The shift clock and breaks, the drawer, Close the day, the Closing up
  card and the setup checklist's progress have no backend yet (card-processing prompt, Phase 7), so
  a live shop doesn't see them. The reference scenario shows every state in development:
  `?preview=1&home=running|counter|onBreak|early|dayOne|closing` (`&as=jen` for the counter) and
  `/close?preview=1&drawer=short|signed|balanced`.

## New Charge

- **Neutral pronouns** again: "Reached her" is "Reached them", "She has it open" is "They have it
  open", "A receipt went to her phone" is "...their phone", "Dana can see why in her app" is
  "...their app", "If she misses a payment" is "If they miss a payment".
- **The category tabs keep a 6px gap.** Inventory's reference spaces them 6px apart. New Charge's
  uses the same tabs but never styles the row, so its tabs touch. Inventory's version is kept.
- **What a live shop sees.** A typed amount paid with Clear is live: raised through the API, shown
  as a code, and watched until it's approved, declined or expired. Nothing else has a backend yet:
  - the catalog (Items), discounts and tips,
  - card (Stripe), cash and split,
  - scanning a member's own code, and texting a link.

  So a live shop starts on Amount with no Items switch. Checkout shows Clear, and Card locked as
  the reference draws it before Stripe is connected. Cash, split and the two shortcuts aren't shown.
  Every frame is reachable in development at `/new?preview=1&screen=<frame>` (see `SCREENS` in
  `NewChargePage.tsx`); add `&as=jen` for a counter shift and `&live=1` for the live path.
- **Custom tip** selects Custom but has no amount entry yet: the reference doesn't draw one.

## Inventory

- **Two catalogues.** Inventory's reference and New Charge's list different items for the same
  shop (Inventory has a Brakes category and "225/65R17 · all-season" details; New Charge files
  Brake job under Services and shows the size alone). Each page keeps its own reference's items
  until there is one real catalogue.
- **"Items None yet" is "—"** on the empty state, by the em-dash rule.
- **Search in portrait stays typeable.** The reference collapses it to an icon there.
- **What a live shop sees.** There is no catalogue or stock API yet, so a live shop gets the
  empty state, which is true of it. Its sheets open, but their save buttons stay disabled until
  the API exists. Every frame is in development at `/inventory?preview=1&screen=<frame>`.
- **Running low sits on Home** for owners and managers, as the Inventory reference asks
  (preview: `/?preview=1&home=lowStock`).

## Overview

- **Narrower frames keep the second slab.** The reference's portrait and phone end at "Who can use
  the tablet"; the tablet adds How it was paid, Top items, Discounts, tips and tax, and the
  end-of-day reports, drawn later. Narrower, those follow in one column.
- **Neutral pronouns**: "Everything Jen needs to do her job" is "...to do their job".
- **Your terms opens the terms sheet** when tapped; Statements opens from the figure's button.
- **A counter shift** is sent Home by the route, as for Payouts; its drawn page is at
  `screen=counter`, and its button opens the owner's sign-in.
- **What a live shop sees.** The month, its trend and the writer line, recent charges, what is
  owed, fees by plan, the months so far, the terms and the roster, all from the API. The second
  slab needs card, cash, the catalogue and the drawer, so it's the preview's:
  `/overview?preview=1&screen=counter|statements|terms`; `&live=1` for the live path.

## Payouts

- **The phone follows the portrait.** The reference's phone draws Payouts as Clear only, without
  the card group or Cash and tips. The portrait, drawn later, has all four cells; the phone
  keeps them too, in the same order.
- **The withdraw picker is the reference's two sheets**, "Where is it coming from?" and "Where
  does it end up?", reached by tapping the leg. A debit card says "Not set up yet" and can't be
  picked: no card is on file, and the reference's ••2208 would be a number we don't have.
- **The signer grant**, which the reference doesn't draw, is a slot under the cycle card, shown
  only while Clear can't yet settle this shop's payouts.
- **A counter shift** is still sent Home by the route (owners and managers only, as agreed). Its
  drawn page, "Payouts need an owner", is at `screen=counter`, and its button opens the owner's
  sign-in.
- **The payout detail** (a row's Statement) isn't drawn. It takes a back row and one cell.
- **What a live shop sees.** The figure, the cycle, where it sits, the cash account and its
  payouts, all from the payout position; Withdraw and the signer grant are live. Card deposits,
  the drawer's cash and tips, receiving by ACH, and adding or choosing a bank have no backend
  yet. Preview: `/payouts?preview=1&screen=none|paying|year|counter|withdraw|from|to|sending|done|
  breakdown|receive|destinations|add-bank`; `&live=1` for the live path.

## Settings

- **The index lists every section.** The reference's portrait and phone index still has the
  first eight (Shop to Help); its rail has fourteen since Selling was added. The index follows
  the rail, with a line for each new section taken from its pane.
- **A counter shift's rail has one item, You**, as the reference's note says ("absent, not
  locked"). Its drawing reuses the owner's rail with nothing selected. A manager sees the same
  as a counter shift for now (the reference's Open list suggests Payouts read-only later).
- **Sections are routes**: `/settings/<section>`, and `/settings/shop/hours` for the pushed
  page. On a landscape tablet `/settings` opens Shop; narrower it's the index.
- **Tax ID is ••-•••4829** (Figures, above).
- **What a live shop sees.** Shop (the listing from the profile), Payouts, Partnership, Security
  (its enrolled tablets, each signed out with the existing API) and Help. Hours, contact,
  statements, Counter, Payments, Tax, Tips, Discounts, Devices, Closing, Notifications and
  Advanced have no backend yet. Their sheets (Change account, Add a device, Leave Clear, New
  discount code) open in the preview, with their final buttons disabled on a live shop.
  Preview: `/settings[/<section>]?preview=1&screen=counter|payments-connected|account|device|
  leave|confirm|code`; `&live=1` for the live path.

## Charges

- **Neutral pronouns** in the Clear refund: "His plan closes", "He gets back", "Carry he already
  paid" and "His plan is closed" take their and they; "Mike gets this on his phone, or types his
  code here" and "Luis can clear this with his PIN" take their.
- **Seven rows to a page**, as the owner's list draws it ("1–7 of 31"). The late-day frame draws
  eight rows under a date instead of the tools and the pager; the app keeps the tools and the
  pager, so its eighth row is on page two. A group's figure counts the whole group, whatever page
  it's on. "Pick dates" is listed but does nothing yet.
- **A charge opened is a flow at every size**: back, what it is, who is on shift. The reference
  draws the phone with only a back row, so the phone's header and bar give way too.
- **A charge still waiting**, which the reference doesn't open, shows This charge and "What they
  chose: Not yet", with Cancel charge where Start a refund would be.
- **The refund is sheets over the charge**, as drawn; `/charges/:id/refund` opens them, which is
  where an owner's phone lands. An owner signed in on the tablet goes straight to "Approve this
  refund?". "Cancel the request" withdraws the refund. A declined refund, which isn't drawn, says
  the charge stands and nobody has told the customer.
- **Today's card sale opened** isn't drawn. It takes the split sale's layout, with Adjust the tip
  and Void in the footer, which is how the void and tip sheets are reached.
- **What a live shop sees.** Its Clear charges from the API: the list, Raised today and How it
  was paid, a charge opened, cancelling one, and the whole refund. Card, cash and split sales, the
  goods refund, void and tip have no backend yet. Preview: `/charges?preview=1&screen=owner|late|
  counter|menu-filter|menu-sort`, `/charges/marcus?preview=1&screen=counter|refund|waiting|approve|
  refunded|declined`, `/charges/split?preview=1&screen=refund-goods`,
  `/charges/card?preview=1&screen=void|tip`; `&live=1` for the live path.

## Staff

- **Neutral pronouns.** "Remind her" is "Remind them"; "she sets her PIN the first time she does"
  is "they set their PIN the first time they do"; "Reset her PIN", "Keep her", "Her PIN",
  "Charges she raised", "If she comes back", "Keep her name", "Add her again" take they, them
  and their; "She is on shift. Removing her ends it." is "Jen is on shift. Removing them ends
  it."; "Her other days stay", "Her usual hours come back" and "a day she does not work" likewise.
  Add someone's note is "They choose their own four digits on their first shift", which keeps
  the reference's two lines.
- **The counter view as drawn.** The reference's counter shift shows two on the counter (Jen and
  Luis) while its Team still says "3 on now". The preview keeps both as drawn; a live shop's
  figures come from one source.
- **Managers add counter staff only.** The roles cell says only an owner handles managers, so Add
  someone offers Manager to an owner alone. (The API also lets a manager add a manager.)
- **A manager's Refund limit** isn't drawn. It takes the counter's read-only form, with "Above
  it, the owner approves." The API gives the limit to owners only, so a manager sees "—".
- **An owner's own sheet** has no Reset or Remove: owners are added by Clear, not from the app.
- **The limit at Off** shows $0.00 and one row, "Every refund: Your PIN, or your phone". The
  reference draws only $500.
- **What a live shop sees.** The API has the roster, charges this month and the refund limit,
  and it adds people. Shifts, hours, removing someone and resetting a PIN have no backend yet
  (card-processing prompt, Phase 7). So a live shop sees the team, the roles and the limit, and
  can add someone and change the limit. The crew strip, the slot, the week and a person's sheet
  are the preview's: `/staff?preview=1&screen=owner|counter|first|busy|add|person|remove|hours|
  hours-week|day-hours|hours-friday|limit`, and `&live=1` for the live path. The route stays
  owners and managers only, as agreed; the counter view is reached through `screen=counter`.

## Adaptations: the reference doesn't draw these

- **Frames become the screen.** The tablet's 1180:820 outline and the phone's 340px outline go.
  The tablet fills the viewport with 24px padding; the phone keeps the frame's 16px, and its
  floating bar is fixed to the bottom of the screen.
- **Sheets fit a phone.** A sheet is never wider than the screen minus the scrim's padding.
- **Sign-in on a phone**: the frame takes the phone's 16px sides so six code boxes fit, and "Who's
  on the counter?" goes two by two instead of four across.
- **A long flow-header title trims** with an ellipsis instead of pushing the shift pill off a phone.
- **Card and cash on a phone.** The reference draws them only on a tablet. On a phone the footer's
  two buttons take a row of their own, and the cart bar is pinned to the bottom of the screen.
- **Home's New charge and Build cart wrap in portrait.** The reference makes them full width on
  the figure's row, where they overflow (its frame clips it). They take their own row instead.
- **A charge's screens are fixed frames on a tablet, landscape or portrait.** The slab fills the
  screen and each cell scrolls inside it, as the reference draws them, so the pad and the primary
  button never leave the screen. The phone scrolls as a page.
- **Theme is pinned to light** until the Dusk and Dark pass, which comes after every screen is
  converted. The profile sheet still stores the choice.
- **Staff's slab footers on a phone** drop the tablet frame's footer layout (flex, full-width
  children), which the reference applies to its tablet frame only.
- **A Charges row's chip on a phone** keeps the list's size (84 × 20): the stylesheet gathers phone
  rules at its end, which would otherwise let the general phone rule win.
