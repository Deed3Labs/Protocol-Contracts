# Phase 2f, stage 2: the bonds and the BondVault

Branch `audit/phase-2f-bonds`: stage 1 (Earn controls and the Yield Pool's IV-02 conformance, b916b988), with `origin/dev` (Phase 2g, d96ca6fa) and `origin/audit/phase-2f-earn-pool` merged in, each with a merge commit. The spec branch was merged three times: decisions 30–32, then the corrected Earn requirements and IV-01 (1b66b549), then decisions 37–44 and IV-03 (4bb79d5b). No PR was opened.

Requirements: [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md) (decisions 1–44 control), [`specs/earn-contract-requirements.md`](./specs/earn-contract-requirements.md) (as corrected, with section 4A), [`specs/IV-01-burnerbond-terms-and-note-purchase-agreement.md`](./specs/IV-01-burnerbond-terms-and-note-purchase-agreement.md), [`specs/IV-10-burnerbond-collateral-agency-agreement.md`](./specs/IV-10-burnerbond-collateral-agency-agreement.md), [`specs/MB-05-security-and-pledge-agreement.md`](./specs/MB-05-security-and-pledge-agreement.md), [`PHASE-2F-PLAN.md`](./PHASE-2F-PLAN.md) and section 4 of [`PHASE-2F-EARN-CONTROLS.md`](./PHASE-2F-EARN-CONTROLS.md).

Nothing was deployed. No key was used and no live network was touched; no deploy or handover script was run. ESADepositVault, ClaimEscrow, the Liquidator, CollateralRegistry, LendingPool and its modules were not edited. No path exists between the BondVault or the bonds and the AssurancePool, the Loss Reserve or the ESA (`ReserveUntouched.spec` and `Assurance.spec` pass on the new collection).

## 1. Status by item

| Item | Status | Where |
|---|---|---|
| 1. Bonds: a new collection | Built | `BurnerBond.sol`, `BurnerBondBase.sol`, `BurnerBondPledges.sol` (v2), `BurnerBondIssue.sol` (new), `BurnerBondFactory.sol` |
| Compounding Accreted Value (R4) | Built. `accretedValue`/`presentValueOf` use `Accretion` at the bond's Issue Yield. The discount curve is gone from the collection | `BurnerBondBase._presentValue` |
| Purchase by quote (decisions 11, 31) | Built. The payer signs an EIP-712 `Quote(payer, holder, maturityAmount, termDays, yieldBps, quotedAt, nonce)`. The quote expires after 15 minutes (FIXED), is used once, and its term and yield must equal `EarnControls.rungAt(term, quotedAt)`. The Ladder is never re-read for the rate | `BurnerBondIssue.purchase`, `quotePrice`, `quoteDigest` |
| `checkPurchase`, `purchasesPaused`, `recordBondExit` | Built. `checkPurchase` on every purchase; its exemption code is stored on the bond. `recordBondExit` runs on settlement, `payPledged`, buyback, `redeemUnderWindDown` and distribution burns, but never on a roll | `_retire(…, exit)` |
| Offering cap | Built per decision 38, which replaced decision 32 mid-task: one cumulative counter across both products, by price paid, with rolls not counted | `EarnControls._takeOffering` |
| Roll by confirmation (section 4A; IV-01 §§5.1–5.5) | Built. Auto-roll, `rollBond`, `setAutoRollOptOut`, `willAutoRoll` and `setRollTerm` are removed. Details below | `postRollNotice`, `confirmRoll`, `confirmRolls`, `withdrawRollConfirmation`, `settle` |
| `buyback` and `redeemAll` (R5) | Built. `buyback(id, price, deadline, sig)`; the two-person wind-down flag, 30 days, then `redeemAll()` and `redeemUnderWindDown(id)`. A pledged bond goes through the pledged split (decision 14) | `BurnerBondPledges`, `BurnerBondIssue` |
| Transfers | Built. `transferAllowed` is called on every transfer, which must also be unpledged and not redeemed. A transfer withdraws any roll confirmation. `setApprovalForAll` reverts | `BurnerBondBase._beforeTokenTransfer`, `BurnerBond.setApprovalForAll` |
| No roll during enforcement (decision 19) | Built. Every vault outflow and `roll` reverts while `enforcementInForce()` | `BondVault.notEnforced` |
| 2. BondVault reserve (R2) | Built. Glide schedule; FIXED 30% floor that can only be raised; FIXED 90-day 100% reserve less confirmed rolls that can roll; computed Reserve Shortfall with `shortfallSince`, `inReserveShortfall()`, `pokeReserve()` and `topUp`. Recorded settlement shortfalls and unclaimed distributions are added on top | `BondVault.requiredReserve`, `glideReserve`, `nearTermReserve` |
| `IEarnControlsHook` | Built. A holder flagged ineligible, or a term change, moves the 90-day reserve in the same transaction | `holderEligibilityChanged`, `termOfferChanged` |
| `lendToPayoutPool`, `withdrawDeployable` (C1, decision 3) | `withdrawDeployable` and `setReserveTerms` are removed. `lendToPayoutPool` survives only as a stub that returns 0 and moves nothing (judgement call 14). `repayFromPayoutPool` stays. Excess leaves only through `CollateralAgent.executeExcessWithdrawal` → `agentWithdrawExcess`, to the registered multisig, proposed and executed by different signers | `BondVault` |
| C3 (decision 5) | Kept. `payPledged` (`settleEarly`) and the pledged split (`settlePledged`, `settleAt`, `completeSettlement`) pay only to the pledge module for the Holder's own debt. All are blocked while an Enforcement Notice is in force | `BondVault._settle` |
| 3. CollateralAgent wiring | Built. The BondVault implements `IAgentVault` and `IAgentBondBook`; `burnPaid` burns the bond in its collection and releases any pledge. Every upgrade, role grant, role revocation, setting and destination change on the vault, and every source change on a collection, calls `consumeChange(keccak256(msg.data))` once the Agent is named | `BondVault._change`, `BurnerBondBase._change` |
| 4. Decision 30: Required Holders | Built. A new contract, `HolderDirections`, takes the Holders' EIP-712 signatures and counts them against the bond register by Accreted Value at the record time. The CollateralAgent's `recordCostApproval` and `recordHolderBlock` now accept only that contract (`setHolderDirections`, co-signed). The stage 1 path, in which the Agent Key recorded them, is removed | `HolderDirections.sol`, `CollateralAgent.sol` |
| 5. Earn timelock handover (decision 2) | Done, in deploy config only. The BondVault and the bond collections moved from `credit_timelock_handover.ts` to `earn_timelock_handover.ts`. Never run | `deploy/earn_timelock_handover.ts` |
| 6. Deploy config | Done. Never run | `deploy/22_deploy_BondsAndPool.ts`, `deploy/23_deploy_BondCollection.ts`, `deploy/bondModules.ts`, `deploy/config/earn-controls.json` |
| Decisions 38–44 (added mid-task) | Built, each with a test | Section 1.3 |

### 1.1 Roll by confirmation

- **`postRollNotice(id, noticeHash, rollDeadline, termDays, yieldBps)`.**
  - Only an EarnControls `ROLL_NOTICE_ROLE` holder may post it (granted with a resolution). Once per bond, no later than 20 days before maturity (FIXED).
  - `rollDeadline` must be in the future and no later than the end of the day (Pacific) seven calendar days before the Maturity Date (FIXED; `latestRollDeadline`, `PacificCalendar`).
  - The term must be `rollTermFor(term)` now, and the yield at least the Ladder's for it and at most 50%.
- **`confirmRoll(id, noticeHash, sig)`.**
  - It needs the Holder's EIP-712 signature: `ConfirmRoll(bondId, noticeHash, rollDeadline, nonce)` in domain `BurnerBond`/`2`, which carries the chain id and contract. It is checked with `SignatureChecker` (EIP-1271).
  - Anyone may submit it. Each signature covers one bond.
  - `confirmRolls` takes arrays of single-bond signatures.
- **`withdrawRollConfirmation(id)`.** The Holder only, before the deadline. At and after the deadline both functions revert.
- **`settle(id)` on a confirmed bond.** It rolls, unless:
  - the Holder is flagged ineligible;
  - no term of the same length or shorter is offered (IV-01 §5.4);
  - the larger Maturity Amount would exceed the Funding Limit;
  - the Holder has no eligibility attestation in force (decision 44);
  - `redeemAll` has started.

  In any of those cases the bond is paid instead.
- **The roll's terms.**
  - Term: the same one, or the nearest shorter offered.
  - Yield: the notice's, or the Ladder's if higher.
  - The new Maturity Amount comes from `Accretion.rollTerms`, rounded down to the cent; the remainder is paid to the Holder.
  - The replacement is issued at the old Maturity Date. It starts with no notice and unconfirmed, keeps the cost basis, takes the exemption code of the attestation in force, and is re-pledged in the same transaction.

### 1.2 Required-Holder Directions (decision 30)

- **Required Holders** (IV-01 §1): more than 50% of the aggregate Accreted Value of the Bonds outstanding at the record time, excluding Clear insiders' bonds. Insiders are the accounts holding EarnControls `EXCLUDED_HOLDER_ROLE`, granted by resolution through the Earn timelock.
- **How a Direction is counted.**
  - `open(kind, subject, directionHash)`: a cost approval (subject = amount, during an Enforcement Period) or a block (subject = a pending replacement id). The record time is the time of opening.
  - `sign(id, holder, bondIds, sig)`: the Holder's EIP-712 `Direction(directionId, bondIds)`. It adds each bond's Accreted Value at the record time. A bond counts once, must have been outstanding at the record time, and must still be held by the signer.
  - `tally(id, maxCount)`: permissionless and batched over the vault's register (`registerLength`, `registerAt`, `registerEntry`).
  - `execute(id)`: records the Direction on the Agent once the signed value exceeds half the total.
- **Governance.** No admin and no upgrade.

### 1.3 Decisions 38–44

| Decision | Built | Test |
|---|---|---|
| 38: one $1,000,000 offering counter across both products | `offeringCap`/`offeringTaken` shared by `checkPurchase` and `checkSubscription`. The pool counters and `poolOfferingCap` are gone. `setOfferingLimits(cap, capacity, resolution)` | `EarnControls.spec` "38" |
| 39: `otherIndebtedness` | `postOtherIndebtedness(amount, evidenceHash)`: two different `FUNDING_ROLE` holders (a new role, granted by resolution). It is added to `fundingUsed()` and moves no money | `EarnControls.spec` "39" |
| 40: household cap of 10% × max(Pool Assets after, floor), always | `checkSubscription`, in shares: held ≤ supply after × bps × max(after, floor) ÷ (after × 10,000) | `EarnControls.spec` "(c)" (rewritten) and the floor test |
| 41: Ladder terms of 12–36 months, up to 60 by the timelock | A term is a number of days. A month is one twelfth of Accretion's 365-day year: 12 = 365, 36 = 1,095, 60 = 1,825 (`monthsToDays`, rounded down). `setMaxTermMonths` (36–60, the Earn timelock). `applyRung`, `applyRungs` and `setRung` revert with `EarnControlsLadderOrder` if an offered longer term would yield less than an offered shorter one. `scheduleRungs`/`applyRungs` move several terms together | `EarnControls.spec` "41" |
| 42: attestations of 12 months at most | `_eligible` refuses `validUntil > issuedAt + 365 days`, for `attestEligibility`, `checkPurchase` and `checkSubscription` alike | `EarnControls.spec` "42" |
| 43: no buyback while any settlement shortfall is unpaid | `buyback` refuses while `totalSettlementOwed() != 0` | `Bonds.spec` "43" |
| 44: a roll needs an attestation in force | `EarnControls.eligibleCode(account)`. With none, `settle` pays the bond. The replacement stores the code | `Bonds.spec` "44"; test 26 (a "506B" re-attestation is carried) |

## 2. Checks

### Production sizes

Measured with `npx hardhat clean && npx hardhat compile --force`: revert strings stripped, via-IR, runs 1.

| Contract | Runtime (left of 24,576) | Creation (of 49,152) |
|---|---|---|
| BondVault | 22,095 (2,481) | 22,232 |
| BurnerBond | 17,951 (6,625) | 18,382 |
| BurnerBondPledges (module) | 18,289 (6,287) | 18,716 |
| BurnerBondIssue (module) | 19,502 (5,074) | 19,612 |
| BurnerBondFactory | 7,482 (17,094) | 21,735 (it now takes a prebuilt implementation) |
| CollateralAgent | 20,482 (4,094) | 20,619 |
| HolderDirections (new) | 8,467 (16,109) | 9,968 |
| EarnControls | 18,568 (6,008) | 19,022 |
| EarnControlsAdmin (module) | 16,485 (8,091) | 16,622 |
| LendingPool (unchanged) | 23,000 (1,576) | 23,655 |

The collection's modules are chained through fallbacks: BurnerBond → BurnerBondPledges → BurnerBondIssue. Each pins the next in its constructor, checked by `IExtensionKind.extensionKind()` (`BurnerBondPledges.v2`, `BurnerBondIssue.v1`). `deploy/bondModules.ts` gives `bondAt(address)` with the joined ABI.

### Storage

- **`scripts/storage_report_bond_vault.ts`** (new; read-only) checks the BondVault against all three BondVault implementations in `.openzeppelin/base-sepolia.json` and against the pre-stage-2 source. All are compatible.
- **The layout.** Eleven new slots come from the gap, which goes from 31 to 20. `reserveWindow` is renamed (`@custom:oz-renamed-from`) and no longer read.
- **`test/earn/BondVaultUpgrade.spec.ts`** is an `upgradeProxy` rehearsal from `contracts/mocks/BondVaultPre2f.sol` (the source before this stage). Obligations, totals, the floor, backstops, the encumbrance source, roles and the old maturity buckets all carry over. Legacy obligations still settle.
- **Not deployed:** the collection (a new clone), EarnControls, the CollateralAgent and HolderDirections. Their layouts are free.

### Slither

Slither 0.11.6, Medium and High, run per changed contract with solc 0.8.38 (via-IR, runs 1). A whole-project run fails in crytic-compile on ClearUSD's source map; that file is unchanged. Every finding was triaged, and none is a defect.

| Finding | Where | Triage |
|---|---|---|
| `uninitialized-state` (High) | BurnerBondBase fields in a module's view; EarnControlsBase | The module-split false positive. The fields are written by the other part of the same storage |
| `arbitrary-send-erc20` | `BurnerBondIssue.purchase` (`q.payer`) | Bound to the payer's own EIP-712 signature over the quote, used once and within 15 minutes. Added to `Section2d.spec`'s reviewed pull paths |
| `arbitrary-send-erc20` | `BondVault._coverUpTo` (treasury) | Existing, already reviewed: Clear's own treasury allowance |
| `reentrancy-no-eth` | `_beforeTokenTransfer`; `setEarnSources`; `setSources` | The calls go to governed contracts (EarnControls, the BondVault, the Agent's `consumeChange`) before the writes. No asset moves in them |
| `incorrect-equality` | `redeemAll` (`setAt == 0`), `_payPledgedSplit` (`amount == faceValue`), `_setRolling`, `_applyPending`, `claimDistribution` | Intended state checks |
| `unused-return` | `settle` and `redeemUnderWindDown` ignore the vault's return | Intended: the vault records and emits what it paid and what it owes |
| `uninitialized-local` | `acc`, `prevDue`, `period`, `value`, `toDebt`, `owed`, `held`, `n` | Accumulators that start at zero |
| `divide-before-multiply` | `Accretion`, `PacificCalendar` | Library code, triaged in stage 1 and Phase 2e |

### Tests

New specs:

| Spec | Tests | Covers |
|---|---|---|
| `test/earn/Bonds.spec.ts` | 24 | See the list below |
| `test/earn/BondVaultUpgrade.spec.ts` | 1 | The upgrade rehearsal |

`Bonds.spec.ts` covers:

- acceptance tests 1 (IV-01 §7.3: $2,267.57, a $750.00 reserve, $1,517.57 may leave and $1,517.58 may not), 2, 3, 4, 5, 6, 7, 8, 10, 24 and 26;
- the term-withdrawal reserve;
- the settlement shortfall;
- `redeemAll`;
- decisions 30, 43 and 44;
- the test that an Enforcement Notice stops every outflow and every roll: purchases, excess, buyback, settlement, a confirmed roll, and the vault's `settleEarly`, `settlePledged`, `settleAt`, `completeSettlement`, `retireUnpaid` and `roll`. Distributions still pay, and burn in full.

Acceptance tests 16 (the confirmed pledged roll re-pledges) and 19 (the pledged maturity split, at $725 and $275) are in `PledgedBonds.spec`. Test 9 is in `CollateralAgent.spec`.

Run locally (the full suite runs in CI): every new and affected spec, 26 files in path order as CI loads them. **405 passing, 0 failing.**

- **Clock snapshots.** `Bonds`, `BurnerBond`, `BondCollateral`, `PledgedBonds` and `EarnControls` now revert the chain to a snapshot after each test. They travel years per test (terms of 12 to 36 months, rolls), and the chain clock is shared across a run. Without the snapshots, a run that also takes in the Yield Pool's 20-year Final Maturity tests pushed later specs past the BondVault's maturity buckets, which end in early 2109 (`BondVaultMaturityOutOfRange`).
- **Stage 3, CI.** If the full suite hits the same limit, add the same snapshot to any other spec that travels decades.

- `node scripts/command/code-fingerprints.mjs --check`: current (34 contracts).
- `node scripts/docs/contract-reference.mjs --check`: current. The BondVault and BurnerBond pages were regenerated.
- `node scripts/check-doc-links.mjs`: no broken links.
- `TURBO_SCM_BASE=origin/dev npx turbo run typecheck test --affected`: 3 of 3 tasks passed.

## 3. For the owner: judgement calls and conflicts

Where a decision exists, the decision's version is built. Otherwise the narrower, member-favourable reading is built and listed here.

**Spec against decision**

1. **Term withdrawal against decision 31** ("a change never alters a roll notice already posted"). The corrected requirements §2 and §4A, and IV-01 §§5.2(a) and 5.4, say that withdrawing a term stops a confirmed roll and restores the 100% reserve. These came from the coordinator after decision 31 and say they control the roll work, so they are built. The roll term is re-read at maturity (the same term, else the nearest shorter offered); with none offered, the bond is paid. Decision 31 is kept for the yield: the notice yield never falls, and a higher Ladder yield applies.
2. **`postRollNotice` takes the term and yield** (decision 11), two arguments more than the spec's `postRollNotice(id, noticeHash, rollDeadline)`. The term must be `rollTermFor(term)` when the notice is posted. The yield must be at least the Ladder's and at most 50%: a notice never offers less than the Ladder, and never a yield that Accretion cannot price.
3. **The `ConfirmRoll` signature adds a per-bond nonce** to the spec's fields (token id, `noticeHash`, `rollDeadline`, chain and contract). Without it, anyone holding a withdrawn confirmation's signature could replay it before the deadline. This protects the member.
4. **Root key against session key** cannot be told apart through EIP-1271. It rests on the app's session-key policy (decision 12) and the Privy real-device test.
5. **Decision 32 is replaced by decision 38**, as instructed: one counter across both products.

**Bonds**

6. **Purchase Price is floored to the cent** (owner call 14). The buyer pays less than the micro-dollar Accreted Value at issue, by under a cent. This matches $2,267.57.
7. **Who submits a purchase.** Anyone may submit the payer's signed quote; USDC is pulled from the payer, who must have approved the collection. `quotedAt` is the signer's, bounded by 15 minutes and the Ladder rate at that time (`rungAt`). Ladder changes are published 48 hours ahead (decision 31).
8. **A rolled bond is issued at the old Maturity Date**, not when `settle` happens to be called, so a late `settle` costs the Holder no accretion.
9. **Roll and the Funding Limit.** A roll that would push the Funding Limit over (IV-01 §5.4) is paid instead. Rolls are not counted in the offering cap (decision 38). Counsel note on IV-03 §6.4(b) stands.
10. **A transfer withdraws a roll confirmation**, because the new holder never signed it. This also covers IV-01 §6.3 ("a Successor who is not a Member … will not roll").
11. **A registered payment Successor** (`payeeOf`) receives settlements, the roll remainder, buyback proceeds and completed shortfalls. It does not by itself stop a confirmed roll.
12. **Buyback.** Any buyer may pay, from outside the vault, on the Holder's signature over the price and a deadline. The price is paid to the Holder (or payment Successor). It is refused on a pledged bond, during a Reserve Shortfall, while any settlement shortfall is owed (decision 43), and during enforcement. The vault drops the obligation and pays nothing.
13. **`redeemAll`.**
    - Two EarnControls `WIND_DOWN_ROLE` holders (a new role, granted by resolution) set the flag. Purchases stop at once.
    - After 30 days anyone may start `redeemAll`. It is irreversible, refused during enforcement, and no bond rolls after it starts.
    - Each bond is then paid its Accreted Value by `redeemUnderWindDown`; a short vault records a settlement shortfall.
    - For a pledged bond the Liquidator's `maturityToDebt` is asked with the Accreted Value in place of the Maturity Amount (decision 14, plan ambiguity 2). The Liquidator's pause and hold checks in `applyMaturityInstruction` apply.
14. **`lendToPayoutPool` is a stub that lends nothing** instead of being deleted. PayoutPool's code must not change (decision 3), and it calls the vault in its draw path; a missing function would make every due-claim draw revert until its vault leg is switched off. The stub returns 0 and moves no USDC. Deploy 22 switches the vault leg off by configuration once `borrowedFromVault` is 0.
15. **Display traits** are no longer written to the trait store on each mint, transfer or redemption (gas and size). The getters and the owner's `setBondTrait` remain. The bond's data is in `getBondInfo` and the events.
16. **A deactivated collection** (the factory owner's switch) stops purchases; its bonds still settle.
17. **Series** follows IV-01 §1: all bonds with the same Issue Date and Maturity Date. The vault keeps `seriesFaceOutstanding[issueDay << 32 | maturityDay]`.

**BondVault**

18. **The glide schedule is raise-only at every time to maturity**, not just its floor. This is narrower than "a 30% floor that can only be raised": a co-signed change may add or raise bands, never lower any bond's ratio. It ships with no bands (the floor alone), pending the BondVault parameters IV-01 §7.2(a) refers to. Reserve figures round up.
19. **The Reserve Shortfall is computed live.** `shortfallSince` is recorded by every state-changing call and by the permissionless `pokeReserve`; the two-Business-Day cure is tracked off chain from it. EarnControls' two-person `RESERVE_SHORTFALL` flag stays a separate pause (stage 1 call 7).
20. **An unpledged settlement on a short vault** now pays what the vault and the treasury hold and records the rest (Earn §4; plan row 25), instead of reverting.
21. **The reserve cannot see an attestation lapsing** (decision 44). A confirmed bond whose Holder's attestation expires before maturity counts as rolling until it is paid instead. This under-reserves Clear, never a member.
22. **Legacy obligations and old collections.** The vault's settlement and purchase signatures changed (`recordPurchase` takes the yield and term; `settleAt` is new). The old BurnerBondDeposit and any pre-2f collection can no longer record into, or settle through, the upgraded vault. Unwind the Base Sepolia legacy bonds (`scripts/unwind_legacy_bonds.ts`) before the upgrade. `scripts/redeploy_bonds.ts` is marked superseded.

**Agent and changes**

23. **Naming the Agent.** On a vault or collection with no Agent yet, naming one is the admin's alone. After that, every change is co-signed, so deploy 23 makes the vault's grants (including the Earn timelock's admin) before naming the Agent.
24. **`setLiquidator` on a collection** keeps its own 7-day delay (audit M-6) and is not co-signed. The Liquidator is the pledge side's (coordination).

**Required Holders (decision 30)**

25. **The record time is when the Direction is opened** (IV-10 §6.3 allows the time stated in it).
26. **Insiders** are the accounts holding EarnControls `EXCLUDED_HOLDER_ROLE` (Clear Lending's certified list). The bonds of an account that has already left the register count in the total, which is stricter.
27. **Bonds that cannot sign.** A bond rolled or burned after the record time cannot sign. The register covers only bonds recorded since this upgrade.
28. **Cost approvals still apply 7 days after they are recorded**, as in stage 1.

**EarnControls (decisions 39–41)**

29. **`otherIndebtedness`.** Each posting replaces the last, so it can fall as Lending Co. repays. It only ever adds to the check, which is how "can only make the check stricter" is read.
30. **`setMaxTermMonths`** may set 36 to 60 and back to 36. The order check applies to `setRung` as well as `applyRung`.

## 4. Existing tests changed, and why

| Spec | Change | Why |
|---|---|---|
| `test/peripherals/BurnerBond.spec.ts` | Rewritten for the new collection. Removed: pricing, the discount curve, the factory's discount bounds, `makeDeposit`, `redeemBond`, batch redemption and auto-roll. Kept and moved: the collection, clones, wiring, value and settlement | Decision 8 and C7 (curve, auto-roll, Holder roll); R4; Earn §§1 and 4A |
| `test/peripherals/BondCollateral.spec.ts` | Purchase by quote. `other` is the member's second Smart Account. `redeemBond` became `settle`; `rollBond` became notice + confirmation + `settle`. The value-at-issue checks allow the sub-cent floor | Decision 8; Earn §1 allowlist; §4A; owner call 14 |
| `test/audit/compliance/PledgedBonds.spec.ts` | Purchase by quote at 11.11% (a $900 price for $1,000). Test 18 at the compounding Accreted Value ($948.55 at half way, not $950). Test 19 "auto-roll off" became "no Roll Confirmation". The pledged-roll test became test 16's confirmed roll. The entry-point list and the module kind (v2) are updated | R4, decision 8, §4A |
| `test/peripherals/BondVault.spec.ts` | `recordPurchase` takes the yield and term. `setReserveTerms` became `raiseReserveFloor` (raise-only). The `withdrawDeployable` tests became Agent-only checks | Earn §2 (FIXED floor); C1, decision 3 |
| `test/core/BondBackstop.spec.ts` | A short vault records a `SettlementShortfall` instead of reverting | Earn §4, plan row 25 |
| `test/core/BondSeniority.spec.ts` | `withdrawDeployable` became `agentWithdrawExcess` (Agent only) | C1, decision 3 |
| `test/core/PayoutLifecycle.spec.ts` | The vault no longer lends; the two lending tests and the carry-share test became one "draws nothing from the bond vault" | C1, decision 3 |
| `test/audit/deep/PeripheralRegressions.spec.ts` | M-8: the stub lends nothing and repayment books carry. X-10 on purchases by quote. M-6: no operator approvals | C1; decision 8; Earn §1 |
| `ReserveUntouched`, `Assurance`, `Addendum2Relief`, `Section12Liquidator` specs | Build the new collection with `deployBondStack` | The new collection |
| `test/audit/compliance/Section2d.spec.ts` | The purchase pull is added to the reviewed pull paths | Bound to the payer's own signature |
| `test/earn/CollateralAgent.spec.ts` | The cost approval and replacement block come from HolderDirections, not the Agent Key; the surface lists move | Decision 30 |
| `test/earn/EarnControls.spec.ts` | Single offering counter; household cap of 10% × max; Ladder terms of 12–36 months; new tests for 38, 39, 41 and 42 | Decisions 38–42 |
| `test/deploy/Earn.deploy.spec.ts` | New test: the BondVault and a collection move to the Earn timelock; the credit handover no longer lists the vault | Decision 2 |

## 5. What the enforcement side must provide or change

Today's interfaces are kept. Nothing on the enforcement branch's files was edited.

1. **`IAgentPledgeModule`** (`enforcementPermitted`, `defaultedAmountOf`, `applyDistribution`) is not built here. It needs the Liquidator's MB-05 state; implement it in the Liquidator or `PoolShareEnforcer`, then make a co-signed `CollateralAgent.setPledgeModule`.
2. **`Liquidator.maturityToDebt(member, bondId, amount)`** is now also called before maturity under `redeemAll`, with the Accreted Value as `amount` (decision 14). It must stay a pure on-chain computation from that amount. `applyMaturityInstruction` is called by the collection or the vault, as today.
3. **The `IEarnBonds` reads still hold:** `presentValueOf` (now compounding), `bondVault`, `balanceOf`, `collateralKind`. `pledgePaymentDue` and `applyPledgePayment` are unchanged. The MB-05 §7 order (decision 20, the bond nearest maturity first) belongs in `pledgePaymentDue`.
4. **CollateralRegistry:**
   - the collection calls `rollItem` on a confirmed roll, and `releaseRetiredItem` on `payPledged`, the split, `redeemUnderWindDown` and `burnPaid`. The collection keeps `ITEM_ROLLER_ROLE`;
   - `BondValuer` is unchanged and now values bonds by compounding Accreted Value.
5. **Refused payers** (`EarnControls.setRefused`): add the BondVault, each bond collection, HolderDirections and the Agent to stage 1's list.
6. **During enforcement every collection outflow reverts in the BondVault,** so a bond is paid only through the Agent's rounds (decision 19). A pledged bond's share is routed by `routeDistribution` once the pledge module exists.

## 6. App and API follow-ups

- **Purchase.** Sign `Quote(payer, holder, maturityAmount, termDays, yieldBps, quotedAt, nonce)`: EIP-712, domain `BurnerBond` version `2`, the collection's address. Approve the collection for the price (`quotePrice`), then call `purchase(quote, sig, attestation)`. Show the Ladder and each term's 12-month equivalent.
- **Retire the old paths.** BurnerBondDeposit's `makeDeposit`, the discount curve, `redeemBond`, `rollBond` and auto-roll are gone. Files: `apps/member/src/components/BondDepositForm.tsx`, `apps/member/src/lib/sendCalls.ts`, `apps/api/src/services/chain/earnReader.ts`. Settlement is the permissionless `settle(id)`.
- **The roll screen.** Per bond, sign `ConfirmRoll(bondId, noticeHash, rollDeadline, nonce)` with the root key, never a session key. Withdraw before the deadline. Read `rollNotice(id)` (term, yield, deadline, confirmed, nonce) and `latestRollDeadline`. Several bonds go in one `confirmRolls` call. Send a reminder two Business Days before the deadline.
- **Ops consoles:**
  - `postRollNotice` (the fifth Business Day computed off chain);
  - `setWindDown` (two signers), then `redeemAll` and `redeemUnderWindDown` batches;
  - `postOtherIndebtedness` (two signers);
  - `scheduleRungs`/`applyRungs`;
  - the reserve: `requiredReserve`, `glideReserve`, `nearTermReserve`, `shortfallSince`, `topUp`, `pokeReserve`;
  - settlement shortfalls and `completeSettlement`.
- **Buyback.** The Holder signs `Buyback(bondId, price, deadline)`; the buyer approves the collection and calls `buyback`.
- **Required Holders.** A signing flow for `Direction(directionId, bondIds)` (domain `HolderDirections` version `1`), and a keeper for `tally` batches and `execute`. Clear's certified insider list becomes `EXCLUDED_HOLDER_ROLE` grants.
- **The API.** Use the joined ABI (`deploy/bondModules.ts` `bondAbi`). Index the new events:
  - collection: `BondMinted`, `BondRolled`, `RollNoticePosted`, `RollConfirmed`, `RollConfirmationWithdrawn`, `BondBoughtBack`, `WindDown*`, `RedeemAllStarted`, `RedeemedUnderWindDown`, `BondPaidThroughDistributions`;
  - vault: `ReserveShortfall`, `ReserveShortfallCured`, `RollConfirmationSet`, `BondTermsRecorded`, `RollRemainderPaid`, `BondRetired`, `ExcessWithdrawn`, `AgentTransfer`, `GlideScheduleSet`, `ReserveFloorRaised`;
  - HolderDirections: `Direction*`;
  - EarnControls: `OtherIndebtednessPosted`.
- **Deploy operators.** Before the handover: `EARN_RESOLUTION`, `ROLL_NOTICE_SIGNERS`, `WIND_DOWN_SIGNERS`, `FUNDING_SIGNERS`, `EXCLUDED_HOLDERS`. Afterwards, co-signed changes for `CollateralAgent.setVault`, `setBondBook` and `setHolderDirections`. Unwind the Base Sepolia legacy bonds before the BondVault upgrade.
