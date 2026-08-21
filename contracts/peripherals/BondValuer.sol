// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../core/interfaces/stable-credit/ICollateralValuer.sol";

interface IPresentValueBond {
    function presentValueOf(uint256 bondId) external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// @title BondValuer
/// @notice Answers what somebody's pledged bonds are worth today.
/// @dev A separate contract because it reads only public views and the collection it reads has no
/// room to spare. It also means the answer can be changed -- straight-line accretion today,
/// discounted at the issuance yield later -- without touching a contract that holds bonds.
///
/// This is what makes the limit grow on its own. A bond accretes from what was paid for it toward
/// what it will pay, so a flat price per collateral kind is wrong about every bond that is not
/// exactly average, and wrong about all of them tomorrow.
contract BondValuer is ICollateralValuer {
    IPresentValueBond public immutable collection;

    constructor(address _collection) {
        collection = IPresentValueBond(_collection);
    }

    /// @inheritdoc ICollateralValuer
    /// @dev A bond the holder no longer has is worth nothing to them, whatever the registry still
    /// believes. Valuing a pledge somebody has parted with is how a limit outlives its collateral.
    function valueOfItems(address holder, uint256[] calldata itemIds)
        external
        view
        override
        returns (uint256 value)
    {
        for (uint256 i = 0; i < itemIds.length; i++) {
            if (collection.balanceOf(holder, itemIds[i]) == 0) continue;
            value += collection.presentValueOf(itemIds[i]);
        }
    }
}
