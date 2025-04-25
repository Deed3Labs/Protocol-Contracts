// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IERC7572 External Metadata Extension for NFTs
 * @dev Interface for the ERC7572 standard
 */
interface IERC7572 {
    /**
     * @dev Returns the Uniform Resource Identifier (URI) for `tokenId` token.
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view returns (string memory);

    /**
     * @dev Parses IPFS JSON and sets traits in DeedNFT
     * @param tokenId ID of the token
     * @param ipfsHash IPFS hash containing the metadata
     * @param deedNFTContract Address of the DeedNFT contract to set traits on
     */
    function parseAndSetTraitsFromIPFS(
        uint256 tokenId,
        string memory ipfsHash,
        address deedNFTContract
    ) external;
}