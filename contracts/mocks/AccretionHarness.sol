// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../libraries/Accretion.sol";

/// @notice Test-only wrapper exposing the Accretion library.
contract AccretionHarness {
    function accretedValue(uint256 maturityAmount, uint256 yieldBps, uint256 maturityDate, uint256 timestamp)
        external
        pure
        returns (uint256)
    {
        return Accretion.accretedValue(maturityAmount, yieldBps, maturityDate, timestamp);
    }

    function presentValue(uint256 maturityAmount, uint256 yieldBps, uint256 daysLeft) external pure returns (uint256) {
        return Accretion.presentValue(maturityAmount, yieldBps, daysLeft);
    }

    function daysRemaining(uint256 maturityDate, uint256 timestamp) external pure returns (uint256) {
        return Accretion.daysRemaining(maturityDate, timestamp);
    }

    function purchasePrice(uint256 maturityAmount, uint256 yieldBps, uint256 termDays) external pure returns (uint256) {
        return Accretion.purchasePrice(maturityAmount, yieldBps, termDays);
    }

    function maturityAmountFor(uint256 price, uint256 yieldBps, uint256 termDays, uint256 unit)
        external
        pure
        returns (uint256)
    {
        return Accretion.maturityAmountFor(price, yieldBps, termDays, unit);
    }

    function rollTerms(uint256 oldMaturityAmount, uint256 yieldBps, uint256 termDays, uint256 unit)
        external
        pure
        returns (uint256 newMaturityAmount, uint256 price, uint256 remainder)
    {
        return Accretion.rollTerms(oldMaturityAmount, yieldBps, termDays, unit);
    }

    function growthUp(uint256 yieldBps, uint256 daysLeft) external pure returns (uint256) {
        return Accretion.growthUp(yieldBps, daysLeft);
    }

    function growthDown(uint256 yieldBps, uint256 daysLeft) external pure returns (uint256) {
        return Accretion.growthDown(yieldBps, daysLeft);
    }

    function dayFactorUp(uint256 yieldBps) external pure returns (uint256) {
        return Accretion.dayFactorUp(yieldBps);
    }

    function dayFactorDown(uint256 yieldBps) external pure returns (uint256) {
        return Accretion.dayFactorDown(yieldBps);
    }

    /// @notice gas used by one Accreted Value read, for the report.
    function accretedValueGas(uint256 maturityAmount, uint256 yieldBps, uint256 maturityDate, uint256 timestamp)
        external
        view
        returns (uint256 value, uint256 gasUsed)
    {
        uint256 g = gasleft();
        value = Accretion.accretedValue(maturityAmount, yieldBps, maturityDate, timestamp);
        gasUsed = g - gasleft();
    }
}
