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
28. **Direct USDC transfers count as Vault Cash (§1.2).** USDC sent straight to the vault is Vault Cash and raises the Share Value at once, as built. There is no sweep or recovery function (§4.7), and a direct transfer is a valid way for a future return-generating contract to add value to the pool. The virtual-share protection already in the vault and the $250 minimum stay. IV-02 Exhibit A, A6 now says this: a donation can only raise the Share Value, ratably for all Holders.
29. **An empty pool restarts at $1.00.** If every Pool Share has been redeemed and USDC is still in the vault (for example from a direct transfer), the next subscription is issued at $1.00 per share. The leftover is not captured by that first subscriber. At the restart it is set aside and recognized into Vault Cash linearly over 30 days, so it accrues ratably to whoever holds shares during that period, like interest. Holdback Amounts, Queue Requests and unclaimed payments are never part of the leftover.

## Earn controls and Collateral Agent review (owner, Nov 15, 2026)
30. **Required Holders act by their own signatures.** Required-Holder cost approvals (Exhibit A Part 3) and blocks on a key or account replacement (Part 4) are signed by the Holders themselves and counted on chain against the bond register. Neither the Agent Key nor the treasury records them. This replaces the stage 1 build, where the Agent Key recorded them. The stage 2 bond agent builds it with the register.
31. **Ladder changes take effect after 48 hours,** not 7 days. Ladder rates price only new purchases and new roll offers, and a roll needs the Holder's confirmation after its term and yield are posted (decision 11). A change never alters a roll notice already posted or a quote already given. It needs two signers and is published. Everything else under the Earn timelock stays at 7 days.
32. **IV-03 caps:** one cumulative offering cap per product until IV-03 is received. Splitting it by exemption comes later.

## Yield Pool conformance review (owner, Nov 15, 2026)
33. **A loss charge borne partly by holdbacks reduces the Deployed Balance by the FULL charge** (owner, Nov 15, 2026; this reverses the first decision 33). §5.6(d) and A2's "only the rest reduces the Deployed Balance" was a drafting error, now corrected in IV-02. §1.2 and A10 control. On `postLossCharge(L)`:
    - each open holdback absorbs its ratable share, capped at H, as built;
    - the absorbed amounts move into Vault Cash;
    - the full L reduces the Deployed Balance, not L − Σ absorbed;
    - only the part of L above the Deployed Balance plus accrued Pool Interest leaves the vault to Clear Lending.

    Net: Pool Assets fall by L − Σ absorbed, and the Pool Class bears all of L. **Acceptance test 20:** `postLossCharge($900)` with Pool Assets $89,600 and the $52 holdback open applies $52, adds $52 to Vault Cash and reduces the Deployed Balance by $900. Pool Assets fall by $848, to $88,752, and the remaining shares bear $848, as A10 says. **Test 15** likewise: the full charge reduces the Deployed Balance. The first build reduced it by only $848, so the Pool Class bore $848 of a $900 charge (the leaver $52, the rest $796) and Clear Lending carried the other $52.
34. **§7.5 legal holds take two signers and an evidence hash** of the order. A hold covers only the shares the order names. It ends when two signers release it or when the order's stated expiry passes.
35. **§8.3 Successor redemption reuses the bonds' Successor registration.** A registered Successor applies after 7 days, and the Holder's own account can cancel it. The shares are redeemed through the ordinary queue and paid only to that Successor.
36. **Kept as built:** the recovery cap (decision 25) includes any part of a charge that holdbacks bore, and a loss charge's excess is still paid to Clear Lending while the queue is open.

