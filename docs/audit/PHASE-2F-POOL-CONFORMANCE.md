# Phase 2f: Yield Pool conformance to IV-02

Branch `audit/phase-2f-pool-conformance`. It holds the reworked Yield Pool ([`PHASE-2F-YIELD-POOL.md`](./PHASE-2F-YIELD-POOL.md)) and the Earn controls ([`PHASE-2F-EARN-CONTROLS.md`](./PHASE-2F-EARN-CONTROLS.md)). The specs were brought in from `audit/phase-2f-earn-pool`, decisions 1–32 included. No PR was opened.

What binds:

- [`specs/IV-02-yield-pool-subscription-and-pool-share-terms.md`](./specs/IV-02-yield-pool-subscription-and-pool-share-terms.md) is the binding instrument for the Yield Pool.
- [`specs/phase-2f-plan-decisions.md`](./specs/phase-2f-plan-decisions.md) decisions 24–29 are the core of this pass. Decision 31 (the Ladder) was added mid-task for EarnControls.

Nothing was deployed. No key was used and no live network was touched. No admin power was widened; one was narrowed (`setEncumbranceSource`, see §8.5). Every new role power is one IV-02 grants, and each is two-person where IV-02 asks for two-person control.

Out of scope and untouched: the Liquidator, CollateralRegistry, the issuers, the bond contracts, BondVault, PayoutPool, CLRUSD, ESADepositVault and ClaimEscrow. `seizeShares`, `enforcementRedeem` and the enforcement destination were left alone for the `audit/phase-2f-enforcement` branch.

## Summary

- **Decisions 24–29 are built.** Each has its own tests:
  - Pool Interest is billed monthly and capitalized when unpaid;
  - recoveries;
  - the Valuation Event flag;
  - the legend;
  - direct transfers;
  - the $1.00 restart.
- **The spec fixes are built:**
  - Utilization excludes accrued interest;
  - the Holdback Percentage is kept at full precision;
  - Deployments are capped at the Pool Tier principal ceiling;
  - `lowUtilizationSince()`;
  - redemption proceeds go only to the Holder's own account;
  - Suspension limits count the total on the same facts;
  - the encumbrance source moves to the admin;
  - the pool's own holder cap is removed.
- **A new delegatecall module, `YieldPoolLedger`,** holds Pool Interest, Suspension, the rate model, recoveries, the Valuation Event, the Pool Tier ceiling and the legend.
  - The valuation module pins it, and LendingPool reads it from there.
  - The functions added in this pass reach the pool through its fallback, so clients use the joined ABI (`poolAt`).
- **Decision 31 is built in EarnControls.** Ladder changes take two `LADDER_ROLE` signers and wait 48 hours. The rate at quote or notice time stays readable through `rungAt`.
- **Checks.**
  - Sizes: everything fits. LendingPool has 1,576 bytes to spare.
  - Storage: compatible with both Base Sepolia implementations.
  - Slither: no defect.
  - Tests: every affected spec passes (section 2).

## 1. IV-02, section by section

Status codes:

- **Built**: built in this pass.
- **Already**: already built, and checked again in this pass.
- **Off-chain**: Clear Lending's obligation or a record outside the vault.
- **Not built**: not built, with the reason given.

