# Phase 2f, stage 3: integration

Branch `audit/phase-2f-integration`. No PR was opened. Nothing was deployed, no key was used, no live network was touched, and no admin power was widened. EarnControls, the bond contracts, BondVault, CollateralAgent, ESADepositVault and ClaimEscrow are unchanged.

## Part one: the Yield Pool (decisions 33–35) and the line closing (decision 37)

Requirements: [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md) decisions 1–37; [`specs/IV-02-yield-pool-subscription-and-pool-share-terms.md`](./specs/IV-02-yield-pool-subscription-and-pool-share-terms.md) as corrected (§5.6(d), A2, A6); [`specs/earn-contract-requirements.md`](./specs/earn-contract-requirements.md) as corrected (section 6A, tests 15 and 20); [`specs/MB-05-security-and-pledge-agreement.md`](./specs/MB-05-security-and-pledge-agreement.md). Earlier reports: [`PHASE-2F-ENFORCEMENT.md`](./PHASE-2F-ENFORCEMENT.md), [`PHASE-2F-POOL-CONFORMANCE.md`](./PHASE-2F-POOL-CONFORMANCE.md), [`PHASE-2F-YIELD-POOL.md`](./PHASE-2F-YIELD-POOL.md).

### Commits

| Commit | What |
|---|---|
| `2c2c7b8d` | Merge `audit/phase-2f-pool-conformance` (b916b988) into the enforcement work (be1ea371) |
| `3cd17aa3` | Merge `audit/phase-2f-earn-pool` (4bb79d5b): decisions 33–44, the corrected IV-02, IV-01, IV-03 |
| `ecfea5f5` | Decision 33: the full Pool Loss Charge reduces the Deployed Balance |
| `680a66d8` | Decision 34: IV-02 §7.5 legal holds |
| `ef528fdd` | Decision 35: IV-02 §8.3 Successor redemption |
| `3a4e1378` | Decision 37: a recorded credit line closing |

### 1. How the merges were resolved

**`LendingPoolBase.sol`.** Both sides are kept:

- the enforcement side: `seizeShares`, the Liquidator's transfer exemption and `SharesSeized` stay removed, and `enforcementFilledOf` stays;
- the conformance side: the `YieldPoolLedger` module, the utilization fix (`_utilizationOf`), `lowUtilizationSince`, the full-precision Holdback Percentage and the rest of its fields.

`setEncumbranceSource` stays on `DEFAULT_ADMIN_ROLE` (the conformance side moved it off `OPERATOR_ROLE`). That narrows a power.

**Storage layout.** Both sides had taken slots from the 50-slot `__yieldPoolGap` (406–455), so they are laid out once:

| Slots | Fields | From |
|---|---|---|
| 406–416 | `_holdbackRate` … `_totalCapitalized` (11 slots) | conformance |
| 417 | `_enforcementFilled` | enforcement |
| 418–419 | `_legalHolds`, `_openHoldsOf` | this stage (decision 34) |
| 420–455 | `__yieldPoolGap[36]` | |

The conformance report counted "twelve slots" with a 38-slot gap. Its fields take 11, so its region ended at 454. The merge restores the end at 455, where the original gap ended. Nothing follows the gap, so either is append-safe.

OpenZeppelin's `getStorageUpgradeReport` (`scripts/storage_report_lending_pool.ts`) finds the layout compatible with both Base Sepolia LendingPool implementations (0x24C4…2663 and 0xcB71…C034), after every storage change. `test/earn/YieldPoolUpgrade.spec.ts` (the `upgradeProxy` rehearsal from the Base Sepolia source) passes.

**`docs/protocol/settlement.md`.** The access table drops `seizeShares`. It lists `setEncumbranceSource` and `setLegend` with the other Earn-timelock settings, and drops `setHolderCapBps`.

**`code.json`.** Regenerated with `node scripts/command/code-fingerprints.mjs` after each change. `--check` passes.

**The spec merge.** `phase-2f-plan-decisions.md` and IV-02 are taken from the spec branch, which supersedes the conformance branch's copies.

### 2. Status by item

