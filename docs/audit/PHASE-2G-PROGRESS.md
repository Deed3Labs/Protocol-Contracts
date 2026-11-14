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
| 10c renewal cap (CLRUSD account and security pauses, vault pause) | in progress |
| Pause clocks (the views above) | in progress |
| 10d de-listing (CLRUSD listed status) | in progress |
| 10f Legacy Contact Module | in progress |
| Decision 12: autopay session key | checked: no ZeroDev session key exists in the code (see the final report) |
