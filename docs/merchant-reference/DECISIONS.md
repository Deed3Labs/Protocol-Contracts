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
  position, the roster, the drawer and a counter shift's time clock (on for, since, until, the
  booked hours and breaks), and for owners and managers Set up the till and Running low. The Closing
  up card isn't live yet. The reference scenario shows every state in development:
  `?preview=1&home=running|counter|onBreak|early|dayOne|closing` (`&as=jen` for the counter) and
  `/close?preview=1&drawer=short|signed|balanced`.
- **The drawer's two counts are the closing count, and say so.** Opening the drawer is one step, the
  starting cash; there is no opening count. Home offered "Count the drawer" as soon as the drawer
  was open, which read as a check of the float, and agreeing counts then went straight into Close
  the day. The panel now says the counts are at close ("Count to close"), and agreeing counts, or a
  signed-off difference, come back to Home, whose panel offers Close the day; only that tap opens it.

## New Charge

- **Neutral pronouns** again: "Reached her" is "Reached them", "She has it open" is "They have it
  open", "A receipt went to her phone" is "...their phone", "Dana can see why in her app" is
  "...their app", "If she misses a payment" is "If they miss a payment".
- **The category tabs keep a 6px gap.** Inventory's reference spaces them 6px apart. New Charge's
  uses the same tabs but never styles the row, so its tabs touch. Inventory's version is kept.
