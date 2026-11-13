# Phase 1 progress

Branch `audit/phase-1`, cut from `audit/materials` (which is `dev` @ `7eb5976` plus the audit docs and tests; `dev` itself did not contain `docs/audit/`).

## Phase 0: setup

- [x] Branch `audit/phase-1`
- [x] Toolchain: root workspace install, solc 0.8.29 via Hardhat (needs `http_proxy=$HTTPS_PROXY` in this cloud environment), compile OK
- [x] Baseline: full suite 816 passing; audit tests 53 passing (compile with `KEEP_REVERT_STRINGS=true`; a plain `hardhat compile` strips revert strings and 56 tests then fail under `--no-compile`)

## 1A: ledger and credit (lead)

- [x] 1. C-1, H-1, M-1: draw recipients, PayoutPool redeem eligibility, transferable vs term ceiling, revolving sync reverts on unplaced shortfall, no transfers out of a merchant except to the PayoutPool
- [ ] 2. H-2: roll compliant periods forward; limit with no period is invalid; operator period setters only extend or pause
- [ ] 3. C-2: savings collateral = min(pledged, balance); free CLRUSD checked at draw and card settle
- [ ] 4. Refund path: X-1, X-3, X-4, X-5, X-12, X-13, X-14
- [ ] 5. Pool accounting: X-2, X-8, X-20
- [ ] 6. X-6: write-offs stay with the defaulting issuer
- [ ] 7. H-4 (credit side) and M-2: per-function operator roles, daily caps, plan merchants active, member-signed plans, card settlement caps and authorizations
- [ ] 8. M-3, L-2, L-1, L-5, L-6, L-7, L-8, X-11

Notes:
- Step 1: the H-2 audit proof now fails (it drew to an unregistered wallet); step 2 rewrites it.
- Step 1: ledger `setMerchantRegistry` must be wired in deploy/22 (pending, done with the 1B merge).

## 1B: money peripherals (subagent, branch `audit/phase-1-1b`, merged here when done)

- [ ] H-3, M-5, H-4 (ClaimEscrow, SavingsIntent, LendingPool), M-4, M-6, M-8, X-17, X-7, X-18, X-9, X-15, X-16, X-10, X-19, M-7 prep

## 1C: Deed track (subagent, branch `audit/phase-1-1c`, merged here when done)

- [ ] D-1 to D-22

## Done criteria

- [ ] Full suite passes; every audit exploit test flipped and passing
- [ ] Invariant suite at 300 steps, all seeds
- [ ] Slither per changed contract: no new High or Medium
- [ ] `validateUpgrade` for `ESADepositVault` and `ClaimEscrow` against `.openzeppelin/base.json`
- [ ] `PHASE-1-REPORT.md`, push, PR into `dev`
