# Phase 2f, stage 1, agent B: EarnControls, Accretion, the Earn timelock and the CollateralAgent

Branch `audit/phase-2f-earn-controls`, built on agent A's Yield Pool (`f9d091b7`, [`PHASE-2F-YIELD-POOL.md`](./PHASE-2F-YIELD-POOL.md)). No PR was opened.

Requirements:

- [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md): decisions 1, 2, 12, 13, 18, 19, 22 and 23;
- [`specs/IV-02-yield-pool-subscription-and-pool-share-terms.md`](./specs/IV-02-yield-pool-subscription-and-pool-share-terms.md) §§2.4–2.6 and 8.1 (received mid-task with decisions 23–27; brought onto this branch from `audit/phase-2f-earn-pool`);
- [`specs/earn-contract-requirements.md`](./specs/earn-contract-requirements.md) §§1, 2, 5, 6 and tests 8–10 and 24;
- [`specs/IV-10-burnerbond-collateral-agency-agreement.md`](./specs/IV-10-burnerbond-collateral-agency-agreement.md), Exhibit A;
- [`specs/MB-05-security-and-pledge-agreement.md`](./specs/MB-05-security-and-pledge-agreement.md) (Present Value, Defaulted Amount, §6.1);
- [`PHASE-2F-PLAN.md`](./PHASE-2F-PLAN.md) (R1, R4, R7, R8).

Nothing was deployed. No key was used and no live network was touched; neither Earn script has ever been run against a network. No admin power was widened. Only new files were added, apart from small edits to:

- `deploy/credit_timelock_handover.ts` (LendingPool removed);
- `docs/audit/UPGRADEABILITY.md`;
- test 24 in `test/earn/YieldPool.spec.ts`;
- the spec files brought over from `audit/phase-2f-earn-pool`.

No contract that stage 2 owns was edited.

## 1. Status by item

| Item | Status | Where |
|---|---|---|
| 1. `EarnControls` | Built. It implements `IPoolEarnControls` exactly, and IV-02 §§2.4–2.6 and 8.1 per the coordinator's mid-task instruction. Test 24 of the Yield Pool spec now runs against it instead of `MockEarnControls`. Split into a main contract and a delegatecall module for size | `contracts/peripherals/EarnControls.sol`, `EarnControlsBase.sol`, `EarnControlsAdmin.sol`, `interfaces/IEarnControls.sol`, `deploy/earnModules.ts` |
| Holder-cap bootstrap floor | Built (decision 23). The 10% cap applies only while Pool Assets after the subscription exceed `holderCapFloor()`. `scheduleHolderCapFloor` applies 7 days later, on top of the Earn timelock, with `HolderCapFloorScheduled`. The cap stays 10% (`holderCapBps` 1,000). The value is in deploy config ($1,000,000) | `EarnControls.checkSubscription`, `deploy/config/earn-controls.json` |
| Do bonds need the floor? | **No.** The holder cap is a Pool Share rule only (Earn §6; IV-02 §2.5(c)). Bonds face only absolute limits: the $250 minimum, the offering cap, the Funding Limit and 10% of net worth. None of these is a share of an outstanding total, so the first buyer is not refused | — |
| 2. Compounding `accretedValue` library | Built, pure and library-only. Reproduces IV-01 §7.3's $2,267.57 (and the $750.00 reserve and $1,517.57 withdrawal) to the cent. Fuzz and property tests run against a 60-decimal reference | `contracts/libraries/Accretion.sol`, `contracts/mocks/AccretionHarness.sol`, `test/libraries/Accretion.spec.ts` |
| 3. Earn timelock | Built. Deploy script and handover script. LendingPool removed from the credit handover | `deploy/26_deploy_EarnControls.ts`, `deploy/earn_timelock_handover.ts`, `deploy/config/earn-controls.json`, `test/deploy/Earn.deploy.spec.ts` |
| 4. `CollateralAgent` | Built to Exhibit A Parts 2–6, with decision 19's routing. The BondVault, bond and pledge-module sides are interfaces, with mocks in the tests | `contracts/peripherals/CollateralAgent.sol`, `interfaces/ICollateralAgent.sol`, `contracts/mocks/MockAgentSide.sol`, `test/earn/CollateralAgent.spec.ts` |

### EarnControls

