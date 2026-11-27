# Taking a card: who does what

The flow both prompts build to (card-processing prompt, Phase 5). The server creates, sends to smart
readers, voids and captures; the app only collects the card on the device's own readers. Card data
never reaches Clear's servers.

## Before the first card

| Step | Who | Endpoint |
|---|---|---|
| Connect Stripe (owner) | app → server → Stripe onboarding → back to Settings › Payments | `POST /api/merchant/cards/connect` |
| Is Card open? Settings, Checkout, the Home + sheet | app reads | `GET /api/merchant/cards/availability` |
| Shop address (sales tax, reader location) | owner | `PATCH /api/merchant/shop` |
| Payment methods, tips, offline cards and limit | everyone reads, owner changes | `GET`/`PATCH /api/merchant/settings` |
| Register a smart reader by its screen code | manager | `POST /api/merchant/cards/readers/smart` |
| Record an M2 or Tap to Pay once the app connects it | installed app | `POST /api/merchant/cards/readers` |
| Connection token + reader location (native SDK) | installed app | `POST /api/merchant/cards/connection-token` |

## One card payment

1. **Start** `POST /api/merchant/orders/:orderId/tenders/card` with amount, tip, reader and a
   retry key → `{ tenderId, clientSecret, offlineLimitCents }`. The same key replays the same
   payment; Clear's fee is the server's, never the app's.
2. **Collect**
   - *Smart reader* (browser and installed app): `POST /api/merchant/tenders/:id/present`. The
     reader asks for the card itself.
   - *M2 / Tap to Pay* (installed app): the plugin collects and confirms with `clientSecret`.
3. **Follow** `POST /api/merchant/tenders/:id/sync` until `authorised` (approved) or `declined`.
   Stripe's webhooks move it too; whichever is first wins and the other finds nothing to do.
4. **Declined**: the server voids that attempt. Ask for another card: start a new tender for what's
   still owed. Parts already paid stay paid.
5. **Cancel before the tap, or void after it**: `POST /api/merchant/tenders/:id/cancel`. Voiding an
   authorised card needs a manager or owner. A smart reader mid-authorisation refuses (409
   `reader_busy`): wait for the outcome.
6. **Tip changed later**: `POST /api/merchant/tenders/:id/tip`, before Close the day. Raising it asks
   the card for the higher hold at once; a refusal (402 `tip_declined`, 422 `tip_not_raisable`)
   leaves the first tip.
7. **Capture**: Close the day captures every authorised card at its final amount. The app never
   captures. A safety job captures anything held over 36 hours.

## What the screens say

A decline never carries the bank's reason to the counter. Reader problems are said plainly:
busy (409), offline (503), timed out (504, safe to try again).
