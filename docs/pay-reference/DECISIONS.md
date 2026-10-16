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

Approved at Hard Stop 2, 2026-10-16: the contracts as written, the five additions, and an amount link's
amount being what the customer pays, with no tax added.

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

## Phase 3 · Payment links

Built 2026-10-16. Migration `0030_pay.sql`; `apps/api/src/services/merchant/pay/` (links, sessions, over time);
`apps/api/src/routes/payLinks.ts`; the new app `apps/pay`; New charge › Send a link and the Link mark in Charges.

### The database

- **`0030_pay.sql` is the next number.** `0029_rewards` is still the latest on `dev`.
- **Orders gain three columns:**
  - `source`: counter by default, so every older order is the counter's;
  - `source_detail`;
  - `livemode`.
- **Orders without staff.**
  - `raised_by` may be empty only for `online` and `link` orders (`orders_staff_unless_online`).
  - A tender's `created_by` follows its order's source, held by a trigger, since a CHECK can't see the order.
  - `payments.audit_log` gains `source`.
- **All eight tables the prompt lists are made now:**
  - `payment_links`, `api_keys`, `allowed_sites`, `webhook_endpoints`, `webhook_events`, `webhook_deliveries`,
    `pay_sessions`, `pay_codes`;
  - Phases 4–6 fill them;
  - nothing has run outside this branch, so they can still be edited in place.

### Links in the API

- **A link's address** is the shop's slug and six random characters: `micasa-k7m2qd`.
  - The slug is the shop app's, or else its everyday name, which rewards derives the same way ("Mi Casa").
  - The spec's `micasa-tray12` is drawn short.
- **An item link:**
  - it is priced and taxed when it's paid, as the counter would (`quoteLines`), so a price change follows;
  - items with options to choose can't be links yet.
- **An amount link** is a quick sale taxed as `exempt`: its amount is what the customer pays (Hard Stop 2).
- **Paying makes the link's order**, with:
  - `source: 'link'` and `source_detail` its slug;
  - no staff member;
  - figures from the link alone.

  The request's body is never read for an amount.
- **A payment-scoped session (`payments.pay_sessions`) follows each order.**
  - The link page starts one on the first tap, so a visit that never pays makes no order.
  - It lasts 24 hours, as long as its Clear charge can wait.
  - An order nobody pays is let go by the existing stale-order sweep after 2 hours.
- **Paying goes the phone page's way, until Phases 5 and 6:**
  - Clear raises the counter's own Clear tender, which the Clear app opens at `/c/<code>`;
  - card is the shop's hosted checkout, which comes back to the link.
  - The audit rows say `source: 'link'`.
- **The session routes are `/api/checkout/:session`, not `/api/pay/:session`.** Bill pay already has `/api/pay`,
  behind member sign-in, so it would refuse the link page. The contract's comments are updated; no type changed.
- **Error codes:**
  - expired and turned-off links answer 410 (`expired`, `inactive`);
  - a shop with no card processor answers 409 (`unavailable`).

### Over time online (rule 9)

- **A link's Clear charge offers over time only when both hold:**
  - the link allows it;
  - over time online is on (`PAY_OVER_TIME_ONLINE=on` in live; always on in test).
- **The Clear app learns this from the charge it reads.** `overTime: false | true | null` is on the member's charge
  view; null is the counter.
- **`approveCharge` refuses any plan on a charge that says false.** That includes "in full", which is also a
  plan. Such a charge is paid now.
- **The Clear app hiding Over time is Phase 5's** (its approve sheet's online line). Until then, the server's
  refusal is what holds.

### The link page (`apps/pay`)

- **Set up like `apps/rewards`.**
  - It is `@clear/pay`, on Vite and React, with no Privy and no wallet.
  - Its stylesheet is generated from the spec's frames (`scripts/reference-css.mjs`).
  - It is a root workspace with a `build:pay` script, and is in CI's path filter.
  - `vercel-ignore.sh` needs no change: it reads the app's dependencies.
