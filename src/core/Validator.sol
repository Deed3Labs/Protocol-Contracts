// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";

// Interface
import "./IValidator.sol";

/**
 * @title IDeedNFT Interface
 * @dev Interface for interacting with the DeedNFT contract.
 */
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function validateDeed(uint256 deedId, bool isValid, address validatorAddress) external;
    
    // New trait-based methods
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory);
}

/**
 * @title Validator
 * @dev Base contract for implementing deed validation logic.
 *      Provides core functionality for asset validation and metadata management.
 *      
 * Security:
 * - Role-based access control for validation operations
 * - Protected metadata management
 * - Configurable asset type support
 * 
 * Integration:
 * - Works with DeedNFT for asset validation
 * - Implements IValidator interface
 * - Supports UUPSUpgradeable for upgradability
 * - Aligns validation criteria with MetadataRenderer property structure
 */
contract Validator is
    Initializable,
    AccessControlUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IValidator
{
    using StringsUpgradeable for uint256;

    // ============ Role Definitions ============

    /// @notice Role for validation operations
    /// @dev Has authority to perform deed validations
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    /// @notice Role for metadata management
    /// @dev Has authority to update operating agreements and URIs
    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");

    /// @notice Role for updating validation criteria
    bytes32 public constant CRITERIA_MANAGER_ROLE = keccak256("CRITERIA_MANAGER_ROLE");

    // ============ State Variables ============

    /// @notice Base URI for token metadata
    string public baseUri;

    /// @notice Default operating agreement URI
    string public defaultOperatingAgreementUri;

    /// @notice Reference to the DeedNFT contract
    /// @dev Used for deed information retrieval and validation
    IDeedNFT public deedNFT;

    /// @notice Mapping of supported asset types
    /// @dev Key: asset type ID, Value: support status
    mapping(uint256 => bool) public supportedAssetTypes;

    /// @notice Mapping of operating agreement URIs to their names
    /// @dev Key: agreement URI, Value: human-readable name
    mapping(string => string) public operatingAgreements;

    /// @notice Mapping of deed IDs to their metadata URIs
    /// @dev Key: deed ID, Value: metadata URI
    mapping(uint256 => string) public deedMetadata;

    /// @notice Mapping of asset types to their validation criteria
    /// @dev Key: asset type ID, Value: validation criteria JSON string
    /// @notice Criteria should align with MetadataRenderer property structure
    mapping(uint256 => string) public validationCriteria;

    // Mapping to track compatible DeedNFT contracts
    mapping(address => bool) public compatibleDeedNFTs;
    
    // Main DeedNFT address
    address public primaryDeedNFT;

    // ============ Validation Criteria Structure ============
    
    /**
     * @dev Struct defining required property details for validation
     * @notice This mirrors the PropertyDetails struct in MetadataRenderer
     * @notice Used for documentation purposes only - not stored on-chain
     */
    struct ValidationRequirements {
        bool requiresCountry;
        bool requiresState;
        bool requiresCounty;
        bool requiresCity;
        bool requiresStreetName;
        bool requiresStreetNumber;
        bool requiresParcelNumber;
        bool requiresHoldingEntity;
        bool requiresLatitude;
        bool requiresLongitude;
        bool requiresAcres;
        bool requiresParcelUse;
        bool requiresZoning;
        bool requiresZoningCode;
        bool requiresLegalDescription;
        bool requiresRecordingInfo;
        bool requiresUtilities;
    }

    // ============ Events ============

    /**
     * @dev Emitted when an asset type's support status is updated
     * @param assetTypeId ID of the asset type
     * @param isSupported New support status
     */
    event AssetTypeSupportUpdated(uint256 indexed assetTypeId, bool isSupported);

    /**
     * @dev Emitted when an operating agreement is registered
     * @param uri URI of the agreement
     * @param name Human-readable name of the agreement
     */
    event OperatingAgreementRegistered(string uri, string name);

    /**
     * @dev Emitted when a deed's metadata is updated
     * @param deedId ID of the affected deed
     * @param metadataUri New metadata URI
     */
    event DeedMetadataUpdated(uint256 indexed deedId, string metadataUri);

    /**
     * @dev Emitted when a deed is validated
     * @param deedId ID of the validated deed
     * @param success Validation result
     */
    event DeedValidated(uint256 indexed deedId, bool success);

    /**
     * @dev Emitted when the base URI is updated
     * @param newBaseUri The new base URI
     */
    event BaseUriUpdated(string newBaseUri);

    /**
     * @dev Emitted when the default operating agreement is updated
     * @param uri The new default operating agreement URI
     */
    event DefaultOperatingAgreementUpdated(string uri);

    /**
     * @dev Emitted when the DeedNFT contract is updated
     * @param newDeedNFT The new DeedNFT contract address
     */
    event DeedNFTUpdated(address indexed newDeedNFT);

    /**
     * @dev Emitted when validation criteria is updated for an asset type
     * @param assetTypeId ID of the asset type
     * @param criteria New validation criteria
     */
    event ValidationCriteriaUpdated(uint256 indexed assetTypeId, string criteria);

    /**
     * @dev Emitted when a validation error occurs
     * @param deedId ID of the deed
     * @param reason Error message
     */
    event ValidationError(uint256 indexed deedId, string reason);

    // ============ Upgrade Gap ============

    /// @dev Storage gap for future upgrades
    uint256[48] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default settings
     * @param _baseUri Base URI for token metadata
     * @param _defaultOperatingAgreementUri Default operating agreement URI
     */
    function initialize(
        string memory _baseUri,
        string memory _defaultOperatingAgreementUri
    ) public initializer {
        __AccessControl_init();
        __Ownable_init();
        __UUPSUpgradeable_init();
        
        baseUri = _baseUri;
        defaultOperatingAgreementUri = _defaultOperatingAgreementUri;
        
        // Register the default operating agreement with a name
        operatingAgreements[_defaultOperatingAgreementUri] = "Default Operating Agreement";
        
        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);
        _grantRole(CRITERIA_MANAGER_ROLE, msg.sender);
        
        // Initialize default validation criteria for Land assets
        string memory defaultLandCriteria = '{"requiresCountry":true,"requiresState":true,"requiresCounty":true,"requiresParcelNumber":true,"requiresLegalDescription":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.Land)] = defaultLandCriteria;
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

    // Public functions

    /**
     * @dev Sets the base URI for token metadata.
     * @param _newBaseUri The new base URI.
     */
    function setBaseUri(string memory _newBaseUri) public onlyOwner {
        require(bytes(_newBaseUri).length > 0, "Validator: Base URI cannot be empty");
        baseUri = _newBaseUri;
        emit BaseUriUpdated(_newBaseUri);
    }

    /**
     * @dev Returns the base URI.
     * @return The base URI string.
     */
    function getBaseUri() public view returns (string memory) {
        return baseUri;
    }

    /**
     * @dev Sets the default operating agreement URI.
     * @param _uri The new default operating agreement URI.
     */
    function setDefaultOperatingAgreement(string memory _uri) public onlyOwner {
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        defaultOperatingAgreementUri = _uri;
        emit DefaultOperatingAgreementUpdated(_uri);
    }

    /**
     * @dev Returns the default operating agreement URI.
     * @return The default operating agreement URI.
     */
    function defaultOperatingAgreement()
        external
        view
        override
        returns (string memory)
    {
        return defaultOperatingAgreementUri;
    }

    /**
     * @dev Adds or updates the name for a given operating agreement URI.
     * @param _uri The URI of the operating agreement.
     * @param _name The name to associate with the URI.
     */
    function setOperatingAgreementName(string memory _uri, string memory _name)
        public
        onlyOwner
    {
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        require(bytes(_name).length > 0, "Validator: Name cannot be empty");
        operatingAgreements[_uri] = _name;
        emit OperatingAgreementRegistered(_uri, _name);
    }

    /**
     * @dev Removes the name associated with an operating agreement URI.
     * @param _uri The URI to remove.
     */
    function removeOperatingAgreementName(string memory _uri)
        public
        onlyOwner
    {
        require(
            bytes(operatingAgreements[_uri]).length > 0,
            "Validator: URI does not exist"
        );
        delete operatingAgreements[_uri];
        emit OperatingAgreementRegistered(_uri, "");
    }

    /**
     * @dev Returns the name associated with an operating agreement URI.
     * @param _uri The URI of the operating agreement.
     * @return The name string.
     */
    function operatingAgreementName(string memory _uri)
        external
        view
        override
        returns (string memory)
    {
        return operatingAgreements[_uri];
    }

    /**
     * @dev Returns the token URI for a given token ID.
     * @param tokenId The ID of the token.
     * @return The token URI string.
     */
    function tokenURI(uint256 tokenId)
        external
        view
        override
        returns (string memory)
    {
        require(bytes(baseUri).length > 0, "Validator: Base URI is not set");
        return string(abi.encodePacked(baseUri, tokenId.toString()));
    }

    /**
     * @dev Checks if the validator supports a specific asset type
     * @param assetTypeId ID of the asset type to check
     * @return Boolean indicating support status
     */
    function supportsAssetType(uint256 assetTypeId) 
        external 
        view 
        override 
        returns (bool) 
    {
        return supportedAssetTypes[assetTypeId];
    }

    /**
     * @dev Validates a deed against criteria and updates its status
     * @param deedId ID of the deed to validate
     * @return success Whether the validation was successful
     * @notice This is the main validation function that should be called by validators
     */
    function validateDeed(uint256 deedId) 
        external 
        onlyRole(VALIDATOR_ROLE) 
        returns (bool success) 
    {
        // First perform validation checks
        bool validationResult = _validateDeedAgainstCriteria(deedId);
        
        if (validationResult) {
            // If validation passes, update the status in DeedNFT
            try IDeedNFT(deedNFT).validateDeed(deedId, true, address(this)) {
                emit DeedValidated(deedId, true);
                return true;
            } catch Error(string memory reason) {
                // Handle specific revert reasons
                emit ValidationError(deedId, reason);
                return false;
            } catch (bytes memory) {
                // Handle other errors
                emit ValidationError(deedId, "Unknown error during validation");
                return false;
            }
        } else {
            // If validation fails, we can optionally mark it as invalid
            try IDeedNFT(deedNFT).validateDeed(deedId, false, address(0)) {
                emit DeedValidated(deedId, false);
            } catch {
                // If updating status fails, just emit the event
                emit DeedValidated(deedId, false);
            }
            return false;
        }
    }

    /**
     * @dev Internal function that performs the actual validation logic
     * @param deedId ID of the deed to validate
     * @return Whether the deed passes all validation checks
     */
    function _validateDeedAgainstCriteria(uint256 deedId) 
        internal 
        view 
        returns (bool) 
    {
        require(address(deedNFT) != address(0), "Validator: DeedNFT not set");
        require(compatibleDeedNFTs[address(deedNFT)], "Validator: Incompatible DeedNFT");
        
        // Get asset type
        bytes memory assetTypeBytes = deedNFT.getTraitValue(deedId, keccak256("assetType"));
        require(assetTypeBytes.length > 0, "Validator: Asset type not set");
        uint256 assetType = abi.decode(assetTypeBytes, (uint256));
        
        // Check if this asset type is supported
        require(supportedAssetTypes[assetType], "Validator: Asset type not supported");
        
        // Get validation criteria for this asset type
        string memory criteria = validationCriteria[assetType];
        require(bytes(criteria).length > 0, "Validator: No validation criteria for asset type");
        
        // Get deed definition (contains all property details)
        bytes memory definitionBytes = deedNFT.getTraitValue(deedId, keccak256("definition"));
        require(definitionBytes.length > 0, "Validator: Definition not set");
        string memory definition = abi.decode(definitionBytes, (string));
        
        // Get operating agreement
        bytes memory operatingAgreementBytes = deedNFT.getTraitValue(deedId, keccak256("operatingAgreement"));
        require(operatingAgreementBytes.length > 0, "Validator: Operating agreement not set");
        string memory operatingAgreement = abi.decode(operatingAgreementBytes, (string));
        
        // Verify operating agreement is registered
        require(isOperatingAgreementRegistered(operatingAgreement), "Validator: Invalid operating agreement");
        
        // Perform validation based on asset type
        if (assetType == uint256(IDeedNFT.AssetType.Land)) {
            return _validateLandDeed(definition, criteria);
        } else if (assetType == uint256(IDeedNFT.AssetType.Vehicle)) {
            return _validateVehicleDeed(definition, criteria);
        } else if (assetType == uint256(IDeedNFT.AssetType.Estate)) {
            return _validateEstateDeed(definition, criteria);
        } else if (assetType == uint256(IDeedNFT.AssetType.CommercialEquipment)) {
            return _validateCommercialEquipmentDeed(definition, criteria);
        } else {
            revert("Validator: Unsupported asset type");
        }
    }

    /**
     * @dev Validates a land deed against criteria
     * @param definition JSON string containing the deed definition
     * @param criteria JSON string containing validation criteria
     * @return Whether the deed passes validation
     */
    function _validateLandDeed(
        string memory definition, 
        string memory criteria
    ) 
        internal 
        pure 
        returns (bool) 
    {
        // Check if country is required and exists
        if (_criteriaRequiresField(criteria, "requiresCountry") && 
            !_definitionContainsField(definition, "country")) {
            return false;
        }
        
        // Check if state is required and exists
        if (_criteriaRequiresField(criteria, "requiresState") && 
            !_definitionContainsField(definition, "state")) {
            return false;
        }
        
        // Check if county is required and exists
        if (_criteriaRequiresField(criteria, "requiresCounty") && 
            !_definitionContainsField(definition, "county")) {
            return false;
        }
        
        // Check if city is required and exists
        if (_criteriaRequiresField(criteria, "requiresCity") && 
            !_definitionContainsField(definition, "city")) {
            return false;
        }
        
        // Check if street name is required and exists
        if (_criteriaRequiresField(criteria, "requiresStreetName") && 
            !_definitionContainsField(definition, "streetName")) {
            return false;
        }
        
        // Check if street number is required and exists
        if (_criteriaRequiresField(criteria, "requiresStreetNumber") && 
            !_definitionContainsField(definition, "streetNumber")) {
            return false;
        }
        
        // Check if parcel number is required and exists
        if (_criteriaRequiresField(criteria, "requiresParcelNumber") && 
            !_definitionContainsField(definition, "parcelNumber")) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Validates a vehicle deed against criteria
     * @param definition JSON string containing the deed definition
     * @param criteria JSON string containing validation criteria
     * @return Whether the deed passes validation
     */
    function _validateVehicleDeed(
        string memory definition, 
        string memory criteria
    ) 
        internal 
        pure 
        returns (bool) 
    {
        // Check if VIN is required and exists
        if (_criteriaRequiresField(criteria, "requiresVIN") && 
            !_definitionContainsField(definition, "vin")) {
            return false;
        }
        
        // Check if make is required and exists
        if (_criteriaRequiresField(criteria, "requiresMake") && 
            !_definitionContainsField(definition, "make")) {
            return false;
        }
        
        // Check if model is required and exists
        if (_criteriaRequiresField(criteria, "requiresModel") && 
            !_definitionContainsField(definition, "model")) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Validates an estate deed against criteria
     * @param definition JSON string containing the deed definition
     * @param criteria JSON string containing validation criteria
     * @return Whether the deed passes validation
     */
    function _validateEstateDeed(
        string memory definition, 
        string memory criteria
    ) 
        internal 
        pure 
        returns (bool) 
    {
        // Check if address is required and exists
        if (_criteriaRequiresField(criteria, "requiresAddress") && 
            !_definitionContainsField(definition, "address")) {
            return false;
        }
        
        // Check if square footage is required and exists
        if (_criteriaRequiresField(criteria, "requiresSquareFootage") && 
            !_definitionContainsField(definition, "squareFootage")) {
            return false;
        }
        
        // Check if bedrooms is required and exists
        if (_criteriaRequiresField(criteria, "requiresBedrooms") && 
            !_definitionContainsField(definition, "bedrooms")) {
            return false;
        }
        
        // Check if bathrooms is required and exists
        if (_criteriaRequiresField(criteria, "requiresBathrooms") && 
            !_definitionContainsField(definition, "bathrooms")) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Validates a commercial equipment deed against criteria
     * @param definition JSON string containing the deed definition
     * @param criteria JSON string containing validation criteria
     * @return Whether the deed passes validation
     */
    function _validateCommercialEquipmentDeed(
        string memory definition, 
        string memory criteria
    ) 
        internal 
        pure 
        returns (bool) 
    {
        // Check if serial number is required and exists
        if (_criteriaRequiresField(criteria, "requiresSerialNumber") && 
            !_definitionContainsField(definition, "serialNumber")) {
            return false;
        }
        
        // Check if manufacturer is required and exists
        if (_criteriaRequiresField(criteria, "requiresManufacturer") && 
            !_definitionContainsField(definition, "manufacturer")) {
            return false;
        }
        
        // Check if model is required and exists
        if (_criteriaRequiresField(criteria, "requiresModel") && 
            !_definitionContainsField(definition, "model")) {
            return false;
        }
        
        // Check if year is required and exists
        if (_criteriaRequiresField(criteria, "requiresYear") && 
            !_definitionContainsField(definition, "year")) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Checks if a field is required according to criteria
     * @param criteria JSON string of criteria
     * @param fieldName Name of the field to check
     * @return Whether the field is required
     */
    function _criteriaRequiresField(string memory criteria, string memory fieldName) 
        internal 
        pure 
        returns (bool) 
    {
        // Create the JSON key pattern to search for
        string memory pattern = string(abi.encodePacked('"', fieldName, '":true'));
        
        // Convert to bytes for efficient comparison
        bytes memory criteriaBytes = bytes(criteria);
        bytes memory patternBytes = bytes(pattern);
        
        // Search for the pattern in the criteria string
        return _containsSubstring(criteriaBytes, patternBytes);
    }

    /**
     * @dev Checks if a field exists in the definition with a non-empty value
     * @param definition JSON string of deed definition
     * @param fieldName Name of the field to check
     * @return Whether the field exists with a non-empty value
     */
    function _definitionContainsField(string memory definition, string memory fieldName) 
        internal 
        pure 
        returns (bool) 
    {
        // Create the JSON key pattern to search for
        string memory pattern = string(abi.encodePacked('"', fieldName, '":"'));
        
        // Convert to bytes for efficient comparison
        bytes memory definitionBytes = bytes(definition);
        bytes memory patternBytes = bytes(pattern);
        
        // First check if the pattern exists
        if (!_containsSubstring(definitionBytes, patternBytes)) {
            return false;
        }
        
        // Find the position after the pattern
        uint256 pos = _findSubstringPosition(definitionBytes, patternBytes);
        if (pos == type(uint256).max) {
            return false;
        }
        
        // Check if there's a non-empty value
        pos += patternBytes.length;
        
        // Skip to the closing quote, checking for empty value
        for (uint256 i = pos; i < definitionBytes.length; i++) {
            if (definitionBytes[i] == '"') {
                // If we immediately find a quote, the value is empty
                return i > pos;
            }
        }
        
        return false;
    }

    /**
     * @dev Checks if a byte array contains a substring
     * @param haystack The string to search in
     * @param needle The substring to search for
     * @return Whether the substring exists in the string
     */
    function _containsSubstring(bytes memory haystack, bytes memory needle) 
        internal 
        pure 
        returns (bool) 
    {
        return _findSubstringPosition(haystack, needle) != type(uint256).max;
    }

    /**
     * @dev Finds the position of a substring in a string
     * @param haystack The string to search in
     * @param needle The substring to search for
     * @return The position of the substring, or type(uint256).max if not found
     */
    function _findSubstringPosition(bytes memory haystack, bytes memory needle) 
        internal 
        pure 
        returns (uint256) 
    {
        if (haystack.length < needle.length) {
            return type(uint256).max;
        }
        
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return i;
            }
        }
        
        return type(uint256).max;
    }

    /**
     * @dev Sets the DeedNFT contract address
     * @param _deedNFT New DeedNFT contract address
     */
    function setDeedNFT(address _deedNFT) external onlyOwner {
        _setDeedNFT(_deedNFT);
    }

    /**
     * @dev Internal function to set the DeedNFT contract address
     * @param _deedNFT New DeedNFT contract address
     */
    function _setDeedNFT(address _deedNFT) internal {
        // Only enforce non-zero address check after initialization
        if (address(deedNFT) != address(0)) {
            require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        }
        deedNFT = IDeedNFT(_deedNFT);
        
        // Update compatible DeedNFTs mapping
        if (_deedNFT != address(0)) {
            compatibleDeedNFTs[_deedNFT] = true;
            primaryDeedNFT = _deedNFT;
        }
        
        emit DeedNFTUpdated(_deedNFT);
    }

    function addCompatibleDeedNFT(address _deedNFT) external onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        require(_deedNFT != primaryDeedNFT, "Validator: Already primary DeedNFT");
        compatibleDeedNFTs[_deedNFT] = true;
    }

    function removeCompatibleDeedNFT(address _deedNFT) external onlyOwner {
        require(_deedNFT != primaryDeedNFT, "Validator: Cannot remove primary DeedNFT");
        compatibleDeedNFTs[_deedNFT] = false;
    }

    function isCompatibleDeedNFT(address _deedNFT) public view returns (bool) {
        return compatibleDeedNFTs[_deedNFT];
    }

    /**
     * @dev Sets support status for an asset type
     * @param assetTypeId ID of the asset type
     * @param isSupported Whether the asset type should be supported
     */
    function setAssetTypeSupport(uint256 assetTypeId, bool isSupported) 
        external 
        onlyOwner 
    {
        supportedAssetTypes[assetTypeId] = isSupported;
        emit AssetTypeSupportUpdated(assetTypeId, isSupported);
    }

    /**
     * @dev Updates validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     * @param criteria JSON string containing validation requirements
     * @notice Criteria should align with MetadataRenderer property structure
     * @notice Example: {"requiresCountry":true,"requiresState":true,"requiresParcelNumber":true}
     */
    function updateValidationCriteria(
        uint256 assetTypeId,
        string memory criteria
    ) external onlyRole(CRITERIA_MANAGER_ROLE) {
        require(bytes(criteria).length > 0, "Validator: Empty criteria");
        validationCriteria[assetTypeId] = criteria;
        emit ValidationCriteriaUpdated(assetTypeId, criteria);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * Adds support for the IValidator interface.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return
            interfaceId == type(IValidator).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /**
     * @dev Checks if an operating agreement is registered
     * @param _uri The URI to check
     * @return Boolean indicating if the operating agreement is registered
     */
    function isOperatingAgreementRegistered(string memory _uri) 
        public 
        view 
        returns (bool) 
    {
        return bytes(operatingAgreements[_uri]).length > 0;
    }

    /**
     * @dev Gets the validation requirements for an asset type
     * @param assetTypeId ID of the asset type
     * @return The validation criteria as a JSON string
     */
    function getValidationRequirements(uint256 assetTypeId) 
        external 
        view 
        returns (string memory) 
    {
        return validationCriteria[assetTypeId];
    }

    /**
     * @dev Checks if a deed would pass validation without updating its status
     * @param deedId ID of the deed
     * @return Whether the deed would pass validation
     */
    function checkValidation(uint256 deedId) 
        external 
        view 
        returns (bool) 
    {
        return _validateDeedAgainstCriteria(deedId);
    }
}
