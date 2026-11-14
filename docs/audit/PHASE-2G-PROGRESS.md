# Phase 2g progress (de-listing and Legacy Contact half)

Branch `audit/phase-2g-delisting-legacy`. The credit-side half (`audit/phase-2g-pauses-workouts`) codes against the views below and merges this branch.

## Pause-clock views (decisions 3 and 4), fixed

```solidity
// ClearUSDUpgradeable (CLRUSD)
/// Cumulative seconds, up to block.timestamp, in which CLRUSD's security pause OR `account`'s own
/// pause was in force. The union is counted once. Monotonic (never decreases).
/// pauseClock(address(0)) is the security pause alone (no account is ever paused at address 0).
function pauseClock(address account) external view returns (uint256);
/// The security pause or `account`'s pause is in force now.
function isPauseInForce(address account) external view returns (bool);

// ESADepositVault
/// Cumulative seconds, up to block.timestamp, in which the vault-wide pause was in force. Monotonic.
function pauseClock() external view returns (uint256);
/// The vault-wide pause is in force now (the same as `paused()`).
function isPauseInForce() external view returns (bool);
```

How an issuer uses them (decision 4): read the clock at the start of a grace or cure period and again later; the paused time inside the period is the difference. Both clocks only count pauses set after this upgrade; a pause already in force when the upgrade lands is not counted (none is expected).

If a signature changes, this file is updated and pushed again.

## Status

| Item | Status |
|---|---|
| 10c renewal cap (CLRUSD account and security pauses, vault pause) | done |
| Pause clocks (the views above) | done, signatures unchanged |
| Owner decision 33: a new pause within 30 days of the last one's end continues its cap | done, signatures unchanged |
| 10d de-listing (CLRUSD listed status) | done |
| 10f Legacy Contact Module | done, not deployed; tested on a mock Kernel and on the real Kernel v3.3 bytecode |
| Decision 12: autopay session key | none exists (autopay is the vault's signed DepositMandate); pinned by an app test |
| Credit half (`audit/phase-2g-pauses-workouts`): pause time in grace and cure periods, `incomePause` per hardshipRef, 12.17 statement data, 12.18 workouts | done; tests 50, 51 and 55-57 |
| Both halves merged (the de-listing half at 9a6cb424) | done |

The write-up for both halves is `PHASE-2G-REPORT.md` (the de-listing half is its Part B).
