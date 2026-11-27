# What a Square connector needs

Square is the second card provider the prompt names. Phase 9 of the card-processing prompt says not to build it yet, and to leave a stub and a note on what building it takes. The stub is `squareConnector.ts`. This is the note.

The Square facts here were checked against developer.squareup.com on 2026-09-25 (API version 2026-09-16), and each links to the page it came from. Where the docs didn't say something, it's marked **unconfirmed**. Check again before building, because these pages change.

## The short version

Square fits the connector interface with no change to the rest of the back office. Most of it maps one-for-one:
- **Clear's fee** comes off each sale through `app_fee_money` (`supportsPlatformFee: true`), so a Square shop is never billed monthly.
- **Delayed capture** works, but holds only **36 hours** (`authorisationHoldMs`), so the safety capture acts at 24 hours instead of Stripe's 36.
- **Tips** change through `UpdatePayment`.
- **Voids** are `CancelPayment`. **Refunds** are `RefundPayment`, which can give the app fee back or keep it.
- **Deposits** come from the Payouts API.

The real work is in three places:
1. **Onboarding is OAuth into an account the seller already has.** Square opens no accounts for a platform, so there's no equivalent of `createAccount`.
2. **Readers.** A plain browser can drive only the Square Terminal, through the server. The Square Reader and Tap to Pay need Square's native Mobile Payments SDK, which has no web or Capacitor plugin.
3. **Its own webhook inbox**, with a different signature scheme.

## Interface, method by method

