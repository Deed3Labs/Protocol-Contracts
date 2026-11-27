// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev CLRUSD's pause-clock views (Phase 2g, 10c): the security pause or `account`'s own pause.
interface IClrusdPauseClock {
    function pauseClock(address account) external view returns (uint256);
    function isPauseInForce(address account) external view returns (bool);
}

/// @dev ESADepositVault's pause-clock views (Phase 2g, 10c): the vault-wide pause.
interface IVaultPauseClock {
    function pauseClock() external view returns (uint256);
    function isPauseInForce() external view returns (bool);
}

/// @dev What the issuers and the Liquidator read (Phase 2g, 10c): the member's pause clock.
interface IPauseClock {
    function pausedSeconds(address member) external view returns (uint256);
    function inForce(address member) external view returns (bool);
}

/// @title PauseClock
/// @notice One member's pause clock (Addendum 4, 10c; decisions 3 and 4): the seconds any pause
/// affecting them has been in force, cumulative and monotonic, and whether one is in force now. Any
/// pause on the member's own CLRUSD account, plus any CLRUSD-wide or vault-wide pause, whether or not
/// it blocked that member's payment.
/// @dev Reads CLRUSD's and the vault's own running totals, so it adds no trusted input. Both sources
/// are fixed at deployment; it has no owner, role or setter. The issuers measure the paused time
/// inside a grace or cure period as the change in `pausedSeconds` over it. A CLRUSD pause and a vault
/// pause in force at once are each counted, which can only lengthen a period.
contract PauseClock is IPauseClock {
    address public immutable clrusd;
    address public immutable vault;

    error PauseClockInvalidAddress();

    constructor(address clrusd_, address vault_) {
        if (clrusd_ == address(0) || vault_ == address(0)) revert PauseClockInvalidAddress();
        clrusd = clrusd_;
        vault = vault_;
    }

    /// @notice cumulative paused seconds affecting `member`, up to now.
    function pausedSeconds(address member) external view returns (uint256) {
        return IClrusdPauseClock(clrusd).pauseClock(member) + IVaultPauseClock(vault).pauseClock();
    }

    /// @notice whether any pause affecting `member` is in force now.
    function inForce(address member) external view returns (bool) {
        return IClrusdPauseClock(clrusd).isPauseInForce(member) || IVaultPauseClock(vault).isPauseInForce();
    }
}
