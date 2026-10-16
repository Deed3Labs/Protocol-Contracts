# Decisions taken over the rewards spec

`clear-rewards-app.html` in this folder is the spec. Where it conflicts with the code, with
`docs/merchant-reference/DECISIONS.md` or with arithmetic, the decision is recorded here, a section
per phase. The Phase 1 findings behind them are in `HARD-STOP-1.md`.

## Phase 1 · Explore

Decided 2026-10-15 at Hard Stop 1. Every proposal in the report was approved.

### Figures

| Where | The spec says | Use | Why |
|---|---|---|---|
| §3 caption, §9 New charge: the bill without the reward | $17.34, tax $1.34 | **$17.33, tax $1.33** | The API taxes each line and rounds half up: 8.375% of $9.00, $3.50 and $3.50 is 0.75 + 0.29 + 0.29. |
| §3, §9: the bill with the reward | $13.55, tax $1.05 | **$13.55, tax $1.05**, as drawn | The reward is the order's discount, spread across the lines like any other (`allocate`), so the lines are $7.03, $2.73 and $2.74, and their tax is 0.59 + 0.23 + 0.23. Taking the $3.50 off the Jamaica line alone would give $1.04. |
| Mi Casa's tax rate | 8.375% | **8.375%**, in every Mi Casa mock | Every rewards frame and the terminal reference's Add items draw 8.375%. It replaces the 8.32% set from Table 12 (merchant DECISIONS, Terminal); Table 12 is recomputed when Phase 5 moves the merchant mock. |

### Copy

- **Neutral pronouns**, as in the merchant app, because the app never knows a customer's.
  - "Ask him to join" becomes "Ask them to join".
  - "Approves on her/his phone" becomes "Approves on their phone".
  - "75 of her 128 points" becomes "75 of their 128 points".
  - "If he joins before he pays" becomes "If they join before they pay".
  - "Sent to her Clear app, text and email" becomes "Sent to their Clear app, text and email".
  - "Approving on her phone, …" becomes "Approving on their phone, …".
  - Names stay as drawn ("How is Sofia paying?", "Sent to Sofia's phone now").
- **Apple appears among the sign-in methods only when the Clear app shows it** (`APPLE_SIGN_IN_READY`
  in `apps/member`), so rewards never offers a method that Clear doesn't.

### Hosts