| § | Requirement | Status | Where, or why not |
|---|---|---|---|
| 1.2 | Deployed Balance = Deployments + capitalized interest − Returns − Pool Loss Charges + recoveries | Built | `totalBorrowed`, shown as `deployedBalance()` and projected to now. See call 1 for the charge's holdback part |
| 1.2 | Holdback Percentage = allowance ÷ Pool Assets, as last posted | Built | `holdbackRate()`, a WAD fraction set at posting. `holdbackBps()` rounds it up for display |
| 1.2 | Pool Assets = Vault Cash + Deployed Balance + accrued unpaid interest | Already | `totalAssets()`. Between bookings it is projected by the ledger, month ends included |
| 1.2 | Utilization = Deployed Balance ÷ (Deployed Balance + Vault Cash) | Built | `_utilizationOf`. Accrued interest is no longer counted. The Funding Rate and the 90% cap follow it |
| 1.2 | Vault Cash = USDC held, less Holdback Amounts | Already | `vaultCash()` also leaves out pre-2f claims, unclaimed payments and the unrecognized restart leftover |
| 2.1, 2.4 | Eligibility; source of funds | Already (EarnControls) | `checkSubscription` and the attestation |
| 2.2 | Launch conditions | Off-chain | |
| 2.3 | Issue at Share Value, rounded down, nothing deducted; $1.00 at the Initial Closing | Already, and built | The $1.00 restart is decision 29. The Earn page text is the app's |
| 2.5(a) | $250 minimum | Already | `MIN_SUBSCRIPTION_UNITS` |
| 2.5(b)–(d) | Net worth, household cap, capacity, Funding Limit, offering maximum | Already (EarnControls) | The pool's own `_checkHolderCap` and `setHolderCapBps` are removed, so the first subscriber is accepted (decision 23) |
| 2.6 | Pauses (Reserve Shortfall, Equity Cushion, 30 days below 50%); redemptions never paused | Built | `lowUtilizationSince()` (`IPoolUtilizationClock`) is updated on every change to the Deployed Balance or Vault Cash. EarnControls reads it |
| 2.6 | Written confirmation within one Business Day | Off-chain | |
| 3.1–3.5 | Promise, claim, limited recourse, ranking | Already, or off-chain | The per-Holder principal and interest records are off-chain |
| 3.7 | The vault is the Register | Already | Holdings plus `Subscribed` and `Transfer` events; the legend view (§8.4) |
| 3.8 | From the Final Maturity Date, no Deployments; Returns and Vault Cash redeem every share | Already | `deploy` reverts. `requestRunOff(holder)`, by anyone, queues a holder's free shares, and fills take every Return and all Vault Cash in order. Pledged shares run off through MB-05 (call 9) |
| 4.1, 4.2 | Use of proceeds | Off-chain | |
| 4.3 | Deployment only to the lending account, two-person, no queue or Suspension, ≤ 90% | Already | `deploy` |
| 4.3 | Deployed Balance ≤ outstanding principal of the Pool Tiers + Margin Advances | Built | Two `VALUATION_ROLE` signers post `postPoolTierPrincipal(value, evidence)`. Each Deployment is checked against it, and none is made before it is posted. Returning any excess on the next Business Day is off-chain |
| 4.4, 4.5 | Margin Advances; Returns while a request is open | Off-chain | `returnFunds` takes any Return |
| 4.6 | Per-second interest at the Funding Rate, 365-day year; due 5 Business Days after month end; unpaid interest capitalized | Built | Decision 24, below |
| 4.7 | Only USDC; no sweep, rescue or administrative transfer | Already | The outflows are: a Deployment; a redemption or fill to its Holder; a holdback release to its Holder; a refused payment claimed by its payee; a pre-2f claim; and a loss charge's excess to the lending account. Recoveries and the restart move no cash |
| 5.1–5.3 | Loss order, Credit Backstop, Pool Loss Charges | Off-chain, and already | Postings are two-person with evidence |
| 5.4 | Recoveries add unrestored charges back to the Deployed Balance | Built | Decision 25 |
| 5.5 | Share Value = Pool Assets ÷ shares; the allowance never enters it | Already | `shareValue()` is $1.00 while no share is outstanding (decision 29) |
| 5.6(a) | Every redemption pays the Redemption Amount less the Holdback Percentage | Already, and built | H = G × rate, rounded up once. Before, the rate was rounded up to whole basis points first (call 3) |
| 5.6(b) | A lower posting releases down to G × the new rate; a higher one never raises H | Already | `releaseHoldbacks`. Release = H − ⌈G × rate⌉, so releases round down |
| 5.6(c) | Maximum Holdback Age 540 days; shortening reaches every open amount; lengthening only later ones | Already | Each holdback stores its age at recording (`Holdback.maxAge`), and the `ageCaps` stack applies shortenings. Lengthening needs the Majority Holders' consent before the timelock executes it; that consent is off-chain |
| 5.6(d) | Ratable application: G × L ÷ (Pool Assets + Σ G), capped at H; applied amounts added to Pool Assets; only the rest reduces the Deployed Balance | Already | Checked against A10 to the cent (section 2). See call 1 |
| 5.6(e) | Release and application under two-person control; releases payable by anyone | Already | Postings are two-person; `releaseHoldbacks` and `applyHoldbacks` are permissionless and formula-bound |
| 6.1, 6.2 | On demand when liquid; "take $X now, queue the rest" | Already | `redeem`, `withdraw`, `redeemOrQueue` |
| 6.3(a), (b), (d) | FIFO, filled at Share Value at fill, fills by anyone, cancellation | Already | |
| 6.3(c) | All Vault Cash goes to the queue first; no immediate redemption while it is open | Already | `_redeemNow` and `deploy` revert while a request is open, and fills take every new dollar. See call 10 on a loss charge's excess |
| 6.4 | Extended queue | Off-chain | `oldestRequestAge()` |
| 6.5 | Proceeds only to the Smart Account that held the shares, except enforcement and Successor payments | Built | `redeem`, `withdraw`, `redeemOrQueue` and `requestWithdrawal` now require receiver = owner. An approved spender may redeem, paid to the owner. Enforcement pays the recorded destination |
| 6.6 | No payments from Pool Shares | Already, and off-chain | No payment path exists. Proceeds land in Ready to allocate in the app |
| 7.1 | Four Suspension Events | Already | Reason codes |
| 7.1(d) | Valuation Event pending | Built | Decision 26 |
| 7.2 | Never a Suspension Event | Off-chain | |
| 7.3 | Two-person, CCO or treasurer, reason on chain | Already | |
| 7.3 | 72 hours unless renewed by a different signer | Already | Different from the last signer (call 11) |
| 7.3 | Beyond 10 Business Days a Board resolution; at most 30 days in total for the same event, except an order | Built | 240 hours (stricter than 10 Business Days). Both limits count the total on the same evidence across suspensions: a new one resumes at the time already used (`evidenceStartedAt`). Facts that have used their 30 days cannot be suspended again, except under LEGAL_ORDER |
| 7.3 | §7.1(d) at most 2 Business Days | Built | 48 hours, not renewable, once per event. It ends when the allowance is posted. 48 hours is never longer than 2 Business Days |
| 7.3 | A new Suspension on the same facts within 30 days needs the resolution | Already | |
| 7.4 | During: no Deployment, queue order kept, cancellations, interest accrues, Returns accumulate; postings precede the end | Already | The VALUATION_PENDING Suspension ends when its posting is made. Notices are off-chain |
| 7.5 | Holds required by law | Not built | It would be a new freeze power over one Holder. USDC's own blocklist already defers a refused payment (`unpaidOf`). Left for the owner (call 12) |
| 8.1 | No transfers except same-Holder and operation of law | Already (EarnControls) | `transferAllowed` |
| 8.2 | Pledge under MB-05; Pool Share Value is what the vault would pay | Already | `previewRedeem` is net of the holdback. Enforcement is the enforcement branch's |
| 8.3 | Successor registered; if the account cannot be accessed, redeem and pay in dollars | Part built | The two-person Successor transfer approval is in EarnControls. A redemption without the Holder's signature is not built (call 12) |
| 8.4 | Legend in the Register and the vault's metadata | Built | Decision 27 |
| 8.5 | No key, role or session key can move, burn or freeze a Pool Share | Built | Role review in call 13. `setEncumbranceSource` moves from `OPERATOR_ROLE` to `DEFAULT_ADMIN_ROLE` |
| 9.1, 9.2 | No fees; costs paid by Clear Lending | Already | No fee path |
| 9.3 | On-chain information | Already, and built | Added: `billedInterest`, `totalCapitalized`, `unrestoredCharges`, `poolTierPrincipal`, `valuationEvent`, `leftover`, `holdbackRate`, `lowUtilizationSince`, `legend` |
| 9.4–9.6 | Statements, notices, questions | Off-chain | Events support them |
| 10, 11 | Offering, representations, tax | Off-chain | Exemption Code via EarnControls |
| 12.5 | Upgrades only through a timelock of at least 7 days, two-person, carrying everything over | Already | `_authorizeUpgrade` is `DEFAULT_ADMIN_ROLE`, which is the Earn timelock (7 days, Safe of 2 or more). Storage is append-only, checked again |
| Sch. 1 | Term sheet | Matches | |
| Sch. 2 §1–3 | Formula, bounds, table | Already | Tested at real pool states of 0, 50, 80, 90 and about 100% Utilization |
| Sch. 2 §4 | Changes: 48 hours, or 30 days and one per quarter for a cut, through the timelock | Already | Moved to the ledger unchanged |
| A1 | Standard; Deployed Balance at its recorded amount | Already | |
| A2 | Monthly charges; holdbacks first; the rest reduces the Deployed Balance; the excess over the Deployed Balance and interest is transferred to Clear Lending under two-person control | Already | `_completeCharge` pays the excess to the lending account, after the two-person posting. No other outflow was added |
| A3 | Allowance between 0 and Pool Assets | Already | |
| A4 | Postings at month end; an update within 2 Business Days after a Valuation Event | Built (flag) | `recordValuationEvent`. The timing is off-chain |
| A5 | Two-person postings with evidence | Already, and built | Recoveries, the Valuation Event and the Pool Tier ceiling follow the same rule |
| A6 | Shares and USDC paid round down; each Holdback Amount up, each release down; virtual offset | Already, and built | The percentage is no longer rounded to whole basis points. The OpenZeppelin virtual share and asset are kept (decision 28) |
| A7–A9 | Review, errors, changes | Off-chain | |
| A10 | Worked example | Tested | Section 2 |

