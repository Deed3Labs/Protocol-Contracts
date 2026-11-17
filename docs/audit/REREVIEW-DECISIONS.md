# Owner decisions on the Phase 4 re-review (2026-11-14)

The owner accepted the recommendations in `REREVIEW.md` section 3, with one change, on L-D. Options are as labelled there.

| Item | Decision | Built in |
|---|---|---|
| M-C | (a) Keep `defaultedAt`. Liquidation is keyed to the current default episode: `defaultedAt[member] >= lineOpenedAt[member]`, which needs a stored line-open time (append-only). | Phase 4b |
| M-E | (a) `registerIssuer`/`deregisterIssuer` move to `DEFAULT_ADMIN_ROLE` (the credit timelock after handover). Deploy scripts 20 and 24 register with the deployer, which holds admin before handover. | Phase 4b |
| M-F | (b)+(c) `reassignValidator` takes effect after a delay (e.g. 7 days), during which the old validator may still void. A two-party un-void (validator plus protector). Burning a frozen deed stays allowed (its record is kept), for counsel to confirm. | Phase 4b |
| M-G | (a) The standby may post the licensing determination, but promotion needs the protector's EIP-712 consent, or the holder's while the protector record is zero. The protector's and trustee's own calls are unchanged. This changes Addendum 2; note it for the drafting. | Phase 4b |
| L-B | (a) The revolving issuer calls `ClearUSDUpgradeable.syncEncumbrance(member)` after every Savings draw and card settlement, and fails closed if the registry is down. Mind RevolvingIssuer's headroom; use the existing module split if needed. | Phase 4b |
| L-C | Interim (c): keep the per-transaction, daily and per-member caps, sized small. Later (a): a card-network/processor attestation once the processor can sign. No code beyond confirming the caps are governed; still a counsel item under DFAL 10a. | Phase 4b (doc only) |
| L-D | **Changed by the owner's earlier decision to keep claim-link card and bank payouts:** NOT (b). Use (a): `ClaimEscrow.claimToPayoutTreasury` requires the sender's or the claim key's signature. ClaimEscrow is LIVE on mainnet, so this is a storage-safe logic upgrade, checked against `.openzeppelin/base.json`. | Phase 2d |
| L-E | Superseded by Phase 2d's decision #7 (the pilot measure is off chain; on chain only the revert-at-cap is removed, plus `pauseCaMints` and an off switch). Count by depositor and receiver, and require a state attestation before a member mint (DECISIONS #6's preferred mitigation). Since no stateCode now counts as CA, record how that combines. | Phase 2d |
| L-F | (b) The Clear Cash large-loan term rule (≥ $2,500 needs ≥ 365 days) is judged on the member's aggregate open CASH principal, the same aggregation as the rate cap. Counsel to confirm. | Phase 4b |
| L-G | (a) Most-expensive-first repayment orders by the effective monthly rate (after caps) at the moment of repayment, across both issuers' bands in the ledger. Pending counsel on "most expensive" for a capped position; build it with its own tests. | Phase 4b |
| L-I | (a) `CollateralRegistry.pledge`/`pledgeItem` need the member's EIP-712 signature (the operator submits). | Phase 4b |
| O-1 | (b) A priced tier keeps the member's last state's product until the new state's product launches. The member stays on the terms they had (ties to Phase 2 open question 1). | Phase 4b |
