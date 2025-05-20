// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// Interfaces
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IValidator.sol";
import "./interfaces/IFundManager.sol";

/**
 * @title ValidatorRegistry
 * @dev Registry contract for managing validator contracts and their capabilities.
 *      Enables dynamic validator management and asset type validation.
 *      
 * Security:
 * - Role-based access control for registry management
 * - Validator capability verification
 * - Interface compliance checks
 * 
 * Integration:
 * - Works with DeedNFT for asset validation
 * - Manages Validator contract registration
 * - Implements UUPSUpgradeable for upgradability
 */
contract ValidatorRegistry is
    Initializable,
    AccessControlUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ============ Role Definitions ============

    /// @notice Role for registry management operations
    /// @dev Has authority to add/remove validators and update their capabilities
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");

    // ============ Data Structures ============

    /**
     * @title ValidatorInfo
     * @dev Information about a registered validator
     * 
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

    // ============ State Variables ============

    /// @notice Mapping of validator addresses to their information
    /// @dev Key: validator address, Value: ValidatorInfo struct
    mapping(address => ValidatorInfo) public validators;

    /// @notice Mapping of asset types to their approved validators
    /// @dev Key: asset type ID, Value: array of validator addresses
    mapping(uint256 => address[]) public assetTypeValidators;

    /// @notice Array of all registered validator addresses
    address[] private validatorAddresses;

    address public fundManager;

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

    // ============ Upgrade Gap ============

    /// @dev Storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @dev Initializes the ValidatorRegistry contract
     */
    function initialize() public initializer {
        __AccessControl_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRY_ADMIN_ROLE, msg.sender);
        _transferOwnership(msg.sender);
    }

    /**
     * @dev Authorizes the contract upgrade. Only the owner can upgrade.
     * @param newImplementation Address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {
        // Authorization logic handled by onlyOwner modifier
    }

    function setFundManager(address _fundManager) external onlyOwner {
        require(_fundManager != address(0), "Invalid address");
        fundManager = _fundManager;
    }

    function _updateFundManagerRoles() internal {
        if (fundManager != address(0)) {
            IFundManager(fundManager).updateValidatorRoles();
        }
    }

    /**
     * @dev Registers a new validator.
     * @param validator Address of the validator contract.
     * @param name Name associated with the validator.
     * @param description Description of the validator's capabilities.
     * @param supportedAssetTypes Array of asset types this validator can handle.
     */
    function registerValidator(
        address validator,
        string memory name,
        string memory description,
        uint256[] memory supportedAssetTypes
    ) public onlyOwner {
        require(
            validator != address(0),
            "ValidatorRegistry: Invalid validator address"
        );
        require(
            bytes(name).length > 0,
            "ValidatorRegistry: Name cannot be empty"
        );
        require(
            bytes(validators[validator].name).length == 0,
            "ValidatorRegistry: Validator already registered"
        );

        validators[validator].name = name;
        validators[validator].description = description;
        validators[validator].supportedAssetTypes = supportedAssetTypes;
        validators[validator].isActive = true;
        
        // Add validator to the array
        validatorAddresses.push(validator);

        // Update asset type validators mapping
        for (uint256 i = 0; i < supportedAssetTypes.length; i++) {
            assetTypeValidators[supportedAssetTypes[i]].push(validator);
        }

        emit ValidatorRegistered(validator, name, supportedAssetTypes);
        _updateFundManagerRoles();
    }

    /**
     * @dev Removes a validator from the registry.
     * @param validator Address of the validator contract.
     */
    function removeValidator(address validator) public onlyOwner {
        require(
            bytes(validators[validator].name).length > 0,
            "ValidatorRegistry: Validator not registered"
        );

        // Remove validator from the array
        for (uint256 i = 0; i < validatorAddresses.length; i++) {
            if (validatorAddresses[i] == validator) {
                validatorAddresses[i] = validatorAddresses[validatorAddresses.length - 1];
                validatorAddresses.pop();
                break;
            }
        }

        delete validators[validator];
        emit ValidatorRegistered(validator, "", new uint256[](0));
        _updateFundManagerRoles();
    }

    /**
     * @dev Updates the name of a registered validator.
     * @param validator Address of the validator contract.
     * @param newName New name to associate with the validator.
     */
    function updateValidatorName(address validator, string memory newName)
        public
        onlyOwner
    {
        require(
            bytes(validators[validator].name).length > 0,
            "ValidatorRegistry: Validator not registered"
        );
        require(
            bytes(newName).length > 0,
            "ValidatorRegistry: Name cannot be empty"
        );

        validators[validator].name = newName;
        emit ValidatorRegistered(validator, newName, validators[validator].supportedAssetTypes);
    }

    /**
     * @dev Returns the name associated with a validator address.
     * @param validator Address of the validator.
     * @return Name string.
     */
    function getValidatorName(address validator)
        external
        view
        returns (string memory)
    {
        return validators[validator].name;
    }

    /**
     * @dev Checks if a validator is registered.
     * @param validator Address of the validator.
     * @return True if registered, false otherwise.
     */
    function isValidatorRegistered(address validator)
        external
        view
        returns (bool)
    {
        return bytes(validators[validator].name).length > 0;
    }

    /**
     * @dev Gets the supported asset types for a registered validator from the validator contract.
     * @param validator Address of the validator contract.
     */
    function getValidatorAssetTypes(address validator)
        public
        onlyOwner
    {
        require(
            bytes(validators[validator].name).length > 0,
            "ValidatorRegistry: Validator not registered"
        );

        // Get the validator contract
        IValidator validatorContract = IValidator(validator);
        
        // Create an array to store supported asset types
        uint256[] memory supportedTypes = new uint256[](4); // Assuming max 4 asset types
        uint256 count = 0;
        
        // Check each asset type (0-3)
        for (uint256 i = 0; i < 4; i++) {
            if (validatorContract.supportsAssetType(i)) {
                supportedTypes[count] = i;
                count++;
            }
        }
        
        // Resize the array to the actual count
        uint256[] memory assetTypes = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            assetTypes[i] = supportedTypes[i];
        }
        
        require(
            assetTypes.length > 0,
            "ValidatorRegistry: No supported asset types found"
        );

        validators[validator].supportedAssetTypes = assetTypes;
        emit ValidatorAssetTypesUpdated(validator, assetTypes);
    }

    /**
     * @dev Updates the operational status of a registered validator.
     * @param validator Address of the validator contract.
     * @param isActive New operational status.
     */
    function updateValidatorStatus(address validator, bool isActive)
        public
        onlyOwner
    {
        require(
            bytes(validators[validator].name).length > 0,
            "ValidatorRegistry: Validator not registered"
        );

        validators[validator].isActive = isActive;
        emit ValidatorStatusUpdated(validator, isActive);
        _updateFundManagerRoles();
    }

    /**
     * @dev Returns the supported asset types for a validator.
     * @param validator Address of the validator.
     * @return Array of supported asset type IDs.
     */
    function getSupportedAssetTypes(address validator)
        external
        view
        returns (uint256[] memory)
    {
        require(
            bytes(validators[validator].name).length > 0,
            "ValidatorRegistry: Validator not registered"
        );
        return validators[validator].supportedAssetTypes;
    }

    /**
     * @dev Returns an array of all active validator addresses.
     * @return Array of active validator addresses.
     */
    function getActiveValidators() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active validators
        for (uint256 i = 0; i < validatorAddresses.length; i++) {
            if (validators[validatorAddresses[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active validators
        address[] memory activeValidators = new address[](activeCount);
        uint256 index = 0;
        
        // Fill array with active validators
        for (uint256 i = 0; i < validatorAddresses.length; i++) {
            if (validators[validatorAddresses[i]].isActive) {
                activeValidators[index] = validatorAddresses[i];
                index++;
            }
        }
        
        return activeValidators;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * Adds support for the IValidatorRegistry interface.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return
            interfaceId == type(IValidatorRegistry).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
