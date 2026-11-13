# Phase 1 progress

Branch `audit/phase-1`, cut from `audit/materials` (which is `dev` @ `7eb5976` plus the audit docs and tests; `dev` itself did not contain `docs/audit/`).

## Phase 0: setup

- [x] Branch `audit/phase-1`
- [x] Toolchain: root workspace install, solc 0.8.29 via Hardhat (needs `http_proxy=$HTTPS_PROXY` in this cloud environment), compile OK
- [x] Baseline: full suite 816 passing; audit tests 53 passing (compile with `KEEP_REVERT_STRINGS=true`; a plain `hardhat compile` strips revert strings and 56 tests then fail under `--no-compile`)

## 1A: ledger and credit (lead)

- [x] 1. C-1, H-1, M-1: draw recipients, PayoutPool redeem eligibility, transferable vs term ceiling, revolving sync reverts on unplaced shortfall, no transfers out of a merchant except to the PayoutPool
- [x] 2. H-2: roll compliant periods forward; limit with no period is invalid; operator period setters only extend or pause
- [x] 3. C-2: savings collateral = min(pledged, balance); free CLRUSD checked at draw and card settle
- [x] 4. Refund path: X-1, X-3, X-4, X-5, X-12, X-13, X-14
- [x] 5. Pool accounting: X-2, X-8, X-20
- [x] 6. X-6: write-offs stay with the defaulting issuer
- [x] 7. H-4 (credit side) and M-2: per-function operator roles, daily caps, plan merchants active, member-signed plans, card settlement caps and authorizations
- [x] 8. M-3 (1B), L-2, L-1, L-5, L-6 (step 3), L-7, L-8, X-11

Notes:
- Step 2: H-2 proof rewritten as two regression tests.
- Step 1: ledger `setMerchantRegistry` is wired in deploy/22.
- Step 3: deploy/20 calls `setClrusdToken`. The 1B test files that needed it were fixed at merge.
- Step 3 also did L-6 (`_requiredUnits` rounds up), since it is the same function.
- Steps 4-5 landed together (X-2's routing formula was needed to test the refund path). Fuzz at 60 steps: (i-b) holds in all seeds; (ii) "refund up" is residual carry left by a reversal that returned no cash, by design (`residualCarryOf`).
- After the merges: production bytecode sizes fixed (CreditIssuer modifiers out of line; TermIssuer split into base/extension). M-3 CLRUSD outage lock narrowed to the last-known lock (DECISIONS #2). Deploy scripts wired.

## 1B: money peripherals (subagent, branch `audit/phase-1-1b`, merged here when done)

- [x] H-3, M-5, H-4 (ClaimEscrow, SavingsIntent, LendingPool), M-4, M-6, M-8, X-17, X-7, X-18, X-9, X-15, X-16, X-10, X-19, M-7 prep, M-3 (merged; lead added AssurancePool L-1 constructor, LendingPool.syncInterest, PayoutPool borrow sized by borrowableToday)

## 1C: Deed track (subagent, branch `audit/phase-1-1c`, merged here when done)

- [x] D-1 to D-22 (merged)

## Done criteria

- [x] Full suite passes (856 on the final tree, fuzz at 300 steps); every audit exploit test flipped and passing
- [x] Invariant suite at 300 steps, all seeds (9 passing; (i-b) holds everywhere; (ii) only the justified refund residual)
- [x] Slither per changed contract: no new real High or Medium (triaged; see report)
- [x] Storage layout of `ESADepositVault` and `ClaimEscrow` checked against `.openzeppelin/base.json`: OK
- [x] `PHASE-1-REPORT.md` written
- [ ] Push and PR into `dev`
