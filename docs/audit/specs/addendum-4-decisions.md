# Addendum 4: the owner's decisions on the conflict list (Nov 14, 2026), binding

The owner accepted every recommendation below. They control where they differ from `addendum-4.md`.

## Placement
1. **Phase 2g**, built after the Phase 2e PR opens, on a branch from `audit/phase-2e-calendar-cycles`. It covers 10c, 10d, 10f, the 12.5, 12.13, 12.14 and 12.15 changes, and tests 49–55. The bond-roll confirmation (Earn §4A, test 26) is built with **Phase 2f**.

## 10c Pauses
2. **The 30-day cap applies to the 10c pauses:** CLRUSD's per-account pause, CLRUSD's security pause and the vault pause. It does not apply to the Liquidation Hold, which protects the member, or to the CA-mint pause, which stops new mints only. The AssurancePool pause keeps its own rules.
3. **What counts toward `pausedSeconds`:** any pause on the member's own account, plus any CLRUSD-wide or vault-wide pause, whether or not it actually blocked that member's payment.
4. **How it is measured:** CLRUSD and the vault each keep running totals of paused time, one overall and one per account. An issuer measures the pause time inside a grace or cure period as the change in those totals over the period. No new trusted input.
5. **"A payment the pause prevented is never a miss":** paused time between cycle close and the due point pushes that cycle's due point back by the same amount. A pause in force at the due point therefore never creates a miss.
6. **`payPledged`:** it reverts while any pause affecting the Holder is in force. The 72-hour Shortfall clock is extended by paused time, as default grace is.

## 10d De-listing
7. **A separate CLRUSD "listed" status**, changed only by a two-person `delist(wallet, reasonCode, decisionHash)` with reason MEMBERSHIP_ENDED, HOLDER_REQUEST or FRAUD, and an event. Membership expiry, tier changes, status changes, `revokeMember` and `unlinkWallet` do not affect CLRUSD receipt. Swapping the registry or membership source stays a governed timelock action.
8. **FRAUD:** a FRAUD removal also needs a notice recorded on chain at least 10 days before the removal is approved. The account pause stays the fast tool for urgent cases.
9. **StableCredit is out of scope:** its sender-must-be-a-member rule for the credit token is unchanged. 10d concerns CLRUSD.

## 10f Legacy Contact Module
10. **Built for the members' Privy Kernel (ZeroDev, ERC-7579) accounts.** It is an executor module whose code can only ever make the one call that changes the owner of the account's main ECDSA signing key. It is tested on a real Kernel account on a fork before the external audit.
11. **Clear addresses:** they are a fixed list set when the module is deployed. Reading roles from AccessManager was rejected because a Clear admin could then interfere with recovery.
12. **The autopay session key:**
    - Clear's API holds a ZeroDev session key for autopay. Its call policy is limited to the savings-deposit call only, so it can never install or remove modules, configure the Legacy Contact, or call `confirmRoll`. This is checked in the app.
    - `confirmRoll` accepts only a signature from the account's main (root) key, never a session key's.
13. **Build and test, but do not deploy and do not show it in the app** until it has been externally audited and published in MB-03 Schedule 2.

## 12.13 incomePause
14. **Count cycles per `hardshipRef`.** A pause lasts at most `incomePauseMaxCycles` consecutive cycles per hardship, and a new documented hardship can start a fresh pause straight after the previous one ends. No hardship category is recorded or checked on chain.

## Bond roll by confirmation (Phase 2f)
15. **It replaces today's auto-roll.**
    - Remove `willAutoRoll` and `setAutoRollOptOut`.
    - The Phase 2e pledged split settles any unconfirmed pledged bond.
    - The 7-day limit uses Phase 2e's `PacificCalendar` library.
    - The 90-day full reserve is built together with the BondVault reserve schedule.
    - The EIP-712 confirmation from the Holder's smart account (an EIP-1271 signature) still needs a real-device test of Privy signatures before launch.

## 12.17 Statement data (owner, Nov 14, 2026), binding
The spec text is in `addendum-12-17-statement-data.md`. The owner accepted every recommendation:
16. **Built in Phase 2g** with Addendum 4. 2g splits between two agents:
    - one for the credit side: pause clocks, `pausedSeconds`, `incomePause` per hardship, and 12.17;
    - one for the CLRUSD de-listing status and the Legacy Contact module.
17. **Events, plus one stored snapshot.**
    - At each cycle close, emit an event with each position's principal and carry at the end, its carry for the cycle, the Rebalance Amount, the Secured Minimum and their total, and the statement-required flag. The cycle's start figures are the previous cycle's end figures, which the event repeats.
    - Store only the most recently closed cycle, for views.
    - Test 56's "readable for a closed cycle" is met by the events plus that snapshot.
18. **Figures as at the cycle end, even when the close is recorded late.** A keeper records the close after the cycle end. Carry is deterministic, so the close event carries figures exactly as at the cycle-end timestamp. It records both the cycle-end timestamp and the time it was recorded.
19. **A running principal-seconds total per position per cycle**, updated on every draw and payment, so the statement's average daily balance needs no recomputation.
20. **Payment events break out carry and principal for each position reduced**, not only totals.
21. **Collateral changes:**
    - Every change to encumbered CLRUSD, and every Earn pledge, release, roll and force-settlement (`payPledged`, the maturity split and `completeSettlement`), emits an event with the member, the amount and the position. Time is the block time.
    - Check the existing events, and add the member and amount wherever they are missing.
22. **Statement-required** is set when any position, secured ones included, ends the cycle with a nonzero balance, carry included. There is no threshold. It applies to revolving cycles only.
23. **Contract size:** split modules as needed (RevolvingIssuerExtension has about 163 bytes left), using the constructor-argument module pattern.

## 12.18 Workout states (owner, Nov 14, 2026), binding
The spec text is in `addendum-12-18-workout-states.md`. The owner accepted every recommendation:
24. **Built in Phase 2g**, by the credit-side agent.
25. **The PLAN is a dedicated workout-plan position inside RevolvingIssuer, not a TermIssuer plan.**
    - It moves the unsecured revolving principal plus accrued carry across, with no mint, no fee leg and no merchant.
    - It has a fixed 0% rate and equal cycle payments, with any rounding on the last payment (test 57: $912 = 12 × $76).
    - The unsecured revolving positions go to zero.
26. **Default of the workout plan:** it takes 12.14's timing and notice rules (60 days past due, then a two-person cure-notice timestamp, then 30 days, extended by `pausedSeconds`, failing closed). Its enforcement reaches only what an unsecured default reaches, never Savings or other collateral.
27. **A second workout within 365 days** needs a second two-person attestation with its own reference hash. The 365-day limit is computed on chain, and no role can reset it.
28. **Re-age:** only REDUCED or PLAN cycles in which the required amount was actually paid count toward the 3 consecutive cycles. DEFERRAL cycles don't count. The limits of once per rolling 365 days and twice per rolling 5 years are computed on chain.
29. **Workout plus `incomePause`:** both may be active at once. The lower amount due applies, and neither causes a miss, default or liquidation.
30. **Combined Ceiling:** the 0% workout plan's principal is excluded from it.
31. **Statements (12.17):** the cycle-close event records the active workout state and its `workoutRef`. Moving balances into a PLAN emits its own event.
32. **Ending early:** the member may end DEFERRAL or REDUCED early with their own signature. A PLAN ends when it is paid off.