**Decision 33: the full charge reduces the Deployed Balance.** Built. `YieldPoolValuation._completeCharge` now runs the whole charge L against the Deployed Balance, then accrued interest, and pays out only the part above both. Before, it ran L − Σ absorbed.

- Each open holdback still absorbs min(H, G × L ÷ (Pool Assets + Σ G)), rounded up, into Vault Cash.
- Pool Assets fall by L − Σ absorbed.
- Acceptance test 20 is now: $52 applied, Vault Cash +$52, Deployed Balance −$900, Pool Assets $89,600 → $88,752.
- The payout can never exceed the vault's free cash. A charge is at most Pool Assets + Σ H. At that bound the ratable shares absorb at least the part of L above Pool Assets: Σ min(Hᵢ, Gᵢ·L/(PA+ΣG)) − (L − PA) is concave in L and is ≥ 0 at both L = PA and L = PA + ΣH. A test posts the largest allowed charge and sees exactly the vault's cash leave.
- **`postRecovery`'s cap** (decisions 25 and 36) is unchanged: `unrestoredCharges` counts each charge in full, including the part a holdback bore. Under the new booking that is exactly what the charge took off the Deployed Balance and interest, or paid out. So a full recovery restores the Deployed Balance the charge reduced, and the remaining Holders gain the holdback-borne part, as decision 36 keeps.

