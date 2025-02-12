// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

/**
 * @title IValidator
 * @dev Interface for Validator contracts used with DeedNFT.
 *      Defines required functionality for deed validation and metadata management.
 *      
 * Integration:
 * - Used by DeedNFT for asset validation
 * - Implemented by Validator contracts
 * - Supports metadata and operating agreement management
 */
interface IValidator {
    // ============ View Functions ============

    /**
     * @dev Returns the token URI for a given token ID
     * @param tokenId ID of the token to query
     * @return URI string containing token metadata
     */
    function tokenURI(uint256 tokenId) external view returns (string memory);

    /**
     * @dev Returns the default operating agreement URI
     * @return URI string for the default operating agreement
     */
    function defaultOperatingAgreement() external view returns (string memory);

    /**
     * @dev Returns the human-readable name for an operating agreement
     * @param uri_ URI of the operating agreement to query
     * @return Name string associated with the operating agreement
     */
    function operatingAgreementName(string memory uri_)
        external
        view
        returns (string memory);

    /**
     * @dev Checks if the validator supports a specific asset type
     * @param assetTypeId ID of the asset type to check
     * @return Boolean indicating support status
     */
    function supportsAssetType(uint256 assetTypeId) external view returns (bool);

    /**
     * @dev Validates a specific deed
     * @param deedId ID of the deed to validate
     * @return Boolean indicating validation success
     */
    function validateDeed(uint256 deedId) external returns (bool);
}
