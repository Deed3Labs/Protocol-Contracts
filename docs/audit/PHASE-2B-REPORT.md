# Phase 2b report: section 12 (credit agreements addendum)

Branch `audit/phase-2b-credit-agreements`, cut from `dev` after Phases 1–3 merged (#883, #886, #885). The source is the section 12 addendum (Clear Credit Agreement, Pledge Agreement, Term Plan Agreement), with the owner's correction that replaces 12.1, 12.2 and acceptance tests 18, 19 and 25. Decisions and design notes are in `PHASE-2B-PROGRESS.md`. The PayoutPool and reserve work is in `PHASE-2B-PAYOUT-RESERVE.md`, and the Liquidator work in `PHASE-2B-LIQUIDATOR.md`.

Section 13 (Assurance Contracts) replaces 12.11's separate Assurance Reserve and is decided. It follows as Phase 2c.

Nothing was deployed, no key was used, and no live network was touched.

## 1. What changed

| Item | Where | What |
|---|---|---|
| 12.1 (replaced) | — | Revolving cycles stay 30 days, accruing at monthly × 12 / 365 (acceptance 25). |
| 12.2 (replaced) | RevolvingIssuer | Member-controlled auto-clear:<br>- on/off and scope (UNSECURED_ONLY, the default, or ALL), set by the member or by their EIP-712 `AutoClear` signature (how onboarding turns it on);<br>- a governed network-wide off switch;<br>- `repayForMember(ref = attested fiat receipt)`: the settler delivers the cash, so the member's USDC and CLRUSD are never swept. It clears dearest-first within scope and emits `AutoCleared(applied, remainder)`.<br>Acceptance 18, 19. |
| 12.3 | RevolvingIssuer | Governed `unsecuredLineCap` ($2,499) on income-backed + Boost capacity. The member ceiling (Phase 2) caps carry on the combined principal (acceptance 20). |
| 12.4 | RevolvingIssuer, ESADepositVault | The Boost cap is $500, rising to $750 after 6 Clean Cycles with ESA deposits in 5 of the last 6. `ESADepositVault.lastDepositAt` is appended. Nothing reads or stores Acceleration (acceptance 21). |
| 12.5 | RevolvingIssuer, Liquidator, CollateralRegistry | A missed cycle halves the unsecured limit, and the halved ceiling holds until a Clean Cycle. `settleExcess` settles the excess from pool shares, then bonds, never Savings. Default is two misses in a row plus the 15-day cure window after a chain-dated notice; no role sets it. Savings are used only on default, and only up to Savings-backed drawn: `liquidate` now accepts only the savings tier and kind (acceptance 22). |
| 12.6 | Liquidator | Liquidation Hold:<br>- two-person propose/confirm/renew/clear;<br>- governed maximum per reason (death 90 days, bankruptcy 180, billing dispute 90, late notice 30);<br>- lapses on its own;<br>- gates only enforcement (acceptance 23). |
| 12.7 | RevolvingIssuer | Card draws against Savings only within the member's own revocable allowance, set by the member or their signature. No admin path raises Savings drawn (acceptance 24). |
| 12.8 | Liquidator | `noticeShortfall` (permissionless). After a governed wait of at least 72 hours, `settleShortfall` redeems the smallest amount that closes the gap, pool shares first, bonds at no less than present value, never Savings (acceptance 26). |
| 12.9 | TermIssuer | Levelled payments ($940 in 4 at 2% is $246.87 × 4, $47.47 of carry). Term carry is charged at the monthly rate per 30-day cycle. PARTNER `freeBelowAmount` is $100 (acceptance 5 updated). |
| 12.10 | PayoutPool | Paid by deadline first, then FIFO among claims with the same deadline (per-window queues). `dueWithin` shows what must be funded. No AssurancePool lending (acceptance 27). |
| 12.11 (narrowed by section 13) | BurnerBondDeposit, BondVault | Bond principal goes to BondVault, never the AssurancePool. BondVault no longer borrows from the pool. Tests show redemption, payout and liquidation leave the pool unchanged. |
| 12.12 | — | Auto-clear and the Savings allowance can always be revoked by the member. Only pledged collateral is locked, by the computed lock, plus the excess lock while an excess stands (open question 2). |

Deploy: `deploy/config/credit-terms.json` and `deploy/25_wire_Compliance.ts` set the terms and the deposit source. Nothing was run on a network.

## 2. Decisions applied (owner, 2026-11-13)

All seven recommendations were accepted:
1. PayoutPool by deadline (overrides the "Do NOT change" FIFO item and DECISIONS #3).
2. Term plans at the monthly rate per 30-day cycle; revolving stays at × 12 / 365.
3. $1,066 cannot be derived from the stated rules; the note keeps $1,125.
4. Default is chain-dated.
5. Liquidation Hold maximums per reason.
6. No bond principal into the AssurancePool.
7. Savings card draws need the member's own authorization.

Section 13 decisions are recorded in `PHASE-2B-PROGRESS.md`.

## 3. Open questions for the owner

1. **Bonds after a missed cycle or shortfall vs audit M-6.** BurnerBond lets the Liquidator take a bond only from a member in default. The helper's interim wiring points the collection's default source at the Liquidator, which answers true only inside its own computed enforcement. That works, but it lets the Liquidator define default for bonds.
   - My recommendation: a narrow second gate in BurnerBond instead. It allows taking a pledged bond only when the issuer reports an unsecured excess (12.5) or a shortfall notice older than 72 hours (12.8), only up to that amount, and only at no less than present value.
   - The pool-share legs work either way.
2. **The excess lock (12.12).** While an excess stands, pledged pool shares and bonds can't leave.
   - My recommendation: cap the lock for pool shares at the excess amount. Bonds can't be split, so a whole bond stays locked.
3. **Re-proposing a lapsed hold.**
   - My recommendation: allow it, as a new two-person action with new evidence, running its own maximum.
4. **Rate figures and terms** in `rate-schedule.json` and `credit-terms.json` are pending counsel.
5. **Cycles are judged lazily**, when the member transacts or anyone calls `syncCreditPeriod`. A member nobody syncs earns no Clean Cycles. A keeper should sync each member once a cycle.

## 4. Apps and API follow-up (after this merges)

Draft PR #887 tracks Phase 2's contracts. These changes are needed for 2b:
- the domain plan schedule is levelled and charged per 30 days (the disclosure);
- the onboarding `AutoClear` signature, the settings toggle and scope, and the "Clear $X now?" prompt;
- the repayment service delivers the cash (approve the issuer) instead of pulling the member's USDC;
- the `SavingsDrawAllowance` signature for card spending;
- the Boost cap ($500/$750), missed-cycle and cure-notice messages;
- `dueWithin` for Lending Co.'s payout funding;
- Liquidation Hold and shortfall ops tooling.

## 5. Numbers

- **Tests:**
  - full suite: SEE-SUITE;
  - section 12 specs: `Section12Revolving` (11), `Section12Liquidator` (15, including an end-to-end missed cycle with the real RevolvingIssuer), `PayoutDeadline`, `ReserveUntouched`;
  - existing tests that assumed a one-miss default now use `test/helpers/default.ts`.
- **Storage:**
  - ESADepositVault and ClaimEscrow pass OpenZeppelin's storage report against every implementation in `.openzeppelin/base.json` (the vault appends `s_lastDepositAt`; its gap goes from 34 to 33);
  - against `dev`, RevolvingIssuer, Liquidator, TermIssuer, CollateralRegistry, BondVault, LimitCalculator, NetworkRegistry and MerchantRegistry are append-only, each ending at the same slot;
  - PayoutPool renames slot 257 `nextUnpaid` to `legacyNext` (same meaning) and appends.
- **Sizes:** SEE-SIZES.
- **Slither** (Medium and High only, per contract, compared with `dev`). Nothing new in BondVault, BurnerBondDeposit, CollateralRegistry, ESADepositVault or TermIssuerExtension. The new entries:
  - **`reentrancy-balance` (High) in `Liquidator.settleExcess` / `_redeemBond`: no live path, hardened.** It measures what `redeemEarly` delivered by reading the balance before and after. The callee is the governed bond collection, and USDC has no transfer hook. A re-entry lock now guards every Liquidator enforcement path (it packs into an existing slot).
  - **`uninitialized-state` (High): false positives.** In RevolvingIssuer they are the Base/Extension split: `creditTerms`, `boostBaseCap`, `boostEarnedCap` and `cycleOf` are written in the extension. In PayoutPool, `windowQueue` is filled with `push` through a storage reference.
  - **`reentrancy-no-eth` on `judgeCycle`: false positive.** Its external calls are a `staticcall` to the deposit source and `updateCreditLimit` on the ledger, which has no callback.
  - **`incorrect-equality`, `uninitialized-local` and `unused-return`: intended.** These are zero checks, locals relying on the zero default, and tuple fields that aren't needed.