### The decisions

**24, Pool Interest (§4.6).**

- *Accrual.* Interest accrues per second on the Deployed Balance at the Funding Rate (365-day year).
- *Billing.* At each month end the interest accrued and unpaid is billed (`billedInterest()`). A month ends at 23:59:59 Pacific on its last day, using `PacificCalendar`. The bill is due at 23:59:59 Pacific on the 5th weekday after the month end.
- *Capitalization.* Whatever is still unpaid after the due time moves into the Deployed Balance, where it earns interest (`InterestCapitalized`, `totalCapitalized()`).
- *Lazy.* `YieldPoolLedger.accrue()` walks every month end and due date since the last booking. It runs at the start of every change, and anyone may call it. The views run the same walk without writing, so `totalAssets()` between bookings equals what a booking would record.
- *Returns.* `returnFunds` pays interest first, and the billed month first, so less of it is capitalized.
- *Business Days.* These are taken as weekdays. Ignoring bank holidays makes the due date no later than the true one, so capitalization never comes later than IV-02 allows. That favours Holders.

**25, recoveries (§5.4).** `postRecovery(value, evidence)`:

- two `VALUATION_ROLE` signers;
- the loss-charge rules: an evidence hash, and not while a charge or a release pass is pending;
- it adds `value` to the Deployed Balance;
- it is capped at `unrestoredCharges()`, which every posted charge raises by its full amount.

