// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/stable-credit/ICollateralSource.sol";
import "../core/interfaces/stable-credit/ITargetRTDSource.sol";

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

/// @notice Test-only stand-in for the risk model that will supply the target RTD.
contract MockTargetRTDSource is ITargetRTDSource {
    uint256 private _targetRTD;

    function setTargetRTD(uint256 value) external {
        _targetRTD = value;
    }

    function targetRTD() external view override returns (uint256) {
        return _targetRTD;
    }
}
