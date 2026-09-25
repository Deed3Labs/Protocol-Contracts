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

## Adaptations: the reference doesn't draw these

- **Frames become the screen.** The tablet's 1180:820 outline and the phone's 340px outline go.
  The tablet fills the viewport with 24px padding; the phone keeps the frame's 16px, and its
  floating bar is fixed to the bottom of the screen.
- **Sheets fit a phone.** A sheet is never wider than the screen minus the scrim's padding.
- **Sign-in on a phone**: the frame takes the phone's 16px sides so six code boxes fit, and "Who's
  on the counter?" goes two by two instead of four across.
- **A long flow-header title trims** with an ellipsis instead of pushing the shift pill off a phone.
- **Theme is pinned to light** until the Dusk and Dark pass, which comes after every screen is
  converted. The profile sheet still stores the choice.
