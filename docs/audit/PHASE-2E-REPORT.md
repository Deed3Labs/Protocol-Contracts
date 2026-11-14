# Phase 2e report: calendar cycles, Secured Minimum, Automatic Clearing, revolving default notice, Combined Ceiling, fee leg (and pledged bonds)

Branch `audit/phase-2e-calendar-cycles`, cut from `dev` with Phase 2d (#893) merged. The brief is Addendum 2 (`specs/addendum-2.md`, the founder's answers A–G binding), its references (`specs/addendum-2-references.md`) and items 1, 2, 3 and 7 of `PHASE-4B-OPEN-DECISIONS.md`. The bond half (the Earn addendum) was built on `audit/phase-2e-pledged-bonds`; its write-up is `PHASE-2E-BONDS.md` once merged. This report covers the credit half.

Nothing was deployed, no key was used, and no live network was touched. ESADepositVault and ClaimEscrow are not changed.

## Summary

- Every credit item is built, with acceptance tests 39–48, the amended tests 1, 3, 18, 25 and 28, and regressions for the four Phase 4c items.
- **No new conflict** with an earlier decision, a "Do NOT change" item, an audit finding or live storage that the founder's answers A–G leave open. The overrides used are the ones the answers grant: A (calendar months), B (the cure-notice timestamp replaces Phase 2b decision #4), C (term list carry), D (the Combined Ceiling replaces DECISIONS #7's switch and pro-rata design) and E (the third leg of the mint). Section 4 lists the judgement calls and two gaps worth the owner's attention (12.13's `graceCycle`, and 12.14's notice for secured term plans, neither built before nor in scope here).
- **Admin powers only narrow.** No role can set a cycle end, a due amount, a pause, a default or `autoClear`. Six credit-period setters now revert on the revolving line, the Combined Ceiling cannot be switched off, and the fee recipient takes two people.
- **Sizes, storage, Slither, generated files:** section 5.

## 1. What changed, per item

### §3 Accrual

- **Revolving carry** is unchanged in shape: per second at monthly × 12 / 365 against RateSchedule's accumulators. What changed is the cycle it is judged on (12.1) and the ceiling (12.3).
- **"No day more than 1/30 of the cap, no 30 days more than the cap."** Every cap accrues per second at monthly × 12 / 365, so a day is 12/365 of the cap (under 1/30) and 30 days are 360/365 of it. Acceptance 25 (amended) and 41 check both.
- **Term plans (decision C).** `RateSchedule.termChargeFor` now charges the list rate per 30-day cycle (the list accumulator × 365/360) and trims it to the **per-second-fitted** cap on the plan's principal, which is no longer scaled up by 365/360. So $940 in 4 at 2% still carries $47.47 (acceptance 5 unchanged, and passing), and no plan is charged above the per-second cap. `termRateOf` (the L-G effective rate) follows: the list rate per month (× 365/360), capped at the monthly cap.
- `deploy/config/rate-schedule.json`: Boost's list rate is 250 bps (amended test 1: "2.5%, was 3%").

### 12.1 Cycles and timing

- **`PacificCalendar`** (`contracts/libraries/PacificCalendar.sol`, internal and pure): Hinnant's civil-date algorithms, and US Pacific time (UTC−7 from 02:00 on the second Sunday in March to 02:00 on the first Sunday in November, UTC−8 otherwise). A cycle ends at 23:59:59 Pacific on the Cycle End Day.
- **`openLine(member, capacities, cycleEndDay)`** (the third argument replaces `periodLength`/`graceLength`). 0 takes the default: the day before the opening day, or 28 for the 29th–31st and the 1st. The first cycle ends on the first Cycle End Day at least 14 days after opening. `openLine` refuses a member with a live line, so no role can restart a clock.
- **No role can write or move a cycle end.** On RevolvingIssuer, `updateCreditPeriod`, `setPeriodExpirationOf`, `setGraceLengthOf`, `pausePeriodOf`, `unpausePeriodOf` and `initializeCreditLine` revert `RevolvingIssuerCyclesComputed`. The credit period now mirrors the calendar: `expiration` is the running cycle end (or the frozen due point after a second miss), `graceLength` 0.
- **The member's change** (`setCycleEndDayWithSignature`, EIP-712 `CycleEndDay(address member,uint8 day,uint256 nonce,uint256 deadline)`), at most once per rolling 365 days. The running cycle ends on the first new Cycle End Day on or after its existing end.
- **At each cycle end** (`RevolvingIssuerCycles.judgeCycle`, run lazily on the next touch or by anyone through `syncCreditPeriod`): the dues of the cycle that closed at the previous end are judged, Income Assurance falls by one, and the cycle closes:
  - **Rebalance Amount** = the unsecured revolving balance (income-backed and Boost, materialised carry included) at the close;
  - **Secured Minimum** = asset-backed carry accrued in the cycle, plus — with no unsecured principal out at the close — `securedMinimumBps` (100) of savings- and asset-backed principal, at least $1 or the secured principal if less. A raise binds only cycles closing 45 days or more after it (`setDueTerms`).