- **The apex is the marketing site, not `apps/member`.** `useclear.org` redirects to `www.useclear.org`,
  which is `clearpath-website` (Next). That repo's `next.config.ts` gets the external rewrites for
  `/s/*` (to the rewards deployment), and for `/p/*` and `/r/*` (to member's phone pages), as its own
  PR there. `apps/member/vercel.json` is unchanged.
- **One slug per shop.** `shop_apps.slug` is the shop's slug everywhere. Member's existing counter
  sign-up at `app.useclear.org/s/<slug>` uses it instead of a slug derived from the name.
- **The network comes from the build, not the hostname.** Member chooses mainnet only on
  `app.useclear.org`. Rewards reads `VITE_CLEAR_NETWORK`.

### Identity and access

- **A rewards-only person has no member row.** Rewards keeps its own `rewards.people` (Privy DID,
  smart wallet, first name, phone hash, and the member's auth subject once there is one). So joining a
  shop never touches the Clear app's onboarding state, and `requireMemberCapability` keeps answering
  "Complete account onboarding before using this feature" until they set up Clear.
- **`canPayWithClear` is a new member capability.** It is true once onboarding is submitted and the
  member isn't restricted. Paying from a balance and adding money check it; over time also needs a
  credit line, as today.
- **No duplicate accounts:** Privy's SMS login with `disableSignup`. A number on no Privy user fails
  with `user_does_not_exist` and creates nothing; that is when Already have Clear? is asked.
  - Yes: they sign in their usual way, then `linkPhone`.
  - No: the same login without `disableSignup`.
  - The Privy spike (below) checks the order in which Privy answers.
- **Phones are hashed as E.164.** Member's phone hash strips spaces only; rewards normalises first.
- **A session that sees one shop is our own token**, minted from a Privy session by
  `POST /api/s/:slug/session` and carrying `{sub, did, wallet, shop}`. A hub token carries
  `{…, hub: true}` and can only list shops and mint shop tokens. Routes opt in to these tokens; every
  other route refuses them with 403 `shop_scope`.
- **The member's code gains a signed part for attaching.** The rewards app's Show my code and the Send
  page's code become `/send?to=<wallet>&id=<code>`, where `id` is minted by the API and good for two
  minutes. Attaching someone to an order needs the `id`, because a wallet address is public. A bare
  address still sends a Clear request, as now.

### Merchant app

- **Shop app is the one Settings pane that managers and counter staff see**, besides You. Managers and
  owners edit it; the counter views it. Every other pane stays owners-only, as decided in the merchant
  app.
- **For a rewards-only customer at Checkout** (`canPayWithClear` false), the Clear tile keeps today's
  sub-line and code flow, rather than "Sent to … phone now".

### Shared code

- **`packages/member-kit`** holds what member and rewards both draw: onboarding's steps and submit
  chain (with a return address), the pay sheet, and the Clear tokens and component CSS. It is
  extracted from member as its own PR before rewards uses it, so `scripts/vercel-ignore.sh` sees
  rewards' dependency on it.
- **`packages/tokens` keeps its old palette until merchant is checked against Clear's.** Clear's tokens
  go into the package as `clear.css`.

### Not drawn, needed

- `GET /api/s/:slug/activity`, for You › Activity here.
- `POST /api/s/:slug/session`.
- The confirm page for a number typed at the counter.
- Web Push per origin: each rewards origin registers its own subscription, and a notification's link
  opens the app it was registered from.
- Directory distance: shops with an enabled app are geocoded once, when their address is saved. The
  browser's location is asked for and never stored.
- The store build is scaffolded only. This Mac has no Xcode or Android SDK.

## Phase 1 · The Privy spike

Checked 2026-10-15 against Privy's live API (dev app), with a fictional 555-01xx number and a wrong
code, so no text reached anyone.

- **Privy checks the code before it answers whether a number has an account.** `passwordless_sms/init`
  says `success` for any number, and `authenticate` in `no-signup` mode with a wrong code answers
  `invalid_credentials`, not `user_does_not_exist`. So Already have Clear? can rest on Privy's own
  `disableSignup`, and our own one-time code isn't needed.
- **Whether a code can be reused for signup after `user_does_not_exist` is unproven.** It needs a real
  code. The sign-in tries the same code once more without `disableSignup`; if Privy refuses it, it
  sends one more code ("We've sent you a new code").
- **Cookie sessions still give the API a token.** In the SDK (`@privy-io/js-sdk-core` 0.72.1),
  `getAccessToken()` refreshes through the server cookie when local storage is empty, and the refresh
  answer carries the token, which is then stored. To confirm live once `useclear.org` is verified in
  Privy's Domains tab (a dashboard step and a DNS record, for the user).

## Phase 2 · Contracts

Written 2026-10-15. `packages/merchant-contracts/src/rewards.ts`, with additions to `orders.ts`,
`catalog.ts` and `public.ts`.

- **`Order.customer` stays the free-text name it is** (call-outs, once-per-customer codes). The member
  added at the cart is a new optional field, `Order.member` (`OrderCustomer`).
- **A claim adds its member.** `OrderCustomer.addedVia` has a third value, `claim`, for an order a
  reward's counter code put someone on.
- **Rewards are their own routes**, not part of `PATCH /api/merchant/shop-app`:
  `POST /shop-app/rewards`, `PATCH /shop-app/rewards/:id` and `DELETE /shop-app/rewards/:id`. The
  PATCH covers the app's look, offers and rules; new rules make a new version.
- **The rules are worked out in one place.** `earnPoints`, `refundPoints`, `giveBack`, `earnLabels`
  and `brandContrast` live in the contracts, beside `clearCardFee`. That way the ledger, the shop's
  give-back line and the app's "earns 12 points" can't disagree.
- **Paying with Clear is one candidate for the biggest multiplier**, beside the boosts, never on top
  of them ("Double Tuesday and 2× with Clear never stack into 4×"). On a split sale it counts on the
  Clear part only.
- **Boosts go up in halves, from 1.5× to 5×.** A category boost lifts only that category's lines.
  Hours are the shop's own time, from inclusive to exclusive.
- **Visits:** one stamp for a visit that pays at least the minimum, at most once a day. `cardSize` is
  new ("6 of 10 stamps"). A boost or the Clear multiplier gives whole stamps (2× is 2; 1.5× is 1).
- **The refund rule** takes back what was earned on the refunded part, in proportion, rounded half up.
- **Colour checks:** what reads on the shop's colour must be at 4.5:1, and the colour on its paper at
  3:1. Terracotta on its paper is 4.17:1, which the drawing uses for headings. Olive isn't drawn: it's
  `#55612B` on `#ECEEE0`.
- **The counter's view is strict.** `CounterCustomer` and its parts are `strictObject`s, so a balance
  or another shop's figures fail to parse instead of reaching the tablet.
- **Discount codes gain more than the prompt lists.** Besides `showInApp` and `audience`, they gain
  `offer { title, detail }` and `days`. Offers read "Taco Tuesday · Two tacos for $7 … · Tue", and a
  code has neither a title nor weekdays today. All four are optional, so existing codes parse.
- **Clear to the added customer is `SendClearCharge { to: 'customer' }`.** The API sends to the
  order's member through the existing path. Until Phase 3 the API and the merchant mock refuse it, and
  they refuse the reward and claim discount kinds too.
- **Not in the prompt's list but needed by the drawings:**
  - `POST /api/s/:slug/session` and `POST /api/rewards/session`, for the scoped tokens;
  - `GET`, `POST` and `DELETE /api/rewards/me`, for the person;
  - `POST /api/rewards/me/code`, for the signed identity code;
  - `GET /api/s/:slug/bill/:point`, `GET /api/s/:slug/paid/:orderId` and `GET /api/s/:slug/activity`;
  - `PATCH /api/s/:slug/membership`, for texts and birthday;
  - `GET /api/merchant/orders/:id/customer`, polled while a phone confirms;
  - `GET` and `POST /api/rewards/confirm/:token`, the customer's side of that.
- **`MerchantRewardsApi` stays a separate interface until Phase 5.** It joins `MerchantApi` then,
  because adding it now would break the merchant mock before it implements it.

Approved at Hard Stop 2, 2026-10-16:

- **Mi Casa's extra for paying with Clear is Off** in every seed, so section 3 holds: 12 points
  earned, 65 left. Settings › Shop app shows Off there, and the give-back line has no "or … paying
  with Clear" part (`giveBack` returns null for the Clear figures).
- **A reward goes on a bill from a Point**, where nothing has been paid yet. A counter charge's code
  is a payment already started, so its order can't take a discount: the reward is applied at the
  counter, from the member sheet or a claimed code, before Checkout.
- **A full refund gives back the points a reward used**, as a `refund` entry beside the reversal of
  what was earned. A partial refund reverses only what was earned on the refunded part.

## Phase 3 · API

Written 2026-10-16. Migration `0029_rewards.sql`; services in `apps/api/src/services/merchant/rewards/`;
routes in `apps/api/src/routes/rewards.ts`.

### Where it lives

- **The merchant database.** The `rewards` schema sits beside `commerce` and `payments`, because
  points ride on orders and are written in the same transaction as the sale. People link to Clear's
  member records (main database) by value: their Privy DID, and the member's auth subject.
- **Table names as the prompt gives them, plus four more.**
  - `rewards.people`: rewards-only people have no member row.
  - `rewards.counter_confirms`: a number typed at the counter.
  - `rewards.processed_events`: a paid event, once.
  - `rewards.loyalty_memberships.ref_code`: Bring a friend.
  - Orders gain `member_person` and how they were added; order discounts gain `reward_id`,
    `reward_points` and `claim_id`, and a reward's `applied_by` can be empty.
- **The ledger refuses updates** (`payments.refuse_change`). Rows are deleted only when someone leaves
  a shop or deletes their rewards account: the spec makes leaving erase the points and the consent.

### Earning

- **Inline, in `settleOrder`**, at the same transition that writes `order.paid`, so the Paid screen
  already shows the new total.
  - It runs inside a savepoint. If the rewards step throws, the sale stands and a `rewards.retry`
    outbox event runs the same step again.
  - A shop with no app skips it with one lookup.
- **Idempotency:**
  - A paid event is keyed `earn:<order>:<attempt>` (the sale's attempt number) and recorded in
    `processed_events`, so a repeat moves nothing, not even the keep-the-change leftover.
  - A void reverses each earn and redeem entry once (`void:<entry>`).
  - An order paid again after a void earns again under its new attempt.
- **Who earns:** the person on the order, if they've joined the shop.
  - A Clear charge approved by someone nobody added puts its payer on the order, through the new
    optional `ClearCharges.payer`.
  - Someone who hasn't joined earns nothing until they join with that order (`creditOrderOnJoin`,
    the same key).
- **Refunds:**
  - Card and cash refunds take back points in `announceRefund`. Clear refunds do it after
    `settleRefund` closes the plan.
  - What's taken back is worked out from everything refunded so far, against the order's total.
    Refunded cents include any tip, so a partly refunded tipped order gives back slightly more points
    than its goods alone would.
  - Everything refunded also returns the reward's points (Hard Stop 2).
- **Points can't be spent twice.** A reward on an open order holds its points, so a second order or a
  claim can't spend them too.
- **Birthday:** a `bonus_birthday` entry worth the birthday reward's points, marked with the reward,
  once a year on the first of their month (UTC).
- **Expiry** counts each entry against the rules version that earned it, from the last visit. A visit
  that earned nothing still counts as a visit. The jobs run every six hours (`jobs/rewardsJobs.ts`).

### Rewards on an order

- **An item reward is one of its items: the dearest on the order, options included, up to its cap.**
  A tie goes to the item the reward lists first, which is why section 9 reads "matches 1 × Jamaica"
  with Jamaica listed before Horchata.
- **It comes off as an amount, spread across the order's lines** like any discount. If the cart
  changes, it's worked out again from the cart.
- **A claim:** a counter code is a `DiscountRequest` `claim`. It adds its person when nobody is on the
  order, and refuses if someone else is. Removing the discount makes the code good again until it
  runs out.
- **From a Point's bill:** `POST /api/p/:code/pay` with a shop's token puts the customer on the order,
  and the reward when they switched it on. With no token, a `rewardId` is refused.

### Identity and tokens

- **Tokens are ours, HMAC-signed**, under `REWARDS_TOKEN_SECRET`. Production needs it set; elsewhere a
  per-process secret is used.
  - They last 12 hours and carry the DID, wallet, phone, email and scope.
  - `requireAuth` takes only Privy tokens, so a rewards token opens no member route.
  - A shop's token is refused by every other shop's route (403 `scope`).
- **The hub's token** lists shops, reads and writes the person, and mints shop tokens without going
  back to Privy.
- **A person is found by DID, then by wallet.** The wallet case is a Clear member first seen at a
  counter, whose row was made from their member subject. A Clear member never sees Welcome: their row
  is made from their Clear name.
- **The signed identity code** is `<rewards url>/send?to=<wallet>&id=<exp>.<sig>`, good for two
  minutes. Adding someone by code needs it; a bare wallet is refused. The merchant tablet's parser
  already accepts any origin.
- **`canPayOverTime` is `canPayWithClear` for now.** Whether there's credit is the pay sheet's
  existing check, as in the Clear app.

### The counter

- **Clear to the added customer:** `SendClearCharge { to: 'customer' }` finds the order's person's
  wallet and uses the existing send. The tablet's line is "their Clear app, text and email".
- **`notifyMember` now sends the text and the email** when a member has both. It used to send one or
  the other. The spec draws all three reaching her at once.
- **A typed-in number** gets a ten-minute link by text, and the answer is `pending` either way.
  Confirming needs the link and a signed-in person whose own number it is, so a forwarded link can't
  add someone else.

### Routes, against section 11

- **As listed:** `GET /api/s/:slug`, `…/manifest.webmanifest`, `POST …/join`,
  `DELETE …/membership`, `GET …/me`, `POST …/rewards/:id/claim`, `GET /api/rewards/me/shops`,
  `GET /api/partners?near=`, `POST /api/p/:code/pay` (now with `rewardId`),
  `GET`/`PATCH /api/merchant/shop-app`, `POST …/fonts`, `POST …/domain`,
  `POST`/`DELETE /api/merchant/orders/:id/customer`, `POST …/customer/invite` and
  `GET …/shop-app/give-back`.
- **Added:**
  - the Phase 2 list: sessions, person, code, bill, paid, activity, membership PATCH, customer GET,
    confirm;
  - `GET /api/s/:slug/fonts/:id.woff2`;
  - `POST /api/merchant/shop-app/give-back`, for rules not yet saved;
  - rewards as their own routes: `POST`, `PATCH` and `DELETE /shop-app/rewards(/:id)`. Changing a
    reward retires the old one, so past orders keep what they used.
- **A font upload is the file as the request body** (1 MB at most), with its name, use and licence
  declaration in the query. The API has no multipart parser, and one file didn't seem worth adding
  one. Fonts are kept in the database as WOFF2 (`fontkit` 2.0.4 reads them; `wawoff2` 2.0.1
  converts).
  - **Legibility at 14px:** an x-height of at least 5.5px, and an average width of at least 0.35em.
- **Not finished, for later phases:**
  - The manifest's icons are the logo as uploaded; resizing is Phase 4.
  - `POST /shop-app/domain` records the domain and its DNS record; Vercel and the check are Phase 7.
  - The directory's distance is null until a shop has coordinates; geocoding is Phase 4's seed.
  - The merchant mock still refuses reward discounts until Phase 5.

### A contract change, for approval

`OrderCustomer.addedBy` is now nullable, and `addedVia` gains `'app'`, for a customer who put
themselves on an order from their app, or a Clear payer nobody added. The Phase 2 contract had a
staff id there always.

### Found on the way, not changed

- **`/api/transactions` is public by address**, as it was before this work. A shop's token can't read
  a member's activity through any authenticated route, but on-chain history is public anyway.
- **`apps/api/package-lock.json` was already behind `package.json`** (PGlite, the contracts package,
  zod 4). Only `bun.lock`, which the image installs from, was updated.

Approved at Hard Stop 3, 2026-10-16: Phase 3 as built, and the `OrderCustomer` change (`addedBy`
nullable, `addedVia` gains `'app'`). `/api/transactions` stays public for now.

## Phase 4 · `apps/rewards`

Built 2026-10-16. `packages/member-kit` was extracted first, on its own branch `feat/member-kit`
(merged into `feat/rewards`), so it can be its own PR.

### What the Clear app shares

- **`packages/member-kit`** holds:
  - Clear's tokens and component CSS;
  - the anatomy and icons;
  - AuthShell (with an unlinked lockup in place of member's router-linked Wordmark) and PinBox;
  - the onboarding steps, the bank-link step, and the onboarding submit chain (`submitClearOnboarding`);
  - the pay-a-shop call builder (`payShopCalls`).
- **`apps/member` keeps one-line re-exports at the old paths**, imports the CSS from the package, and
  adds the package to Tailwind's sources.
  - Its built CSS is byte-identical to dev's, for both entries.
  - Its tests that read these files as text now read them in the package.
  - Its counter sign-up keeps its own copy of the submit chain, which its tests check line by line.

### The app

- **Styles are generated** (`scripts/reference-css.mjs`) from the spec's own stylesheet: the rules
  whose classes all appear in a phone frame, in the spec's order, without dark mode or exact repeats.
  `app.css` holds every decision over them:
  - a phone frame is the screen, full width, phone-width on a desktop;
  - no fake status bar;
  - real inputs, links and switches;
  - sheets over a scrim, square;
  - the shop's text font, with Clear's parts in Clear's.
- **Scope from the address:** `/s/:slug` is one shop and has no switcher; anything else is the hub,
  and a shop inside it is `/shops/:slug`, with the name as the switcher and Shops lit in the bar.
- **The network comes from `VITE_CLEAR_NETWORK`**, never the hostname.
- **A shop's install** (Phase 1's answer, corrected):
  - The manifest, `apple-touch-icon`, title and theme colour are set from the shop's config when the
    page loads.
  - Chrome and Safari read them when the page is added to a home screen, which is after that has
    run, so a script is enough; no server-rendered head is needed.
  - The manifest is served on the page's own origin by a Vercel edge function
    (`apps/rewards/api/manifest.ts`, `REWARDS_API_URL`), because a manifest from another host
    can't start an app on this one.
- **Sign-in is Privy's SMS login with signups off** (`PrivyAuth.tsx`).
  - A number on no account answers `user_does_not_exist` after its code, which is when Already have
    Clear? appears.
  - Yes: they sign in their usual way, then `linkPhone`.
  - No: the same code is tried again with signups on. If Privy refuses it, a new code is sent.
  - Email opens Privy's own email sign-in; Google and Apple are its OAuth. Apple shows only with
    `VITE_APPLE_SIGN_IN=on`, as in the Clear app.
- **Paying from the balance** is the Clear app's three steps (hold, pay from the smart wallet,
  confirm), with the same calls and the shared `payShopCalls`. **Over time** is 4 payments until a
  split choice is drawn.
- **Set up Clear** runs the Clear app's onboarding steps from the ZIP step and submits with
  `referralSource: 'rewards'`, then returns to the screen it started from.
- **The preview** (`?preview=1`, dev only, `&as=sofia|marco|new|out`) runs on a seeded mock. Privy
  isn't loaded at all. `/_frames?preview=1` shows every frame. `public/_ref/cmp.html` (git-ignored)
  shows spec beside app, with a per-text style and position diff.

### Over the drawings

- **No status bar.** The spec's `9:41` is the phone's own, so the app doesn't draw one.
- **One wording per offer.** The Rewards tab and Marco's Home draw shorter offer lines ("Two tacos
  for $7", "Catering over $60") than Home does. A discount code has one detail line, so every screen
  shows it.
- **Home's rewards block lists what's ready, then what's next, two rows at most, in the Rewards
  tab's order.**
  - Marco's Home shows Free churros under the agua fresca; the drawing has only the agua fresca.
  - La Bonita lists Free coffee (Ready) before Box of pan dulce; the drawing has them the other way.
  - Marco's Home shows both offers, as its count of 2 says.
- **A shop's everyday name is derived:** a three-word name drops its last word ("Mi Casa", "La
  Bonita"), and a two-word name stays whole ("Mike’s Tire", "Peña Coffee"). That's until shops can
  set one.
- **"340 points · 160 to a free tire rotation".** The next reward's own name; the drawing shortens it
  to "a free rotation".
- **The join pitch** is the shop's: the API writes "A point for every dollar, and a free agua fresca
  at 75." The drawings word Peña's differently ("A point for every $1, a free drink at 60."), and the
  preview keeps each as drawn.
- **Paid somewhere new** keeps the hub's top bar and Clear's look, because the shop's look starts
  after joining.
- **Not drawn, built from the nearest drawing:**
  - Show my code: the claim layout, with the person's name;
  - Activity here;
  - a card-only bill for someone without Clear ("Pay $17.33 by card");
  - the one-tap Join for a signed-in person on a shop's link.

### Contract and API additions, for approval

- **`PublicPoint.shop.slug`** (optional): a Point's public view names its shop's app, so the hub's
  scanner opens the bill inside the right shop. It's set only when the shop's app is on.
- **`MyShops` and `Partners` tiles carry `brand.headingFont`** (plus an optional `fonts` map), so a
  shop's tile in a list wears its own type, as drawn.
- **The Clear charge view gains `orderId` and `reward`** (`chargeContents`), so the approve sheet
  says "Applied at the counter · 75 points" and opens the order's Paid screen. That's an addition to
  an existing response, with no new route.

### Not done in this phase

- **The bank-link step of Set up Clear.** The spec's sheet lists "Confirm it's you" and "Link your
  bank", but the Clear app defers both to the first deposit, so the shared steps do too.
- **Live mode is built and type-checked, not run end to end.** The API branch isn't deployed, and the
  preview covers every frame.
- **Logo icons at 192 and 512, geocoding for Near you, Web Push per origin.**

Approved at Hard Stop 4, 2026-10-16: Phase 4 as built, the three additions (`PublicPoint.shop.slug`,
the hub tiles' heading font, the Clear charge view's `reward` and `orderId`), and the differences
recorded above.

## Phase 5 · The merchant app

`MerchantApi` now extends `MerchantRewardsApi`. The real client calls the rewards routes. The mock
(`apps/merchant/src/data/merchantApi/rewardsMock.ts`) answers them from Mi Casa's Shop app as section 8
draws it, and three people stand at the counter:

- Sofia M.: a Clear member with 128 points;
- Dev L.: a Clear member who hasn't joined;
- Marco A.: rewards only, with 42 points.

Matching a reward to the cart and what an order earns follow the server's rules (`counter.ts`,
`ledger.ts`), so the cart reads what the API will.