It is an accounting entry; cash comes later as Returns.

**26, the Valuation Event (A4, §7.1(d)).**

- `recordValuationEvent(evidence)` takes two `VALUATION_ROLE` signers and sets `valuationEventPending`.
- The next `postAllowance` clears it. If a VALUATION_PENDING Suspension is in force, that posting also ends it.
- A VALUATION_PENDING Suspension may be set only while the flag is set, once per event, for 48 hours, with no renewal.

**27, the legend (§8.4).**

- `legend()` and `legendHash()` show it.
- `setLegend(text)` (`DEFAULT_ADMIN_ROLE`) writes it at once the first time, at setup or the upgrade.
- Any later change is scheduled and takes effect after 7 days through `applyLegend()`, which anyone may call. That is on top of the Earn timelock and the Safe's two signers.
- Deploy 22 writes IV-02's text when the legend is empty. The Base Sepolia upgrade must call `setLegend` after `initializeYieldPool`.

**28, direct transfers.** These count as Vault Cash and raise the Share Value at once, ratably. That is unchanged and now tested. The virtual share and asset (offset 0) and the $250 minimum stay.

**29, the $1.00 restart.** When no share is outstanding:

- conversions are one to one, and `shareValue()` reads $1.00;
- the next subscription issues at exactly $1.00;
- the leftover is set aside (`LeftoverSetAside`): cash plus the Deployed Balance plus interest, less Holdback Amounts, pre-2f claims and unclaimed payments;
- the leftover is recognized into Vault Cash linearly over 30 days, with the unrecognized part rounded up.