- **The shop's colour and logo only.**
  - The drawing gives the link page Mi Casa's paper and serif. The prompt's rule (the shop sets an accent and a
    logo, so a fake is easier to spot) wins.
  - So the shop's colour is on its mark, from its shop app when it has one and the colour reads on Clear's paper
    (3:1), and everything else is Clear's.
- **Square corners.** The drawn phone is the screen: full width on a phone, phone-width in the middle of a computer.
- **No status bar** (as rewards decided).
- **`/l/*` can't be framed** (`frame-ancestors 'none'`).
- **Not drawn, built from the nearest drawing:**
  - waiting for Clear: "Waiting for Clear", "Approve it in the Clear tab that opened. This page moves on by
    itself.", and Open Clear again;
  - back from card: "Confirming your card";
  - paid: Paid, "You're all set", "Mi Casa Tacos has your order." (the modal's Done);
  - expired: "This link has expired";
  - turned off: "This link has been turned off";
  - "Ask Mi Casa Tacos for a new one.";
  - an address with no link: "There's no payment at this address".
- **While a Clear charge waits, card isn't offered.** A pending tender covers the order, so a card would be
  refused. Phase 5's flow lets someone switch.
- **Opening Clear:** in a new tab opened on the tap, or in the same tab when the browser blocks one, as the phone
  page does. The page polls every 3 seconds while it waits.
- **The preview:** `?preview=1&state=open|waiting|card|paid|expired|inactive` and `/_frames?preview=1`, on the
  spec's Mi Casa, in development only.
- **`apps/api` `bun run pay:dev`:** the routes on PGlite, seeded with the spec's link, and a pretend Clear that
  approves after 6 seconds. It runs the page live on this machine, which has no Postgres.

### New charge › Send a link

- **Drawn as the spec draws it**, from the merchant app's own `c-` classes: For, the price and how many, Note to the
  customer, Expires, Allow paying over time, and Create link.
- **Where it opens (not drawn):**
  - "Send a link" beside the shift in New charge's header;
  - on a phone, under Continue to checkout.
  - Owners and managers only, as the API requires.
- **The address isn't known before Create link.** Once made, the sheet shows it with Copy (the drawn row), its QR,
  and Done in place of Create link. The form is then fixed.
- **Before a price is picked,** the row reads "Choose a price · From Inventory"; tapping it lists Inventory's prices.
- **An amount's row is "Amount · What they pay. No tax is added."** It isn't drawn.
- **The mock's Mi Casa has the spec's catering items**: the taco tray for 12 at $149.00 and the gallon of agua
  fresca at $11.00. They are off the Points' menu, which is the terminal reference's.
- **Previews:**
  - `/new?preview=1&shop=micasa&screen=link` (the drawn sheet) and `&screen=link-made`;
  - `/charges?preview=1&screen=links`.
- **Contract:** `MerchantApi` now extends the three link methods of `MerchantPayApi`, as Phase 2 planned. Developers'
  calls join in Phase 4.

### Charges

- **A link's or a website's sale says where it came from in place of who raised it:** "Link · Taco tray for 12",
  "Online · micasatacos.com".
- **For a Clear charge,** the API's charge list gains `source` (`kind`, `label`, `livemode`), read from the order
  behind the tender.
- **For a card or cash sale,** the order's `source` is used, and the link's name comes from the shop's links (owners
  and managers), falling back to its first line.

### Checks

- **Tests:**
  - API 981 (953 before), with 22 for links and 6 over HTTP;
  - merchant 211;
  - member 783;
  - pay 6;
  - rewards 7;
  - contracts 83 and 31.
- **Builds:** pay and merchant build, rewards typechecks, and the API's `src` typechecks apart from the known
  Coinbase import.
- **Run live:** the link page against `pay:dev`, from $161.48 through the Clear charge to "You're all set".
- **Not run:** a real card checkout (no Stripe keys here), and the deployed apps.

Approved at Hard Stop 3, 2026-10-16: Phase 3 as built, including `/api/checkout` for the session routes, the shop's
colour and logo only on the link page, and the states that aren't drawn.

## Phase 4 · The public API, keys and webhooks

