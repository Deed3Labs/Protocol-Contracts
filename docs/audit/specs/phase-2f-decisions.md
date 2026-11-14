# Phase 2f: owner decisions (Nov 14, 2026)

## Earn
- **Build from the full spec,** `earn-contract-requirements.md` (Earn Addenda 1 and 2 are already merged into it), using the definitions in `earn-glossary.md`. Where a built contract lacks a concept the spec relies on (Funding Limit, Reserve Shortfall, Enforcement Notice, Suspension, Successor, Final Maturity, Equity Cushion, the Collateral Agent role, and so on), add it as the spec describes. If adding one would be a large redesign, STOP and list it rather than choosing.
- **§6A Maximum age (addition):** while a posted loss charge is pending, age releases wait until its batches complete. (Already in the full spec's §6A.)
- **Order:** Phase 2f runs after Phase 2e, which also changes BurnerBond, CollateralRegistry and the Liquidator.
- **Overlap with 2e:** the BurnerBond pieces of this spec (`payPledged`, the `settle` split, the transfer allowlist, the signed Maturity Instruction on pledges) are built in Phase 2e from `addendum-2.md`. Phase 2f builds the rest of the Earn spec on top.

## ELPA (Addendum 3)
The owner accepted the recommendation, with one distinction:
- **What ELPA is not:** it is NOT credit, a term plan or a mortgage. Remove it from the credit view, the term-plan views and TermIssuer's description ("the ELPA that buys a home" is wrong).
- **Two monthly parts (MB-13 §6.1):**
  1. **Equity Contribution:**
     - Chosen by the member, with a minimum of 0.30% of the Structure Price. It is equity, never a debt (MB-13 §6.3).
     - Show it as progress toward Redemption: the equity balance and a projected Redemption date.
     - No due, past-due or late states, no reminders or dunning, and never used in limits, credit decisions or reports.
     - The only allowed contact is one informational check-in after six consecutive months below the minimum (outside a pause).
  2. **Community Fee** (MB-14 Article 5: ground rent, property, community and service charges):
     - This IS owed, due on the 1st of each month.
     - Show it as a housing bill, separate from credit, with a normal due date.
     - It never appears in the credit view or affects credit limits.
- **Where it gets built:** mainly the apps, plus correcting TermIssuer's description. No contract records ELPA payments today.
