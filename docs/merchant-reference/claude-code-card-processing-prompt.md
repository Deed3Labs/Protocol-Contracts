# Claude Code prompt: card processing, checkout, drawer and ledger for the Clear merchant app

You are working in the Clear monorepo (`github.com/Deed3Labs/Protocol-Contracts`), which holds the member app, the protocol contracts and the merchant app at `apps/merchant` (deployed to `merchants.useclear.org`). Your job is to build the backend and app plumbing behind the merchant app's retail features: Stripe card processing, checkout, the cash drawer, and a double-entry ledger.

The screens already exist as HTML reference files (`clear-merchant-*.html`: New Charge, Inventory, Home, Staff, Charges, Settings, Payouts, Overview). **Treat them as the spec for behaviour and copy.** Where this prompt and a reference file disagree, stop and ask.

Work on a branch. There are **hard stops** marked below. At each one, stop, summarise what you did and what you found, and wait for review before continuing.

---

## Decisions already made (do not reopen)

**Card processing**
- Stripe **Connect, Standard accounts, direct charges**, with **"Stripe handles pricing"**. The merchant owns their Stripe account and is the merchant of record. Stripe charges its fee to the merchant's account.
- **Cards are locked** in the app until the merchant has connected Stripe and the account has **charges enabled**.
- **Clear's fee** is added to each card sale as the `application_fee_amount`:
  - 30¢ per card sale on the free / pay-as-you-go plan.
  - 20–25¢ on a paid plan. The exact figure is not decided, so make it a plan setting, not a constant.
  - Charged **only on card sales of $10.00 or more**. Under $10.00 the fee is 0.
  - Computed **on the server only**. The client never sends a fee.
- Clear's UI shows **one "card processing" figure** (e.g. 2.7% + 35¢). The Stripe/Clear split is one tap away in deposits and statements. That split must come from real Stripe fee data, not a recomputation.

**Readers and app shell**
- Readers: **Stripe Terminal**. Supported readers are the Stripe Reader M2 (Bluetooth), smart readers (S700/S710, WisePOS E), and **Tap to Pay** on compatible iPhone and Android devices.
- The merchant app stays one PWA codebase, **wrapped with Capacitor** for an installed app.
  - In a plain browser: smart readers only.
  - In the installed app: also the M2 and Tap to Pay.

**Taking payment**
- **Manual capture.** Card payments are authorised at the tap and **captured at Close the day**. A safety job captures anything still uncaptured before Stripe's in-person authorisation window expires. This makes "Void" a free cancel, and lets tip adjustments land before capture.
- **Split payments:** paid parts stay paid if a later part fails. The order keeps a remaining balance.
- **Tips:** allowed on any tender and added to that tender, including Clear.
- **Discounts:**
  - One per order: a code or a manual amount, never both. It comes off before tax.
  - Each role has a limit (counter 10%, manager 25%, owner none). Above the limit, an owner or manager enters their PIN.
- **Tax:** via **Stripe Tax's calculation API** for every sale (card, cash and Clear). The rate comes from the shop's address. Each item has a tax kind (taxable goods, labour not taxed, prepared food, exempt) that maps to a Stripe tax code.

**Cash and close**
- **The drawer:**
  - Starting cash (default $150.00).
  - **Two blind counts at close**: neither counter sees the other's count or the expected total until both are saved.
  - Any difference needs a **sign-off by an owner or manager who was not the first counter**.
  - A per-shop setting covers the one-person close: either one count signed off by the owner next morning, or wait for a second person.
- **Close the day** locks the day's figures into an immutable end-of-day report.

**Money providers**
- **Plaid** links the shop's payout bank account, confirms the account name matches, and falls back to micro-deposits.
- **Bridge** verifies the business (KYB) and its owner at signup, issues the account and routing numbers for deposits, and moves USD in and out.
- **Privy organization wallets** hold the shop's cash account balance as USDC: one organization per shop, the owner as its key quorum, Clear's backend key as a policy-capped signer.
- **Lithic** would issue business cards if shops later get member-style accounts. Out of scope now.
- Record every movement between these and the ledger through the ledger service, the same as card and cash.

