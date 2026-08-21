// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IPayoutSink
/// @notice Where repayment value goes before it goes anywhere else.
/// @dev When a member clears their balance, value lands with the co-op -- and that value is what
/// pays the merchant holding the positive side of the purchase that created the balance. Sending
/// it straight to loss absorption puts the working capital for net-30 in the one fund forbidden
/// from funding a payout.
interface IPayoutSink {
    /// @notice what the pool needs to clear every queued claim today.
    function shortfall() external view returns (uint256);

    /// @notice takes value in.
    function donate(uint256 amount) external;
}
