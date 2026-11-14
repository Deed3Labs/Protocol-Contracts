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
