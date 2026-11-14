# Phase 2e progress: the credit half (calendar cycles, Secured Minimum, Automatic Clearing, default notice, Combined Ceiling, fee leg)

Branch `audit/phase-2e-calendar-cycles`. The bond half (Earn addendum: `payPledged`, the pledged `settle` split, advance rates, the Maturity Instruction, the Liquidator's bond path) is built on `audit/phase-2e-pledged-bonds` and merged in at the end.

## Interface note for the bond half (read first)

The default views keep their names and signatures. Only how default is computed changes.

| View | Contract | Meaning after 2e |
|---|---|---|
| `inDefault(member)` | RevolvingIssuer | Computed revolving default (12.5, 10b): two consecutive missed Rebalance Amounts, a two-person cure-notice timestamp recorded for the second, the second amount still unpaid, and the grace period over (the later of 15 days after the second due point and 864,000 s after the timestamp). With no timestamp it is false. |
| `hasDefaulted(member)` | RevolvingIssuer, TermIssuer | Unchanged: a default was recorded (written off) at some point. |
| `hasDefaultedOnCurrentLine(member)` | RevolvingIssuer | Unchanged: the recorded default belongs to the line the member holds today. |
| `defaultedAt(member)` | RevolvingIssuer, TermIssuer | Unchanged. |
| `missedInRowOf(member)`, `unsecuredExcessOf(member)` | RevolvingIssuer | Unchanged. |

A revolving default is recorded (and the Liquidator's `_requireCurrentDefault` passes) only once `inDefault` is true; `triggerDefault(member)` on RevolvingIssuer records it and reverts otherwise. MB-05 6.1(a) "default as recorded on chain" for a revolving line is therefore `inDefault(member) || hasDefaultedOnCurrentLine(member)`, exactly what the Liquidator already reads. Term plans keep TermIssuer's own default (`declareDefault`, `hasDefaulted`).

## Items

- [ ] §3 accrual (calendar months for revolving; per-second caps; term list carry per decision C)
- [ ] 12.1 cycles (cycleEndDay, Pacific calendar, member change by signature, Rebalance Amount, Secured Minimum, securedDrawPause, hybridMode)
- [ ] 12.2 Automatic Clearing (UNSECURED / DUE_ONLY / EVERYTHING, autoClearAuthHash, excluded payers)
- [ ] 12.3 Combined Ceiling (permanent; newest plan first, then earlier plans, then revolving, Boost first)
- [ ] 12.5 / 10b revolving default (two-person cure-notice timestamp, fail closed)
- [ ] 12.12 permissions wording
- [ ] 12.13 incomePause: Secured Minimum zero, no securedDrawPause
- [ ] 12.16 origination fee leg (feeRecipient, $50/$75 cap, pro-rata reversal, two-person change)
- [ ] §13 `releaseAssurance` pays Hardship Grants; Credit Backstop never funds a grant (test)
- [ ] Phase 4c items 1, 2, 3, 7
- [ ] TermIssuer NatSpec (ELPA)
- [ ] Tests: amend 1, 3, 18, 25, 28; add 39-48; 4c regressions
- [ ] Merge the bond half; checks; report; draft PR
