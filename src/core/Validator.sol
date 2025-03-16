// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// Interface
import "./IValidator.sol";

/**
 * @title IDeedNFT Interface
 * @dev Interface for interacting with the DeedNFT contract.
 */
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function validateDeed(uint256 tokenId, bool isValid, address validatorAddress) external;
    
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

    // ============ Validation Field Definitions ============
    
    // Mapping of asset types to their required field definitions
    // Maps asset type ID -> array of field requirement structs
    mapping(uint256 => FieldRequirement[]) private assetTypeRequirements;
    
    // Struct to define a field requirement
    struct FieldRequirement {
        string criteriaField;  // Name of the criteria field (e.g., "requiresCountry")
        string definitionField; // Name of the definition field (e.g., "country")
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
     * @param tokenId ID of the affected deed
     * @param metadataUri New metadata URI
     */
    event DeedMetadataUpdated(uint256 indexed tokenId, string metadataUri);

    /**
     * @dev Emitted when a deed is validated
     * @param tokenId ID of the validated deed
     * @param success Validation result
     */
    event DeedValidated(uint256 indexed tokenId, bool success);

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
     * @param tokenId ID of the deed
     * @param reason Error message
     */
    event ValidationError(uint256 indexed tokenId, string reason);

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
        string memory defaultLandCriteria = '{"requiresCountry":true,"requiresState":true,"requiresCounty":true,"requiresParcelNumber":true,"requiresLegalDescription":true,"requiresTaxValueSource":true,"requiresTaxAssessedValueUSD":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.Land)] = defaultLandCriteria;
        
        // Initialize field requirements for each asset type
        _initializeFieldRequirements();
    }

    /**
     * @dev Initializes the field requirements for each asset type
     * @notice This sets up the mapping between criteria fields and definition fields
     */
    function _initializeFieldRequirements() internal {
        // Land asset requirements
        FieldRequirement[] storage landReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Land)];
        landReqs.push(FieldRequirement("requiresCountry", "country"));
        landReqs.push(FieldRequirement("requiresState", "state"));
        landReqs.push(FieldRequirement("requiresCounty", "county"));
        landReqs.push(FieldRequirement("requiresCity", "city"));
        landReqs.push(FieldRequirement("requiresStreetName", "streetName"));
        landReqs.push(FieldRequirement("requiresStreetNumber", "streetNumber"));
        landReqs.push(FieldRequirement("requiresParcelNumber", "parcelNumber"));
        landReqs.push(FieldRequirement("requiresHoldingEntity", "holdingEntity"));
        landReqs.push(FieldRequirement("requiresLatitude", "latitude"));
        landReqs.push(FieldRequirement("requiresLongitude", "longitude"));
        landReqs.push(FieldRequirement("requiresAcres", "acres"));
        landReqs.push(FieldRequirement("requiresParcelUse", "parcelUse"));
        landReqs.push(FieldRequirement("requiresZoning", "zoning"));
        landReqs.push(FieldRequirement("requiresZoningCode", "zoningCode"));
        landReqs.push(FieldRequirement("requiresLegalDescription", "legal_description"));
        
        // Add new value field requirements
        landReqs.push(FieldRequirement("requiresTaxValueSource", "taxValueSource"));
        landReqs.push(FieldRequirement("requiresTaxAssessedValueUSD", "taxAssessedValueUSD"));
        landReqs.push(FieldRequirement("requiresEstimatedValueSource", "estimatedValueSource"));
        landReqs.push(FieldRequirement("requiresEstimatedMarketValueUSD", "estimatedMarketValueUSD"));
        landReqs.push(FieldRequirement("requiresLocalAppraisalSource", "localAppraisalSource"));
        landReqs.push(FieldRequirement("requiresLocalAppraisedValueUSD", "localAppraisedValueUSD"));
        
        // Vehicle asset requirements
        FieldRequirement[] storage vehicleReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Vehicle)];
        vehicleReqs.push(FieldRequirement("requiresVIN", "vin"));
        vehicleReqs.push(FieldRequirement("requiresMake", "make"));
        vehicleReqs.push(FieldRequirement("requiresModel", "model"));
        vehicleReqs.push(FieldRequirement("requiresYear", "year"));
        vehicleReqs.push(FieldRequirement("requiresColor", "color"));
        vehicleReqs.push(FieldRequirement("requiresLicensePlate", "licensePlate"));
        
        // Estate asset requirements
        FieldRequirement[] storage estateReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Estate)];
        estateReqs.push(FieldRequirement("requiresAddress", "address"));
        estateReqs.push(FieldRequirement("requiresSquareFootage", "squareFootage"));
        estateReqs.push(FieldRequirement("requiresBedrooms", "bedrooms"));
        estateReqs.push(FieldRequirement("requiresBathrooms", "bathrooms"));
        estateReqs.push(FieldRequirement("requiresYearBuilt", "yearBuilt"));
        
        // Commercial Equipment asset requirements
        FieldRequirement[] storage equipmentReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.CommercialEquipment)];
        equipmentReqs.push(FieldRequirement("requiresSerialNumber", "serialNumber"));
        equipmentReqs.push(FieldRequirement("requiresManufacturer", "manufacturer"));
        equipmentReqs.push(FieldRequirement("requiresModel", "model"));
        equipmentReqs.push(FieldRequirement("requiresYear", "year"));
        equipmentReqs.push(FieldRequirement("requiresCondition", "condition"));
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
     * @dev Validates a specific token
     * @param tokenId ID of the token to validate
     * @return Boolean indicating validation success
     */
    function validateDeed(uint256 tokenId) external override onlyRole(VALIDATOR_ROLE) returns (bool) {
        require(address(deedNFT) != address(0), "Validator: DeedNFT not set");
        require(compatibleDeedNFTs[address(deedNFT)], "Validator: Incompatible DeedNFT");
        
        // Get asset type
        bytes memory assetTypeBytes = deedNFT.getTraitValue(tokenId, keccak256("assetType"));
        require(assetTypeBytes.length > 0, "Validator: Asset type not set");
        uint256 assetType = abi.decode(assetTypeBytes, (uint256));
        
        // Check if this asset type is supported
        require(supportedAssetTypes[assetType], "Validator: Asset type not supported");
        
        // Get validation criteria for this asset type
        string memory criteria = validationCriteria[assetType];
        require(bytes(criteria).length > 0, "Validator: No validation criteria for asset type");
        
        // Get deed definition (contains all property details)
        bytes memory definitionBytes = deedNFT.getTraitValue(tokenId, keccak256("definition"));
        require(definitionBytes.length > 0, "Validator: Definition not set");
        string memory definition = abi.decode(definitionBytes, (string));
        
        // Get operating agreement
        bytes memory operatingAgreementBytes = deedNFT.getTraitValue(tokenId, keccak256("operatingAgreement"));
        require(operatingAgreementBytes.length > 0, "Validator: Operating agreement not set");
        string memory operatingAgreement = abi.decode(operatingAgreementBytes, (string));
        
        // Verify operating agreement is registered
        require(isOperatingAgreementRegistered(operatingAgreement), "Validator: Invalid operating agreement");
        
        // Perform validation based on asset type and criteria
        bool isValid = true;
        
        // Get the field requirements for this asset type
        FieldRequirement[] storage requirements = assetTypeRequirements[assetType];
        
        // Check each required field
        for (uint i = 0; i < requirements.length; i++) {
            // If this field is required by criteria and missing in definition, validation fails
            if (_criteriaRequiresField(criteria, requirements[i].criteriaField) && 
                !_definitionContainsField(definition, requirements[i].definitionField)) {
                isValid = false;
                emit ValidationError(tokenId, string(abi.encodePacked("Missing required field: ", requirements[i].definitionField)));
                break;
            }
        }
        
        // Update validation status in DeedNFT
        if (isValid) {
            try deedNFT.validateDeed(tokenId, true, address(this)) {
                emit DeedValidated(tokenId, true);
            } catch Error(string memory reason) {
                emit ValidationError(tokenId, reason);
                isValid = false;
            } catch (bytes memory) {
                emit ValidationError(tokenId, "Unknown error during validation");
                isValid = false;
            }
        } else {
            try deedNFT.validateDeed(tokenId, false, address(0)) {
                emit DeedValidated(tokenId, false);
            } catch {
                emit DeedValidated(tokenId, false);
            }
        }
        
        return isValid;
    }

    /**
     * @dev Checks if an operating agreement is registered
     * @param uri URI of the operating agreement
     * @return Boolean indicating if the agreement is registered
     */
    function isOperatingAgreementRegistered(string memory uri) public view returns (bool) {
        return bytes(operatingAgreements[uri]).length > 0;
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
     * @param _deedNFT Address of the DeedNFT contract
     */
    function setDeedNFT(address _deedNFT) external onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
        compatibleDeedNFTs[_deedNFT] = true;
        primaryDeedNFT = _deedNFT;
        emit DeedNFTUpdated(_deedNFT);
    }

    /**
     * @dev Adds a compatible DeedNFT contract
     * @param _deedNFT Address of the compatible DeedNFT contract
     */
    function addCompatibleDeedNFT(address _deedNFT) external onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        compatibleDeedNFTs[_deedNFT] = true;
    }

    /**
     * @dev Removes a compatible DeedNFT contract
     * @param _deedNFT Address of the DeedNFT contract to remove
     */
    function removeCompatibleDeedNFT(address _deedNFT) external onlyOwner {
        require(_deedNFT != primaryDeedNFT, "Validator: Cannot remove primary DeedNFT");
        compatibleDeedNFTs[_deedNFT] = false;
    }

    /**
     * @dev Sets the support status for an asset type
     * @param assetTypeId ID of the asset type
     * @param isSupported Whether the asset type is supported
     */
    function setAssetTypeSupport(uint256 assetTypeId, bool isSupported) external onlyOwner {
        supportedAssetTypes[assetTypeId] = isSupported;
        emit AssetTypeSupportUpdated(assetTypeId, isSupported);
    }

    /**
     * @dev Sets the validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     * @param criteria JSON string containing validation criteria
     */
    function setValidationCriteria(uint256 assetTypeId, string memory criteria) 
        external 
        onlyRole(CRITERIA_MANAGER_ROLE) 
    {
        require(bytes(criteria).length > 0, "Validator: Criteria cannot be empty");
        validationCriteria[assetTypeId] = criteria;
        emit ValidationCriteriaUpdated(assetTypeId, criteria);
    }

    /**
     * @dev Sets the metadata URI for a specific token
     * @param tokenId ID of the token
     * @param metadataUri URI for the token's metadata
     */
    function setDeedMetadata(uint256 tokenId, string memory metadataUri) 
        external 
        onlyRole(METADATA_ROLE) 
    {
        require(bytes(metadataUri).length > 0, "Validator: Metadata URI cannot be empty");
        deedMetadata[tokenId] = metadataUri;
        emit DeedMetadataUpdated(tokenId, metadataUri);
    }

    /**
     * @dev Checks if a token would pass validation without updating its status
     * @param tokenId ID of the token
     * @return Whether the token would pass validation
     */
    function checkValidation(uint256 tokenId) external view returns (bool) {
        require(address(deedNFT) != address(0), "Validator: DeedNFT not set");
        
        // Get asset type
        bytes memory assetTypeBytes = deedNFT.getTraitValue(tokenId, keccak256("assetType"));
        if (assetTypeBytes.length == 0) {
            return false; // Asset type not set
        }
        uint256 assetType = abi.decode(assetTypeBytes, (uint256));
        
        // Check if this asset type is supported
        if (!supportedAssetTypes[assetType]) {
            return false; // Asset type not supported
        }
        
        // Get validation criteria for this asset type
        string memory criteria = validationCriteria[assetType];
        if (bytes(criteria).length == 0) {
            return false; // No validation criteria
        }
        
        // Get deed definition
        bytes memory definitionBytes = deedNFT.getTraitValue(tokenId, keccak256("definition"));
        if (definitionBytes.length == 0) {
            return false; // Definition not set
        }
        string memory definition = abi.decode(definitionBytes, (string));
        
        // Get operating agreement
        bytes memory operatingAgreementBytes = deedNFT.getTraitValue(tokenId, keccak256("operatingAgreement"));
        if (operatingAgreementBytes.length == 0) {
            return false; // Operating agreement not set
        }
        string memory operatingAgreement = abi.decode(operatingAgreementBytes, (string));
        
        // Verify operating agreement is registered
        if (!isOperatingAgreementRegistered(operatingAgreement)) {
            return false; // Invalid operating agreement
        }
        
        // Get the field requirements for this asset type
        FieldRequirement[] storage requirements = assetTypeRequirements[assetType];
        
        // Check each required field
        for (uint i = 0; i < requirements.length; i++) {
            // If this field is required by criteria and missing in definition, validation fails
            if (_criteriaRequiresField(criteria, requirements[i].criteriaField) && 
                !_definitionContainsField(definition, requirements[i].definitionField)) {
                return false;
            }
        }
        
        return true;
    }
}
