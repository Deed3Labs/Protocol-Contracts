# Phase 2f, stage 2: the enforcement side

Branch `audit/phase-2f-enforcement`: the finished Yield Pool (`f9d091b7`) with `origin/dev` (Phase 2g, #898, `d96ca6fa`) merged in by a merge commit, with no conflicts. No PR was opened.

Controlling texts: [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md) (decisions 4, 7, 9, 10 and 19–22, and the counsel note on MB-05 §5.3), [`specs/MB-05-security-and-pledge-agreement.md`](./specs/MB-05-security-and-pledge-agreement.md) (the pledge and its enforcement), [`specs/addendum-4-decisions.md`](./specs/addendum-4-decisions.md) (the Phase 2g pause rules, decisions 3–6, 34 and 35), [`PHASE-2F-YIELD-POOL.md`](./PHASE-2F-YIELD-POOL.md) §10 and [`PHASE-2F-PLAN.md`](./PHASE-2F-PLAN.md) §4.

Nothing was deployed, no key was used and no live network was touched. ESADepositVault, ClaimEscrow, the bond contracts, BondVault, EarnControls, CollateralAgent and the Earn timelock are unchanged. No admin power was widened (section 3, item 18).

## Summary

| Item | Status |
|---|---|
| 1. `PoolShareEnforcer` (decisions 7 and 10, C5): redeems only the shares still needed, through the queue; proceeds pay the Defaulted Amounts, oldest plan first; surplus to the Holder | Done |
| 1. `seizeShares` removed from LendingPool and YieldPoolValuation; the Liquidator's transfer exemption and its share paths removed | Done |
| 2. C2 (decision 4): a missed cycle takes nothing | Done (`settleExcess` removed) |
| 2. Decision 20: MB-05 §7.1's order; nearest maturity first, or the member's signed order before any notice | Done |
| 2. Decision 21: one combined Shortfall; pool shares first, then bonds; 72 hours longer by paused time | Done |
| 2. Decision 22: capped at the Defaulted Amount recorded on chain; replaces `_owedIn` and `_securedOwedOn` | Done (also applied to Savings, §7.2: see section 3, item 1) |
| 2. Decision 9: a pledge secures all MB-05 secured debt | Done |
| 2. MB-05 §5.3: the higher of the stored and current advance rate | Done (in CollateralRegistry) |
| 2. Phase 2g: every pause check, decision 35, 12.14 timing | Kept |
| 2. Size: Liquidator split into a delegatecall module | Done: 14,265 bytes runtime (10,311 free) |
| 3. CollateralRegistry: pool shares by `previewRedeem`; the member's order; §5.3 | Done |
| 4. Deploy config: PoolShareEnforcer, roles, module, the old grant removed | Done in `deploy/25_wire_Compliance.ts` (not run) |
| Extra: the decision 19 hook the bond side needs (`Liquidator.applyDistribution`) | Done |

## 1. What changed

| File | Change |
|---|---|
| `contracts/peripherals/PoolShareEnforcer.sol` (new) | The pledge module's pool-share side. Not upgradeable; no owner, role or setter. `enforce`, `settle`, `cancelExcess` (all permissionless); views `valueNeeded`, `sharesNeeded`, `defaultLockValue`, `noticeRecorded` |
| `contracts/peripherals/LiquidatorBase.sol` (new) | The Liquidator's storage (same order as Base Sepolia, two slots taken from the gap), errors, events, and the shared helpers, including the revolving Defaulted Amount (`_revolvingDue`) |
| `contracts/peripherals/LiquidatorEnforcement.sol` (new) | Delegatecall module, created by the Liquidator's constructor (`extensionKind` `LiquidatorEnforcement.v1`): `pledgePaymentDue`, `applyPledgePayment`, `applyPoolProceeds`, `applyDistribution`, `maturityToDebt`, `applyMaturityInstruction`, `noticeShortfall`, `shortfallOf`, `earnDefaultedOf`, `nextBondOf` |
| `contracts/peripherals/Liquidator.sol` | Keeps Savings (`liquidate`, `settleFromSavings`), the Liquidation Hold, the settings and the forwarding stubs (same selectors, so the bond collection's interface is unchanged). Removed: `liquidateShares`, `_takeShares`, `settleRealized`, `settleExcess`, `settleShortfall`, `earnGapOf`, `_requestedBond`, `_owedIn`, `_securedOwedOn`. New setting: `setPoolShareEnforcer` |
| `contracts/peripherals/CollateralRegistry.sol` | Pool shares valued by the valuer's `previewRedeem` and locked by its `previewWithdraw`; the §5.3 higher-of rule; `setEnforcementOrder` (EIP-712, the member's signature) and `enforcementOrderOf`; `recordEnforcementRedemption`; the set-once `enforcementSource`; a default lock on pledged pool shares |
| `contracts/peripherals/LendingPool.sol`, `LendingPoolBase.sol`, `YieldPoolValuation.sol` | `seizeShares` and the `LIQUIDATOR_ROLE` transfer exemption removed (the constant stays, inert, so scripts can revoke it). Each holder's filled enforcement shares and proceeds are recorded (`enforcementFilledOf`), one slot from `__yieldPoolGap` (50 → 49) |
| `contracts/mocks/MockMissedCycleIssuer.sol`, `MockSecuredTermPlans.sol` (new) | Test-only: the revolving default's recorded figures and `cycleOf`; a term issuer's secured plans |
| `deploy/25_wire_Compliance.ts` | Deploys and wires PoolShareEnforcer, makes the pool the POOL_SHARE valuer, revokes the Liquidator's old pool role (section 6) |
| `scripts/command/ops-roles.map.json`, `ops-roles.ts`, `drill_ops_roles.ts` | The role check is now ENFORCER_ROLE held by PoolShareEnforcer; checks of contracts not deployed on a network are skipped |
| `docs/protocol/credit.md`, `bonds.md`, `settlement.md`; regenerated `contracts/Liquidator.md`, `contracts/LendingPool.md`; `packages/command-types/src/chain/code.json` | The guides and generated files |

### How enforcement works now

- **When.** Only on a default after notice and cure, as an issuer records it, or a Shortfall noticed at least 72 hours ago (longer by paused time). Never on a missed cycle (C2). Never while a Liquidation Hold or a 10c pause is in force: `liquidate`, `pledgePaymentDue` (so `payPledged`), `applyPledgePayment`, `PoolShareEnforcer.enforce` and `settle` (through `applyPoolProceeds`) all wait.
- **How much (decision 22).** Read from what the issuers record:
  - **Revolving line** (`cycleStateOf`):
    - the past-due Secured Minimum (`min(pastDueSM, securedPastDue)`), which the line's secured positions pay;
    - the unpaid second Rebalance Amount (`cureAmount`), which is unsecured.

    Both are less what enforcement has already applied in that default episode (keyed by `cureDueAt`), because the issuer does not lower them for a settlement out of collateral. The whole balance never counts.
  - **Secured term plan**: `min(noticeDue − repaid, owedOn)` once its default is recorded, and `owedOn` (the whole balance) once its schedule has ended.
- **What is secured (decision 9).** Every trusted issuer's Defaulted Amounts, for every pledge. A plan counts only if the member secured it by signature (`securedPlans.defaultedAt` is set only for those).
- **Order (MB-05 §7.1; decisions 10, 20 and 21).**
  - Savings pays only the savings tier.
  - On a default, bonds come first: a bond is due while the Defaulted Amounts exceed what queued pool shares will pay. Pool shares come second: the enforcer asks only for the Defaulted Amounts less the pledged bonds' Present Value, less what is already queued.
  - Proceeds pay, in order:
    1. each line's past-due Secured Minimum, on the bond and pool-share tiers (the paying kind's own tier first);
    2. the secured plans, oldest id first;
    3. each line's unpaid Rebalance Amount, on BOOST then INCOME.

    They never pay Savings or the workout plan.
  - On a Shortfall, pool shares come first: `ceil(gap ÷ (1 − rate))` of Pool Share Value, capped at the pledge. A bond is due only when all the pledged pool shares could not end the Shortfall.
  - Among bonds, the next bond is the first still pledged in the member's own order, else the one nearest maturity.
  - Each payment is applied only up to the Defaulted Amounts or the Shortfall still open. The surplus goes to the Holder in the same transaction.
