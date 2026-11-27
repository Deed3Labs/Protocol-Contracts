# Pay with Clear · Hard Stop 1

Phase 1, read only, 2026-10-16, against `dev` at `0e75b8ff`. Branch `feat/pay-with-clear`.
`clear-pay-ref.html` is in this folder. The decisions below are proposals until approved; once they are,
they move into `DECISIONS.md`.

## 1 · What exists, against the spec

### Orders and tenders

- **An online payment can be an order.** `createOrder` (`services/merchant/orders/orderService.ts:388`) prices lines on
  the server from `commerce.catalog_items`. Tax is per line, half up, at the shop's address rate or Stripe Tax
  (`tax/taxService.ts:100`). A tender goes through `checkNewTender` (`orders/tenderRules.ts:48`), and `settleOrder`
  (`orders/settle.ts:63`) writes `order.paid` and earns points in the same transaction.
- **Where it doesn't fit yet:**
  1. **No staff on an online order.** `commerce.orders.raised_by` and `payments.tenders.created_by` are NOT NULL
     references to `merchant.staff`. The phone page borrows the bill's `raised_by`; a link or website has no one to borrow.
  2. **No `source` field.** Nothing says channel or online.
  3. **Order idempotency doesn't compare the body** (`orderService.ts:398`), unlike tenders' `request_hash`. That is
     fine inside the app, but not for `POST /v1/payments`.
  4. **A pending tender reserves the remaining amount** (`tenderRules.ts:59`). An abandoned Checkout or Clear charge
     blocks the order until it expires: the Clear charge TTL is 24 hours, and the sweep runs every 20 seconds.
- **Clear tender:** `createClearTender` (`orders/payments.ts:113`) raises a `public.charge_requests` row in the
  *other* database (`chargeService.ts:257`), so there is no shared transaction.
  - The member approves at `app.useclear.org/c/<code>` (`ChargeApprovalRoute.tsx`).
  - **Over time** is `POST /api/charges/:code/approve` with step-up. The server signs `TermIssuer.openPlan`.
  - **Pay now** is hold, then the member's smart wallet sends `payShopCalls`, then confirm.
  - The answer reaches the tender by in-process event, a 20-second sweep, or the tablet polling `syncClearTender`.
    There is no durable callback.
- **Card:**
  - `createPayment` (`cards/stripeConnector.ts:201`) is card-present only: `card_present`, manual capture, a reader.
  - The only path without a reader is hosted Checkout (`createCheckoutTender`, `cardTenders.ts:268`). It has no tip,
    it completes only by Stripe webhook, and its request hash is weaker.
  - Both are direct charges on the connected account, with `application_fee_amount` = `clearCardFee` when the
    processor takes a platform fee (`processorFee`, `cardTenders.ts:157`). Otherwise the fee goes through
    `fee_billed` and `feeBilling.ts`.
  - `takingCards` is `cards/terminal.ts:24`. Only connector and Stripe-event files import `stripe`.
- **Refunds are two models.**
  - **Card and cash** (`orders/refunds.ts`): partial or whole. A manager or owner approves, and not the person who asked.
    `refund.succeeded` goes to the outbox.
  - **Clear** (`refundStore.ts`): whole charge only, approved by the owner (by code up to $500, or from their device).
    The order stays `paid` and the tender stays `approved`; only points are adjusted.
- **Outbox** (`outbox/outbox.ts`): written in the change's transaction and drained every 15 seconds, at most 12
  attempts (about 8 hours). It drops topics nobody handles. **There is no outbound webhook, signing or delivery log.**
- **Test mode is per environment.** Stripe's mode comes from the key, Bridge from `BRIDGE_ENV`, Plaid from `PLAID_ENV`.
  No shop, order or tender has `livemode`.

### The phone pay page (what links reuse)

- `POST /api/p/:code/pay` → `publicPay` (`terminal/publicPages.ts:42`). It takes `{method, idempotencyKey, rewardId?}`.
  The amount is the order's total less its live tenders, so it is never from the browser.
- **Clear** raises the counter's tender with no member and returns `app.useclear.org/c/<code>`; the member claims the
  charge when they open it.
- **Card** is hosted Checkout, which returns to `/p/:code?paid=1`.
- The payer is anonymous unless a rewards shop token comes along (`payingCustomer`, `phonePages.ts:79`).
- The page polls every 4 seconds. Rate limits are 120 reads and 10 actions a minute per IP.

### Sending a charge to a member

