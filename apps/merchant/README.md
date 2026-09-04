# Clear for Merchants

Scaffolded in Phase 3. Staff at a counter raise charges here; owners manage
payouts, staff and refunds. Deploys to `merchants.useclear.org`.

Design reference: [`docs/ux/clear-merchant-app-reference.html`](../../docs/ux/clear-merchant-app-reference.html).

Network-originated transactions only. A Clear code, approved in the member app, settles on Clear's
rails and lands here. A card tap never does. This is the Clear half of the counter.

One tender, whatever backs it. A funded balance is collateral for a fully secured draw, not a second
tender — so balance and line are the same charge, and the merchant sees one thing. Hence `approved`
and `isFinanced` gating refunds: the design, not a phase.

Either the shop's point of sale, or a settlement surface beside an incumbent system the merchant's
category requires them to keep. Per-merchant terms — payout window, approval cap, discount — live
in `MerchantRegistry`.
