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

    /// @notice a member paid down their balance, and this is that money.
    /// @dev Any part of it: a member clearing the lot after one cycle and a member paying the
    /// third of twelve instalments arrive here identically, and settle what that payment covers.
    /// Named for what it IS rather than for the transfer it makes, because the pool acts on the
    /// difference: money from a member settles the claims it pays, while capital buys them.
    function receiveRepayment(uint256 amount) external;

    /// @notice reserve tokens the pool is holding.
    function held() external view returns (uint256);

    /// @notice cash here that came from members clearing their balances.
    function memberFunded() external view returns (uint256);
}