**Scope**
- **Inventory:**
  - Stock is **held** when a charge is raised, **committed** when paid, **released** if it fails or is cancelled.
  - Items can have option groups (pick one or pick any, required or optional, each option with a price change).
  - Quick sale is a one-off line with an amount, a note and a tax kind, and no stock.
- **Other card providers** (Square etc.) come later through a card-connector interface. Stripe is the first implementation. Do not build Square now, but do not hard-code Stripe outside the connector.
- **Clear credit money** stays on the existing protocol/ledger flow. Its merchant fee depends on how the member pays: 1.25% paid now and 2.0% over time for founding partners, 1.5% and 2.5% standard. Store both pairs as plan settings; the fee is known only once the member approves. Card and cash never pass through Clear's pool. The Clear refund unwinding is a separate, open protocol question: **do not implement it here**; leave a clearly marked seam.

---

## Who owns what

This prompt runs **alongside a second one**, `claude-code-merchant-ui-prompt.md`, which builds the merchant app's screens. To keep the two sessions from colliding:

- **This prompt owns:** the API, the database and migrations, the ledger service, all Stripe server work (Connect, Terminal locations, connection tokens, PaymentIntents, webhooks, capture jobs, payouts sync), and background jobs.
- **The UI prompt owns:** everything in `apps/merchant`, including the **Capacitor shell and the Terminal plugin wiring** on the app side.
- **The seam is a shared package, `packages/merchant-contracts`,** written in Phase 2 of this prompt. The UI builds against it with mock data first, then switches to the real API endpoint by endpoint. **Do not change a contract without flagging it**, because the UI's mock layer depends on it.

---

## Principles for everything you build

1. **Money is integer cents.** No floats anywhere money is stored or computed.
2. **The ledger is append-only.** Nothing is edited or deleted; corrections are reversing entries. Only the ledger service writes to ledger tables.
3. **Idempotency on every money-moving endpoint** and every webhook handler. A retry must never charge, refund, capture or post twice.
4. **Stripe webhooks go through an inbox table.** Store the event, acknowledge fast, process asynchronously and idempotently, keyed on the Stripe event ID.
5. **Anything that must be atomic happens in one database transaction.** For example: a cash tender, its ledger entries and its stock movements.
6. **Card data never touches our servers.** The Terminal SDKs and readers handle it. Keep PCI scope minimal.
7. **Server decides, client displays.** Fees, tax, discount limits and permissions are enforced on the server.
8. **Verify Stripe specifics in Stripe's current docs before coding them**, and note what you confirmed in the PR. At minimum:
   - The capture window for in-person authorisations.
   - Whether a tip can be added after authorisation (incremental authorisation or overcapture) on each reader type.
   - Tap to Pay requirements and the Apple entitlement.
   - Refunding or keeping the application fee on refunds.
   - Using the Tax calculation API for transactions not paid through Stripe.
   - Offline (store-and-forward) limits for the M2.

---

## Phase 1: Explore (no code changes)

1. Map the monorepo: `apps/`, `packages/`, `contracts/`, and how `apps/merchant` is built and deployed.
2. **Find the backend.** What does the member app use for its API, database, ORM, auth and background jobs? Is there already a database the merchant app shares, or none?
   - If there is an existing Postgres and ORM, plan to use them.
   - If there is none, propose Postgres with the ORM and migration tool that best fits the repo's existing stack, and say why.
3. Find how merchant accounts, staff, roles and PINs are modelled today, if at all. Also find how the app calls the Clear protocol to raise and confirm a Clear charge.
4. List anything in the repo that already touches Stripe, Lithic or payments.

**HARD STOP 1.** Report the backend you found, where the new services and tables should live, and any conflicts with this prompt. Wait for review.

