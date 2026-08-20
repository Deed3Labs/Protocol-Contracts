// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/stable-credit/IExposureSource.sol";
import "../core/interfaces/stable-credit/ITargetRTDSource.sol";
import "../libraries/ExposureMath.sol";

/// @notice Test-only stand-in for the Phase 1 CollateralRegistry.
/// @dev Positions are supplied directly and the exposure is computed with the production
/// ExposureMath, so a test exercising this exercises the real rule rather than a restatement
/// of it.
contract MockExposureSource is IExposureSource {
    struct Position {
        bytes32 kind;
        uint256 debt;
        uint256 collateralValue;
        uint256 haircutBps;
    }

    Position[] public positions;

    function addPosition(
        bytes32 kind,
        uint256 debt,
        uint256 collateralValue,
        uint256 haircutBps
    ) external {
        positions.push(Position(kind, debt, collateralValue, haircutBps));
    }

    function clear() external {
        delete positions;
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function poolExposure() external view override returns (uint256 exposure) {
        for (uint256 i = 0; i < positions.length; i++) {
            Position storage p = positions[i];
            exposure += ExposureMath.positionExposure(
                p.kind, p.debt, p.collateralValue, p.haircutBps
            );
        }
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

/// @notice Test-only wrapper exposing ExposureMath's internal functions to the test suite.
contract ExposureMathHarness {
    function positionExposure(
        bytes32 kind,
        uint256 debt,
        uint256 collateralValue,
        uint256 haircutBps
    ) external pure returns (uint256) {
        return ExposureMath.positionExposure(kind, debt, collateralValue, haircutBps);
    }

    function backingOf(bytes32 kind) external pure returns (uint8) {
        return uint8(ExposureMath.backingOf(kind));
    }

    function isAssetBacked(uint8 backing) external pure returns (bool) {
        return ExposureMath.isAssetBacked(ExposureMath.Backing(backing));
    }

    function SAVINGS() external pure returns (bytes32) { return ExposureMath.SAVINGS; }
    function ASSET_EXTERNAL() external pure returns (bytes32) { return ExposureMath.ASSET_EXTERNAL; }
    function ASSET_INTERNAL() external pure returns (bytes32) { return ExposureMath.ASSET_INTERNAL; }
    function INCOME() external pure returns (bytes32) { return ExposureMath.INCOME; }
    function BOOST() external pure returns (bytes32) { return ExposureMath.BOOST; }
}
