# Phase 2e report: calendar cycles, Secured Minimum, Automatic Clearing, revolving default notice, Combined Ceiling, fee leg, pledged bonds

Branch `audit/phase-2e-calendar-cycles`, cut from `dev` with Phase 2d (#893) merged. The brief is Addendum 2 (`specs/addendum-2.md`, the founder's answers A–G binding), its references (`specs/addendum-2-references.md`) and items 1, 2, 3 and 7 of `PHASE-4B-OPEN-DECISIONS.md`. The bond half (the Earn addendum, founder answer G, with IV-01 §4.9 and MB-05) was built on `audit/phase-2e-pledged-bonds` and merged in at e058208a (a merge commit, no conflicts). Its write-up is folded in here as section 2 and the bond parts of sections 3 to 7.

Nothing was deployed, no key was used, and no live network was touched. ESADepositVault and ClaimEscrow are not changed.

## Summary

- Every credit item is built, with acceptance tests 39–48, the amended tests 1, 3, 18, 25 and 28, and regressions for the four Phase 4c items.
- **No new conflict** with an earlier decision, a "Do NOT change" item, an audit finding or live storage that the founder's answers A–G leave open. The overrides used are the ones the answers grant: A (calendar months), B (the cure-notice timestamp replaces Phase 2b decision #4), C (term list carry), D (the Combined Ceiling replaces DECISIONS #7's switch and pro-rata design) and E (the third leg of the mint). The two gaps the first draft listed are built too, at the owner's request: 12.13's `graceCycle` (Cycle Assurance) and 12.14's default of a secured term plan. Section 5 lists the judgement calls.
- **The bond half** (section 2): a pledged bond is no longer taken and redeemed by the Liquidator. It is paid under its own pledge payment term (`payPledged`), and at maturity `settle` splits it under the Holder's Maturity Instruction. Advance rates (95% / 70%) and the instruction hash are stored per pledge. A missed cycle takes pool shares only, and a short vault records the split's remainders for `completeSettlement` (owner decisions).
- **Admin powers only narrow**, with one small widening on the bond side: `Liquidator.applyMaturityInstruction` also accepts the collection's own vault (section 5). No role can set a cycle end, a due amount, a pause, a default or `autoClear`. Six credit-period setters now revert on the revolving line, the Combined Ceiling cannot be switched off, and the fee recipient takes two people.
- **Sizes, storage, Slither, generated files:** section 6.

## 1. What changed: the credit half

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
- This replaces Phase 2b decision #4 (the chain-dated notice). A term plan secured under MB-05 follows 12.14 (below), and unsecured plans keep TermIssuer's `declareDefault`.
- **Consequence to note:** only unsecured debt can be missed, so a member whose only revolving debt is savings- or asset-backed never defaults on the revolving line; an unpaid Secured Minimum only pauses secured draws. Their collateral is reachable through an unsecured default, or for Earn through the 12.8 shortfall rule.

### 12.12 Permissions

Documentation and app notes: the Automatic Clearing authorization is its own screen at line opening, revocable any time and listed on the Permissions page; the onboarding line is notice only, sets nothing and is never a required permission (`docs/protocol/credit.md`; app follow-ups in section 7).

### 12.13 Income Assurance and Cycle Assurance

Neither flag raises a drawn amount, moves funds, charges a fee, or causes a miss, a settlement or a default. Both are set only by an MB-10 attestation of two `CREDIT_ATTESTER_ROLE` holders (propose, then approve by a different one), and both can only give relief.