Queued shares are outstanding shares, so a queue request is never leftover. Tests:

- a donation into an empty pool: the first subscriber gets 1,000 shares for $1,000, and leaving at once returns under $1,000.01;
- the 15- and 30-day recognition;
- holdbacks are kept out of the leftover.

### The ledger module

LendingPool had 1,652 bytes to spare. The work moved out of it and out of the valuation module into a third contract, `YieldPoolLedger`.

How it is wired:

- **Pinning.** `YieldPoolValuation(ledger)` checks the ledger's `extensionKind()` ("YieldPoolLedger.v1"). LendingPool checks "YieldPoolValuation.v3" ("v2" before the Settlement Funding lane, decision 54) and reads `ledger()` from it. Both pin the address as an immutable.
- **Deployment.** `deploy/poolModules.ts` deploys the ledger, then the valuation module.
- **Existing functions** keep their LendingPool stubs, so the LendingPool ABI is unchanged for existing callers:
  - the mutating stubs forward to the ledger (`suspend`, `renewSuspension`, `liftSuspension`, `proposeRateModel`, `applyRateModel`);
  - the view stubs (`deployedBalance`, `accruedInterest`, `utilization`, `utilizationBps`, `fundingRate`, `fundingRateAt`, `holdbackBps`) answer through `ledgerView(bytes)`. Only the pool may call that function, by a self-staticcall.
- **New functions** reach the pool through its `fallback`, which delegatecalls the ledger:
  - `accrue`, `projectedPoolAssets`, `billedInterest`, `totalCapitalized`, `lowUtilizationSince`;
  - `leftover`, `unrestoredCharges`, `postRecovery`;
  - `recordValuationEvent`, `valuationEvent`;
  - `postPoolTierPrincipal`, `poolTierPrincipal`;
  - `legend`, `legendHash`, `pendingLegend`, `setLegend`, `applyLegend`;
  - `holdbackRate`.
- **Joined ABI.** `poolAbi()` and `poolAt(address)` join the two ABIs. They leave out the ledger's own `extensionKind`.

## 2. Checks

**Sizes.** Production build (`npx hardhat compile --force`, revert strings stripped, via-IR, runs 1):

| Contract | Runtime (left of 24,576) | Creation (of 49,152) |
|---|---|---|
| LendingPool | 23,000 (1,576) | 23,655 |
| YieldPoolValuation | 20,598 (3,978) | 21,052 |
| YieldPoolLedger (new) | 19,388 (5,188) | 19,525 |
| EarnControls | 17,966 (6,610) | 18,420 |
| EarnControlsAdmin | 15,049 (9,527) | 15,186 |

**Storage.**

- *Layout.* Append-only. Twelve slots of `__yieldPoolGap` are used, and the gap is now 38. `_holdbackBps` and `_holderCapBps` are retired in place.
- *OpenZeppelin report.* `scripts/storage_report_lending_pool.ts` (new; read-only, no network) runs `getStorageUpgradeReport`. It reports both Base Sepolia LendingPool implementations (0x24C4…2663 and 0xcB71…C034) as compatible.
- *Rehearsal.* `test/earn/YieldPoolUpgrade.spec.ts` rehearses `upgradeProxy` from the Base Sepolia source again. It passes.
- *EarnControls.* It added one mapping (gap 40 → 39) and widened the `Rung` struct within its mapping slot. The contract has never been deployed.

**Slither** 0.11.6, Medium and High, per contract, with solc 0.8.29, via-IR, runs 1. It was run on LendingPool, YieldPoolValuation, YieldPoolLedger, EarnControls and EarnControlsAdmin. No defect was found. Findings new to this pass:

| Finding | Where | Triage |
|---|---|---|
| `controlled-delegatecall` (High) | `LendingPoolBase._delegate` | The target is a pinned immutable module. The data is either the fixed `accrue()` selector or, in `ledgerView`, caller data that only the pool itself may send, by staticcall |
| `reentrancy-no-eth` (Medium) | `postAllowance`, `postLossCharge`, `applyHoldbacks`, `releaseHoldbacks`, `_subscribe` | The "external call" is the delegatecall into the pinned ledger (`_accrue`), not an external contract. `_subscribe`'s controls call is as before |
| `weak-prng` (High) | `_dueAfter`'s `% 7` | Weekday arithmetic, not randomness |
| `incorrect-equality`, `uninitialized-state`, `uninitialized-local`, `unused-return`, `divide-before-multiply` | Throughout | Intended zero and equality checks; the module-split false positive; accumulators; the calendar's unused day fields; `PacificCalendar`'s integer algorithms. All as triaged in earlier phases |