- **What a live shop sees.** The shop's catalogue or a typed amount; Checkout raises the order on
  the server, which works out tax, discounts and the total; the tip from the shop's settings; then
  Clear (its code shown, the member's answer followed), card through the reader, cash into the open
  drawer, or a split; then the receipt, texted, emailed or printed. A Clear
  charge can also be sent: by scanning the member's own code, or as a text to a number (below).
  Every frame is reachable in development at
  `/new?preview=1&screen=<frame>` (see `SCREENS` in `NewChargePage.tsx`); add `&as=jen` for a
  counter shift and `&live=1` for the live path.
- **Custom tip** opens an amount, in dollars, under the presets. The reference draws Custom without
  one; Continue waits until there's an amount.

## Inventory

- **Two catalogues.** Inventory's reference and New Charge's list different items for the same
  shop (Inventory has a Brakes category and "225/65R17 · all-season" details; New Charge files
  Brake job under Services and shows the size alone). Each page keeps its own reference's items
  until there is one real catalogue.
- **"Items None yet" is "—"** on the empty state, by the em-dash rule.
- **Search in portrait stays typeable.** The reference collapses it to an icon there.
- **What a live shop sees.** The shop's catalogue and stock from the API: adding, editing and
  archiving items, their options, stock adjustments and history, reorders and receiving them,
  and importing a spreadsheet (below). Every frame is in development at `/inventory?preview=1&screen=<frame>`.
- **Running low sits on Home** for owners and managers, as the Inventory reference asks
  (preview: `/?preview=1&home=lowStock`).

## Onboarding

- **Verify creates the shop on a live signup.** The API makes the shop and its wallet from a
  verified owner sign-in, the owner's name and a four-digit counter PIN, and nothing else. So a
  live signup asks Your name on Start (the reference has no name field), and its Verify step is
  "Verify it is you": the PIN, then the owner's sign-in, which creates the shop. Nothing is
  written to Clear before it. The reference's Verify, Bridge checking the business, is the
  preview's until the merchant app has a Bridge business check.
- **Codes, the team and the bank are real; the tax rate isn't here.** A live signup checks a terms
  code with Clear and adds the team with the shop (below, "Onboarding: terms codes and the team"),
  and Where payouts go verifies the business and links the bank (below, "Onboarding: where payouts
  go"). There's no tax rate (Stripe Tax works it out once cards are connected).
- **Save and finish later** keeps the form on the device and nothing else.
- **Onboarding is always its own screen**, without the app's header, even when someone is
  signed in.
- **Set up the till replaces Home's day-one list** (decided 2026-09-24). Home's reference drew a
  day-one list (add counter staff, print counter cards, run a $1.00 test charge), and signup now
  covers all three. Owners and managers see the till list under the figure instead, with Home's
  own hero rather than the Onboarding file's "Today" hero; each row opens the screen that does it,
  "Hide for now" is remembered on the tablet, and it goes when every row is done. On a live shop
  the rows come from `GET /setup` (below, "Set up the till and Running low"). Preview:
  `/?preview=1&home=dayOne` (1 of 6) and `&home=tillLater` (4 of 6).
- Preview: `/onboarding?preview=1&step=1..7`, `&done=1`, `&team=solo`, `&code=warn|bad`,
  `&verify=needs|verified`, `&bank=waiting`.

## Overview

- **Narrower frames keep the second slab.** The reference's portrait and phone end at "Who can use
  the tablet"; the tablet adds How it was paid, Top items, Discounts, tips and tax, and the
  end-of-day reports, drawn later. Narrower, those follow in one column.
- **Neutral pronouns**: "Everything Jen needs to do her job" is "...to do their job".
- **Your terms opens the terms sheet** when tapped; Statements opens from the figure's button.
- **A counter shift** is sent Home by the route, as for Payouts; its drawn page is at
  `screen=counter`, and its button opens the owner's sign-in.
- **What a live shop sees.** The month, its trend and the writer line, recent charges, what is
  owed, fees by plan, the months so far, the terms and the roster, and the second slab (how it was
  paid, top items, discounts, tips and tax, the end-of-day reports), all from the API, plus Export
  and each month's statement (below), which can be emailed to an accountant. Preview:
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
  the drawer's cash and tips, the nightly reconciliation ("Checked against Stripe", below), and
  the banks withdrawals go to and withdrawing to them ("Linking a bank" and "Withdrawing to a bank",
  below). Receiving by ACH has no backend yet. Preview: `/payouts?preview=1&screen=none|paying|year|counter|withdraw|from|to|sending|done|
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
- **What a live shop sees.** Shop (the listing, the contact and the hours, each changeable by
  the owner), Payouts, Partnership, Counter (breaks, and how long this tablet waits for a PIN),
  Payments, Devices (the readers, and this tablet renamed), Security (its enrolled tablets, each
  signed out with the existing API), Tax, Tips, Discounts, Closing, Notifications (the end-of-day
  summary), Advanced (business verification, and leaving) and Help; Payouts has its statements and where
  payouts go (below). Their sheets (Change account, Add
  a device, Leave Clear) open in the preview, with their final buttons disabled on a live shop.
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
- **What a live shop sees.** Everything on the list:
  - Clear charges: opened, cancelled, and refunded through the whole Clear refund;
  - card, cash and split sales from the order history (`GET /orders/history`): opened, voided the
    same day with a manager's PIN, a card's tip adjusted before capture, and goods refunded.

  "Pick dates" is listed but does nothing yet. Preview: `/charges?preview=1&screen=owner|late|
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
- **What a live shop sees.** The API has the roster, charges this month, the refund limit, who is
  on shift and the week's hours. So a live shop sees the crew strip, the week, the team, the roles
  and the limit. An owner or manager opens a person to end their shift, set their hours, reset
  their PIN or remove them, adds someone and changes the limit. The slot for someone who hasn't
  started is the preview's: `/staff?preview=1&screen=owner|counter|first|busy|add|person|remove|hours|
  hours-week|day-hours|hours-friday|limit`, and `&live=1` for the live path. The route stays
  owners and managers only, as agreed; the counter view is reached through `screen=counter`.

## Phase 5: the installed app and the reader

- **Capacitor 8 wraps the same web build** (`capacitor.config.ts`, `ios/`, `android/`; app id
  `org.useclear.merchant`). The web app at merchant.useclear.org is unchanged. The service worker
  doesn't register inside the installed app, whose pages already come from the app bundle.
- **The community plugin, not a custom one, for now.** `@capacitor-community/stripe-terminal`
  8.2.1 is current (Capacitor 8, updated September 2026) and covers the M2 over Bluetooth, Tap to
  Pay and smart readers. It wraps the native Terminal SDK 5.7, one minor version behind 5.8, and
  **it has no offline (store-and-forward) API**. The prompt says to write a thin native plugin in
  that case. This machine has no Xcode, Android SDK or Java, so native code written here couldn't
  be compiled or run on a device. So:
  - The screens reach readers only through `src/reader` (`ReaderService`). The plugin sits behind
    it in one file (`native.ts`), so a custom plugin replaces that file and nothing else.
  - Offline is off everywhere (`OFFLINE_BUILT` in `reader/platform.ts`). Settings says "Coming to
    the M2 in an app update". The thin plugin, adding offline to the M2 only, is the next native
    step, on a Mac with Xcode and Android Studio.
- **Which readers show.** A browser lists smart readers only, driven from the server (see
  *Smart readers are driven from the server* below; this was Stripe's web SDK until then). The installed app adds the M2 and Tap to Pay. Settings › Payments and
  the card screen's "Use another reader" list only these. The preview is the installed app, as
  the reference draws it; add `&platform=web` for a browser's view.
- **"Use another reader"** isn't drawn. It's a sheet of the device's readers, reusing Payouts'
  picker rows. Picking one connects it and starts collecting again.
- **The card screen's states come from the SDK.** Ready is collecting; reading is a card inserted
  or the payment processing; declined is a failed confirm; approved is after the server's capture.
  Leaving the screen cancels on the reader and the server. A reader that can't start says so on
  the card screen ("The reader isn't ready"), which the reference doesn't draw.
- **The server's half isn't built.** Connection tokens, create, capture and cancel, and reader
  registration are the backend prompt's Phase 5, typed in `packages/merchant-contracts`.
  `reader/backend.ts` stands in, and says cards aren't switched on yet. When the endpoints land,
  that file is the one that changes. Until then card stays locked for a live shop, as before.
- **Permissions.** Android: Bluetooth scan and connect, and fine location, with `minSdkVersion` 26.
  iOS: Bluetooth and location usage strings, and Bluetooth background mode.
- **Blocker for iOS Tap to Pay: Apple's Tap to Pay entitlement**
  (`com.apple.developer.proximity-reader.payment.acceptance`). It's a separate request to Apple,
  and it isn't in the project, because a signing profile without it would fail. Android Tap to Pay
  needs no entitlement.
- **Still to do before shipping the app:** the Clear icon and splash (the templates' defaults are
  there now); the API allowing the app's origins (`capacitor://localhost`, `https://localhost`)
  and `VITE_API_BASE_URL` at build time; and checking the owner's Privy sign-in, especially
  passkeys, inside the app's WebView.

- **Smart readers are driven from the server** (2026-09-24). Stripe recommends the server-driven
  integration for smart readers (S700/S710, WisePOS E): its browser SDK needs the counter device and
  the reader on the same local network. So the app no longer loads `@stripe/terminal-js`. For a
  smart reader, on the web and in the installed app alike, it asks the API to start the card tender
  and send it to the reader (`POST /api/merchant/tenders/:id/present`), then follows the tender
  (`/sync`) to approved or declined. The M2 and Tap to Pay still collect on the device through the
  Capacitor plugin, then the server catches up. **Nothing in the app captures:** the server
  captures at Close the day. See `apps/merchant/src/reader/server.ts`.

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

## UI Phase 7: checks

Run from `apps/merchant` on Node 22, with the installed Chrome (`channel: 'chrome'`):
`npm run test:visual` (the states and their reference frames), `npm run test:e2e` (everything:
visual, `a11y`, `roles`, `pwa`). The report, each state beside the frame it is drawn from with the
reason for any difference, is written to `e2e/.report/index.html`.

- **Every state, at every size.** `e2e/states.ts` lists 171 states the preview can show without a
  backend, each paired with the reference frames it is drawn from (149 pairs) and a note where the
  two differ. Each state is captured at 1180×820, 820×1180 and 390×844. A frame is drawn at one
  size, so it pairs with that size's capture. The sign-in screens only show signed out, so they are
  captured from the gallery, which frames the same components.
- **Baselines aren't committed.** 171 states at three sizes is about 36MB of PNGs, and the fonts
  differ between a Mac and a Linux runner, so a committed baseline would only fit one of them.
  `toHaveScreenshot` compares against baselines made on the same machine: run
  `npm run test:visual -- --update-snapshots` on the base branch, then `npm run test:visual` on the
  change. `e2e/__screenshots__` is git-ignored.
- **Fixed on the way:**
  - The phone's Confirmed today head is the count alone.
  - The food example's order says `For “Sam”`.
  - The approved fee reads `2.0%`.
  - The phone's delivery rows keep their ticks.
  - Done no longer offers Save and finish later.
- **Focus is ours.** The reference draws no focus state. Anything focused from the keyboard gets a
  2px ink ring, 2px clear of it, which reads on paper and around ink buttons alike. A sheet takes
  focus when it opens (so Tab lands inside it) without drawing a ring round itself.
- **Every control answers the keyboard.** Controls drawn as something other than a `<button>` (a
  row, a leg, a chip, a tick) take Enter and Space through one handler, `clickOnKey`, which clicks
  them, so their onClick stays the only path. A row that holds its own button (a waiting charge's
  Resend, a day's ×) is no longer a button itself: its name is, and the whole row still opens it for
  a pointer.
- **Menus and filters.** A sort is a menu of `menuitemradio`s. A filter mixes options and chips, so
  it is a labelled dialog, its options a radio group.
- **The hidden expected total** is heard as "Hidden": the bullets are hidden from a screen reader,
  and the word sits beside them out of sight (a paragraph can't carry a label).
- **Contrast.** Every token passes WCAG AA on paper except ink-28 (1.8:1). The reference dims with
  opacity, which takes even ink-50 below 4.5:1. Where what is dimmed is still live, it keeps full
  opacity and reads in ink-50 (4.8:1) instead:
  - a step still to come;
  - the next leg of a split;
  - a refund line not ticked yet;
  - a closed day's label;
  - a locked nav item, which still opens the owner's sign-in.

  What is genuinely unavailable (an item out of stock, labour that can't come back) keeps the
  reference's dim and is marked `aria-disabled`, which WCAG exempts.
- **Reduced motion stills everything**, not just the pings: the caret, the PIN dots, the reader's
  wave and the crew strip's scroll all finish at once.
- **Roles.** Every screen is checked as Jen (counter), Luis (manager) and Mike (owner), on the live
  path against the mock:
  - Close the day (unless Settings › Closing says anyone on shift), Payouts, Staff and Overview send
    a counter shift Home.
  - No screen a counter shift can reach shows a payout, fee, cost or margin.
  - The nav locks Payouts, Staff and Overview for a counter shift: the pages whose routes send it
    Home. Staff was left open in the nav at first, so it looked reachable and quietly landed on Home.
  - Settings is You alone for a counter shift and a manager.
- **The icon is the Clear mark**, as the brand draws it, in paper on ink (the brand's dark green; switched from ink on paper at the user's request). It is drawn into
  `public/` by `scripts/icons.mjs`: the SVG, 180 for iOS, 192 and 512, and a maskable 512 that
  keeps the mark inside Android's safe circle. It replaces the purple placeholder, whose PNGs the
  manifest named but which didn't exist.
- **A deploy is a new service worker.** The build stamps its id into `sw.js`, so each deploy
  installs a new worker whose activation clears the last build's cache. Navigations stay network
  first, and each good one refreshes the offline copy of the page. A deploy therefore shows on the
  next load, and offline opens the build last seen online. A running tablet isn't reloaded under
  someone mid-charge: the new build takes over at the next load.
- **The Capacitor web layer** is checked with Capacitor's bridge on the window, as the installed
  app has it. The same build starts, and doesn't register the service worker.

## The mock's Clear side

- **The older client is mocked from the same state.** Some screens make Clear-side calls through
  `api` in `apps/merchant/src/data/apiClient.ts`, not through the merchant API:
  - the Charges list;
  - a charge and its refund;
  - the payout position;
  - the roster, the staff list and the profile.

  The mock had none of them, so the dev demo's Charges list was empty. Now, whenever the merchant
  API is the mock (the dev preview, or `VITE_MERCHANT_API=mock`), the mock's `ClearSide` stands in
  for those calls, from the same in-memory state. A Clear charge raised in New Charge is the one
  Charges lists, and a refund taken through the sheets marks it Refunded.
- **Not in the merchant API contract.** The contract says a Clear refund goes through the existing
  Clear endpoints, and they already have a real client. Copying them into the contract would be two
  clients for one endpoint.
- **Seeded as the reference draws it:**
  - Marcus in four payments, Priya paid now, Ana and Ray in two;
  - Dana has opened hers, Tom's charge expired;
  - the Payouts position ($3,012.40 ready, $4,218.91 on Oct 14);
  - the month's charges by person (Jen 18, Luis 13).

  Refunds follow the server's rules: a manager's or owner's PIN clears one under the limit ($500);
  at or over it, only the owner on their own device.
- **A charge names its owner to every shift.** The refund sheets read the owner's and managers'
  names from the roster every shift can read, not the owner-only staff list. A counter shift was
  seeing "Waiting on the" and "Only the can clear it".
- **A sheet takes focus once, when it opens.** It was taking focus again on every render, because
  callers pass a new `onClose` each time. Typing a PIN into a sheet lost focus after the first
  digit, which on a tablet closes the keyboard.
- **The mock's day is Sep 22**, the reference day, while the clock is real. A counter shift's
  "Today and yesterday" is empty in the browser after that, so the Playwright checks fix the clock
  to 4:41pm on the reference day.

## Card, cash and split sales in Charges

- **One list, each dollar once.** A sale's row is its card and cash part. Its Clear part, if any,
  is its own Clear charge row. A Clear-only order is only its Clear charge, and an order still
  being paid isn't a sale yet. Voided sales stay listed as Voided.
- **Order history is one request.** `orderHistory({from, to})` (`GET /orders/history`, 93 days at
  most) returns each order with its tenders. The list asks for the month so far (and yesterday on
  the 1st), which covers every filter. This is an addition to the merchant API contract.
- **A refund goes back the way the money came:** the card first, then cash from the drawer, one
  refund per tender, with the returned items on the first. A line of several asks how many come
  back ("one of two tires"). Labour can't come back, so a sale that was only labour can't be
  refunded from here.
- **Who approves:** a manager's or owner's own request is approved as it's made (the server's
  rule). A counter shift's waits on a sheet for a manager's or owner's PIN; nothing goes back until
  then.
- **Void needs a manager's or owner's PIN, always**, whoever is on shift (the server's rule): same
  day, and before a card on it is captured at close.
- **A same-day sale can also be refunded in part** ("Refund part") once card or cash has been taken,
  beside Void. The reference only draws a refund once the sale has settled.
- **Adjusting a tip** is for a card not yet captured. "Other" takes any amount.

## Staff PINs (first shift, reset, remove)

- **A new person picks their own PIN on their first shift.** Someone added in Staff has no PIN,
  and the shift screen shows them as "First shift" with "Pick a PIN". They choose four digits and
  type them again, and their shift starts (`POST /api/merchant/staff/:id/first-pin`, on the
  enrolled tablet). It works only while their PIN isn't set, and the write is conditional, so two
  tablets can't both set it. Before this, nobody added in the app could ever start a shift.
- **A PIN is unique within the shop.** An approval (a discount over the limit, a void, a refund) is
  a PIN with no name, matched against everyone. A counter PIN equal to a manager's would approve as
  the manager, so a PIN somebody else has is refused ("Pick different four digits", never whose).
  The refusal counts against the shop's PIN limit like a wrong guess, so it can't be used to probe.
- **Resetting a PIN clears it; it never chooses a new one.** "Reset their PIN" asks the one
  resetting for their own PIN (a shared tablet can be left signed in). The person picks a new one on
  their next shift, and a shift they're on carries on.
- **Removing someone** ends their shift on its next request (a session re-reads the staff row), and
  every charge they raised keeps their name.
- **Who may reset or remove whom:** a manager, counter staff; an owner, counter staff and managers.
  Never an owner (Clear changes owners) and never yourself. The API enforces it, and the Staff sheet
  shows the buttons only when the viewer may use them. Both acts are on the audit trail
  (`staff.pin_reset`, `staff.removed`).
- **In the mock, Ana has no PIN yet**, as the Staff reference draws her ("Ana Ruiz has not started a
  shift").

## Receipts on a live shop

- **Text and Email ask where.** On a real shop, picking Text or Email after a sale opens the send
  sheet for a number or address. The receipt goes out by the API's send route, and the screen
  then says where it went ("To (909) 555-0177 · Change"). With nowhere yet, it reads "Asks where
  to send it · Add". The cash screen has the same links. A text goes by Twilio, an email by Resend
  (below), once the API's notification variables are set (the pilot checklist lists them).
- **Printing uses the device's own print dialog:** AirPrint on an iPad, the Android print service,
  or a browser's. A counter printer shows up there if the tablet can reach it. The sheet says
  "This tablet's printer" instead of a Ready status the app can't know. The paper is the order's
  own receipt (`GET /orders/:id/receipt`), laid out for 80mm receipt paper, one copy per page, so
  a refund taken later shows on a reprint. Print waits until the receipt has been read. There is
  no printer SDK. A native one would replace `lib/printReceipt.ts`.

## Settings: Tax, Tips, Discounts and Closing on a live shop

- **The shop's own settings, saved as they're set.** Each change goes to `PATCH /settings` (owners
  only, the server's rule) and the pane then shows what the server holds. An amount opens a small
  sheet: starting cash, a role's discount limit, a tip preset. While the settings load, a live
  pane shows nothing, never the reference's example figures.
- **Tax** shows where the rate comes from: Stripe Tax, the rate for the shop's address, or none yet.
  It also shows the shop's address, the rate by kind of item with the catalogue's counts, and
  before-tax or tax-included prices (a choice).
- **Tips**: asking on or off, amounts or percentages (switching starts from that kind's usual
  three: $5, $10, $20 or 15, 18, 20%), up to four presets to change, add or remove.
- **"Split by hours on shift" can be chosen** (see "Tips shared by hours on shift" below).
- **Discounts**: the shop's codes, with what they take off and until when. New code is a real form:
  a percent or an amount, the whole charge or one category, optional dates, once per customer. The
  counter's and a manager's limits can be changed; an owner has none.
- **Closing**: starting cash, two counts, and what happens with one person on. "Any difference
  needs a sign-off" reads Always, because the server always requires it. **Who can close** is the
  owner's choice: owners and managers (the default, the reference's), or anyone on shift. The server
  holds it at Close the day (`not_allowed` otherwise) and for the day's figures Close the day reads
  (`GET /drawer/:id/day`, one day of the Overview, since the Overview itself is a manager's). A
  counter who can't close sees "An owner or manager closes the day", and the button asks for the
  owner's sign-in.

## Settings: the shop, its hours, Counter and Devices

- **The listing lives on the shop.** Migration 0012 gives the profile a category ("What you do"),
  a one-line description, and a phone and email for the listing. `PATCH /shop` takes `name` and a
  partial `listing`; a field sent as null or empty comes off the listing. An email is checked for
  shape. The address was already there and is changed through the same call.
- **Hours are their own table.** `merchant.shop_hours` holds a span per open weekday (0 is
  Monday, matching the reference's week), and `merchant.shop_closures` a date with a label and
  either other hours or closed. `GET /shop/hours` reads them; `PUT /shop/hours` (owner) replaces
  the week and the dates together, in one transaction, because the page saves them together.
  Closing must be after opening; a date appears once.
- **Save hours, not save-as-you-go.** The reference draws a Save hours button, so the week and
  the dates are edited on the page and saved as one. Times use the device's own time picker. A
  day switched on starts at 9 to 5. Dates are added with "A date that differs": closed all day, or
  open other hours ("Christmas Eve, until noon"). Photo stays the preview's until there's an
  upload.
- **Breaks are a shop setting**, not a timesheet: how long a break is (30 minutes) and after how
  many hours on shift one is due (5). They sit with the other shop settings (`breaks` in
  `ShopSettings`). Nothing reads them yet: the shift clock, next, is what says who is due one.
- **The PIN lock is the tablet's**, as it always was (`idle_lock_seconds` on the device). Counter
  offers 1, 2, 5, 10, 15 or 30 minutes; `PATCH /devices/:id` now takes `idleLockSeconds` (60 to
  3600) as well as a new label.
- **The mock holds the tablet.** The dev preview's "Counter tablet" is in the mock's `ClearSide`
  (list, rename, lock), so Counter and Devices work on `?preview=1&live=1`. Walk-through:
  `e2e/settings-shop.spec.ts`.

## Shifts, breaks and staff hours

- **A shift starts with a PIN.** `POST /session` (and the owner's sign-in on an enrolled tablet)
  starts the person's shift, unless one is running. Handing the tablet over is a new sign-in and
  ends nobody's shift: everyone who started one is on until they end it. That is what the crew
  strip draws, three on while one holds the tablet.
- **End shift is signing out.** `DELETE /session` ends the caller's shift and any break. An owner
  ends anyone's shift from their sheet ("End Jen's shift"); a manager, counter staff's. Nobody ends
  the holder's from there: the holder has End my shift.
- **A shift nobody ended** is closed on the next read after its day, eight hours in (or now, if
  sooner), and marked `auto_ended`. We don't know when they left, so the record says it's a guess.
- **Breaks pause the clock.** One at a time, only on shift. Home's clock counts worked time, and
  says "break due" once someone has worked the shop's "due after" (Settings › Counter, 5 hours)
  without one, then "30m break taken" after. The idle lock still applies during a break: the
  tablet asks for the PIN when they're back.
- **The clock against the booking.** "Until 4:00pm" and the hour blocks are today's booked hours.
  Past the booked end the "left" figure goes rather than counting negative. Someone not booked
  today sees "Not booked today" and no blocks, and their crew tile says "Not booked", as drawn.
- **Hours are plans by week** (migration 0013): a person's usual hours from a Monday on, and a
  week that differs. "Every week" starts next Monday, as the sheet says ("This week stays as it
  is"), except for someone with no usual hours yet, or whose usual hours began this week: theirs
  start now, and the sheet says "Starts this week." "This week only" replaces this week, and the
  sheet opens on it when there is one. The sheet's times are the device's own time pickers.
- **Who sets hours:** an owner anyone's; a manager counter staff's and their own. Anyone signed in
  can read the week through the API, though the Staff route itself stays owners and managers.
- **Removing someone ends their shift**, on the server and in the mock, so they drop off the crew
  strip at once rather than on their next request.

## Set up the till and Running low

- **Four steps read the shop's own data:** cards connected (charges enabled), a reader paired, an
  item in the catalogue, someone added besides the owner. The team row names them ("Jen and Luis,
  added").
- **Two steps leave nothing else behind, so they're marked when they happen** (migration 0014,
  `merchant.setup_marks`): starting cash when it's saved in Settings or a drawer is opened with it;
  tips and discounts when either is saved or a discount code is made. A mark is never taken back.
- `GET /setup` (owners and managers) answers all six; the list goes once every one is done, and
  "Hide for now" still hides it on this tablet.
- **Running low** is worked out on the tablet from the catalogue and open reorders: stocked items at
  or under their reorder line, or out. Services never appear. "Mark reordered" opens the item.
- **The mock:** `&setup=new` is a shop that hasn't set starting cash or tips; with
  `&stripe=not_connected` the till shows four of six to do. Walk-through: `e2e/home-setup.spec.ts`.

## Overview: Export and statements

- **Export is a spreadsheet (CSV) of the month's sales**, one row a sale: when, the sale, the
  customer, who raised it, its status, the items, subtotal, discount, tax, tip, total, how it was
  paid and what's been refunded. It's made on the tablet from the order history Charges reads
  (`orderHistory`), so it says what Charges says; a Clear charge with no order behind it is its own
  row. A browser downloads it (`mikes-tire-sales-2026-09.csv`); the installed app, where a download
  goes nowhere, opens the share sheet (Save to Files, Mail).
- **A month's statement opens from Statements.** The reference puts Download PDF and Send to my
  accountant under the list; on a live shop they move onto the month, since each statement is one
  month. It shows sales by method, discounts, tips, tax, refunds, the card deposits (processor and
  Clear fees, what reached the bank), tips by person and days closed, from `overview` and
  `cardDeposits` for that month.
- **"Save as PDF", not "Download PDF".** It opens the device's print dialog with the statement laid
  out for letter paper, where Save as PDF (or Save to Files) is a choice. No PDF library is added.
- **Send to my accountant** emails the month's statement as plain text, the same figures, to the
  address typed (remembered on the tablet for next month). See "Email by Resend".

## New charge: scan their code, text a link, offline

- **Scanning a member's code sends them the charge.** Their code (Code in the member app) says who
  they are and no amount: it's their send link, `…/send?to=0x…`. The tablet's camera reads it (the
  browser's BarcodeDetector, or jsQR where there is none, as the member app does), and
  `POST /tenders/:id/send {to: 'member', wallet}` makes the waiting charge theirs: it lands in
  their app, with their text, as if they'd scanned the tablet. Only while nobody has it. A code that
  isn't a member's (a charge code, a wifi code) says so and the camera keeps looking.
- **Texting a link** (`{to: 'phone', phone}`) sends the charge's approve link to the number, by the
  same Twilio text a member gets. US numbers without +1 are taken as US.
- **Either way the tender doesn't change**: it still follows the member's answer, and the waiting
  screen says where it went ("Sent to (909) 555-0177", "By text"). Send again repeats it the same
  way, or asks for a number if it has only been shown. The audit trail records `tender.clear_sent`
  with the last four digits only.
- **The camera** asks for the back camera and takes the front one if that's all there is. Refused or
  missing, the screen says so and offers the number.
- **Offline**: a line above New charge while the tablet has no connection: cash still works; card
  and Clear wait. Offline cards aren't built (`OFFLINE_BUILT` in `reader/platform.ts`).
- Walk-through: `e2e/new-charge-extras.spec.ts`, with the camera replaced by a canvas showing a QR.

## Inventory: importing a spreadsheet

- **The tablet reads the CSV; the server imports it.** Choosing a file reads it on the tablet
  (quoted fields, commas and line breaks in quotes, a BOM), guesses each column from its header
  (Item → Name, Size → Size or detail, Retail → Price, Cost → You pay, Qty → On the shelf, and
  Category and Reorder at), and shows the mapping, as the reference draws it. Each column can be
  changed, or left out; a field is one column, so choosing it for one takes it off another.
- `POST /catalog/import` (owners and managers) takes the rows and imports them in one transaction.
  **A row matching an item the shop has** (name and size, ignoring case and spacing) adds its
  quantity to that item's stock as a delivery ("Imported from a spreadsheet") and changes nothing
  else, prices included. **Any other row is a new item** and needs a price. A category of
  Services or Labour makes it a service (no stock, labour's tax); anything else is goods, in Parts
  when no category is given. The same item twice in one file adds to the one just made.
- **Rows that can't go in are listed back with why** ("Wiper blades has no price"), and the rest
  still go in. At most 2,000 rows at a time.
- A counter shift doesn't see Import, as it doesn't see Add an item.
- Walk-through: `e2e/inventory-import.spec.ts`.

## Payouts: Checked against Stripe

- **The nightly reconciliation is on Payouts**, for owners and managers, as a cell the reference
  doesn't draw. "Everything matches" when nothing is open; otherwise each flag in plain words ("A
  payout that isn't in the books", "Clear's fee on a card sale differs") with its figures ("Expected
  $0.30 · found $0.29") and since when.
- **Explain closes a flag with what happened** (`POST /reconciliation/:id/explain`, a note of at
  least a few words), with who said so. The audit trail records `reconciliation.explained` with
  the note. Migration 0015 adds the explanation to the flag.
- **An explained flag stays closed while its figures hold.** If the nightly run finds the same
  thing at the same figures, it isn't opened again; if the figures move, it's news, and it opens.
- `GET /reconciliation` now answers `{open, explained}`: what's open, and the last 20 explained,
  which the cell shows under "Explained".
- Walk-through: `e2e/reconcile.spec.ts`.

## Dusk and Dark

- **The brand guide's palettes, the member app's values.** The reference draws Light only. Dusk (a
  tan page, still light, so it keeps light's status colours) and Dark (the guide's ink ground) are
  the same tokens as `apps/member/src/styles/clear-tokens.css`, set on `<html data-theme>` in
  `styles/app.css`. Light is no attribute at all: the reference's own `:root`.
- **Chosen per tablet**, from the profile sheet's Appearance, and applied before the first frame
  draws, so a reload doesn't flash light. A tablet set to Dusk or Dark while the choice was pinned
  comes back in it now. A customer's receipt page, which is on their phone, stays light.
- **Codes stay dark on light** in every theme (`--qr-ink`, `--qr-paper`): an inverted QR is one some
  phone cameras won't read. Cash's sage chip keeps dark text on Dark.
- Every main page passes axe's WCAG 2.1 AA checks, colour contrast included, in both
  (`e2e/themes.spec.ts`). The visual baselines stay Light, as the reference is drawn. In
  development, `?theme=dusk|dark` shows one without changing the tablet's setting.

## Email by Resend

- **Every email the API sends goes by Resend** when `RESEND_API_KEY` is set, whatever carries the
  texts: receipts, a member's charge and refund alerts when their contact is an email, and
  statements. From `RESEND_FROM` (default `Clear <receipts@useclear.org>`), whose domain has to be
  verified in Resend. Plain text, the text message's words with a subject line.
- **A statement to an accountant** (`POST /statements/send`, owners and managers) is built on the
  server from the same month figures the tablet's statement shows, and audited as `statement.sent`
  with the address's domain only. Without email set up it says so ("Save it as a PDF instead");
  a refused send says why.
- A receipt that can't be emailed is recorded as not delivered, as a failed text is; nothing else
  about the sale changes.

## The end-of-day summary

- **Sent when the day is closed, not at 9:00pm.** The reference's Notifications pane says "9:00pm";
  the figures are only final once Close the day has run, so that's when it goes. Closing again (the
  same report) doesn't send it twice. A summary that can't go never holds up a close.
- **What it says:** what was taken and how (Clear, card, cash), tips, tax, discounts and refunds;
  the drawer (counted, expected, any difference and who signed it off, to the bank, left for
  tomorrow); tips by person; and any card that couldn't be captured.
- **Where it goes:** an address on Settings › Notifications ("Send to"). Owners sign in with Privy,
  so Clear holds no owner email to default to; empty means it isn't sent. On by default once there
  is an address (migration 0016: `notify_end_of_day`, `notify_email`; `ShopSettings.notifications`).
- **The pane's other switches** (a refund needs you, a charge still waiting, stock running low, a
  payout sent, every charge) aren't built; on a live shop the pane says so rather than showing
  switches that do nothing. Home shows those today.
- By Resend, like every email (see "Email by Resend").

## Business verification (Bridge hosted KYB)

- **Bridge verifies the business before it moves the shop's money to a bank**, so this comes before
  linking a bank and withdrawing to it. It's Bridge's hosted flow, as the member app's KYC is: Clear
  sends the owner to Bridge's pages (its terms, then the business's details, owners and documents)
  and reads back where it stands. Clear keeps only Bridge's customer id and the email it was
  started under (migration 0017); the documents stay with Bridge.
- **On Settings › Advanced** (owners), as the reference's Business details cell: Not verified,
  Started, In review, Verified, Not approved (with Bridge's reason), or Paused, and whether
  withdrawing to a bank is ready (Bridge's fiat payout capability). The owner starts or carries it
  on from there; Bridge sends them back to the same page. The reference's legal name, tax ID and
  registered address rows are Bridge's to hold, so a live shop doesn't show them.
- `GET /kyb` (owners and managers) and `POST /kyb/start` (owners, audited as `kyb.started` with the
  email's domain). Once started it stays with the first address: Bridge finds the customer by it.
- **Dev's Bridge key is live**, so nothing here has been run against Bridge: tests stand in for it.
  The first real verification is the first shop's.
- The reference's "Your data" downloads aren't built; Overview's Export covers the month's sales.

## Linking a bank (Plaid, then Bridge)

- **Clear's own Plaid links the bank; Bridge pays out to it.** The owner signs in to the bank in
  Plaid Link (Auth), which verifies it's real and theirs: no typed numbers and no test deposits, so
  the reference's Add a bank account form (routing and account numbers, verified by two small
  deposits) stays the preview's. The API reads the chosen account's numbers from Plaid, registers
  them with Bridge as the business's external account (in the shop's name, at its address), and
  closes the Plaid link. Clear keeps the bank's name, the last four digits and checking or savings
  (migration 0018); the full numbers are never stored or logged.
- **The business has to be verified with Bridge first** (Settings › Advanced), and the shop needs
  its address: the sheet says which.
- **The rail is a seam** (`BankRail` in `services/merchant/bank/bankService.ts`): Bridge today;
  Lithic would slot in there if it becomes the shop's fiat rail.
- Payouts › Where withdrawals go lists the banks; an owner adds or removes one (audited as
  `bank.added` and `bank.removed`, with the last four only), a manager sees them. "Withdraws to"
  on Payouts names the first linked bank.
- **Dev's Plaid is sandbox and its Bridge key is live**, so only Plaid's side can be tried on dev
  without creating a real Bridge account; tests stand in for both. In the mock, Plaid Link is
  skipped and picks Plaid's sandbox checking account.

## Withdrawing to a bank

- **One Withdraw, both hops.** Choosing the bank as where it ends up carries straight on: what's
  owed is redeemed into the cash account (the shop's wallet, its USDC) as before, then Bridge is
  asked for a transfer to the linked bank, answers with where to send the USDC, and the shop's
  wallet sends it (signed by Clear's key on the wallet, as the redemption is). A redemption that
  queued leaves nothing to send yet. Decided with the user 2026-09-26.
- **Standard or same-day, the owner picks:** standard ACH is free and takes 1–3 business days;
  same-day ACH carries Clear's 1% (Bridge's `developer_fee_percent`, `BRIDGE_INSTANT_WITHDRAW_FEE_PERCENT`),
  as the member app's cash-out does. "Where does it end up?" lists both for a linked bank.
- **Never says money moved when it didn't.** Each withdrawal is a row (migration 0019) written
  before anything is asked, and the transfer is keyed to it, so a retry can't send twice. Nothing
  is sent until Bridge has answered; a refusal, or a wallet that couldn't fund it, says so and that
  nothing left the cash account. Sent ones are audited as `bank.withdrawal_sent`.
- **Inert on dev, like the redemption:** it needs Clear's signing key on the shop's wallet
  (`PRIVY_AUTHORIZATION_PRIVATE_KEY`, with `ZERODEV_PROJECT_ID` for gas). Without them the request
  is recorded and the screen says it goes once Clear can sign. Bridge's `base` rail is Base mainnet,
  so a real off-ramp also needs the shop on mainnet; dev is Base Sepolia.

## Bridge's sandbox, tried (2026-09-26)

With a Bridge test key, in a command's environment only, against `api.sandbox.bridge.xyz`:
- **Starting business verification works as sent:** `POST /kyc_links` with `type: business` returns
  the customer and both links (terms, then KYB), and the customer reads back `not_started`, which
  the tablet shows as Started. Bridge's sandbox approval switch moves a business on only to
  `awaiting_ubo` (its owners), which the hosted form completes; so a full sandbox run is the
  hosted pages filled in by hand.
- **Registering a bank is refused until the business is verified** ("Customer is missing required
  address data"), so linking now checks that Bridge has verified the business (customer `active`)
  before Plaid Link opens, and says why if not, rather than after the owner has signed in to their
  bank. The `BankRail` seam gains `ready(customerId)` for it.

## Settings › Payouts: statements, and where payouts go

- **Where payouts go** names the bank linked with Plaid ("Chase ••4417 · Business checking,
  verified with Plaid"); Change account opens Payouts › Where withdrawals go, where banks are added.
- **Statements** lists this month (still being written) and the two before. PDF is the month's
  statement through the print dialog (the Overview statement); CSV is the month's sales (the
  Overview export).
- **Email each statement** sends last month's statement on the 2nd, in the shop's own time, to the
  address set here (migration 0020: `statements_email`; `merchant.statement_sends` so a month goes
  once). A daily job does it (`jobs/monthlyStatements.ts`, under an advisory lock); one that fails
  is tried again the next day. By Resend, like every email.

## Bridge, live or sandbox

- `BRIDGE_ENV=sandbox` points the whole API at Bridge's sandbox: `BRIDGE_SANDBOX_API_KEY` is used as
  the key (and for Send payouts), the address becomes `api.sandbox.bridge.xyz/v0`, and
  `BRIDGE_SANDBOX_WEBHOOK_PUBLIC_KEY`, when set, checks Bridge's webhooks. Swapped once at start-up
  (`config/bridgeEnv.ts`), so every reader follows, member app included. The live key stays in
  `BRIDGE_API_KEY` for production. Sandbox without its key leaves Bridge unconfigured rather than
  falling back to live.

## Tips shared by hours on shift

- Settings › Tips › Who gets them: whoever raised the charge, or **split by hours on shift**. By
  hours, a business day's tips are pooled and shared by each person's minutes on shift that day:
  shifts that started on the day, from PIN to End shift (or now, for someone still on), less breaks.
- **Card and cash are shared apart,** because they're paid apart: cash out of the drawer at close,
  card (and Clear) with payroll. Whole cents, largest remainder first, so the shares add up to the
  pool; a tie goes to more minutes, then by id, so it's the same answer every time.
- **Booked at close,** as one `tips_shared` entry per kind that nets to zero: out of each raiser's
  tips account, into each person's share. The cash payout then pays the shares. Until the close the
  ledger still shows who raised each tip, so "your tips" can change at close (the setting says
  "Shared at close").
- **One answer everywhere** (`drawer/tipShare.ts`): the close, the day report (which also records
  each person's minutes: `tipsHours`), the end-of-day email, and Overview. For Overview, a closed
  day is as its report shared it and a day not yet closed is as closing would share it now, so
  Close the day shows what closing will do.
- A day nobody clocked in for is shared by raiser, and its report has no minutes.

## The shop's Bridge customer is the business, never its owner

- Bridge keeps one verification per email: asking for a business link under an email that already
  verified a person answers `duplicate_record` with that person's link (seen in the sandbox). The
  KYB used to find its customer by email, as the member app does, so an owner verifying the shop under
  their own address would have made the shop's "business" the owner as a person.
- So the shop's KYB never looks up by email: it uses the shop's own customer once it has one, and
  before that makes a business customer. An email Bridge has as a person is refused with a sentence
  asking for the business's own email; one it has as a business is used unless another shop has it.
- A shop already holding a person (started before this) reads "needs info" with that reason, can't
  link a bank, and starts over as the business with a new email.
- The other way round: the member app's lookup by email skips any shop's customer, and the Bridge
  webhook acknowledges a shop's events without running them through a member's deposits
  (`shopBridgeCustomers.ts`).

## Receiving by ACH: a Bridge virtual account paying the shop's wallet

- Payouts › Receive shows the shop's own account and routing numbers: a Bridge virtual account on
  its verified business customer, delivering USDC to the shop's wallet (its address is the shop).
  A deposit shows in the cash account like any other USDC; the Bridge webhook leaves it alone.
- An owner opens it once, after Bridge has verified the business (as a business, never the owner as
  a person); it's read back from Bridge each time, and only one paying the shop's own address in
  USDC counts. Clear stores none of the numbers; the audit keeps the last four.
- Email them sends only to the address the business was verified under, not one typed in, so the
  numbers can't be sent anywhere by whoever is holding the till.
- The chain is `BRIDGE_PAYOUT_SOURCE_CHAIN` (default `base`), as the member app's accounts use: Base
  mainnet. Dev's shop wallets are on Base Sepolia, so a real deposit there would arrive on mainnet;
  try it on the sandbox (`BRIDGE_ENV=sandbox`), and for real only on production.

## Onboarding: terms codes and the team

- **Terms codes** (migration 0021) are Clear's: a code, the tier it puts a shop on (founding today:
  1.25% paid now, 2.0% over time) and how many places. Clear adds, lists and retires them with
  `scripts/terms-code.ts`; nothing in the app makes one.
- **Apply asks Clear** (`GET /api/merchant/terms-code/:code`, public because the shop doesn't
  exist yet, ten tries a minute from one address) and shows the answer: the tier and places left,
  with its own rates in "With your code"; every place taken; or not a code Clear knows (a retired
  one included).
- **The place is taken when the shop is made**, under a lock so two signups can't both take the
  last one. Once only: a retried signup keeps its code. If the last place went between Apply and
  the sign-in, the shop is on standard terms, and the Verify step says so.
- **The tier is Clear's record; the chain charges what it's told.** Clear registers the shop on
  chain (`scripts/register_merchant.ts`) with the terms of the tier recorded here.
- **The team is added with the shop:** names and Counter or Manager, kept with the form until then,
  up to 20. Each picks their own PIN on their first shift, as in Staff. Added only when that call
  makes the shop, so a retried signup doesn't add everyone twice. Nobody gets a text yet (the
  reference's "gets a text to join"), and there's no mobile field.

## Onboarding: where payouts go

- **The owner is signed in when the shop is made,** with the same sign-in that made it, so Where
  payouts go is Settings' own flow rather than a promise to do it later. If that sign-in doesn't
  take, the step says to link the bank in Settings, as before.
- **Bridge verifies the business first,** under the legal name and an email that belongs to the
  business (prefilled from Start, and the hint says not the owner's own: Bridge keeps one
  verification per email). Bridge's pages open in a new tab so signup stays where it is; Check
  again reads where it got to. The wording is Settings › Advanced's.
- **Then the bank, with Plaid,** once Bridge has verified the business (it pays out only to a
  verified one). Before that, the bank reads "After verification".
- **The cash account follows it:** "After verification", then "Ready". The preview keeps the
  reference's "Opens with verification".
- Nothing here holds up signup: Continue is always there, and Settings has the same.
- Against the mock: `/onboarding?preview=1&live=1&step=6` (`&kyb=new` for a shop not yet verified).

## Settings › Advanced › Your data

- **Two downloads, made on the tablet** from what the app already reads (`settings/yourData.ts`),
  owners only, as Advanced is.
- **Every charge:** Overview's export (one row a sale, every way it was paid) over the whole history
  since the shop joined, read 93 days at a time (the most the API gives in one go), plus Clear
  charges with no order behind them (the newest 500, the most that list gives).
- **Every payout:** Clear's payouts and the card processor's deposits, one row each: date, kind,
  reference, how many charges were in it, gross, the processor's fee and Clear's fee where they're
  known, net, and status. Deposits are read a fortnight ahead, since one in transit arrives after
  today. Clear's payouts aren't itemised by charge (nothing batches charges into a payout run), so
  "with the charges in each" is the count, as Payouts › a payout says.
- Withdrawals to the bank aren't in it: they're the shop moving its own cash, not a payout.

## Desktop width

- **Wider than the reference's 1180px tablet, the frame stops at the member app's width:** 1120px of
  content, header included, inside its 24px sides (1168px), centred, as the member app's header
  (`max-w-[1120px]`) and pages (`max-w-[1168px]` with padding) are. At 1180px and below nothing
  changes, so a tablet is still the reference's full screen.
- One rule on `.c-mc-tablet` (app.css), so every screen follows: the app's pages, onboarding, and
  sign-in.

## No payout day: net-30

- A shop with no next payout date is paid on net-30 terms, so wherever the day would go the app says
  so rather than a dash: Payouts (Releases net-30, "30 day terms", Paid net-30, the rest releases
  net-30), Home's Next payout (shown whenever something is owed), Overview and Settings (Net-30 ·
  the amount), and an approved charge's Paid out. A dash is left only where the figure couldn't be
  read. Against the mock: `&payday=none`.
- **Net-30 counts down from a withdrawal, not from a sale** (2026-10-15). The pool starts a claim's
  30 days when the shop withdraws (`PayoutPool.redeem`, `dueBy`); before that nothing is counting,
  and the card keeps saying "30 day terms". Once a withdrawal is queued, the API reads the shop's
  unpaid claims from the pool (`queued`), returns their total (`queuedCents`, counted in
  `scheduledCents`) and the oldest one's due day (`releasesOn`), and the card counts down to it.
  Withdrawing moves the credits to the pool, so before this a queued withdrawal also vanished from
  Payouts, Home, Overview and Settings while its 30 days ran; `stillOwedCents` keeps it in each.
- **When a claim comes due, nobody has to be asked.** `drawForDueClaim()` is permissionless: the pool
  borrows what it's short from the yield pool, then the assurance pool's excess and buffer, and pays.
  Checked on a fork of Base Sepolia with MiMi Crack's real balance: $91.50 withdrawn and queued,
  31 days on an unrelated address drew $90.50 from the yield pool and the shop was paid $91.50.
- **Withdraw queues what the pool can't pay yet** (the owner's call, 2026-10-15). Owed money was
  capped at what the pool had released, so the rest could never be withdrawn and its 30 days never
  started. Now owed money is capped by what the shop holds on the ledger: the released part is
  redeemed first and paid on the spot, the rest is redeemed after it and queues, due 30 days later.
  The sheet says so before and after ("Queued · $91.50 by Nov 14", "You receive now"). A bank only
  gets the paid-now part; the queued part lands in the cash account when it's paid. Fork-checked:
  $1.00 then $91.50 for MiMi Crack, the first paid at once, the second queued.


## Terminal: what the spec met (Phase 1, 2026-10-15)

`clear-merchant-terminal.html` adds counter hardware, tables and the phone pages. Where it met the
code or the earlier references:

- **Enrolled tablets already own "devices".** `/api/merchant/devices` and `merchant.devices` are the
  tablets signed in as the shop (Security, Settings › Devices' This tablet). Points, drawers and
  printers are their own table and live at **`/api/merchant/hardware`**; Points and drawers keep the
  spec's own paths (`/points/claim`, `/points/:id/show`, `/drawers/:id/key`, `/drawer/events`).
  Readers stay in `cards.ts`. The existing "Add a device" sheet (a code for another tablet) moves to
  Security under its own name, so the new one can have the title.
- **The phone pages live on the member app.** `apps/member` is app.useclear.org, not the apex
  (useclear.org is the marketing site, another repo). `/p/:code` and `/r/:code` are built there,
  split away from Privy and the wallet providers; the apex redirects `/p/*` and `/r/*` to it. The
  Point and the sticker still print `USECLEAR.ORG/P/A7K2`, as drawn.
- **Receipt codes are random**, ten Crockford characters (`Receipt.code`), made once and kept in
  `payments.receipts` with the `link` channel it already allows. The spec's `/r/0142` is only an
  example. The merchant app's `/r/:token` links, already sent by text and email, keep working.
- **Point codes are four characters**, as drawn. That is about a million codes, so `/api/p` is
  rate-limited by address across all codes; today's limiter keys on the path, which would give each
  guess its own allowance.
- **Cash offline wasn't true yet.** The New charge line said cash still works offline, but raising
  the order and taking the cash both needed the server. Orders now take an idempotency key and, when
  queued offline, the tablet's own figures (below). The service worker's "there is no offline
  queue, and there must not be one" is about the network layer and stays: the queue lives in the
  app (IndexedDB), never in the worker.
- **The redrawn cash screen keeps its receipt band.** Section 5 draws Change and Paid without the
  original's Send a receipt (Text, Email, None); the prompt keeps everything the original draws, so
  the band stays and the paper row under it becomes the printer's.
- **A No sale's PIN is checked here, at the tablet.** "Ana or Luis can approve here or from their
  phone": nothing sends staff an approval today (the Clear refund's "from their own device" is the
  owner signing in and finding it). The phone half waits for a pending-approvals feed; until then the
  line reads "Ana or Luis can approve here." A PIN needs the connection, so a No sale does too; a
  sale's open never does.
- **"Your table is ready" as a notification** reaches a member who joined the wait list signed in,
  from the Clear app. A party who joined from the phone page by number gets the text only.
- **Card on the phone page is a Stripe Checkout Session** on the shop's account, a direct charge with
  `clearCardFee` as the application fee. It is captured at once, unlike the counter's cards, which
  Close the day captures; the day's figures count it as a card tender like any other.
- **Native code can't be built on this Mac** (no Xcode, Android SDK or Java, as in Phase 5). The
  Bluetooth and raw-socket plugins get their TypeScript side behind the services; the native side
  is written to be built on a Mac with the toolchains.
- **The stylesheet.** `scripts/reference-css.mjs` reads every reference file; the terminal file goes
  last in its `ORDER`, so it can't override the earlier files' rules.
- **Not drawn, taken from the nearest drawing:** Counter's Tables switch (a Switch row like the
  others there); adding a drawer (find, then test open) and a printer (find, then print a test
  label), on the Point's three-step layout; Edit tables and Add a party (sheets like Edit hours);
  Category order (rows with a handle); the 4 × 6 receipt label (the sticker receipt's layout); the
  phone page when a Point idles on Pay here (the menu's header with "Pay here when you're done").
  Where an order is marked To go or Delivery isn't drawn either; tables' orders are dine in, and the
  rest have no type until it is.

## Terminal Phase 2: contracts

- **New files** in `packages/merchant-contracts`: `devices.ts` (Points, the drawer, printers, Point
  state, the drawer's log and key), `floor.ts` (tables, the wait list, alerts, Order ready) and
  `public.ts` (the phone pages, and the Point's screen from the device API).
- **One Point state** (`PointState`: idle, bill, paid, alert, waitlist, test) for the merchant app,
  the device API and the phone page. `pointShowing` decides what shows now: an alert covers anything
  until it expires; a paid bill holds for three minutes (`POINT_PAID_SECONDS`), then idle. The server,
  the mock and the fake Point all use it.
- **By time of day** is a switch, as drawn: the Menu while the shop is open before 9pm, Pay here
  after. The hour isn't a setting until the reference draws one.
- **Additions to existing responses are optional** (`Order.tableId`, `serviceType`, `calledAt`,
  `pickedUpAt`, `offline`; `CatalogItem.onMenu`, absent meaning on; `Receipt.table` and `code`; the
  three new shop settings), as `tipsHours` was, so a response from before them still parses.
- **An offline order carries the tablet's figures.** `CreateOrder.offline` holds the subtotal, tax
  and total the tablet worked out from the last catalogue and rate it had; the server keeps them,
  because the customer has paid that and had their change, and marks the order `offline`. Online,
  figures are the server's as always. `CreateCashTender.clientCreatedAt` puts a queued tender in the
  drawer session open at that time.
- **Categories keep their names.** There is still no category record; `CategoryOrder` is the shop's
  list of names, and a category not in it sorts after, A–Z. Showcase picks categories by name.
- **A No sale is approved, then logged.** `approveNoSale` checks the reason and PIN and returns an
  approval; the drawer opens and its `opened` event carries the approval's id.
- **"Email me this receipt"** on the paid page is drawn, so the public API has it
  (`POST /api/r/:code/email`), rate-limited by address and by receipt.
- **The mock refuses the new calls** ("Not in the mock yet") until the Terminal screens fill them in
  (Phase 4). The real client already maps each to its route.

## Terminal addendum: table numbers and seating a party (2026-10-15)

The terminal reference was replaced with the version that draws section 8b (Seating a party), the
held tile and the Number idle screen. It arrived after Hard Stop 2, so its contract changes are an
amendment, approved before the API builds on them.

- **Idle modes are Number, Menu, Showcase and Pay here**, Number first, as the pane draws them. A door
  Point idles on the wait list, which the pane doesn't offer, so `PointIdleMode` has a fifth value,
  `waitlist`, and `PointState` no longer has its own wait-list state. Defaults by placement
  (`DEFAULT_IDLE_MODE`): table → number, counter → pay, door → waitlist.
- **Held is a layer, not a replacement.** `pointShowing` now takes the last thing sent (idle, bill,
  paid, test), a hold, a Call or Bill request and an alert, and shows the top one that's live:
  alert, then request, then bill/paid/test, then held, then idle. So a bill sent to a held table
  wins (the server also clears the hold), and a hold that lapses falls back to the number by
  itself, on the Point too.
- **The phone page carries no Point state.** `PublicPoint` has only its `view`; a held table is
  `menu`. The state (with the party's first name) is in `PointScreen`, for the Point alone. The
  public schema drops anything it doesn't name, and a test parses a held screen through it and
  checks the name is gone.
- **Tables have seats and a hold.** `Table.seats`; `TableHold` (party, show name, seated at,
  expires at); a `held` tile status, with the party's name for staff ("Held for Ana").
- **Seat is one call**, `seatParty(partyId, {tableId, showName, text})` → `POST /waitlist/:id/seat`:
  party seated, table and its Point held, Table ready on the door Point, the text if asked. The same
  seat again changes nothing. `seatTable(tableId)` is now staff marking a table seated (a walk-in, or
  the held party sitting down), which clears the hold. A party is no longer seated through
  `updateParty`.
- **A hold clears** on the first item on the tab, staff marking the table seated, or
  `HOLD_SECONDS` (15 minutes), whichever is first; the timeout runs in the existing jobs.
- **Mock seed, for Phase 4:** Table 6 held for Ana (2, seated 7:58 PM); the wait list Lee, Marco,
  Priya; tables 1 and 6 seat 2, 14 seats 4.

## Terminal addendum 2: the Pay case (2026-10-15)

- **A Point can be a card terminal; the tablet does the work.** The Pay case holds a Stripe M2 under
  the Point with two buttons. Only the Stripe Terminal SDK on a tablet or phone can drive an M2. **The
  Point never talks to the reader**: it detects the case, sends button presses, and shows the
  screens. Don't build a path where it does.
- **One reader at a time.** Stripe's SDK connects an app to one reader and one operation at a time.
  The tablet connects to a table's reader when that table's bill is sent to a Point with a linked
  reader, lets go when the payment succeeds, fails or is cancelled, when the bill is withdrawn, or
  after 5 minutes idle, and returns to the counter's reader. A second table waits in a queue (the
  "Next" row); a payment in progress is never interrupted.
- **Contracts:** `PointHealth.case` (`{kind: 'pay', buttons: 'ok' | 'fault'}` or null);
  `PointSettings.readerId` (one reader to one Point) and `buttons` (`call`, `bill: 'send_bill' |
  'notify'`); `PointState` gains `called` and `bill_asked` (`TABLE_REQUEST_SECONDS`, 10 minutes);
  `TableRequest`; `PointEvent` for `POST /api/device/point/event`; `tableRequests()` and
  `answerTableRequest(id)`; the Floor read carries the last hour's requests.
- **Lit** (`pointLit`): held, called and bill asked light the screen; the ring lights share the
  ready light's pin, so one flag drives both.
- **Live updates to tablets:** the tablet polls the floor and requests every 4 seconds while Home or
  Tables is open, the rate the "waiting" screens already use. A stream can replace it later.
- **Measured on a real M2: not yet.** How long connecting and letting go take decides whether the
  background connect is fast enough. There's no M2 on this Mac; the figure goes here once measured.
  The app now times it (docs/hardware/m2-timing.md), so it's one console call on a tablet.
- **Mock seed, for Phase 4:** Table 12 in a Pay case with M2 1A3F; an open Call on 12 from a minute
  ago; Table 4's bill just sent ($62.00); Table 9's call answered by Luis at 8:01pm.

## Terminal Phase 3: the API (2026-10-15)

- **Where it lives.** `services/merchant/terminal/` (hardware, Point state, the drawer's log, the
  floor, the phone pages); `routes/merchantTerminal.ts` on `/api/merchant`; `routes/devicePoint.ts`
  on `/api/device/point`; `routes/phonePages.ts` on `/api/p` and `/api/r`. Migrations 0023 (hardware,
  Point keys and states, the drawer's key and log, No sale approvals), 0024 (tables, holds, orders'
  table and service type, the wait list, Call and Bill, alerts) and 0025 (on the menu, category
  order, receipt codes, a checkout's session, the three settings).
- **What a Point shows is worked out when asked** (`pointStateFor`), from what was last sent, the
  table's hold, an open Call or Bill and an alert, through the contracts' `pointShowing`. So a paid
  bill, a hold or a Call lapses on time with nothing running; the 30-second sweep
  (`jobs/terminalSweep.ts`) only tidies the rows (a lapsed hold's table counts as seated) and wakes
  the shop's Points.
- **Points are woken, not pushed to.** Any merchant write that succeeds, a Clear tender the sync job
  moves, and a checkout's webhook "touch" the shop; a Point's long poll or stream then asks
  `pointStateFor` again. The wake is in-process: with more than one API instance, a Point on another
  catches up when its wait ends (25 seconds at most).
- **A Point on battery** asks `GET /state` with the ETag it has; the answer waits until the shop
  changes or what it shows lapses by itself, else 304 after 25 seconds. **Plugged in**, it holds
  `GET /stream` (server-sent events, a comment every 20 seconds).
- **Points exist before they're sold.** `merchant.point_keys` has a row per Point made, so a typed code
  can only claim a real, unclaimed one. The factory's list goes in with `scripts/point-codes.ts`
  (see "Terminal: the factory's list of Points" below). Claim gives a one-time secret (ten minutes); the Point
  trades it for its device key at `POST /api/device/point/activate`. Only hashes are kept. Unpairing
  drops the key, and the Point can be claimed again.
- **The drawer's key** is sealed with the member data's envelope keyring when that is configured, and
  stored as is when it isn't (so a development API works). Production should have the keyring set.
- **A No sale's approval lasts two minutes** and opens the drawer once (`approval_id` is unique on
  the log). A No sale needs the connection; a sale's open never does.
- **Drawer events that arrive with the same time** keep the order they arrived in (a `seq` column):
  a batch is in the order things happened.
- **Offline cash sales.** The order's lines are priced here; its subtotal, tax and total are the
  tablet's, its tax spread across the lines; its stock isn't checked (it's already gone); its
  business date is the tablet's. The audit trail keeps what the server would have priced it at
  beside the tablet's figure. The cash tender joins the drawer session open at the tablet's time.
- **Call pressed again.** The Point's screen says "Press it again to cancel"; the addendum says one
  request per table. Both hold: a press within three seconds of the first is the same press; a later
  one cancels it. A press made offline counts if it arrives within two minutes.
- **Bill with "Send the bill to the Point"** and a tab with items sends the bill through the same path
  as staff (the hold clears, the request is recorded as `bill_sent` with its amount). Otherwise it
  tells staff.
- **The wait list's quote** is five minutes a party: "3 waiting · about 15 min".
- **By time of day** shows Pay here from 9pm to 5am in the shop's time zone, the Menu otherwise. The
  **test screen** goes back by itself after a minute.
- **Texts.** Table ready says the spec's "Your table is ready: 6, by the window". Order ready isn't
  drawn as a text; it takes the Point's words: "Mi Casa Tacos: order 27 is ready. Pick up at the
  counter." Both go by the receipts' Twilio path (a new `shop_text` kind), and only to a number the
  party agreed to be texted at, or an order's customer when that's a phone number.
- **Receipt codes** are made the first time a paid order's receipt is read to print
  (`GET /orders/:id/receipt`), and the receipt now carries its table ("Table 6, by the window").
- **The phone pages** answer with `Cache-Control: no-store` (the member app's worker caches GETs to
  `/api/`). Reads are limited to 120 a minute per address across every code, and paying, joining
  and emailing to 10. The page is built from the Point's screen and parsed through `PublicPoint`,
  which drops the Point's state, and the party's name with it.
- **Card from the phone page** is a Stripe Checkout Session on the shop's account (`createCheckout`
  on the connector, optional so a processor without it simply doesn't offer card there), captured at
  once with `clearCardFee` as the application fee. The tender follows `checkout.session.completed`
  (and `async_payment_succeeded`, `expired`), which **the Connect webhook endpoint in Stripe must be
  subscribed to**. A paid card's details come from the charge's `card`, as the counter's come from
  `card_present`.
- **Where links point:** `POINT_PUBLIC_HOST` (default `useclear.org`) is what a Point prints;
  `PHONE_PAGE_BASE_URL` (default the member app) is where Checkout returns and receipt emails link;
  `POINT_API_BASE_URL` is what a claimed Point is told; `POINT_FIRMWARE_LATEST` marks firmware
  current.
- **Not yet:** the "Your table is ready" notification for a member who joined signed in (the wait
  list keeps their wallet; Phase 5 sends it); the contract conformance run against a real Postgres
  (`apps/api/e2e/contract.ts`).

## Terminal Phase 4: the merchant app (2026-10-15)

- **The terminal file adds to reference.css; it doesn't vote.** `scripts/reference-css.mjs` reads it
  as an addendum (ADDENDA): a rule of its own is added, a rule the ten draw differently is kept for
  its own screens under `.c-page-terminal`, and a rule the ten keep only for their pages (Settings'
  selected chip) is added for its screens too. The ten files' output is unchanged, line for line.
- **Mi Casa Tacos in the preview** is `&shop=micasa`: the mock's seed (`seedMiCasa.ts`, re-exporting
  what Mike's Tire's has that the terminal screens don't draw) and its Terminal state
  (`terminalMock.ts`, at dinner on Oct 15). The preview's three roles keep their ids, so `&as=jen`
  is the counter at either shop. `&calls=open` opens Table 12's Call (13b); `&seat=before` is the
  moment before Ana is seated (8b); `&drawerHw=stuck` is a drawer that doesn't answer.
- **One tax rate at Mi Casa.** The reference's bills don't agree: Table 12's $3.70 on $44.50 is
  8.32%; order 0142's $3.45 on $42.25 is 8.17%. Table 12's, which five sections draw, sets it, so
  order 0142 is **$3.51 tax, $45.76, $4.24 change** from $50.00.
- **Terminal screens read the API in the preview too.** Devices, Tables, On the menu and the Home
  cells take their figures from the mock, seeded with the reference's, rather than from constants;
  so `?preview=1` and `&live=1` show the same dinner. New Charge's cash and Show on frames, and Close
  the day's opens, keep the pages' own preview constants.
- **Settings › Devices is the terminal reference's pane for every shop.** Mike's Tire has nothing
  paired, so it shows the empty rows. Each device's pane is `/settings/devices/<id>`, and the
  printers share `/settings/devices/printers`, as the reference draws them on one pane. The M2 inside
  a Pay case shows on its Point's pane, not under Card readers. The rail is the way back on a
  landscape tablet; one column gets a back arrow.
- **The old Add a device** (a code for another tablet) keeps its place in Security; the new one is
  the hardware sheet. A card reader keeps the pairing it already has (Settings › Payments).
- **Printer rows name the make** (Clear 4-inch, Rollo) from `PrinterSettings.model`, added to the
  contract at Hard Stop 4 (optional, so settings saved before it still parse). Adding a printer keeps
  what it calls itself when found.
- **A tile with no Point says "No Point".** The floor draws Table 1 as "Point shows Menu", but no
  Point at Table 1 is in the devices list; Table 14's Point idles on the Menu, as the floor draws it.
- **Calls and bills show while one is waiting**, above the floor and on Home, with the last hour's.
  A Call turns its tile amber (`.c-tm-tile.c-call` in app.css: the reference names the colour, not
  a rule).
- **Order ready is on Home for any shop with a counter Point**, counter service or a restaurant's
  to-go orders. Mi Casa has both, so its Home has both cells.
- **The drawings beside the sheets are notes.** The Point screens drawn next to the Seat, tab and
  Show on sheets explain them; the sheets don't carry them. The drawings inside a pane or a sheet
  (a Point's pane, the Pay case, Add a Point's "It will show", the printers' labels) are on screen.
- **No sale's keypad.** The reference draws four dots and no keypad; a tablet has no keyboard, so the
  sheet adds the PIN keypad the refund override uses. "Ana or Luis can approve here."
- **The cash screen's paper row is the printer's** once a printer prints the receipt (Send a receipt
  stays above it); with no printer it's the print dialog, as before. A cash sale's drawer opens as the
  change screen comes up; "Drawer didn't open" shows if it hasn't said so in two seconds, and "I used
  the key" logs a key open against the sale.
- **Offline cash.** Checkout prices the cart on the tablet with the shop's tax rates as it last read
  them (kept from Settings › Tax); with none read yet, it says so. Card, Clear and split wait. The
  order and its cash go into one IndexedDB queue with the drawer's events, synced in order when the
  connection is back; the Point only catches up then.
- **Tables' Add items and Take payment open New charge on the tab** (`/new?order=…&table=…`): the
  tab's lines in the cart, its own Point shown the bill. A seated table with no tab raises one with
  its table. Edit tables is on the floor for everyone; saving needs a manager (the server's rule).
- **Not drawn, built from the nearest drawing:** Add a party and Edit tables (sheets like the join
  page and Edit hours), Category order (rows that move up and down), Settings › Counter's Tables
  switch (a Switch row in a Service cell), adding a drawer or printer (find, then test, in two steps).
- **Reader switching** (the Pay case addendum) is `readerQueue` in `src/reader/tables.ts`, on the
  existing single-reader service: connect a table's M2 when its bill goes to its Point, wait behind
  a payment in progress, give the reader back after the payment or five idle minutes. The card screen
  shows "Card · Table 12" while it connects or while another table waits.
- **Native code is the Phase 6 seam.** The drawer's and printers' native sides say what's coming
  with the app update; the web drawer uses Web Bluetooth (Chrome), the web printer the print dialog.
- **Visual checks.** `e2e/states.ts` has 23 `terminal-*` states, each at its reference moment
  (`clock`: dinner at 8pm, lunch at 12:42pm). The terminal file's sheets count as frames when the
  reference is captured (`e2e/reference.spec.ts`), which no other file's do.

## Terminal Phase 5: the phone pages and the member app (2026-10-15)

- **The phone pages are their own entry.** `apps/member/phone.html` and `src/phone/` (no router, no
  Privy, no wallet, no service worker): React and 4 kB of their own, about 66 kB gzipped in all.
  Vercel serves `phone.html` for `/p/(.*)` and `/r/(.*)` before the app's catch-all; `main.tsx`
  renders the same pages for those paths when the app's shell answers instead (`vite dev`, or the
  service worker's offline shell). A test keeps the entry free of app imports.
- **Never cached, never with cookies.** Calls are `cache: 'no-store'` and `credentials: 'omit'`; the
  service worker sends `/api/p` and `/api/r` to the network only (a bill changes by the second, and a
  receipt is someone else's on a shared phone).
- **The page follows the Point by asking.** Every 4 seconds while a bill is open (so Paid shows at
  once, including a card coming back from Stripe), every 15 otherwise, not while the phone is
  hidden. A paid page stops asking, so the receipt stays when the Point goes back to its number. A
  dining room on the guest Wi-Fi shares one address and the phone pages' 120 reads a minute, which
  is why the slow rate is the common one.
- **The drawn address bar is the browser's**, so it isn't built. The menu shows names and prices as
  drawn (an item's detail isn't on the phone drawing). The Pay here view is the menu page with no
  rows: the shop, where the Point is, and "Pay here when you're done".
- **Pay with Clear raises the counter's own Clear tender** and opens it on app.useclear.org/c/…; a
  second tap, or a member scanning after the page started one, opens the Clear charge already
  waiting rather than failing with "being paid already". Pay by card is Stripe Checkout and returns
  to `/p/:code?paid=1`.
- **The paid page makes the receipt's code** (`publicPoint`), so "Email me this receipt" has one to
  send. The button opens an Email field above itself and the same button sends; then "Sent to …".
- **The sticker receipt** shows Cash as what was handed over and Change under it, a card by its name,
  and Clear as Clear. "Next time, pay with Clear…" shows only when Clear didn't pay it. Times are the
  phone's own: the customer is at the shop.
- **The wait list's consent line** (the reference's Open note) sits under the drawn "We'll text you"
  line: leaving a number is agreeing to the shop's texts about the table, with STOP. A party with no
  number joins without one. "5+" sends five; the host changes it if it's more.
- **The scanner knows a Point.** `pointCodeFrom` reads `…/p/A7K2` (any host, as printed or as a
  link), never four bare characters, which are a mistyped charge code far more often. A bill opens
  as a Clear charge in the pay sheet the app already has; anything else (the menu, the wait list)
  opens the Point's own page. A Point that can't be opened says why and the camera keeps scanning.
- **The pay sheet names the table** first in its head ("Table 12 · Raised by Jen · 7:42pm"). Pay now
  says what the shop pays when the server says (`paidNowBps` on the member's charge view): "From your
  Clear cash · the shop pays 1.25%. Nothing to clear later." The reference says "Clear balance"; the
  app calls it Clear cash everywhere else.
- **The receipt in Activity** is the pay sheet's Paid view, which a paid charge opens: it now carries
  the table and the lines, discount and tax. `chargeContents` reads the table from the order.
- **Table ready reaches members too.** Where a text goes (so only with the party's consent), the
  `Texter` also posts "Your table is ready" · "Mi Casa Tacos · Table 12, back patio" to the member's
  notifications, with a push: the party's own wallet if they joined from the app, else the member
  their number finds, unless that member opted out of being found. Keyed on the alert, so never twice.
- **Not drawn, built from the nearest drawing:** the joined wait-list page (the Paid page's tick and
  "You're on the list."), the Email field, a code that finds nothing (one muted line), and errors
  (a line under the buttons).
- **Previews.** `?preview=1` on `/p/A7K2` (`&view=menu|bill|paid|pay_here`), `/p/D00R` and
  `/r/<code>` shows the reference's dinner without a Point; the pay sheet preview takes
  `&shop=micasa` for Table 12. Both are dev only and absent from the build.

## Terminal Phase 6: native (2026-10-15)

- **One Bluetooth layer.** `src/hardware/ble/central.ts` wraps `@capacitor-community/bluetooth-le`
  8.3 (Capacitor 8, with a Swift package), which is the platform's Bluetooth in the app and Web
  Bluetooth in Chrome. The drawer, Points and Bluetooth printers all go through it; the fakes
  implement the same interface in memory (`hardware/fakes/peripheral.ts`). The separate web and
  native drawers are gone.
- **The drawer is paired on Test open.** Add a device › Cash drawer's Test open adds the drawer,
  fetches its key and writes the pairing message (its Clear id, the key, the time, which sets its
  clock), then opens it signed. Done adds nothing more. A drawer takes a key once; one keyed already
  refuses the write, and the tablet says to hold its button for ten seconds to reset it (the reset is
  the firmware's, Phase 7).
- **Signed opens.** `open`, a 4-byte counter, the tablet's time in seconds, and the first 16 bytes of
  an HMAC-SHA256 over the drawer's id and those, in one write. The drawer opens when the MAC is
  right, the counter is past its last and the time is within five minutes of its clock; anything else
  does nothing, with no error. The counter is `max(last + 1, the clock in seconds)`, so a tablet that
  loses its count (reinstalled, storage cleared) is still ahead of it.
- **Where the key lives.** Fetched while online whenever the shell loads the hardware, and kept for
  this tablet's enrollment: secure storage (`@aparajita/capacitor-secure-storage`, Keychain and
  Keystore) in the app, a non-extractable key in IndexedDB in a browser, so page script can use it
  and never read it. Keys from another enrollment are dropped; a tablet removed or enrolled again
  keeps none. Signing out of a shift keeps them: the tablet is still the shop's.
- **A drawer cabled to a printer** gets ESC p from that printer (`PrinterService.kickDrawer`), the
  ESC/POS receipt printers only.
- **Points use ESP32 unified provisioning, Security 1**, so the firmware runs Espressif's component:
  X25519, the shared secret XORed with SHA-256 of the Point's code as proof of possession, then one
  AES-256-CTR stream for the session. The message field numbers are ESP-IDF's (`messages.ts`). The
  Point advertises as `CLEAR-<code>` with Clear's provisioning service; `proto-ver` also carries its
  code, firmware and battery. Two Clear endpoints, both encrypted: `clear-claim` (the setup secret and
  the API to activate with) and `clear-reach` (once joined: Clear, a sign-in page, or nothing).
- **Choosing the network.** The reference's "This tablet's network · strong" needs the tablet's own
  Wi-Fi name, which neither platform hands a web view, so a network's line is its signal ("Strong
  signal", "Good signal", "Weak signal"). Enterprise networks are listed as "Asks for a username, so a
  Point can't use it". "Has a sign-in page, so a Point can't use it" is known only after joining, so
  it's what Connect says when `clear-reach` finds one. A wrong password and a network the Point can't
  see each say so.
- **Wi-Fi printers use Clear's own plugin**, `native/socket` (`@clear/capacitor-socket`, a `file:`
  dependency): bytes to port 9100, whether a printer answers there, and printers found by Bonjour
  (`_pdl-datastream._tcp`), on iOS with the Network framework and on Android with a socket and
  NsdManager. The community TCP plugin has no Swift package, which this app's iOS project needs. iOS
  gains the local network usage string and the Bonjour service it browses.
- **Bluetooth printers** are written on the vendor service they offer (Zebra's, the common ESC/POS
  ones, Microchip's serial), in pieces the link carries.
- **Fakes, for e2e with no hardware.** `scripts/fake-point.ts` is a Point on the device API: it
  activates with the claim's secret, reports health, follows its screen by long poll or the stream,
  and presses Call or Bill, checking every answer against the contract. `scripts/fake-drawer.ts`
  speaks the drawer's messages as hex lines (and `--sign` prints the open a tablet would send). The
  API's route test runs the fake Point as its own process against the real routes. The fake Point's
  radio and the fake drawer run the tablet's own code in the merchant tests.
- **A Phase 3 bug the fake Point found.** Saving Edit tables with any table kept answered 500: kept
  tables were renumbered negative for a moment, which the 1 to 999 check refuses. They now step out
  of the number index by being marked removed inside the transaction. A test swaps two numbers.
- **Cost.** The three libraries add about 22 kB gzipped to the counter app (1.09 MB).
- **Not tried yet.** No Xcode iOS SDK or JDK on this Mac: the Swift plugin typechecks against
  stand-ins for Capacitor's types, the Java side isn't compiled, and nothing has run on an iPad, an
  Android tablet, a drawer, a Point or a printer. The provisioning messages match ESP-IDF's protos as
  written and are checked only against our fake. An M2's connect and let-go times are still to
  measure (the Pay case addendum).

## Terminal Phase 7: the firmware contract (2026-10-15)

- **Two files the firmware is built from**, `docs/hardware/point-device-api.md` and
  `docs/hardware/drawer-protocol.md`. They describe what the code already does; the contracts
  package stays the source where they differ. `apps/merchant/src/hardware/docs.test.ts` checks the
  UUIDs, endpoint names, routes, byte layouts and timings in them against the code.
- **Two parts are proposals**, marked so in the Point file, because nothing in the reference or the
  API covers them yet:
  - *When a Point can't reach Clear:* it keeps its screen; after ten minutes a bill, paid, Call or
    alert screen gives way to its last idle screen (its number and QR), a hold keeps its name until
    it expires, and nothing new is written on the screen.
  - *Firmware updates:* a signed manifest per model at a fixed URL (Ed25519, the image's SHA-256),
    installed only after 30 minutes idle and plugged in or charged enough, with ESP-IDF's rollback.
    Signing keys, hosting and releases aren't built.
- **The drawer's clock** follows the tablet: set at pairing and by every open it accepts (a signed
  time is trusted). After a power loss it's unset, and until the next open the counter alone guards
  the drawer. The fake drawer does this now, with a test.
- **A refused pairing** fails the write with ATT error `0x03`; a refused open does nothing and its
  write succeeds, so a replay looks the same as a heard command.
- **The drawer's shut is logged.** The tablet now sends a `shut` drawer event when the drawer says
  it was pushed shut; nothing logged it before, so Settings › Devices could only know from opens.
  Opens are logged by what opened them, never from the notification, so there's no second record.
- **The RJ12 port** takes the standard kick (pin 2 or 5 against +24 V on pin 4, at least 30 ms) with
  no key, because the cable is the trust; pin 3 is the switch back to the printer.

## Terminal: the factory's list of Points (2026-10-15)

- **`apps/api/scripts/point-codes.ts`** puts made Points into `merchant.point_keys`, so their codes
  can be claimed: `railway run -s Protocol-Contracts -e dev bun scripts/point-codes.ts add <point|point_large>
  [--dry-run] (--file <path> | <CODE> …)`. A file has a code per line (spaces or commas also
  separate; `#` starts a comment). The work is `addPointCodes` in `services/merchant/terminal/pointCodes.ts`.
- **One model a run.** `point_keys.model` (migration 0023) already holds Point or Point Large, so no
  migration: a batch of each is its own run.
- **All or nothing on the list's shape.** Every code is parsed as the contracts' `PointCode` (four
  Crockford base32 characters, upper-cased); one that isn't, and nothing is added, so a bad file is
  fixed and run again rather than half loaded.
- **A code already made is reported, never changed**: not its model, not its claim, even when the
  run names the other model (the script says "left as it is"). Running a list twice adds nothing; a
  code twice in one list goes in once and is reported. The insert is `ON CONFLICT DO NOTHING`, so
  two runs at once can't double one either.
- **A dry run** says what would be added and skipped, and writes nothing.

## Terminal: M2 timing and firmware releases (2026-10-15)

- **The M2 is timed by the app.** Every step the table reader queue takes (finding the reader,
  letting the current one go, connecting, letting go, the counter's reader back) is timed and kept on
  the tablet, the last 200 (`reader/timings.ts`). In the installed app,
  `clearReaderTimings.measure('<serial>', 10)` from the tablet's web inspector runs a series against
  one M2, charging nothing. docs/hardware/m2-timing.md has the steps and what the figures decide:
  under 10 seconds at the 90th percentile keeps the connect-on-bill design; 10 to 30 moves the
  connect earlier; over 30 rethinks it. No screen shows the figures: the reference draws none.
- **Firmware releases are built** (Phase 7's proposal, approved, with these choices):
  - *Signing:* Ed25519. The owner holds the private key, made on their own machine with
    `scripts/point-firmware.ts keygen` and kept in their password manager, never in a repo or on
    Railway. A second key is made the same way and kept offline as the backup. The firmware carries
    both public keys.
  - *The manifest:* served by the API (`GET /api/device/point/firmware`, by device key), the newest
    published release for the Point's model, rather than a fixed URL on a new domain. The server
    publishes only what verifies against `POINT_FIRMWARE_KEYS` and is newer than what's there, so a
    server that's broken into can withdraw an update but never forge one.
  - *The images:* Vercel Blob, public behind Vercel's CDN with no build, since the sites are already
    on Vercel. The manifest carries the SHA-256 and size, so the host is never trusted and can change.
  - *Contracts:* `PointFirmware`, `firmwareSigningPayload` (eight lines, fixed order) and
    `compareFirmware` (1.0.10 is newer than 1.0.9). Migration 0026 adds `merchant.firmware_releases`.
  - "Up to date" in Settings › Devices now compares with the newest release for the Point's model;
    `POINT_FIRMWARE_LATEST` is the fallback before any release is published.
  - Later, signing can move to the firmware repo's release job, behind a GitHub Actions environment
    with the owner as required reviewer.
- **The fake Point checks firmware as a Point must**: `--firmware <keys>` asks for it and verifies the
  Ed25519 signature with the public keys it's given. The API's route test runs it.
- **Add a Point scans with the camera.** Step 1 drew the reference's frame and its example code on
  every tablet; it now shows the camera behind the aim box (the counter's `CodeScanner`), reading the
  QR on the back of the Point (`useclear.org/p/A7K2`, or four letters on their own), and the line
  under it drops the example: "Or type the four letters under the code." The preview keeps the
  drawn frame and `A7K2`; `&live=1` uses the camera.
