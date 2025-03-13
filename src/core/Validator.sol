// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

// Interface
import "./IValidator.sol";

/**
 * @title IDeedNFT Interface
 * @dev Interface for interacting with the DeedNFT contract.
 *      Required for deed validation and metadata access.
 *      Ensures compatibility with the core DeedNFT contract.
 */
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function validateDeed(uint256 deedId) external;
    function getDeedInfo(uint256 deedId) external view returns (
        AssetType assetType,
        bool isValidated,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration,
        address validator
    );
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
    /// @dev Key: asset type ID, Value: validation criteria string
    mapping(uint256 => string) public validationCriteria;

    // Mapping to track compatible DeedNFT contracts
    mapping(address => bool) public compatibleDeedNFTs;
    
    // Main DeedNFT address
    address public primaryDeedNFT;

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
     * @param _deedNFT Address of the DeedNFT contract (can be zero address during initialization)
     */
    function initialize(
        string memory _baseUri,
        string memory _defaultOperatingAgreementUri,
        address _deedNFT
    ) public initializer {
        __AccessControl_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);

        baseUri = _baseUri;
        defaultOperatingAgreementUri = _defaultOperatingAgreementUri;
        
        // Initialize DeedNFT (can be zero address)
        _setDeedNFT(_deedNFT);
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
     * @dev Validates a specific deed
     * @param deedId ID of the deed to validate
     * @return Boolean indicating validation success
     */
    function validateDeed(uint256 deedId) 
        external 
        override 
        onlyRole(VALIDATOR_ROLE) 
        returns (bool) 
    {
        require(address(deedNFT) != address(0), "Validator: DeedNFT not set");
        require(compatibleDeedNFTs[address(deedNFT)], "Validator: DeedNFT not compatible");
        
        // Get deed info from DeedNFT
        (
            IDeedNFT.AssetType assetType,
            bool isValidated,
            string memory operatingAgreement,
            ,  // definition
            ,  // configuration
            address currentValidator
        ) = deedNFT.getDeedInfo(deedId);
        
        // Verify asset type is supported
        require(supportedAssetTypes[uint256(assetType)], "Validator: Asset type not supported");
        
        // Verify operating agreement is valid
        require(bytes(operatingAgreements[operatingAgreement]).length > 0, "Validator: Invalid operating agreement");
        
        // Verify deed isn't already validated
        require(!isValidated, "Validator: Deed already validated");
        require(currentValidator == address(0), "Validator: Validator already assigned");
        
        // Call DeedNFT's validation function
        IDeedNFT(deedNFT).validateDeed(deedId);
        
        emit DeedValidated(deedId, true);
        return true;
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
     */
    function updateValidationCriteria(
        uint256 assetTypeId,
        string memory criteria
    ) external onlyRole(CRITERIA_MANAGER_ROLE) {
        require(bytes(criteria).length > 0, "Validator: Empty criteria");
        validationCriteria[assetTypeId] = criteria;
        emit ValidationCriteriaUpdated(assetTypeId, criteria);
    }
}
