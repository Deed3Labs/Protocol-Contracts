# Phase 2b progress: section 12 (credit agreements addendum)

Branch `audit/phase-2b-credit-agreements`, cut from `dev` after Phases 1 and 2 merged (#883, #886). The source is the section 12 addendum (Clear Credit Agreement, Pledge Agreement, Term Plan Agreement), with the owner's correction that replaces 12.1, 12.2 and acceptance tests 18, 19 and 25.

## Decisions (owner, 2026-11-13: "go with your recommendations on all of them")

1. **PayoutPool order (12.10).** Claims are paid by deadline first, with FIFO by claim age among claims that share a deadline. This overrides the spec's "Do NOT change: PayoutPool and its FIFO order" and DECISIONS #3, with the owner's approval.
2. **Rate per cycle.**
   - Revolving keeps per-second accrual at monthly × 12 / 365 (DECISIONS #1, restated by the corrected 12.1).
   - Term plans charge the monthly rate per 30-day cycle (rate / 30 days per second), with levelled payments. This is the only way to reach 12.9's $47.47 on $940 in 4 at 2%. A 30-day cycle is never longer than a month, so it stays within the monthly cap.
3. **The $1,066 figure (12.9).** It can't be derived from the stated rules. Comparing 2% to the graduated cap over the same cycle breaks even at $1,125, whatever the cycle length. The note keeps $1,125 and this file records the discrepancy, pending the drafter's formula.
4. **Default (12.5).** The cure notice is dated by the chain itself, at the second consecutive missed due date (the letter is sent off chain). Default is computed as two consecutive missed rebalances plus 15 days after that notice. No role sets default status (10b and acceptance 13 still hold).
5. **Liquidation Hold (12.6).** Each reason has its own maximum length:
   - bankruptcy (governed max);
   - death (90 days from the report);
   - billing dispute (governed max);
   - late default notice (governed max).

   A hold is set by one signer and confirmed by a second (two-person). It lapses on its own at the maximum. A second, different signer can renew it within that reason's maximum. It only delays enforcement against pledged collateral.
6. **Bond principal (12.11).** The path that moves bond principal into the AssurancePool is removed. A separate, Clear-owned AssuranceReserve pays member Assurance grants.
7. **Card draws against Savings (12.7).** A draw that raises Savings-backed drawn needs the member's own signed authorization: a standing EIP-712 authorization the member can revoke. Phase 1's §7 default (an authorization recorded by the settler key) no longer applies to Savings.

## Items

- [ ] 12.1 (replaced) 30-day cycles stay. Acceptance 25: a full 30-day cycle accrues no more than the monthly cap on every position.
- [ ] 12.2 (replaced) `autoClear` (member-controlled, default ON at onboarding by the member's signature), `autoClearScope` (UNSECURED_ONLY default, or ALL), governed `autoClearEnabledGlobal`. Repayment is recorded from an attested fiat receipt via the operator path, most-expensive-first within scope, with events. Ready-to-allocate USDC and CLRUSD are never swept. Acceptance 18, 19.
- [ ] 12.3 `unsecuredLineCap` ($2,499, governed). The graduated cap applies to the combined unsecured principal (already the member ceiling). Acceptance 20.
- [ ] 12.4 Boost limit $500, rising to $750 after 6 consecutive Clean Cycles and ESA deposits in at least 5 of the last 6 cycles. Nothing reads or stores Acceleration. Acceptance 21.
- [ ] 12.5 One missed rebalance halves the unsecured limit, and any excess is settled from bonds/pool shares, never Savings. Default per decision 4. Savings are used only on Default, and only up to Savings-backed drawn. Acceptance 22.
- [ ] 12.6 Liquidation Hold per decision 5. Acceptance 23.
- [ ] 12.7 Member-signed authorization for Savings-backed card draws. No admin or signer write raises Savings-backed drawn. Acceptance 24.
- [ ] 12.8 Earn shortfall: a notice event, then 72 hours, then the smallest redemption that closes the gap, pool shares before bonds. Never Savings. Bonds at no less than 100% of present value. Acceptance 26.
- [ ] 12.9 Levelled term payments ($940 in 4 at 2% = $47.47 total carry); `freeBelowAmount` = $100. Update acceptance 5.
- [ ] 12.10 PayoutPool by deadline, then FIFO (helper agent, branch `audit/phase-2b-payout-reserve`). Acceptance 27.
- [ ] 12.11 Separate AssuranceReserve; no bond principal into either reserve (helper agent).
- [ ] 12.12 ACH and Autopay authorizations revocable by the member (autoClear is member-toggled). Only the pledge stays locked while drawn, and only for the encumbered amount (already the computed lock).
- [ ] Report, UPGRADEABILITY update, PR

## Design (so a resumed session does not re-derive it)

**Cycles (12.4, 12.5) on RevolvingIssuer.** The 30-day period and its grace window stay. A cycle is
judged when its grace window ends (`inExpiredPeriod`), which is where Phase 1 decided default:
- Compliant (rebalanced to zero) is a **Clean Cycle**: `cleanStreak++`, `missedInRow = 0`, and a halved
  limit is restored. The cycle rolls.
- **First miss** (`missedInRow` 0 → 1): `cleanStreak = 0`. The unsecured limit (INCOME + BOOST
  capacity) is halved, even below drawn. `unsecuredCeiling` records the halved total, so later
  capacity pushes can't undo it until a Clean Cycle. The cycle rolls. `unsecuredExcessOf(member)` =
  unsecured drawn − halved limit. The Liquidator settles it from pledged bonds/pool shares, never
  Savings.
- **Second miss in a row** (1 → 2): the chain dates the cure notice now (`cureNoticeAt`, event
  `CureNotice`). The line stays frozen.
- **Default** = `missedInRow >= 2`, still not compliant, and `now >= cureNoticeAt + cureWindow`
  (15 days, governed). Computed; no role sets it.
- **Deposit cycles:** at each judgement, `depositSource.lastDepositAt(member) >= cycle start` sets
  a bit in a 6-bit shift register. ESADepositVault gains an appended `lastDepositAt` mapping (live
  contract, gap shrinks).
- **Boost cap** = `boostBaseCap` ($500), or `boostEarnedCap` ($750) from the cycle after
  `cleanStreak >= 6` and at least 5 of the last 6 cycles had a deposit. Both are governed.
  Enforced wherever capacity is written. Nothing reads Acceleration.

**Unsecured cap (12.3).** INCOME + BOOST capacity ≤ `unsecuredLineCap` ($2,499, governed), and ≤
`unsecuredCeiling` while halved. The member ceiling (Phase 2) already caps carry on the combined
principal.

**autoClear (12.2, replaced).**
- Per member: `autoClearOn`, `autoClearScope` (UNSECURED_ONLY = 0, the default, or ALL = 1), and
  `autoClearSet` (whether the member ever chose).
- Set by the member, or by their EIP-712 `AutoClear(member, on, scope, nonce, deadline)`
  signature: the onboarding signature sets it ON.
- Governed `autoClearOffGlobal` (stored inverted, so the default is enabled).
- `repayForMember(ref, member, amount)` (card settler, `ref` = attested fiat receipt hash, used
  once). The settler delivers the reserve token itself, so it never takes the member's USDC or
  CLRUSD. It clears dearest-first within scope, and emits `AutoCleared(ref, member, applied,
  remainder)`.
- With autoClear off it reverts. The app's one-tap "Clear $X now?" is a member-signed Repay.

**Savings draws (12.7).** `savingsDrawAllowance[member]` is a standing allowance set only by the
member (`setSavingsDrawAllowance`) or by their EIP-712 signature, and revocable to 0. A card
settlement whose draw lands in the SAVINGS tier consumes it, and reverts if short. No admin path
raises Savings-backed drawn: capacity writes can't, and transfers are the member's own.

**Liquidator (12.5 settlement, 12.6, 12.8), second helper.**
- `settleExcess(member)` (permissionless): redeems pledged pool shares, then bonds (bonds at ≥100%
  present value), up to `unsecuredExcessOf`, and settles BOOST then INCOME via
  `settleFromCollateral`. Never CLRUSD.
- Liquidation Hold: per member `{reason, setAt, until, proposer, confirmed}`. `HOLD_ROLE` A
  proposes and a different B confirms. `maxHold[reason]` is governed (DEATH 90 days). It lapses
  on its own, and a different signer can renew within the max. While a hold is active,
  `liquidate`, `liquidateShares`, `settleExcess` and `settleShortfall` revert. Nothing else is
  gated.
- Earn shortfall: `noticeShortfall(member)` (permissionless) records `shortfallNoticedAt` and
  emits when pledged Earn value < Earn-backed drawn. After 72 hours (governed),
  `settleShortfall(member)` redeems the smallest amount that closes the gap, pool shares first.
  Never Savings.
- Savings (`liquidate`): only on the new default, and only up to Savings-backed drawn.

## Section 13 (Assurance Contracts): decisions (owner, 2026-11-13, "go with your recommendations on all of them")

Section 13 replaces 12.11. It is built as Phase 2c, right after 2b, on its own branch.
1. The AssurancePool is rebuilt around compartments (CREDIT_BACKSTOP, MEMBER_ASSURANCE). This
   replaces the RTD reserve model (primary/buffer/excess, oracle rebalance) and retires
   AssuranceOracle, overriding two "Do NOT change" items (RTD as pool exposure, the Phase 0
   AssurancePool role fixes). The Phase 0 test becomes "backstopFloor() = 0 with no unsecured
   credit".
2. The ledger's repayment remainder goes to Lending Co.'s operating address, not the pool
   (replacing Phase 1's X-2 routing into the pool). Lending Co. pays in through
   `deposit(CREDIT_ENHANCEMENT_FEE)`.
3. `reimburse` (lost-debt redemption paid from the pool) is removed. Lost debt is Lending Co.'s
   charge-off, recovered through `requestDraw` to its loss-reserve address.
4. The pool's loans to PayoutPool and BondVault are removed. Payouts rely on Lending Co.'s
   funding (12.10), and bonds on BondVault's own reserves.
5. Governance: a third TimelockController (7 days), with a co-op board Safe as proposer.
   DECISIONS #10's two instances stay for Deed and credit.
6. Every function has in-contract two-person control (proposer ≠ approver). Parameter changes and
   upgrades are also behind the 7-day timelock.
7. Rewiring is in scope: the ledger's reserve token and conversion, PayoutPool, BondVault and
   BurnerBondDeposit.
