// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IPoolEarnControls
/// @notice The part of the shared Earn controls (decision 1, `EarnControls`) the Yield Pool reads.
/// @dev A minimal interface so the pool can be built and tested before `EarnControls` exists.
/// `EarnControls` implements it; until then tests use `MockEarnControls`. The pool fails closed
/// when no controls are set: no subscription and no holder-to-holder transfer succeeds.
interface IPoolEarnControls {
    /// @notice Checks a subscription and returns the exemption tag from its eligibility attestation.
    /// @dev Reverts unless `payer` is an eligible Smart Account paying with Ready to allocate USDC
    /// (IV-02 §2.1), is not a Clear contract holding ESA capital, CLRUSD, collateral, credit
    /// proceeds or Earn funds, and the subscription is within the Funding Limit. Non-view so the
    /// controls may consume an attestation nonce. The pool stores and emits the tag and never
    /// branches on it (Earn Addendum 2 §6).
    /// @param payer the account paying the USDC.
    /// @param receiver the account the Pool Shares are minted to.
    /// @param assets the USDC paid.
    /// @param attestation the eligibility attestation, opaque to the pool.
    /// @return exemptionCode the offering exemption tag, e.g. "506C", "506B" or "147A".
    function checkSubscription(address payer, address receiver, uint256 assets, bytes calldata attestation)
        external
        returns (bytes32 exemptionCode);

    /// @notice Whether subscriptions are paused: a Reserve Shortfall, or the Equity Cushion pause
    /// (L-01 §8.6A, set and cleared by two people in the controls).
    function subscriptionsPaused() external view returns (bool);

    /// @notice Every wallet of the member that owns `account`, including `account` itself.
    /// @dev The 10% holder cap counts per member across all of their wallets (decision 13).
    function walletsOf(address account) external view returns (address[] memory);

    /// @notice Whether Pool Shares may move from `from` to `to`: two Smart Accounts of the same
    /// Holder, or the Successor path approved by two people with an evidence hash (§6, FIXED).
    function transferAllowed(address from, address to) external view returns (bool);
}
