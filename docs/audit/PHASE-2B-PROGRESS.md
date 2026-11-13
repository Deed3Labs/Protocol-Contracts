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