## IV-03 and the enforcement review (owner, Nov 15, 2026)
37. **A credit line's closing is recorded on chain.** After an Objective Default, two people (one proposes, a different one approves) may record that the line is closed and its full balance demanded (MB-04 §9.3(a)–(b)). From that record, the full Savings-Backed Drawn is a Defaulted Amount that Encumbered CLRUSD may pay, never more than the Savings-Backed Position (MB-04 §9.4; MB-05 §§1.3, 7.2), and the full balance is a Defaulted Amount for pledged Earn Positions. Without the record, the Defaulted Amount is only what is past due, as built. Counsel note: confirm whether the demand needs its own notice period under MB-05 §6.3.
38. **One offering maximum across both products (IV-03 §1.3).** A single cumulative counter of $1,000,000, measured by price paid: bond Purchase Prices and pool subscriptions together. This replaces decision 32. Rolls are not counted. Counsel note: IV-03 §6.4(b) calls a roll "a new purchase"; confirm a roll does not count toward the maximum.
39. **The Funding Limit counts all borrowed money (IV-03 §§1.3, 5.5; L-01 "Funding Limit").** Two people post Lending Co.'s other indebtedness for borrowed money (anything that is not an Earn Product) with an evidence hash, and it is added to the on-chain total of bonds at Maturity Amount and pool shares at Share Value (decision 12). The posted figure can only make the check stricter.
40. **The household cap during bootstrap.** A household may hold at most 10% of the greater of Pool Assets and `holderCapFloor` (decision 23's 7-day setting, $1,000,000 in config). This replaces decision 23's "no cap below the floor". At the $1m floor, a household holds at most $100,000 while the pool is small, so filling it takes at least ten households (IV-03 counsel note 18). IV-02 §2.5(c) should be reworded to describe it.
41. **Ladder terms (IV-01; IV-03 §§1.2, 6.3).** A rung may be offered only for terms of 12 to 36 months. A 7-day Earn-timelock setting may raise the maximum to 60 months for Phase 3 under L-02, never higher. A Ladder change is refused when it takes effect if it would leave an offered longer term with a lower Issue Yield than an offered shorter term.
42. **Eligibility attestations last at most 12 months** (IV-03 §2.1(d)). The contract refuses an attestation whose `validUntil` is more than 12 months after its `issuedAt`.
43. **No buyback while any bond's maturity payment is unpaid** (IV-03 §6.4(c), "never during a Reserve Shortfall or default"). This is in addition to the Reserve Shortfall and Enforcement Notice blocks.
44. **A roll needs eligibility at maturity** (IV-03 §6.4(b)). A confirmed roll executes only while the Holder's eligibility attestation is in force, and the replacement bond records that attestation's exemption code. With none in force, the bond is paid, not rolled. The holder-ineligible flag still covers a Rule 506(b) bond whose Holder is not verified for the Rule 506(c) Offering.

## Integration judgement calls (owner, Nov 15, 2026)

45. **Kept as built** (`docs/audit/PHASE-2F-INTEGRATION.md`):
    - (a) A §7.5 legal hold covers shares in the Holder's account only, not shares already in the redemption queue.
    - (b) Holds and pledges add up: the Holder's own exits see balance − pledge lock − held shares; enforcement is capped at balance − held shares.
    - (c) A hold blocks shares, not payments.
    - (d) A Holder may have at most 8 open holds.
    - (e) Only the registered Successor may start a §8.3 Successor redemption. Cancelling the Successor does not cancel a request already queued; the Holder cancels it separately.
    - (f) "While the Objective Default stands" (decision 37) is the Liquidator's own test: `inDefault` or `hasDefaultedOnCurrentLine`, with no pause in force.
    - (g) The line-closing record adds no notice period of its own (decision 37's counsel note stays open).

## Merge-fix judgement calls (owner, Nov 15, 2026)

46. **Kept as built, with one change** (`docs/audit/PHASE-2F-INTEGRATION.md`, part two):
    - (a) In a Collateral Agent distribution round, only the pledged bond next in MB-05 §7.1's order (decision 20) has its share routed to the Defaulted Amount; later bonds' shares go to the Holder's payee.
    - (b) A Shortfall alone routes nothing in a distribution round; only a Defaulted Amount is routed. Counsel's IV-10 §7.6 question stays open.
    - (c) The refused list leaves out individual SavingsIntentEscrow clones, the treasury Safe and contracts that hold no funds.
    - (d) **Changed:** every surplus the Liquidator pays after enforcement or settlement (`applyPledgePayment`, `applyPoolProceeds`, `applyMaturityInstruction`, and the distribution round) goes to the Holder's payee: EarnControls' registered payment Successor once its 7-day wait has passed, else the Holder. This matches every other bond payment. Before, those three paths paid the Holder's own account.

## The Base Sepolia credit stack (owner, Nov 15, 2026)

47. **The Base Sepolia credit stack is deployed fresh, not upgraded in place.** Old lines and plans have zero accrual snapshots, so the first touch after an upgrade would charge them decades of carry (`PHASE-1-REPORT.md` §5 item 8; `REREVIEW.md` §6 and BLIND-REVIEW I-1). A fresh deployment also makes Base Sepolia a true rehearsal of mainnet, where credit is fresh anyway. This settles `DEPLOY-RUNBOOK.md` §5.2 item 11.
    - **Deployed fresh (the credit stack).** The old records are kept as `<Name>PreAudit` (`deploy/retire_credit_stack.ts`); the contracts stay on chain, unchanged, and EarnControls refuses them as Earn payers.
      - The credit core: `AccessManager` (deploy 16, then linked to the MembershipRegistry by deploy 18), `ClearCredit` (the ledger), `NetworkRegistry`, `CollateralRegistry` and `LimitCalculator` (deploy 20).
      - The issuers: `RevolvingIssuer` with its four modules (`RevolvingIssuerExtension`, `RevolvingIssuerCycles`, `RevolvingIssuerTerms`, `RevolvingIssuerWorkouts`) and `TermIssuer` with its two (`TermIssuerExtension`, `TermIssuerOrigination`) (deploy 20); `OffersIssuer` (deploy 24).
      - Their periphery: `MerchantRegistry`, `PayoutPool`, and the `Liquidator` with `LiquidatorEnforcement`, which its constructor creates (deploy 22).
    - **Fresh because they point at the stack.** Each is new in this deployment anyway; none may be built against the old stack.
      - `RateSchedule` (named once on both issuers) and `PauseClock` (named once on RevolvingIssuer and the Liquidator): deploy 25.
      - `PoolShareEnforcer`, which holds the pool, the Liquidator and the registry immutably: deploy 25.
      - The new `AssurancePool` (deploy 08): its money paths are listed on NetworkRegistry.
      - The Phase 2f bond factory, collection and `BondValuer` (deploys 22 and 23): the collection names the Liquidator and the registry.
      - The `CollateralAgent`, whose pledge module is the Liquidator, `HolderDirections` and EarnControls (deploys 26 and 23).
      - The credit timelock, which no network has yet.
    - **Kept, upgraded in place, and re-pointed where their setters allow.** No contract change.
      - `LendingPool` (the Yield Pool, decision 16): its encumbrance source moves to the new CollateralRegistry (deploy 22); `BORROWER_ROLE` is revoked from the old PayoutPool and the card settler, and the old Liquidator's `LIQUIDATOR_ROLE` (deploy 27).
      - `BondVault`: its encumbrance source moves to the new CollateralRegistry (deploy 23, before the Agent is named). Its `payoutPool` backstop still names the old PayoutPool, which may still owe it; it can be cleared only once that loan is repaid, and only without the Agent's co-signature before deploy 23 names the Agent.
      - `ClearUSDUpgradeable`: three wiring changes, all its `DEFAULT_ADMIN_ROLE`'s (the deployer now; after the vault handover, Clear Financial Co. Safe proposals with 7 days): `LIQUIDATOR_ROLE` to the new Liquidator and off the old one, the encumbrance source to the new CollateralRegistry (deploy 22), and the membership source to the new AccessManager (deploy 25).
      - `ESADepositVault`: its state source is the new NetworkRegistry (deploy 25). The slot is new with the upgrade, so this is the first setting either way.
      - `ClaimEscrow`: nothing changes. No credit contract points at it, and it points at none.
    - **Not part of the decision:** `MembershipRegistry`, `TokenRegistry`, `CLRUSDTokenPool`, `Create2Deployer` and `ESADepositVaultLegacy` are unchanged; `SavingsIntentFactory`, the Deed track and the bonds are replaced for their own reasons.

## The retired credit contracts (owner, Nov 15, 2026)

48. **Disconnect the retired credit contracts; do not pause them or put them under a timelock.** Follows decision 47 (`DEPLOY-RUNBOOK.md` §5.1 and §5.2 items 12 and 13).
    - **(a) The BondVault's `payoutPool` backstop is cleared.** It still names the PayoutPool retired with the old credit stack. Once `lentToPayoutPool` is zero, `BondVault.setBackstops(treasury, address(0))` keeps the current treasury and clears `payoutPool`. It is a governed change: once deploy 23 names the CollateralAgent, the Agent co-signs it (two treasury signers propose and confirm, the Agent Key approves, 7 days) and the Earn timelock makes the call. Deploy 27 reads the vault and prints the change (`payoutBackstopChange` in `deploy/earnWiring.ts`); it never sends it. While a loan is open it refuses, saying the old PayoutPool must repay through `repayFromPayoutPool` first (the vault itself reverts with `BondVaultLoanOutstanding`). On a testnet decision 50 skips it instead. Test: `test/deploy/RetiredCredit.deploy.spec.ts`.
    - **(b) The retired `*PreAudit` credit contracts, and the `*Pre2f` and `*Legacy` bond contracts, are disconnected, not paused (most have no pause) and not timelocked.** The deployer stays their admin.
      - Every role a retired contract still holds on a contract we keep is revoked, and every source on a kept contract that names one is re-pointed. Revocations only: no power is widened and no role is added. Deploy 22 revokes CLRUSD's and the fresh AccessManager's roles; deploy 23 the BondVault's, before it names the Agent (the old deploy 23 had granted the pre-2f collection and deposit contract `BOND_ROLE`); deploy 25 the ESADepositVault's and ClaimEscrow's; deploy 27 the Yield Pool's and EarnControls' (`revokeRetiredRoles` in `deploy/creditWiring.ts`, with the role lists in `RETIRED_ROLE_CHECKS`). After a handover each is printed as a proposal for that contract's timelock; on the BondVault, once the Agent is named, as a co-signed change.
      - `scripts/check_retired_credit.ts` checks it, read-only: each retired contract's roles on the kept contracts, every kept contract's links, EarnControls' refusals, the USDC and CLRUSD balances, and the old PayoutPool's loans and legs. It prints PASS / FAIL and exits non-zero on any FAIL. It runs on Base Sepolia before the fresh deploy (`CHECK_BASELINE=1`, the list of what must be disconnected), after it, and as the gate before the held app PRs merge.
      - **The `*Pre2f` and `*Legacy` collections and deposit contracts are handed to the Earn timelock** with the new collection (`deploy/earn_timelock_handover.ts`). They are not inert: their owner can still `seizeBond`, `redeemEarly`, `refundDeposit`, `setBondVault`, `setLiquidator` and `emergencyRecover`. Renouncing would strand any bond a holder never unwound, so the safer choice is the 7-day timelock. The retired valuers keep their owner; the factories move too (decision 50 (b)).
      - `scripts/configure-carry-recipients.mjs` reads the current `PayoutPool`, `TermIssuer` and `RevolvingIssuer` records and refuses a retired one. The apps are not changed now: the fresh addresses exist only after the deploy, and an app change starts billed Vercel builds. `DEPLOY-RUNBOOK.md` §4.2 lists every app file and default address that names a retired contract, and what replaces each, as a post-deploy step.

49. **The standing balance, and the payout funding keeper (owner, Nov 15, 2026).** Clear Lending keeps PayoutPool's payable balance at or above the claims due within the next 30 days (`dueWithin(30 days).short == 0`).
    - **Relation to addendum 12.10.** The standing balance sits on top of 12.10, which requires each financed charge to be funded no later than 2 business days before the merchant's payout deadline. With 30 days held, 12.10 is met with weeks to spare.
    - **Funding stays manual (decision 17).** Top-ups come from recorded Yield Pool Deployments, from BondVault excess withdrawn through the Collateral Agent, or from the treasury. Nothing on chain enforces the standing balance.
    - **The keeper.** A read-only keeper watches it: `apps/api/src/jobs/payoutFundingKeeper.ts`, hourly, behind `PAYOUT_KEEPER_ENABLED=1`; by hand, `scripts/check_payout_funding.ts`. It holds no key and sends no transactions.
      - **RED** when an unpaid claim has reached its payout deadline, or when `dueWithin(2 business days).short > 0`.
      - **AMBER** when `dueWithin(30 days).short > 0`, with the exact top-up and the date it becomes a 12.10 breach.
      - **Funding options, for information:**
        - the Yield Pool's Deployment headroom, under the 90% utilization cap and the posted Pool Tier principal; it is zero while the pool is suspended, has a withdrawal queue open or has a loss charge pending;
        - BondVault `deployableExcess()`;
        - PayoutPool `treasuryAvailable()`.
      - **Business days** are weekdays in Pacific time, less a configured holiday list.
      - **Alerts** go to `OPS_ALERT_EMAIL` once per condition per day, and again if the shortfall grows or another claim passes its deadline.

50. **The retired contracts' leftovers on testnet, and the bond factories (owner, Nov 15, 2026).** Amends decision 48.
    - **(a) Test money does not block the testnet rollout.** The retired contracts on Base Sepolia hold only test money. Their leftover state stands as it is, and nothing is swept or repaid:
      - the old PayoutPool's open loans (`borrowedFromVault`, `borrowedFromYield`, and the BondVault's `lentToPayoutPool`);
      - the old PayoutPool's legs (`yieldPool`, `bondVault`) while the loan on that leg is open;
      - the BondVault's `payoutPool` backstop, which cannot be cleared while a loan is open; the BondVault lends nothing, and the old pool can only repay into it;
      - USDC or CLRUSD balances left in retired contracts.
    - **Where it applies.** On a testnet: Base Sepolia, Sepolia, the in-process Hardhat network, and any chain other than Base mainnet (8453). Base mainnet has no retired credit stack, so nothing there changes: such a leftover must never appear there.
    - **The check** (`scripts/check_retired_credit.ts`). On a testnet each of these leftovers is a WARN, marked "test money, decision 50", and the check still exits 0. On Base mainnet each is a FAIL. Every role a retired contract holds on a kept contract, every other source that names one, and EarnControls' refusals stay FAIL on every chain: they keep the new system's wiring right. A leg still on after its loan is repaid also stays FAIL, since deploys 22 and 27 switch it off.
    - **Deploy 27's backstop step** (`payoutBackstopChange` in `deploy/earnWiring.ts`). On a testnet with a loan open, it skips the change and logs that the backstop is "left in place, test money, decision 50; BondVault lends nothing and the old pool can only repay into it". On Base mainnet it still refuses. Either way the run goes on. Once `lentToPayoutPool` is 0, the change is printed as decision 48 (a) describes.
    - **(b) The bond factories move to the Earn timelock**, as the bond collections already do (`deploy/earn_timelock_handover.ts`): the new `BurnerBondFactory`, and every `BurnerBondFactoryPre2f` and `BurnerBondFactoryLegacy` on record. Each factory is OpenZeppelin `Ownable` (v4: one step, no roles), so `transferOwnership` moves every power it has. Those powers reach only the factory and what it creates: `createCollection`, `deactivateCollection` and `reactivateCollection`, the registry or oracle and pool pointers, the base URI, the discount, maturity and face-value limits, and `emergencyRecover`, which pays the owner. No power is widened: the deployer loses them, and every later use is a Clear Lending Safe proposal with 7 days. A collection a factory makes after the handover belongs to the timelock from the start. The retired valuers keep their owner.

## Automatic payout top-ups (owner, Nov 17, 2026)

51. **Bounded automatic PayoutPool top-ups (owner-approved Nov 17, 2026).** Amends decision 49's "funding stays manual" for routine top-ups only.
    - **Trigger-based, not scheduled.** A job (`apps/api/src/jobs/payoutTopUp.ts`, off unless `PAYOUT_TOPUP_ENABLED=1`) checks every 15 minutes, reading views only. It moves money only when `PayoutPool.dueWithin(14 days).short > 0`, which includes an unfunded overdue claim. 14 days sits well ahead of addendum 12.10's two business days, and the job refuses a low horizon under 7 days.
    - **Refill target.** When it moves, it refills to `dueWithin(30 days).short` (decision 49's standing balance) plus a margin ($100 by default), so moves stay weeks apart. Nothing short at 14 days means no move, even when the 30-day picture is short. If that 30-day need is more than the limit has left, it alerts once instead. A `dueWithin` list that is still full at 3,200 claims is taken as everything queued: it may over-fund, but it never under-funds silently.
    - **Capped by a Safe spending limit.**
      - The money comes from CL Operating through Safe's AllowanceModule v0.1.1 (the canonical `0xAA46…091C`). CL Operating's owner sets the limit on chain: $5,000 a week on Base Sepolia.
      - The top-up wallet, a CDP server wallet holding the PayoutPool's `FUNDER_ROLE` and nothing else, sends three exact calls: `executeAllowanceTransfer` (the delegate sends it itself, with an empty signature), `approve(PayoutPool, amount)` and `fund(amount)`. It never calls `withdrawCapital`.
      - What the limit cannot cover is prepared as a Transaction Builder batch for CL Operating's owners, and alerted. The job never works around the limit.
      - When CL Operating lacks the money, it alerts and does not try.
    - **Safety.**
      - Each transaction is dry-run first.
      - Each top-up is recorded (migration 0078) before it starts. At most one is in flight per pool, and a restart finishes it from the chain, so one trigger is never funded twice.
      - Any revert stops the job until a person clears it.
      - The read-only keeper (decision 49) is unchanged.
    - **One-time setup** (signing plan steps `TU-funder`, `TU-safe-module`, `TU-safe-delegate`, `TU-safe-allowance`): the deployer grants `FUNDER_ROLE` on the fresh PayoutPool before I2; CL Operating's owner signs one batch that enables the module, adds the delegate and sets the allowance. `docs/operators/payout-topups.md` has the detail.
    - **Accepted risk.** A stolen top-up key could move at most the limit per period from CL Operating. Beyond that it could reach only the wallet's own idle capital in the PayoutPool and the positions its capital bought. Revoking `FUNDER_ROLE` and removing the delegate stop it. Returning those positions to CL Operating is not automated yet.

52. **Day-0 go-live on Base Sepolia (owner, Nov 17, 2026).** The held app PRs and the app address update no longer wait for day 7 on a testnet.
    - **What still takes 7 days, by contract:** the Assurance Pool's governed settings (its governance must be a timelock of at least 7 days), the Collateral Agent's changes (`CHANGE_DELAY`), and ClearUSD's admin handover (its own 2-day delay, scheduled in the 7-day vault timelock). These are the same contracts as mainnet, and they are not changed for testnet.
    - **The rule.** On a testnet, the gate (`scripts/check_retired_credit.ts`, I6) counts the BondVault's backstop to the retired PayoutPool as a WARN, not a FAIL, once the exact Earn timelock batch that clears it (`setBackstops(treasury, 0)`, from the signing plan's `E8-earn-schedule`) is scheduled and not yet run, and only if that call does not point at a retired contract (`scripts/scheduledClear.ts`; tested in `test/deploy/ScheduledClear.deploy.spec.ts`). Every role, every other link and every refusal still FAILs. On Base mainnet nothing changes.
    - **So on day 0,** once the gate exits 0, Railway is pointed at the fresh contracts, the app address update merges and the held app PRs follow. Day 7 runs in the background: the Safe executes the Earn, vault and Assurance batches, the Assurance fee payer and the top-ups are switched on, and the final checks are run again.
    - **What waits for day 7 meanwhile** (nothing members or merchants use): Assurance Pool deposits, draws and grants; the Collateral Agent's BondVault, bond-book, Holder Directions and pledge-module wiring; the old backstop link; ClearUSD's admin moving to the vault timelock.

53. **App follow-ups after the day-0 merge (owner, Nov 17, 2026).** The owner took the recommendations below. #884 merged on its own; #887, #890 and #895 landed through #904 together with the runbook 4.2 address and call changes.
    - **Signed wording.** Members sign two texts the apps wrote: the Maturity Instruction with a bond pledge (`packages/domain/src/pledge.ts`, "Clear Maturity Instruction, v1") and the auto-clear authorization (`packages/domain/src/revolvingSwitches.ts`, "Clear Automatic Clearing authorization, v1"). They stay at v1 on testnet. Counsel reviews both before mainnet. Any change of wording is a new version, because the hash changes.
    - **Payer ids.** The id `repayForMember` sends, and every id given to `addDefaultExcludedPayer`, is `keccak256("ach:<Lithic ACH company id>")`. Federal benefit payers are added under the same scheme.
    - **Environment variables win over the code's defaults.** Railway Phase 2 sets every `*_84532` address from the day-0 records, including `SAVINGS_INTENT_FACTORY` and `SAVINGS_INTENT_FACTORY_84532`. `BURNER_BOND_DEPOSIT_84532` and `OFFERS_ISSUER_84532` are removed.
    - **Not built yet, in this order:** (1) the keepers: `syncCreditPeriod`, `triggerDefault`, `PoolShareEnforcer.enforce` and `payPledged`, `fillQueue`; (2) the Yield Pool's queue views and cancel, and the eligibility attestation service; (3) buying bonds by signed Quote, and ConfirmRoll (buying shows as paused until then); (4) OFAC screening, which needs a data source chosen first; (5) the runbook's new consoles and indexers. Mainnet does not go live without (1) to (4).
    - **Stale wording.** "Borrows from the yield pool" in Command's `money.tsx` and `money2.tsx` and in `docs/investors/lending-pool.md` is corrected with the next app change.
    - **Left as they are:** `deployments/base-sepolia/BurnerBondDeposit.json` stays as history and is left out of the docs. The MetadataRenderer address is checked under the Deed v5 work: the API and member app name 0xAc50…48BE, the record names 0x849e…70E5, and DeedNFT reads 0xc8A9…10cD on chain. The Deed track was not redeployed, so nothing changes now.

## Automatic card settlement funding (founder, Nov 17, 2026)

54. **The Yield Pool funds card settlements automatically, within limits two people set once (founder, Nov 17, 2026).** The agreements were amended for this; only their section numbers are cited here. Recorded as 54 because 53 was already taken. Amends decision 49's "funding stays manual" for card settlements only, as decision 51 did for PayoutPool top-ups.
    - **Savings-backed credit is a Pool Tier** (IV-02 §4.1). The Yield Pool may fund savings-backed, income-backed, Clear Boost, Partner Credit and Clear Cash draws. Asset-backed credit stays out of the pool (§4.2). Savings-backed credit stays free to members and secured 1:1 by their own locked CLRUSD. The API's `POOL_FUNDED_TIER_KINDS` defaults to `SAVINGS,INCOME,BOOST`, and the Pool Tier principal worksheet counts them, with the open term plans and the Margin Advances not yet restored.
    - **Settlement Funding** (L-01 §8.4A; I-02 §4.9(a); I-07 §4.10). Before each settlement cut-off, the Credit Settlement Account (CSA) at the bank partner is funded to cover the credit portions due in that settlement plus a Settlement Buffer. The sources, in this order:
      1. collections already in the Collection Account (same bank), by book transfer;
      2. Settlement Funding: Yield Pool Deployments, and BondVault excess where its documents allow it;
      3. the Savings-Backed Margin.

      Cash in the CSA above the next settlement plus the buffer goes back within 2 business days: first to restore the Margin, then as a Return to the pool, then to the BondVault.
    - **Standing Approvals** (C-01 §6.14; L-01 §6.4; IV-02 §4.3A). Two people may approve an automated flow once, if it has all three of: a fixed destination; a per-period limit enforced on chain; and an immediate stop. The automated pool lane (IV-02 §4.3A):
      - can be used only by a funder registered on the Vault;
      - has a per-period cap set by two `DEPLOYER_ROLE` signers;
      - may deploy above the posted Pool Tier principal by up to a **Settlement Headroom**, to cover credit portions authorized and not yet settled;
      - meets every other `deploy` condition: no open queue request, no Suspension, no pending loss charge, Utilization at most 90% afterwards.

      Unused Settlement Funding comes back within 2 business days.
    - **The ESA vault never funds anything.** The ESA reserve is held in trust, 1:1, and is used only to redeem CLRUSD. Nothing in this design reads, names or moves it.
    - **How it is built.**
      - On chain: the settlement lane on the Yield Pool (`setSettlementFunder`, `setSettlementHeadroom`, `deploySettlement(amount, ref)`, `stopSettlementFunder`, which any one `DEPLOYER_ROLE` or `CCO_ROLE` holder may call, and one view, `settlementLane()`), added by a new Earn timelock proposal scheduled after E8x has executed. Only the lane adds the Settlement Headroom to its ceiling; the two-person `deploy` keeps the posted principal alone; and a `SettlementForwarder`, CL Operating's AllowanceModule delegate, which only the desk wallet may call and which pays only the off-ramp address CL Operating's owners set. A stolen desk key can push USDC only to the off-ramp, within the lane's cap and the forwarder's allowance.
      - Off chain: the funding desk (`apps/api/src/jobs/fundingDesk.ts`, off unless `SETTLEMENT_FUNDING_ENABLED=1`, with a dry run) on the payout top-ups pattern (decision 51): a CDP server wallet (`settlement-desk-base-sepolia`), every move recorded before it is sent, idempotency keys per step, a stop on any revert until a person clears it, each alert once. `need = due at the next cut-off + buffer − CSA − in flight`; the Collection Account first, then the lane; never more than the cap, with Transaction Builder batches for the rest; the Margin and the manual options named otherwise. Returns run behind their own switch, `SETTLEMENT_RETURNS_ENABLED`. It funds settlements, never individual swipes.
      - The per-purchase `borrow` (retired with decision 17's Yield Pool) is gone from the API.
      - The Pool Tier principal is a read-only worksheet for the two `VALUATION_ROLE` signers (`GET /api/command/pool-tier-principal`, shown in the Command Center as "suggested"). Nothing posts it automatically.
    - **One-time setup.** Prepared without signatures: `SETTLEMENT_LANE_PREPARE=1 npx hardhat run scripts/upgrade_settlement_lane.ts` (the upgrade validated against the OpenZeppelin manifest, the new implementation deployed) and `deploy/28_deploy_SettlementForwarder.ts`. Then signing plan stage `SL`: `SL-upgrade-schedule` and, 7 days later, `SLx-upgrade-execute` (the Earn timelock proposal, after E8x); `SL-funder-1/2` and `SL-headroom-1/2`, each pair two different `DEPLOYER_ROLE` signers; then CL Operating's one batch `signing-SL-cl-operating.json` (`SL-cl-operating-delegate`, `-allowance`, `-offramp`, `-desk`). Its inputs are `SETTLEMENT_FUNDER`, `SETTLEMENT_CAP_USDC`, `SETTLEMENT_PERIOD_DAYS`, `SETTLEMENT_HEADROOM_USDC` and `SETTLEMENT_OFFRAMP_ADDRESS` in `deploy/config/base-sepolia.rollout.env`; `scripts/check_rollout_inputs.ts` (`checkSettlementForwarderSetup`) checks the forwarder's setup read-only. On Base Sepolia the lane is small: $5,000 a week and $1,000 of headroom. Nothing on chain is scheduled, granted or sent without the owner. `docs/operators/settlement-funding.md` has the detail; the lane's rules as built are Earn acceptance test 27 (`earn-contract-requirements.md`).
    - **Configuration, filled in later by the owner** (never written into the code): the bank's and Lithic's cut-off times, whether a Collection Account to CSA book transfer is same-day, the CSA minimum the bank requires (the buffer's floor), the off-ramp provider, rail and latency, and the lane's cap, period and headroom.

## Notes for counsel
- **Exhibit A Part 5** says matured-bond settlements pay only to the Holder or into the BondVault. Phase 2e's maturity split (and `completeSettlement`) pays the debt part to the Holder's own debt with Clear Lending, on the Holder's signed Maturity Instruction (MB-05 §5.6). This is treated as a payment to the Holder.
- **Decision 19 versus IV-10 §7.6.**
- **Amount due at enforcement:** Exhibit A says "at the acceleration time", and the Earn spec says "at the enforcement timestamp". The Agent has no power to accelerate, so the amount is fixed at enforcement, with unmatured bonds at Accreted Value.
- **MB-05 §5.3:** a raise in an advance rate may benefit existing pledges, while Phase 2e stores the rate at pledging. Use the higher of the stored and current rate, so a raise helps existing pledges and a cut does not hurt them.
- **IV-02 §5.6(d) and A2 (decision 33):** corrected by the owner so the full Pool Loss Charge reduces the Deployed Balance. The corrected IV-02 and `earn-contract-requirements.md` are filed in this folder.

## Documents
- IV-02 in full was received on Nov 14, 2026. The corrected IV-02 (§5.6(d), A2, A6), the corrected `earn-contract-requirements.md` (section 4A roll confirmation, tests 2, 6, 15, 19, 20, 24 and 26) and IV-01 were filed on Nov 15, 2026, from `Deed3Labs/clear-agreements` at 6e8193f, verbatim.
- IV-03 (the Private Placement Memorandum) was filed on Nov 15, 2026, from `Deed3Labs/clear-agreements` at 6e8193f, verbatim.
- IV-10 (with Exhibit A) and MB-05 in full were received on Nov 14, 2026, and are in this folder.

## Build order
1. **Stage 1, new files only, alongside Phase 2g:**
   - Agent A reworks `LendingPool` into the Yield Pool with its holdback module (decisions 16–17), tests 11–15 and 20–25.
   - Agent B builds `EarnControls`, the compounding library and the Earn timelock script, and `CollateralAgent` once Exhibit A arrives.
2. **Stage 2, after Phase 2g merges:** the bond contracts, BondVault, CollateralRegistry, the Liquidator slim-down with `PoolShareEnforcer`, and the deploy configuration.
3. **Stage 3:** integration, storage reports, Slither and the 2f report. Decision 33 (as revised), 34 and 35 are built here, on top of the enforcement branch's LendingPool.

## Base Sepolia redeploy steps
- Before the first Deployment: call `setLegend` with IV-02's legend, then have two `VALUATION_ROLE` signers post the Pool Tier ceiling (`poolTierPrincipal`). Until the ceiling is posted, no Deployment is possible.
