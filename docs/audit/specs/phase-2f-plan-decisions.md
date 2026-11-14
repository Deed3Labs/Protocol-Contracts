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

## MB-05 and IV-10 (owner, Nov 14, 2026)
The full texts are `MB-05-security-and-pledge-agreement.md` and `IV-10-burnerbond-collateral-agency-agreement.md` in this folder. MB-05 controls on the pledge and its enforcement, and IV-10 Exhibit A controls on the BondVault roles; behaviour controls over function names.

18. **The Collateral Agent follows IV-10 Exhibit A exactly.**
    - The Agent Key has only the seven Part 2 powers: `enforce`, `releaseEnforcement`, `postDistribution`, `toCollateralAccount`, `withdrawCosts` within the on-chain cap, the `approveChange` co-signature, and `rotateAgentKey` after 48 hours.
    - Part 3's limits are enforced in code, along with Part 4's key replacement (7-day timelock, which the Required Holders can block on chain), Part 5's treasury role and Part 6's events.
    - The Agent Key has no power over the pledge module, roll confirmations or the Loss Holdback, and tests prove it.
19. **During an Enforcement Period, no roll is executed,** even a confirmed one (IV-10 §7.2); the bond is paid through the Agent's distribution rounds.
    - **A pledged bond's share of each round is routed** to the Holder's MB-05 Defaulted Amount first, only while MB-05 §6.1 permits enforcement against it. The rest goes to the Holder's Smart Account.
    - The bond's ratable share is unchanged (Exhibit A Part 2, item 3); only the destination of the pledged part differs.
    - `payPledged` itself stays blocked while an Enforcement Notice is in force (C3).
    - Counsel is to confirm this reading against IV-10 §7.6.
20. **Enforcement order follows MB-05 §7.1.** Within each kind, the bond nearest to maturity is applied first, unless the member has set a different order among their Pledged Earn Positions. The member sets that order by signature, and only before a Default Notice or Shortfall notice is recorded.
    - This replaces Phase 2e's "smallest bond that covers the need, else the largest".
21. **A Shortfall is one combined Shortfall:** Asset-Backed Drawn above the total Asset-Backed Limit (MB-05 §1.3). After 72 hours it is settled from Pledged Pool Shares first, then Pledged BurnerBonds (§7.1(c)), in the smallest amount that ends it (§6.5(c)).
    - This replaces Phase 2e's separate per-kind gaps.
22. **Enforcement is capped at the Defaulted Amount** (MB-05 §§1.3, 7.2, 7.3(c)): the amount past due when the grace or cure period ends, as recorded on chain.
    - The full unpaid balance counts only once it has itself come due: a term plan at its end, or the line on its closing.
    - A default does not by itself make the whole balance due.
    - This replaces Phase 2e's need computations (`_owedIn` over whole tiers, `_securedOwedOn` over whole plans).

## Holder-cap bootstrap (owner, Nov 14, 2026)
23. **The 10% holder cap applies only above a governed floor.** As written, a cap measured against outstanding shares refuses the first subscriber, who holds 100%. `EarnControls` applies the cap only while outstanding pool assets exceed `holderCapFloor`, a 7-day Earn-timelock setting that emits an event. The 10% cap is unchanged. The floor's value is set in deploy config; the plan suggests about $1m.

## IV-02 (owner, Nov 14, 2026), binding
IV-02 in full is `IV-02-yield-pool-subscription-and-pool-share-terms.md` in this folder. It controls the Yield Pool where it differs from the Earn spec or the plan.

24. **Pool Interest (§4.6).** Interest accrues per second on the Deployed Balance at the Funding Rate, on a 365-day year. Clear Lending pays each month's interest into the Vault in USDC within 5 Business Days after month end. Only interest unpaid when due is added to the Deployed Balance (capitalized). So accrual is simple, payment is monthly, and only unpaid interest is capitalized.
25. **Recoveries (§5.4).** A recovery does not come back as Vault Cash. It is a two-person-attested accounting entry, with the same posting rules as a loss charge, that adds Pool Loss Charges not yet restored back to the Deployed Balance. It is capped at the total of those charges and raises the Share Value. Cash moves later through ordinary Returns.
26. **Valuation Event (Exhibit A, A4).** A Valuation Event has no direct on-chain effect. It obliges Clear Lending to post an updated Pool Loss Allowance within 2 Business Days. §7.1(d) makes "a Valuation Event has occurred and the update is not yet posted" a Suspension ground. On chain, this is a two-person-attested `valuationEventPending` flag, cleared by the next allowance posting; a VALUATION_PENDING Suspension is allowed only while the flag is set.
27. **Legend (§8.4).** The legend text, or its hash plus a URI, is stored in the vault's metadata and exposed in the Register views. It is written once at deployment and changed only through the standard two-person, timelocked change process.

## Notes for counsel
- **Exhibit A Part 5** says matured-bond settlements pay only to the Holder or into the BondVault. Phase 2e's maturity split (and `completeSettlement`) pays the debt part to the Holder's own debt with Clear Lending, on the Holder's signed Maturity Instruction (MB-05 §5.6). This is treated as a payment to the Holder.
- **Decision 19 versus IV-10 §7.6.**
- **MB-05 §5.3:** a raise in an advance rate may benefit existing pledges, while Phase 2e stores the rate at pledging. Use the higher of the stored and current rate, so a raise helps existing pledges and a cut does not hurt them.

## Documents
- IV-02 in full was received on Nov 14, 2026, and is in this folder.
- IV-10 (with Exhibit A) and MB-05 in full were received on Nov 14, 2026, and are in this folder.

## Build order
1. **Stage 1, new files only, alongside Phase 2g:**
   - Agent A reworks `LendingPool` into the Yield Pool with its holdback module (decisions 16–17), tests 11–15 and 20–25.
   - Agent B builds `EarnControls`, the compounding library and the Earn timelock script, and `CollateralAgent` once Exhibit A arrives.
2. **Stage 2, after Phase 2g merges:** the bond contracts, BondVault, CollateralRegistry, the Liquidator slim-down with `PoolShareEnforcer`, and the deploy configuration.
3. **Stage 3:** integration, storage reports, Slither and the 2f report.