- **Payments** (every reduction of a tier, `_repayTier`) count toward `paidSinceClose`. A cycle is a miss only if the payments since its close are short of the Rebalance Amount at its due point.
- **A missed Secured Minimum is never a miss.** It sets the computed `securedPastDue`: new savings- and asset-backed draws skip those tiers (unsecured draws go on) until the payments since that close reach Rebalance Amount + Secured Minimum. The payment that reaches it lifts the pause in the same transaction. There is no setter.
- **hybridMode** (member-set, default false) only stops Automatic Clearing; nothing in the cycle code reads it.
- Views: `cycleStateOf`, `duesOf` (unpaid Rebalance Amount, unpaid Secured Minimum, paused), `dueTermsOf`.

### 12.2 Automatic Clearing

- **Levels** (`autoClearScopeOf`): 0 `UNSECURED` (default; was UNSECURED_ONLY), 1 `EVERYTHING` (was ALL, same value), 2 `DUE_ONLY` (new). UNSECURED and DUE_ONLY also clear any unpaid Secured Minimum from the secured tiers.
- **Set-up at line opening.** "Approve automatic clearing" is the member's EIP-712 `AutoClear(address member,bool on,uint8 level,bytes32 authHash,uint256 nonce,uint256 deadline)`: it sets the switch and records `autoClearAuthHash`. Turning it on needs the hash. "Turn off" signs nothing. Only the member changes it: their own call or their signature. The governed `autoClearOffGlobal` is no longer read; only hybridMode switches clearing off besides the member.
- **Excluded payers.** `repayForMember(ref, member, amount, payer)` names the deposit's originator. Federal benefit payers are on a governed, add-only default list (`addDefaultExcludedPayer`); only the member's EIP-712 `PayerExclusion` removes one (`setPayerExclusionWithSignature`). A sweep that names no payer is refused.
- **Ledger order (off chain).** Each deposit posts to Spendable first; the clearing is a separate debit after posting and before availability. The settler delivers the cash, so Ready to allocate USDC and CLRUSD are never swept (amended 25).

### 12.3 Combined Ceiling

- **One loan, permanently.** The unsecured revolving tiers and every term plan opened under the ceiling product's large-loan threshold ($2,500) share one ceiling: the graduated schedule on their combined principal (bands only: never the flat alternative or the annual rate, "1% a month on every dollar above $1,650").
- **Priority.** The revolving tiers keep their carry: they are held to the graduated schedule on their own principal, Boost trimmed first (`_pendingCarry` now uses `RateSchedule.graduatedSince`), so the ceiling never needs to trim them further. The plans share the rest oldest first (`RateSchedule.combinedTrim`), so the excess comes off the newest plan first, then earlier ones. Clear Cash of $2,500 or more is outside it.
- **Units (decision C).** A plan's monthly figure is its carry per 30-day cycle at its list rate (after its own cap); the revolving tiers' is their monthly carry; the ceiling is the monthly graduated charge. A plan the ceiling trims accrues its allowance per second at monthly × 12 / 365, like every cap. So the figures of acceptance 43 hold exactly as monthly figures ($20.00 + $13.875 = $33.875), and over a 30-day cycle the trimmed plan accrues $13.875 × 360/365.
- **Exactness across two contracts.** All of a member's plans are brought to now together (`TermIssuer.materialiseMember`), and RevolvingIssuer calls it before it changes the member's unsecured principal, so the shares hold over every stretch they are applied to. Each side is wired once (`TermIssuer.setCombinedCeiling`, `RevolvingIssuer.setTermIssuer`); `RateSchedule.setCflAggregation` is removed; `capFor` no longer takes a pro-rata share. `combinedPlanCarryOf(member)` reads the figures.
- **L-G** follows it: a trimmed plan's effective rate is its allowance, so it is repaid after the tiers it gives way to.

### 12.5 and 10b: revolving default, computed and fail closed