- **The pool's interface.** `checkSubscription`, `subscriptionsPaused`, `walletsOf` and `transferAllowed`.
- **Bond side (stage 2).**
  - Purchases: `checkPurchase(payer, holder, price, maturityAmount, termDays, attestation)`, `purchasesPaused`, `recordBondExit`.
  - Rolls: `rollAllowed`, `holderIneligible`, the Ladder (`setRung`, `isTermOffered`, `ladderYieldBps`, `rollTermFor`, `rollYieldFor`).
  - Payments: `payeeOf`.
- **What `checkSubscription` enforces**, every limit counted after the subscription (IV-02 §2.5):
  - only the Yield Pool may call it;
  - no pause in force;
  - payer and receiver not refused, and the same Holder;
  - an eligibility attestation in force (EIP-712, EIP-1271-capable), whose `exemptionCode` is returned;
  - (b) Earn Products at purchase price within 10% of the attested net worth;
  - (c) the household's 10% cap above the floor;
  - (d) pool capacity, the Funding Limit and the pool's offering maximum.
- **Funding Limit (decision 12):** Σ BondVault `totalFaceOutstanding`, plus Pool Shares × `shareValue()`, rounded up.
- **Offering caps:** each counts the cumulative amount taken. The bond counter takes Purchase Price; the pool counter takes subscriptions.
- **Pauses (IV-02 §2.6).** Each is set and cleared by two different `PAUSE_ROLE` holders:
  - the Reserve Shortfall flag;
  - the Equity Cushion flag;
  - the "L-01 §2.9(c) applies" flag. While it is set, subscriptions pause once the pool's `lowUtilizationSince()` is 30 days old. The pool adds that function in its next pass; until then the pause fails closed.

  The BondVault's own Reserve Shortfall (`inReserveShortfall()`, stage 2) also pauses. An Enforcement Notice stops purchases and rolls, not pool subscriptions. No pause touches a redemption or a roll.
- **Transfers (IV-02 §8.1).** Allowed only:
  - between Smart Accounts of the same member (MembershipRegistry);
  - by operation of law: a Successor transfer approved by two `SUCCESSOR_ROLE` holders with an evidence hash, open 30 days, one direction.
- **Roles** are granted only with a Lending Board resolution hash (§10). `grantRole` reverts; use `grantRoleByResolution`.

### CollateralAgent

**The Agent Key** is an address, not a role. It has exactly Part 2's seven powers:

1. `enforce`;
2. `releaseEnforcement`;
3. `postDistribution(amount, roundId)`;
4. `toCollateralAccount(amount)`;
5. `withdrawCosts(amount, statementHash)`;
6. `approveChange`;
7. `rotateAgentKey` (48 hours).

It also has three on-chain records attached to those powers: `postCostStatement` and `recordCostApproval` (item 5 and IV-10 §8.2), and `recordHolderBlock` (Part 4).

**Distributions.**

- A permissionless batched `snapshotBonds` fixes each bond's amount due at the enforcement time.
- Each round raises a per-dollar index.
- `claimDistribution(bondId)` is permissionless and pays the Holder, or the payment Successor.
- A bond paid in full is burned through the bond book.

**Decision 19.**

- `routeDistribution` sends a pledged bond's share to the Holder's MB-05 Defaulted Amount first, only while the pledge module reports that §6.1 permits enforcement against the bond. The rest goes to the Holder.
- The ratable share is unchanged.
- `enforcementInForce()` is what stage 2's bonds and BondVault check, so that no roll executes, even a confirmed one.

**Part 3, enforced in code.** The Agent Key holds no role here or anywhere else.

- USDC moves only through:
  - the claims;
  - the registered Collateral Deposit Account;
  - the registered cost address, within a cap stored on chain: the greater of $50,000 and 2% of the Collateral at enforcement, plus Required-Holder approvals.
- Posted but unclaimed distributions can never be moved out.

**Part 4: replacement.** A new Agent Key or Collateral Deposit Account needs:

- an instruction hash;
- a treasury proposal and a second treasury signer's approval;
- 7 days.

A Required-Holder Direction recorded on chain blocks it. An Enforcement Notice in effect survives a replacement.

**Part 5: the treasury role** (`TREASURY_ROLE`, at least two addresses). It can only:

- withdraw excess to the registered multisig, proposed and executed by different signers, and never during enforcement;
- propose and confirm changes.

**Changes.** Every upgrade, role, parameter or destination change of the BondVault, and of the CollateralAgent itself, needs:

