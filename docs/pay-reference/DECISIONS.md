# Decisions taken over the Pay with Clear spec

`clear-pay-ref.html` in this folder is the spec. Where it conflicts with the code, with
`docs/merchant-reference/DECISIONS.md`, with `docs/rewards-reference/DECISIONS.md` or with arithmetic, the decision is
recorded here, a section per phase. The Phase 1 findings behind them are in `HARD-STOP-1.md`.

## Phase 1 · Explore

Decided 2026-10-16 at Hard Stop 1. The user answered the gaps; the report's other proposals stand as approved, except
D2, which is still open (below).

### Figures

Every figure in the spec holds against the code. Nothing is changed.

- The order: 12.48 + 1.84 tax, $185.32.
- Over time at 2%, through `splitQuote`: $189.03, $95.44, $48.65 (carry $9.27), $17.45.
- Points: ⌊171 × 1.5⌋ = 256.
- The link page: $161.48.
- Oct 24 2026 is a Saturday, and Oct 23 is seven days from the 16th.

**"Figures come from her own credit terms"** means:

- Her terms decide which splits she's offered: her limit, and the $50 minimum.
- The rate is the fixed 2% that the server opens plans at (`DEFAULT_RATE_BPS`), until terms carry a rate.

### Signing in, and one screen for everyone

These are approved copy changes over the drawn §2, §3 and §4. "The Clear app" is the Clear web app for now, because
there is no native app.

- **On a computer, after Continue, everyone sees the same screen**, whether or not the number or email has an account.
  - Title: **Check your phone**.
  - Body: **We texted you a link and a code. Tap the link, or enter the code here.**
  - For an email address: **Check your email** and **We emailed you a link and a code. Tap the link, or enter the code
    here.**
  - This replaces the drawn "Approve in the Clear app" waiting screen and the separate "Enter your code" screen.
    It also settles the question of revealing who has Clear.
- **A member's link opens the approval in the Clear web app**, and the modal moves on by itself. Anyone can type the
  code instead.
- **On a phone, "Open the Clear app" becomes "Approve with Clear".**
  - It calls `window.open` on the approval page, so the page loads first-party and the member can sign in there with
    Privy if they need to.
  - After approving, that page closes itself, and the shop's tab, which has been polling, moves on.
  - If the browser won't let it close, it says **Done. Go back to micasatacos.com** (the shop's host).
- **The approval page is the member app's** (`app.useclear.org/approve/:id`).
  - The user named `useclear.org/approve/:id`, and the apex is `clearpath-website`. So the apex path is a rewrite
    there, beside `/p` and `/r`, in the website work.
  - Texts and windows use `VITE_MEMBER_APP_URL`, so the switch is one setting.
- **A `returnUrl` hook** is kept for a native app. It is honoured only when it is one of the payment's shop's allowed
  websites.

### Who signs (D1, as proposed)

- **The Clear web app signs Pay now.** In the frame there is no Privy and no wallet.
  - On the link path, the approval page signs it.
  - On the code path, the member's screen ("Hi Sofia") is drawn in the modal. There:
    - **Over time** is approved in the frame. The server opens the plan (`openPlan`) on the payment-scoped session,
      plus step-up with a passkey when one is enrolled; the iframe delegates `publickey-credentials-get`.
    - **Pay now's Approve opens the approval page in a window**, which closes itself when paid.
- **Codes are Clear's own:**
  - 6 digits, kept hashed, 10 minutes, 5 tries;
  - limited per IP, per site and per identifier, failing closed;
  - sent by Twilio or Resend.
- **The session is a payment-scoped HMAC bearer token** (≤ 30 minutes), kept in memory in the frame. No cookie.

### Joining

- **Step 1 in the modal stays as drawn:** legal name, date of birth, ZIP and street address.
- **The SSN never goes in the modal.** Even though the shop's page can't read it, asking there teaches people to type
  their SSN into pop-ups on any site.
  - It moves to step 2, in the Clear window with the ID photo and the bank link, where the address bar shows Clear.
  - Step 2's line becomes **Your SSN, a photo of your ID and your bank's sign-in need their own window.**
- **Step 1's basics are kept on the payment's session on the server**, encrypted, for 30 minutes. The window takes
  them, signs up with Privy, runs the submit chain, then Lithic's check and Plaid. It hands back by a single-use
  handoff that the modal polls.
- **D2 is open: what joining ends in.**
  - A new credit line opens at zero, and a new member has no balance, so "Join Clear and split it" can't end in a
    Clear payment today.
  - It needs deciding before Phase 6. The options are in `HARD-STOP-1.md`.

### Orders without staff

- **`raised_by` and `created_by` may be empty only when the order's `source` is `online` or `link`.** A CHECK
  constraint enforces it, so a counter, Point or phone order still needs a staff member.
- **There is no "Website" staff member.** It would show in staff lists, shifts and tips.
- **An audit row with no actor reads "Online"** in the merchant app.

### Refunds through `/v1`

- **`POST /v1/refunds` takes an optional `amount`.**
  - Card: a partial refund works, through Stripe.
  - Clear: a partial refund is refused with `partial_refund_unsupported`. Clear refunds stay whole-charge for v1.
  - Partial Clear refunds later only add to the API, so they don't break the versioning rule.
