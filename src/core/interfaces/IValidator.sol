// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";

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
interface IValidator is IAccessControlUpgradeable {
    // ============ Events ============
    
    /**
     * @dev Emitted when a token is whitelisted or removed
     * @param token Address of the token
     * @param status New whitelist status
     */
    event TokenWhitelistUpdated(address indexed token, bool status);
    
    /**
     * @dev Emitted when service fee is updated
     * @param token Address of the token
     * @param fee New fee amount
     */
    event ServiceFeeUpdated(address indexed token, uint256 fee);
    
    /**
     * @dev Emitted when the FundManager address is updated
     * @param fundManager New FundManager address
     */
    event FundManagerUpdated(address indexed fundManager);
    
    /**
     * @dev Emitted when service fees are withdrawn
     * @param recipient Address receiving the fees
     * @param token Token being withdrawn
     * @param amount Amount withdrawn
     */
    event ServiceFeesWithdrawn(address indexed recipient, address indexed token, uint256 amount);
    
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

    // ============ Functions ============
    
    /**
     * @dev Sets the service fee for a token
     * @param token Address of the token
     * @param _serviceFee New service fee amount
     */
    function setServiceFee(address token, uint256 _serviceFee) external;
    
    /**
     * @dev Adds a token to the whitelist
     * @param token Address of the token
     */
    function addWhitelistedToken(address token) external;
    
    /**
     * @dev Removes a token from the whitelist
     * @param token Address of the token
     */
    function removeWhitelistedToken(address token) external;
    
    /**
     * @dev Sets the FundManager address
     * @param _fundManager New FundManager address
     */
    function setFundManager(address _fundManager) external;
    
    /**
     * @dev Withdraws accumulated service fees
     * @param token Address of the token
     */
    function withdrawServiceFees(address token) external;
}
