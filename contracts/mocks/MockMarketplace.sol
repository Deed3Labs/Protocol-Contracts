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
     * @return The selector of this function (0x150b7a02)
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
} 