- `DEFAULT_ADMIN_ROLE` (the Earn timelock);
- a treasury proposal and a second treasury signer's confirmation;
- the Agent's `approveChange`;
- 7 days from the confirmation.

The changed contract calls `consumeChange(keccak256(msg.data))`, so the co-signature covers the exact call.

**Part 6: events.** Every Part 2, 4 and 5 action and every per-bond payment emits an event.

### Earn timelock

- **Deploy script.** `deploy/26_deploy_EarnControls.ts` deploys:
  - the Earn `TimelockController` (7 days, the Clear Lending Safe proposing and executing, no admin);
  - EarnControls, from `deploy/config/earn-controls.json`;
  - the CollateralAgent, initialized with the Earn timelock as admin, because any later grant needs the Agent's co-signature.
- **Handover script.** `deploy/earn_timelock_handover.ts`:
  - `deployEarnTimelock` refuses a delay under 7 days. `main` refuses a Safe with a threshold under 2.
  - `handOverEarn`:
    - moves `DEFAULT_ADMIN_ROLE` on LendingPool to the timelock;
    - moves EarnControls' `DEFAULT_ADMIN_ROLE` there too, with the resolution hash;
    - checks the CollateralAgent's admin;
    - renounces every deployer role on all three.
  - `assertNoEarnAdmin` fails the handover if any deployer power remains.
  - `creditToEarnCalls` builds the credit-timelock batch that passes LendingPool's admin over, for when the credit timelock already holds it.
- **Modules.** YieldPoolValuation and EarnControlsAdmin are stateless delegatecall modules with no admin of their own. A new module needs an upgrade of its parent.

## 2. Checks

### Production sizes

Measured with `npx hardhat compile --force`, revert strings stripped, via-IR, runs 1.

| Contract | Runtime (left of 24,576) | Creation (of 49,152) |
|---|---|---|
| EarnControls | 17,845 (6,731) | 18,299 |
| EarnControlsAdmin (module) | 13,790 (10,786) | 13,927 |
| CollateralAgent | 20,295 (4,281) | 20,432 |
| LendingPool (unchanged) | 22,924 (1,652) | 23,378 |
| YieldPoolValuation (unchanged) | 22,844 (1,732) | 22,981 |

Built as one contract, EarnControls came to 24,476 bytes once IV-02 was added, leaving 100 bytes. So it was split the way `deploy/poolModules.ts` splits the pool:

- `EarnControlsAdmin` holds the governed settings, the Ladder, the Successor path, households and the ineligible flag.
- It is pinned in EarnControls' constructor and checked with `IExtensionKind.extensionKind()`.
- It is reached through EarnControls' fallback.
- `deploy/earnModules.ts` gives the proxy options and the joined ABI.

The Accretion library adds about 42,000 gas to an Accreted Value read for a part year (a 365th root), and about 3,000 for whole years.

### Slither

Slither 0.11.6, Medium and High, per contract. Solc 0.8.29, via-IR, runs 1. Every finding was triaged; none is a defect.

| Finding | Where | Triage |
|---|---|---|
| `incorrect-exp`, `divide-before-multiply`, `unused-return` | OpenZeppelin `MathUpgradeable.mulDiv` and `ERC1967Upgrade` | Library code; known false positives |
| `divide-before-multiply` | `Accretion` | `RAY / BPS` is exact (10^23). The Bernoulli start of Newton's method is a starting guess, then proven by a power check |
| `uninitialized-state` (High) | `EarnControlsBase` | The module-split false positive: these fields are written in `EarnControlsAdmin` |
| `incorrect-equality` | `CollateralAgent.claimDistribution` | Intended: `distributed == totalDue` means "paid in full", and `owed == 0` means "nothing to claim" |
| `uninitialized-local` | `owed`, `n`, `held` | Accumulators that start at zero |

No reentrancy finding. `claimDistribution` writes all its state before it calls the vault, the pledge module and the bond book, which are governed contracts.

### Tests

New:

| Spec | Tests | Covers |
|---|---|---|
| `test/earn/EarnControls.spec.ts` | 22 | Against the real LendingPool |
| `test/earn/CollateralAgent.spec.ts` | 24 | Tests 8 and 9, the Agent's half of 10, decision 19, Parts 2–5 |
| `test/libraries/Accretion.spec.ts` | 9 | Worked figures; issue, maturity, monotonicity and rounding properties; growth-factor bounds; rolls; domain |
| `test/deploy/Earn.deploy.spec.ts` | 5 | Fresh chain, timelock schedule and execute |