- **`incomePause` (Income Assurance)** did not exist on chain before this phase. It is set by `proposeIncomePause` and `approveIncomePause`, at most `incomePauseMaxCycles` (3). A second attestation can only lengthen it. It falls by one at each cycle end, and only that expiry or the member (`endIncomePause`, which acts on the caller's own line) ends it early: no role can. While it is above zero, no Rebalance Amount or Secured Minimum is due, no miss is recorded, no `securedDrawPause` arises, and no default can be computed. A paused cycle also breaks a run of misses.
- **`graceCycle` (Cycle Assurance).** Eligibility is set by `proposeGraceEligibility` and `approveGraceEligibility`. It can only be enabled: no function withdraws it, and none spends a grace. At a due point where an eligible member's Rebalance Amount is unpaid, a grace is used automatically (`GraceCycleUsed`), if one is left in the rolling window. There is no halving, nothing settles, the cycle does not count toward default (`missedInRow` stays as it was), and the clean streak resets. The window is at most `graceCyclesPerWindow` (1) per `graceWindow` (365 days), both governed (`setGraceTerms`, `CREDIT_SETTINGS_ROLE`, at most 4 per window as a gas bound; zero means the initial figure). Uses are counted by due point: the last four are kept in `cycleStateOf(member).graceUses`. Once the window's graces are used, an unpaid cycle is an ordinary miss. While Income Assurance runs nothing is due, so no grace is used.

### 12.14 Default of a term plan secured under MB-05

- **Which plans.** A plan is secured once the member signs `SecurePlan(uint256 planId,uint256 nonce,uint256 deadline)` (EIP-712, domain "Clear TermIssuer" v1; `securePlanWithSignature`). No role can secure a plan or undo it. From then on the plan defaults only under 12.14, never under the installment rule (`defaultableAt` is 0 for it, and `declareDefault` neither counts nor writes it off).
- **Default needs all of these** (`declarePlanDefault(planId)`; anyone may call it, and it reverts `TermIssuerNotDefaultable` otherwise):
  1. a scheduled payment at least 60 days past due, measured from its due date (`delinquentSince`);
  2. a cure-notice timestamp recorded for it by two `CREDIT_ATTESTER_ROLE` holders (`proposePlanNotice`, then `approvePlanNotice` by a different one). The recorded time is the approval's block time, and it can be recorded only while a payment is past due;
  3. 30 days since the timestamp; and
  4. the past-due amount still unpaid. The notice records what the schedule asked for by then; once the plan's repayments reach it, the notice no longer counts, and a later arrears needs its own notice.
- **Fails closed.** With no timestamp there is no default. The trigger reads the Liquidation Hold (12.6) from `holdSource`, the Liquidator, which is set once (`setHoldSource`; `deploy/25` names the Liquidator when it is deployed). It reverts `TermIssuerOnHold` while a hold is active, and also when no hold source is named or the read fails.
- **What it does.** It records the default (`securedPlans(planId).defaultedAt`, `defaultedAt[member]`), sets the term limit to 0 and suspends term credit. It writes nothing off and moves nothing: the plan stays owed. `hasDefaultedOnCurrentLine(member)` on TermIssuer (new there) is true while a defaulted secured plan is open.
- **Enforcement: a pledged bond pays the plan.** Once a default is recorded, the member's pledged bond becomes payable through `payPledged`. The Liquidator's `pledgePaymentDue` counts a trusted term issuer (one with no tiers) under 12.14 only. The need is what the member's open plans with a recorded 12.14 default owe (`owedOn`), and the requested bond is chosen as for any default (the smallest that covers it, else the largest). `applyPledgePayment` pays those plans, oldest first, with `payPlan` from the bond's proceeds, and sends any surplus to the Holder. The Liquidation Hold stops it, both in `pledgePaymentDue` and again in `applyPledgePayment`. No unsecured plan, revolving tier, CLRUSD or Savings is touched.
- **The trust.** `deploy/25` trusts TermIssuer on the Liquidator, through the operator's existing `setTrustedSavingsIssuer` switch. To keep that trust to this one path, every tier path now refuses a trusted issuer that has no tiers: `liquidate`, `settleFromSavings`, `settleExcess`, `noticeShortfall` and `settleShortfall` all go through `_requireTrusted`. So trusting TermIssuer opens no CLRUSD, Savings or pool-share enforcement, which a test checks. `maturityToDebt` and `applyMaturityInstruction` already skipped tierless issuers. The operator's `liquidateShares` and `settleRealized` (which never checked trust) read or settle a tier on the issuer, which TermIssuer does not have, so they revert before anything moves; a test checks `liquidateShares` with the default recorded. The Liquidator grows by 865 bytes, to 23,817 (759 bytes of headroom).
- **Not wired: pool shares.** 12.14 also names pool shares pledged to secure plans, by queued redemption. The Liquidator's pool-share paths settle tiers only, and a term issuer has none, so a secured-plan default does not reach pool shares. Pool-share pledges back the `POOL_SHARE` tier, and on-chain records do not tie any pledge to a plan, so routing them would need a decision on which pledges secure plans. Recorded as a Phase 2f item (section 5).
- **`inDefault` on TermIssuer is unchanged** (the inherited period rule). A 12.14 default exists only once recorded, so the Hold check cannot be bypassed through a view.
- **Unsecured plans keep the rule as built** (owner's decision): `declareDefault` once a plan is `DEFAULT_AFTER_INSTALLMENTS` (2) installments behind, writing off the unsecured plans' principal. A member holding both kinds keeps the secured plans open and owed when the unsecured ones are written off.
- **No on-chain hardship plan exists**, so only payment of the past-due amount cancels a notice. A re-split (`resplitWithSignature`) does not cancel it; if the owner wants a hardship re-split to count, it would clear `noticeAt` there.

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

## 2. What changed: the bond half (pledged bonds)

**Answer G, in one line:** a pledged bond is no longer taken and redeemed by the Liquidator. It is paid under its own pledge payment term (`payPledged`). At maturity, `settle` splits it under the Holder's Maturity Instruction.

| Item | Status | Where |
|---|---|---|
| §1 allowlist (a): a bond burns only on settlement, buyback, `payPledged` or `redeemAll` | Done for what exists. A bond burns only in `redeemBond`/`batchRedeemBonds`, `settle`, `payPledged` and `rollBond` (a roll is a settlement into a new bond). `redeemEarly` is gone, and no function takes a bond to burn elsewhere. A test pins the full list of state-changing functions. `buyback` and `redeemAll` are Phase 2f's. | `BurnerBondBase._retire`, `BurnerBond`, `BurnerBondPledges` |
| §4 `payPledged(id)` (IV-01 §4.9) | Done | `BurnerBondPledges.payPledged`, `Liquidator.pledgePaymentDue` / `applyPledgePayment`, `BondVault.settleEarly` |
| §4 `settle(id)`, pledged bond that does not roll | Done (with the owner's decision on a short vault, section 5) | `BurnerBondPledges.settle`, `Liquidator.maturityToDebt` / `applyMaturityInstruction`, `BondVault.settlePledged` / `completeSettlement` |
| §9 advance rates stored per pledge (95% of Present Value, 70% of Pool Share Value) | Done | `CollateralRegistry` (`itemAdvanceBpsOf`, `advanceBpsOf`, `advancedValueOf`), `LimitCalculator.capacityOf`, `Liquidator` gaps |
| §9 a bond pledge needs the Holder's signature over the Maturity Instruction, hash stored | Done | `CollateralRegistry.pledgeItem`, `PLEDGE_ITEM_TYPEHASH`, `maturityInstructionOf` |
| §9 pledged positions exit only through MB-05 | Done for bonds (no transfer, no `redeemBond`, no seize: only `settle` and `payPledged`). The pool-share path is unchanged. | `BurnerBondBase._beforeTokenTransfer`, `BurnerBond._redeem` |
| Liquidator: remove the bond seize-and-redeem path | Done. `IEarnBonds.seizeBond`/`redeemEarly`, `_realizeBonds`, `_redeemBond`, `mayTakeBond`, `onERC1155Received` are gone. So are the bond legs of `settleExcess` and `settleShortfall`. The pool-share paths are unchanged except that gaps use stored rates. | `Liquidator` |
| Earn tests 18 and 19, regressions | Done: `test/audit/compliance/PledgedBonds.spec.ts` (21 tests) | |

#### BurnerBond: a module split

BurnerBond had 408 bytes of headroom, and the factory carries its creation code (46,956 of 49,152). So the bond is now in three parts:

- **`BurnerBondBase`**: the storage, the shared internals (`_presentValue`, `_isPledged`, `_retire`), and the transfer hook.
- **`BurnerBond`**: unchanged in what it does, apart from the items below.
- **`BurnerBondPledges`**: a delegatecall module where `payPledged` and `settle` run.

The module follows the issuer pattern. The implementation's constructor takes its address, checks `extensionKind() == keccak256("BurnerBondPledges.v1")`, and pins it as an immutable. A clone runs its implementation's code, so every collection gets the same module, and no role can swap it. `BurnerBondFactory` takes the module as a third constructor argument. `deploy/bondModules.ts` (`deployBondFactory`, `deployBondPledges`) deploys it for scripts and tests.

BurnerBond is a clone, not upgradeable, so its storage could be reshaped. It drops `defaultSource` and `settlementGate`, and adds `holderOf` (who holds each bond, kept by the transfer hook), because `payPledged` and `settle` take only an id. Existing collections keep the code they were made with: the Base Sepolia collection, and the legacy one, still have `seizeBond`/`redeemEarly`. A new factory and collection go through `scripts/redeploy_bonds.ts`.

Removed from BurnerBond: `seizeBond`, `redeemEarly`, `setDefaultSource`, `setSettlementGate`, the liquidator's transfer exemption, and `rollBond`'s refusal to roll for the liquidator. Added:

- `accretedValue(id)`, which equals `presentValueOf` (section 5, bond call 4);
- `payPledged(uint256)` and `settle(uint256)`;
- `pledges()`;
- the events `PledgePaid(id, holder, amount, toDebt, toHolder)` and `PledgedMaturitySplit(id, toDebt, toHolder)`;
- the errors `BurnerBondPledged`, `BurnerBondNotPledgePayable` and `BurnerBondNotSettleable`.

`setLiquidator` keeps its 7-day delay (audit M-6). The address it names is now the pledge module's enforcement side.

#### `payPledged(id)`

1. **Who may call it, and when.** Anyone may call it. It reverts unless all of these hold:
   - the bond exists, is unredeemed, and its holder has it pledged in the registry;
   - the collection's `liquidator` (the Liquidator) answers `pledgePaymentDue(holder, id)` with `due`.
1. **What `pledgePaymentDue` checks.** It reads only chain state:
   - the bond is pledged and held;
   - no Liquidation Hold is active;
   - with one of the member's issuers that the Liquidator trusts, either:
     - **(a)** the issuer's computed default holds: `inDefault || hasDefaultedOnCurrentLine`, exactly the views the credit half keeps (its `PHASE-2E-PROGRESS.md` interface note). The need is then the member's debt with that issuer in `BOND`, `POOL_SHARE`, `BOOST` and `INCOME`; or
     - **(b)** a shortfall notice exists and is at least `shortfallWait` old (72 hours or more), and the bond gap is still open. The need is then the bond value whose payment closes the gap.
   - The bond is the one the module requests for that need: the smallest pledged, held bond that covers it, else the largest (MB-05 §7.3(c)).
2. **What it pays.** It pays `accretedValue(id)` in that block, in full: `BondVault.settleEarly` pays the Liquidator exactly that, or reverts. Nothing partial.
3. **Where the money goes.** The Liquidator's `applyPledgePayment` (only `earnBonds` may call it) settles the tiers with `settleFromCollateral`:
   - on a shortfall, the `BOND` tier only;
   - on a default, `BOND`, then `POOL_SHARE`, then `BOOST`, then `INCOME`;
   - never `SAVINGS`.

   It sends the surplus in USDC to the holder, and clears the shortfall notice once both gaps are closed.
4. **The end.** The collection releases the pledge (`CollateralRegistry.releaseRetiredItem`, `ITEM_ROLLER_ROLE`, which the collection already holds for rolls) and the bond burns, all in one transaction.

#### `settle(id)` and the Maturity Instruction

1. **Who may call it, and when.** Anyone, for a matured, unredeemed bond whose holder opted out of rolling. A bond that rolls is rolled by `rollBond`.
2. **An unpledged bond** pays its face value to its holder (`BondVault.settle`), as `redeemBond` does.
3. **A pledged bond is split.** The split is `toDebt = min(face, max(0, drawn − limitWithout))`, from `Liquidator.maturityToDebt`:
   - `drawn` is the holder's `BOND`-tier principal with their trusted issuers;
   - `limitWithout` is `CollateralRegistry.advancedValueOf(holder, BOND, id)`, which values the holder's other pledged bonds at their stored rates.

   `toHolder` is the rest. No argument or role supplies any part of either.
4. **How it is paid.** `BondVault.settlePledged` pays from what the vault and the treasury hold: `toDebt` first, to the Liquidator, then `toHolder` to the holder. It returns the debt part it paid. `applyMaturityInstruction` applies that to the `BOND` tier as the holder's own instruction (MB-05 §7.9), so a Liquidation Hold does not stop it. Anything the tier no longer owes goes to the holder.
5. **If the vault is short, `settle` still runs** (owner decision, section 5). Whatever of either part the vault and the treasury can't pay is recorded against the bond:
   - `pendingSettlement(id)` holds the holder, the pledge module, `debtOwed` and `holderOwed`, and `SettlementShortfall(id, holder, debtOwed, holderOwed)` is emitted;
   - the total is reserved in `requiredReserve` ahead of any deployable excess;
   - anyone can call `completeSettlement(id)`, as often as funds arrive. It pays the rest of `toDebt` first (the vault sends it to the recorded pledge module and calls `applyMaturityInstruction`), then the rest of `toHolder` to the recorded holder.
   - It takes only the id: the amounts and recipients are the ones fixed at settlement. If the holder has repaid the tier in the meantime, the debt part they no longer need goes to them.

   Nothing is locked or held for the holder, and there is no "Pledged Proceeds" state.
5. **The end.** The pledge releases, the bond burns, and `PledgedMaturitySplit(id, toDebt, toHolder)` is emitted.

`redeemBond` refuses a pledged bond (`BurnerBondPledged`): a pledged bond pays out only through `settle`.

#### §9: stored advance rates and the Maturity Instruction

**Item pledges.**
- `pledgeItem(member, kind, itemId, maturityInstruction, deadline, signature)` takes the member's EIP-712 signature over `PledgeItem(address member, bytes32 kind, uint256 itemId, bytes32 maturityInstruction, uint256 nonce, uint256 deadline)`.
- A zero instruction reverts `CollateralRegistryNoMaturityInstruction`.
- The registry stores the hash (`maturityInstructionOf`) and the kind's `haircutBps` at that moment (`itemAdvanceBpsOf`), and emits `ItemPledgeTerms`.
- A roll carries both to the replacement. A release or seizure clears them.

**Amount pledges** (pool shares) store a units-weighted rate (`advanceBpsOf`, `PledgeAdvanceRate`). A pledge made before this upgrade has no stored rate and reads the kind's rate.

**Where the stored rates are used.**
- `CollateralRegistry.advancedValueOf(member, kind, exclude)`, which now gives `LimitCalculator.capacityOf`;
- the Liquidator's gap and closing amount;
- the pool-share lock (`_requiredUnits` for every kind but CLRUSD's);
- the pledged maturity split.

**Not changed.** The CLRUSD lock and savings capacity keep the kind's fixed terms (spec 10a). `exposureOf`, the AssurancePool's measure, keeps the governed kind rate.

`pledgeDigest(member, kind, amount, deadline)` and `pledgeItemDigest(member, kind, itemId, maturityInstruction, deadline)` replace the old `pledgeDigest(…, bool item)`, which nothing called.

#### BondVault (UUPS, Base Sepolia)

- Adds `settlePledged`, `completeSettlement`, and two appended slots: `pendingSettlement` (a mapping to a struct of holder, pledge module, `debtOwed`, `holderOwed`) and `totalSettlementOwed`. The `__gap` goes from 33 to 31.
- `_cover` now runs on `_coverUpTo`.
- `requiredReserve` adds `totalSettlementOwed`.
- `settleEarly` stays. Its only caller is now a collection's `payPledged`, and the legacy collection's `redeemEarly` still needs it.

#### Other callers updated

| File | Change |
|---|---|
| `deploy/10`, `deploy/22`, `deploy/deploy_burner_bonds.ts`, `scripts/redeploy_bonds.ts` | The factory is deployed with its module. `redeploy_bonds.ts` signs the new `PledgeItem`. |
| `deploy/25_wire_Compliance.ts` | No longer calls `setDefaultSource`/`setSettlementGate`. It proposes `setLiquidator(Liquidator)` on the collection, which applies after the delay once bonds exist. |
| `scripts/unwind_legacy_bonds.ts` | Uses an inline ABI for the legacy collection, which still has `seizeBond`/`redeemEarly`. |
| `apps/api/src/services/command/onchain.ts` | Command's bond list closes a bond on `PledgePaid` and `PledgedMaturitySplit` too. |
| `contracts/mocks/MockCollateralSignals.sol` | Adds `isItemPledged`, `setItemPledged` and `releaseRetiredItem`. |

## 3. Tests

- **New:**
  - `test/audit/compliance/Addendum2.spec.ts` (13): acceptance 39, 40, 41, 42, 44 (four cases), 45, 46, and the amended 18, 25 (Automatic Clearing) and 28. It resets the chain per test (`hardhat_reset`), because the spec's dates are absolute; Pacific time is checked against the platform's own time-zone data (`Intl`), not the contract's rule.
  - `test/audit/compliance/Addendum2Term.spec.ts` (5): acceptance 43 (three cases), 47 and 48.
  - `test/audit/compliance/Addendum2Relief.spec.ts` (11), following the references' wording. 12.13: two-signer eligibility that only enables relief and moves nothing; a grace used automatically, at most once per rolling 365 days, with no halving, nothing settled and no count toward default, then available again in a new window; no eligibility means a miss; the governed count and window; Income Assurance that only lengthens and ends only by expiry or the member. 12.14: 60 days past due + notice + 30 days, reverting until then and failing closed without a notice; the 60 days run from the due date; notices only while past due and only for secured plans, cancelled by payment; the Liquidation Hold blocks the trigger; no hold source means no default; a recorded default makes `payPledged` pay a bond the member pledged into the defaulted plan, and nothing before the default is recorded, while trusting TermIssuer opens no tier path; unsecured plans keep the installment rule, and no role can declare a secured plan's default.
  - `test/audit/rereview/Decisions.spec.ts`: Phase 4c items 1, 2, 3 and 7 (5 tests).
  - `test/peripherals/AssurancePool.spec.ts`: the §13 Hardship Grant test.
  - `contracts/mocks/PacificCalendarHarness.sol` for the default-day rules.
- **Amended:** acceptance 1 (`RateSchedule.spec`, Boost at 2.5%), 3 (`Revolving.spec`, 2.5% over a real calendar cycle; the 3% case is kept as the Phase 2 test), 18 and 25 (`Section12Revolving.spec`, and the Addendum 2 versions above), 28 (new above).
- **Existing tests changed, and why** (nothing loosened; each now asserts the Addendum 2 behaviour):
  - `openLine(member, caps, periodLength, graceLength)` → `openLine(member, caps, cycleEndDay)` everywhere (57 call sites, mechanical).
  - Defaults: `test/helpers/default.ts` now drives two missed Rebalance Amounts, records the two-person cure notice and waits out the grace (`driveToDefault`, `driveToSecondMiss`, `recordCureNotice`, `passCycleEnd`). Fixtures whose only debt was savings- or asset-backed (`Dfal`, `ReserveUntouched`, `Section2d`, `Liquidator`, `AssetBackedDefault`, `Decisions` M-C) add $10–$100 of unsecured debt, since a secured-only line can no longer default; the savings and share figures they assert are unchanged. Where that unsecured part is now the lost debt, the tests assert exactly that (`Liquidator.spec`).
  - Cycle tests (`Section12Revolving`, `Section12Liquidator`, `BlindReview` H-C, `AuditPoC` H-2, `RevolvingIssuer.spec`): judged at calendar cycle ends; the first end only closes a cycle. The H-2 operator-setter test now asserts every setter reverts.
  - The fee leg (`TermIssuer.spec`, `PayoutLifecycle.spec`, `DeepPoC` X-3, `DeepPoC2` X-8, `BlindReview` H-A): the third leg is asserted at Clear Lending's fee recipient, and the co-op receives nothing. `test/helpers/plans.ts` names a recipient by two signers before a plan opens (`feeRecipientOf`); `deep-setup` does the same.
  - DECISIONS #7 (`Term.spec`, `Decisions` L-F, `Compliance.deploy`): the switch tests become "the switch is gone" and the Combined Ceiling's figures. `AccrualInvariants` drops the pro-rata share from bounds (a) and (b).
  - `Decisions` L-G across issuers: under the Combined Ceiling the trimmed plan is the cheapest position, so the repayment past Income reaches Boost, not the plan.
- **Full suite:** section 6. Before the merge, the credit half alone ran 1,066 passing and 0 failing in one local process; the bond half alone ran 1,052 passing.

**New (bond half):** `test/audit/compliance/PledgedBonds.spec.ts`, 21 tests.

- **Earn test 18**, with the spec's figures.
  - A qualifying default with debt $500 against an Accreted Value of $950 puts exactly $500 to the debt and $450 to the Holder. The vault pays $950, the Liquidator keeps nothing, the caller gets nothing, the bond burns and its pledge is released.
  - It reverts on an unpledged bond, with no recorded enforcement condition, on a Shortfall at 72 hours less one second, and before the cure date (no computed default).
  - A 72-hour Shortfall pays only the bond tier.
  - Only the requested bond is payable, and none after the need is met.
  - The default order is followed, and Savings is never touched.
  - No call pays less: `payPledged` takes only the id. A vault that cannot pay the whole Accreted Value reverts rather than paying less. Neither the admin nor a stranger can call `settleEarly`, `settlePledged`, `applyPledgePayment` or `applyMaturityInstruction`. A Liquidation Hold stops it.
- **Earn test 19**, with the spec's figures (Maturity Amount $1,000; a second pledged bond with Present Value $500 and Collateral Value $475; auto-roll off).
  - Drawn $1,200: a random caller's `settle` emits `PledgedMaturitySplit(id, 725, 275)`, applies $725 and pays $275 with no lock. The pledge is released and the bond burned.
  - Drawn $400: (0, 1,000).
  - Drawn $1,600: (1,000, 0). The $125 left above the limit gets a `ShortfallNoticed` of $125, and after 72 hours the second bond's `payPledged`.
  - Vault short at $800 (between `toDebt` and the full amount): $725 is still applied, $75 is paid, $200 is recorded for the Holder, and `completeSettlement` pays it later, to the Holder only.
  - Vault at $500, below `toDebt` (owner decision): `settle` still runs, applies $500, burns the bond and releases the pledge, and records $225 of debt and $275 for the Holder. Completions pay $225 to the debt and $75 to the Holder, then $50, then the last $150. The tier, the remainders, the total owed, the burn and the pledge are checked at each step.
  - Vault empty: `settle` records the whole split. A debt the Holder repaid in the meantime sends its part to them on completion.
  - Nobody can redirect a remainder: `completeSettlement` takes only the id, and only the collection or its vault may apply a debt part.
  - No caller changes the split, and lowering the bond rate after pledging changes nothing.
- **§9:** without a Maturity Instruction the pledge reverts; a signature over a different instruction, or by someone else, reverts; 95% and the hash are stored; 70% for pool shares; rates are kept through a governed change; pool rates blend; a roll keeps the terms.
- **§1 (a) and the module:**
  - the exact list of BurnerBond's state-changing functions;
  - the module rejects direct calls;
  - an implementation with a module of the wrong kind cannot be deployed.

**Changed (bond half):**

| File | Change and reason |
|---|---|
| `peripherals/BurnerBond.spec.ts` | The seize/redeem-early tests become tests that the path is gone (no `seizeBond`, `redeemEarly`, `setDefaultSource` or `setSettlementGate` in the ABI, and the selectors revert). Also new: nobody, the liquidator included, can move a pledged bond; `payPledged` refuses an unpledged bond; `settle` pays an opted-out bond to its holder whoever calls; a pledged bond rolls for its holder only. |
| `peripherals/BondCollateral.spec.ts` | A pledged bond does not move even with nothing drawn; it moves once released. Redeeming refuses with `BurnerBondPledged` (was the vault's `BondVaultBondPledged`), and pays once released. "Still lets the co-op take it" becomes "nobody takes it". The valuer's not-held rule is checked directly, because a pledged bond can no longer be moved away to test it. |
| `audit/compliance/Section12Liquidator.spec.ts` | The stack grants the collection `ITEM_ROLLER_ROLE` instead of naming a settlement gate. "Takes pool shares first, then the smallest bond…" becomes "takes pool shares only: a missed cycle never reaches a pledged bond". The shortfall test closes the pool gap with `settleShortfall` and the bond gap with the bond's `payPledged`. The `mayTakeBond` checks are replaced by its absence. |
| `audit/deep/PeripheralRegressions.spec.ts` | The M-6 `seizeBond` test becomes "superseded by answer G: no `seizeBond`, and the liquidator cannot move a pledged bond in default". The liquidator-delay test is kept. |
| `audit/rereview/Decisions.spec.ts` | The L-I item-pledge test passes the instruction hash. |
| `helpers/pledge.ts`, `helpers/bonds.ts` | `PledgeItem` signs `maturityInstruction` (default `MATURITY_INSTRUCTION`). `deployBondFactory` is new. |
| `Assurance`, `ReserveUntouched` and the other factory users | Deploy the factory through `deployBondFactory`. |

## 4. ABI changes callers must follow

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

New: `triggerDefault`, `setCycleEndDayWithSignature`, `proposeCureNotice`/`approveCureNotice`, `proposeIncomePause`/`approveIncomePause`/`endIncomePause`, `setHybridMode`, `setPayerExclusionWithSignature`, `addDefaultExcludedPayer`, `setDueTerms`, `setTermIssuer`, `cycleStateOf`, `dueTermsOf`, `duesOf`, `isPayerExcluded`, `combinedInputsOf`; `proposeGraceEligibility`/`approveGraceEligibility`, `setGraceTerms`; on TermIssuer `materialiseMember`, `combinedPlanCarryOf`, `setFeeTerms`, `feeTermsOf`, `feeRecipientProposalOf`, `setCombinedCeiling`, `securePlanWithSignature`, `proposePlanNotice`/`approvePlanNotice`, `declarePlanDefault`, `setHoldSource`, `holdSource`, `securedPlans`, `hasDefaultedOnCurrentLine`. The default views (`inDefault`, `hasDefaulted`, `hasDefaultedOnCurrentLine`, `defaultedAt`, `missedInRowOf`, `unsecuredExcessOf`) keep their names and signatures.

## 5. Judgement calls and conflicts

**No open conflict.** The bond half's one conflict (a vault that cannot cover `toDebt`) was decided by the owner and built (below). Answer G settles the Phase 2b gate and the 4b/REREVIEW bond decision (M-6's `seizeBond` gate, superseded and removed). Nothing touches ESADepositVault or ClaimEscrow.

**Credit half.** The calls made, each small and recorded:

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

13. **A grace leaves the run of misses as it was.** The cycle is not counted, so a miss before a grace and a miss after it are still consecutive. Only a paid cycle or Income Assurance breaks the run.
14. **Grace eligibility covers `graceCycle` only.** Income Assurance has its own attestation, as 12.13 describes them separately.
15. **A secured plan is chosen by the member's signature**, not by a role, so no role can move a plan out of the installment rule. Any plan may be secured, before or after it falls behind. If the owner wants securing tied to an MB-05 pledge on chain, the pledge module would call it.
16. **A secured default writes nothing off.** 12.14 makes the plan defaultable so the pledged Earn collateral can be applied; the debt stays owed until it is. The term limit is cut to 0 and term credit is suspended, as `declareDefault` does.
17. **The notice records the amount past due when it is approved.** A payment that brings `repaid` to it cancels the notice for good. A later arrears needs a new notice, which waits 30 days again.

**Bond half: owner decisions (Nov 14, 2026)**

1. **A missed cycle takes pool shares only, never bonds** (confirmed). `settleExcess` (12.5) used to take pool shares, then bonds. A missed cycle is neither a default after notice and cure nor a Shortfall, so MB-05 §6.1 does not permit enforcement against a bond. The excess is settled from pool shares only, and what they don't cover stays owed. The 12.12 excess lock in the registry is unchanged; it no longer matters for bonds, which are locked while pledged anyway.
2. **A vault that can't cover `toDebt`: option (b).** `settle` never reverts for lack of funds. What the vault and the treasury hold goes to the debt part first, then to the Holder; both remainders are recorded, and `completeSettlement` (permissionless) pays the rest of `toDebt` first, then `toHolder`. Everything else stays fixed: no role changes or redirects either part, and `toHolder` goes only to the Holder. Why it was needed: in this code `toDebt` is a repayment on the co-op's ledger and has to deliver USDC (`settleFromCollateral` → `repayCreditBalanceFor`), where the Earn spec has it stay in the vault. Until the rest of `toDebt` arrives, the tier stays drawn by that much, and the ordinary Shortfall rules see it.

**Bond half: judgement calls**

1. **The module's order (MB-05 Article 7 is not in the references).**
   - On a default: the bond's own tier, then pool shares' tier, then `BOOST`, then `INCOME`; never `SAVINGS`, which its own collateral covers.
   - On a shortfall: the bond tier only.

   The bond's tier goes first so that tier is not left drawn against a pledge that is gone. That follows the old `_settle` rule. For counsel.
2. **"Asset-Backed" means the bond kind's tier.**
   - This code gives bonds and pool shares separate tiers, each with its own limit (deploy/20). So `drawn` and `limitWithout` in the split are the `BOND` tier and the other pledged bonds. In test 19, which has only bonds, the spec's aggregate gives the same figures.
   - `drawn` is `principalOf`: principal plus materialised carry, not carry accrued since the last touch. So `toDebt` can come out a few units low, which favours the Holder, and what remains falls under the Shortfall rules.
3. **The request rule.**
   - Any caller names an id, so the module requests one specific bond: the smallest that covers the need, else the largest (the old selection rule). Calls repeat until the need is met.
   - On a shortfall, the closing amount uses the member's rate for the kind (the old formula), and a bond's own stored rate may differ slightly. The next call re-measures the gap.
4. **`accretedValue` is `presentValueOf`** (straight-line accretion). Phase 2f replaces the formula with the Earn spec's compounding at the Issue Yield. Both names answer the same figure, so `payPledged` pays exactly the Present Value.
5. **Holds.** A Liquidation Hold stops `payPledged` (enforcement). It does not stop the maturity split, which is the Holder's own instruction.
6. **Releasing an undrawn pledge.** A pledged bond no longer moves at all, even with nothing drawn (§9: pledged positions exit only through MB-05). To move one, the pledge is released first with the operator's `releaseItem`, which still refuses while anything is drawn.
7. **Trust is the same as before.** `pledgePaymentDue` reads only issuers the Liquidator already trusts for `liquidate`. Those are registered by the credit timelock (M-E) and enrolled for the member. The collection's `liquidator` keeps its 7-day delay, and the Liquidator's `earnBonds` is still `DEFAULT_ADMIN_ROLE`'s.
   - No role can trigger, price or redirect `payPledged` or `settle`: the amount is computed inside the bond, the destinations are the holder and that holder's own tiers, and the apply functions accept only the collection (and, for the rest of a recorded `toDebt`, its vault).
   - Two powers are gone: `setDefaultSource` and `setSettlementGate`.
8. **The settlement-shortfall rule** is built only for a pledged bond's split. An unpledged bond's `settle` still reverts when the vault is short, as `redeemBond` always has. Phase 2f brings the general rule.

**The one widening.** `Liquidator.applyMaturityInstruction(member, toDebt)` used to accept only the collection. It now also accepts the collection's own vault (`earnBonds.bondVault()`), which calls it from `completeSettlement` to apply the rest of a debt part recorded at settlement. The vault passes only the holder and the amount fixed in `pendingSettlement`; the function still applies only to that member's `BOND` tier at issuers the Liquidator trusts, and sends anything the tier no longer owes to the member. No role gains a call.

**Between the halves (built after the merge).** A recorded 12.14 default makes `payPledged` pay the member's pledged bond into the defaulted secured plans (section 1, 12.14).

**Phase 2f items** (recorded at the coordinator's direction):

1. **A pledge-to-plan link for bonds.** No pledge is tied to a plan on chain, so any bond the member has pledged can be requested for a defaulted secured plan, as any pledged bond can for a revolving default. 12.14 speaks of collateral "pledged to secure plans"; tying a bond pledge to the plans it secures would narrow that.
2. **Pool shares for a secured-plan default.** The Liquidator's pool-share paths settle tiers only, so a 12.14 default does not reach pool shares. The queued-redemption path would pay plans once the same pledge-to-plan link exists.

## 6. Checks

All at the branch head after the merge and the 12.14 wiring, unless a line says otherwise.

**Sizes** (production build, `npx hardhat compile --force`; EIP-170 24,576 runtime, EIP-3860 49,152 creation). Every contract is within both. The changed ones:

| Contract | Runtime on `dev` | Runtime now | Headroom | Creation now |
|---|---|---|---|---|
| RevolvingIssuerExtension | 22,348 | 24,413 | 163 | 24,550 |
| TermIssuer | 22,325 | 24,009 | 567 | 24,713 |
| Liquidator | 20,380 | 23,817 | 759 | 23,954 |
| TermIssuerOrigination | 17,258 | 23,733 | 843 | 23,870 |
| BurnerBond | 24,168 | 23,294 | 1,282 | 23,721 |
| RevolvingIssuer | 24,138 | 23,110 | 1,466 | 24,115 |
| RevolvingIssuerTerms (new) | — | 23,056 | 1,520 | 23,193 |
| RevolvingIssuerCycles | 19,683 | 22,682 | 1,894 | 22,736 |
| TermIssuerExtension | 23,252 | 22,546 | 2,030 | 22,683 |
| CollateralRegistry | 13,503 | 15,596 | 8,980 | 15,733 |
| BondVault | 10,290 | 11,888 | 12,688 | 12,025 |
| RateSchedule | 10,548 | 10,989 | 13,587 | 11,126 |
| BurnerBondPledges (new) | — | 9,617 | 14,959 | 9,644 |
| BurnerBondFactory | 7,270 | 7,270 | 17,306 | 46,475 (was 46,956) |
| LimitCalculator | — | 6,951 | 17,625 | 7,088 |

**Storage.** OpenZeppelin's `getStorageUpgradeReport`:
- **Earliest build of this worktree (the `dev` layout) vs now:** RevolvingIssuer, TermIssuer, RateSchedule, AssurancePool, Liquidator, BondVault, CollateralRegistry, ESADepositVault and ClaimEscrow all pass, append-only. RevolvingIssuer still ends at its `__gap` from slot 300; TermIssuer's gap goes 21 → 13 and ends where it did; BondVault's gap goes 33 → 31. BurnerBond's layout changes, but it is a clone with no proxy (section 2).
  The Liquidator was checked again at the head: it adds no storage, and its layout still ends at its `__gap` from slot 265.
- **Against `.openzeppelin/base-sepolia.json`:**
  - TermIssuer passes against all six recorded implementations, and RevolvingIssuer against five of its six.
  - Liquidator ×2, CollateralRegistry ×2, NetworkRegistry, MerchantRegistry ×2, ESADepositVault ×4 and ClaimEscrow all pass.
  - The failures already exist on `dev`: the sixth RevolvingIssuer implementation (0x0D0A…8784, layout replaced before Phase 2b) and the four Phase 1 AssurancePool implementations (`_owner` deleted in Phase 2c). The manifests are unchanged, and AssurancePool gains only NatSpec here.
- **Against `.openzeppelin/base.json`:** ESADepositVault ×2 and ClaimEscrow pass. Both contracts are unchanged.

**Slither** (per contract, via-IR, Medium and High only, against `dev` at 7032c929; run after the merge, and for the Liquidator again at the head). Nothing new is a defect. New entries, by class:

- `uninitialized-state` (High): the module-split false positive Phases 1–4b triaged. These variables are written in a module the analysed contract delegates to:
  - RevolvingIssuerBase: `cycleState`, `dueTerms`, `defaultExcludedPayer`, `payerChoice`, and the views' variables that moved to the main contract;
  - TermIssuerBase: `feeTerms`, `feeRecipientProposal`, `combinedRevolving`, `combinedProduct`, `securedPlans` and the other module-written ones.

  RateSchedule's `bandsOf` is written through a storage pointer in `setProduct`.
- `controlled-delegatecall` (High) on `RevolvingIssuer.delegateView`: only the issuer itself may call it (`msg.sender == address(this)`), only with the pinned terms module as the target, and only through the static self-call in `_forwardView`, so it can run nothing else and write nothing.
- `reentrancy-no-eth` (Medium), on calls whose targets are fixed at wiring and set once; none reaches a state-changing function of the caller:
  - the Combined Ceiling's call from the revolving line into the term issuer (`materialiseMember`, which calls back only into views);
  - the modules' self-call to `materialiseCarry`;
  - `openPlan`'s self-call.
- `divide-before-multiply` (Medium):
  - `PacificCalendar`: the integer date algorithms, by design (exhaustively checked in acceptance 39 against the platform's time-zone data);
  - `RateSchedule.termChargeFor`: the list carry is rounded down before the 365/360 scale-up, so it is at most 1 unit low, in the member's favour, and the cap still bounds it.
- `uninitialized-local`, `incorrect-equality` (day, arrears and nonce comparisons) and `unused-return` (tuple fields not needed): intended, as before. CreditIssuer and CarryIndex entries that appear through derived contracts are in code this branch does not change.
- **Bond contracts:** nothing new. BurnerBond, BurnerBondBase, BurnerBondPledges, CollateralRegistry, BurnerBondFactory and AssurancePool are the same as `dev` or lower. Liquidator goes from 19 findings on `dev` to 15 at the head. That is the bond half's six fewer, plus two from the 12.14 wiring: an `incorrect-equality` on the `pay == 0` skip, and an `unused-return` on the `securedPlans` tuple fields that are not needed. BondVault's one entry is the audited treasury `arbitrary-send-erc20`, moved from `_cover` to `_coverUpTo`.

**Generated files.** At the head, after a production build:
- `node scripts/command/code-fingerprints.mjs` regenerated `packages/command-types/src/chain/code.json` (34 contracts), and `--check` passes;
- `node scripts/docs/contract-reference.mjs --check` passes (36 pages);
- `node scripts/check-doc-links.mjs` finds no broken links.

**`npx turbo run typecheck test --affected`** (Node 22, bun installed, `TURBO_SCM_BASE=origin/dev`; after the merge): 3 of 3 tasks passed.

**Full Hardhat suite.**
- **At the head:** CI's Contracts job on [#896](https://github.com/Deed3Labs/Protocol-Contracts/pull/896) runs the whole suite (in four shards, since #897) and is the merge gate. Its run and result are linked in the PR description.
- **Locally, at the merge commit before the 12.14 Liquidator wiring:** `KEEP_REVERT_STRINGS=true npx hardhat test`, one process, every fuzz at its default 300 steps. 1,084 passing and 1 failing. The failure was environmental: the shared disk filled (ENOSPC) while a TermIssuer `beforeEach` wrote an OpenZeppelin dev-network manifest. That spec passes on rerun.
- **Locally, at the head:** the specs the 12.14 wiring touched (Addendum2Relief, PledgedBonds, Liquidator, Section12Liquidator, TermIssuer, and all four deploy specs) pass, 143 tests.

## 7. App and API follow-ups

Nothing under `apps/` was changed by the credit half; the bond half updated `apps/api/src/services/command/onchain.ts` only. Needed before this is deployed.

**Credit half:**

- **Line opening** (`apps/api/src/services/chain/creditLineService.ts`): `openLine(member, capacities, cycleEndDay)`; the member chooses the Cycle End Day (1–28) at opening, else the default applies.
- **"Automatic clearing" screen**, separate from onboarding, shown ON: "Approve automatic clearing" collects the member's `AutoClear` signature with the level and the hash of the approved text (a copy goes to the member), submitted with `setAutoClearWithSignature`; "Turn off" signs nothing. The onboarding line is notice only and is not listed among required permissions. The Permissions page lists the authorization and lets the member revoke it (`setAutoClear(false, level, 0x0)`).
- **Excluded-payer UI**: show the default federal-benefit exclusions and let the member remove one by signature (`PayerExclusion`); seed `defaultExcludedPayers` in `deploy/config/credit-terms.json` with the bank's originator ids. The settler names the payer on every `repayForMember`.
- **hybridMode** toggle; Autopay limited to the Payment Due Date while it is on (off chain).
- **Cycle-day change**: a signature flow (`CycleEndDay`), at most once per 365 days; show the new first due date (never earlier).
- **Secured Minimum display**: Rebalance Amount, Secured Minimum and the pause from `duesOf`; explain that an unpaid Secured Minimum only pauses secured draws.
- **Cure-notice two-person tooling** for ops (`proposeCureNotice` / `approveCureNotice`, two `CREDIT_ATTESTER_ROLE` keys), and the letter sent with it; the same keys attest Income Assurance.
- **Cycle Assurance and Income Assurance attestations** for ops (`proposeGraceEligibility` / `approveGraceEligibility`, and the Income Assurance pair), with the MB-10 record kept off chain; show the member when a grace was used (`GraceCycleUsed`) and when the next is available.
- **Secured term plans**: a member signature flow (`SecurePlan`) when a plan is secured under MB-05; two-person plan cure-notice tooling (`proposePlanNotice` / `approvePlanNotice`) with the letter; a keeper that calls `declarePlanDefault` once 12.14 holds (it reverts otherwise).
- **Keeper**: sync each revolving line at each cycle end (`syncCreditPeriod`), and call `triggerDefault` only when `inDefault` is true.
- **Fee recipient**: name Clear Lending's recipient by two signers (`FEE_RECIPIENT` in `deploy/25`), then plans with a fee can open; update any dashboard that showed the discount as co-op income.
- **Generated ABIs** follow the contracts; the command app's fingerprints are regenerated.

**Bond half:**

1. **Maturity Instruction at pledging.** The pledge screen shows the instruction (MB-05 §5.6) and the member signs `PledgeItem` including `maturityInstruction`, the hash of the text they approved. Keep a copy in Documents.
   - `apps/api/src/services/chain/savingsCollateralService.ts` still calls the pre-4b, three-argument `pledgeItem`. It needs the member's signature and the new argument.
2. **95% / 70% display.**
   - Show each pledge's stored rate (`itemAdvanceBpsOf`, `advanceBpsOf`) and the limit from `advancedValueOf`, not the kind's current `haircutBps`.
   - Retire any 80% / 60% copy.
3. **Keepers** (all permissionless):
   - `payPledged`: for members in a computed default, or with a shortfall notice past `shortfallWait`, find the bond `pledgePaymentDue` requests and call it, repeating until none is due;
   - `noticeShortfall`;
   - `settle(id)` at maturity for opted-out bonds;
   - `completeSettlement(id)` whenever a recorded remainder can be paid (debt part first).
4. **Member app.**
   - A pledged bond's Redeem becomes the maturity split, previewed with `Liquidator.maturityToDebt`.
   - A pledged bond can't be sent anywhere.
   - Releasing an undrawn pledge is an operator `releaseItem`.
5. **Indexer and Command.** Index:
   - from the collection: `PledgePaid`, `PledgedMaturitySplit`;
   - from the vault: `SettledPledged`, `SettlementShortfall`, `SettlementCompleted`;
   - from the registry: `ItemPledgeTerms`, `PledgeAdvanceRate`;
   - from the Liquidator: `PledgePaymentApplied`, `MaturityInstructionApplied`.

   `onchain.ts` already closes bonds on the first two.
6. **Deployment** (not done here; no network was touched).
   - Deploy `BurnerBondPledges`, then a new factory and collection (`scripts/redeploy_bonds.ts`, with `setFirstBondId` above the current ids).
   - Upgrade BondVault, CollateralRegistry, Liquidator and LimitCalculator.
   - `deploy/23` grants the collection `ITEM_ROLLER_ROLE` (needed for `releaseRetiredItem`). `deploy/25` proposes the collection's `liquidator`.