Built 2026-10-16. `apps/api/src/routes/v1.ts`; `services/merchant/pay/{keys,secrets,events,webhooks,v1}.ts`;
`jobs/webhookDeliveries.ts`; the Developers routes in `routes/payLinks.ts`; `packages/clear-node` (`@useclear/node`);
Settings › Developers in the merchant app.

### For approval

- **`/v1/refunds` refunds card payments at once, in part or in full. A Clear payment answers `refund_in_app` (409).**
  - This changes Hard Stop 1's "a secret key's refund runs at once" for Clear.
  - A Clear refund closes the member's plan on chain, and today only the owner can trigger that: by their device,
    or by their code under the refund limit.
  - The Clear refund flow also takes the plan's figures from the tablet, and needs a staff member to have asked.
  - So for now a Clear payment is refunded from Charges. A part of one is still refused first, with
    `partial_refund_unsupported`.
  - Letting the API ask for Clear refunds later only adds to it: `api_refunds.clear_refund_id` is ready.
- **Keys need their own prefix before any are issued (a contract change, not made).**
  - `pk_`/`sk_` + `test_`/`live_` + 24 characters is exactly Stripe's format. GitHub's push protection blocked
    this branch over fake test keys in it.
  - For shops, that means:
    - a Clear secret key a shop commits would be reported as a Stripe key (to Stripe, not to Clear);
    - Clear could never join GitHub's secret-scanning partner programme with a prefix that's Stripe's;
    - a shop using both couldn't tell the two apart.
  - Recommended: `clear_pk_live_…` and `clear_sk_live_…` (and `_test_`), which changes `API_KEY_PATTERN`, the API's
    check and the SDK's.
  - The spec draws `pk_live_mc8Q2v`, so the drawn key and the snippets would change to the new prefix.
  - The tests now build their fake keys at run time.
- **Two error codes added:**
  - `refund_in_app`;
  - `payment_closed`: a modal for a payment that's paid or canceled.

  The snapshot is updated, and the published-fields test passes.
- **A payment the shop's server makes keeps its own lines and tax.**
  - The order's lines are the request's, and its tax is the amount less the lines ($14.32 in the snippet), spread
    across the lines.
  - It is recorded with `taxSource: 'none'`, since Clear didn't work it out.
- **A link's sale is a payment too.** It gets a `pay_…` payment (`created_via: 'link'`), so it can be listed and
  retrieved through `/v1`, and its events reach the shop's webhooks.

### Keys

- **Each mode has one publishable and one secret key**, made in Developers ("Make keys"; not drawn).
  - Keys are `pk_`/`sk_`, `test_`/`live_`, then 24 random base62 characters.
  - The secret is kept as a SHA-256 hash and shown once.
  - Roll makes a new secret key; the old one works for 24 hours, then answers `key_expired`.
- **A publishable key reads `/v1/prices` and opens `/v1/modal_sessions`, and nothing else**
  (`publishable_key_not_allowed`).
  - A modal session needs the request's `Origin` to be one of the shop's allowed websites (`origin_not_allowed`).
  - Loopback origins work with test keys only.
- **Every answer carries:**
  - `Clear-Version`: the request's version, or its key's pinned one;
  - `Request-Id`;
  - `Cache-Control: no-store`.
- **`/v1` has its own CORS, ahead of the API's:**
  - any origin, never credentials, only its own headers;
  - whether an origin may use a key is the route's check, not the browser's;
  - every other route keeps the API's CORS as it was.

### Payments, prices and links

- **`POST /v1/payments` needs an `Idempotency-Key`.**
  - The same key and body gives the same payment, as tenders and refunds already do.
  - The same key with another body is refused (`idempotency_key_reused`).
  - The reference is unique per shop and mode.
- **The status is read from the order and its tenders:**
  - canceled: voided, or canceled;
  - succeeded: paid; a refund doesn't change it;
  - processing: a tender under way;
  - failed: the latest tender was declined;
  - requires_customer: otherwise.