- **Pool shares (C5).**
  - `enforce(holder)` calls `LendingPool.enforcementRedeem(holder, shares)`. The shares stay in the holder's name in the queue and are paid at Share Value at fill, to the enforcer. The holdback is recorded to the holder.
  - `settle(holder)` hands the pool's newly filled proceeds and shares to `Liquidator.applyPoolProceeds`. That call takes the shares out of the pledge (`recordEnforcementRedemption`), applies the proceeds and pays the rest to the Holder.
  - `cancelExcess` lets anyone return queued shares that are no longer needed.

## 2. Checks

**Production sizes** (`npx hardhat compile --force`, no KEEP_REVERT_STRINGS). Nothing in the build exceeds 24,576 runtime or 49,152 initcode.

| Contract | Runtime | Free | Initcode | Before |
|---|---|---|---|---|
| Liquidator | 14,265 | 10,311 | 31,758 (creates its module) | 24,454 / 24,591 |
| LiquidatorEnforcement (new) | 17,109 | 7,467 | 17,246 | — |
| PoolShareEnforcer (new) | 8,217 | 16,359 | 8,775 | — |
| CollateralRegistry | 18,017 | 6,559 | 18,154 | 15,907 |
| LendingPool | 23,028 | 1,548 | 23,482 | 22,924 |
| YieldPoolValuation | 22,514 | 2,062 | 22,651 | 22,844 |

