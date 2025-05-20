// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/**
 * @title IValidatorRegistry
 * @dev Interface for the ValidatorRegistry contract.
 *      Defines required functionality for validator management and lookup.
 *      
 * Integration:
 * - Used by DeedNFT for validator verification
 * - Used by FundManager for validator ownership checks
 * - Supports validator registration and capability management
 */
interface IValidatorRegistry {
    // ============ Structs ============

    /**
     * @dev Information about a registered validator
     * @param isActive Current operational status
     * @param supportedAssetTypes List of asset types this validator can handle
     * @param name Human-readable name of the validator
     * @param description Detailed description of validator capabilities
     */
    struct ValidatorInfo {
        bool isActive;
        uint256[] supportedAssetTypes;
        string name;
        string description;
    }

    // ============ Events ============

    /**
     * @dev Emitted when a new validator is registered
     * @param validator Address of the registered validator
     * @param name Name of the validator
     * @param supportedAssetTypes Array of supported asset type IDs
     */
    event ValidatorRegistered(
        address indexed validator,
        string name,
        uint256[] supportedAssetTypes
    );

    /**
     * @dev Emitted when a validator's status is updated
     * @param validator Address of the affected validator
     * @param isActive New operational status
     */
    event ValidatorStatusUpdated(address indexed validator, bool isActive);

    /**
     * @dev Emitted when a validator's supported asset types are updated
     * @param validator Address of the affected validator
     * @param assetTypes Updated array of supported asset type IDs
     */
    event ValidatorAssetTypesUpdated(
        address indexed validator,
        uint256[] assetTypes
    );

    // ============ View Functions ============

    /**
     * @dev Returns information about a validator
     * @param validator Address of the validator
     * @return ValidatorInfo struct containing validator details
     */
    function validators(address validator) external view returns (ValidatorInfo memory);

    /**
     * @dev Returns all validators supporting an asset type
     * @param assetTypeId ID of the asset type
     * @return Array of validator addresses
     */
    function assetTypeValidators(uint256 assetTypeId) external view returns (address[] memory);

    /**
     * @dev Checks if a validator is registered
     * @param validator Address of the validator
     * @return Boolean indicating if the validator is registered
     */
    function isValidatorRegistered(address validator) external view returns (bool);

    /**
     * @dev Gets the name of a validator
     * @param validator Address of the validator
     * @return Name of the validator
     */
    function getValidatorName(address validator) external view returns (string memory);

    /**
     * @dev Returns the supported asset types for a validator
     * @param validator Address of the validator
     * @return Array of supported asset type IDs
     */
    function getSupportedAssetTypes(address validator) external view returns (uint256[] memory);

    /**
     * @dev Returns an array of all active validator addresses
     * @return Array of active validator addresses
     */
    function getActiveValidators() external view returns (address[] memory);

    // ============ State-Changing Functions ============

    /**
     * @dev Registers a new validator
     * @param validator Address of the validator contract
     * @param name Name associated with the validator
     * @param description Description of the validator's capabilities
     * @param supportedAssetTypes Array of asset types this validator can handle
     */
    function registerValidator(
        address validator,
        string memory name,
        string memory description,
        uint256[] memory supportedAssetTypes
    ) external;

    /**
     * @dev Removes a validator from the registry
     * @param validator Address of the validator contract
     */
    function removeValidator(address validator) external;

    /**
     * @dev Updates the name of a registered validator
     * @param validator Address of the validator contract
     * @param newName New name to associate with the validator
     */
    function updateValidatorName(address validator, string memory newName) external;

    /**
     * @dev Gets the supported asset types for a registered validator from the validator contract
     * @param validator Address of the validator contract
     */
    function getValidatorAssetTypes(address validator) external;

    /**
     * @dev Updates the operational status of a registered validator
     * @param validator Address of the validator contract
     * @param isActive New operational status
     */
    function updateValidatorStatus(address validator, bool isActive) external;

    /**
     * @dev Sets the FundManager address.
     * @param _fundManager New FundManager address.
     */
    function setFundManager(address _fundManager) external;

    /**
     * @dev Internal function to update FundManager roles.
     */
    function _updateFundManagerRoles() external;
}
