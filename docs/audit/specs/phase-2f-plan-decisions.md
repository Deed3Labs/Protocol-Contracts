# Phase 2f plan: the owner's decisions (Nov 14, 2026), binding

The owner accepted every recommendation on the decision list drawn from `docs/audit/PHASE-2F-PLAN.md`. These control where they differ from the plan, the Earn spec or earlier decisions.

## New contracts
1. **Build the large pieces as the plan proposes:**
   - the Yield Pool: **`LendingPool` is the Yield Pool** and is reworked to the spec (decision 16), with a holdback and valuation module;
   - a `CollateralAgent` for the Enforcement Notice;
   - the reserve schedule and the 90-day 100% reserve, in BondVault on its maturity tree;
   - compounding `accretedValue` in a new bond collection;
   - one `EarnControls` contract for the Funding Limit, offering cap, eligibility, holder cap, Ladder, Successor and transfer policy;
   - `buyback`/`redeemAll` in the bond's pledge module;
   - Final Maturity.
2. **A separate 7-day Earn timelock** governs these contracts instead of the credit timelock, overriding DECISIONS #10.

## Conflicts
3. **C1:** remove `lendToPayoutPool`, and allow BondVault's excess out only to the single multisig the spec names. Once PayoutPool's loans are repaid, switch off its vault and pool funding by configuration. PayoutPool's code is unchanged. This overrides DECISIONS #3.
4. **C2:** a missed cycle takes no collateral at all, pool shares included, per MB-05 §6.1. It still halves the limit and counts toward default. This reverses the Phase 2e "pool shares only" answer.
5. **C3:** keep Phase 2e's `payPledged` and pledged-split payments out of the vault as named outflows to the Holder's own debt. They are blocked while an Enforcement Notice is in force.
6. **C4:** in the new pool, queued shares keep earning and fill at the current Share Value, per the spec. This replaces audit fix X-7's cap at the value when queued.
7. **C5:** no seizure of pool shares. Enforcement redeems them through the queue, and `seizeShares` and the Liquidator's exemption are removed.
8. **C7:** today's reserve terms, straight-line value, discount-curve pricing and Holder-only roll are replaced by the spec's versions.

## Enforcement
9. **A pledge secures all of the member's MB-05 secured debt; there is no per-plan link.** A plan is secured by the member's own signature, as in Phase 2e. Counsel is to confirm this against MB-05's "Secured Obligations" definition and Article 7 order.
10. **On a secured-plan default, take bonds first, then pool shares.** Pool-share enforcement moves out of the Liquidator into a new `PoolShareEnforcer`, which redeems only the shares still needed, through the queue, and pays the plans oldest first. The surplus goes to the Holder.

## Details
11. **`postRollNotice` records the roll term and yield on chain** as well as the notice hash.
12. **Funding Limit:** outstanding bonds count at their Maturity Amount, plus pool shares at Share Value. **Offering cap:** the cumulative purchase price taken in the offering.
13. **The 10% holder cap counts per member,** across all of the member's wallets.
14. **A pledged bond under `redeemAll`** settles through Phase 2e's pledged split: debt first, then the rest to the Holder.
15. **After Final Maturity, shares run off in queue order.**

## The Yield Pool is LendingPool (owner, Nov 14, 2026)
16. **`LendingPool` becomes the Yield Pool by an in-place UUPS upgrade.** It keeps its name, address and balances, and its storage is append-only against the Base Sepolia implementation. It gains:
    - Share Value from Pool Assets: Vault Cash, the Deployed Balance and accrued Pool Interest;
    - Deployments and Returns;
    - the Loss Holdback and valuation, in a separate module for size;
    - the redemption queue filling at Share Value (C4);
    - Suspension and Final Maturity.

    `seizeShares` and the Liquidator's share-seizure exemption are removed in stage 2, together with the `PoolShareEnforcer` (C5).
17. **Only Clear Lending draws from the pool, and each draw is a recorded Deployment.** Borrowing is limited to Clear Lending's deployment address. PayoutPool's and the card settler's direct borrowing is switched off by configuration (consistent with C1), and Clear Lending funds card settlement from what it draws.
    - App follow-up: the card and auto-clear funding paths in the held app PRs (#887, #890) must stop drawing from the pool directly.

## Documents needed
- **IV-10 Exhibit A:** the Collateral Agent waits for it. The spec says to follow it exactly.
- **MB-05 in full:** for Article 7's order and the "Secured Obligations" definition.

## Build order
1. **Stage 1, new files only, alongside Phase 2g:**
   - Agent A reworks `LendingPool` into the Yield Pool with its holdback module (decisions 16–17), tests 11–15 and 20–25.
   - Agent B builds `EarnControls`, the compounding library and the Earn timelock script, and `CollateralAgent` once Exhibit A arrives.
2. **Stage 2, after Phase 2g merges:** the bond contracts, BondVault, CollateralRegistry, the Liquidator slim-down with `PoolShareEnforcer`, and the deploy configuration.
3. **Stage 3:** integration, storage reports, Slither and the 2f report.