**Generated files.**

- `node scripts/command/code-fingerprints.mjs` was regenerated, and `--check` passes (34 contracts).
- `node scripts/docs/contract-reference.mjs` was regenerated (`LendingPool.md`), and `--check` passes.
- `node scripts/check-doc-links.mjs` finds no broken links.
- `TURBO_SCM_BASE=origin/dev npx turbo run typecheck test --affected` passed 3 of 3 tasks.

**Tests.** New:

- `test/earn/YieldPoolConformance.spec.ts`, 21 tests:
  - decision 24: billing at the Pacific month end with the due date computed independently in the test; capitalization only after the due second and only of what is unpaid, which then earns interest; nothing capitalized when paid on time; the projection equal to the booking across two month ends;
  - Utilization and Schedule 2's table at real pool states;
  - decision 25: recoveries, two-person, with the cap, and refused while a charge is pending;
  - decision 26: the Valuation Event and VALUATION_PENDING;
  - decision 27: the legend, written once and then 7 days;
  - decision 28: direct transfers;
  - decision 29: a donation into an empty pool, and holdbacks never leftover;
  - §4.3 fail-closed and the cap;
  - §2.6 clock with the real EarnControls pause after 30 days;
  - §6.5 receivers;
  - §7.3 cumulative limits (two tests);
  - §8.5 (two tests);
  - full-precision Holdback Percentage;
  - Exhibit A10 as written, at 80% Utilization and 5.00%.
- `test/earn/EarnControls.spec.ts`: 5 new tests for decision 31.

Exhibit A10 to the cent:

- G $10,400.00 and H $156.00, paying $10,244.00;
- at 0.5%, $104.00 released and H $52.00;
- a $900 charge: ratable $93.60, the $52.00 applied, and $848.00 off the Deployed Balance;
- with interest accruing by the second, each figure is checked within half a cent.

The existing test 20 runs the same steps with no interest running and is exact.

**Run locally** (every spec that touches LendingPool or EarnControls): YieldPool, YieldPoolConformance, YieldPoolUpgrade, EarnControls, CollateralAgent, Earn.deploy, LendingPool, FirstLossOrdering, AssetBackedDefault, PeripheralRegressions, Section12Liquidator, PledgedBonds, Assurance, PayoutDeadline, PayoutLifecycle, RevolvingIssuer, RepaymentRouting, Section2d and Section12Revolving. Result: **381 passing, 0 failing** across those 19 files. The full suite runs in CI.

## 3. For the owner: judgement calls and conflicts

1. **§5.6(d) and A2 against §1.2 on a charge that hits a holdback.**
   - §5.6(d) says the applied holdback amounts "are added to Pool Assets, and only the rest of the Pool Loss Charge reduces the Deployed Balance". A2 says the same.
   - §1.2 defines the Deployed Balance "less all … Pool Loss Charges".
   - Built as §5.6(d), the specific rule and the Holder-favourable one. In A10, $52 is applied and $848 comes off the Deployed Balance, so the remaining shares bear $848 of the charge and take in the leaver's $52. Pool Assets fall by $796, and the Pool Class as a whole falls by $848 for a $900 charge.
   - Under §1.2, $900 would come off and Pool Assets would fall by $848.
   - Counsel should align the two. The A10 acceptance test asserts the built reading.