- **`method`** is the biggest tender that took money. `amountRefunded` counts card refunds and settled Clear refunds.
- **Cancel** works only before anything is under way. It voids the order, which releases its stock.
- **A price's id is its item's:** `itm_tray12` is `price_tray12`.
  - Items with options to choose aren't prices.
  - An archived or sold-out item isn't active.
- **`POST /v1/payment_links`** makes the merchant app's kind of link, in the key's mode, with nobody named on it.
- **`POST /v1/modal_sessions`:**
  - Its options travel with the session.
  - A payment's session is its order; the session's website becomes the order's `sourceDetail`.
  - A price's session makes its order when the customer starts paying (Phase 5), so a click that never pays holds
    no stock.

### Webhooks

- **Events are written inside the transaction of the change:**
  - payment events at the end of `settleOrder`;
  - card and cash `refund.succeeded` where the refund is announced.

  Each is written once, keyed by what happened.
- **One delivery per endpoint of the shop, in that mode, listening for that type.** A live endpoint never hears
  about a test payment.
- **The delivery job runs every 10 seconds:**
  - each delivery is leased for 2 minutes, so two workers never send one twice;
  - a delivery is signed `t.body` with the endpoint's secret;
  - 2xx means delivered;
  - otherwise it tries again after 1, 5 and 30 minutes, 2, 5 and 10 hours, then every 12 hours, until 3 days
    after the event;
  - every attempt is kept for Developers.
- **Endpoint secrets** are `whsec_…`, AES-256-GCM encrypted under `PAY_SECRETS_KEY`, which the API needs in
  production. Payments' client secrets are kept the same way.
- **An endpoint must be a public https name.** localhost, `.local`, `.internal` and IP addresses are refused, so
  Clear can't be pointed at itself.

### `@useclear/node`

- **`new Clear(key)`, `payments`, `prices`, `paymentLinks`, `refunds`, `webhookEndpoints`, and
  `webhooks.verify(body, header)`.**
  - `verify` reads the endpoint secret from `CLEAR_WEBHOOK_SECRET` when none is passed, as the spec's snippet
    needs.
  - The base URL is `https://api.useclear.org`, or `CLEAR_API_URL`.
  - POSTs carry an idempotency key, reused across retries.
  - Network errors, 429 and 5xx are retried with backoff.
  - It refuses a `pk_` key with a sentence.
- **The API's `/v1` tests use the SDK as the client.** It verifies the API's real signatures and refuses a changed
  body or another endpoint's secret.
- **Before publishing (Phase 7):**
  - give the contracts a zod-free module for the signing helpers, so the bundle doesn't carry zod (0.67 MB today);
  - give the published objects plain TypeScript types for the `.d.ts`;
  - decide the CommonJS default export;
  - point `main` at `dist`.

  tsup's config is written but tsup isn't installed.

### Settings › Developers

- **As drawn**, from the merchant app's `c-` classes. Its text matches the spec frame's, compared in the browser.
- **The rail is Shop app › Developers › Devices.**
  - Owners and managers see it; the counter doesn't.
  - Managers' rail is Shop app, Developers, You.
  - `sections.ts` now holds the rail.
