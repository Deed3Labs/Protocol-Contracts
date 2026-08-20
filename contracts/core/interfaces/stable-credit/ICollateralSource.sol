// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ICollateralSource
/// @notice Reports how much of the credit outstanding is *not* covered by collateral.
/// @dev The AssurancePool reserves against loss, and fully-collateralized credit cannot produce
/// one: a default there is covered by liquidating the collateral, which returns the credit rather
/// than orphaning it. Reserving against total credit outstanding therefore over-reserves by
/// roughly the collateralized share of the book.
///
/// This is the seam for that figure. Phase 1's CollateralRegistry implements it by valuing what
/// each member has pledged; until then the AssurancePool falls back to treating all credit as
/// unsecured, which is the inherited behaviour and the conservative direction to be wrong in.
interface ICollateralSource {
    /// @notice the portion of credit outstanding that no collateral stands behind.
    /// @dev Denominated in stable credit, directly comparable to `IStableCredit.totalSupply()`,
    /// and must never exceed it.
    /// @return amount of unsecured credit outstanding.
    function unsecuredDebt() external view returns (uint256);
}
