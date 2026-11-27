// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IHousingAllowanceRecord
/// @notice What the Points Issuer needs from the Housing Allowance Record: somewhere to
/// put the dollar value of redeemed Credits, and to take it back on a reversal.
interface IHousingAllowanceRecord {
    /// @notice Adds `usd` (6 decimals) to the Credit Portion of `member`'s record for `homeId`.
    /// @dev Reverts unless the record is SIGNED, or if the member's lifetime Credit Portion would
    /// pass its cap.
    function creditFromCredits(address member, uint256 homeId, uint256 usd) external;

    /// @notice Takes `usd` back out of the Credit Portion, for Credits reversed after redemption.
    function reverseFromCredits(address member, uint256 homeId, uint256 usd) external;
}