### Figures

- **Mi Casa's mock tax is 8.375%**, as decided at Phase 1. That gives:
  - Table 12: $3.73 tax, $48.23 (the terminal reference draws $3.70 and $48.20);
  - order 0142: $3.54 tax, $45.79, $4.21 change from $50.00;
  - Table 2: $35.76, as drawn.

  The terminal tests, the state notes and the card sheet's preview amount follow.
- **A live cart is taxed line by line at the shop's rates**, rounded half up, as the server does it.
  So the cart reads $17.33 and tax $1.33 (§9 draws $17.34 and $1.34).
  - A cart of food and drinks shows the tax line alone: "Sales tax · 8.375%".
  - A cart with parts or labour keeps its rows; the rate in the label is the shop's.
- **With a customer on the order, the cart's figures are the server's**: the reward line, the tax,
  "Earns 12 points". The order follows the cart after each change, so an item reward follows the
  cart.
- **The rewards preview had Table 6 without the reward earning 17.** It earns 16: points count
  $16.00 before tax. Fixed, with a test.

### Settings › Shop app

- **Its own section, beside Devices** (`settings/shopApp.tsx`). It is in the rail between Discounts
  and Devices.
  - Managers and the counter see two items, Shop app and You.
  - Owners and managers change it; the counter sees it as it is.
  - Every change saves as it's made.