2. **The recovery cap counts the full charge,** including any part applied to holdbacks (decision 25, "capped at the total of those charges"). A recovery of that part benefits the remaining Holders, not the leaver whose holdback bore it. That is the wider cap, and so Holder-favourable.
3. **The Holdback Percentage is kept at full precision.** It was rounded up to whole basis points, which withheld up to 0.01% of G more than §1.2's ratio. Each Holdback Amount is now rounded once, up (A6). `holdbackBps()` stays, rounded up, for the apps. `AllowancePosted`'s second field is now the WAD rate.
4. **Pool Interest details (decision 24).**
   - Business Days are weekdays. The due time is 23:59:59 Pacific on the 5th weekday, and capitalization happens from the next second.
   - A month's bill is everything accrued and unpaid at the month end.
   - A loss charge reduces unbilled interest before billed interest.
   - The Funding Rate in a walk between bookings uses Vault Cash as it is when the walk runs.
   - Interest is rounded down per booking: less than one micro-dollar.
5. **Low-Utilization clock.** It is updated after every change to the Deployed Balance or Vault Cash, and at every booking. A direct USDC transfer, the restart leftover's recognition or a lazy capitalization counts from the next transaction. An empty pool counts as 0% once it has any activity.
6. **Pool Tier ceiling (§4.3).**
   - It is posted by two `VALUATION_ROLE` signers, deliberately not the Deployment signers. It has no expiry.
   - It counts the Deployed Balance with capitalized interest.
   - Unposted, it refuses every Deployment. **The upgrade on Base Sepolia needs a posting before any Deployment.**
7. **Restart leftover (decision 29).** If no share is outstanding but some of the Deployed Balance or interest remains, the leftover includes it, so the first subscriber still pays exactly $1.00. Vault Cash is then reduced by the whole unrecognized amount, which can understate it. That is conservative: higher Utilization, fewer Deployments and less on-demand liquidity until the leftover is recognized.
8. **Valuation Event.**
   - Recording a second event while one is pending reverts.
   - One VALUATION_PENDING Suspension per event, whatever the evidence hash. This is narrower than a plain 48-hour limit.
   - A posting ends that Suspension at once, since §7.1(d)'s event has then ended.
9. **Final Maturity run-off (§3.8)** queues free shares only. Pledged shares run off through MB-05 enforcement or after release, as before.
10. **A loss charge's excess (A2) while the queue is open** is still transferred to Clear Lending's lending account. It settles a realized loss, so it is not a Deployment of Vault Cash. The narrower reading would hold it back until the queue clears; that needs a "settlement owed" amount kept outside Pool Assets. Left as built; for counsel.
11. **Renewal signer (§7.3)** must differ from the last signer: the proposer for the first renewal, then the last renewer. A narrower reading would also exclude the approver of the original Suspension.
12. **Not built, because each would add a power over a Holder's shares:**
    - §7.5 holds required by law. This would be a per-Holder freeze power.
    - §8.3's redemption of an inaccessible account's shares for a Successor paid in dollars. This would be a redemption without the Holder's signature.

    IV-02 lists both among Clear Lending's powers (§8.5). Each needs the owner to say who holds it, two-person, with what evidence.
13. **§8.5 role review.** Paths that can move, burn or freeze a Pool Share:
    - **Holder-signed:** `transfer` and `transferFrom` (same Holder or an approved Successor, through EarnControls); redemptions and queue requests; `cancelRequest`.
    - **Enforcement:** `ENFORCER_ROLE`'s `enforcementRedeem` and cancel. MB-05 enforcement is allowed by §8.5.
    - **`LIQUIDATOR_ROLE`'s `seizeShares`** and its exemption in the transfer hook. Both are being removed on `audit/phase-2f-enforcement` (C5) and were left alone here.
    - **The encumbrance source.** It decides which shares are locked, so whoever sets it could freeze a Holder. It has moved from `OPERATOR_ROLE` to `DEFAULT_ADMIN_ROLE` (the Earn timelock).
    - **`setEarnControls` (admin).** It can only refuse transfers, never move shares or stop redemptions.
    - **No other role touches a share:** `DEPLOYER`, `VALUATION`, `SUSPENSION`, `CCO`, `TREASURER`, `OPERATOR` (it no longer has any pool function) and `LADDER`.