**Storage** (OpenZeppelin `getStorageUpgradeReport`, current build): against `.openzeppelin/base-sepolia.json`, Liquidator ×2, CollateralRegistry ×2 and LendingPool ×2 are compatible; against `.openzeppelin/base.json`, ESADepositVault ×2 and ClaimEscrow are compatible (untouched). The Liquidator's fields moved into `LiquidatorBase` in the same order. Two gap slots were taken (`poolShareEnforcer`, `enforcedOn`; `__gap` 32 → 30). CollateralRegistry took two (`enforcementSource`, `_enforcementOrder`; 37 → 35). `realizedPendingOf` and `retiredEnforcing` stay, unread. ESADepositVault and ClaimEscrow are untouched.

**Slither** 0.11.6, Medium and High, per contract (via-IR, runs 1, solc 0.8.29), against the same run on this branch before the change:

- CollateralRegistry, LendingPool and YieldPoolValuation have the same counts as before (1, 46 and 25: the triaged classes in the Yield Pool report).
- Liquidator: 24, against 15 before. `incorrect-equality` fell from 7 to 3 with the removed code. The new findings, none of them a defect:
  - `incorrect-return` (High, 4): the forwarding stubs end in an assembly `return`, by design, as RevolvingIssuer's do.
  - `uninitialized-state` (High, 9): the module-split false positive. The Base fields are written by the Liquidator's `initialize` and setters, which Slither does not connect to the module's reads.
- LiquidatorEnforcement: 14, as follows:
  - `uninitialized-state` (the same false positive);
  - `uninitialized-local` (an accumulator that starts at zero);
  - `unused-return` (partial tuple reads of `planAt`, `scheduleOf`, `securedPlans` and `tierAt`).
