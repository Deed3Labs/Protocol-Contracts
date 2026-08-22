// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IEncumbranceSource
/// @notice Reports how much of a holder's balance is standing behind drawn credit.
/// @dev The member's smart account holds the CLRUSD; the co-op does not custody it. A registry
/// can record that a pledge is spoken for, but recording is not enforcing -- nothing in a ledger
/// of promises stops the holder moving the asset.
///
/// Enforcement has to sit somewhere the holder cannot route around, and there are only two such
/// places: the account, through a module it cannot uninstall while encumbered, and the asset
/// itself. The asset is the stronger of the two, because it holds for every transfer path
/// including ones nobody anticipated, and for holders that are not smart accounts at all.
interface IEncumbranceSource {
    /// @notice the amount of a holder's balance that may not leave.
    /// @dev Scales with what has been drawn, not with what was pledged. A member who pledges and
    /// draws nothing is not locked up, and one who repays sees the lock recede -- which is the
    /// redemption lock the credit line describes, arriving from the asset's side.
    /// @param holder address holding the asset.
    /// @return amount that must remain.
    function encumberedOf(address holder) external view returns (uint256);

    /// @notice the amount of one kind of pledge that may not leave.
    /// @dev Collateral is not all one asset. CLRUSD asks the question without qualifying it
    /// because it is only ever itself; anything else has to say which pledge it is asking about,
    /// or it would be told how much of somebody's savings are locked and lock its own shares by
    /// that number.
    /// @param holder address holding the asset.
    /// @param kind collateral type.
    /// @return amount that must remain.
    function encumberedOfKind(address holder, bytes32 kind) external view returns (uint256);

    /// @notice whether one specific pledged thing may leave.
    /// @dev Amount-based collateral answers how much must stay. Something with an identity has to
    /// answer whether this one may go, because half a bond is not a thing.
    /// @param holder address holding it.
    /// @param kind collateral type.
    /// @param itemId the item.
    /// @return whether it is spoken for.
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId)
        external
        view
        returns (bool);
}
