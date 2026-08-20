// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ITargetRTDSource
/// @notice Supplies the target reserve-to-debt ratio the AssurancePool reserves toward.
/// @dev The AssuranceOracle's real job is the *predicted default rate* — a figure derived from
/// internally-generated credit-risk signals (ESA balances, deposit history, repayment behaviour,
/// cycle-rebalance rates), not from token prices. That model needs contracts that do not exist
/// yet, so this interface is the seam it will plug into.
///
/// Until one is registered the oracle serves an operator-set constant, which is the inherited
/// behaviour. Registering a source turns the target from a number someone chooses into a number
/// the book produces.
interface ITargetRTDSource {
    /// @notice the target reserve to debt ratio, where 1 ether == 100%.
    /// @return target RTD.
    function targetRTD() external view returns (uint256);
}
