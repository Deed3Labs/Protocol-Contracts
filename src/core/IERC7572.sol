// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

/**
 * @title IERC7572 Metadata Renderer Interface
 * @dev Interface for the ERC-7572 standard for NFT metadata rendering
 */
interface IERC7572 {
    /**
     * @dev Returns the URI for a token's metadata
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return Token URI
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view returns (string memory);
} 