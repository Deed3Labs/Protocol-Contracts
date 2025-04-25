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
     * @dev Parses metadata JSON and sets traits in DeedNFT
     * @param tokenId ID of the token
     * @param metadataUrl Gateway URL containing the metadata JSON
     * @param deedNFTContract Address of the DeedNFT contract to set traits on
     */
    function parseAndSetTraitsFromURL(
        uint256 tokenId,
        string memory metadataUrl,
        address deedNFTContract
    ) external;

    /**
     * @dev Sets the base gateway URL for metadata resolution
     * @param gatewayURL The base gateway URL (e.g., "https://gateway.pinata.cloud/ipfs/")
     */
    function setGatewayURL(string memory gatewayURL) external;

    /**
     * @dev Returns the current gateway URL
     */
    function getGatewayURL() external view returns (string memory);
}