- `POST /api/merchant/tenders/:id/send` → `sendClearTender` (`orders/payments.ts:188`).
  - `member` (a wallet) and `customer` (the order's person) attach the charge and call `notifyMember`
    (`chargeService.ts:318`). That sends the in-app notice, Web Push, and the text and email together.
  - `phone` texts the `/c/` link.
- The merchant learns the answer by polling every 3 seconds. **This is what "Approve in the Clear app" raises from the web.**
- **`requestStore.ts` is unrelated.** It holds person-to-person money requests (`payment_requests`), and settling them
  isn't built.
- **There is no native Clear app and no deep link.** The member app is a PWA, with no universal links,
  `apple-app-site-association` or scheme. The only link is `app.useclear.org/c/<code>`. On iOS, a home-screen PWA
  doesn't capture links, so they open in Safari. Today's workaround is a code typed into Scan (`appHandoffCode`).
- **There is no return to the shop after approving.** Done goes to `/`.
- **The rewards app doesn't share the approve sheet.** Its `ApproveScreen` (`apps/rewards/src/screens/shop.tsx:425`)
  is a Pay now / Over time toggle with `installments: 4` hard-coded and no `splitsOffered`.

### Rewards

- Earning runs inline in `settleOrder` → `rewardsOn` → `onOrderPaid` (`rewards/ledger.ts:146`). It needs the order's
  person **and** their membership at the shop. The Clear multiplier counts on the Clear-paid part only, and is never
  stacked on a boost.
- `earnPoints` floors: ⌊171 × 1.5⌋ = **256**, as drawn. But `clearMultiplier` defaults to 1, and Mi Casa's seed is
  Off (conflict 1 below).
- An anonymous card payer earns nothing until they join with that order (`creditOrderOnJoin`).

### Identity

- **Everything for members is Privy plus a wallet.**
  - `requireAuth` (`middleware/auth.ts:177`) verifies a Privy token and creates a smart wallet if there isn't one.
  - `members.primary_wallet` is NOT NULL, so `bootstrapMember` needs a wallet.
  - `submitClearOnboarding` (`member-kit/onboarding/submit.ts`) calls five `/api/members` routes behind `requireAuth`.
  - The Plaid link token needs `canUsePlaid` and a wallet.
- **What can be reused without Privy:**
  - `resolveMemberByAuthInput` (`memberStore.ts:2520`) finds a member by the hash of a phone or email.
    Phones are hashed with spaces stripped only, not E.164; rewards already normalises.
  - Codes: the hashed-OTP pattern in `sendClaimService.ts` (6 digits, sha256 with a pepper, 10 minutes, 5 attempts,
    60-second resend).
  - Sending: Twilio and Resend in `sendNotificationService.ts`. `sendOtp`'s wording is claim-specific.
  - Rate limits: the Redis limiter `rateLimiter.ts`. It **fails open** if Redis errors.
  - Tokens: HMAC bearer tokens like rewards' `rws.` (`rewards/tokens.ts`). There is no JWT library.
  - Step-up: `requireStepUp` (`middleware/stepUp.ts`) takes a server-verified passkey. Its relying party is the request
    origin's apex (`useclear.org`), so a frame at `pay.useclear.org` can use the same passkey if the frame delegates
    `publickey-credentials-get`. Members with no Face ID enrolled pass.
- **`member-kit` has no Privy in it.**
  - `AuthShell`, `PinBox` (6 boxes, `one-time-code`) and `BankLinkStep` are presentational.
  - `OnboardingFlow` asks only for a ZIP (`join`) and shows the legal name read-only (`identity`). **It doesn't collect
    name, date of birth or street address.**
- **The ID check is Lithic KYC_BASIC.** The member app's `VerifyIdentityModal` asks for name, date of birth, **SSN**
  and address, then sends a document photo only on `PENDING_DOCUMENT`. The bank link is Plaid (`runPlaidLink`).
- **Who can approve:**
  - A wallet, and step-up if they're enrolled.
  - For over time, an on-chain `termLimitOf(wallet) > 0`. An operator sets it with `scripts/set_term_limit.ts`;
    a new credit line opens at zero.
  - For pay now, USDC in the wallet.
  - KYC and a bank aren't checked when approving.

### Splits

- `PAY_OVER_TIME_MIN_CENTS` = $50 (`domain/charge.ts:163`). `splitQuote` (`domain/split.ts:43`): carry is
  amount × rate × (n+1)/2.
- **The rate isn't from the member's terms.** It is 2%: `DEFAULT_RATE_BPS = 200` on the server (`chargeService.ts:55`)
  and `0.02` in the sheet. `GET /api/credit/:wallet` gives only what's available.
- **At 2% the spec's figures all hold:**

  | | Spec | Computed |
  |---|---|---|
  | In full | $189.03 | 189.026 |
  | In 2 | $95.44 | 95.440 |
  | In 4 | $48.65, carry $9.27 | 48.647; carry 9.266 |
  | In 12 | $17.45 | 17.451 |

- **The other figures hold too:**
  - The order's tax: 12.48 + 1.84 = $14.32, so the total is $185.32.
  - The link page: $149.00 + $12.48 = $161.48.
  - The dates: Oct 24 2026 is a Saturday, and today plus 7 days is Oct 23.

### Merchant app and builds

- **Settings:**
  - The rail is `SECTIONS` in `settings/panes.tsx:52`.
  - Managers and the counter get only Shop app and You (`SettingsPage.tsx:247`).
  - A pane with its own component follows the Shop app pattern (`shopAppHere`, `SettingsPage.tsx:375`).
- **New charge:**
  - `NewChargePage.tsx` with `StartTop`'s Amount/Items switch (`charge/start.tsx:39`).
  - Clear's three ways to pay are in `charge/clear.tsx`.
- **Charges** rows (`charges/model.ts`, `charges/views.tsx:185`) carry a `PayMethod` and a `pay` label, and come from
  Clear charges plus `orderHistory`.
- **Builds:**
  - `scripts/vercel-ignore.sh` **has no list of known apps**. It reads the app's `package.json` for the packages it
    depends on, so a new app needs no edit there.
  - Adding `apps/rewards` touched the root workspaces and `build:rewards`, CI's path filter (`ci.yml:46`) and
    `.gitignore`. Each app's `vercel.json` repeats the install, build and ignore commands.
- **The API:**
  - Express 4.22.
  - CORS from `CORS_ORIGIN`, open if it isn't set.
  - No helmet and no CSP. The error shape is `{ error, message }`.
  - `apps/api` isn't a workspace.
- **The apex `useclear.org` is `clearpath-website`, not `apps/member`** (rewards DECISIONS, Hosts). Its `main` already
  rewrites `/s`, `/p` and `/r` (#61). `apps/member/public/llms.txt` would be served at `app.useclear.org/llms.txt`.

### Payouts of Clear money (report only, nothing changed)

- **Clear money:** `openPlan`, or pay now, credits the shop's on-chain balance with the amount less its discount
  (`discountBpsOf`). The shop redeems through `PayoutPool.redeem`, gas sponsored (`payoutRedemption.ts`). It is paid
  at once when the pool is funded, otherwise within the shop's window: `payoutWindowOf`, **net-30 by default**
  (`chain/payoutReader.ts`). Refunds are netted on chain.
- **Card money** never touches Clear: it is in the shop's own Stripe balance and payouts.
- So an online shop today gets card money in about 2 days and Clear money at net-30 unless the pool is funded.

## 2 · Every frame

| Frame | | Where |
|---|---|---|
| §1 the snippet (no server, with server, webhook) | new | `packages/clear-js`, `packages/clear-node`, `public-api-contracts` |
| §2 Mi Casa's checkout page | new, demo only | `apps/pay/demo/` (a dev harness on a second origin, to exercise framing) |
| §2 Pay with Clear: email or phone, or, card | new | `apps/pay/src/steps/Start.tsx`; shell in `apps/pay/src/modal/Shell.tsx` |
| §2 Approve in the Clear app (waiting) | new | `apps/pay/src/steps/AppWait.tsx`; API `sendClearTender` reused |
| §2 Hi Sofia: Pay now / Over time, split, Clears from, Approve, points | new, reuses | `apps/pay/src/steps/Member.tsx`; split from `domain` (`splitQuote`, `splitsOffered`); split control extracted from `apps/member/.../ChargeApproval.tsx` into `member-kit` |
| §2 You're all set | new | `apps/pay/src/steps/Done.tsx` |
| §3 Enter your code | new, reuses | `apps/pay/src/steps/Code.tsx` with `member-kit` `PinBox` |
| §3 You're new to Clear | new | `apps/pay/src/steps/NewToClear.tsx` |
| §3 Step 1 of 3, Join Clear | new, reuses | `apps/pay/src/steps/JoinBasics.tsx` with `LabelledField`/`StepHead` (OnboardingFlow has no such step) |
| §3 Step 2 of 3, Confirm it's you | new + changed | modal `JoinWindow.tsx`; the window: a new `apps/member` route `/join/pay` running `OnboardingFlow`, the Lithic check and `BankLinkStep` + `runPlaidLink` |
| §3 Pay by card (Stripe fields) | new + changed | `apps/pay/src/steps/Card.tsx`; a new connector method in `cards/connector.ts` + `stripeConnector.ts` |
| §4 the bottom sheet | new | `apps/pay/src/steps/PhoneStart.tsx` (the shell's sheet layout under 640px) |
| §4 the approve sheet in the Clear app ("Mi Casa Tacos is asking · Online", back to the shop) | changed | `apps/member/src/pages/app/ChargeApproval(Route).tsx`; `apps/rewards/src/screens/shop.tsx` `ApproveScreen` |
| §5 New charge › Send a link | new | `apps/merchant/src/charge/link.tsx`, a `link` screen in `NewChargePage.tsx`, `StartTop` |
| §5 the link page | new, reuses | `apps/pay/src/link/LinkPage.tsx` over the same steps; API generalises `publicPay` |
| §6 Settings › Developers | new + changed | `apps/merchant/src/settings/developers.tsx`; `panes.tsx` `Section`/`SECTIONS`; `SettingsPage.tsx` gating |
| §7 llms.txt, the paste-in prompt, MCP | new | `apps/member/public/llms.txt` + `docs/*.md` (generated); `packages/clear-mcp`; a rewrite in `clearpath-website` |
| Charges: Online and Link marks | changed | `charges/model.ts` (`ChargeRow.source`), `charges/views.tsx` `RowView` |

## 3 · Answers

### A · Sign-in inside the frame

**Can Privy run in a partitioned frame?**

- Unproven. Its session and its own wallet iframe would sit in the shop's partition, so every new site starts signed
  out, and Privy has to allow `pay.useclear.org` as an origin.
- Running it in a frame would also put Privy's own code screen in front of card-only payers.

**Recommendation: Clear's own codes, and no Privy in the frame.**

1. **Continue** finds the person by the hash of their phone (E.164) or email (`resolveMemberByAuthInput`).
2. A 6-digit code is sent by Twilio or Resend, with new wording.
   - It is kept hashed (the `sendClaimService` pattern), lasts 10 minutes, and allows 5 tries.
   - Rate limits are per IP, per site and per identifier, on the Redis limiter set to **fail closed** for these buckets.
3. Entering the code, or approving in the app, mints a **payment-scoped token**.
   - It is an HMAC bearer like `rws.`, carrying `{payment, member?, contact, exp ≤ 30 min}`.
   - It is kept in memory in the frame and sent as a header.
   - It reads and acts on that payment only.
4. No cookie is used. The test member, (555) 010-0100 with 000000, is a fixed row in test mode only.

**The catch, which needs your call (D1): the frame can't sign for Pay now.**

- **Over time** is approved by the server, which signs `openPlan` itself.
  - The member's consent is the payment token plus step-up: a passkey in the frame, delegated by the iframe's `allow`.
  - That is as strong as the app's own Privy text code.
- **Pay now** needs the member's smart wallet to sign `payShopCalls`, and that needs Privy.
- **Proposal:**
  - **A member reached through the app request approves in the app.** The request *is* the order, sent as the counter
    sends it. They choose Pay now or Over time there, and the modal goes straight to "You're all set".
  - **On the code path, the modal draws Hi Sofia as drawn.**
    - Over time approves in the frame.
    - **Pay now's Approve opens `app.useclear.org/c/<code>` in a small window** (first-party, so Privy works). It
      closes itself when paid, and the frame moves on.
  - So on a computer the "Hi Sofia" screen is the code path's screen, not a step after the app approves. That changes
    the order of the drawn flow.

### B · Revealing who has Clear

**Recommendation: (b), one screen for everyone.**

- Continue always sends a code. If the contact is a member with the app, it also sends the order to their app.
- The screen reads "Approve in the Clear app, or enter the code we sent" whatever the answer.
- "You're new to Clear" then shows only to someone who has typed the code, so only to the person who owns the number.
- The cost: anyone can make a request appear on a member's phone, as "text a link" at the counter already can. This is
  rate-limited per identifier.
- It merges §2's two waiting screens into one, so **it changes a drawn screen and needs your approval.**

### C · Card in the modal

- Stripe's Payment Element works inside a cross-origin frame, with `stripeAccount` set to the connected account.
- It needs a new connector method, `createOnlinePayment`:
  - `automatic_payment_methods`, automatic capture, `application_fee_amount` from `clearCardFee` (no tip online);
  - a Stripe idempotency key per tender.
- The card-present `createPayment` and hosted `createCheckout` stay as they are.
- It completes by the existing Stripe webhook (`payment_intent.succeeded`), with the frame polling, as the phone page
  does.
- **Apple Pay in a frame:**
  - It needs Safari 17+ and the iframe's `allow="payment"`, which `clear-js` sets.
  - Stripe asks that **both the frame's domain and the top-level domain** be registered, on the account that takes the
    charge.
  - So adding a site in Allowed websites registers `pay.useclear.org` and that site's origin on the shop's connected
    account (`paymentMethodDomains.create` with `stripeAccount`), in each mode.
  - Google Pay uses the same registration.
  - Card fields work without any of it.
- [Register domains for payment methods](https://docs.stripe.com/payments/payment-methods/pmd-registration),
  [Test wallet rendering](https://docs.stripe.com/testing/wallets).

### D · The join hand-back

- Step 1's basics can't be submitted from the frame, because onboarding needs a Privy account and a wallet. So:
  1. The modal keeps them on the payment's session on the server, encrypted, for 30 minutes.
  2. "Continue in a new window" opens `app.useclear.org/join/pay?h=<handoff>`. The handoff is single-use and lasts
     15 minutes.
  3. In the window:
     - Privy sign-up with the confirmed number. Privy sends its own code; there's no way round a second code short of
       making Clear Privy's custom auth provider, which isn't worth it now.
     - Then `submitClearOnboarding` with the basics filled in.
     - Then Lithic's check, which **also asks for the SSN, not drawn**, and a photo if Lithic wants one.
     - Then Plaid.
  4. The window marks the handoff done and says "You can close this window".
  5. The modal **polls** the session every 3 seconds (the codebase's pattern; there is no push channel) and moves to
     step 3.
- On a computer, "finish on your phone" shows a QR of the same handoff link.
- Closing the window changes nothing in the modal: Continue and Pay by card stay. An expired handoff makes a new one.

**But joining can't end in a Clear payment today (D2):**

- A new credit line opens at zero (`set_term_limit.ts` is manual), and Open #3 keeps over time off until checks pass.
- Pay now needs money, and a new member has none.
- So "Join Clear and split it · In 4 is about $48.65 a cycle" promises something step 3 can't do.
- Your call, with these options:
  - **(i)** Joining finishes by card for this order. The points are credited on joining (`creditOrderOnJoin`), and
    "split it" applies next time. This changes copy.
  - **(ii)** Automatic term limits for new members, which is a credit decision.
  - **(iii)** Leave Join out of Phase 6 until (ii).

### E · Where `js.useclear.org/v1` is served

- **From `apps/pay`'s project, with `js.useclear.org` as a second domain.**
  - A host rewrite (`has: [{type: 'host', value: 'js.useclear.org'}]`) maps `/v1` to the built `clear-js` file.
  - `/v1` is cached `public, max-age=300, stale-while-revalidate=86400`.
  - Exact versions are also published at `/v1.<x>.<y>.js` and cached `immutable`.
- Inside `/v1`, changes only add, as the API does. `apps/pay` lists `@useclear/js` as a dependency, so
  `vercel-ignore.sh` rebuilds it when the script changes.

### F · Payouts

- Report only, above.

## 4 · Conflicts with the DECISIONS files and references

1. **Mi Casa's Clear multiplier.**
   - Rewards Hard Stop 2 set it to **Off in every seed**, so rewards §3 holds.
   - This spec needs **1.5×** (256 points, 128 → 384).
   - Proposal: the pay fixtures and tests set Mi Casa to 1.5× in their own seed, the rewards seed stays Off, and
     DECISIONS says so.
2. **Developers is the first money pane that managers see.**
   - Merchant DECISIONS: everything but Shop app and You is owners-only, and a manager sees what the counter sees.
   - The prompt and the spec say owners and managers.
   - Proposal: follow the prompt for Developers alone.
3. **The apex isn't `apps/member`.**
   - Proposal: `llms.txt` and `docs/*.md` are built in this repo, with `api.md` generated from the contracts, and
     served from `apps/member/public`.
   - `clearpath-website` adds rewrites for `/llms.txt` and `/docs/:path*.md`, as its own PR, as with #61. The site has
     no `/docs` now, so nothing is shadowed.
   - `useclear.org` redirects to `www`; fetchers follow that.
4. **Marco's code screen reads "(909) •••-0142".**
   - 0142 is Sofia's in the rewards preview. The next frame confirms Marco's as (909) 555-0188.
   - Proposal: **•••-0188**. The drawn code "48190" is five digits in six boxes, read as being typed.
5. **"Figures come from her own credit terms."** Terms carry only a limit; the rate is a fixed 2% in code. The figures
   use her limit (which splits she's offered) and the 2%, until terms carry a rate.
6. **"In the Clear or rewards app: the approve sheet."** Rewards has its own sheet, with no split choice and 4
   hard-coded. Proposal: rewards takes the split control from `member-kit` too.
7. **The identity check and bank link at joining.**
   - Rewards Phase 4 recorded that the Clear app defers both to the first deposit. This spec puts them in joining.
   - Lithic also needs the SSN, which isn't drawn. It goes in the window.
8. **"Open the Clear app" on a phone** opens `app.useclear.org/c/<code>?return=…` in the browser. There is no native
   app, and an iOS home-screen app doesn't capture links. The return is new: allowed only to the payment's own site.
9. **The name.** Nothing in this repo says Clearpay. `clearpath-website` `content/directory.ts:193` has
   `clearPay: 'Clear Pay'` in the directory artwork. It's outside this work, so I'm flagging it only.

## 5 · Plan for Phases 2–7

- **Phase 2, contracts.** As the prompt lists, plus what Phase 1 found:
  - `Order.raisedBy` nullable with `source`/`sourceDetail` (online orders have no staff);
  - `livemode` on orders and tenders;
  - refund `status: 'pending_approval'` for the MCP;
  - a pay-session contract for the frame (`apps/pay` ↔ API), separate from `/v1`;
  - the protocol's message types with exact payloads.
- **Phase 3, links.**
  - Migration `0030_pay.sql` (0029 is still the latest).
  - `raised_by`/`created_by` nullable for online sources.
  - Links in the merchant app and `GET /api/l/:slug`.
  - Paying a link goes through a generalised `publicPay`: Clear by the `/c/` page, card by hosted Checkout, as the
    phone page does, until Phase 6 puts Stripe's fields in.
  - `apps/pay` scaffolded like `apps/rewards`, with `/l/:slug`. Send a link and the Charges Link mark.
- **Phase 4, `/v1`.**
  - Keys: the secret hashed, roll with 24-hour overlap, `pinnedVersion`.
  - Allowed sites, `/v1` routes with body-hash idempotency.
  - Webhooks: an outbox handler fans each event to endpoints, a delivery job retries over 3 days (its own schedule,
    not the outbox's 12 attempts), and HMAC `Clear-Signature`.
  - Developers, and `@useclear/node`.
- **Phase 5, the script and modal.**
  - `clear-js`, `/m/:session` with `frame-ancestors` from the allowed sites (a Vercel function sets the header per
    session).
  - Codes, the payment token, the app request, and over time in the frame.
  - Pay now per D1; the member app's return and "Online" line; the over-time flag (off in live).
- **Phase 6, joining and card.** As D2 decides, plus `createOnlinePayment`, the Payment Element and domain
  registration.
- **Phase 7, docs and MCP.** `refund_payment` makes a `pending_approval` refund, approved in Charges by the existing
  refund approval.
- **Test mode (D3).**
  - Test payments are real orders with `livemode = false`.
  - The Clear tender is simulated, for the test member only, and touches no chain.
  - Card uses Stripe's test mode, which needs a **test platform key beside the live one** in production and a test
    connected account per shop.
  - Test orders are kept out of the ledger, tax recording, stock, payouts and statements, and show in Charges marked
    Test.
- **Refunds through `/v1`.**
  - A secret-key refund runs at once: card partly or in full, Clear in full only, with a stable error code for a
    partial Clear refund.
  - The MCP's refund waits for an owner or manager.

## 6 · For you to decide

- **D1:** who signs Pay now (the app, or a small first-party window from the code path).
- **(b):** one screen for everyone.
- **D2:** what joining ends in.
- **D3:** test mode as described, with a Stripe test key on production.
- Conflicts 1, 2 and 4.