Test 24 in `test/earn/YieldPool.spec.ts` now uses the real EarnControls.

Run locally: those files, plus YieldPool, YieldPoolUpgrade, the Compliance and Vault deploy specs, and the two compliance specs that scan contract sources (Section2d, Section12Revolving). **153 passing, 0 failing.** The full suite runs in CI.

### Generated files and CI

- `node scripts/command/code-fingerprints.mjs --check`: current (34 contracts). No deployed contract changed.
- `node scripts/docs/contract-reference.mjs --check`: current.
- `node scripts/check-doc-links.mjs`: no broken links.
- `TURBO_SCM_BASE=origin/dev npx turbo run typecheck test --affected`: 3 of 3 tasks passed.

## 3. For the owner: judgement calls and conflicts

These are listed, not chosen. Where a decision exists, the decision's version is built. Otherwise the narrower, member-favourable reading is built.

**EarnControls**

1. **Holder cap, household (IV-02 §2.5(c)) against decision 13 (per member).** Built per household, as the coordinator directed, since IV-02 controls the Yield Pool.
   - Two `ATTESTER_ROLE` holders record a household per member (at most 12 members). A member with none recorded counts alone.
   - `walletsOf` now returns the household's wallets, so its meaning is wider than `IPoolEarnControls`' comment says.
   - IV-02 Schedule 1 says "no Holder above 10%"; §2.5(c) controls.
2. **Floor measure.** The floor is compared with Pool Assets *after* the subscription, the narrower exception. The cap is checked before the pool takes the USDC, on figures projected with `previewDeposit`. A `mint` can overcount by one share, which is the conservative direction.
   - The pool's own `_checkHolderCap` must stay off (`holderCapBps` 10,000) or be removed in stage 2. As it stands, it would refuse the first subscriber.
3. **Net worth (IV-02 §2.5(b)).**
   - The figure is attested per account in the EIP-712 attestation, and the limit is counted per member.
   - Pool Shares are carried at average cost, so a redemption lowers the cost in proportion.
   - Bond cost comes off only when stage 2 calls `recordBondExit`. A roll keeps the original Purchase Price.
   - Shares received from a Successor transfer add no cost.
   - IV-03 §2.5, which "establishes" net worth, is not in `specs/`.
4. **Funding Limit measure (decision 12).**
   - It counts BondVault `totalFaceOutstanding`, plus Pool Shares × Share Value, rounded up.
   - It leaves out open holdbacks, settlement shortfalls and Clear Lending's non-Earn debt, none of which the decision names; the last is off chain.
   - A limit of 0 refuses everything, so the config placeholder must be set.
5. **Offering maxima.**
   - One cumulative counter per product: bonds by Purchase Price with rolls excluded, the pool by subscriptions. Neither ever falls.
   - The maxima are not split per Earn Offering (506(c), 506(b), 147A). IV-03's maximum is not in `specs/`.
   - Pool capacity is Pool Assets after the subscription.
6. **Eligibility.**
   - The latest attestation (by `issuedAt`) wins. An attestation counts only while its attester still holds the role.
   - There is no revoke power: an attestation expires through `validUntil`, a new one replaces it, or the attester's role is revoked.
   - `attestEligibility` is permissionless and signature-bound.
   - The receiver must be the payer's own Holder.
7. **Reserve Shortfall.** Two things pause subscriptions: the two-person flag (IV-02 §2.6, L-01 §8.9(e)) and the BondVault's computed shortfall (Earn §2). Whether these are one state is for the owner. Who holds `PAUSE_ROLE` (the CCO or treasurer?) is not specified.
8. **Low-Utilization pause.** It fails closed while the pool cannot report `lowUtilizationSince()`. This bites only while the §2.9(c) flag is set.
9. **Successor (member-protective additions not in the spec).**
   - A transfer approval is open 30 days, in one direction, with no revocation.
   - For bonds only, a Successor registered for payment (IV-01 §6.3) applies after 7 days, and the Holder's own account may cancel it.
   - IV-02 §8.3's "redeem and pay the Successor in dollars" is the pool's own path; `payeeOf` is for bonds.