- `inDefault(member)` (the name and signature the Liquidator and the bond half read) is true only when: two consecutive missed Rebalance Amounts; a cure-notice timestamp recorded for the second; that amount still unpaid; and the grace over — the later of `cureWindow` (15 days) after the second due point and 864,000 s (fixed) after the timestamp. Never while Income Assurance runs.
- **The timestamp** takes two `CREDIT_ATTESTER_ROLE` holders: `proposeCureNotice` then `approveCureNotice` by a different one. The recorded time is the approval's block time. It can be recorded only while the amount is unpaid (`cureAmount`), and a payment of it cancels it (`CureNoticeCancelled`).
- **The trigger.** `triggerDefault(member)` (anyone) records a computed default and reverts `RevolvingIssuerNotInDefault` otherwise; `syncCreditPeriod` records one too but never reverts. The Liquidator's `_requireCurrentDefault` is unchanged and reads the same view. Carry to the moment of default is materialised first, so the write-off reaches all of it.
- After the second miss the line is frozen (new draws refused) until the amount is paid; the calendar keeps running.
- **Collateral never cures.** A settlement out of pledged collateral (`settleFromCollateral`: liquidation, `settleExcess`, a member's own `settleFromSavings`) reduces the debt and counts toward the cycle's dues, but not toward the cure amount: enforcement cannot undo the default it enforces.
- This replaces Phase 2b decision #4 (the chain-dated notice). Secured term plans stay on TermIssuer's default as built (`declareDefault`).
- **Consequence to note:** only unsecured debt can be missed, so a member whose only revolving debt is savings- or asset-backed never defaults on the revolving line; an unpaid Secured Minimum only pauses secured draws. Their collateral is reachable through an unsecured default, or for Earn through the 12.8 shortfall rule.

### 12.12 Permissions

Documentation and app notes: the Automatic Clearing authorization is its own screen at line opening, revocable any time and listed on the Permissions page; the onboarding line is notice only, sets nothing and is never a required permission (`docs/protocol/credit.md`; app follow-ups in section 6).

### 12.13 Income Assurance

`incomePause` did not exist on chain; it is built minimally here because 12.13's amendment needs it. Two `CREDIT_ATTESTER_ROLE` holders set it (`proposeIncomePause`, `approveIncomePause`), at most `incomePauseMaxCycles` (3); a second attestation can only lengthen it; the member ends it early (`endIncomePause`); it falls by one at each cycle end. While it is above zero: no Rebalance Amount or Secured Minimum is due, no miss is recorded, no `securedDrawPause` arises, and no default can be computed. A paused cycle also breaks a run of misses. `graceCycle` (Cycle Assurance) is not built (section 4).

### 12.16 The origination fee leg (decision E)

- Only the third leg changes. `fee = min(discountBpsBySplit[split] × amount, cap)`, the cap $50 up to $2,500 and $75 above (`setFeeTerms`, governed; unset fields mean the initial figures). The merchant is paid the amount less the fee; the member is never charged it; the legs net to zero (StableCredit asserts it).
- The fee goes to `feeRecipient`, never the co-op: the co-op's treasury (`carryTreasury`) and zero are refused, and a plan with a fee will not open while no recipient is named (there is no fallback to the co-op any more).
- **Changing it** takes two `CREDIT_SETTINGS_ROLE` holders and a reason code: `proposeFeeRecipient(recipient, reasonCode)`, then `approveFeeRecipient` by a different one, which emits `FeeRecipientChanged(previous, recipient, reasonCode, proposer, approver)`. The single-signer `setFeeRecipient` is gone. It applies to later charges only: each plan records where its fee went (`PlanPricing.feeTo`).
- **Refunds and reversals** reverse the fee pro rata from that recorded address (`_feeFrom(planId)`); plans from before Phase 2e reverse from the old fallback, as before.
- `scripts/configure-carry-recipients.mjs` no longer names the co-op as fee recipient; it reports only.

### §13 addition: Hardship Grants

`AssurancePool.releaseAssurance` already pays from MEMBER_ASSURANCE only, to the disbursement address, under two signers, and never falls back to another compartment. No function is added; the NatSpec now says it also pays Hardship Grants (MB-10 Schedule 5), and a test shows a grant above Member Assurance reverts with the Credit Backstop full and untouched.

### Phase 4c items folded in

1. **Per-member daily card cap.** `setDueTerms(..., cardMemberDailyCap, ...)` (`CREDIT_SETTINGS_ROLE`); `settleCardSpend` counts each member's settlements per UTC day against it.
2. **The card follows the current line.** `authorizeCardSpend` and `settleCardSpend` read `hasDefaultedOnCurrentLine` (and the computed default), not `hasDefaulted`.
3. **`openLine` waits for an earlier default's collateral.** It reverts `RevolvingIssuerDefaultCollateralUnapplied` while the last line's default left a secured tier owing and the registry values a pledge behind it.
7. **Issuer-internal repayments in effective-rate order.** `repayCardSpend`, `reverseCardSpend` and Automatic Clearing clear tiers dearest first by `_effectiveRates` (after the caps), the ledger's band-walk order.

A new line also starts a fresh cycle record (misses, a halved ceiling and streaks of an earlier line do not carry over).

### TermIssuer NatSpec

"the ELPA that buys a home" is removed: TermIssuer issues partner credit and Clear Cash; the ELPA is an off-chain equity contract right, not a term plan.

### Module split (sizes)

RevolvingIssuer gains a third delegatecall module, **`RevolvingIssuerTerms`** (Addendum 2's functions and views, and the settings setters moved out of the main contract for room), pinned at construction like the others (`deploy/issuerModules.ts`). Its views run through a static self-call (`_forwardView` → `delegateView`, callable only by the issuer itself with that module as target). Base's public views moved to the main contract, and the modules bring carry to now through the issuer's own `materialiseCarry`, so the accrual code lives in one place. TermIssuer's settings setters moved to TermIssuerOrigination. Module kinds: `RevolvingIssuerExtension.v3`, `RevolvingIssuerCycles.v2`, `RevolvingIssuerTerms.v1`.

## 2. Tests

RESULTS_PLACEHOLDER

## 3. ABI changes callers must follow

| Old | New |
|---|---|
| `openLine(address,uint256[],uint256,uint256)` | `openLine(address,uint256[],uint8 cycleEndDay)` |
| `repayForMember(bytes32,address,uint256)` | `repayForMember(bytes32,address,uint256,bytes32 payer)` |
| `setAutoClear(bool,uint8)`, `setAutoClearWithSignature(address,bool,uint8,uint256,bytes)` | with `bytes32 authHash` after the level; the typed data gains `authHash` and renames `scope` to `level` |
| `TermIssuer.setFeeRecipient(address)` | `proposeFeeRecipient(address,bytes32)` + `approveFeeRecipient(address,bytes32)` |
| `RateSchedule.setCflAggregation`, `cflAggregationOff()` | removed |
| `RateSchedule.revolvingRatesOf(address,...)` | the `member` argument is dropped |
| RevolvingIssuer period setters | revert `RevolvingIssuerCyclesComputed` |
| RevolvingIssuer constructor `(extension, cycles)` | `(extension, cycles, terms)` |

New: `triggerDefault`, `setCycleEndDayWithSignature`, `proposeCureNotice`/`approveCureNotice`, `proposeIncomePause`/`approveIncomePause`/`endIncomePause`, `setHybridMode`, `setPayerExclusionWithSignature`, `addDefaultExcludedPayer`, `setDueTerms`, `setTermIssuer`, `cycleStateOf`, `dueTermsOf`, `duesOf`, `isPayerExcluded`, `combinedInputsOf`; on TermIssuer `materialiseMember`, `combinedPlanCarryOf`, `setFeeTerms`, `feeTermsOf`, `feeRecipientProposalOf`, `setCombinedCeiling`. The default views (`inDefault`, `hasDefaulted`, `hasDefaultedOnCurrentLine`, `defaultedAt`, `missedInRowOf`, `unsecuredExcessOf`) keep their names and signatures.

## 4. Judgement calls, gaps and conflicts

**No new conflict** needing the owner. The calls made, each small and recorded:

1. **Test 43's units.** The spec's figures are monthly. Under decision C a plan the ceiling leaves alone carries its list rate per 30-day cycle and a trimmed plan accrues its allowance per second, so over a 30-day cycle the newer plan is $13.875 × 360/365 ($13.69), not $13.875. Total carry over any 30 days stays under the monthly cap, and no day exceeds a thirtieth of it. The tests assert the monthly figures exactly and the 30-day accruals with that factor.
2. **The Combined Ceiling is the graduated bands only** (no flat alternative, no annual rate above $2,500), as the spec's parenthetical says. The revolving tiers' own ceiling moved to the same graduated-only figure, which can only lower a charge, so the revolving tiers never have to give way to a plan.
3. **Rebalance Amount is the materialised unsecured balance at processing.** Cycles are judged lazily; carry accrued between a cycle end and the touch that judges it is counted in the next cycle (member-favourable). A keeper should sync each line at each cycle end, as Phase 2b already recommended.
4. **Payments count toward every open figure at once.** "Payments since close" is measured from each figure's own close, so one payment can meet a past-due Secured Minimum and the current cycle's dues together; what clears everything is the largest open figure (`_dues`). DUE_ONLY clears exactly that.
5. **Collateral settlements never cure a default** (section 1, 12.5). A member's own `settleFromSavings` goes through the same issuer function and is treated the same; the member can still cure in cash. If the owner wants a member-instructed settlement to count as a cure, the Liquidator would pass a flag (Liquidator room is the bond half's to spend).
6. **A paused (Income Assurance) cycle resets the run of misses**, so a miss after it is not "consecutive" with one before it.
7. **864,000 s is a constant**; `cureWindow` (15 days) stays governed as in Phase 2b. The 10 days are MB-05 6.4's minimum.
8. **`securedMinimumBps` from 0 is a raise.** The first `setDueTerms(100, ...)` binds cycles closing 45 days on (the deploy test checks `raisedBps`).
9. **Unknown payers are excluded.** A sweep that names no payer is refused rather than assumed not to be a benefit payer.
10. **`autoClearOffGlobal` is ignored**, not removed (it is a field of `CreditTerms`, whose ABI deploy and tests use). Only hybridMode and the member switch clearing off (12.2: "only hybridMode switches it off").
11. **Legacy lines** (opened before this upgrade, Base Sepolia only) are put on the calendar at their first judgement, never ending before the period they had. A legacy period left paused stays unjudged until touched by a draw; `pausePeriodOf` can no longer set one.
12. **Fee cap defaults.** Unset fee-cap fields mean $50 / $75 / $2,500 in 6-decimal units, so a deployment that forgets `setFeeTerms` is still capped.

**Gaps outside this scope, for the owner:**

- **12.13 `graceCycle` (Cycle Assurance) and the MB-10 eligibility attestation are not built** on any branch. Only `incomePause` is, because the 12.13 amendment needs it.
- **12.14 (the 60-day, notice-dated default of a secured term plan) is not built.** TermIssuer's default is still `declareDefault` after `DEFAULT_AFTER_INSTALLMENTS`. The brief says "keep secured term plans on 12.14 as built"; as built is TermIssuer's own rule, which this phase does not touch.

## 5. Checks

CHECKS_PLACEHOLDER

## 6. App and API follow-ups

Nothing under `apps/` was changed. Needed before this is deployed:

- **Line opening** (`apps/api/src/services/chain/creditLineService.ts`): `openLine(member, capacities, cycleEndDay)`; the member chooses the Cycle End Day (1–28) at opening, else the default applies.
- **"Automatic clearing" screen**, separate from onboarding, shown ON: "Approve automatic clearing" collects the member's `AutoClear` signature with the level and the hash of the approved text (a copy goes to the member), submitted with `setAutoClearWithSignature`; "Turn off" signs nothing. The onboarding line is notice only and is not listed among required permissions. The Permissions page lists the authorization and lets the member revoke it (`setAutoClear(false, level, 0x0)`).
- **Excluded-payer UI**: show the default federal-benefit exclusions and let the member remove one by signature (`PayerExclusion`); seed `defaultExcludedPayers` in `deploy/config/credit-terms.json` with the bank's originator ids. The settler names the payer on every `repayForMember`.
- **hybridMode** toggle; Autopay limited to the Payment Due Date while it is on (off chain).
- **Cycle-day change**: a signature flow (`CycleEndDay`), at most once per 365 days; show the new first due date (never earlier).
- **Secured Minimum display**: Rebalance Amount, Secured Minimum and the pause from `duesOf`; explain that an unpaid Secured Minimum only pauses secured draws.
- **Cure-notice two-person tooling** for ops (`proposeCureNotice` / `approveCureNotice`, two `CREDIT_ATTESTER_ROLE` keys), and the letter sent with it; the same keys attest Income Assurance.
- **Keeper**: sync each revolving line at each cycle end (`syncCreditPeriod`), and call `triggerDefault` only when `inDefault` is true.
- **Fee recipient**: name Clear Lending's recipient by two signers (`FEE_RECIPIENT` in `deploy/25`), then plans with a fee can open; update any dashboard that showed the discount as co-op income.
- **Generated ABIs** follow the contracts; the command app's fingerprints are regenerated.