- PoolShareEnforcer: 14, as follows:
  - `uninitialized-state` (LiquidatorBase's fields: it imports LiquidatorBase only for the `Hold` type and has no such state);
  - `incorrect-equality` (`shares == 0`);
  - `unused-return` (partial tuple reads).

**Generated files and links**:

- `code-fingerprints.mjs` regenerated `code.json`, and `--check` passes;
- `contract-reference.mjs` regenerated `Liquidator.md` and `LendingPool.md`, and `--check` passes;
- `check-doc-links.mjs` finds no broken links.

**`npx turbo run typecheck test --affected`** (Node 22, bun installed, `TURBO_SCM_BASE=origin/dev`): 3 of 3 tasks pass.

**Tests** (section 5).

## 3. Judgement calls and conflicts, for the owner

1. **Savings and decision 22 (the one that matters most).** Decision 22 cites MB-05 §7.2, which caps CLRUSD at "the Defaulted Amount of Savings-Backed Drawn". The issuer records no per-kind past-due amount, so two readings were possible:
   - the line's whole past-due amount; or
   - only the part of it that is a Savings-Backed or other secured amount, the past-due Secured Minimum.

   The second is the narrower, member-favourable reading, and the one MB-05 §2.5(a) supports (CLRUSD "can never be applied to any other obligation"). It is built.

   **Consequence:** a revolving default turns on the unsecured Rebalance Amount. The issuer charges the Secured Minimum on savings principal only when no unsecured principal is drawn. So a default today usually leaves none of the savings tier past due. `liquidate` then reverts `LiquidatorNothingToSeize`, and the savings-backed debt stays owed and locked. The member may still apply their savings by their own instruction (`settleFromSavings`, MB-05 §7.9). MB-05 example 1 (Dana) is reproduced at its figures with the past-due amount recorded as Secured Minimum, but the current cycle rules never produce that record.

   **If the owner reads a recorded default (which zeroes the line's ceiling and deletes its period) as "the line on its closing"**, the savings tier's whole balance has come due. That is a change in `LiquidatorBase._revolvingDue`: return the secured tiers' principal as `sm` once `hasDefaultedOnCurrentLine`. It was not built, because decision 22 says a default does not by itself make the balance due.
2. **The revolving line has no on-chain closing apart from default**, so its whole balance never counts. **Issuer follow-up:** record a closing (and, ideally, the past-due amount per position at default).
3. **Tracking per default episode.** The issuer lowers `cureAmount` for a member's payment but not for a settlement out of collateral (`cures = false`), and never lowers `pastDueSM`. The Liquidator therefore counts what enforcement applied against each, keyed by the cure amount's due point. The registry's write-off at `triggerDefault` counts as a payment, so it lowers what the default leaves.
4. **Term plans.** A plan's Defaulted Amount is `min(noticeDue − repaid, owedOn)`, where `noticeDue` is the schedule's cumulative ask at the cure notice. The whole balance counts at the schedule's end (`scheduleStart + installments × length`), not at the 12.14 default.
5. **Order across debts.**
   - The order is: each line's Secured Minimum on its asset-backed tiers, then the secured plans oldest first, then each line's Rebalance Amount. This follows MB-05 §7.1(b) and then (d).
   - Plans: "oldest" is the lowest plan id.
   - Across issuers, the network registry's order.
   - Earn never pays the savings tier, which has its own collateral; the reading is narrower than MB-05 §2.5(b) allows.
6. **Decision 20, "within each kind".** The member's signed order reorders bonds among bonds. It does not change §7.1's order between kinds. This is the decision's literal reading.
   - The signature is EIP-712 `EnforcementOrder(address member,bytes32 kind,uint256[] itemIds,uint256 nonce,uint256 deadline)` on the registry's domain, using the pledge nonce.
   - "Before a notice" is enforced at submission: the registry asks `PoolShareEnforcer.noticeRecorded`, which is true while any of these is in effect: a Shortfall notice; a revolving `cureNoticeAt` on a trusted issuer; a secured plan's `noticeAt` with `repaid < noticeDue`.
   - Items not in the order, or no longer pledged, follow, nearest maturity first.
7. **A bond paid for a Shortfall is paid whole and closes all it can** (the bond tier, then the pool tier). The queued pool shares it makes unnecessary can then be cancelled back to the member. That redeems less than paying only the remainder and still redeeming the shares. The rule "pool shares first" is honoured by making a bond due only when all the pledged pool shares could not end the Shortfall.
8. **A Shortfall that closes and reopens.** Interruption is seen only when someone calls `noticeShortfall(member)`, which clears a closed notice, or when an application clears it. **Recommendation:** the API calls it after each repayment and pledge.
9. **The default lock on pool shares (new).** The pool redeems only shares its lock source reports as pledged, and the registry's lock covered only what is drawn under the pool-share tier. A secured plan's default could therefore never reach pool shares, against decision 10.

   While a recorded default leaves an amount pool shares are to pay (`defaultLockValue`: the Earn Defaulted Amounts less the bonds' Present Value), the registry now keeps that much of the pledged shares locked. This is on top of the tier's own need, never more than pledged, and like the 12.5 excess lock. It is computed from issuer state, and it fails open if the source cannot answer. MB-05 §4.2(b) locks every Pledged Earn Position, so this stays within the pledge.
10. **Proceeds under a hold or pause** wait in the enforcer. `settle` reverts until the hold or pause ends. The shares already queued are not cancelled (a hold only delays).
11. **Maturity Instruction (MB-05 §5.6)** now uses the combined Asset-Backed Drawn and Limit of §1.3: the bond and pool-share tiers, and every pledged bond and pool share. `applyMaturityInstruction` pays the bond tier, then the pool-share tier. Phase 2e measured the bond kind alone.
12. **§5.3**: `advanceBpsOf` and `itemAdvanceBpsOf` return the higher of the stored and current rate. CLRUSD's kind keeps its fixed terms (spec 10a).
13. **Pool-share valuation**:
    - A kind pledged in units whose `valuer` is set is valued by the valuer's ERC-4626 `previewRedeem`. If the valuer cannot answer, the value is nothing.
    - Its lock is sized by `previewWithdraw`; if that cannot answer, all is locked.
    - The pool is made POOL_SHARE's valuer by deploy 25. No new setter.
14. **`noticeShortfall(member)`** takes no issuer now. The combined notice is stored under issuer `address(0)` in the existing mappings. Entries made before, keyed by an issuer, are no longer read (testnet only).
15. **The Liquidator's module is created by its own constructor** (`new LiquidatorEnforcement()`), so an upgrade takes no constructor argument, unlike the issuer and pool modules. This kept every test and script that deploys the Liquidator unchanged.
16. **PoolShareEnforcer is not upgradeable** and has no admin. A fix means deploying a new one and moving the pool's role and destination and the Liquidator's setting. Proceeds it holds can be settled before the move. The registry's `enforcementSource` is set once, so a replacement enforcer would also need the registry upgraded.
17. **The decision 19 hook** (`applyDistribution`): a round's pledged share goes to the Defaulted Amounts only while no hold or pause is in force; otherwise all of it goes to the Holder. It never reverts for a hold, so one Holder cannot stall a round. Counsel's IV-10 §7.6 question stands.
18. **Admin powers.**
    - New: `Liquidator.setPoolShareEnforcer` (DEFAULT_ADMIN). The address it names can only bring USDC in and have it applied to the member's own Defaulted Amounts, with the rest paid to the member. It cannot take anything.
    - `CollateralRegistry.setEnforcementSource` is set once.
    - Removed: `seizeShares`, the pool's `LIQUIDATOR_ROLE` exemption, and the Liquidator's `OPERATOR_ROLE` paths (`liquidateShares`, `settleRealized`).
19. **Decision 35 and 12.14 timing** are unchanged. A workout plan's default records no line default and its tier is never paid. Plans default only through TermIssuer's 12.14 rules.

## 4. Existing tests changed, and why

Each change has a comment in the test giving the decision.

- `compliance/PledgedBonds.spec.ts`:
  - **decision 22**: defaults record their Defaulted Amount (`setDefaulted`); the order test now pays only the past-due amounts and returns the surplus;
  - **decision 20**: "the smallest bond that covers the need" became "the bond nearest maturity";
  - **decision 21**: `noticeShortfall(member)` and `shortfallOf`;
  - **C5**: no LIQUIDATOR_ROLE grant.
- `compliance/Section12Liquidator.spec.ts`:
  - **C2**: acceptance 22 now proves a missed cycle takes nothing, pool shares included, and the excess lock stays. The real-issuer end-to-end test shows the same;
  - **decision 22**: `liquidate` is capped at the past-due Secured Minimum and refuses the Rebalance Amount;
  - **12.6**: the hold blocks the enforcer;
  - **decision 21**: acceptance 26 runs through PoolShareEnforcer and the queue. New cases cover the combined Shortfall, bonds only for what pool shares cannot close, and cancelling the excess.
- `peripherals/AssetBackedDefault.spec.ts` (**C5, decision 22**): seize-and-redeem is replaced by queued enforcement of only the Defaulted Amount; the "lent out" cases wait in the queue.
- **Decision 22: Savings reach only the Defaulted Amount of Savings-Backed Drawn.** Where the property under test was the redemption itself, the member's own `settleFromSavings` now exercises it.
  - `peripherals/Liquidator.spec.ts`;
  - `compliance/Dfal.spec.ts` (acceptance 13: past the window the call passes the default check and takes nothing);
  - `compliance/ReserveUntouched.spec.ts`;
  - `compliance/Section2d.spec.ts` (acceptance 35 and 38);
  - `rereview/Decisions.spec.ts` (M-C and 4c item 3).
- `compliance/Addendum2Relief.spec.ts`:
  - **decision 22**: the 12.14 bond payment is checked against the plan's Defaulted Amount (its schedule had ended, so the whole balance);
  - **C2 and decision 21**: the removed calls.
- `compliance/Assurance.spec.ts` (**C2**): the excess call is replaced by the Shortfall notice.
- `deep/PeripheralRegressions.spec.ts` (**C5**, M-3): no seizure exists, and LIQUIDATOR_ROLE exempts nothing.
- `rereview/BlindReview.spec.ts` (**C5**, L-H): `settleRealized` is gone, and only the enforcer applies proceeds.

## 5. New tests

`test/earn/Enforcement.spec.ts`, 17 tests, at MB-05's figures where it gives them:

- **C5:**
  - there is no seizure anywhere, the enforcer has no admin, and LIQUIDATOR_ROLE exempts nothing;
  - only the shares needed are queued in the member's name and paid at Share Value at fill;
  - a payment made meanwhile becomes surplus to the Holder;
  - excess queued shares are cancelled back.
- **C2:** a missed cycle takes no pool share, bond or savings, still halves the limit and counts toward default, and the excess lock holds.
- **Decision 22:**
  - MB-05 example 1 (Dana): $250 redeems $250 and leaves $2,750;
  - $100 past due takes $100 only, and never the Rebalance Amount;
  - a secured plan pays $250 (the $300 noticed, less $50 repaid) and not the $1,200 balance, then the whole $900 at its end.
- **Decisions 9 and 10:**
  - a bond pays two defaulted plans oldest first, and pool shares are queued only for the rest, with the surplus to the Holder;
  - on a revolving default, the Secured Minimum, then the plans, then the Rebalance Amount.
- **Decision 20:**
  - nearest maturity first;
  - the member's signed order, refused when forged;
  - refused while a cure notice, a plan notice or a Shortfall notice is recorded, and allowed once cleared;
  - the source is set once.
- **Decision 21:** MB-05 example 2 (Eli):
  - $1,650 limit and $1,600 drawn; Pool Share Value falls to $900, giving a $20 Shortfall;
  - $66.67 of Pool Share Value is redeemed and no bond, leaving $1,533.33 drawn against $1,533.33.
- **Pause** (Phase 2g): with an account pause and then a vault pause, every path reverts (`liquidate`, `payPledged`, `enforce`, and `settle` of proceeds already filled). Each runs once the pause is lifted.
- **MB-05 §5.3:** a raise reaches existing pledges, a cut does not, and no Shortfall follows.
- **MB-05 §1.3:** Pool Share Value is `previewRedeem`, net of a 150 bps holdback ($985 on $1,000), and the lock is `previewWithdraw`.
- **Decision 19:** a round's pledged share pays the Defaulted Amount and the rest goes to the Holder; under a hold all of it goes to the Holder; only the collection or its vault may call.
- **The module:** created by the implementation, pinned by kind, and inert when called directly.

**Runs** (local, KEEP_REVERT_STRINGS): every spec touching the Liquidator, CollateralRegistry, LendingPool, the bonds or the issuers, 32 files (the new spec, the eleven changed above, and AuditPoC2, Addendum4Credit, Addendum4Delisting, Revolving, AssetBackedTier, FirstLossOrdering, PayoutLifecycle, RepaymentRouting, BondCollateral, BurnerBond, CollateralRegistry, LendingPool, LimitCalculator, ClearUSDUpgradeable, OffersIssuer, RevolvingIssuer, YieldPool, YieldPoolUpgrade, Vault.deploy): **607 passing, 0 failing** (590 in one run, with the new spec's decision 19 test run again on its own after it was added; the spec: 17 passing). The full suite was not run locally; CI runs it. `npx turbo run typecheck test --affected`: section 2.

## 6. Deploy configuration (not run)

`deploy/25_wire_Compliance.ts`, idempotent. Where the deployer lacks the admin role, it prints the proposal instead.

- It deploys `PoolShareEnforcer(pool, liquidator, registry)`.
- On LendingPool it grants `ENFORCER_ROLE`, records `setEnforcementDestination(enforcer)`, and revokes the Liquidator's `LIQUIDATOR_ROLE` (the old seizure grant). After the Earn timelock handover these are proposals.
- On the Liquidator it calls `setPoolShareEnforcer(enforcer)`.
- On CollateralRegistry it calls `setEnforcementSource(enforcer)` (set once) and `setCollateralValuer(POOL_SHARE, pool)`.

The Liquidator's upgrade is `upgradeProxy(liquidator, Liquidator, { kind: "uups" })`. The constructor creates the module, so no constructor argument is needed. The LendingPool upgrade is unchanged (`poolProxyOptions()`). `scripts/command/ops-roles.map.json` now checks ENFORCER_ROLE held by PoolShareEnforcer.

## 7. Bond-side hooks for the bond agent

No new hook is required. The Liquidator keeps today's interface:

- `pledgePaymentDue(holder, bondId)`, `applyPledgePayment(holder, issuer, onDefault, amount)`, `maturityToDebt`, `applyMaturityInstruction`.
- Callers: only the collection, or the collection's vault for `applyMaturityInstruction` and the new `applyDistribution`.

It reads these from the collection:

- `collateralKind()`, `balanceOf(holder, id)`, `presentValueOf(id)`, `bondVault()`;
- `getBondInfo(id).maturityDate`, for decision 20's nearest-maturity order. A new collection must keep `getBondInfo`, with `maturityDate` as the second field, or tell us its maturity view.

For the bond agent:

1. **Decision 19 (distribution rounds).** Use `Liquidator.applyDistribution(holder, amount)`, which the collection or its vault may call, with the pledged bond's share sent to the Liquidator first. Settle the bond's own record (burn or release) on the bond side as the round requires.
2. **`payPledged` must stay blocked while an Enforcement Notice is in force** (C3). That is the bond's check; the Liquidator does not know the Collateral Agent.
3. **Roll during enforcement** (decision 19): no Liquidator change.

## 8. App and API follow-ups

- **Liquidator ABI changes.**
  - Removed: `settleExcess`, `liquidateShares`, `settleRealized`, `settleShortfall`, `earnGapOf`.
  - Changed: `noticeShortfall(member)` takes no issuer, and the notice is at `shortfallNoticedAt(member, 0x0)`.
  - New: `shortfallOf(member) → (gap, dueAt)`, `earnDefaultedOf(member) → (due, issuer)`, `nextBondOf(member) → (found, bondId)`, `applyPoolProceeds`, `applyDistribution`, `poolShareEnforcer()`.
  - Events: `PoolProceedsApplied`, `DistributionApplied`, `ShortfallCleared(member)`.
- **LendingPool:** `seizeShares` is removed; `enforcementFilledOf(holder)` is new.
- **Keeper (API):**
  - after a default or a due Shortfall, call `PoolShareEnforcer.enforce(member)` and the bonds' `payPledged` for `nextBondOf`;
  - after fills, call `fillQueue` then `PoolShareEnforcer.settle(member)`;
  - after repayments, call `cancelExcess` for open enforcement requests, and `noticeShortfall(member)` to start or clear a Shortfall.
- **Default and Shortfall notices (MB-05 §§6.3, 6.5):** use `earnDefaultedOf`, `nextBondOf`, `shortfallOf` and `PoolShareEnforcer.valueNeeded` for the amounts and the order shown.
- **Member order (decision 20):** sign `EnforcementOrder` on the registry's EIP-712 domain at `pledgeNonces(member)`, and submit `setEnforcementOrder`. Hide the setting while `PoolShareEnforcer.noticeRecorded(member)` is true.
- **Copy:** a revolving default no longer takes the whole savings tier (section 3, item 1); say so in the app and statements.
- **Indexing:**
  - registry `EnforcementRedeemed` and `EnforcementOrderSet`;
  - enforcer `EnforcementRequested`, `EnforcementSettled` and `EnforcementCancelled`.
- **Operators:** run deploy 25 after the Liquidator, registry and pool upgrades; the Earn timelock proposes the pool steps.
