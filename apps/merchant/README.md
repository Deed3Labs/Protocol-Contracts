# Clear for Merchants

Scaffolded in Phase 3. Staff at a counter raise charges here; owners manage
payouts, staff and refunds. Deploys to `merchant.useclear.org`.

Design reference: [`docs/merchant-reference/`](../../docs/merchant-reference/) — one file per screen, every state and width.

Network-originated transactions only. A Clear code, approved in the member app, settles on Clear's
rails and lands here. A card tap never does. This is the Clear half of the counter.

One tender, whatever backs it. A funded balance is collateral for a fully secured draw, not a second
tender — so balance and line are the same charge, and the merchant sees one thing. Hence `approved`
and `isFinanced` gating refunds: the design, not a phase.

Either the shop's point of sale, or a settlement surface beside an incumbent system the merchant's
category requires them to keep. Per-merchant terms — payout window, approval cap, discount — live
in `MerchantRegistry`.

## The installed app

The same build, wrapped with Capacitor for iOS and Android (`ios/`, `android/`). It adds the
Stripe Reader M2 over Bluetooth and Tap to Pay; a browser has smart readers only. Screens reach a
reader only through `src/reader`.

```
npm run cap:ios       # build, sync, open in Xcode
npm run cap:android   # build, sync, open in Android Studio
```

Needs Xcode (iOS) or Android Studio (Android). Set `VITE_API_BASE_URL` to the API's full URL,
since the installed app doesn't serve its own `/api`. See DECISIONS.md, "Phase 5", for what's
still open, including Apple's Tap to Pay entitlement.

