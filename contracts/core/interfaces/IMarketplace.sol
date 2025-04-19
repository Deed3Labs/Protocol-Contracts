// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IMarketplace
 * @dev Interface for marketplace contracts to provide sale price information
 */
interface IMarketplace {
    /**
     * @dev Gets the sale price for a token
     * @param tokenId The ID of the token
     * @return price The sale price
     * @return token The token address (address(0) for ETH)
     */
    function getSalePrice(uint256 tokenId) external view returns (uint256 price, address token);
} 