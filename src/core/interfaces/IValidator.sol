// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

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
     * @dev Validates a deed
     * @param tokenId ID of the deed
     * @return Whether the validation was successful
     */
    function validateDeed(uint256 tokenId) external returns (bool);

    /**
     * @dev Checks if a token is whitelisted by the validator.
     * @param token Address of the token.
     * @return Boolean indicating if the token is whitelisted.
     */
    function isTokenWhitelisted(address token) external view returns (bool);

    /**
     * @dev Retrieves the service fee for a specific token.
     * @param token Address of the token.
     * @return fee The service fee amount for the token.
     */
    function getServiceFee(address token) external view returns (uint256);

    /**
     * @dev Checks if an address has a specific role.
     * @param role The role to check.
     * @param account The address to check.
     * @return Boolean indicating if the address has the role.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);
}
