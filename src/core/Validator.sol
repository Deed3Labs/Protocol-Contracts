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

    // ============ State Variables ============

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
     * @dev Initializes the Validator contract
     * @param _deedNFT Address of the DeedNFT contract
     */
    function initialize(address _deedNFT) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        require(_deedNFT != address(0), "Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(METADATA_ROLE, msg.sender);
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
}
