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
