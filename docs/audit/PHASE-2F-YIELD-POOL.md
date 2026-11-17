# Phase 2f, stage 1, agent A: LendingPool becomes the Yield Pool

Branch `audit/phase-2f-yield-pool` (a copy of `audit/phase-2f-earn-pool`, with `origin/dev` and Phase 4c merged in by a merge commit). It merges into the 2f integration branch later; no PR was opened.

Requirements: [`specs/earn-contract-requirements.md`](./specs/earn-contract-requirements.md) §§6, 6A, 7, 8 and tests 11–15 and 20–25, [`specs/earn-glossary.md`](./specs/earn-glossary.md), Earn Addendum 2 in [`specs/addendum-3-and-earn-2.md`](./specs/addendum-3-and-earn-2.md), [`PHASE-2F-PLAN.md`](./PHASE-2F-PLAN.md) (R3, R6 and the §6–§8 rows) and [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md) decisions 1, 6, 7, 12, 13, 15, 16 and 17, with 21 and 22 noted. MB-05 §§1.3, 5.7 and 7.3(b) set the pledge side.

Nothing was deployed, no key was used and no live network was touched. No admin power was widened. The Liquidator, the issuers, BurnerBond, BondVault, CollateralRegistry, CLRUSD, ESADepositVault and PayoutPool are unchanged.

## Summary

- **`LendingPool` is the Yield Pool**, by an in-place UUPS upgrade (decision 16). It keeps its name, address, ERC-4626 shares and balances. Its storage is append-only against both LendingPool implementations in `.openzeppelin/base-sepolia.json`, and OpenZeppelin's storage report finds both compatible.
- **Share Value** = Pool Assets ÷ outstanding Pool Shares. Pool Assets = Vault Cash (less Holdback Amounts) + the Deployed Balance + accrued unpaid Pool Interest. `previewRedeem` is the Pool Share Value of MB-05 §1.3, net of the Loss Holdback.
- **Deployments and Returns (decision 17).** Only two `DEPLOYER_ROLE` signers can draw, and only to Clear Lending's registered lending account. Each draw is a recorded Deployment. Pool Interest accrues per second on the Deployed Balance at the Funding Rate. `returnFunds` (and `repay`, kept for the PayoutPool) pays interest first, then principal. `borrow` reverts and `borrowableToday` is zero, so the PayoutPool's unchanged code takes nothing from the pool.
- **Loss Holdback, valuation, queue, Suspension and Final Maturity** are built to §§6A, 7 and 8 and decisions 6 (C4) and 15.
- **Size.** The valuation, holdback, Suspension, rate-model and Deployment functions run in a new delegatecall module, `YieldPoolValuation`. It is passed as a constructor argument and checked with `IExtensionKind.extensionKind()`, as the issuer modules are. Production sizes: LendingPool 22,924 bytes runtime and 23,378 creation; YieldPoolValuation 22,844 and 22,981.
- **Tests.** Acceptance tests 11–15 and 20–25 use the spec's figures where it gives them (test 20 to the cent). They sit in `test/earn/YieldPool.spec.ts` (55 tests) with an upgrade rehearsal from the Base Sepolia source (`test/earn/YieldPoolUpgrade.spec.ts`, 4). Every spec that touches LendingPool passes: 279 tests in 13 files.
- **Conflicts.** No new conflict blocked an item. Section 8 lists six ambiguities for the owner. The one that matters at launch is the holder cap's bootstrap: a 10% cap counted against outstanding shares refuses the first subscriber.

## 1. What changed

