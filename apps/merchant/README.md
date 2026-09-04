# Clear for Merchants

Scaffolded in Phase 3. Staff at a counter raise financed charges here; owners manage
payouts, staff and refunds. Deploys to `merchants.useclear.org`.

Design reference: [`docs/ux/clear-merchant-app-reference.html`](../../docs/ux/clear-merchant-app-reference.html).

Network-originated transactions only. What reaches this app is a charge raised as a Clear code and
approved in the member app — the QR path, on Clear's own rails. A card tap, a Clear card included,
runs on ordinary card rails and never appears here. One counter takes both.

Today every network-originated charge opens a term plan, which is why the settled state is
`approved` and `isFinanced` gates refunds. That is the current product, not the boundary.
