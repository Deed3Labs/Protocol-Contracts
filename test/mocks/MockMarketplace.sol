// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "../../contracts/core/interfaces/IMarketplace.sol";

/**
 * @title MockMarketplace
 * @dev A mock marketplace contract for testing purposes
 */
contract MockMarketplace is IERC721Receiver, IMarketplace {
    // Mock sale prices for testing
    mapping(uint256 => uint256) private _salePrices;
    mapping(uint256 => address) private _paymentTokens;
    
    /**
     * @dev Sets a mock sale price for a token
     * @param tokenId The ID of the token
     * @param price The sale price
     * @param token The payment token address (address(0) for ETH)
     */
    function setSalePrice(uint256 tokenId, uint256 price, address token) external {
        _salePrices[tokenId] = price;
        _paymentTokens[tokenId] = token;
    }
    
    /**
     * @dev Gets the sale price for a token
     * @param tokenId The ID of the token
     * @return price The sale price
     * @return token The token address (address(0) for ETH)
     */
    function getSalePrice(uint256 tokenId) external view override returns (uint256 price, address token) {
        return (_salePrices[tokenId], _paymentTokens[tokenId]);
    }

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