10. **The Ladder** is governed through the 7-day Earn timelock (the "GOVERNED PARAMETER" rule). That may be too slow for repricing; a two-person Ladder role without the timelock would be wider. Bounds: terms up to 30 years, yields below 50%.
11. **The holder-ineligible flag** needs two `ELIGIBILITY_ROLE` holders and an evidence hash (plan ambiguity 8). It tells the reserve hook in the same transaction.

**Accretion**

12. **Days.** Whole days to maturity, counted up. The value is constant within a day and steps up at each boundary. "Rises steadily" (MB-05) is met at day resolution.
13. **Rounding: down, against the claimant's overstatement.** The value is a claim (`payPledged`, distributions, `redeemAll`, collateral value, the buyback ceiling), so no claimant is ever credited more than the exact figure.
    - The growth factor is bounded from above with directed rounding, so this is a guarantee, not an estimate.
    - The error is under one base unit ($0.000001), inside Earn §1's one-cent tolerance.
    - It means `payPledged`'s "never less than 100% of Present Value" holds to the micro-dollar, not exactly.
    - Rolls round the new Maturity Amount down to the cent (IV-01 §5.2), with the growth factor bounded from below.
14. **Purchase Price** is the value at issue, to the micro-dollar. The equality at issue needs the maturity date to be issue + term days. Whether quotes round to the cent is stage 2's choice; the $2,267.57 figure is the micro-dollar value floored to the cent.

**CollateralAgent**

15. **Amount due: "at the acceleration time" (Exhibit A, which controls by decision 18) against "at the enforcement timestamp" (Earn §5).** Part 2 gives the Agent no accelerate power, so the only on-chain time is the Enforcement Notice. Built at the enforcement time.
    - With a Payment Default and no declaration, unmatured bonds are still counted at their Accreted Value, although IV-10 §7.5 shares by the amount "then due".
    - For counsel.
16. **Mechanics.**
    - Distributions are pulled, after a batched snapshot. Claims wait until the snapshot is complete.
    - A round needs the USDC in the vault. Unclaimed amounts are kept out of every other outflow.
    - Across a second Enforcement Period, a bond's due is its Accreted Value less what it was paid or is still owed.
17. **Cost cap.**
    - It runs per Enforcement Period. $50,000 is a constant; 2% is of the vault's USDC at `enforce`.
    - A withdrawal is also limited by its own statement's amount.
    - Required-Holder approvals are recorded by the Agent Key and apply after 7 days. That means the Agent records a raise of its own cap; the chain cannot count Required Holders without a bond register. For counsel.
18. **Required-Holder block (Part 4).** It is recorded by the current Agent Key, or by the proposed key, which is in the Agent's custody.
    - A compromised current key could block a replacement indefinitely. It could take no asset by doing so.
    - The alternative is an on-chain Required-Holder tally by Accreted Value, which needs stage 2's register.
19. **Treasury two-person control** is on chain: two distinct `TREASURY_ROLE` addresses, at least two at initialization, in addition to the Safe's own threshold.
    - A change's 7 days run from the second signer's confirmation.
    - The CollateralAgent's own changes also need its admin (the Earn timelock). The two 7-day waits can run at the same time.
20. **Decision 19 routes to the Defaulted Amount only**, not to the amount that ends a Shortfall, even when §6.1(b) permits enforcement.
    - The debt part is paid to the pledge module, which applies it.
    - Plan ambiguity 3 (is the pledge released?) is stage 2's: the burn of a bond paid in full must release its pledge.
21. **Reason codes** may be any non-zero code. Exhibit B names a Payment Default and an Insolvency Event; the limit to §7.2 is contractual.

**Earn timelock**

22. **BondVault and the bond collections** are still in the credit handover. Decision 2's Earn timelock should take them in stage 2, together with the Agent co-signature gating.
23. **Deployer roles.** The handover renounces every deployer role on the Earn contracts (`OPERATOR_ROLE` and the rest) without granting them to the timelock, which may grant them later.

**IV-02 items that touch these contracts but are not built**

24. **§10.2(c):** at most 35 non-accredited purchasers in any 90 days, across every 506(b) offering including BurnerBonds. Not on chain.
25. **§10.7 and Exhibit B:** the Independent Manager's $10,000 cap, Insider trading windows and pre-clearance. Not on chain; an attested per-account cap could carry them.
26. **§2.1:** natural person, age, Voting Member, residence, W-9, KYC and the Investor Questionnaire. Covered only by the attestation.
27. **§4.3** adds a Deployment cap: the Deployed Balance may not exceed the Pool Tiers' principal plus Margin Advances. That is the pool's; flagged for its next pass.