---

## Phase 2: Schema and ledger

Create four schemas (or namespaced table groups, if the database can't do schemas). The column lists below are the minimum; add what the existing conventions need (timestamps, created_by, soft references to staff).

**`merchant`**
- `shops`: name, address (used for tax), timezone, plan, plan card fee (cents), currency.
- `staff`: role (counter, manager, owner), PIN hash, discount limit (percent) per role, carried in role settings.
- `shop_settings`:
  - Payment methods on/off (card, cash, split).
  - Tips: on/off, amounts or percentages, presets, who gets them.
  - Starting cash.
  - Two counts on/off.
  - One-person close mode.
  - Store card payments offline on/off, with a limit.
- `card_connectors`: shop, provider (`stripe`), external account ID, charges enabled, details submitted, disconnected at.
- `readers`: shop, provider, type (m2, smart, tap_to_pay), external reader ID, label, location ID, last seen.

**`commerce`**
- `catalog_items`: name, detail, category, price (cents), cost (cents, optional), tax kind, stock tracked, reorder at, archived.
- `option_groups`, `options`: the rule (one or any, required or optional), the price change (cents), and the order the groups appear in.
- `stock_movements`: item, quantity (signed), kind (receive, count, damage, hold, release, sell, return), reason, reference (order line, reorder), actor. **On-hand, held and free stock are derived from movements.** Do not store them as a mutable number without also recording the movement.
- `reorders`: item, quantity, supplier, expected date, received quantity, status.
- `discount_codes`: code, percent or amount, applies to, starts, ends, once per customer, uses.
- `orders`:
  - Shop, raised by (staff), customer name or number (optional), status (open, paying, paid, voided, refunded, partly refunded).
  - Subtotal, discount, tax, tip, total (all cents).
  - Order number and name for call-outs (nullable).
- `order_lines`: item or quick sale, quantity, unit price, options chosen (snapshot), line total, tax kind, tax amount.
- `order_discounts`: code or manual, amount, reason, approved by (when over the limit).

**`payments`**
- `tenders`:
  - Order, method (clear, card, cash), amount, tip, status (pending, authorised, approved, declined, captured, cancelled, refunded, partly refunded).
  - External references: PaymentIntent ID, Clear charge ID.
  - Card last four and brand, the reader used, idempotency key.
  - Cash handed over and change given.
- `refunds`: tender, amount, items returned (with back-in-stock flags), requested by, approved by, external refund ID, status.
- `stripe_events` (the inbox): event ID (unique), type, account, payload, received, processed, error.
- `outbox`: events to publish internally (e.g. "order paid" for notifications and reports).

**`ledger`**
- `accounts`: per shop, one row per ledger account, each with a type (asset, liability, income, expense) and a code. The accounts are:
  - `drawer_cash`, `cash_in_transit_to_bank`, `bank`.
  - `card_receivable`, `clear_receivable`.
  - `sales`, `tax_payable`, `tips_payable` (one per staff member), `discounts`.
  - `cash_over_short`, `card_processing_expense`, `refunds`.
- `journal_entries`: shop, occurred at, kind, reference (order, tender, drawer session, deposit), created by, reverses (nullable).
- `journal_lines`: entry, account, debit (cents), credit (cents). **Every entry's debits equal its credits.** Enforce this in the ledger service, and with a database constraint or trigger if the database supports it.

**Drawer and close** (put these in `payments` or their own schema, as you judge best)
- `drawer_sessions`: shop, opened by, starting cash, opened at, closed at, status.
- `drawer_counts`: session, counter, method (by note or by total), notes by denomination, total, is second count, saved at. **The API must not return one counter's figures, or the expected total, to the other counter before both counts are saved.**
- `drawer_signoffs`: session, difference, note, signed by (must not be the first counter), at.
- `bank_deposits`: session, amount, marked deposited by, at.
- `day_reports`: shop, business date, an immutable snapshot of totals by method, tips, tax, discounts and refunds, the drawer result, closed by, at.

**The ledger service** is the only writer to the `ledger` schema. It should expose:
- `post(entry)`: validates balance and idempotency.
- `reverse(entry_id)`.
- `balance(shop, account, as_of)`.

Write example postings as tests:
- **Cash sale:** drawer cash debit; sales, tax payable and tips payable credits.
- **Card authorised, then captured:** card receivable. The Stripe fee and Clear's fee are recorded when payout data arrives.
- **Tip paid from the drawer:** tips payable debit, drawer cash credit.
- **Short at close:** cash over/short debit, drawer cash credit.
- **Deposit marked:** cash in transit, then bank.
- **Cash refund:** refunds debit, drawer cash credit.

Also write the **order and tender state machines** as pure functions with tests. Cover: split payments where a later part is declined; void of an authorised card tender; a partial refund.

Create **`packages/merchant-contracts`**, the shared package both prompts build against. It holds:
- The types and validation schemas for shops, staff and roles, shop settings, card connectors and card availability, readers, catalog items and option groups, stock (on hand, held, free), discount codes, orders and order lines, tenders, refunds, drawer sessions and counts (**the count type must not carry another counter's figures or the expected total until both counts are saved**), sign-offs, deposits, day reports, and card deposits with their fee split.
- The order and tender state machines (below), exported so the UI can show the same states.
- The fee rule (below).
- A typed API client interface: one method per endpoint, which the UI implements twice (mock and real).

Write the **fee rule** as one pure, tested function: `clear_card_fee(amount_cents, plan) -> cents`. It returns 0 under 1000 cents; otherwise 30 on pay-as-you-go, or the shop's configured plan fee on a paid plan.

**HARD STOP 2.** Present the migrations, the ledger service, the posting tests, the state machines, the fee rule and **`packages/merchant-contracts`**. Wait for review before any Stripe code. The UI prompt starts its mock-data screens once the contracts are approved here.

---

## Phase 3: Connecting Stripe

- **Onboarding:** Standard accounts through **Account Links**. Store the account ID on `card_connectors`. A "Connect Stripe" endpoint returns the link; the return URL lands on the Settings › Payments pane.
- **Handle these events:**
  - `account.updated`: sync charges enabled and details submitted.
  - `account.application.deauthorized`: the merchant disconnected. Re-lock cards and keep all history.
- **Card availability:** expose a single boolean to the app, "card available for this shop". The app uses it to show Card as locked or open in Settings, Checkout and the Home + sheet.

## Phase 4: Card payments backend (Stripe Terminal)

- **Locations:** one Terminal Location per shop, created **on the connected account**.
- **Connection tokens:** an endpoint that creates tokens on the connected account (the `Stripe-Account` header), for both the web SDK and the native SDKs.
- **Reader registration:** for smart readers. M2 and Tap to Pay are discovered by the native SDK and recorded in `readers` once they connect.
- **Creating a card tender:** creates a PaymentIntent **on the connected account** with:
  - payment method types: in-person card;
  - **manual capture**;
  - `application_fee_amount` from `clear_card_fee`;
  - metadata linking it to the order and tender;
  - an idempotency key.
- **Capture at Close the day,** with the final amount including any adjusted tip. Also a **safety capture job** that captures anything still uncaptured well before the authorisation window ends.
- **Void:** cancels an uncaptured PaymentIntent. **Refund** applies to captured payments. Whether the application fee is refunded is a setting read from the shop's terms; default it to *not refunded* until decided.
- **Webhook processing** (via the inbox): PaymentIntent succeeded, failed and canceled; refunds; disputes; payouts. Every state change posts to the ledger through the ledger service.
- **Test mode:** everything must work end to end with Stripe's simulated readers.

## Phase 5: What the app side needs from the server

The Capacitor shell and the Terminal plugin are built by the UI prompt. This prompt provides the server side they call, typed in `packages/merchant-contracts`:
- A **connection token** endpoint (on the connected account), usable by both the web SDK and the native SDKs.
- **Reader registration** for smart readers, and an endpoint to record M2 and Tap to Pay readers once the app connects them.
- **Card availability** per shop, and the shop's **offline card setting** with its per-payment limit.
- **Create, capture and cancel** for card tenders, returning what the app needs to collect the payment on the reader.

Coordinate with the UI prompt on the flow for collecting a payment: the app collects on the reader with the SDK, and the server creates, captures and cancels.

## Phase 6: Checkout

- **Order service:**
  - Create and update the cart, including options and quick sales.
  - Apply one discount, enforcing the role limit and the PIN override.
  - Calculate tax through **Stripe Tax's calculation API** per line and tax kind. The tax is recorded as a Stripe tax transaction after payment.
- **Tip:** recorded on the tender it is paid with.
- **Tenders:**
  - **Clear:** calls the existing protocol flow. Below the pay-over-time minimum, pay now only. The minimum is a Clear setting ($50.00 placeholder).
  - **Card:** Phase 4.
  - **Cash:** amount handed over, change, a ledger posting, and the drawer opens.
  - **Split:** multiple tenders against the order's remaining balance.
- **Stock:** hold on raise, commit on paid, release on declined, expired or cancelled. Holds must show on items ("6 left · 2 held").
- **Receipts:** text, email or none, plus print. Receipts show lines, discount, tax, tip, and each tender.

## Phase 7: The drawer and Close the day

- Opening the drawer with starting cash (first person on only).
- **Blind double counts, enforced by the API.** Compare only when both are saved. If the two counts disagree, ask for a recount. If they agree but differ from expected, record the note and require a sign-off by someone who is not the first counter. Apply the one-person close setting.
- Tips owed per person: card tips paid with payroll, cash tips paid from the drawer.
- **Close the day:**
  - Captures card authorisations.
  - Writes the immutable day report.
  - Computes "leave for tomorrow" and "to the bank".
  - Blocks while a difference is unsigned.
- "Mark deposited" posts the deposit and flips the Payouts row out of amber.

## Phase 8: Payouts, reporting and reconciliation

- **Card deposits:** sync the connected account's payouts and balance transactions. Build the per-deposit "card processing" figure from Stripe's fee details, showing Stripe's fee and the application fee separately. Never compute it from our own fee rule.
- **Nightly reconciliation job:** compare ledger postings to Stripe balance transactions per shop and flag mismatches.
- **Overview:** summary views over orders and the ledger. They feed sales by payment method, discounts, tips, tax collected, top items, and end-of-day reports.

## Phase 9: The card-connector interface

- Define the interface: connect or onboard; availability; locations and readers; create payment; capture; cancel; refund; payouts sync; fee-data sync; and **whether the provider supports a platform fee**.
- Move the Stripe code behind it. Leave a stub and a written note on what a Square connector needs. Include a fallback for providers without a platform fee: bill Clear's fee monthly from the merchant's cash account.

## Phase 10: Hardening and pilot

- **Security and robustness:** Stripe webhook signature checks, rate limits on PIN entry, an audit log of every money-moving action (who, what, when), and a check that no fee or tax is accepted from the client.
- **End-to-end tests with simulated readers,** covering:
  - A split sale where the card part is declined.
  - Void before close.
  - A tip adjustment before close.
  - A partial refund of goods with restock.
  - A short drawer through sign-off and close.
  - A merchant disconnecting Stripe mid-day.
- **A pilot checklist for Mike's Tire:** one M2, Tap to Pay on one phone, a week of real closes, and reconciliation reviewed daily.

---

## Out of scope for this work

- The Clear refund's protocol unwinding. Leave a marked seam.
- Square or any second provider's implementation.
- Order call-out screens for food trucks.
- Paid-plan pricing, beyond making the plan fee configurable.