- **A secret-key refund runs at once.** The MCP's `refund_payment` makes a refund that waits for an owner or manager.

### Test mode (D3, as proposed)

- **Test payments are real orders with `livemode = false`.**
  - Their Clear tender is simulated, for the test member alone, and never touches the chain.
  - Card runs on Stripe's test mode. That needs a test platform key beside the live one in production, and a test
    connected account per shop.
- **Test orders are kept out of:** the ledger, tax recording, stock, payouts and statements. Charges shows them
  marked Test.

### Card in the modal

- **A new connector method, `createOnlinePayment`:**
  - a direct charge on the connected account;
  - automatic capture, `automatic_payment_methods`;
  - `application_fee_amount` from `clearCardFee`.
- **Stripe's Payment Element runs in the frame**, with `stripeAccount`.
- **Wallets:** adding an allowed website registers both that site and `pay.useclear.org` as payment method domains on
  the shop's connected account, in each mode.

### Hosts

- **`js.useclear.org/v1` is served by `apps/pay`'s project**, through a host rewrite.
  - `/v1` is cached for 5 minutes with a day of stale-while-revalidate.
  - Exact versions live at `/v1.x.y.js`, cached immutable.
- **`llms.txt` and `docs/*.md` are built here** (`api.md` from the contracts) and served from `apps/member/public`.
  The apex gets `/llms.txt` and `/docs/:path*.md` rewrites in `clearpath-website`.

### Conflicts with the other DECISIONS files

- **Mi Casa's Clear multiplier:**
  - The pay fixtures and tests set it to 1.5×, which gives 256 points (128 → 384).
  - The rewards seed stays Off, as rewards Hard Stop 2 decided.
- **Settings › Developers is seen by owners and managers**, as the prompt says. It is the one exception to the merchant
  app's owners-only panes besides Shop app. The counter doesn't see it.
- **Marco's masked number is (909) •••-0188.** The spec's •••-0142 is Sofia's.
- **The rewards app takes the split control from `member-kit`**, so "In the Clear or rewards app: the approve sheet"
  holds there too.

### Outside this work

- **"Clear Pay" in the marketing site's directory artwork** is the user's, in the website work. The product is
  **Pay with Clear** everywhere.

## Phase 2 · Contracts

Written 2026-10-16. `packages/public-api-contracts` (new, `@clear/public-api-contracts`), and in
`packages/merchant-contracts`: `pay.ts`, `payPages.ts`, with additions to `orders.ts` and `drawer.ts`.
Waiting for approval at Hard Stop 2.

### The public API (`@clear/public-api-contracts`)

- **A private workspace package, not published.** `@useclear/node` and `@useclear/js` will carry its types inline
  when they're built, so nobody installs it from npm.
- **The shape of every object:**
  - camelCase fields;
  - money in integer cents, `usd` only;
  - ISO 8601 times;
  - ids with a prefix: `pay_`, `price_`, `plink_`, `re_`, `we_`, `evt_`, `ms_`.
- **Errors are `{ error: { type, code, message, param? } }`.**
  - `ERROR_CODES` lists every code with its type and HTTP status. Codes are only ever added.
  - A request that fails its schema becomes one error, for its first issue, with the field as `param`
    (`fromZodError`).
- **Request bodies are strict.** An unknown field is refused with `parameter_unknown`, so a typo never passes
  silently. New optional fields are still additions.
- **`Clear-Version`:**
  - A missing header runs at the key's pinned version.
  - A known one is used.
  - An unknown one is refused with `version_unknown`, never rounded to a nearby version.
- **A payment's amount and its lines.** The spec's server snippet sends `amount: 18532` with lines that come to
  $171.00. So whatever the amount is above the lines is recorded as the tax the shop worked out ($14.32 there).
  Lines over the amount are refused (`lines_exceed_amount`). The least a payment can be is $0.50, Stripe's card
  minimum.
- **Not in the prompt's list, added:**
  - `Payment.amountRefunded`.
  - `GET /v1/payments` (`ListPayments`, by reference or dates), which the MCP's `get_payment` (by reference) and
    `list_payments` need.
  - `PaymentLink.createdAt`.
  - `CreateRefund.requireApproval`, and the refund status `pending_approval`.
- **Prices:**
  - A price is an Inventory item with no options to choose. Its `price_…` id is an alias the API keeps for the item.
  - A price has no `livemode`, because Inventory is the same in both modes.
  - `amount` is before tax.
- **Events:**
  - `data` is the object itself, because the spec's webhook snippet reads `event.data.reference`.
  - An event never carries `clientSecret`.
  - `apiVersion` is the version of the endpoint's key.
- **Signatures:**
  - `Clear-Signature: t=…,v1=…`: HMAC-SHA256 of `t.body`.
  - While a secret is being rolled, a delivery carries one `v1` per live secret.
  - A time more than 5 minutes from the receiver's clock is refused.
