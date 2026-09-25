# Pilot checklist: Mike's Tire

Phase 10 of the card-processing prompt asks for a checklist for the first real shop:

- one Stripe Reader M2
- Tap to Pay on one phone
- a week of real closes
- reconciliation reviewed every day

This is that checklist. It was first written after the backend phases (PRs #593–#608) and brought up to date on 2026-09-25, after the merchant app was wired to the API (UI Phases 3–7, PRs #610–#621) and the audit's pilot fixes (#623–#628). It says plainly what isn't ready yet.

Work down it in order.

---

## 0. Where the app stands

**Live on a real shop**, against the API:
- **Selling:** the catalogue or a typed amount, tax and discounts worked out by the server, tips, then Clear, card (smart reader in a browser; M2 and Tap to Pay in the installed app), cash or a split.
- **Receipts:** texted (Twilio), emailed (Resend) or printed through the tablet's print dialog.
- **Charges:** every sale, however it was paid. Void (a manager's PIN), adjust a tip before capture, refund goods back into stock, and the whole Clear refund.
- **The drawer and Close the day:** blind counts, sign-off of a difference, capture of the day's cards, the day report.
- **Staff:** adding people, who pick their own PIN on their first shift. Resetting a PIN, removing someone, shifts and breaks, and each person's weekly hours.
- **Inventory:** items, options, stock, reorders.
- **Settings:** the shop's listing and hours, Counter (breaks, the PIN lock), Payments, Devices, Tax, Tips, Discounts, Closing.
- **Overview and Payouts:** the month, card deposits, Clear's fees and the payout position.

**Not built yet** (none of these blocks the pilot):
- Adding a bank, withdrawing to a bank by ACH, and statements. Plaid and Bridge are chosen for bank linking.
- The end-of-day summary by email.
- Splitting tips by hours. The shift clock now records hours, but tips still go to whoever raised the charge.

**Before the dress rehearsal:**
- [ ] `bun run e2e:live` (apps/api) passes against Stripe test mode: the six Phase 10 stories and the audit trail. It passed 7/7 on `dev` on 2026-09-25; rerun it on the commit that ships.
- [ ] `bun run e2e:contract` passes: every `MerchantApi` method against the real API.
- [ ] The Connect webhook's signing secret is set (section 1). Until it is, card holds and captures still work from the app, but Stripe's updates never arrive: disconnects, payouts, refunds settling.

## 1. Accounts and settings (the owner of Clear's Stripe and Railway does these)

Clear never enters keys into service settings for you. Set these yourself.

**Railway, apps/api service:**
- [ ] `STRIPE_SECRET_KEY`: Clear's platform key. **Live** for the pilot (`sk_live_…`); test for any dress rehearsal.
- [ ] `STRIPE_CONNECT_WEBHOOK_SECRET`: the **signing secret** of the Connect webhook endpoint below. It starts `whsec_`. The endpoint's id (`we_…`) is not it. On dev this still holds the endpoint id (checked 2026-09-25).
- [ ] `MERCHANT_APP_URL`: where the merchant app is served. Onboarding and receipt links point back to it.
- [ ] `SEND_TWILIO_ACCOUNT_SID`, `SEND_TWILIO_AUTH_TOKEN`, and `SEND_TWILIO_MESSAGING_SERVICE_SID` (or `SEND_TWILIO_FROM_PHONE_NUMBER`): texted receipts. These are set on dev.
- [ ] Leave `CLEAR_FEE_COLLECTION_ADDRESS` **unset**. Stripe takes Clear's fee per sale, so monthly billing never applies to Mike's Tire.

**Stripe Dashboard, Clear's platform account:**
- [ ] Connect is on, with Standard accounts, and the platform profile and branding are complete.
- [ ] Terminal is on.
- [ ] **A Connect webhook endpoint** at `https://<api>/api/stripe/webhooks/connect`, listening to events on connected accounts, subscribed to:
  - `account.updated`, `account.application.deauthorized`
  - `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
  - `terminal.reader.action_succeeded`, `terminal.reader.action_failed`
  - `refund.updated`, `refund.failed`, `charge.refund.updated`
  - `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`
  - `charge.dispute.created`
- [ ] **Stripe Tax: register California** on Clear's own account. The address-rate fallback looks up a shop's rate on Clear's account, and treats "not registered" as unknown, never 0%. Until Mike's Tire turns on Stripe Tax in its own account, this is where its rate comes from.

**Not yet available (decide before the pilot, or go without):**
- [ ] **Email (receipts, statements to an accountant):** `RESEND_API_KEY` and `RESEND_FROM` (for example `Mike’s Tire via Clear <receipts@useclear.org>`), with that domain verified in Resend. Without them, text and printed receipts work and statements save as PDF.
- [ ] **Splitting tips by hours:** the shift clock records hours now, but splitting isn't built. Tips go to whoever raised the charge.

## 2. The installed app and Tap to Pay

The M2 and Tap to Pay work only in the installed app (Capacitor, `org.useclear.merchant`). A plain browser can drive smart readers only.

- [ ] **A native build machine:** Xcode for iOS, and the Android SDK and Java for Android. The Mac these phases were built on has neither, so the native shells have never been compiled.
- [ ] **Tap to Pay on iPhone:** Apple's Tap to Pay entitlement has to be granted to Clear's developer account for `org.useclear.merchant` before an iPhone can take a tap. Request it early; it's Apple's review, on Apple's timeline. Check Stripe's and Apple's current requirements for supported iPhone models and iOS versions when you request it.
- [ ] **Or Tap to Pay on Android:** no Apple entitlement is needed. Check Stripe's current Android Tap to Pay requirements for the phone.
- [ ] **Distribution:** TestFlight (iOS) or an internal track (Android) to Mike's phone and the counter tablet.
- [ ] **No offline payments:** the Capacitor Terminal plugin has no store-and-forward, so offline is switched off (`OFFLINE_BUILT` in `reader/platform.ts`). If the shop's internet drops, cards stop until it's back; cash carries on. Tell Mike.

## 3. Hardware

- [ ] One **Stripe Reader M2**, ordered through Stripe for Mike's Tire's own account, charged, and on current firmware.
- [ ] The **phone for Tap to Pay**, meeting section 2.
- [ ] The **counter tablet**, enrolled as Mike's Tire's device.
- [ ] A cash drawer, with the starting float agreed ($150 by default; change it in Settings).

## 4. Setting up Mike's Tire

- [ ] **Clear onboarding** is complete: the shop's address (it sets the reader location and the tax rate), the payout bank, and the owner signed in.
- [ ] **Connect Stripe** from Settings:
  - Mike completes Stripe's hosted onboarding for his own Standard account.
  - Cards stay locked until Stripe reports **charges enabled**. Check that Settings shows cards available.
- [ ] **Staff are added** in Staff. Each picks their own four-digit PIN on their first shift ("Pick a PIN" on the shift screen). A PIN someone else has is refused. **Roles:**
  - Mike is the owner.
  - At least one **manager**, because refunds, voids, discounts over the limit and drawer differences need a manager's or owner's PIN.
  - Counter staff.
- [ ] **Each person's hours** are set in Staff, so the week shows cover, and Home's clock shows each shift's end.
- [ ] **The shop's hours**, listing and contact are set in Settings › Shop, and the breaks rule in Settings › Counter.
- [ ] **Discount limits** are agreed: counter 10%, manager 25%, owner no limit.
- [ ] **The one-person close setting** is chosen: either one count signed off by the owner the next morning, or wait for a second person.
- [ ] **The catalog** is entered, with the right **tax kind** on each item:
  - tires and parts: goods
  - mounting and labour: labour, not taxed
- [ ] **Stock counts** are entered for the tires.
- [ ] **The M2 is paired** in the installed app, and Tap to Pay is set up on the phone.

## 5. Dress rehearsal (the day before, in the shop)

Run each of the six stories once, with a real card and real (small) amounts, then refund them.

- [ ] **A split sale:** part cash, part card. Try a card that declines if you have one. Check the cash part stays paid and the order still shows what's owed.
- [ ] **Void before close:** a counter worker can't do it; a manager's PIN can. Check the card shows no charge afterwards.
- [ ] **A tip added after the tap:** raise the tip on a sale before close. If the card can't take the higher hold, the app says so, and the tip is taken another way.
- [ ] **A partial refund with restock:** refund one of two tires, marked "back in stock". Check it's on the shelf again.
- [ ] **A short drawer:** count $5 short on both blind counts. Close is refused until a manager (not the first counter) signs it off.
- [ ] **Close the day:** check the day report, and that the day's cards show as captured in Mike's Stripe Dashboard.

## 6. The pilot week: every day

**At close:**
- [ ] Two blind counts, then sign off any difference, then Close the day.
- [ ] If close lists a card it couldn't capture, act the same day (see "When something's off").

**Next morning, reconciliation (owner or Clear):**
- [ ] **Reconciliation flags:** open ones are on Payouts, under "Checked against Stripe" (and at `GET /api/merchant/reconciliation`). Each is explained there once looked into. Each flag should be understood and either resolved or explained. The flags are:
  - `charge_without_tender`, `tender_without_charge`, `amount_mismatch`, `fee_mismatch`
  - `payout_unbooked`, `payout_mismatch`, `payout_breakdown`
  - `card_stranded`
- [ ] **Card deposits:** Stripe's payout, as it reaches the bank, matches the deposit in Clear, with Stripe's fee and Clear's fee shown apart. Clear's fee is 30¢ on card sales of $10.00 or more.
- [ ] **The day report** agrees with the drawer and the Overview: sales by method, tips, tax, refunds.
- [ ] **The audit trail** (`GET /api/merchant/audit`, owners only): look over the day's voids, refunds and overrides.

## 7. When something's off

- **A card stranded after a disconnect:**
  - If Stripe was disconnected from Mike's Tire while a card was authorised, Clear can't capture it.
  - Close names it with the time the hold lapses, and reconciliation flags `card_stranded`.
  - Mike captures it in his Stripe Dashboard before then, or the sale goes unpaid.
  - Once he has, Explain on Payouts records what he did, and the flag closes.
- **A PIN lockout:** ten wrong PINs in 15 minutes lock every PIN at the shop, shifts and approvals alike. It reopens by itself as they age out, and the screen says when. Nobody can clear it early, by design.
- **A drawer that won't close:**
  - The message names the reason: part-paid orders, counts missing or disagreeing, or a difference not yet signed off.
  - Counts that disagree are fixed by one counter counting again.
- **A payout that doesn't add up** (`payout_breakdown`): it's shown, not booked. Compare it with the payout in Stripe's Dashboard.
- **Cards say "not available":**
  - Check Settings for the reason: not connected, details pending, charges disabled, or disconnected.
  - Cash always works.

## 8. After the week

- [ ] Every day closed, and every reconciliation flag resolved or explained.
- [ ] Every Stripe payout for the week matched to a card deposit and to the bank.
- [ ] Mike's and his staff's notes on what was slow or confusing at the counter.
- [ ] A decision on the open items (email receipts, offline, the Tap to Pay platform, splitting tips by hours) before a second shop.
