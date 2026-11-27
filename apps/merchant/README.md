# Clear for Merchants

A full point of sale for a shop's counter: Clear payments, cards on Stripe Terminal, cash, split
payments, payment links and phone pays, with inventory, tables (Clear Terminal), close the day,
payouts, staff and settings. Deploys to `merchant.useclear.org`, and as the Clear for Merchants app
on iOS and Android.

Design reference: [`docs/merchant-reference/`](../../docs/merchant-reference/) — one file per screen, every state and width.

A Clear payment settles on Clear's rails and is paid out through the PayoutPool on the shop's terms.
A card is charged directly on the shop's own Stripe account (Connect Standard), so card money never
passes through Clear. Cash goes in the drawer.

One Clear tender, whatever backs it. A funded balance is collateral for a fully secured draw, not a second
tender — so balance and line are the same charge, and the merchant sees one thing. Hence `approved`
and `isFinanced` gating refunds: the design, not a phase.

Per-merchant terms — payout window, approval cap, discount — live in `MerchantRegistry`. How the
app is used, step by step, is in [`docs/merchants/`](../../docs/merchants/README.md).

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