## 4. What stage 2 must wire

### Bonds (the new collection)

- **Value.**
  - `Accretion.accretedValue(maturityAmount, issueYieldBps, maturityDate, t)` replaces the straight-line `presentValueOf`.
  - `Accretion.purchasePrice(M, y, termDays)` prices quotes, with maturity = issue + `termDays` days.
  - `Accretion.rollTerms(oldM, y, rollTerm, 10**4)` gives a roll's new Maturity Amount, price and remainder.
  - Optionally cache `dayFactorUp(y)` per bond.
- **Purchase.**
  - Call `controls.checkPurchase(payer, holder, price, maturityAmount, termDays, attestation)` and store the returned `exemptionCode`.
  - Grant `BOND_ROLE` with `grantRoleByResolution`.
  - Call `recordBondExit(holder, purchasePrice)` whenever a bond leaves: settlement, `payPledged`, buyback, `redeemAll`, or a distribution burn.
- **Roll.**
  - Require `controls.rollAllowed()` (or `agent.enforcementInForce() == false`) and `!holderIneligible(holder)`.
  - Take the term from `rollTermFor(term)` (0 means no roll) and the yield from `rollYieldFor(rollTerm, noticeYield)`.
  - A roll does not call `checkPurchase`.
- **Transfers.** The token hook calls `transferAllowed(from, to)`, and operator approvals revert.
- **Payments.** Maturity and settlement payments go to `controls.payeeOf(holder)`.
- **During an Enforcement Period** (`agent.enforcementInForce()`): purchases, rolls (confirmed ones included), `settle`, `payPledged`, buyback and `redeemAll` revert.
- **`IAgentBondBook`** (with the BondVault):
  - `outstandingCount`, `outstandingAt(i)`;
  - `amountDueAt(id, t)`, which is the Accretion value, or the Maturity Amount if matured;
  - `holderOf`;
  - `burnPaid(id)`, callable only by the CollateralAgent. It burns the bond and releases any pledge.

  Recorded settlement shortfalls (`pendingSettlement`) are also amounts owed to Holders; decide whether the book lists them as claims.

### BondVault

- **Implement `IAgentVault`:**
  - `collateralAssets()`;
  - `deployableExcess()`, net of `agent.unclaimedDistributions()`;
  - `agentTransfer(to, amount)` and `agentWithdrawExcess(to, amount)`, callable only by the CollateralAgent. The second also re-checks the reserve and that no Enforcement Notice is in effect.
- **Remove** `withdrawDeployable` (the single-key, any-address `TREASURY_ROLE` withdrawal) and `lendToPayoutPool` (C1). Excess leaves only through `CollateralAgent.executeExcessWithdrawal`.
- **Reserve:** `requiredReserve()` adds `agent.unclaimedDistributions()`.
- **Changes:** call `agent.consumeChange(keccak256(msg.data))` in `_authorizeUpgrade`, in every setter, and in `grantRole`/`revokeRole`.
- **Enforcement:** check `enforcementInForce()` in `recordPurchase`, `roll`, `settle`, `settlePledged`, `completeSettlement` and `settleEarly`.
- **For EarnControls:**
  - expose `inReserveShortfall()` (`IEarnReserveStatus`);
  - implement `IEarnControlsHook` (`holderEligibilityChanged`, `termOfferChanged`), so the 90-day 100% reserve moves in the same transaction;
  - `totalFaceOutstanding` already serves the Funding Limit.

### LendingPool

- **Point it at the real controls:** `setEarnControls(EarnControls)`, through the Earn timelock.
- **Holder cap:** remove `_checkHolderCap`, or keep `holderCapBps` at 10,000. The controls now count the household cap with the floor.
- **Add `lowUtilizationSince()`** (`IPoolUtilizationClock`, IV-02 §2.6). Until then, setting the §2.9(c) flag pauses subscriptions.
- **Admin:** the Earn timelock takes it, through `handOverEarn`, or through `creditToEarnCalls` where the credit timelock holds it.
- **Pool-side IV-02 items:** §4.3's Deployment cap, and §8.3's dollar redemption for a Successor.

### CollateralRegistry, the Liquidator and the pledge module

