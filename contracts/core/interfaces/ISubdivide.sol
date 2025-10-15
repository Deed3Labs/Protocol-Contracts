// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/IERC1155Upgradeable.sol";

/**
 * @title ISubdivide
 * @dev Interface for the Subdivide contract.
 *      Provides a standardized way for Validator contracts to interact with subdivision units.
 *      Consolidates functionality needed by Validator for subdivision validation.
 *      
 * Integration:
 * - Used by Validator for subdivision unit validation
 * - Supports ERC1155 standard for unit management
 * - Implements ERC-7496 for dynamic traits
 * - Provides subdivision-specific validation and trait management
 */
interface ISubdivide is IERC165Upgradeable, IERC1155Upgradeable {
    // ============ Role Constants ============
    
    /// @dev Role for validation operations
    function VALIDATOR_ROLE() external view returns (bytes32);
    
    // ============ Errors ============
    
    /// @dev Thrown when an operation is attempted on a non-existent subdivision
    error SubdivisionDoesNotExist();
    
    /// @dev Thrown when an operation is attempted by an unauthorized address
    error Unauthorized();
    
    /// @dev Thrown when an invalid parameter is provided
    error InvalidParameter();
    
    /// @dev Thrown when a unit is already validated
    error AlreadyValidated();

    // ============ Events ============
    
    /**
     * @dev Emitted when a subdivision unit is validated
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the validated unit
     * @param isValid Whether the unit is valid
     */
    event UnitValidated(uint256 indexed deedId, uint256 indexed unitId, bool isValid);
    
    /**
     * @dev Emitted when a subdivision unit trait is updated
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the updated trait
     * @param traitValue New value of the trait
     */
    event UnitTraitUpdated(uint256 indexed deedId, uint256 indexed unitId, bytes32 indexed traitKey, bytes traitValue);

    // ============ View Functions ============
    
    /**
     * @dev Returns the owner of a specific token
     * @param tokenId ID of the token to query
     * @return Address of the token owner
     */
    function ownerOf(uint256 tokenId) external view returns (address);
    
    /**
     * @dev Checks if a subdivision exists
     * @param deedId ID of the DeedNFT to check
     * @return Boolean indicating if the subdivision exists
     */
    function subdivisionExists(uint256 deedId) external view returns (bool);
    
    /**
     * @dev Checks if a subdivision unit exists
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit
     * @return Boolean indicating if the unit exists
     */
    function unitExists(uint256 deedId, uint256 unitId) external view returns (bool);
    
    /**
     * @dev Gets the URI for a specific token
     * @param tokenId ID of the token to query
     * @return URI string for the token metadata
     */
    function uri(uint256 tokenId) external view returns (string memory);
    
    /**
     * @dev Returns the validation status of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return isValidated Whether the unit is validated
     * @return validator Address of the validator that validated the unit
     */
    function getUnitValidationStatus(uint256 deedId, uint256 unitId) external view returns (bool isValidated, address validator);
    
    /**
     * @dev Returns the royalty information for a token
     * @param tokenId ID of the token
     * @param salePrice Sale price of the token
     * @return receiver Address that should receive royalties
     * @return royaltyAmount Amount of royalties to be paid
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount);

    // ============ Trait Functions ============
    
    /**
     * @dev Gets the value of a trait for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the trait to query
     * @return Value of the trait as bytes
     */
    function getUnitTraitValue(uint256 deedId, uint256 unitId, bytes32 traitKey) external view returns (bytes memory);

    /**
     * @dev Gets multiple trait values for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKeys Array of trait keys to query
     * @return Array of trait values as bytes
     */
    function getUnitTraitValues(uint256 deedId, uint256 unitId, bytes32[] calldata traitKeys) external view returns (bytes[] memory);

    /**
     * @dev Gets all trait keys for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return Array of trait keys
     */
    function getUnitTraitKeys(uint256 deedId, uint256 unitId) external view returns (bytes32[] memory);