| File | Change |
|---|---|
| `contracts/peripherals/LendingPool.sol` | Reworked in place into the Yield Pool: ERC-4626 core, subscriptions, the FIFO queue, Share Value and the views, the transfer allowlist and pledge lock, and stubs that forward to the module |
| `contracts/peripherals/LendingPoolBase.sol` (new) | Shared storage (the Base Sepolia layout, the Phase 1 fields, then the Yield Pool fields), errors, events and the accounting internals |
| `contracts/peripherals/YieldPoolValuation.sol` (new) | The delegatecall module: `initializeYieldPool`, governed settings, `deploy`, `postAllowance`, `postLossCharge`, `applyHoldbacks`, `releaseHoldbacks`, Suspension, the rate model, `returnFunds`/`repay`, `cancelRequest`, `enforcementRedeem`, `requestRunOff`, `seizeShares`, `claimWithdrawal`, `claimUnpaid`, `syncEncumbrance`, `setEncumbranceSource` |
| `contracts/peripherals/interfaces/IPoolEarnControls.sol` (new) | The minimal interface to the shared `EarnControls` that agent B builds (decision 1) |
| `contracts/mocks/MockEarnControls.sol`, `MockBlocklistERC20.sol`, `LendingPoolLegacy.sol`, `LendingPoolPre2f.sol` (new) | Test-only: the controls stand-in; a token that refuses a blocked receiver; the Base Sepolia source (commit 1a5386bc) for the upgrade rehearsal; and the pre-2f source as the stand-in lender for the PayoutPool's still-present yield leg |
| `deploy/poolModules.ts` (new), `deploy/22_deploy_BondsAndPool.ts` | `poolProxyOptions()` deploys the module and passes it as the constructor argument. Deploy 22 no longer grants `BORROWER_ROLE` or calls `setBorrower`; it registers `CLEAR_LENDING_ACCOUNT` as the deployment account when set |
| `test/earn/*`, `test/helpers/yieldPool.ts` (new); 10 existing specs updated | Section 5 |
| `docs/protocol/settlement.md`, `visa-card-purchases.md`, `contracts/LendingPool.md` | The pool guide, the card-flow note on decision 17, and the regenerated reference page |
| `packages/command-types/src/chain/code.json` | Regenerated fingerprints |

### Storage

Slots 351–360 are the Base Sepolia fields, unchanged. Slots 361–369 are the Phase 1 audit fields, which were never deployed there. The Yield Pool fields run from slot 370 to 405, followed by a 50-slot `__yieldPoolGap` (406–455). They use up the old 40-slot `__gap` (361–400) and run past it, which the last contract in the layout may do. The gap is named apart from `__gap` so the plugin does not read it as a resized gap. Retired fields stay in place, read only where a legacy value can still matter:

- `requests`, `queuedAssets` and `escrowedQueueCaps`: claims queued before 2f;
- `baseRatePerCycle` to `kinkBps`, the borrow-window fields and the X-18 fields: unread.

`.openzeppelin/base-sepolia.json` has two LendingPool implementations (0x24C4…2663 and 0xcB71…C034, both with the pre-audit layout). OpenZeppelin's `getStorageUpgradeReport` finds the new layout compatible with both. `test/earn/YieldPoolUpgrade.spec.ts` deploys that source and upgrades it with `upgradeProxy`, so the plugin checks the layout again.

### The upgrade call

`upgradeToAndCall(newImpl, initializeYieldPool(controls, deploymentAccount, initialClosing))`, sent by `DEFAULT_ADMIN_ROLE`:

- sets the rate model (2%, 3%, 80%, 5%), the 10% holder cap, the 540-day holdback age and the accrual clock;
- names the controls and the lending account;
- records the Initial Closing, which a pool with shares must supply;
- adopts the legacy borrowers' principal (`totalBorrowed`) as the opening Deployed Balance (section 7, call 5).

It runs once. A new pool's `initialize` sets the same defaults.

## 2. Requirements, item by item