**Decision 34: §7.5 legal holds.** Built, in `YieldPoolLedger` (reached through the pool's fallback).

- `placeLegalHold(holder, shares, orderHash, expiresAt)` and `releaseLegalHold(id)`.
- Views: `heldSharesOf`, `legalHold(id)`, `legalHoldsOf`, `legalHoldCount`.
- Events: `LegalHoldPlaced`, `LegalHoldReleased`.
- **Role.** The Suspension's existing two-person rule: two different authorized individuals among `SUSPENSION_ROLE`, `CCO_ROLE` and `TREASURER_ROLE`, at least one of them the CCO or treasurer. It is the narrowest existing two-person set that already acts on legal orders (the LEGAL_ORDER Suspension, §7.1(b)). No new role. The pairing code is now shared with `suspend` (`_pairOfficers`).
- **Scope.** A hold needs the order's hash and covers only the named number of one holder's shares. It ends on a two-signer release or when `expiresAt` passes (0 means the order states no expiry).
- **While held**, the shares cannot be:
  - redeemed, queued or transferred: `_freeSharesOf` and the pool's transfer hook leave them out, so `maxRedeem`, `freeSharesOf`, `requestRunOff` and `successorRedeem` exclude them;
  - pledged: `CollateralRegistry.pledge` refuses a pledge that does not fit in balance − held;
  - taken by an MB-05 enforcement: `enforcementRedeem` is capped at balance − held.
- The holder's other shares are unaffected.
- The hold moves, burns and pays nothing (§8.5).

**Decision 35: §8.3 Successor redemption.** Built, in `YieldPoolLedger`. `successorRedeem(holder, shares)` reads EarnControls' `payeeOf(holder)`: the payment Successor that two `SUCCESSOR_ROLE` signers registered, in effect after 7 days, which the Holder's own account can cancel. EarnControls is not changed.

- Only that Successor may call it, and only for free shares (not pledged, held or queued).
- The shares join the ordinary queue as the Holder's request (`owner` = Holder, `receiver` = Successor), fill in FIFO order at Share Value, and pay only the Successor.
- In `fillQueue`, a non-enforcement request now records its holdback to `receiver`. That is the Successor on this path and the Holder everywhere else (§6.5 makes them equal), so later releases also go to the Successor (6A, "or the Successor path").
- The Holder can still `cancelRequest`.

**Decision 37: a credit line's closing.** Built.

- **RevolvingIssuer.** In `RevolvingIssuerWorkouts`, reached through the fallback, because RevolvingIssuer has 141 bytes free:
  - `proposeLineClosing` and `approveLineClosing` by two different `CREDIT_ATTESTER_ROLE` holders, as for the cure-notice record;
  - `lineClosedAt`;
  - events `LineClosingProposed` and `LineClosed`.
  - The record can be made only while the Objective Default stands (`inDefault` or `hasDefaultedOnCurrentLine`, the Liquidator's own gate) and no pause is in force. It is made once per line and counts only for the line open when recorded.
  - Storage: one mapping appended to the Phase 2g ERC-7201 struct.
- **LiquidatorBase._revolvingDue.** With the record, while the default stands, both parts are unbounded, and each caller caps them:
  - `liquidate` takes the whole savings tier, capped by the CLRUSD held and the registry's lock, so never more than the Savings-Backed Position (MB-04 §9.4; MB-05 §7.2);
  - Earn enforcement reaches the whole asset-backed and unsecured balance, and never Savings.
- Without the record nothing changes. Every pause and hold check is kept.
- A workout plan's default records no line default, so it cannot be closed on it (2g decision 35 kept; tested).

**App and API follow-ups and the Base Sepolia steps.** Documented in sections 6 and 7. No app or API source reads these contract features yet, so no app code changed.

### 3. Checks

**Production sizes** (`npx hardhat compile --force`, revert strings stripped, via-IR, runs 1):

| Contract | Runtime (free of 24,576) | Creation |
|---|---|---|
| LendingPool | 23,164 (1,412) | 23,812 |
| YieldPoolValuation | 20,638 (3,938) | 21,092 |
| YieldPoolLedger | 23,037 (1,539) | 23,174 |
| CollateralRegistry | 18,391 (6,185) | 18,528 |
| RevolvingIssuer | 24,435 (141), unchanged | 25,646 |
| RevolvingIssuerWorkouts | 21,841 (2,735) | 21,978 |
| Liquidator | 14,391 (10,185) | 32,025 |
| LiquidatorEnforcement | 17,250 (7,326) | 17,387 |

**Storage (OpenZeppelin report against `.openzeppelin/base-sepolia.json`):**

- LendingPool: both implementations compatible.
- Liquidator: both compatible.
- CollateralRegistry: both compatible.
- RevolvingIssuer: 5 of 6 compatible. The sixth (0x0D0A…8784) flags slot 91 (`cycleLength` → `isCardSettler`). That predates this branch: `scripts/upgrade_revolving_issuer.ts` documents the deletion as intentional and upgrades with `unsafeSkipStorageCheck`. This stage only appends to the ERC-7201 struct.

**Slither** 0.11.6, Medium and High, per contract (solc 0.8.29, via-IR, runs 1). It was run on LendingPool, YieldPoolValuation, YieldPoolLedger, CollateralRegistry, RevolvingIssuerWorkouts, Liquidator and LiquidatorEnforcement. No new class of finding. The new code appears only in the known false positives:

- `uninitialized-state`: the module split;
- `uninitialized-local`: `_checkLegalHold.held`, set in a `try`;
- `reentrancy-no-eth`: the pinned ledger delegatecall.

**Generated files.**

- `code-fingerprints.mjs --check`: current (34 contracts).
- `contract-reference.mjs --check`: current (36).
- `check-doc-links.mjs`: no broken links.
- `TURBO_SCM_BASE=origin/dev npx turbo run typecheck test --affected`: 3 of 3 tasks pass, before each push.

**Specs run locally.** The full suite runs in CI.

- Decision 33: YieldPool, YieldPoolConformance, Enforcement, FirstLossOrdering, PeripheralRegressions, YieldPoolUpgrade and LendingPool.
- Decision 34: YieldPoolStage3, Enforcement, YieldPool, YieldPoolConformance, YieldPoolUpgrade, CollateralRegistry and LendingPool. 141 passing.
- Decision 35: YieldPoolStage3, YieldPool, YieldPoolConformance, YieldPoolUpgrade, EarnControls and Enforcement. 137 passing.
- Decision 37: Section12Liquidator, Addendum4Credit, PledgedBonds, Section12Revolving, Addendum2, Section2d, AssetBackedDefault, Liquidator, RevolvingIssuer, CollateralRegistry, Enforcement and Decisions. 240 passing and 1 failing; the failure was fixed and its spec re-run (see below).

The one failure was pre-existing on the enforcement branch: acceptance 21 scans every contract for "accelerat", and a `LiquidatorEnforcement` comment said "never accelerates". The comment is reworded; Section12Revolving passes.

### 4. Judgement calls for the owner

1. **Legal-hold role (decision 34).** The Suspension's signer set, with one CCO or treasurer, rather than a new role. `VALUATION_ROLE` and `DEPLOYER_ROLE` cannot place a hold (tested).
2. **A hold reaches only shares in the Holder's account,** not shares already escrowed in the queue. Blocking a queued request would mean skipping it in the FIFO fill. This is the narrower reading. A Holder cannot queue held shares, but shares queued before the order still fill.
3. **Holds and pledges are additive.** Shares are fungible, so the Holder's own exits see balance − pledge lock − held. Enforcement is capped at balance − held, and a new pledge must fit in balance − held. Where an order names pledged shares, the hold wins until it ends: enforcement waits, as §7.5 and a court order require.
4. **A hold blocks shares, not payments.** Holdback releases, unpaid-payment claims and fills of earlier requests still pay. §7.5 also mentions blocking "a payment"; decision 34 covers shares only.
5. **At most 8 open holds per Holder.** Expired ones are pruned when the next is placed. This keeps the transfer hook's loop bounded.
6. **The Successor alone may start a Successor redemption (decision 35).** It needs no Clear key, so Clear Lending's §8.5 power stays the two-person registration. The Successor names the amount.
7. **Cancelling the payment registration does not cancel a request already queued.** The Holder cancels that with `cancelRequest` from the same account. Re-checking the registration at each fill would need an EarnControls call inside `fillQueue`, and LendingPool has about 1.4 KB free.
8. **A Successor-path holdback belongs to the Successor:** it is recorded to and released to the Successor. The Holder's account is presumed inaccessible.
9. **"While the Objective Default stands" (decision 37)** is read as the Liquidator's gate: computed `inDefault` or `hasDefaultedOnCurrentLine`, with no pause in force.
   - The record is permanent for the line. It widens the Defaulted Amount only while a default stands, so if the default ends, nothing is enforceable through it.
   - The workout plan's 0% position is never reached.
10. **Decision 37's counsel note.** The closing takes effect at once: it adds no notice period of its own beyond the Default Notice and cure already behind the Objective Default. If MB-05 §6.3 needs a fresh notice for the demand, a delay can be added in `_revolvingDue`.
11. **The `RevolvingIssuerWorkouts.v1` kind string is kept,** because RevolvingIssuer checks it in its constructor and has 141 bytes free. The new implementation must be deployed with the new module address, as `issuerProxyOptions` does.
12. **Room.**
    - LendingPool has 1,412 bytes free and YieldPoolLedger 1,539. The next pool item should start a third module or move views out of the ledger.
    - RevolvingIssuerTerms has 180 bytes free and RevolvingIssuer 141.
13. **A pledge that ignores holds elsewhere.** The registry's check runs only in `pledge` (amount kinds with a valuer: the pool). Item pledges (bonds) are not affected, since a hold is a pool-share concept.

### 5. Tests changed

- **`test/earn/YieldPool.spec.ts`:**
  - test 15's holdback case now expects the full charge against the Deployed Balance and interest;
  - test 20 asserts the $900 reduction and Pool Assets of $88,752;
  - two new tests: a charge within the Deployed Balance with a holdback open, and the largest allowed charge.
- **`test/earn/YieldPoolConformance.spec.ts`:** the Exhibit A, A10 test now expects `toDeployed` $900 and Pool Assets down $848.
- **`test/earn/YieldPoolStage3.spec.ts` (new, 11 tests):**
  - decision 34 (7): signers and the order hash; only the named shares; the account limit; expiry; release; enforcement and run-off; the 8-hold cap;
  - decision 35 (4): only the registered Successor after 7 days, never a Clear key; the ordinary queue in order, paying $10,244 with $156 held for and released to the Successor; the Holder's cancellations; free shares only.
- **`test/earn/Enforcement.spec.ts`:** a pledge must fit around a legal hold, through the real CollateralRegistry.
- **`test/audit/compliance/Section12Liquidator.spec.ts`:** three decision 37 tests:
  - MB-05 example 1 (Dana): $250.00 redeemed, $2,750.00 left;
  - the Savings-Backed Position cap, and the default gate;
  - Earn reaching the whole asset-backed and unsecured balance, never Savings.
- **`test/audit/compliance/Addendum4Credit.spec.ts`:**
  - the real issuer's two-person record: only in default, held by a pause, once per line;
  - test 57 asserts a workout plan default cannot be closed on.
- **`contracts/mocks/MockMissedCycleIssuer.sol`:** `lineClosedAt` and `setLineClosed`.

### 6. App and API follow-ups

- **Loss-charge indexing (decision 33).** `LossChargeCompleted.toDeployed` and `paidOut` are now taken from the full charge. An indexer that rebuilds Pool Assets must subtract `value − absorbed`, not `value − 2 × absorbed`.
- **Legal holds (ops console, CCO or treasurer plus one more signer).**
  - Calls: `placeLegalHold` with the order's hash and stated expiry, and `releaseLegalHold`.
  - Index `LegalHoldPlaced` and `LegalHoldReleased`.
  - The Earn page shows `heldSharesOf` and uses `maxRedeem` or `freeSharesOf`, which already leave held shares out.
  - The pledge flow must check `heldSharesOf` before asking for a pool-share pledge signature: the registry reverts `CollateralRegistryEncumbered`.
- **Successor redemption.**
  - Once `EarnControls.paymentSuccessorOf(holder).effectiveAt` has passed, the Successor's app calls `successorRedeem(holder, shares)` from the Successor's own account.
  - Show the queue position, and index `SuccessorRedemptionRequested`.
  - The Holder's app shows any pending payment-Successor registration and offers `cancelPaymentSuccessor` and `cancelRequest`.
  - Grant `SUCCESSOR_ROLE` to two individuals on EarnControls.
- **Line closing (credit ops console, two attesters).**
  - Calls: `proposeLineClosing` and `approveLineClosing`; read `lineClosedAt`; index `LineClosed`.
  - After a closing, the keeper calls `Liquidator.liquidate` for the savings tier and `PoolShareEnforcer.enforce` and `payPledged` for Earn, as for any default.
  - The member's notices and statements should say the line is closed and the full balance demanded.
- **ABIs.**
  - The pool's new functions are in `YieldPoolLedger`'s ABI, joined by `poolAbi()` and `poolAt()` (`deploy/poolModules.ts`).
  - The closing functions are in `RevolvingIssuerWorkouts`' ABI, at the issuer's address.
- **Held app PRs (#887, #890):** unchanged from earlier reports. They must stop drawing from the pool directly (decision 17).

### 7. Base Sepolia upgrade steps (for the owner to run; nothing was run here)

1. **Yield Pool.**
   - Deploy `YieldPoolLedger`, then `YieldPoolValuation(ledger)`, then the LendingPool implementation (`poolProxyOptions()`).
   - Upgrade through the Earn timelock with `upgradeToAndCall(impl, initializeYieldPool(...))` if the 2f upgrade has not yet run; otherwise use a plain `upgradeTo`.
   - Then call `setLegend` and the two-person `postPoolTierPrincipal`, as the conformance report lists.
   - No new role: holds use the existing `SUSPENSION_ROLE`, `CCO_ROLE` and `TREASURER_ROLE` holders.
2. **CollateralRegistry.** A new implementation (no storage change) through its admin.
3. **RevolvingIssuer.**
   - Deploy the new `RevolvingIssuerWorkouts`, and a RevolvingIssuer implementation with the four module addresses (`deploy/issuerModules.ts`, `issuerProxyOptions`).
   - Upgrade through the credit timelock. No initializer: the closing record lives in the existing ERC-7201 namespace.
   - Use the same storage-check options as `scripts/upgrade_revolving_issuer.ts`, because of the old slot-91 deletion.
4. **Liquidator.** A new implementation and Earn module through its admin (no storage change).
5. **EarnControls.** No upgrade. Grant `SUCCESSOR_ROLE` ×2 with a resolution hash (`grantRoleByResolution`) before the first Successor registration.