| Connector method | Square |
|---|---|
| `createAccount` | **No equivalent.** The seller signs in to their existing Square account through OAuth ([OAuth overview](https://developer.squareup.com/docs/oauth-api/overview)). Whether a seller can sign up for Square partway through the OAuth flow is **unconfirmed**. `connectCards` would create the connector row when OAuth completes, not before. |
| `onboardingLink` | The OAuth authorize URL, using the code flow for a server app. The code expires after 5 minutes. |
| `accountStatus` | Whether the token is valid, the scopes granted, and that the seller has an active location. Square has no `charges_enabled` flag to read. |
| `dashboardUrl` | The seller's Square Dashboard. |
| `createLocation` / `updateLocation` | Square Locations. A Terminal is paired to one location. |
| `connectionToken` | **Not used for the Terminal**, which is server-driven. It would be needed only if a native Mobile Payments SDK is added later, and that SDK authorizes with the OAuth token, not a connection token. |
| `registerReader` | `CreateDeviceCode` with `product_type: TERMINAL_API` and the location. The seller has 5 minutes to enter the code on the Terminal. The `device.code.paired` webhook gives the `device_id` ([Terminal integration](https://developer.squareup.com/docs/terminal-api/integrate-square-terminal)). |
| `createPayment` + `presentOnReader` | `CreateTerminalCheckout` on the device, with `payment_options.autocomplete: false`, `delay_duration` up to 36 hours, `delay_action: CANCEL`, and `app_fee_money`. The checkout times out after 5 minutes by default (`deadline_duration`) ([CreateTerminalCheckout](https://developer.squareup.com/reference/square/terminal-api/create-terminal-checkout), [PaymentOptions](https://developer.squareup.com/reference/square/objects/PaymentOptions)). Square has one call where Stripe has two, so `createPayment` records the intent and `presentOnReader` creates the checkout. |
| `clearReader` | `CancelTerminalCheckout`. |
| `getPayment` | `GetPayment`. APPROVED means `authorised`, COMPLETED means `captured`, CANCELED or FAILED means `cancelled`. |
| `raiseAuthorisation` | `UpdatePayment` on an APPROVED payment, changing `tip_money`, `amount_money` and `app_fee_money`. What's allowed shows in the payment's `capabilities` (`EDIT_TIP_AMOUNT_UP`, `EDIT_AMOUNT_UP`). An increase over the cap returns `AMOUNT_TOO_HIGH`, which maps to `CardDeclined` ([Update payments](https://developer.squareup.com/docs/payments-api/update-payments)). `incrementalSupported` comes from those capabilities. Whether Square has a named "incremental authorization" feature is **unconfirmed**. |
| `capture` | `CompletePayment`. Clear's fee is set on the payment beforehand with `UpdatePayment` (`app_fee_money`), because CompletePayment takes no amounts. |
| `cancel` | `CancelPayment` on an APPROVED payment ([delayed capture](https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture)). |
| `refund` | `RefundPayment`. The app fee is refunded in proportion by default. Pass `app_fee_money` of 0 to keep it, which is our `refundApplicationFee: false`. The fee refund comes out of Clear's Square balance ([refunds with app fees](https://developer.squareup.com/docs/payments-api/collect-fees/payment-with-app-fee-refund)). |
| `getPayout` / `listPayouts` | `GetPayout` and `ListPayouts`, which list by location. The statuses are SENT, PAID and FAILED; SENT maps to our `in_transit` ([Payouts API](https://developer.squareup.com/docs/payouts-api/overview)). |
| `payoutItems` | `ListPayoutEntries`, whose entry types are CHARGE, REFUND, FEE and DEPOSIT_FEE, each with gross, fee and net. **Unconfirmed:** whether Clear's app fee shows as its own entry. If it doesn't, take it from each payment's `app_fee_money` and the processor's fee from `processing_fee[]` ([Payment object](https://developer.squareup.com/reference/square/objects/Payment)). Either way it's the processor's figure, never our fee rule. |
| `balanceItems` | Payments and refunds since a date, with `processing_fee[]` and `app_fee_money`, for reconciliation. |

## Clear's fee
- **Supported on:** `app_fee_money` on CreatePayment, UpdatePayment, RefundPayment and CreateTerminalCheckout. It goes to the developer's own Square account ([collect fees](https://developer.squareup.com/docs/payments-api/take-payments-and-collect-fees)).
- **Limits:**
  - Card payments only; there's no app fee on cash or external payments.
  - Up to 90% of the total, or 60% below $5.00. Our 30¢ on sales of $10 or more is well inside that.
  - Clear's Square developer account must be US-based, like the sellers.
- **Needs:** an OAuth token and the `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` scope ([Terminal payments](https://developer.squareup.com/docs/terminal-api/square-terminal-payments)).
- **Disputes:** Clear keeps its fee when the seller is liable.

## OAuth and tokens
- **Scopes:**
  - `PAYMENTS_WRITE` and `PAYMENTS_READ`
  - `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS`
  - `DEVICE_CREDENTIAL_MANAGEMENT`
  - `PAYOUTS_READ`
  - `MERCHANT_PROFILE_READ`
  - `PAYMENTS_WRITE_IN_PERSON`, only if the Mobile Payments SDK is added ([permissions](https://developer.squareup.com/docs/oauth-api/square-permissions)).
- **Token lifetime:** access tokens last 30 days. Code-flow refresh tokens don't expire unless revoked. Square recommends refreshing every 7 days or less ([refresh and revoke](https://developer.squareup.com/docs/oauth-api/refresh-revoke-limit-scope)).
- **What that needs from us:**
  - Storage for encrypted tokens on the connector row, which Stripe never needed because Connect uses the platform key.
  - A refresh job.
  - Treating a revoked token as `charges_enabled: false`, so cards lock the way they do when a Stripe account is disabled.

## Readers and the app
- **Square Terminal (Terminal API):** server-driven, and usable from any web app. This is the only Square reader a browser can use, the same role Stripe's smart readers play ([payments overview](https://developer.squareup.com/docs/payments-overview)).
- **Square Reader and Tap to Pay:** need the **Mobile Payments SDK**, which is native iOS and Android only, with React Native and Flutter plugins. The Capacitor app would need a custom native plugin. Square's Reader SDK was retired on 2025-12-31 ([Mobile Payments SDK](https://developer.squareup.com/docs/mobile-payments-sdk)).
- **Offline:** in beta on the Mobile Payments SDK:
  - Each seller must opt in.
  - Up to 1,000 stored payments, with a 24-hour window to reconnect.
  - The seller carries the risk.

  Whether offline works for Terminal API checkouts is **unconfirmed** ([offline payments](https://developer.squareup.com/docs/mobile-payments-sdk/android/offline-payments)).
- **App side:** a `platform.ts` entry for Square's reader types. The contract's `Reader.type` would need a `square_terminal` value, or smart readers widened to cover it; either is a contract change to flag.

## Webhooks
- **Signature:** an HMAC-SHA256 over the notification URL plus the raw body, keyed with the subscription's signature key and Base64-encoded, sent in `x-square-hmacsha256-signature`. Compare it in constant time ([validate](https://developer.squareup.com/docs/webhooks/step3validate)).
- **Events:**
  - `payment.created` and `payment.updated`
  - `terminal.checkout.updated`
  - `device.code.paired`
  - `payout.sent`, `payout.paid` and `payout.failed`
  - the OAuth revocation event
- **Where it goes:** its own inbox and handlers beside `stripeEvents/`, following the same pattern (store, acknowledge, drain with SKIP LOCKED, handle in the event's transaction), with `payments.stripe_events` generalized or a sibling table.

## Idempotency keys
Square **requires** idempotency keys and caps their length: **45 characters on CreatePayment** and 64 on CreateTerminalCheckout ([idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)). Our keys run to about 53 (`clear-tender:tnd_<uuid>`). The connector must shorten them deterministically, for example with a hash, so a retry still sends the same key. How long Square keeps keys is **unconfirmed**.

## To switch it on
1. Build `squareConnector.ts` against the table above, with a fake-provider test pass like Stripe's.
2. Add token storage and refresh (a migration) and the Square webhook inbox.
3. In `registry.ts`, return the connector when it's configured, and decide how a shop chooses a processor. Today `connectorForNewShops` is always Stripe.
4. On the app side, add the Terminal flow and, if wanted, a native plugin for Reader and Tap to Pay.