14. **The legend's second change** waits 7 days on chain, on top of the Earn timelock. The first write is immediate at setup, as the decision allows.
15. **Proceeds to the owner (§6.5).** The ERC-4626 `receiver` must now be the owner. That breaks no in-repo caller: the Liquidator redeems to itself.
16. **Decision 31: there was no Ladder role,** so `LADDER_ROLE` is new. It is granted only with `grantRoleByResolution`, and the handover renounces any deployer copy. The admin's `setRung` stays, through the 7-day timelock, for the initial listing.
    - **Stage 2 hook:** the bond collection captures term and yield at quote and roll notice (decision 11) and never re-reads the Ladder. `rungAt(term, t)` returns the rate a quote was given at.
    - `rollYieldFor` still takes the higher of the notice and the current Ladder; called at notice time, it captures the rate. Stage 2 must not call it again at roll execution.
    - `PHASE-2F-EARN-CONTROLS.md` call 10 is marked decided.

## 4. Existing tests changed, and why

- **`test/helpers/yieldPool.ts`:**
  - the pools use the joined ABI (`poolAt`);
  - `setHolderCapBps` is gone (removed from the pool);
  - the Pool Tier ceiling is posted out of the way (§4.3 fails closed). `deployBarePool` grants its two deployers `VALUATION_ROLE` just long enough to post it;
  - new `postTierCap` and `NO_TIER_CAP`.
- **`test/earn/YieldPool.spec.ts`:**
  - **11, accrual:** kept inside one Pacific month, since unpaid interest is now capitalized (decision 24).
  - **12, Returns:** kept inside one month, for the same reason.
  - **12, the 90% cap:** the comment and an assertion now say interest does not move Utilization (§1.2). It used to say interest nudged it.
  - **14, VALUATION_PENDING:** records a Valuation Event first (decision 26).
  - **The decision-13 per-member cap test** is replaced by "accept the first subscriber" (decision 23; the cap is EarnControls').
  - **Refused-payment test:** no `setHolderCapBps`.
- **`test/earn/EarnControls.spec.ts`:**
  - the household-cap test asserts the pool has no `holderCapBps`;
  - the low-Utilization test now reads the real pool's clock (it no longer fails closed).
- **`test/deploy/Earn.deploy.spec.ts`:** the pool setting sent through the timelock is `setHoldbackMaxAge`, since `setHolderCapBps` is gone.

## 5. App and API follow-ups

- **Joined ABI.** Read the new functions with the LendingPool ABI joined with YieldPoolLedger's (`deploy/poolModules.ts`, `poolAbi`). The deployment record for LendingPool should carry the joined ABI.
- **Interest.** Show `billedInterest()` (amount and due date), `totalCapitalized()` and `accruedInterest()`. Clear Lending's treasury should pay each month's bill with `returnFunds` before the due time; `InterestBilled` gives the amount and due date. A keeper may call `accrue()`.
- **Holdback.** Show `holdbackRate()`, or `holdbackBps()` rounded up. Index `AllowancePosted`, whose field is now a WAD rate.
- **Ops consoles** for the two-person `VALUATION_ROLE` actions:
  - `postPoolTierPrincipal`, which is needed before any Deployment and is updated as the Pool Tiers change;
  - `postRecovery`, with `unrestoredCharges()`;
  - `recordValuationEvent`.

  The VALUATION_PENDING Suspension needs a recorded event first.
- **Redemptions.** `receiver` must be the Holder's own account for `redeem`, `withdraw`, `redeemOrQueue` and `requestWithdrawal`.
- **Register views.** Show `legend()` on the Earn page and the statements. After the Base Sepolia upgrade, call `setLegend` with IV-02 §8.4's text (deploy 22 does it for a new pool).
- **Restart.** Show `leftover()` while a restart leftover is being recognized.
- **EarnControls.**
  - Grant `LADDER_ROLE` ×2.
  - The Ladder console calls `scheduleRung`, publishes `RungScheduled`, then calls `applyRung` after 48 hours.
  - Quotes record their time, for `rungAt`.
- **Indexing.** New events: `InterestBilled`, `InterestCapitalized`, `LeftoverSetAside`, `RecoveryPosted`, `ValuationEventRecorded`, `ValuationEventCleared`, `PoolTierPrincipalPosted`, `LegendScheduled`, `LegendSet`, `RungScheduled`.
- **The upgrade call on Base Sepolia,** through the Earn timelock:
  1. deploy the ledger, then the valuation module;
  2. `upgradeToAndCall(impl, initializeYieldPool(...))`;
  3. `setLegend`;
  4. two-person `postPoolTierPrincipal`.