- **Not drawn, built from the nearest drawing** (each at `/settings/developers?preview=1&shop=micasa&screen=…`):
  - **Test:** the switch's Test side, and the chip reads Test.
  - **`no-keys`:** "No live keys yet" with Make keys.
  - **`secret`:** the secret shown once ("Copy it to the server now, as CLEAR_SECRET_KEY. It never goes in a web
    page.", "It won't be shown again."). After a roll it says when the old key stops, and an "Old secret key" row
    follows.
  - **`roll`:** "Roll the secret key".
  - **`add-site`:** the address checked as it's typed with `allowedOrigin`'s own reasons, and a localhost note.
  - **`remove-site`:** "Remove a site".
  - **`add-endpoint`:** a URL and the four events as tick boxes, with the drawn three ticked.
  - **`endpoint-secret`:** "Signing secret".
  - **`remove-endpoint`:** reached by tapping the endpoint row.
  - **`no-endpoints` and `no-deliveries`:** "—".
  - An older delivery reads "Oct 15, 10:42am".
  - The test card without cards: "· once cards are connected in Payments".
- **Recent deliveries shows 5** (the drawing has 3; the API keeps 20 per mode).
- **The row buttons are the app's 36px**, by an existing app-wide rule.
- **The mock's live publishable key** is a full key starting `pk_live_mc8Q2v`: the drawing's is short, and the
  contract wants 24 characters.

### For the user

- **Set these on Railway:**
  - `PAY_SECRETS_KEY`: 32 random bytes, base64;
  - `PAY_OVER_TIME_ONLINE`: leave unset in live until counsel signs off.
- **Point `api.useclear.org` at the API on Railway,** as the SDK's default base URL. Or tell me another host, and
  the SDK's default changes.

### Checks

- **Tests:**
  - API 1008 (975 before), with 27 for `/v1` over HTTP, the SDK as the client;
  - merchant 226;
  - member 783;
  - pay 6;
  - rewards 7;
  - merchant contracts 83;
  - public contracts 31;
  - `@useclear/node` 31.
- **Typechecks and builds:** all clean, including the API's `src`, apart from the known Coinbase import.
- **Not run:**
  - a real webhook delivery to a server outside this machine;
  - a Stripe refund against Stripe's test mode;
  - `apps/api/e2e/contract.ts` for the new merchant methods, which needs a Postgres.

Approved at Hard Stop 4, 2026-10-16:

- Phase 4 as built.
- A Clear payment through `/v1/refunds` answers `refund_in_app` for now.
- **Keys are `clear_pk_…` and `clear_sk_…`** (`clear_pk_live_`, `clear_sk_test_`…, then 24 base62 characters):
  - in the contract (`API_KEY_PATTERN`), the API's check, `@useclear/node` and the merchant app;
  - Developers reads "clear_pk_live_mc8Q2v… · safe in a web page" and "clear_sk_live_…9fA2";
  - the spec's snippets and docs follow: `Clear("clear_pk_live_mc8Q2v")`, and the paste-in prompt's "Use
    publishable key clear_pk_live_…".
  - The spec file itself is left as drawn; this note is what overrides it.

## Phase 5 · The modal, `@useclear/js`, and paying with Clear

Built 2026-10-16. `apps/api/src/services/merchant/pay/{frame,testMode,payDeps}.ts` and the `/api/checkout/:session/…`
routes; `packages/clear-js` (`@useclear/js`); `apps/pay` `/m/:session` (`src/clear`, `src/modal`, `api/frame.ts`);
the Clear app's approval page (`apps/member` `/approve/:id`); Charges' Online line.

### For approval

- **Who approves where.**
  - Over time, for a member with no passkey, is approved in the frame (`MemberQuote.approveIn: 'frame'`). The
    server signs the plan (`approveCharge`), as at the counter.
  - Pay now, and any member with Face ID, is approved in the Clear app's window (`approveIn: 'window'`). The frame
    can't sign a Pay now transfer or run a passkey step-up, since both need the member's Privy wallet on
    `app.useclear.org`.
  - The window is `app.useclear.org/approve/:id`, opened on the tap itself. The frame polls every 3 seconds and moves
    on by itself.
- **Three additions to the contracts:** `PaySession.payment {id, reference}` (what `success` posts),
  `PaySession.prefillEmail` (the script's `email`), and `MemberQuote.approveIn`.
- **The first cycle clears on the 1st of next month**, in the shop's time zone ("clears Nov 1").
- **"Clears from" is left out for real members until a bank name has a source.** A linked bank's name isn't kept
  with its Plaid item yet. The test member reads "Test Bank •••• 0000".
- **Card in the modal is hosted checkout in a window until Phase 6.** "You're new to Clear" shows "Pay $185.32 by
  card" without the Join row, which is Phase 6 (D2 is still open).
- **The page tells the frame its layout** (`#layout=modal|sheet` on the iframe's URL). A 440px modal is narrower
  than 640px, so the frame's own width can't say. The fragment never reaches a server, and changing it doesn't
  reload the frame.

### Not drawn, built from the nearest drawing

- "Use a different email or phone" and "Resend in Ns" under the code boxes.
- **Approve in Clear**: the window step, "Finish in the window that opened. This page moves on by itself.",
  "Waiting for Clear", "Open it again" and "Pay another way".
- **Check your email**: the approved email variant.
- "You'll approve it in Clear, in a new window." under Approve, when the window is where it happens.
- **Pay now's rows:** "From | Your Clear cash".
- **A Test chip** in the head in test mode.
- **Ended and failed states:** "This checkout has ended" and "Clear can't open this".

### Test mode

- **The test member** is (555) 010-0100, code 000000, "Test", with a $5,000 limit. Nobody else signs in, and
  nothing is texted or emailed.
- **Test charges are kept apart** (`payments.test_charges`). A test order skips the ledger, stock, tax filing and
  payouts.
- **Only the test member earns test points.** They are joined to a shop's app the first time they pay there, so the
  shop sees the 256.

### `@useclear/js`

- `js.useclear.org/v1` is an `apps/pay` host rewrite. The build is copied in by the prebuild; nothing is published to
  npm.
- Size: 5.09 KB gzipped against a 10 KB budget.
- A click on the scrim cancels, as Esc does.
- The script has its own error codes beside the API's and the modal's: `insecure_page`, `invalid_options`,
  `network_error` and `invalid_response`, plus `unavailable` after 20 seconds.
- It refuses a modal session whose URL isn't on the pay origin.

### The Clear app's approval page

- The head reads "MI CASA TACOS IS ASKING · ONLINE" (or "· LINK"), with "Then you're back on micasatacos.com".
- With over time off online, the Over time choice is hidden.
- On approval it tries `window.close()`; otherwise it shows "Done. Go back to micasatacos.com".
- With no account it shows "No Clear account yet".
- It uses the member app's own look, as Charge approval does, not the modal's.
- **It opens on Pay now in real use** (it doesn't know the split the member was looking at). Over time stays one
  tap away.

### The link page

- **Pay with Clear on the link page is now the same steps as the modal**, drawn inline.
- Card still goes to hosted checkout.

### Frame-ancestors

- `/m/:session` is served by `apps/pay/api/frame.ts` (edge). It asks the API for the session's website and sends
  `Content-Security-Policy: frame-ancestors <that origin>`.
- Anything else gets `frame-ancestors 'none'` with `X-Frame-Options: DENY`: an unknown, ended or link session, an
  origin that doesn't read cleanly, or the API being down.
- The frame also checks `location.ancestorOrigins` where the browser has it.
- **It needs `PAY_API_URL` (or `VITE_API_BASE_URL`) on the pay project's Vercel functions.**

### For the user

- Set `PAY_API_URL` on the pay Vercel project, which creating that project is part of.
- `PAY_BASE_URL` on Railway defaults to `https://pay.useclear.org`.

### Checks

- **Tests:**
  - API 1021. One file died once on the local Redis-reconnect noise (`offramp.test.ts`) and passes on its own. The
    file includes `checkout.test.ts` (15): the spec's order end to end in test mode, the payment-scoped token, code
    tries, expiry and rate limits, and over time online being off.
  - merchant 226;
  - member 811;
  - rewards 11;
  - pay 32: copy, protocol, frame-ancestors, and no QR on the phone sheet;
  - `@useclear/js` 58;
  - `@useclear/node` 31;
  - merchant contracts 83;
  - public contracts 31;
  - domain 75.
- **Typechecks and builds:** all clean, apart from the known Coinbase import in the API.
- **Run for real:** `bun run pay:dev` now serves `/v1` and a shop page at `localhost:5199` that uses
  `@useclear/js`. The test payment was recorded at 1280 and 390 wide: $185.32 in 4 at $48.65, 256 points, and the
  page's `onSuccess` got `{id, status, reference}` and nothing else.
- **Not run:**
  - a real member's approval through `app.useclear.org` (it needs Privy);
  - the edge function on Vercel itself;
  - Safari's and Firefox's handling of the frame.

Approved at Hard Stop 5, 2026-10-16:

- Phase 5 as built, including the `approveIn` window rule, the three contract additions and the layout fragment.

## Phase 6 · New to Clear, and card

### D2, decided 2026-10-16: what joining ends in

The user's answer was both (i) and (ii):

- **Every member gets a starting term limit**, "maybe like 500".
- **It increases automatically** with payment and cycle history.
- **The income limit bounds it**: the existing income rule, half the trailing 90-day monthly deposit
  (`INCOME_SHARE`, `estimateMonthlyDeposit`).
- **Card stays the fallback.** Where the limit isn't there yet (checks not passed, or the order doesn't fit), joining
  finishes by card for this order, and the points are credited on joining.

The rule as built, and its figures, are below for approval.

#### The rule as built, for approval (`apps/api/src/services/credit/termLimitRule.ts`)

**Limits**
- **Starting limit: $500**, on `TermIssuer.termLimitOf`, the line split plans draw on. It is granted once the identity
  check has passed (Lithic `ACCEPTED`). The first grant also opens the member's StableCredit line.
- **Growth: $250 for every 3 clean installments paid.**
  - "Clean" means installments paid (`term_plan_payments`, counted by distinct plan and installment) since the last time
    the member was seen behind.
  - Being behind leaves a late mark, and the count starts again from it.
- **The income bound:** growth above $500 stops at half the trailing 90-day monthly deposit (`INCOME_SHARE`). The
  starting $500 stands on its own, since a new member has no deposits yet. The ceiling is $5,000.
- **It only raises.** It never lowers a limit (an operator may have set one higher), and it skips anyone behind,
  suspended or ever defaulted. After a default the limit is the operator's call, as the contract says.

**When it runs**
- When the join window finishes.
- When a Lithic account comes back `ACCEPTED`.
- Hourly, for every member. That pass also asks Lithic about anyone stored as pending, so a member accepted later is
  caught.

**Switch:** `AUTO_TERM_LIMITS=on`. It is on by default on Base Sepolia and off elsewhere unless set. `off` turns it
off anywhere.
- **This applies to every member, not only online.** Once it's on, members at the counter can split up to their
  limit too.
- The operator key needs Clear's `OPERATOR` role.
- One write goes at a time within this service. The credit-period renewer signs with the same key, so the two can
  still meet on a nonce.

## Phase 6, as built

Built 2026-10-16. API: `pay/join.ts`, `pay/card.ts`, migration `0031_pay_join.sql`, `cards/cardTenders.ts`
`createOnlineCardTender`, and `services/credit/termLimit*` with `jobs/termLimitReviewer.ts`. `apps/pay`:
`clear/Steps.tsx`, `clear/Card.tsx`. `apps/member`: `/join/pay`.

### For approval

- **D2's rule and its figures**, above.
- **When a starting limit can't cover the order**, it falls back to card (not drawn):
  - this applies when the order is over $500, over time online is off, or checks are still pending;
  - the Join row reads **"Join Clear" / "About 3 minutes · Pay this one by card, split the next"**;
  - after joining, **"You're in" / "Welcome to Clear. Splitting opens once your checks finish, so pay this one by
    card."**
- **The join window's first read answers signed out.** It gives the shop, the order and the confirmed contact, so
  Privy's sign-in can be prefilled.
  - Step 1 (the birthday and address) comes back only to someone signed in with that same phone or email, which Privy
    verified.
  - Anyone else holding the link gets a 403 and reads nothing.
  - The link lasts 15 minutes and is spent on `/done`.
- **Test-mode card never runs on a live key.**
  - A test session's card is offered only where this environment's Stripe key is a test key.
  - On production, test mode has no card until a test platform key and per-shop test accounts exist (D3's
    remaining work).
  - A live session uses the environment's key, which is a test key on dev.
- **A signed-in member who picks card** has their waiting Clear charge withdrawn and is put on the order, so the shop's
  points follow the card: 171 at Mi Casa, with no 1.5×, since that's for Clear cents.
- **Receipts:** "In Clear" for a member's card, and "On your card statement" for a card with no Clear account.

### Joining

- **After the code, someone new can join** (live only; test mode has only the test member):
  - **Step 1** in the modal: the drawn fields, with the birthday as MM / DD / YYYY and 18 or older. It is kept
    encrypted on the session for 30 minutes. An SSN sent there is dropped.
  - **Step 2:** the approved line and "Continue in a new window". On a computer, "finish on your phone" shows the same
    link as a QR. The phone's sheet never shows one.
  - **Step 3:** the new member's own screen ("Step 3 of 3", "Hi Marco"), approved in the frame on the starting limit.
- **The modal polls every 3 seconds.** A link that ran out offers "Open a new window" (step 1 is kept in the frame's
  memory) or card.
- **The window (`app.useclear.org/join/pay?h=`):**
  1. Privy sign-in, prefilled.
  2. The onboarding submit chain (`referralSource: 'online'`).
  3. Lithic's identity check, with step 1 filled in. The SSN is asked here only, and cleared after.
  4. The ID photo, when Lithic asks.
  5. Plaid, skippable.
  6. `/done`, then it closes itself, or says "Done. Go back to micasatacos.com".
- **A rejected check still finishes:** the modal moves on to card.

### Card

- **`createOnlinePayment`:** a direct charge on the shop's account, with `automatic_payment_methods` and Clear's fee
  from `clearCardFee`, as at the counter.
- **The tender keeps its PaymentIntent from the start.** The existing `payment_intent.*` handlers settle it, and the
  nightly reconciliation matches it.
- **A declined card stays pending online.** The customer can try another card on the same payment, and asking again
  returns it.
- **The fields:** Stripe's Payment Element in the frame, in Clear's look (square, Clear's ink), confirmed with
  `redirect: 'if_required'`. "Secure card fields by Stripe, for Mi Casa Tacos" and "Pay $185.32" are as drawn.
- **"Card payments earn points too, if you join Mi Casa Rewards after."** It shows where the shop's rewards app is on.
  `PaySession.rewardsName` was added for it.
- **Wallets:** adding an allowed site registers it and the pay host as payment-method domains on the shop's account,
  best effort. Localhost is skipped.
- **Card is shown when** the shop takes cards, the modal allows it, the mode fits and `STRIPE_PUBLISHABLE_KEY` matches
  the key's mode. The link page uses the same fields now; hosted checkout stays for `POST /pay` callers.

### Not drawn, built from the nearest drawing

- The joined-by-card fallback, above.
- The QR's line: "Scan it with your phone's camera. This page moves on when you're done there."
- "Open a new window" after the link runs out.
- "Pay another way" under the card fields.
- The window's screens (in the screenshots).

### For the user

- **`STRIPE_PUBLISHABLE_KEY` on the API**, in each environment, matching its secret key's mode. Without it, card isn't
  offered online.
- **`AUTO_TERM_LIMITS`:** leave unset on dev, where it is on because dev is Base Sepolia. Set `on` in live only when you
  want starting limits for everyone.
- **A Lithic status webhook, or a write-back,** would keep `lithic_accounts.status` current. Today only the hourly
  review asks Lithic about members still pending.

### Checks

- **Tests:**
  - API 1057, with 11 new over HTTP: the join that hands back and approves in 4; the window only for that contact,
    once; the 15-minute link; no SSN or minor kept; closing the window leaves card; the $185.32 fee of 30¢ and none
    under $10; Online, captured and reconciled; a declined card retried; no processor or wrong mode, no card; a
    member's card taking the points; wallet domains. One file died once on the local Redis noise and passes on its
    own.
  - The term-limit rule 10 and service 13.
  - pay 42; member 843; merchant 227, with Online card in Charges; rewards 11.
  - `@useclear/js` 58; `@useclear/node` 31; domain 75; member-kit 2; contracts 83 and 31.
- **Builds:** pay, member, merchant and rewards all build. The API's `src` typechecks apart from the known Coinbase
  import.
- **Not run:**
  - a real Stripe payment (no Stripe key here; the preview draws the fields);
  - the window's live path through Privy, Lithic and Plaid;
  - a `setTermLimit` on any chain.
