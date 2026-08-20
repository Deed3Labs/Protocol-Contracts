// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/stable-credit/ICollateralSource.sol";

/// @notice Test-only stand-in for the Phase 1 CollateralRegistry.
contract MockCollateralSource is ICollateralSource {
    uint256 private _unsecuredDebt;

    function setUnsecuredDebt(uint256 amount) external {
        _unsecuredDebt = amount;
    }

    function unsecuredDebt() external view override returns (uint256) {
        return _unsecuredDebt;
    }
}