- **Implement `IAgentPledgeModule`:**
  - `enforcementPermitted(holder, bondId)`: MB-05 §6.1 as recorded on chain, pause-extended per addendum 4 decision 6;
  - `defaultedAmountOf(holder)`: decision 22;
  - `applyDistribution(holder, bondId, amount)`: apply USDC already received to the Defaulted Amount, as `applyMaturityInstruction` does. Callable only by the CollateralAgent.
- **Grant nothing to the Agent Key or the CollateralAgent** on the registry or the Liquidator. The tests prove both hold no role there.
- **Refused payers:** list the registry, the Liquidator, `PoolShareEnforcer`, the PayoutPool, ClaimEscrow, ESADepositVault, CLRUSD, the AssurancePool compartments, the BondVault and the issuers in `controls.setRefused`.

### Deploy config

- **`deploy/config/earn-controls.json`:**
  - set `fundingLimitDollars` with its resolution hash, `poolOfferingCapDollars` and `poolCapacityDollars`. They are 0 now, which refuses every subscription;
  - check `holderCapFloorDollars` (1,000,000) and `offeringCapDollars` (1,000,000).
- **EarnControls roles,** before the handover:
  - `ATTESTER_ROLE`: the app's signing key, plus two funded holders for households;
  - `PAUSE_ROLE` ×2, `SUCCESSOR_ROLE` ×2, `ELIGIBILITY_ROLE` ×2;
  - `BOND_ROLE` for the collection.
- **EarnControls wiring:**
  - `setSources(MembershipRegistry, LendingPool, BondVault, CollateralAgent, BondVault)`, only once the BondVault has `inReserveShortfall` and the hook; earlier, every subscription would revert;
  - `setBondBooks([BondVault])`;
  - the Ladder;
  - the refused list.
- **CollateralAgent:**
  - `AGENT_KEY`, `TREASURY_SIGNERS` (two or more), `COLLATERAL_ACCOUNT`, `AGENT_COST_ADDRESS` and `EXCESS_DESTINATION` for deploy 26;
  - after deploying, `setVault`, `setBondBook` and `setPledgeModule`, each through a co-signed change.
- **Handover:** run `earn_timelock_handover.ts` (`CLEAR_LENDING_SAFE`, `EARN_RESOLUTION`, `EARN_HANDOVER=1`).

## 5. App and API follow-ups

- **Eligibility service.**
  - Sign `EligibilityAttestation(account, exemptionCode, netWorth, issuedAt, validUntil)` (EIP-712, domain "EarnControls" "1").
  - Pass it to `subscribe(assets, receiver, attestation)`, or submit it once with `attestEligibility`.
  - Re-attest before `validUntil`.
  - The net worth is IV-03 §2.5's figure, in USDC units.
- **Households (IV-02 §2.5(c)).** An ops flow for two attesting-role holders to call `setHousehold(account, household)` from the Investor Questionnaire.
- **Subscription screen.**
  - The room left: the household cap above `holderCapFloor()`; net worth (`eligibilityOf`, `earnCostOf`); `poolCapacity`; `poolOfferingCap - poolOfferingTaken`; `fundingLimit - fundingUsed()`.
  - The pause state: `pauseFlags` and `subscriptionsPaused()`.
  - Show which limit refused, from `EarnControlsLimit(what, …)`.
- **Ops consoles.**
  - Two-person `setPauseFlag`, `approveSuccessorTransfer`, `registerPaymentSuccessor` and `setHolderIneligible`.
  - Ladder proposals through the Earn timelock.
  - Holders may `cancelPaymentSuccessor` from the app.
- **Collateral Agent.**
  - After `enforce`, call `snapshotBonds` in batches until complete.
  - After each `DistributionPosted`, push `claimDistribution(bondId)` for every bond. Claims are permissionless and pay only the Holder, the payment Successor or the pledge module.
  - Show the cost statements and the 7-day wait, change proposals with their confirmations and Agent approvals, and replacements, so Holders can direct a block.
- **Bonds.** Quotes and Accreted Value from `Accretion`, not the discount curve. Show the Ladder (`ladderTerms`, `ladderYieldBps`, `isTermOffered`).
- **Indexing.** Index the new events:
  - EarnControls: `OfferingTaken`, `EligibilityAttested`, `PauseFlagSet`, `HouseholdSet`, `EarnCostRecorded`, `SuccessorTransferApproved`, `PaymentSuccessor*`, `RungSet`, `HolderIneligibleSet`, `SettingsSet`, `HolderCapFloorScheduled`;
  - CollateralAgent: all of Part 6.
