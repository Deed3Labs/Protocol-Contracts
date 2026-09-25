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
- **A charge's screens are fixed frames on a tablet, landscape or portrait.** The slab fills the
  screen and each cell scrolls inside it, as the reference draws them, so the pad and the primary
  button never leave the screen. The phone scrolls as a page.
- **Theme is pinned to light** until the Dusk and Dark pass, which comes after every screen is
  converted. The profile sheet still stores the choice.
