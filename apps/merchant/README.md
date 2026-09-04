# Clear for Merchants

Scaffolded in Phase 3. Staff at a counter raise charges here; owners manage
payouts, staff and refunds. Deploys to `merchants.useclear.org`.

Design reference: [`docs/ux/clear-merchant-app-reference.html`](../../docs/ux/clear-merchant-app-reference.html).

Network-originated transactions only. What reaches this app is a charge raised as a Clear code and
approved in the member app — the QR path, on Clear's own rails. A card tap, a Clear card included,
runs on ordinary card rails and never appears here. One counter takes both.

One tender, whatever backs it. Paying from a funded balance and drawing on a line are the same
transaction here — the balance is collateral for a fully secured draw, not a second tender. Both
are charge-and-settle through the ledger, which is why the settled state is `approved` and
`isFinanced` gates refunds. That is the design, not a phase.

The app is built to work either as the shop's point of sale, where nothing else is mandated, or as
a settlement surface beside an incumbent system the merchant's category requires them to keep.
Per-merchant terms — payout window, approval cap, discount — live in `MerchantRegistry`.
