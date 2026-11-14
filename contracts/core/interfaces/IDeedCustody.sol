// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IDeedCustody
 * @notice Implemented by every Functional Contract that can hold a DeedNFT (trust agreement v5, item 5).
 * @dev A deed held by a subdivision, fractionalizer, escrow, bridge or the Coop transfer agent still
 *      belongs to its depositor or designated buyer, not to the contract holding the token. DeedNFT's
 *      `beneficialOwnerOf` asks the holder through this interface when the holder is a registered
 *      Functional Contract.
 */
interface IDeedCustody {
    /// @notice The account this contract holds `tokenId` for, or address(0) if it does not hold it.
    function beneficialOwnerOf(uint256 tokenId) external view returns (address);
}
