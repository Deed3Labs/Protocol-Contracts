// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";

// Libraries
import "../libraries/StringUtils.sol";
import "../libraries/JSONUtils.sol";

// Interfaces
import "./interfaces/IValidator.sol";
import "./interfaces/IDeedNFT.sol";
import "./interfaces/IFundManager.sol";

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
    ERC165Upgradeable,
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

    /// @notice Role for fee management operations
    /// @dev Has authority to update service fees and whitelist tokens
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

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

    /// @notice Mapping to track whitelisted tokens
    /// @dev Key: token address, Value: whitelist status
    mapping(address => bool) public isWhitelisted;

    /// @notice Service fee per token
    /// @dev Key: token address, Value: fee amount in token's smallest unit
    mapping(address => uint256) public serviceFee;

    /// @notice Mapping to store accumulated service fees per token
    mapping(address => uint256) public serviceFeesBalance;

    /// @notice Address of the FundManager contract
    address public fundManager;

    // ============ Validation Field Definitions ============
    
    /// @notice Struct to define a field requirement
    struct FieldRequirement {
        string criteriaField;  // Name of the criteria field (e.g., "requiresCountry")
        string definitionField; // Name of the definition field (e.g., "country")
    }
    
    /// @notice Mapping of asset types to their required field definitions
    /// @dev Maps asset type ID -> array of field requirement structs
    mapping(uint256 => FieldRequirement[]) private assetTypeRequirements;

    // ============ Upgrade Gap ============

    /// @dev Storage gap for future upgrades
    uint256[48] private __gap;

    // ============ Royalty Variables ============

    /// @notice Default royalty fee percentage in basis points (100 = 1%)
    uint96 public royaltyFeePercentage;

    /// @notice Address that receives royalties
    address public royaltyReceiver;

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
        __ERC165_init();
        
        baseUri = _baseUri;
        defaultOperatingAgreementUri = _defaultOperatingAgreementUri;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);
        _grantRole(CRITERIA_MANAGER_ROLE, msg.sender);
        _grantRole(FEE_MANAGER_ROLE, msg.sender); // Grant FEE_MANAGER_ROLE to deployer
        
        // Initialize default validation criteria for each asset type
        _initializeDefaultCriteria();
        
        // Initialize field requirements for each asset type
        _initializeFieldRequirements();

        royaltyFeePercentage = 500; // Default 5%
        royaltyReceiver = msg.sender; // Default to contract deployer
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
    }

    /**
     * @dev Validates a deed NFT
     * @param _tokenId ID of the token to validate
     * @return Whether the deed is valid
     */
    function validateDeed(uint256 _tokenId) external override returns (bool) {
        require(msg.sender != address(0), "Validator: Invalid caller");
        require(compatibleDeedNFTs[msg.sender], "Validator: Incompatible DeedNFT");
        
        // Get the asset definition and type from the DeedNFT
        string memory _definition;
        uint256 assetTypeId;
        
        try IDeedNFT(msg.sender).getDeedInfo(_tokenId) returns (
            IDeedNFT.AssetType assetType,
            bool /* isValidated */,
            string memory /* operatingAgreement */,
            string memory definition,
            string memory /* configuration */,
            address /* validator */
        ) {
            // Extract the definition and asset type from the returned data
            _definition = definition;
            assetTypeId = uint256(assetType);
        } catch Error(string memory /* reason */) {
            // If getDeedInfo fails, try to get the definition directly from traits
            try IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("definition")) returns (bytes memory definitionBytes) {
                if (definitionBytes.length > 0) {
                    _definition = abi.decode(definitionBytes, (string));
                } else {
                    emit ValidationError(_tokenId, "Failed to retrieve asset definition");
                    return false;
                }
                
                // Get asset type from traits
                bytes memory assetTypeBytes = IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("assetType"));
                if (assetTypeBytes.length > 0) {
                    assetTypeId = uint256(abi.decode(assetTypeBytes, (IDeedNFT.AssetType)));
                } else {
                    emit ValidationError(_tokenId, "Failed to retrieve asset type");
                    return false;
                }
            } catch {
                emit ValidationError(_tokenId, "Failed to retrieve asset data");
                return false;
            }
        } catch {
            emit ValidationError(_tokenId, "Failed to retrieve asset data");
            return false;
        }
        
        // Check if the asset type is supported
        if (!supportedAssetTypes[assetTypeId]) {
            emit ValidationError(_tokenId, "Asset type not supported");
            return false;
        }
        
        // Get validation criteria for the asset type
        string memory _criteria = validationCriteria[assetTypeId];
        if (bytes(_criteria).length == 0) {
            emit ValidationError(_tokenId, "No validation criteria for asset type");
            return false;
        }
        
        // Validate the definition against the criteria
        bool isValid = _validateDefinition(_tokenId, _definition, _criteria);
        
        // Emit validation result
        emit DeedValidated(_tokenId, isValid);
        
        return isValid;
    }
    
    /**
     * @dev Validates a definition against criteria
     * @param _tokenId ID of the token
     * @param _definition Definition to validate
     * @param _criteria Criteria to validate against
     * @return Whether the definition is valid
     */
    function _validateDefinition(uint256 _tokenId, string memory _definition, string memory _criteria) internal view returns (bool) {
        // Get the asset type from the token ID
        uint256 assetTypeId;
        
        try IDeedNFT(msg.sender).getTraitValue(_tokenId, keccak256("assetType")) returns (bytes memory assetTypeBytes) {
            if (assetTypeBytes.length > 0) {
                assetTypeId = uint256(abi.decode(assetTypeBytes, (IDeedNFT.AssetType)));
            } else {
                return false;
            }
        } catch {
            return false;
        }
        
        // Get the field requirements for this asset type
        FieldRequirement[] storage requirements = assetTypeRequirements[assetTypeId];
        if (requirements.length == 0) {
            // No specific requirements defined, consider it valid
            return true;
        }
        
        // Parse the definition and criteria JSON
        string[] memory definitionFields = _parseJsonFields(_definition);
        string[] memory criteriaFields = _parseJsonFields(_criteria);
        
        // Check each required field
        for (uint256 i = 0; i < requirements.length; i++) {
            string memory criteriaField = requirements[i].criteriaField;
            string memory definitionField = requirements[i].definitionField;
            
            // Check if the criteria field exists and has a value
            bool criteriaFieldExists = false;
            string memory criteriaValue = "";
            
            for (uint256 j = 0; j < criteriaFields.length; j++) {
                if (StringUtils.contains(criteriaFields[j], criteriaField)) {
                    criteriaFieldExists = true;
                    criteriaValue = criteriaFields[j];
                    break;
                }
            }
            
            if (!criteriaFieldExists || bytes(criteriaValue).length == 0) {
                continue; // Skip if criteria field doesn't exist or is empty
            }
            
            // Check if the definition field exists
            bool definitionFieldExists = false;
            
            for (uint256 j = 0; j < definitionFields.length; j++) {
                if (StringUtils.contains(definitionFields[j], definitionField)) {
                    definitionFieldExists = true;
                    break;
                }
            }
            
            if (!definitionFieldExists) {
                return false; // Required field is missing in definition
            }
        }
        
        return true;
    }

    /**
     * @dev Parses a JSON string into an array of fields.
     * @param _json The JSON string to parse.
     * @return Array of field names.
     */
    function _parseJsonFields(string memory _json) internal pure returns (string[] memory) {
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

    /**
     * @dev Adds a token to the whitelist.
     * @param token Address of the token to whitelist.
     */
    function addWhitelistedToken(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(token != address(0), "Validator: Invalid token address");
        require(!isWhitelisted[token], "Validator: Token already whitelisted");
        isWhitelisted[token] = true;
    }

    /**
     * @dev Removes a token from the whitelist.
     * @param token Address of the token to remove.
     */
    function removeWhitelistedToken(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(isWhitelisted[token], "Validator: Token not whitelisted");
        isWhitelisted[token] = false;
    }

    /**
     * @dev Sets the service fee for a specific token.
     * @param token Address of the token.
     * @param _serviceFee Service fee amount in the token's smallest unit.
     */
    function setServiceFee(address token, uint256 _serviceFee) external onlyRole(FEE_MANAGER_ROLE) {
        require(isWhitelisted[token], "Validator: Token not whitelisted");
        serviceFee[token] = _serviceFee;
    }

    /**
     * @dev Sets the FundManager contract address.
     * @param _fundManager The new FundManager contract address.
     */
    function setFundManager(address _fundManager) public onlyOwner {
        require(_fundManager != address(0), "Validator: Invalid FundManager address");
        fundManager = _fundManager;
    }

    /**
     * @dev Allows validator admins to withdraw accumulated service fees from the FundManager.
     * @param token Address of the token to withdraw.
     */
    function withdrawServiceFees(address token) external onlyRole(FEE_MANAGER_ROLE) {
        require(fundManager != address(0), "Validator: FundManager not set");
        
        // Check if there are fees to withdraw
        uint256 amount = IFundManager(fundManager).getCommissionBalance(address(this), token);
        require(amount > 0, "Validator: No service fees to withdraw");
        
        // Call the FundManager to withdraw fees
        IFundManager(fundManager).withdrawValidatorFees(address(this), token);
    }

    /**
     * @dev Checks if a token is whitelisted.
     * @param token Address of the token.
     * @return Boolean indicating if the token is whitelisted.
     */
    function isTokenWhitelisted(address token) external view returns (bool) {
        return isWhitelisted[token];
    }

    /**
     * @dev Retrieves the service fee for a specific token.
     * @param token Address of the token.
     * @return fee The service fee amount for the token.
     */
    function getServiceFee(address token) external view returns (uint256) {
        return serviceFee[token];
    }

    /**
     * @dev Gets the validation criteria for an asset type
     * @param assetTypeId ID of the asset type
     * @return Validation criteria as a JSON string
     */
    function getValidationCriteria(uint256 assetTypeId) external view override returns (string memory) {
        return validationCriteria[assetTypeId];
    }

    /**
     * @dev Checks if a DeedNFT contract is compatible
     * @param _deedNFT Address of the DeedNFT contract
     * @return Boolean indicating if the DeedNFT is compatible
     */
    function isCompatibleDeedNFT(address _deedNFT) external view override returns (bool) {
        return compatibleDeedNFTs[_deedNFT];
    }

    /**
     * @dev Registers an operating agreement
     * @param uri URI of the operating agreement
     * @param name Name of the operating agreement
     */
    function registerOperatingAgreement(string memory uri, string memory name) external override onlyRole(METADATA_ROLE) {
        require(bytes(uri).length > 0, "Validator: URI cannot be empty");
        require(bytes(name).length > 0, "Validator: Name cannot be empty");
        operatingAgreements[uri] = name;
        emit OperatingAgreementRegistered(uri, name);
    }

    /**
     * @dev Validates a deed NFT's operating agreement
     * @param operatingAgreement URI of the operating agreement
     * @return Whether the operating agreement is valid
     */
    function validateOperatingAgreement(
        string memory operatingAgreement
    ) external view override returns (bool) {
        // Check if the operating agreement is registered
        if (bytes(operatingAgreements[operatingAgreement]).length == 0 && 
            !StringUtils.contains(operatingAgreement, defaultOperatingAgreementUri)) {
            return false;
        }
        
        // Additional validation logic can be added here
        // For example, checking if the operating agreement is appropriate for the asset type
        
        return true;
    }

    /**
     * @dev Gets the royalty fee percentage for a token
     * @return The royalty fee percentage in basis points (100 = 1%)
     */
    function getRoyaltyFeePercentage(uint256) external view override returns (uint96) {
        return royaltyFeePercentage;
    }

    /**
     * @dev Sets the royalty fee percentage
     * @param percentage The royalty fee percentage in basis points (100 = 1%)
     */
    function setRoyaltyFeePercentage(uint96 percentage) external override onlyRole(FEE_MANAGER_ROLE) {
        require(percentage <= 10000, "Validator: Royalty percentage exceeds 100%");
        royaltyFeePercentage = percentage;
    }

    /**
     * @dev Gets the royalty receiver address
     * @return The address that receives royalties
     */
    function getRoyaltyReceiver() external view override returns (address) {
        return royaltyReceiver;
    }

    /**
     * @dev Sets the royalty receiver address
     * @param receiver The address that will receive royalties
     */
    function setRoyaltyReceiver(address receiver) external override onlyRole(FEE_MANAGER_ROLE) {
        require(receiver != address(0), "Validator: Invalid royalty receiver address");
        royaltyReceiver = receiver;
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * Declares support for IValidator interface
     */
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(AccessControlUpgradeable, ERC165Upgradeable) 
        returns (bool) 
    {
        return
            interfaceId == type(IValidator).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}