# Phase 2c progress: section 13 (Assurance Contracts)

Branch `audit/phase-2c-assurance`, cut from `audit/phase-2b-credit-agreements` (#888), with `dev` merged in once #888 merged. Spec: `specs/assurance-contracts.md`. Binding decisions: the end of `PHASE-2B-PROGRESS.md`. Report: `PHASE-2C-REPORT.md`.

A resumed session reads this file and `git log`, then carries on.

## Steps

- [x] 1. Spec saved; every call into AssurancePool listed (below).
- [x] 2. New `AssurancePool` (compartments, two-person control, governance timelock); `NetworkRegistry` money-path list.
- [x] 3. Rewiring: the ledger's own reserve token and conversion, the remainder to Lending Co., `burnLostDebt` without `reimburse`; issuers, CreditPool, PayoutPool, BondVault, the bond factory; AssuranceOracle retired.
- [x] 4. Tests: existing tests updated; `test/audit/compliance/Assurance.spec.ts` (31–33) and the pool's unit spec.
- [x] 5. Deploy: the new pool, the Assurance timelock handover, credit wiring; UPGRADEABILITY.
- [ ] 6. Sizes, Slither, fingerprints, contract docs, full suite, report, PR.

## Calls into AssurancePool before this phase (`contracts/`)

| Caller | Call | What it becomes |
|---|---|---|
| `StableCredit.burnLostDebt` | `assurancePool.reimburse`, `convertStableCreditToReserveToken` | reverts: lost debt is Lending Co.'s charge-off (decision 3) |
| `StableCredit._repay` | `assurancePool.convertStableCreditToReserveToken`, `reserveToken` | the ledger's own `reserveToken` and conversion (decision 7) |
| `StableCredit._routeRepayment` | `assurancePool.reserveToken`, `depositRepayment` | the remainder goes to Lending Co.'s operating address (decision 2) |
| `RevolvingIssuerExtension.settleFromCollateral` | `stableCredit.assurancePool().reserveToken()` | `stableCredit.reserveToken()` |
| `RevolvingIssuerCycles.repayForMember` | `stableCredit.assurancePool().reserveToken()` | `stableCredit.reserveToken()` |
| `OffersIssuer.treasuryAvailable`, `settle` | `assurancePool().reserveToken()`, `convertStableCreditToReserveToken` | the ledger's |
| `TermIssuerExtension.repayWrittenOff` | `pool.reserveToken()`, `pool.deposit` | paid to Lending Co.'s operating address, which then deposits RECOVERY itself |
| `CreditPool` (extension) | `assurancePool().reserveToken()`, `convertStableCreditToReserveToken` | the ledger's |
| `PayoutPool._repayLenders`, `_repayPrincipal` | `IAssuranceLender(reserve).repayFromPayoutPool` | removed (decision 4) |
| `BondVault.repayReserve` | `IBondReserve(assurancePool).repayFromBondVault` | removed (decision 4) |
| `BurnerBondFactory.createCollection` | `assuranceOracle.isTokenWhitelisted` | TokenRegistry's whitelist (the oracle is retired) |
| `AssuranceOracle.isReserveToken` | `assurancePool.reserveToken()` | contract retired |

`BurnerBond`, `BurnerBondDeposit` and `NetworkRegistry` stored the pool's (and oracle's) address but never called it.
