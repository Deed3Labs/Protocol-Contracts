# Phase 2c report: section 13 (Assurance Contracts)

Branch `audit/phase-2c-assurance`. It was cut from `audit/phase-2b-credit-agreements` (#888); #888 has since merged into `dev`, and `dev` is merged into this branch, so the PR is based on `dev` with Phase 2b in it. Spec: `specs/assurance-contracts.md` (verbatim). Binding decisions: the end of `PHASE-2B-PROGRESS.md`. Progress log: `PHASE-2C-PROGRESS.md`.

Nothing was deployed, no key was used, and no live network was touched.

## 1. What changed

### The AssurancePool, rebuilt (decision 1)

`contracts/peripherals/AssurancePool.sol` is a **new contract with a new layout**, not an upgrade of the Phase 1 pool. The old pool exists only on Base Sepolia; it is retired with AssuranceOracle, not migrated.

| Spec | How |
|---|---|
| 13a two-person control | Every action takes two distinct signers, and nothing lets one address do both. Three shapes: (1) the same call from two signers (floor inputs, grants, pause, renewal, early unpause), via `_pair`; (2) one signer proposes, another completes (`approveDraw` → `releaseDraw`, `proposeTransfer` → `executeTransfer`); (3) parameters and upgrades: two signers approve the exact calldata hash (`approveAction`), then **governance** (the Assurance timelock) makes the call. A proposer who stops being a signer no longer counts. |
| 13a roles | Lending Co.'s Registered Draw Address may only `requestDraw`. A signer can never be the draw address, the loss-reserve address, an allowlisted payer, the timelock or a money-path contract, and vice versa. Clear Capital Management and Clear Capital Holdings hold nothing. |
| 13b compartments | One contract, a per-compartment ledger (`compartmentOf`), no shared spendable balance. `CREDIT_BACKSTOP` and `MEMBER_ASSURANCE` at init, 50/50; `addCompartment` (governed) at 0%; the two fixed ones cannot be removed; others only when empty and unallocated. At most 8 (a gas bound). USDC only. No approve, lend, stake or pledge anywhere in the code. |
| 13c inflows | `deposit(SourceTag, amount)` is the only way in. Payers are allowlisted per tag (bit mask, governed). It reverts for any caller `NetworkRegistry.isMoneyPath` reports (every registered issuer, plus the listed money-path contracts), and governance cannot allowlist one. `RECOVERY` → 100% Credit Backstop. Anything else fills the Credit Backstop to its floor first (its own `CompartmentCredited` event), then splits by allocation; rounding dust stays in the backstop. `setAllocation` refuses to lower the Credit Backstop share within the program year it was last set in. |
| 13d floor | `backstopFloor() = max(timingBufferShortfall, floorBps × coveredBookPrincipal / 10,000)`, `floorBps` 500. `coveredBookPrincipal = max(Σ exposure sources' poolExposure(), attestedCoveredBook)`; the source is the CollateralRegistry. A source that cannot answer counts as zero rather than blocking deposits (the attested figure is the backstop). Floor inputs and `coverageCap` are set monthly by two signers with an evidence hash (`FloorInputsSet`). `backstopBalance`, `availableCoverage` as specified. |
| 13e draws | One request per period. `approveDraw` (signer A) may approve less (the disputed remainder stays) or zero (closes it), and never above `availableCoverage()`. `releaseDraw` (signer B ≠ A) pays only `lossReserveAddress`, only from the backstop, in request order (closed and released requests are stepped over), and re-checks coverage with this draw excluded from the approved-unpaid figure. |
| 13e grants | `releaseAssurance(grantId, amount, evidenceHash)`: two signers, Member Assurance only, the disbursement address only, once per `grantId`. Reverts when short, on the proposal as well as the payment. |
| 13f transfers | `proposeTransfer` / `executeTransfer` by a different signer after `transferDelay` (governed, never under 14 days); into the backstop with no delay. Out of the backstop only if `backstopBalance() − amount ≥ backstopFloor() + pendingDrawRequests`. |
| 13g | No sweep, rescue, withdraw or admin transfer (a test lists every state-changing function). The pause blocks only `releaseDraw`, `releaseAssurance` and `executeTransfer`, takes two signers, lasts 72 hours, and two signers renew it. Upgrades: governance plus two signers, and `_authorizeUpgrade` re-checks the timelock's delay is at least 7 days. All nine required events; `grantId` and evidence are hashes, so no member data. |

### Rewiring (decisions 2, 3, 4, 7)

| Contract | Change |
|---|---|
| `StableCredit` / `ClearCredit` | Its own `reserveToken` (set once, admin) and `convertStableCreditToReserveToken`. A repayment past the payout pool goes to `lenderOperating`, Lending Co.'s operating address (decision 2; same admin power that used to name the pool). `burnLostDebt` reverts `StableCreditLostDebtNotRedeemable` (decision 3; `reimburse` is gone). `setAssurancePool` and `assurancePool()` removed; the slot is kept, renamed. |
| `RevolvingIssuerExtension.settleFromCollateral`, `RevolvingIssuerCycles.repayForMember`, `OffersIssuer`, `CreditPool` | Read the ledger's reserve token and conversion. |
| `TermIssuerExtension.repayWrittenOff` | Pays Lending Co.'s operating address (its charge-off), instead of depositing into the pool. Lending Co. deposits `RECOVERY` itself if the backstop covered the loss. |
| `PayoutPool` | The reserve lender is gone: `setLenders(yield, reserve)` → `setYieldPool(yield)`; no repayment leg to a reserve; `borrowed()` counts the yield pool and the bond vault. Slots kept, renamed. |
| `BondVault` | `repayReserve` removed; `setBackstops(treasury, payoutPool)`; `deployableExcess` no longer reserves for a pool loan. Slots kept, renamed. |
| `BurnerBond`, `BurnerBondDeposit`, `BurnerBondFactory` | Hold no AssurancePool address at all. The factory gates collections on the TokenRegistry's whitelist (the AssuranceOracle used to answer). BurnerBond also drops the unused `getCollectionMetadata()` view to stay under EIP-170 (section 6). |
| `NetworkRegistry` | `registerIssuer(issuer, stableCredit)` (the pool and oracle fields of `Network` stay, at zero). New `listMoneyPath(account, kind)` (admin, set once, never cleared) and `isMoneyPath`. |
| Retired | `AssuranceOracle`, `IAssuranceOracle`, `ITargetRTDSource`, `TickMath`, `MockUniswapV3`, `MockAssurancePool`, `IBondBackstop`; the old-pool scripts (`set_target_rtd`, `upgrade_assurance_*`, `update-assurance-oracle-config`, `upgrade_bond_backstops`, `upgrade_reserve_draw`, `test-burner-bond-factory`) and `deploy/09`. |

After this, `grep` finds no call from any credit, savings, payout, bond or registry contract into the Assurance contracts; the only reads go the other way (the pool reads `NetworkRegistry.isMoneyPath` and the CollateralRegistry's `poolExposure`).

### Governance and deploy (decisions 5, 6)

- `deploy/assurance_timelock_handover.ts` (beside `credit_timelock_handover.ts`): the third `TimelockController` (7 days, the co-op board Safe proposing and executing, no admin), the pool initialized with it as governance (so the deployer never holds a pool power), the money-path listing in NetworkRegistry, the governed calls that finish setup as calldata, and `assertNoAssuranceAdmin`. `deploy/08` runs it. `test/deploy/Assurance.deploy.spec.ts` runs it on a fresh chain and executes the governed calls through the timelock.
- `deploy/20` registers issuers against the ledger alone and sets the ledger's reserve token (`RESERVE_TOKEN`, default USDC per network) and `LENDER_OPERATING`. `deploy/10`, `22`, `24`, `deploy_burner_bonds.ts`, `verify_deployments.ts` and `credit_timelock_handover.ts` no longer name the pool or the oracle.
- `UPGRADEABILITY.md`: the Assurance timelock and the pool's section; the storage notes.

## 2. Decisions applied

All seven section 13 decisions, as recorded in `PHASE-2B-PROGRESS.md`. Decision 1 overrides two "Do NOT change" items (RTD as pool exposure; the Phase 0 AssurancePool role fixes), so the Phase 0 acceptance test 11 now asserts `backstopFloor() == 0` with only savings-backed credit live.

## 3. Interpretations and defaults (not conflicts)

1. **"Every value is a governed parameter."** The 72-hour pause window and the 14-day and 7-day minimums are constants: they are limits the spec states, and making them governable would let governance widen them. `transferDelay` is governed but can only be 14 days or more. `MAX_COMPARTMENTS` (8) and `MAX_EXPOSURE_SOURCES` (4) are gas bounds.
2. **USDC only.** The pool holds one asset, fixed at initialize. "Unless governance adds another liquid asset" is met by a governed, timelocked upgrade, not a setter; a multi-asset ledger is not built.
3. **Covered book.** Read from the CollateralRegistry's `poolExposure()`, which is computed from every issuer's `debtByKind`: unsecured kinds (income-backed, Boost, term) in full, savings at zero, and asset-backed debt by its shortfall after haircut. That last part is not in 13d's list, so the on-chain figure can be a little higher than "unsecured exposure" (it can only raise the floor). The figure is refreshed per member when touched; the monthly attested figure is the floor under it.
4. **Lending Co.'s operating address pays in.** 13c names it as the payer of fees and recoveries; acceptance 33's "every Lending Co. role calling anything but requestDraw reverts" is met for its pool roles (the draw and loss-reserve addresses) and, for the operating address, every function but `deposit(CREDIT_ENHANCEMENT_FEE | RECOVERY)` reverts. The test says so.
5. **Approval checks coverage too.** 13e says a draw reverts above `availableCoverage()` at release; `approveDraw` also refuses, so an approval cannot outrun what could be paid.
6. **`burnLostDebt` stays, reverting**, so the selector answers with a reason rather than vanishing.
7. **ClaimEscrow** is in the deploy script's money-path list as well. It is not in 13c's list, but listing only narrows who may pay the pool.

## 4. Conflicts

None found beyond the approved overrides. Two notes for the record, not conflicts:
- `DECISIONS #3` ("the AssurancePool rule stays as it is") was already overridden for 12.10 in Phase 2b; this phase removes the pool's lending functions entirely (decision 4).
- The PayoutPool and BondVault no longer count or repay a loan the old Base Sepolia pool made. That only affects Base Sepolia, where the old pool is retired.

## 5. Tests

New:
- `test/audit/compliance/Assurance.spec.ts` — acceptance 31, 32 and 33 (14 tests). The 31 covered book is read from a real RevolvingIssuer through the CollateralRegistry. The 32 fuzz is a seeded random sequence of pool calls by signers and others (`FUZZ_STEPS`, default 300), checking `sum(compartments) == USDC held == totalAccounted` after every call, and that money left only to the loss-reserve and disbursement addresses. The 33 fuzz calls every state-changing function of CLRUSD, ESADepositVault, the CollateralRegistry (pledge module), the Liquidator, RevolvingIssuer, TermIssuer, OffersIssuer, LendingPool, BondVault, PayoutPool, the ledger, BurnerBond, BurnerBondDeposit and MerchantRegistry once with random arguments and random callers (the pool's own address among the addresses), then `FUZZ_STEPS` more at random, and checks every compartment is unchanged. Separate tests run the real paths (redemption, payouts, a due-claim draw, liquidation, `settleExcess`), impersonate each money-path contract to show `deposit` reverts under every tag, and call every pool function from Lending Co.'s three addresses and the two Clear Capital entities.
- `test/peripherals/AssurancePool.spec.ts` — rewritten for the new pool (42 tests): each governed setter is shown refused directly, refused without approval, refused with one approval, refused when the same signer approves twice and when a non-signer approves, then accepted; the real timelock path; upgrades keeping every balance; deposits, floor, draws, grants, transfers, pause.
- `test/deploy/Assurance.deploy.spec.ts` (1).
- `test/peripherals/NetworkRegistry.spec.ts` — the money-path list (3 new).

Existing tests changed (each now asserts the section 13 behaviour; nothing was loosened):

| File | Change and reason |
|---|---|
| `helpers/phase0-fixture.ts` | No pool or oracle. The ledger gets `setReserveToken(usdc)` and `setLenderOperating(signer 18)`; USDC is whitelisted in the TokenRegistry for the bond factory. |
| `helpers/assurance.ts` (new) | Deploys the timelock and pool with their own keys, so no pool role is a test member. |
| every spec calling `registerIssuer` | Two arguments (24 call sites, mechanical). |
| every spec deploying `BurnerBondFactory` | `(tokenRegistry, uri)`. |
| `core/RepaymentRouting` | "sends everything to the reserve" → "...to Lending Co.", and the pool-balance assertions read Lending Co.'s balance; "keeps the reserve out of it" uses the new pool. New: the ledger refuses a repayment with no reserve token, and sets it once. |
| `core/BondBackstop` | Rewritten against a funded new pool: the vault pays alone or with the treasury and every compartment is unchanged. The RTD tests and "lends only to the bond vault it names" are replaced (no RTD; no lending; two-argument `setBackstops`). 8 → 6. |
| `core/BondSeniority`, `core/FirstLossOrdering` | The new pool; first loss now escalates through Lending Co.'s draw (request, approve, release by two signers). |
| `core/PayoutLifecycle` | `setYieldPool`; "never falls back to the reserve" uses the new pool; the treasury test drops its reserve deposits. |
| `core/AssuranceOracle.spec.ts` | Deleted with the contract (14 tests). |
| `audit/compliance/ReserveUntouched` | Funds both compartments of the new pool; nothing is "named as a lender" any more because nothing can be. |
| `audit/compliance/Revolving` (acceptance 11) | `backstopFloor() == 0` with only savings-backed credit (decision 1). |
| `audit/deep/PeripheralRegressions` | X-9, X-15, X-16 and M-8/X-17 were findings on the retired pool and oracle; they become two tests that the new pool cannot recur them (one asset at face; no lending). X-10 reads the vault's own `requiredReserve` gas instead of the pool's RTD. 23 → 21. |
| `audit/deep/LowFindings` | L-1 initializes the new pool's implementation; L-8 uses `setLenderOperating` and `setYieldPool`. |
| `audit/deep/DeepPoC` (X-2) | The repayment's destination past the payout pool is Lending Co. |
| `peripherals/BurnerBond` | Registers USDT in the TokenRegistry for the tests that open a USDT collection (the oracle whitelisted it by default); the bare implementation's `initialize` takes one argument fewer. |
| `peripherals/PayoutPool`, `Liquidator`, `TermIssuer`, `OffersIssuer`, `BurnerBond`, `CollateralRegistry`, `core/AssetBackedTier` | Pool-balance assertions now read Lending Co.'s balance or the new pool's compartments; the registry drives the Credit Backstop floor. |
| `deploy/CreditCore.deploy` | Issuers are registered against the ledger alone (they used to wait for a pool and oracle). |

## 6. Numbers

- **Tests.** The full Hardhat suite (`KEEP_REVERT_STRINGS=true npx hardhat test --no-compile`, fuzz at the default 300 steps): **962 passing, 0 failing** (Phase 2b ended at 957). The net +5:
  - acceptance spec +14 and deploy spec +1;
  - the pool's unit spec 38 → 42;
  - NetworkRegistry +3, RepaymentRouting +1;
  - BondBackstop −2, PeripheralRegressions −2;
  - the oracle spec −14.

  `npx turbo run typecheck test --affected`: 32 of 32 tasks passed.
- **Sizes.** Production build (`npx hardhat compile --force`). No contract is over 24,576 bytes runtime or 49,152 bytes of creation code.

  | Contract | Runtime | Creation code |
  |---|---|---|
  | BurnerBond | 24,168 | 24,278 |
  | RevolvingIssuer | 23,599 | 24,324 |
  | TermIssuerExtension | 23,595 | 23,732 |
  | ClearCredit | 21,755 | 21,892 |
  | TermIssuer | 21,488 | 22,171 |
  | PayoutPool | 20,786 | 20,923 |
  | RevolvingIssuerExtension | 20,467 | 20,604 |
  | RevolvingIssuerCycles | 19,553 | 19,607 |
  | AssurancePool (new) | 17,070 | 17,207 |
  | OffersIssuer | 12,123 | 12,260 |
  | BondVault | 10,290 | 10,427 |
  | BurnerBondDeposit | 7,908 | 8,018 |
  | BurnerBondFactory | 7,270 | 46,956 |
  | NetworkRegistry | 6,924 | 7,061 |

  BurnerBond needed a fix. Its own source got smaller (a standalone compile measured 24,806 bytes on `dev` and 24,065 here). But in the full project build it came out at 24,643, because viaIR code generation shifts with whatever else is in the compilation job. Removing the unused `getCollectionMetadata()` view brought it to 24,168. It duplicated five public getters, and nothing in the repo, the apps or the tests read it. Nothing else is within 100 bytes, except Subdivide, which is unchanged at 24,574.
- **Storage** (slot by slot, from solc's storage layouts on `dev` and on this branch):
  - **Unchanged:** RevolvingIssuer, TermIssuer, OffersIssuer and CreditPool.
  - **Renamed in place, never read** (the old pool's address and loans; `@custom:oz-renamed-from`):
    - ClearCredit, slot 253;
    - PayoutPool, slots 271 and 273;
    - BondVault, slots 261 and 264.
  - **Appended:**
    - ClearCredit gains `reserveToken` (262) and `lenderOperating` (263);
    - NetworkRegistry gains `moneyPathKindOf` (257), and its `__gap` shrinks from 44 to 43, so it still ends at slot 300.
  - **Untouched:** ESADepositVault and ClaimEscrow (no diff), so their storage reports against `.openzeppelin/base.json` stand as Phase 2b left them.
  - **AssurancePool:** a fresh layout. 33 slots of its own, then `__gap[67]`; the balances are in `compartmentOf`.
  - **BurnerBond and BurnerBondDeposit:** these are clones of a factory's implementation and are never upgraded. Their `assurancePool` slot is dropped, which is safe because a new factory deploys new implementations.
- **Slither** (Medium and High, per contract, the FIX-PLAN section 6 way, compared with the same run on `dev`). The contracts run were AssurancePool, ClearCredit, NetworkRegistry, PayoutPool, BondVault, BurnerBond, BurnerBondDeposit, BurnerBondFactory, RevolvingIssuerExtension, RevolvingIssuerCycles, OffersIssuer and TermIssuerExtension.
  - **New, all in AssurancePool, all intended:**
    - `incorrect-equality` on `amount == 0` in `_credit` and on `year == allocationYear` in `setAllocation`. These are a zero check and a program-year comparison, not balance equalities.
    - `uninitialized-local` for `toOthers` and `sum`, which are accumulators that start at zero.
  - **Gone:** every finding on the old pool, including the High `reentrancy-balance` in `_withdrawEquivalentValue`. Also gone are `reentrancy-no-eth` in `burnLostDebt` and the `unused-return` approvals in `_routeRepayment`, `_repayLenders`, `_repayPrincipal` and `_repayReserve`.
  - **Unchanged:** nothing else new in the other eleven contracts.
- **Generated files:** fingerprints (`packages/command-types/src/chain/code.json`) and the contract reference were regenerated; both `--check`s pass; `check-doc-links` reports 193 files and no broken links. The contract-reference pages describe what is *deployed* (Base Sepolia's old pool and oracle), so they now mark those functions "Not in the current source".

## 7. Open questions for the owner

1. **Unsolicited transfers.** USDC sent to the pool by a plain transfer is credited to no compartment, and 13g leaves no function to move it, so `sum(compartments) < balance` after one. Should governance have a two-person "credit unaccounted USDC to CREDIT_BACKSTOP" (an inflow, not an outflow)? Not added: it is not in 13c's list.
2. **Stale proposals.** A transfer proposal, or a half-made two-signer action, never expires. Add an expiry, or a two-signer cancel?
3. **Covered-book source.** Is the CollateralRegistry's exposure (which includes asset-backed shortfalls) the right "unsecured exposure", or should issuers report income/Boost/term principal directly? The latter needs running totals in the issuers.
4. **Who holds the money-path listing power after the credit handover.** It sits with NetworkRegistry's `DEFAULT_ADMIN_ROLE`, i.e. the credit timelock (Ops Safe). It can only add entries, but adding a payer to the list blocks its deposits.
5. **Allocation by program year.** The program year runs from the pool's initialization in 365-day steps. A calendar or fiscal year needs a governed start date.

## 8. Apps and API follow-up

- `apps/api` and `apps/command` read `stableCredit.assurancePool()` and the old pool's views (`primaryBalance`, `bufferBalance`, `excessBalance`, `RTD`, `neededReserves`), `AssuranceOracle`, and `PayoutPool.reserve()` / `borrowedFromReserve()`. They need the ledger's `reserveToken()` and `lenderOperating()`, and the new pool's `compartments()`, `balanceOf(compartment)`, `backstopFloor()`, `backstopBalance()`, `availableCoverage()`, draws and transfers.
- The Assurance claims store (`apps/api/src/services/assurance/claimStore.ts`) can pay grants on chain through `releaseAssurance`, two signers, with the claim's id hashed as `grantId`.
- Lending Co.'s tooling: `requestDraw` per period, and `deposit(CREDIT_ENHANCEMENT_FEE | RECOVERY)` from its operating address.
- `packages/command-types` fixtures name the old pool's figures.
- The repayment service: the remainder now lands at Lending Co.'s operating address.
