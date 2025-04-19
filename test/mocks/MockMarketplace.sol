// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title MockMarketplace
 * @dev A mock marketplace contract for testing purposes
 */
contract MockMarketplace is IERC721Receiver {
    /**
     * @dev Handles the receipt of an NFT
     * @param operator The address which called `safeTransferFrom` function
     * @param from The address which previously owned the token
     * @param tokenId The NFT identifier which is being transferred
     * @param data Additional data with no specified format
     * @return The selector of this function (0x150b7a02)
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes memory data
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
} 