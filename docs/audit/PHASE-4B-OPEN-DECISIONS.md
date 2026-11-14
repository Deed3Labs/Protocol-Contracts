# Owner decisions on Phase 4b's open questions (2026-11-14)

The owner accepted every recommendation for `PHASE-4B-REPORT.md` section 3. They are built in Phase 4c.

| # | Question | Decision |
|---|---|---|
| 1 | No per-member daily card cap on chain | Add a governed per-member daily card cap (small), so the card-settler key's reach over any one member is bounded (L-C interim). |
| 2 | The card after re-onboarding | The card follows the current line, the same rule M-C applied to liquidation: `authorizeCardSpend`/`settleCardSpend` read `hasDefaultedOnCurrentLine`, not `hasDefaulted`. |
| 3 | Order of operations after a default | Enforce it in the contract: `openLine` reverts while collateral from an earlier default is still unapplied (pledged collateral against defaulted debt not yet liquidated or settled), so re-onboarding can't cut recovery short. |
| 4 | Two signers to freeze a deed | Require two distinct validator signers to freeze (void at a freezing code), to match the two-party un-void. |
| 5 | A pending validator change across a deed transfer | A transfer cancels any pending validator change; the new holder decides. Legacy deeds unchanged. |
| 6 | L-B, which draws refresh the lock | Keep as built: only draws that touch the Savings tier. |
| 7 | L-G for issuer-internal repayments | `repayCardSpend` and `reverseCardSpend` clear tiers by the same effective-rate order (after caps) as the ledger walk, so every repayment follows one rule. Pending counsel like the rest of L-G. |
| 8 | Comparing a term plan with a revolving tier | Keep as built: a plan's per-30-day rate is stated per month (× 365/360), so it is dearer at the same quoted bps and is repaid first. |
| 9 | More than 16 distinct rates | Never leave a repayment unattributed: anything beyond the 16th band goes to the dearest remaining positions by a fallback, with a test. |
| 10 | O-1 applies to the whole line | Keep as built: the line moves to the new state only when every product it uses has launched there. |