| Item | Status | How |
|---|---|---|
| §6 Deposits only from eligible Smart Accounts, `exemptionCode`, Clear sources refused | Built (controls side is agent B's) | `subscribe(assets, receiver, attestation)`; `deposit`/`mint` pass no attestation. `IPoolEarnControls.checkSubscription` reverts for an ineligible or Clear-contract payer and returns the tag, which `Subscribed(payer, receiver, assets, shares, exemptionCode)` records. The pool never branches on it. With no controls set the pool fails closed |
| $250 minimum (FIXED); 10% holder cap per member | Built | `MIN_SUBSCRIPTION_UNITS = 250` × 10^decimals. `holderCapBps` (governed, 1,000), counted over `walletsOf(receiver)` with their queued shares (decision 13). See section 8, item 1 |
| Subscriptions pause on a Reserve Shortfall, the Equity Cushion pause or a Suspension; withdrawals never pause | Built | `subscriptionsPaused()` on the controls covers the first two. A Suspension or a pending loss charge also stops subscriptions; `maxDeposit`/`maxMint` report 0. The controls' pauses never touch redemptions |
| Virtual share offset; shares and assets rounded down | Built (offset 0) | OpenZeppelin 4.9's virtual share and asset (`+1`) with `_decimalsOffset` 0. Shares minted and assets paid round down. A non-zero offset would reprice every existing share (section 7, call 1) |
| Share Value; the views | Built | `shareValue()` (WAD per share), `totalAssets()` = Pool Assets, `vaultCash()`, `deployedBalance()`, `accruedInterest()`, `utilization()` (WAD; `utilizationBps()` kept), `fundingRate()`, `fundingRateAt(u)`, `holdbackBps()`, `totalHoldback()`, `holdbackOf(holder)`, `holdbackAt(id)`, `holdbackCount()`, `releasableAt(id)`, `queueRequest(id)`, `queueLength()`, `queueHead()`, `queuedShares()`, `queuedSharesOf()`, `oldestRequestAge()`, `isSuspended()`, `suspension()`, `pendingLossCharge()`, `rateModel()`, `pendingRate()`, `finalMaturity()`, `initialClosing()`. `convertToAssets` uses Share Value; `previewRedeem`, `previewWithdraw`, `maxWithdraw` and `maxRedeem` are net of the holdback |
| `deploy` (two people, the lending account, ≤ 90% FIXED, no queue or Suspension); `returnFunds` by anyone | Built | `deploy(amount, ref)`, `returnFunds(amount)`, `repay(amount)` |
| Pool Interest per second at the Funding Rate (365-day year) | Built | `_accrue` before every change to cash, the Deployed Balance or the rate |
| `postAllowance` / `postLossCharge` (two people, bounded, timestamped); no sweep or rescue | Built | `VALUATION_ROLE` pair. Allowance ≤ Pool Assets; `allowancePostedAt`, `poolLossAllowance`. The only outflows are a Deployment, a fill or redemption to its receiver, a holdback release to its Holder, a refused payment's claim by its payee, a pre-2f claim to its receiver, and a loss charge's excess to the lending account |
| Rate model, bounds (FIXED), 48 h / 30 days / one cut per quarter | Built | `proposeRateModel` (`DEFAULT_ADMIN_ROLE`) and `applyRateModel` (anyone, after notice) |
| Transfers (FIXED); IV-02 §8.4 legend | Transfers built; legend not | Holder-to-holder moves need `transferAllowed(from, to)` from the controls: same Holder, or the Successor path. A plain transfer into the pool reverts. The legend text is not in `specs/` (section 8, item 5) |
| §6A Record, release, maximum age, application, pledged shares | Built | Every redemption path (on demand, `redeemOrQueue`, fill, enforcement, run-off) records {G, H} to the Holder, with H rounded up. H is outside Vault Cash, Pool Assets and utilization. Liquidity is checked against the full G. `releaseHoldbacks` and `applyHoldbacks` are permissionless and batched, and pay only the Holder. Events: `HoldbackRecorded(holder, id, gross, held)`, `HoldbackReleased(id, amount)`, `HoldbackApplied(id, amount, lossChargeId)` |
| §7 On demand only with no open request; `maxRedeem` 0 while open | Built | |
| `redeemOrQueue`; FIFO; escrow keeps earning; fill at Share Value; `fillQueue`; cancellation; incoming cash to the queue first | Built (C4) | `redeemOrQueue`, `requestWithdrawal`, `fillQueue(maxCount)`, `cancelRequest(id, shares)`. With a request open, neither a Deployment nor an on-demand redemption can take cash, so all incoming cash waits for the queue. Fills are not triggered automatically (section 7, call 14) |
| Oldest request's age | Built | `oldestRequestAge()`; the 30- and 90-day rules stay off chain (IV-02 §6.4) |
| Pledged shares redeem only as MB-05 releases them; enforcement joins the queue | Built (entry point) | `enforcementRedeem(holder, shares)` (`ENFORCER_ROLE`): pledged shares only, in queue order, at Share Value at fill, paid only to the recorded `enforcementDestination`, with the holdback recorded to the Holder. `seizeShares` stays until stage 2 (C5) |
| §8 Suspension | Built | `suspend(reason, evidenceHash, resolutionHash)`, `renewSuspension(resolutionHash, orderHash)`, `liftSuspension()` |
| On end: a pending posting and its holdback processing precede the first fill | Built | Fills revert while a posted loss charge is unapplied |
| Final Maturity (decision 15) | Built | `initialClosing` at the first subscription (or supplied at the upgrade). `finalMaturity()` is its 20th anniversary (UTC; 29 February falls to 28 February in a common year). From then subscriptions and Deployments revert, and `requestRunOff(holder)` queues a holder's free shares in queue order |
| §10 Events rebuild the Register, queue, Share Value history and holdback ledger | Built | `Subscribed`, `Deposit`/`Withdraw`, `Deployed`, `Returned`, `InterestAccrued`, `QueueRequested`/`QueueFilled`/`QueueCancelled`, the holdback events, `AllowancePosted`, `LossChargePosted`/`LossChargeCompleted`, `Suspended`/`SuspensionRenewed`/`SuspensionLifted`, `RateModelProposed`/`RateModelApplied`, `InitialClosingRecorded`, `RunOffRequested`, `PaymentDeferred`/`UnpaidClaimed`, `ActionProposed`/`ActionApproved` |
| §10 Upgrades: 7-day timelock, two people, Holder notice; roles by Board resolution | Not here | Governance moves to the Earn timelock (decision 2), which agent B builds. Here upgrades and settings need `DEFAULT_ADMIN_ROLE` |

Decisions:

- **12:** `totalAssets()` and `shareValue()` are what `EarnControls` reads to count pool shares at Share Value in the Funding Limit.
- **21:** the combined Shortfall takes pool shares first. **22:** enforcement is capped at the Defaulted Amount. For both, stage 2's `PoolShareEnforcer` sizes its call with `previewWithdraw` (net of holdback) and then calls `enforcementRedeem`.

## 3. Final function signatures

**LendingPool (and forwarded to `YieldPoolValuation`).** Kept from before:

- the ERC-4626 functions `deposit`, `mint`, `withdraw`, `redeem` and the previews and maxima;
- `requestWithdrawal(uint256,address) returns (uint256)`;
- `claimWithdrawal(uint256) returns (uint256)`, for pre-2f requests;
- `availableCash()`, `borrowableToday(address)`, `borrow(uint256,address)` (reverts), `repay(uint256)`;
- `utilizationBps()`, `totalBorrowed()`, `queuedAssets()`;
- `encumberedOf`, `freeSharesOf`, `syncEncumbrance`, `setEncumbranceSource`, `seizeShares`, `lastKnownLock`;
- `requestAt(uint256)`, for pre-2f requests.

New:

- `subscribe(uint256,address,bytes)`
- `redeemOrQueue(uint256,address) returns (uint256 paidNow, uint256 requestId)`
- `fillQueue(uint256) returns (uint256)`, `cancelRequest(uint256,uint256)`, `requestRunOff(address) returns (uint256)`
- `enforcementRedeem(address,uint256) returns (uint256)`
- `returnFunds(uint256)`, `deploy(uint256,bytes32)`
- `postAllowance(uint256,bytes32)`, `postLossCharge(uint256,bytes32)`, `applyHoldbacks(uint256)`, `releaseHoldbacks(uint256)`
- `suspend(uint8,bytes32,bytes32)`, `renewSuspension(bytes32,bytes32)`, `liftSuspension()`
- `proposeRateModel(uint256,uint256,uint256,uint256)`, `applyRateModel()`
- `initializeYieldPool(address,address,uint64)`, `setEarnControls`, `setDeploymentAccount`, `setEnforcementDestination`, `setHolderCapBps`, `setHoldbackMaxAge`
- `claimUnpaid()`
- the views listed in section 2

Removed:

- `setBorrower`, `borrowDestinationOf`, `dailyBorrowCapOf`: decision 17;
- `absorbLoss`: the two-person posting replaces it;
- `setRateCurve`, `borrowRatePerCycle`, `supplyRatePerCycle` and the per-cycle getters: the governed model replaces them;
- `syncInterest`, `unvestedInterest`, `INTEREST_STREAM_PERIOD`: X-18;
- `requestValue`, `isClaimable`, `requestCount`, `requestsOwnedBy`, `escrowedQueueCaps`: X-7.

**Roles:**

- New: `VALUATION_ROLE`, `DEPLOYER_ROLE`, `SUSPENSION_ROLE`, `CCO_ROLE`, `TREASURER_ROLE`, `ENFORCER_ROLE`.
- Unchanged: `DEFAULT_ADMIN_ROLE`, `OPERATOR_ROLE` (`setEncumbranceSource`), `LIQUIDATOR_ROLE` (until stage 2).
- Retired but kept as constants for the role scripts: `BORROWER_ROLE`, `LOSS_REPORTER_ROLE`.

## 4. Callers affected

No contract calls a removed function, and every signature another contract calls is kept.

- **PayoutPool** (unchanged) calls `availableCash`, `borrowableToday`, `borrow` and `repay`, and makes plain transfers of interest. `borrowableToday` is now 0, so `drawForDueClaim` skips the pool and falls to the bond vault and the treasury. `repay` is a Return. Turning its yield leg off by configuration (`setYieldPool(0)` once `borrowedFromYield` is repaid) is stage 2's, with C1. The PayoutPool tests that exercise that leg now run against `LendingPoolPre2f`, the pool it was written for. A new test shows it takes nothing from the Yield Pool.
- **Liquidator** (unchanged) calls `seizeShares`, `balanceOf`, `previewRedeem`, `maxRedeem`, `redeem`, `requestWithdrawal`, `previewWithdraw` and `collateralKind`. All are kept. Two behaviours change. `maxRedeem` is 0 while any request is open, so a liquidation queues everything. Its queued part is now pushed to it by `fillQueue`, so the old "Liquidator has no call to `claimWithdrawal`" gap is gone.
- **Card settler (off chain)**: `apps/api/src/services/chain/poolFunding.ts` and `cardSettlementService.ts` call `borrow`, which now reverts. See section 9.
- **Apps and scripts that read removed views**:
  - `apps/api/src/services/command/onchain.ts` and its test: `borrowRatePerCycle`, `supplyRatePerCycle`, `baseRatePerCycle`, `slope1PerCycle`, `slope2PerCycle`, `kinkBps`;
  - `apps/api/src/services/chain/earnReader.ts`: `supplyRatePerCycle`;
  - `scripts/grant_pool_borrower.ts`: obsolete;
  - `scripts/upgrade_lending_pool_burn_lock.ts`: superseded; any later upgrade needs `poolProxyOptions()`;
  - the member app's `deposit`, which the controls now gate.
- **Deploy and governance scripts**:
  - `deploy/22`: updated;
  - `deploy/credit_timelock_handover.ts`: still lists LendingPool. Decision 2 moves it to the Earn timelock, which agent B's script handles;
  - `scripts/command/ops-roles.map.json`: still expects `LOSS_REPORTER_ROLE` to be renounced. The constant is kept, so it still resolves.

## 5. Tests

**New.**

- `test/earn/YieldPool.spec.ts`, 55 tests:
  - acceptance tests 11–15 and 20–25 (see below);
  - regressions for C4, the queue filling at Share Value after earning while queued;
  - Suspension, which stops everything but cancellations;
  - Final Maturity, from a 29 February Initial Closing, with run-off in queue order;
  - the deployment-only borrow;
  - subscriptions: the minimum, an ineligible or Clear payer, no controls, the per-member cap, the Initial Closing;
  - transfers: the allowlist, the Successor path and no plain transfer into the pool;
  - a refused payment that does not block the queue;
  - `withdraw` paying exactly the amount asked, with the holdback by formula.
- `test/earn/YieldPoolUpgrade.spec.ts`, 4 tests: storage carry-over from the Base Sepolia source through `upgradeProxy`, the pre-2f claim, the legacy principal's interest and Return, a single initialization, and the module-kind check.

The acceptance tests:

- **11:** the five Funding Rate figures exactly; R₀+S₁+S₂ > 10% and the bounds revert; a raise after 48 hours; a cut before 30 days reverts; a second cut in the same quarter reverts.
- **12:** above 90% utilization, an open request and a Suspension each revert; one signer alone reverts; only the lending account is paid.
- **13:**
  - A then B, with B not filled before A;
  - a 2% loss charge between request and fill, with A filled at the new value;
  - A cancels half;
  - `maxRedeem` is 0 while the queue is open;
  - at 150 bps, A receives G − ⌈1.5% G⌉ and the holdback is recorded to A.
- **14:** the same signer setting and approving reverts; it lifts at 72 hours; same-signer renewal reverts and a different signer's succeeds; beyond 240 hours needs a resolution hash; VALUATION_PENDING cannot be renewed; other reason codes revert; the 30-day ceiling holds; a LEGAL_ORDER with an order hash runs past it; reusing evidence needs a resolution hash.
- **15:** an allowance above Pool Assets reverts; a single-signer posting reverts; a valid posting leaves `shareValue()` unchanged to the wei; a loss charge goes to holdbacks first and sends out only the excess over the Deployed Balance and interest.
- **20, to the cent:**
  - Pool Assets $100,000 at $1.04 and an allowance of $1,500 give 150 bps;
  - redeeming 10,000 shares pays $10,244 and records {G $10,400, H $156}, which is outside Vault Cash, Pool Assets and utilization;
  - posting 50 bps releases $104 (H $52);
  - a $900 charge applies $52 (ratable $93.60), adds $52 to Vault Cash and takes $848 off the Deployed Balance;
  - rounding never favours the leaver.
- **21:** releases are paid only to the Holder; a higher allowance leaves H unchanged; at 0 bps `previewRedeem` = shares × `shareValue()`; `postLossCharge` and a new posting revert while releases are unprocessed; redemptions, fills and subscriptions revert while a charge is pending, and cancellations go on.
- **22:** Share Value rises with interest whatever the allowance; a subscription at 150 bps mints at Share Value.
- **23:** at 150 bps, `previewRedeem(1,000)` = 98.5% of 1,000 × `shareValue()`. An enforcement redemption pays only the recorded destination and records the holdback to the pledgor, whose release goes only to the pledgor.
- **24:** the tag is stored and emitted and changes nothing else; with the Equity Cushion pause set, subscriptions revert and withdrawals succeed. The two-person set and clear is `EarnControls`' (agent B).
- **25:** not releasable before day 540 and releasable by anyone from day 540, to the Holder; a charge posted on day 539 applies to it; raising the maximum age to 720 days on day 500 leaves the release at day 540; a lowering applies at once.

**Existing tests changed**, each with the reason in a comment beside it:

- `test/peripherals/LendingPool.spec.ts`: the same questions, answered for the Yield Pool:
  - borrowing becomes Deployments (decision 17);
  - the per-cycle curve becomes the governed model;
  - X-7's capped claim becomes C4's fill at Share Value;
  - `absorbLoss` becomes the two-person loss charge, and the charge's excess goes to Clear Lending rather than being reported as uncovered.
- `test/core/FirstLossOrdering.spec.ts`: two-person charges replace `absorbLoss`, and a charge above Pool Assets is refused rather than split. Deployments are capped at 90%.
- `test/peripherals/AssetBackedDefault.spec.ts`: Deployments replace borrowing. The queued liquidation is paid by `returnFunds` and `fillQueue`.
- `test/audit/deep/PeripheralRegressions.spec.ts`:
  - H-4 is superseded by decision 17;
  - X-7 is replaced by C4;
  - X-18 is superseded by per-second interest;
  - M-3 now links its two holders as one Holder's accounts, so the allowlist allows the move it tests.
- `test/audit/compliance/Section12Liquidator.spec.ts`: a $100 holding is a $250 subscription less a $150 redemption, because of the FIXED minimum; the hold test's transfer is to the member's own linked account.
- `PledgedBonds.spec.ts`, `Assurance.spec.ts`: the pool is deployed with its module and controls (`deployBarePool`).
- `test/audit/compliance/PayoutDeadline.spec.ts`: the claim is funded by the treasury, and the test shows the PayoutPool takes nothing from the Yield Pool.
- `test/core/PayoutLifecycle.spec.ts`: the yield-leg tests use `LendingPoolPre2f`, and one new test covers the Yield Pool.

**Run:** the 13 spec files that touch LendingPool (the two new ones, the ten above, and RevolvingIssuer and RepaymentRouting, which mention it): **279 passing, 0 failing**. The full suite was not run locally; CI runs it.

## 6. Checks

- **Sizes** (`npx hardhat compile --force`, production): LendingPool 22,924 runtime / 23,378 creation; YieldPoolValuation 22,844 / 22,981. Both are within EIP-170 (24,576) and EIP-3860 (49,152).
- **Storage:** OpenZeppelin `getStorageUpgradeReport` reports both Base Sepolia LendingPool implementations compatible, and `upgradeProxy` validates in the rehearsal.
- **Slither** 0.11.6, Medium and High, per contract (via-IR, runs 1). The baseline is `dev`'s LendingPool, which is `LendingPoolPre2f`: 3 `incorrect-equality`. The whole-project hardhat mode fails on this repo because the import preprocessor makes the cached sources differ from disk. The new entries, none a defect:
  - `uninitialized-state` (High): the module-split false positive Phases 1–4b triaged. The variables are written in the other half, the module or the pool. In the module's run, `requestSharesOf` and `escrowedQueueCaps` are retired fields, never written and zero on Base Sepolia.
  - `weak-prng` (High): the `%` in the calendar arithmetic of `finalMaturity`. There is no randomness.
  - `divide-before-multiply` (Medium): `PacificCalendar`'s integer date algorithms, as before.
  - `incorrect-equality` (Medium): intended zero, empty and equality checks.
  - `reentrancy-no-eth` (Medium):
    - `_subscribe` calls the governed controls before booking. A reentrant call can only subscribe again under the same checks.
    - In `releaseHoldbacks`, each H is reduced before its payment, so a reentrant call finds nothing more to release. The reserve token is USDC.
  - `uninitialized-local`, `unused-return` (the day field of a date) and `write-after-write` on `escrowMode` in the module: intended.
- **Generated files:** `node scripts/command/code-fingerprints.mjs` regenerated `code.json` (34 contracts), and `--check` passes. `node scripts/docs/contract-reference.mjs` regenerated `LendingPool.md`, and `--check` passes. `node scripts/check-doc-links.mjs` finds no broken links.
- **`npx turbo run typecheck test --affected`** (Node 22, bun installed, `TURBO_SCM_BASE=origin/dev`): 3 of 3 tasks passed.

## 7. Judgement calls

1. **No decimals offset.** `_decimalsOffset()` stays 0. OpenZeppelin's virtual share and asset still apply. A non-zero offset would change what every existing share is worth, and the $250 minimum further blunts a donation attack.
2. **`shareValue()` is WAD** (1e18 = $1.00 per share). It is also the 6-decimal USDC per 6-decimal share.
3. **Utilization** is (Pool Assets − Vault Cash) ÷ Pool Assets, that is, the Deployed Balance plus accrued interest, over Pool Assets.
4. **Pool Interest is simple** on the Deployed Balance. IV-02 §4.6's capitalization schedule is not in `specs/`. Returns pay interest first.
5. **Legacy principal.** `totalBorrowed` (the PayoutPool's and card settler's pre-2f loans) becomes the opening Deployed Balance, owed by Clear Lending, with Pool Interest from the upgrade. Clear Lending, the PayoutPool's sponsor, owes the pool for those loans.
6. **Pre-2f queued requests** stay fixed claims outside Pool Assets, paid by `claimWithdrawal`. X-7's escrowed requests never reached a deployed chain (Base Sepolia predates them), so they have no path.
7. **Recoveries** (glossary: "plus recoveries restored under Section 5.4") arrive as cash through `returnFunds`, and any excess stays in Vault Cash. There is no two-person entry that would restore a receivable to the Deployed Balance, since that would let two signers raise Share Value without USDC. "Valuation Event" is not defined in the quoted text. Each posting is timestamped and evented.
8. **Untracked transfers.** X-18's streaming is gone: interest is a receivable before it is paid, so a Return moves no price. A stray USDC transfer still raises Share Value at once, as Vault Cash is USDC held. The PayoutPool's plain-transfer interest stops when its yield leg is switched off.
9. **Two-person actions** use the AssurancePool pattern: the same call by two different holders of the role, on chain.
10. **Suspension:**
    - "the one who set it" is the proposer;
    - a renewal past 30 days is cut to the ceiling;
    - reusing evidence is judged from the last suspension's end;
    - any authorized individual may lift it early;
    - joining the queue (not filling) is allowed during a Suspension, so a holder keeps their place.
11. **Calendar.** The rate-cut quarter is a UTC calendar quarter, judged by the cut's effective date and reserved at proposal. The Final Maturity anniversary is UTC.
12. **Run-off** queues free shares only. Pledged shares run off through MB-05 enforcement or after release.
13. **Exact `withdraw`.** It pays exactly the amount asked; the holdback is by formula; a unit of rounding stays in the pool.
14. **No automatic fill.** Fills are pushed by `fillQueue`, which anyone may call, not run inside every subscription or Return. A refused payment (a blocked USDC address) is kept in `unpaidOf` for `claimUnpaid` instead of reverting, so one receiver cannot stall the FIFO queue or a holdback batch.
15. **While a loss charge is pending,** a new allowance posting also waits. A charge is bounded by Pool Assets plus open holdbacks.
16. **Lowering the maximum age** is kept as a rising stack of age caps, so it reaches existing holdbacks and a later raise never undoes it, with no unbounded loop.
17. **The holder cap** counts queued shares and is checked at subscription only. Holders over 10% on testnet are not touched.
18. **Enforcement:**
    - `enforcementDestination` is recorded on the pool by governance, not passed by the enforcer;
    - pledged shares already queued count against the lock, so the holder's other shares stay free;
    - the Holder cannot cancel an enforcement request, and the enforcer can.
19. **ERC-4626 `receiver`** on an on-demand redemption is the owner's choice, as the standard has it. Fills pay the receiver recorded at request.
20. **Module transfers.** Share movements made in the module run without the pool's transfer hook. The module moves shares only where the hook would pass them: out of escrow, enforcement escrow, the Liquidator's seizure, and run-off of free shares (`LendingPoolBase` header).

## 8. For the owner: ambiguities, with recommendations

1. **Holder-cap bootstrap.** "Holder cap 10% of shares" measured against outstanding shares refuses the first subscriber, who holds 100%. Built as written, with `holderCapBps` governed. **Recommendation:** count the cap only once outstanding Pool Shares pass a governed floor (for example the first $1,000,000), or against the offering size, in `EarnControls`. Until then, governance can set `holderCapBps` to 10,000 for the Initial Closing.
2. **Recoveries under IV-02 §5.4** and **capitalization under §4.6:** the text is not in `specs/`. Built as section 7, calls 4 and 7.
3. **"Valuation Event"** (Exhibit A) is not defined in the quoted text. Nothing branches on it.
4. **Authorized individuals.** The spec names the CCO and treasurer only for Suspension. Valuation and Deployment use new `VALUATION_ROLE` and `DEPLOYER_ROLE` holders. Grants by Lending Board resolution (§10) sit with the Earn timelock work.
5. **IV-02 §8.4 legend:** the text is not in `specs/`, and an ERC-20 has no metadata URI. **Recommendation:** a `legend()` string set once at the upgrade, when the text is supplied.
6. **Who sends `fillQueue`.** Fills are permissionless and push to the receiver. **Recommendation:** the API sends `fillQueue` after every Return and subscription (section 9).

## 9. App and API follow-ups

- **Decision 17 (#887, #890):** the card and auto-clear funding paths must stop drawing from the pool directly. `apps/api/src/services/chain/poolFunding.ts`'s `borrow` reverts with `LendingPoolDirectBorrowOff`. Clear Lending funds card settlement from what it receives as Deployments. Its treasury's Returns go through `returnFunds`.
- **Subscriptions:** call `subscribe(assets, receiver, attestation)` with the eligibility attestation that `EarnControls` defines. Show the $250 minimum, the 10% member cap and the pause states (`maxDeposit` is 0 while paused).
- **Withdrawals:** "Take $X now, queue the rest" is `redeemOrQueue`. Show:
  - the queue position (`queueRequest`, `queueHead`, `queuedSharesOf`) and `oldestRequestAge` for the 30- and 90-day rules;
  - cancellation (`cancelRequest`);
  - anything owed by a refused payment (`unpaidOf`, `claimUnpaid`).

  Send `fillQueue` after Returns and subscriptions. Replace the member app's `requestWithdrawal` text ("burns the shares now"): shares are now escrowed and priced at fill.
- **Holdback:** show `holdbackBps`, `previewRedeem` net of holdback, and the Holder's holdbacks (`holdbackOf`, `holdbackAt`, `releasableAt`). Send `releaseHoldbacks` and `applyHoldbacks` (permissionless) after postings.
- **Share Value:** `shareValue()` replaces `navPerShare`. `fundingRate()` and `utilization()` replace `borrowRatePerCycle`, `supplyRatePerCycle` and the per-cycle getters in `apps/api/src/services/command/onchain.ts` and `earnReader.ts`. Show `deployedBalance()`, `accruedInterest()` and `vaultCash()`.
- **Suspension and Final Maturity:** show `isSuspended()`, `suspension()` and `finalMaturity()`. After Final Maturity, send `requestRunOff` per holder.
- **Indexing:** the events listed in section 2 (§10).
- **Operators:**
  - `CLEAR_LENDING_ACCOUNT` for `setDeploymentAccount`;
  - grant `DEPLOYER_ROLE`, `VALUATION_ROLE`, `SUSPENSION_ROLE`, `CCO_ROLE` and `TREASURER_ROLE`;
  - revoke `BORROWER_ROLE`;
  - the upgrade call in section 1, through the Earn timelock.

## 10. For stage 2

- `PoolShareEnforcer`: grant it `ENFORCER_ROLE` and set it as `enforcementDestination`. Size calls with `previewWithdraw` (net of holdback), then call `enforcementRedeem`. Remove `seizeShares` and the Liquidator's `LIQUIDATOR_ROLE` exemption in the transfer hook (C5).
- `EarnControls` implements `IPoolEarnControls`:
  - `checkSubscription` (eligibility, `exemptionCode`, refused Clear payers, the Funding Limit with pool shares at `shareValue()`);
  - `subscriptionsPaused` (the Equity Cushion pause and the Reserve Shortfall);
  - `walletsOf` (`MembershipRegistry`);
  - `transferAllowed` (same Holder, the Successor path).
- PayoutPool: once `borrowedFromYield` is 0, `setYieldPool(0)` (C1, decision 17).
- The Earn timelock takes `DEFAULT_ADMIN_ROLE`, and `deploy/credit_timelock_handover.ts` drops LendingPool.
- CollateralRegistry values `POOL_SHARE` by `previewRedeem(shares)` (plan row 58).