    /**
     * @dev Gets the name of a trait
     * @param traitKey Key of the trait
     * @return Name of the trait
     */
    function getUnitTraitName(bytes32 traitKey) external view returns (string memory);

    /**
     * @dev Sets the name for a trait key
     * @param traitKey Key of the trait
     * @param traitName Name of the trait
     * @notice Only callable by admin
     */
    function setUnitTraitName(bytes32 traitKey, string memory traitName) external;

    /**
     * @dev Gets the trait metadata URI
     * @return URI of the trait metadata
     */
    function getUnitTraitMetadataURI() external pure returns (string memory);

    /**
     * @dev Sets a trait value with flexible input types
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the trait (either bytes32 or string)
     * @param traitValue Value of the trait (supports various types)
     * @param valueType Type of the value (0=bytes, 1=string, 2=uint256, 3=bool)
     */
    function setUnitTraitFlexible(uint256 deedId, uint256 unitId, bytes memory traitKey, bytes memory traitValue, uint8 valueType) external;

    /**
     * @dev Removes a trait from a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitName Name of the trait to remove
     */
    function removeUnitTrait(uint256 deedId, uint256 unitId, string memory traitName) external;

    // ============ Validation Functions ============
    
    /**
     * @dev Updates the validation status of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit to validate
     * @param isValid Whether the unit is valid
     * @param validatorAddress Address of the validator
     * @notice This function can only be called by a registered validator
     */
    function updateUnitValidationStatus(uint256 deedId, uint256 unitId, bool isValid, address validatorAddress) external;
    
    // ============ Access Control Functions ============
    
    /**
     * @dev Checks if an account has a specific role
     * @param role Role identifier
     * @param account Account to check
     * @return Boolean indicating if the account has the role
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Grants a role to an account
     * @param role Role identifier
     * @param account Account to grant the role to
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Approves a marketplace for trading
     * @param marketplace Address of the marketplace
     * @param approved Whether the marketplace is approved
     */
    function setApprovedMarketplace(address marketplace, bool approved) external;

    /**
     * @dev Checks if a marketplace is approved
     * @param marketplace Address of the marketplace
     * @return Whether the marketplace is approved
     */
    function isApprovedMarketplace(address marketplace) external view returns (bool);

    /**
     * @dev Sets whether royalties are enforced
     * @param enforced Whether royalties are enforced
     */
    function setRoyaltyEnforcement(bool enforced) external;

    /**
     * @dev Checks if royalties are enforced
     * @return Whether royalties are enforced
     */
    function isRoyaltyEnforced() external view returns (bool);

    /**
     * @dev Gets the transfer validator address
     * @return validator The address of the transfer validator
     */
    function getTransferValidator() external view returns (address validator);

    /**
     * @dev Sets the transfer validator address
     * @param validator The address of the transfer validator
     */
    function setTransferValidator(address validator) external;

    /**
     * @dev Returns the function selector for the transfer validator's validation function
     * @return functionSignature The function signature
     * @return isViewFunction Whether the function is a view function
     */
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction);

    /**
     * @dev Checks if the contract implements an interface
     * @param interfaceId Interface identifier (ERC165)
     * @return Boolean indicating if the interface is supported
     */
    function supportsInterface(bytes4 interfaceId) external view override returns (bool);

    /**
     * @dev Gets the asset type of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return assetType Type of the asset
     */
    function getUnitAssetType(uint256 deedId, uint256 unitId) external view returns (uint8);

    /**
     * @dev Checks if a subdivision unit is validated
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return isValidated Whether the unit is validated
     */
    function isUnitValidated(uint256 deedId, uint256 unitId) external view returns (bool);

    // ============ Role Management Functions ============
    
    /**
     * @dev Grants the VALIDATOR_ROLE to an address.
     * @param validator Address to grant the VALIDATOR_ROLE to.
     */
    function addValidator(address validator) external;
    
    /**
     * @dev Revokes the VALIDATOR_ROLE from an address.
     * @param validator Address to revoke the VALIDATOR_ROLE from.
     */
    function removeValidator(address validator) external;
}