- **The rows are worded by rules** (`settings/shopAppModel.ts`, tested against every drawn row):
  - A long item list reads as its note: "Item · any plate up to $14".
  - A short one names the items: "Item · Jamaica or Horchata, any size".
  - An offer named for its day reads as its deal ("TACOTUE · Two tacos for $7"); one named for its
    deal reads as its name ("TRAY10 · 10% off a tray").
  - A code with no days or end date shows its detail ("Staff only").
- **Mi Casa's codes are seeded.** TACOTUE (Tuesdays) and TRAY10 (ends Oct 31) are shown in the app;
  STAFF20 is not.
- **Mi Casa's taco plate has the note "any plate up to $14".** The rewards app would show
  "300 points · any plate up to $14"; the rewards preview's own seed still draws "300 points".
- **Your own domain's row suggests `rewards.<the shop's email domain>`** until a domain is set; then
  it reads "Manage".
- **Casa Display has no file behind it in the mock.** The preview falls back to the serif, as the
  drawing does.
- **Add a reward's item chips are Mi Casa's own drinks**: Jamaica, Horchata, Mexican Coke. The menu
  has no Tamarindo.
- **Built where nothing is drawn:**
  - Turn on, for a shop whose app is off;
  - Custom colour (four colours, contrast-checked);
  - Call them › Custom (one and many);
  - Logo (an image address, until there's an upload);
  - Add a boost;
  - Preview an order;
  - a printable 4 × 6 join card;
  - editing or removing a reward by tapping its row.
- **The store app's Start opens an email to Clear.** Nothing is submitted from the app (Phase 7).
- **Settings › Discounts:** a tap on a code opens a sheet with Show in app and Who sees it (Everyone,
  Members, Clear members). The row adds "· in the app" when it's on. The rows are otherwise as the
  merchant reference draws them, which section 8 leaves unchanged.

### At the counter

- **The Customer line shows only on the live path, and only where the shop's app is on.** The
  merchant reference's own preview frames don't change.
- **Adding someone puts the cart on the server as an order** (or brings it up to date).
- **The member sheet adds them as soon as their code is read.** Add to charge keeps them; closing
  the sheet takes them off, their reward first.
- **A number waits on their phone.** The line says "Texted (909) 555-0123 a link"; the tablet asks
  again every 3 seconds and opens the member sheet once they confirm.
- **The cart has the reward line.** When nothing is applied, it offers the first ready reward that
  fits, with Apply; once applied, it shows Undo.
- **Checkout keeps the merchant reference's rows** (discount, tip, Show on, tax). The reward sits
  where a code would, and its × undoes it. Section 9 adds:
  - the member at the top;
  - "Free agua fresca applied · earns 12 points";
  - the foot "Card or cash: points land on Sofia's account when it's paid.";
  - "How is Sofia paying?";
  - the Clear tile's "Sent to Sofia's phone now. Nothing to scan".
- **Clear, for a member who can pay with it, goes straight to them** (`sendClearCharge({ to:
  'customer' })`). The waiting screen then shows:
  - "Table 6 · raised by Jen R.";
  - "Sent to their Clear app, text and email";
  - "Approving on their phone, with the agua fresca already off";
  - Text, Email and App under "All three at once";
  - the keyline, in neutral pronouns.

  Its steps are the live screen's own (Raised, Opened, Approved), not the drawn four.
- **"New charge · Table 6"** is a new charge opened for a table (`&table=`).
- **The frames are reachable in development:**
  - `/new?preview=1&live=1&shop=micasa&as=jen&table=tbl_6&rw=cart|scan|pending|sofia|dev|applied|checkout|waiting`;
  - `/settings/shop-app?preview=1&shop=micasa&screen=shop-app-domain|store|reward|font`.

  `e2e/states.ts` pairs each with its frame in the merchant reference report.

### Contract and API additions, for approval

- **`PATCH /api/merchant/shop-app/offers/:codeId`** (`OfferPatch`: `showInApp`, `audience`;
  `MerchantRewardsApi.updateOffer`) sets Settings › Discounts' switch and audience.
  - On puts the code last in `offerCodeIds`; off takes it out.
  - The catalogue now reads and writes a code's `showInApp`, `audience`, `offer` and `days`, which
    Phase 3 had added to the table but not to its reads and writes.
- **`POST /api/merchant/shop-app/domain/check`** (`checkDomain`, already in the contract): stamps
  `checkedAt` and returns the record. Asking Vercel is Phase 7.

### Checks

- API: 947 pass. Merchant: 201 unit tests. Member: 779. Rewards: 5. Contracts: 71.
- Builds: merchant, member and rewards, on Node 22.
- Axe passes on all 12 rewards states. Roles, Settings and New charge e2e pass, apart from failures
  that are on `dev` too: Tables' axe checks and Devices "this tablet, renamed".
- The contract conformance run (`apps/api/e2e/contract.ts`) has the new methods but needs a
  Postgres, which this machine doesn't have, so it hasn't been run.

Approved at Hard Stop 5, 2026-10-16: Phase 5 as built, the offers and domain-check additions
(`PATCH /api/merchant/shop-app/offers/:codeId`, `POST /api/merchant/shop-app/domain/check`), and the
differences recorded above.

## Phase 6 · The Clear app, and the apex

### The apex: clearpath-website, branch `feat/apex-rewrites`

As Phase 1 found, `useclear.org` is the marketing site, so the rewrite is there, not in
`apps/member/vercel.json`.

- **Its `next.config.ts` rewrites four kinds of path to Clear's apps:**
  - `/s/*` to the rewards deployment, with its files under `/_rw/*`;
  - `/p/*` and `/r/*` to the Clear app's phone pages, with their files under `/assets/*`.
  - `REWARDS_ORIGIN` and `CLEAR_APP_ORIGIN` override the hosts (rewards.useclear.org,
    app.useclear.org).
- **This fixes a live break as well.** Today `useclear.org/p/A7K2`, the link printed on a Point,
  redirects to www and answers 404, and `/s/<shop>` would too.
- **The rewards build puts its files under `/_rw`** (`assetsDir`), not `/assets`, because the Clear
  app's phone pages use `/assets` behind the same domain. The cache header follows.
- **The rewrites run after the site's own pages and files.** None of them shadows anything: the site
  has no `/s`, `/p`, `/r` or `/_rw`, and its `public/assets/logo.png` is still served.
- **Checked locally:** the built site (`next start`) was run against the built rewards app.
  - `/s/micasa` and its `/_rw` scripts came through, and the app booted until Privy, because the
    local build has no app id.
  - `/p/A7K2` and its `/assets` script came through from app.useclear.org.
  - The site's own pages answered as before.
- **Not confirmed live: that the apex serves a shop and that sign-in carries over.** The rewards
  deployment doesn't exist yet. Sign-in carrying over rests on Privy's cookie sessions for the
  verified `useclear.org` domain (the Phase 1 spike). It needs, from you:
  - the Privy Domains step, adding `www.useclear.org` and `rewards.useclear.org` beside
    app.useclear.org;
  - the rewards Vercel project.
- **The branch is pushed; there's no PR yet.** The rewards prompt asks for none until asked; the site
  usually merges through PRs.
- **The live app.useclear.org serves its main page at `/p/`**, so production is on an older build
  than `dev`. That's outside this change.

### Your shops

- **On Home, as its own full-width cell under the grid**, shown once they've joined a shop, in both
  the day-one and the furnished layout. The grid's pairs of cells stay paired. The section 6 frame
  draws the list on a screen of its own; Home is where a list of the member's places fits without a
  new tab.
- **The rows match the hub's tiles** (`lib/yourShops.ts`, the same rule as apps/rewards
  `shopLine`):
  - "128 points";
  - "340 points · 160 to a free tire rotation" (the reward's own name; the drawing shortens it);
  - "6 of 10 stamps".

  Each tile wears its shop's colour and heading type; the Ready chip is Clear's ink, as drawn.
- **A row is a link to `rewards.useclear.org/shops/<slug>`** (`VITE_REWARDS_URL` overrides it). No
  rewards screen is drawn in the Clear app.
- **The data:** a hub session minted from the member's own Privy sign-in (`POST /api/rewards/session`),
  then `GET /api/rewards/me/shops`. These are plain fetches, so a refusal there can never sign the
  member out. The member app mirrors the response types rather than depending on the contracts
  package (it hasn't so far, and that keeps its builds from following contract changes).
- **Preview:** `/your-shops?preview=1` (the three shops section 6 draws, on a furnished Home).

### History after onboarding

- **`GET /api/rewards/purchases`** (Privy sign-in; answers only once onboarding is submitted, else 403
  "Complete account onboarding before using this feature") lists a member's card purchases at Clear
  shops.
  - It takes them from every rewards identity that is theirs: the same Privy account, or the person
    onboarding linked by `member_subject`.
  - So what they bought as a rewards-only customer shows once they've set up Clear.
- **Card only.** Clear payments are already in Activity from the chain. Cash is left out because
  Activity's "Cash" means the Clear balance, and a shop's cash sale would read as spending from it.
  A split shows its card part.
- **In Activity they're marked as card:** a new source, `card` ("Card"), with "Card ••4242" as how
  it was paid. Home's recent activity lists them too.
- **A sale on the member's own Clear card isn't listed twice.** The card feed already has it, so a
  shop purchase is folded into a card row with the same amount within 15 minutes. The feed carries no
  last four, so the amount and time are what match; `cardLast4` is in the response for when it does.

### Contract and API additions, for approval

- `MemberShopPurchases` and `GET /api/rewards/purchases`, as above.
- `RewardsDeps.onboarded`, the onboarding check the route uses (member store; tests stand one in).
- `resolveMemberAuthSubject` is exported from `memberCapabilities.ts` for it.

### Checks

- Tests: API 949, member 783, merchant 201, rewards 5, contracts 71.
- Builds: member and rewards on Node 22, the merchant typecheck, and the site's `next build`.