- **Rule 10's test:**
  - `src/published/2026-10-16.json` is the version's shape, written by `bun run snapshot`.
  - `published.test.ts` fails if any of it disappears, changes type, turns nullable, stops being always present
    (in a response), becomes required (in a request), or loses a status, event type, error code or version.
  - The check has its own tests, so a removal is shown to fail and an addition to pass.

### The modal's protocol

- **The page never sends the frame anything.**
  - The accent, logo, locale, methods and email travel in the modal session, which the API makes from the
    publishable key and the page's `Origin`.
  - So the frame trusts the session, never the page.
- **The frame posts only to the origin that made the session**, never `*`.
- **The script accepts a message only when** it comes from `https://pay.useclear.org`, from its own iframe's
  window, and parses.
- **The messages are `ready`, `resize { height }`, `success { id, status, reference }`, `cancel` and
  `error { code, message }`.**
  - All of them are strict objects, so a phone, an email, a code, a name or a balance can't ride along.
  - Esc inside the frame sends `cancel`, because a key pressed in the frame never reaches the page.

### The merchant side (`pay.ts`)

- **Keys:**
  - `pk_`/`sk_`, `test_`/`live_`, then 24 base62 characters. The spec's `pk_live_mc8Q2v` is drawn short.
  - A publishable key comes back in full (`token`); a secret key only once, as `NewSecretKey`.
  - A rolled key has `expiresAt`, 24 hours on.
- **Allowed websites (`allowedOrigin`):**
  - An origin only; the path is dropped.
  - https only, but http for loopback.
  - `localhost`, 127.0.0.1 and [::1] are `testOnly`.
  - Refused: wildcards, IP addresses, single words, and credentials in the URL.
  - Developers lists the host ("micasatacos.com").
- **Webhook endpoints** carry `health` (`new`, `healthy`, `failing`, `disabled`) for the drawn "Healthy". Deliveries
  are the latest 20 per mode.
- **Payment links in the merchant app:**
  - They're made from an amount, or from an Inventory item and a quantity.
  - The merchant view has the link's `name` (the item's, or "Payment") for Charges, and `totalCents` with tax.
  - The app draws the QR from the URL, as it draws charge codes.
- **`MerchantPayApi` stays a separate interface** until the merchant mock implements it, as `MerchantRewardsApi`
  did.
- **`TEST_MEMBER`, `TEST_CARD` and `pasteInPrompt`** are the spec's, word for word, and tested.

### Orders and the audit trail

- **`Order.raisedBy` is nullable.**
  - `Order` gains `source` (`counter`, `point`, `phone`, `online`, `link`), `sourceDetail` (the website's origin or
    the link's slug) and `livemode`. All three are optional, so older responses parse.
  - `sourceHasStaff` is the rule the database's CHECK will hold.
- **`AuditEntry.source` (`online` or `link`, optional).** `actor: null` already meant the system (a job, a
  processor webhook). So the app reads "Online" only where `source` says so, not for every row with no actor.
- **The merchant app reads "Online" for an order with no staff**, wherever it showed who raised one
  (`lib/raisedBy.ts`: Charges, a charge opened, Home, Overview and the export).

### The frame's own routes (`payPages.ts`)

- **These aren't `/v1`:** they are Clear's page talking to Clear, so they aren't versioned.
- **`X-Pay-Session`** is the payment-scoped token. It is minted by a code or by the approval page, lasts 30 minutes
  and is kept in memory.
- **Everyone gets the same `ContactSent`.** Only the code tells a member (`firstName`) from someone new (`contact`).
- **Approving:**
  - `MemberQuote` carries the splits, the bank, and the points ("Earns 256… · now 384").
  - Over time is approved in the frame (`ApproveOverTime`).
  - Pay now and the phone's "Approve with Clear" get the approval page's address (`ApprovalPage`).
  - `ApprovalView` is that page's read, with `channel` (`online`/`link`) for "MI CASA TACOS IS ASKING · ONLINE"
    and `returnUrl`, the payment's own allowed website.
- **Joining:** `JoinBasics` is step 1 only. An SSN sent there is dropped, never kept.
- **Card:** `CardStarted` has the PaymentIntent's client secret on the shop's connected account, for Stripe's fields.

### Building the API image

- **`merchant-contracts` links `public-api-contracts` by `file:`, not `"*"`.**
  - The API's image installs `merchant-contracts` with bun from its folder.
  - There, `"*"` would ask the npm registry for `@clear/public-api-contracts`, and would fail or install someone
    else's package.
- **The API depends on it directly** for `/v1`.
- **The API's Dockerfile copies it, and `.railwayignore` lets it through.**

### For approval

- The contracts above, including the five additions.
- **An amount link's amount is what the customer pays, with no tax added**, like an invoice total. The spec draws
  only an item link, which adds tax ($149.00 → $161.48).

### Checks

- Tests:
  - public contracts: 31;
  - merchant contracts: 83 (71 before);
  - merchant: 203 (201 before);
  - API: 953;
  - member: 783;
  - rewards: 7.
- Typecheck:
  - merchant and rewards are clean;
  - the API's only error in `src` is `coinbaseOnrampService.ts`'s module resolution, unrelated.
- The API's one test error is Redis refusing a connection, because no Redis runs on this Mac.
