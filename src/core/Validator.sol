// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// Libraries
import "../libraries/StringUtils.sol";
import "../libraries/JSONUtils.sol";

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
    using StringUtils for string;

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

    /// @notice Mapping to track compatible DeedNFT contracts
    mapping(address => bool) public compatibleDeedNFTs;
    
    /// @notice Main DeedNFT address
    address public primaryDeedNFT;

    // ============ Validation Field Definitions ============
    
    /// @notice Struct to define a field requirement
    struct FieldRequirement {
        string criteriaField;  // Name of the criteria field (e.g., "requiresCountry")
        string definitionField; // Name of the definition field (e.g., "country")
    }
    
    /// @notice Mapping of asset types to their required field definitions
    /// @dev Maps asset type ID -> array of field requirement structs
    mapping(uint256 => FieldRequirement[]) private assetTypeRequirements;

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
     * @param tokenId ID of the token
     * @param reason Reason for the error
     */
    event ValidationError(uint256 indexed tokenId, string reason);

    /**
     * @dev Emitted when a validation succeeds
     * @param tokenId ID of the token
     * @param message Success message
     */
    event ValidationSuccess(uint256 indexed tokenId, string message);

    /**
     * @dev Emitted when a compatible DeedNFT is added or removed
     * @param deedNFTAddress Address of the DeedNFT contract
     * @param isCompatible Whether the contract is compatible
     */
    event CompatibleDeedNFTUpdated(address indexed deedNFTAddress, bool isCompatible);

    /**
     * @dev Emitted when the primary DeedNFT is updated
     * @param deedNFTAddress Address of the new primary DeedNFT contract
     */
    event PrimaryDeedNFTUpdated(address indexed deedNFTAddress);

    /**
     * @dev Emitted when a field requirement is added
     * @param assetTypeId ID of the asset type
     * @param criteriaField Name of the criteria field
     * @param definitionField Name of the definition field
     */
    event FieldRequirementAdded(uint256 indexed assetTypeId, string criteriaField, string definitionField);

    /**
     * @dev Emitted when field requirements are cleared
     * @param assetTypeId ID of the asset type
     */
    event FieldRequirementsCleared(uint256 indexed assetTypeId);

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
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);
        _grantRole(CRITERIA_MANAGER_ROLE, msg.sender);
        
        // Initialize default validation criteria for each asset type
        _initializeDefaultCriteria();
        
        // Initialize field requirements for each asset type
        _initializeFieldRequirements();
    }

    /**
     * @dev Initializes default validation criteria for each asset type
     * @notice Sets up the initial validation requirements for different asset types
     */
    function _initializeDefaultCriteria() internal {
        string memory defaultLandCriteria = '{"requiresCountry":true,"requiresState":true,"requiresCounty":true,"requiresParcelNumber":true,"requiresLegalDescription":true,"requiresTaxValueSource":true,"requiresTaxAssessedValueUSD":true,"requiresBuildYear":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.Land)] = defaultLandCriteria;
        
        string memory defaultEstateCriteria = '{"requiresCountry":true,"requiresState":true,"requiresCounty":true,"requiresParcelNumber":true,"requiresLegalDescription":true,"requiresTaxValueSource":true,"requiresTaxAssessedValueUSD":true,"requiresBuildYear":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.Estate)] = defaultEstateCriteria;
        
        string memory defaultVehicleCriteria = '{"requiresMake":true,"requiresModel":true,"requiresYear":true,"requiresVin":true,"requiresTitleNumber":true,"requiresTitleState":true,"requiresAppraisedValueUSD":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.Vehicle)] = defaultVehicleCriteria;
        
        string memory defaultEquipmentCriteria = '{"requiresManufacturer":true,"requiresModel":true,"requiresYear":true,"requiresSerialNumber":true,"requiresCategory":true,"requiresType":true,"requiresAppraisedValueUSD":true}';
        validationCriteria[uint256(IDeedNFT.AssetType.CommercialEquipment)] = defaultEquipmentCriteria;
    }

    /**
     * @dev Initializes the field requirements for each asset type
     * @notice This sets up the mapping between criteria fields and definition fields
     */
    function _initializeFieldRequirements() internal {
        // Land asset requirements
        _addLandFieldRequirements();
        
        // Estate asset requirements (similar to Land but may have different requirements)
        _addEstateFieldRequirements();
        
        // Vehicle asset requirements
        _addVehicleFieldRequirements();
        
        // Commercial Equipment asset requirements
        _addEquipmentFieldRequirements();
    }

    /**
     * @dev Adds field requirements for Land asset type
     */
    function _addLandFieldRequirements() internal {
        FieldRequirement[] storage landReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Land)];
        
        // Location fields
        landReqs.push(FieldRequirement("requiresCountry", "country"));
        landReqs.push(FieldRequirement("requiresState", "state"));
        landReqs.push(FieldRequirement("requiresCounty", "county"));
        landReqs.push(FieldRequirement("requiresCity", "city"));
        landReqs.push(FieldRequirement("requiresStreetName", "streetName"));
        landReqs.push(FieldRequirement("requiresStreetNumber", "streetNumber"));
        landReqs.push(FieldRequirement("requiresParcelNumber", "parcelNumber"));
        landReqs.push(FieldRequirement("requiresHoldingEntity", "holdingEntity"));
        
        // Geographic fields
        landReqs.push(FieldRequirement("requiresLatitude", "latitude"));
        landReqs.push(FieldRequirement("requiresLongitude", "longitude"));
        landReqs.push(FieldRequirement("requiresAcres", "acres"));
        
        // Zoning fields
        landReqs.push(FieldRequirement("requiresParcelUse", "parcelUse"));
        landReqs.push(FieldRequirement("requiresZoning", "zoning"));
        landReqs.push(FieldRequirement("requiresZoningCode", "zoningCode"));
        
        // Legal fields
        landReqs.push(FieldRequirement("requiresLegalDescription", "legal_description"));
        
        // Build fields
        landReqs.push(FieldRequirement("requiresBuildYear", "buildYear"));
        
        // Value fields
        landReqs.push(FieldRequirement("requiresTaxValueSource", "taxValueSource"));
        landReqs.push(FieldRequirement("requiresTaxAssessedValueUSD", "taxAssessedValueUSD"));
        landReqs.push(FieldRequirement("requiresEstimatedValueSource", "estimatedValueSource"));
        landReqs.push(FieldRequirement("requiresEstimatedMarketValueUSD", "estimatedMarketValueUSD"));
        landReqs.push(FieldRequirement("requiresLocalAppraisalSource", "localAppraisalSource"));
        landReqs.push(FieldRequirement("requiresLocalAppraisedValueUSD", "localAppraisedValueUSD"));
    }

    /**
     * @dev Adds field requirements for Estate asset type
     */
    function _addEstateFieldRequirements() internal {
        FieldRequirement[] storage estateReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Estate)];
        FieldRequirement[] storage landReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Land)];
        
        // Copy land requirements for estate
        for (uint i = 0; i < landReqs.length; i++) {
            estateReqs.push(landReqs[i]);
        }
    }

    /**
     * @dev Adds field requirements for Vehicle asset type
     */
    function _addVehicleFieldRequirements() internal {
        FieldRequirement[] storage vehicleReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.Vehicle)];
        
        // Vehicle identification
        vehicleReqs.push(FieldRequirement("requiresMake", "make"));
        vehicleReqs.push(FieldRequirement("requiresModel", "model"));
        vehicleReqs.push(FieldRequirement("requiresYear", "year"));
        vehicleReqs.push(FieldRequirement("requiresVin", "vin"));
        vehicleReqs.push(FieldRequirement("requiresLicensePlate", "licensePlate"));
        vehicleReqs.push(FieldRequirement("requiresRegistrationState", "registrationState"));
        
        // Physical details
        vehicleReqs.push(FieldRequirement("requiresColor", "color"));
        vehicleReqs.push(FieldRequirement("requiresBodyType", "bodyType"));
        vehicleReqs.push(FieldRequirement("requiresFuelType", "fuelType"));
        vehicleReqs.push(FieldRequirement("requiresTransmissionType", "transmissionType"));
        vehicleReqs.push(FieldRequirement("requiresMileage", "mileage"));
        
        // Ownership details
        vehicleReqs.push(FieldRequirement("requiresTitleNumber", "titleNumber"));
        vehicleReqs.push(FieldRequirement("requiresTitleState", "titleState"));
        vehicleReqs.push(FieldRequirement("requiresTitleStatus", "titleStatus"));
        vehicleReqs.push(FieldRequirement("requiresHoldingEntity", "holdingEntity"));
        
        // Value details
        vehicleReqs.push(FieldRequirement("requiresAppraisalSource", "appraisalSource"));
        vehicleReqs.push(FieldRequirement("requiresAppraisedValueUSD", "appraisedValueUSD"));
        vehicleReqs.push(FieldRequirement("requiresEstimatedValueSource", "estimatedValueSource"));
        vehicleReqs.push(FieldRequirement("requiresEstimatedMarketValueUSD", "estimatedMarketValueUSD"));
        
        // Condition
        vehicleReqs.push(FieldRequirement("requiresCondition", "condition"));
    }

    /**
     * @dev Adds field requirements for Commercial Equipment asset type
     */
    function _addEquipmentFieldRequirements() internal {
        FieldRequirement[] storage equipmentReqs = assetTypeRequirements[uint256(IDeedNFT.AssetType.CommercialEquipment)];
        
        // Equipment identification
        equipmentReqs.push(FieldRequirement("requiresManufacturer", "manufacturer"));
        equipmentReqs.push(FieldRequirement("requiresModel", "model"));
        equipmentReqs.push(FieldRequirement("requiresSerialNumber", "serialNumber"));
        equipmentReqs.push(FieldRequirement("requiresYear", "year"));
        equipmentReqs.push(FieldRequirement("requiresCategory", "category"));
        equipmentReqs.push(FieldRequirement("requiresType", "type"));
        
        // Physical details
        equipmentReqs.push(FieldRequirement("requiresDimensions", "dimensions"));
        equipmentReqs.push(FieldRequirement("requiresWeight", "weight"));
        equipmentReqs.push(FieldRequirement("requiresPowerSource", "powerSource"));
        equipmentReqs.push(FieldRequirement("requiresOperatingHours", "operatingHours"));
        
        // Ownership details
        equipmentReqs.push(FieldRequirement("requiresPurchaseDate", "purchaseDate"));
        equipmentReqs.push(FieldRequirement("requiresWarrantyExpiration", "warrantyExpiration"));
        equipmentReqs.push(FieldRequirement("requiresHoldingEntity", "holdingEntity"));
        equipmentReqs.push(FieldRequirement("requiresLocation", "location"));
        
        // Value details
        equipmentReqs.push(FieldRequirement("requiresAppraisalSource", "appraisalSource"));
        equipmentReqs.push(FieldRequirement("requiresAppraisedValueUSD", "appraisedValueUSD"));
        equipmentReqs.push(FieldRequirement("requiresEstimatedValueSource", "estimatedValueSource"));
        equipmentReqs.push(FieldRequirement("requiresEstimatedMarketValueUSD", "estimatedMarketValueUSD"));
        equipmentReqs.push(FieldRequirement("requiresDepreciationSchedule", "depreciationSchedule"));
        
        // Condition
        equipmentReqs.push(FieldRequirement("requiresCondition", "condition"));
        equipmentReqs.push(FieldRequirement("requiresLastServiceDate", "lastServiceDate"));
        equipmentReqs.push(FieldRequirement("requiresMaintenanceSchedule", "maintenanceSchedule"));
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

    // ============ Public Functions ============

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
    function defaultOperatingAgreement() external view override returns (string memory) {
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
        require(bytes(_uri).length > 0, "Validator: URI cannot be empty");
        delete operatingAgreements[_uri];
        emit OperatingAgreementRegistered(_uri, "");
    }

    /**
     * @dev Sets the DeedNFT contract address.
     * @param _deedNFT The new DeedNFT contract address.
     */
    function setDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
        primaryDeedNFT = _deedNFT;
        compatibleDeedNFTs[_deedNFT] = true;
        emit DeedNFTUpdated(_deedNFT);
        emit PrimaryDeedNFTUpdated(_deedNFT);
        emit CompatibleDeedNFTUpdated(_deedNFT, true);
    }

    /**
     * @dev Adds a compatible DeedNFT contract.
     * @param _deedNFT The DeedNFT contract address to add.
     */
    function addCompatibleDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        compatibleDeedNFTs[_deedNFT] = true;
        emit CompatibleDeedNFTUpdated(_deedNFT, true);
    }

    /**
     * @dev Removes a compatible DeedNFT contract.
     * @param _deedNFT The DeedNFT contract address to remove.
     */
    function removeCompatibleDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != primaryDeedNFT, "Validator: Cannot remove primary DeedNFT");
        compatibleDeedNFTs[_deedNFT] = false;
        emit CompatibleDeedNFTUpdated(_deedNFT, false);
    }

    /**
     * @dev Sets the primary DeedNFT contract.
     * @param _deedNFT The new primary DeedNFT contract address.
     */
    function setPrimaryDeedNFT(address _deedNFT) public onlyOwner {
        require(_deedNFT != address(0), "Validator: Invalid DeedNFT address");
        require(compatibleDeedNFTs[_deedNFT], "Validator: DeedNFT not compatible");
        primaryDeedNFT = _deedNFT;
        deedNFT = IDeedNFT(_deedNFT);
        emit PrimaryDeedNFTUpdated(_deedNFT);
        emit DeedNFTUpdated(_deedNFT);
    }

    /**
     * @dev Sets the support status for an asset type.
     * @param _assetTypeId The ID of the asset type.
     * @param _isSupported Whether the asset type is supported.
     */
    function setAssetTypeSupport(uint256 _assetTypeId, bool _isSupported)
        public
        onlyRole(CRITERIA_MANAGER_ROLE)
    {
        supportedAssetTypes[_assetTypeId] = _isSupported;
        emit AssetTypeSupportUpdated(_assetTypeId, _isSupported);
    }

    /**
     * @dev Sets the validation criteria for an asset type.
     * @param _assetTypeId The ID of the asset type.
     * @param _criteria The validation criteria JSON string.
     */
    function setValidationCriteria(uint256 _assetTypeId, string memory _criteria)
        public
        onlyRole(CRITERIA_MANAGER_ROLE)
    {
        require(bytes(_criteria).length > 0, "Validator: Criteria cannot be empty");
        validationCriteria[_assetTypeId] = _criteria;
        emit ValidationCriteriaUpdated(_assetTypeId, _criteria);
    }

    /**
     * @dev Sets the metadata URI for a deed.
     * @param _tokenId The ID of the deed.
     * @param _metadataUri The metadata URI.
     */
    function setDeedMetadata(uint256 _tokenId, string memory _metadataUri)
        public
        onlyRole(METADATA_ROLE)
    {
        require(bytes(_metadataUri).length > 0, "Validator: URI cannot be empty");
        deedMetadata[_tokenId] = _metadataUri;
        emit DeedMetadataUpdated(_tokenId, _metadataUri);
    }

    /**
     * @dev Validates a deed based on its asset type and definition against criteria
     * @param _tokenId ID of the token to validate
     * @return Boolean indicating if validation was successful
     */
    function validateDeed(uint256 _tokenId) external override returns (bool) {
        // Get the deed's asset type and definition from DeedNFT
        bytes memory assetTypeBytes = IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("assetType"));
        bytes memory definitionBytes = IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("definition"));
        
        if (assetTypeBytes.length == 0 || definitionBytes.length == 0) {
            emit ValidationError(_tokenId, "Missing asset type or definition");
            return false;
        }
        
        uint256 assetTypeValue = abi.decode(assetTypeBytes, (uint256));
        string memory definition = abi.decode(definitionBytes, (string));
        
        // Get the appropriate criteria based on asset type
        string memory criteria;
        if (assetTypeValue == uint256(IDeedNFT.AssetType.Land)) {
            criteria = validationCriteria[uint256(IDeedNFT.AssetType.Land)];
        } else if (assetTypeValue == uint256(IDeedNFT.AssetType.Vehicle)) {
            criteria = validationCriteria[uint256(IDeedNFT.AssetType.Vehicle)];
        } else if (assetTypeValue == uint256(IDeedNFT.AssetType.CommercialEquipment)) {
            criteria = validationCriteria[uint256(IDeedNFT.AssetType.CommercialEquipment)];
        } else {
            emit ValidationError(_tokenId, "Unsupported asset type");
            return false;
        }
        
        // Validate the definition against the criteria
        bool isValid = _validateDefinition(_tokenId, definition, criteria);
        
        // Update the validation status in DeedNFT
        if (isValid) {
            // Call DeedNFT's validateDeed function to update status
            try IDeedNFT(msg.sender).validateDeed(_tokenId, true, address(this)) {
                emit ValidationSuccess(_tokenId, "Validation successful");
            } catch Error(string memory reason) {
                emit ValidationError(_tokenId, string(abi.encodePacked("Failed to update validation status: ", reason)));
                return false;
            } catch {
                emit ValidationError(_tokenId, "Failed to update validation status");
                return false;
            }
        } else {
            // If validation failed, update status to invalid
            try IDeedNFT(msg.sender).validateDeed(_tokenId, false, address(this)) {
                // Even though validation failed, we successfully updated the status
            } catch {
                // Ignore errors when setting to invalid
            }
        }
        
        return isValid;
    }
    
    /**
     * @dev Internal function to validate a definition against criteria
     * @param _tokenId ID of the token being validated
     * @param _definition JSON string containing the deed definition
     * @param _criteria JSON string containing validation criteria
     * @return Boolean indicating if validation was successful
     */
    function _validateDefinition(uint256 _tokenId, string memory _definition, string memory _criteria) internal returns (bool) {
        // Parse the criteria JSON
        string[] memory criteriaFields = _getJsonFields(_criteria);
        
        // Check each required field
        for (uint i = 0; i < criteriaFields.length; i++) {
            string memory criteriaField = criteriaFields[i];
            string memory definitionField = criteriaField;
            
            // Check if the field is required in the criteria
            if (_containsField(_criteria, criteriaField, "true")) {
                // Check if the field exists in the definition
                if (!_containsField(_definition, definitionField, "")) {
                    emit ValidationError(_tokenId, string(abi.encodePacked("Required field missing: ", definitionField)));
                    return false;
                }
            }
        }
        
        // Additional validation logic can be added here
        
        return true;
    }

    /**
     * @dev Gets the field requirements for an asset type.
     * @param _assetTypeId The ID of the asset type.
     * @return Array of field requirements.
     */
    function getFieldRequirements(uint256 _assetTypeId) 
        public 
        view 
        returns (FieldRequirement[] memory) 
    {
        return assetTypeRequirements[_assetTypeId];
    }

    /**
     * @dev Adds a batch of field requirements for an asset type.
     * @param _assetTypeId The ID of the asset type.
     * @param _criteriaFields Array of criteria field names.
     * @param _definitionFields Array of definition field names.
     */
    function addFieldRequirementsBatch(
        uint256 _assetTypeId,
        string[] memory _criteriaFields,
        string[] memory _definitionFields
    ) public onlyRole(CRITERIA_MANAGER_ROLE) {
        require(_criteriaFields.length == _definitionFields.length, "Validator: Array lengths must match");
        
        for (uint i = 0; i < _criteriaFields.length; i++) {
            require(bytes(_criteriaFields[i]).length > 0, "Validator: Criteria field cannot be empty");
            require(bytes(_definitionFields[i]).length > 0, "Validator: Definition field cannot be empty");
            
            assetTypeRequirements[_assetTypeId].push(FieldRequirement({
                criteriaField: _criteriaFields[i],
                definitionField: _definitionFields[i]
            }));
            
            emit FieldRequirementAdded(_assetTypeId, _criteriaFields[i], _definitionFields[i]);
        }
    }

    /**
     * @dev Sets up standard field requirements for Land asset type.
     */
    function setupLandFieldRequirements() public onlyRole(CRITERIA_MANAGER_ROLE) {
        // Clear existing requirements
        clearFieldRequirements(uint256(IDeedNFT.AssetType.Land));
        
        // Add standard requirements for Land
        string[] memory criteriaFields = new string[](10);
        string[] memory definitionFields = new string[](10);
        
        criteriaFields[0] = "requiresCountry";
        definitionFields[0] = "country";
        
        criteriaFields[1] = "requiresState";
        definitionFields[1] = "state";
        
        criteriaFields[2] = "requiresCounty";
        definitionFields[2] = "county";
        
        criteriaFields[3] = "requiresCity";
        definitionFields[3] = "city";
        
        criteriaFields[4] = "requiresParcelNumber";
        definitionFields[4] = "parcelNumber";
        
        criteriaFields[5] = "requiresLegalDescription";
        definitionFields[5] = "legal_description";
        
        criteriaFields[6] = "requiresAcres";
        definitionFields[6] = "acres";
        
        criteriaFields[7] = "requiresLatitude";
        definitionFields[7] = "latitude";
        
        criteriaFields[8] = "requiresLongitude";
        definitionFields[8] = "longitude";
        
        criteriaFields[9] = "requiresZoning";
        definitionFields[9] = "zoning";
        
        addFieldRequirementsBatch(uint256(IDeedNFT.AssetType.Land), criteriaFields, definitionFields);
    }

    /**
     * @dev Sets up standard field requirements for Vehicle asset type.
     */
    function setupVehicleFieldRequirements() public onlyRole(CRITERIA_MANAGER_ROLE) {
        // Clear existing requirements
        clearFieldRequirements(uint256(IDeedNFT.AssetType.Vehicle));
        
        // Add standard requirements for Vehicle
        string[] memory criteriaFields = new string[](7);
        string[] memory definitionFields = new string[](7);
        
        criteriaFields[0] = "requiresMake";
        definitionFields[0] = "make";
        
        criteriaFields[1] = "requiresModel";
        definitionFields[1] = "model";
        
        criteriaFields[2] = "requiresYear";
        definitionFields[2] = "year";
        
        criteriaFields[3] = "requiresVIN";
        definitionFields[3] = "vin";
        
        criteriaFields[4] = "requiresColor";
        definitionFields[4] = "color";
        
        criteriaFields[5] = "requiresTitleState";
        definitionFields[5] = "titleState";
        
        criteriaFields[6] = "requiresTitleStatus";
        definitionFields[6] = "titleStatus";
        
        addFieldRequirementsBatch(uint256(IDeedNFT.AssetType.Vehicle), criteriaFields, definitionFields);
    }

    /**
     * @dev Sets up standard field requirements for Equipment asset type.
     */
    function setupEquipmentFieldRequirements() public onlyRole(CRITERIA_MANAGER_ROLE) {
        // Clear existing requirements
        clearFieldRequirements(uint256(IDeedNFT.AssetType.CommercialEquipment));
        
        // Add standard requirements for Equipment
        string[] memory criteriaFields = new string[](7);
        string[] memory definitionFields = new string[](7);
        
        criteriaFields[0] = "requiresManufacturer";
        definitionFields[0] = "manufacturer";
        
        criteriaFields[1] = "requiresModel";
        definitionFields[1] = "model";
        
        criteriaFields[2] = "requiresSerialNumber";
        definitionFields[2] = "serialNumber";
        
        criteriaFields[3] = "requiresYear";
        definitionFields[3] = "year";
        
        criteriaFields[4] = "requiresCategory";
        definitionFields[4] = "category";
        
        criteriaFields[5] = "requiresEquipmentType";
        definitionFields[5] = "equipmentType";
        
        criteriaFields[6] = "requiresCondition";
        definitionFields[6] = "condition";
        
        addFieldRequirementsBatch(uint256(IDeedNFT.AssetType.CommercialEquipment), criteriaFields, definitionFields);
    }

    /**
     * @dev Sets up all standard field requirements for all asset types.
     */
    function setupAllFieldRequirements() external onlyRole(CRITERIA_MANAGER_ROLE) {
        setupLandFieldRequirements();
        setupVehicleFieldRequirements();
        setupEquipmentFieldRequirements();
    }

    /**
     * @dev Removes all field requirements for an asset type.
     * @param _assetTypeId The ID of the asset type.
     */
    function clearFieldRequirements(uint256 _assetTypeId) public onlyRole(CRITERIA_MANAGER_ROLE) {
        delete assetTypeRequirements[_assetTypeId];
        emit FieldRequirementsCleared(_assetTypeId);
    }

    /**
     * @dev Checks if a JSON string contains a field with a specific value.
     * @param _json The JSON string to check.
     * @param _field The field name to look for.
     * @param _value The expected value (pass null to just check field existence).
     * @return Whether the field exists with the specified value.
     */
    function _containsField(
        string memory _json,
        string memory _field,
        string memory _value
    ) internal pure returns (bool) {
        // Simple string-based check for field existence
        // In production, use a proper JSON parser library
        
        string memory fieldPattern = string(abi.encodePacked('"', _field, '":'));
        
        // Check if the field exists
        if (!StringUtils.contains(_json, fieldPattern)) {
            return false;
        }
        
        // If we only need to check existence, return true
        if (bytes(_value).length == 0) {
            return true;
        }
        
        // Check if the field has the expected value
        string memory valuePattern = string(abi.encodePacked(fieldPattern, ' "', _value, '"'));
        string memory boolValuePattern = string(abi.encodePacked(fieldPattern, ' ', _value));
        
        return StringUtils.contains(_json, valuePattern) || StringUtils.contains(_json, boolValuePattern);
    }

    /**
     * @dev Parses a JSON string into an array of fields.
     * @param _json The JSON string to parse.
     * @return Array of field names.
     */
    function _getJsonFields(string memory _json) internal pure returns (string[] memory) {
        // This is a simplified implementation. In a production environment,
        // you would use a proper JSON parsing library to extract fields.
        
        // First, count the number of fields to allocate the array
        uint256 fieldCount = 0;
        bool inString = false;
        bool inField = false;
        
        for (uint i = 0; i < bytes(_json).length; i++) {
            bytes1 char = bytes(_json)[i];
            
            if (char == '"') {
                inString = !inString;
                if (!inString && inField) {
                    fieldCount++;
                    inField = false;
                } else if (inString && !inField) {
                    inField = true;
                }
            }
        }
        
        // Now create the array and populate it
        string[] memory fields = new string[](fieldCount);
        fieldCount = 0;
        inString = false;
        inField = false;
        uint256 startPos = 0;
        
        for (uint i = 0; i < bytes(_json).length; i++) {
            bytes1 char = bytes(_json)[i];
            
            if (char == '"') {
                if (!inString) {
                    startPos = i + 1;
                    inString = true;
                    inField = true;
                } else if (inField) {
                    // Extract the field name
                    bytes memory fieldBytes = new bytes(i - startPos);
                    for (uint j = 0; j < i - startPos; j++) {
                        fieldBytes[j] = bytes(_json)[startPos + j];
                    }
                    fields[fieldCount] = string(fieldBytes);
                    fieldCount++;
                    inString = false;
                    inField = false;
                }
            }
        }
        
        return fields;
    }

    /**
     * @dev Returns the name of an operating agreement.
     * @param uri_ The URI of the operating agreement.
     * @return The name of the operating agreement.
     */
    function operatingAgreementName(string memory uri_) external view override returns (string memory) {
        return operatingAgreements[uri_];
    }

    /**
     * @dev Checks if an asset type is supported.
     * @param assetTypeId The ID of the asset type.
     * @return Whether the asset type is supported.
     */
    function supportsAssetType(uint256 assetTypeId) external view override returns (bool) {
        return supportedAssetTypes[assetTypeId];
    }

    /**
     * @dev Returns the metadata URI for a token.
     * @param tokenId The ID of the token.
     * @return The metadata URI.
     */
    function tokenURI(uint256 tokenId) external view override returns (string memory) {
        string memory metadataUri = deedMetadata[tokenId];
        if (bytes(metadataUri).length > 0) {
            return metadataUri;
        }
        return string(abi.encodePacked(baseUri, tokenId.toString()));
    }
}