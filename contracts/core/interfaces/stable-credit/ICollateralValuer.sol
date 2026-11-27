// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ICollateralValuer
/// @notice Values a pledge that is worth something different every day.
/// @dev A flat price per collateral kind works for anything whose value does not move on its own,
/// and for nothing else. A bond accretes from what was paid for it toward what it will pay, so
/// two bonds of the same kind maturing a year apart are not worth the same thing -- and an
/// operator keeping a single price up to date by hand would be wrong about both of them.
///
/// The plan puts it plainly: the haircut shrinks as maturity approaches, so the limit grows on
/// its own. It only does that if something is asked.
interface ICollateralValuer {
    /// @notice what a holder's pledged items are worth right now.
    /// @param holder address holding them.
    /// @param itemIds the pledged items.
    /// @return value total, in ledger units.
    function valueOfItems(address holder, uint256[] calldata itemIds)
        external
        view
        returns (uint256 value);
}
