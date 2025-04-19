// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../../contracts/core/interfaces/IERC7572.sol";

/**
 * @title MockRenderer
 * @dev A mock implementation of the IERC7572 interface for testing purposes
 */
contract MockRenderer is IERC7572 {
    mapping(address => mapping(uint256 => string)) private _tokenURIs;
    
    /**
     * @dev Sets the token URI for a specific token
     * @param tokenContract The address of the token contract
     * @param tokenId The ID of the token
     * @param uri The URI to set
     */
    function setTokenURI(address tokenContract, uint256 tokenId, string memory uri) external {
        _tokenURIs[tokenContract][tokenId] = uri;
    }
    
    /**
     * @dev Returns the token URI for a specific token
     * @param tokenContract The address of the token contract
     * @param tokenId The ID of the token
     * @return The token URI
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view returns (string memory) {
        return _tokenURIs[tokenContract][tokenId];
    }
} 