// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// OpenZeppelin Upgradeable Contracts
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

// External validator and registry interfaces
import "./IValidator.sol";
import "./IValidatorRegistry.sol";

/**
 * @title DeedNFT
 * @dev An ERC-721 token representing deeds with complex metadata and validator integration.
 *      Enables creation and management of digital deed assets with validation support.
 *      
 * Security:
 * - Role-based access control for validators and admins
 * - Pausable functionality for emergency stops
 * - Validated asset management
 * 
 * Integration:
 * - Works with ValidatorRegistry for validator management
 * - Supports FundManager for financial operations
 * - Implements UUPSUpgradeable for upgradability
 */
contract DeedNFT is
    Initializable,
    ERC721URIStorageUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using StringsUpgradeable for uint256;
    using AddressUpgradeable for address;

    // ============ Role Definitions ============

    /// @notice Role for validator operations
    /// @dev Has authority to validate and update deed status
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    // ============ Data Structures ============

    /**
     * @title DeedInfo
     * @dev Comprehensive information about a deed asset
     * 
     * @param assetType Type of the asset (Land, Vehicle, etc.)
     * @param isValidated Whether the deed has been validated
     * @param operatingAgreement URI of the operating agreement
     * @param definition Asset definition metadata
     * @param configuration Asset configuration metadata
     * @param validator Address of the assigned validator
     * @param __gap Reserved storage slots for future upgrades
     */
    struct DeedInfo {
        AssetType assetType;
        bool isValidated;
        string operatingAgreement;
        string definition;
        string configuration;
        address validator;
        uint256[5] __gap; // Reserved for future use
    }

    /**
     * @title AssetType
     * @dev Enumeration of supported asset types
     * 
     * Land - Real estate land assets
     * Vehicle - Vehicular assets
     * Estate - Dwellings, Retail & Commercial Buildings
     * CommercialEquipment - Business and industrial equipment
     */
    enum AssetType {
        Land,
        Vehicle,
        Estate,
        CommercialEquipment
    }

    // ============ State Variables ============
    
    /// @notice Counter for the next deed ID to be minted
    /// @dev Increments with each new deed creation
    uint256 public nextDeedId;
    mapping(uint256 => DeedInfo) private deedInfoMap;
    address private defaultValidator;
    address private validatorRegistry;

    // New: FundManager address
    address public fundManager;

    // ============ Events ============

    /**
     * @dev Emitted when a new deed is minted
     * @param deedId Unique identifier of the minted deed
     * @param deedInfo Complete deed information structure
     * @param minter Address that initiated the minting
     * @param validator Address of the assigned validator
     */
    event DeedNFTMinted(
        uint256 indexed deedId,
        DeedInfo deedInfo,
        address indexed minter,
        address validator
    );
    event DeedNFTBurned(uint256 indexed deedId);
    event DeedNFTValidatedChanged(uint256 indexed deedId, bool isValid);
    event DeedNFTMetadataUpdated(uint256 indexed deedId);
    event FundManagerUpdated(address indexed newFundManager);

    // Storage gap for future upgrades
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default validator and registry addresses.
     * @param _defaultValidator Address of the default validator contract.
     * @param _validatorRegistry Address of the validator registry contract.
     * @param _fundManager Address of the FundManager contract.
     */
    function initialize(
        address _defaultValidator,
        address _validatorRegistry,
        address _fundManager
    ) public initializer {
        __ERC721_init("DeedNFT", "DEED");
        __ERC721URIStorage_init();
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init(); // Initialize UUPSUpgradeable

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); // Grant admin role
        _grantRole(VALIDATOR_ROLE, msg.sender);     // Grant validator role to deployer

        defaultValidator = _defaultValidator;
        validatorRegistry = _validatorRegistry;
        fundManager = _fundManager;
        nextDeedId = 1;
    }

    /**
     * @dev Authorizes the contract upgrade. Only accounts with DEFAULT_ADMIN_ROLE can upgrade.
     * @param newImplementation Address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // Authorization logic handled by onlyRole modifier
    }

    // Modifiers

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    modifier deedExists(uint256 deedId) {
        require(_exists(deedId), "DeedNFT: Deed does not exist");
        _;
    }

    modifier onlyDeedOwner(uint256 deedId) {
        require(
            ownerOf(deedId) == msg.sender,
            "DeedNFT: Caller is not the owner"
        );
        _;
    }

    modifier onlyValidatorOrOwner(uint256 deedId) {
        require(
            hasRole(VALIDATOR_ROLE, msg.sender) ||
                ownerOf(deedId) == msg.sender,
            "DeedNFT: Caller is not validator or owner"
        );
        _;
    }

    // New Modifier: Only FundManager can call certain functions
    modifier onlyFundManager() {
        require(msg.sender == fundManager, "DeedNFT: Caller is not FundManager");
        _;
    }

    // Pausable functions

    /**
     * @dev Pauses all contract operations.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpauses all contract operations.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        emit Unpaused(msg.sender);
    }

    // Validator functions

    /**
     * @dev Sets the default validator address.
     * @param validator Address of the new default validator.
     */
    function setDefaultValidator(address validator)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(validator != address(0), "DeedNFT: Invalid validator address");
        require(
            IValidatorRegistry(validatorRegistry).isValidatorRegistered(
                validator
            ),
            "DeedNFT: Validator is not registered"
        );
        defaultValidator = validator;
    }

    /**
     * @dev Sets the validator registry address.
     * @param registry Address of the validator registry.
     */
    function setValidatorRegistry(address registry)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(registry != address(0), "DeedNFT: Invalid registry address");
        validatorRegistry = registry;
    }

    // New: Setter for FundManager

    /**
     * @dev Sets the FundManager contract address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param _fundManager Address of the FundManager contract.
     */
    function setFundManager(address _fundManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_fundManager != address(0), "DeedNFT: Invalid FundManager address");
        fundManager = _fundManager;
        emit FundManagerUpdated(_fundManager);
    }

    // Consolidated Minting Function

    /**
     * @dev Mints a new deed to the specified owner.
     *      Only callable by the FundManager contract.
     *      If the minter has VALIDATOR_ROLE, the deed is validated and the validator is set to the minter.
     *      Otherwise, the deed is marked as invalid.
     * @param owner Address of the deed owner.
     * @param assetType Type of the asset.
     * @param ipfsDetailsHash IPFS hash of the deed details.
     * @param operatingAgreement Operating agreement associated with the deed.
     * @param definition Definition of the deed.
     * @param configuration Configuration data for the deed.
     * @return The ID of the minted deed.
     */
    function mintAsset(
        address owner,
        AssetType assetType,
        string memory ipfsDetailsHash,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration
    ) external whenNotPaused onlyFundManager returns (uint256) {
        require(owner != address(0), "DeedNFT: Invalid owner address");
        require(
            bytes(ipfsDetailsHash).length > 0,
            "DeedNFT: IPFS details hash is required"
        );
        require(
            bytes(operatingAgreement).length > 0,
            "DeedNFT: Operating agreement is required"
        );
        require(
            bytes(definition).length > 0,
            "DeedNFT: Definition is required"
        );

        // Determine if the FundManager has the VALIDATOR_ROLE
        bool isValidator = hasRole(VALIDATOR_ROLE, msg.sender);
        bool isValidated;
        address assignedValidator;

        if (isValidator) {
            assignedValidator = msg.sender;
            isValidated = true;

            // Ensure validator is registered and supports IValidator interface
            require(
                IValidatorRegistry(validatorRegistry).isValidatorRegistered(
                    assignedValidator
                ),
                "DeedNFT: Validator is not registered"
            );
            require(
                IERC165Upgradeable(assignedValidator).supportsInterface(
                    type(IValidator).interfaceId
                ),
                "DeedNFT: Validator does not support IValidator interface"
            );

            // Check if operating agreement is valid
            string memory agreementName = IValidator(assignedValidator)
                .operatingAgreementName(operatingAgreement);
            require(
                bytes(agreementName).length > 0,
                "DeedNFT: Invalid operating agreement"
            );
        } else {
            assignedValidator = address(0);
            isValidated = false;
        }

        uint256 deedId = nextDeedId++;
        _mint(owner, deedId);
        _setTokenURI(deedId, ipfsDetailsHash);

        DeedInfo storage deedInfo = deedInfoMap[deedId];
        deedInfo.assetType = assetType;
        deedInfo.isValidated = isValidated;
        deedInfo.operatingAgreement = operatingAgreement;
        deedInfo.definition = definition;
        deedInfo.configuration = configuration;
        deedInfo.validator = assignedValidator;

        emit DeedNFTMinted(deedId, deedInfo, msg.sender, assignedValidator);
        return deedId;
    }

    // Removed the mintBatchAssets function to prevent unauthorized access

    // Burning functions

    /**
     * @dev Burns a deed owned by the caller.
     * @param deedId ID of the deed to burn.
     */
    function burnAsset(uint256 deedId)
        public
        onlyDeedOwner(deedId)
        whenNotPaused
    {
        _burn(deedId);
        delete deedInfoMap[deedId];
        emit DeedNFTBurned(deedId);
    }

    /**
     * @dev Batch burns multiple deeds owned by the caller.
     * @param deedIds Array of deed IDs to burn.
     */
    function burnBatchAssets(uint256[] memory deedIds)
        external
        whenNotPaused
    {
        for (uint256 i = 0; i < deedIds.length; i++) {
            uint256 deedId = deedIds[i];
            require(
                ownerOf(deedId) == msg.sender,
                "DeedNFT: Caller is not the owner of all deeds"
            );
            burnAsset(deedId);
        }
    }

    // Validation functions

    /**
     * @dev Validates a minted deed and assigns a validator.
     *      Only callable by addresses with VALIDATOR_ROLE.
     * @param deedId ID of the deed to validate.
     */
    function validateMintedAsset(uint256 deedId)
        external
        onlyRole(VALIDATOR_ROLE)
        whenNotPaused
    {
        require(_exists(deedId), "DeedNFT: Deed does not exist");
        DeedInfo storage deedInfo = deedInfoMap[deedId];
        require(!deedInfo.isValidated, "DeedNFT: Deed is already validated");
        require(deedInfo.validator == address(0), "DeedNFT: Validator already assigned");

        // Ensure validator is registered and supports IValidator interface
        require(
            IValidatorRegistry(validatorRegistry).isValidatorRegistered(msg.sender),
            "DeedNFT: Validator is not registered"
        );
        require(
            IERC165Upgradeable(msg.sender).supportsInterface(
                type(IValidator).interfaceId
            ),
            "DeedNFT: Validator does not support IValidator interface"
        );

        // Check if operating agreement is valid
        string memory agreementName = IValidator(msg.sender)
            .operatingAgreementName(deedInfo.operatingAgreement);
        require(
            bytes(agreementName).length > 0,
            "DeedNFT: Invalid operating agreement"
        );

        deedInfo.isValidated = true;
        deedInfo.validator = msg.sender;

        emit DeedNFTValidatedChanged(deedId, true);
    }

    /**
     * @dev Validates or invalidates a deed.
     *      Only callable by addresses with VALIDATOR_ROLE.
     * @param deedId ID of the deed.
     * @param isValid Validation status to set.
     */
    function validateAsset(uint256 deedId, bool isValid)
        external
        onlyRole(VALIDATOR_ROLE)
        whenNotPaused
    {
        require(
            ownerOf(deedId) != msg.sender,
            "DeedNFT: Validator cannot validate own asset"
        );
        deedInfoMap[deedId].isValidated = isValid;
        emit DeedNFTValidatedChanged(deedId, isValid);
    }

    // Metadata functions

    /**
     * @dev Updates the metadata of a deed.
     *      Only callable by the owner or a validator.
     *      If called by a non-validator, sets isValidated to false.
     * @param deedId ID of the deed.
     * @param ipfsDetailsHash New IPFS details hash.
     * @param operatingAgreement New operating agreement.
     * @param definition New definition.
     * @param configuration New configuration.
     */
    function updateMetadata(
        uint256 deedId,
        string memory ipfsDetailsHash,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration
    ) external onlyValidatorOrOwner(deedId) whenNotPaused {
        require(
            bytes(ipfsDetailsHash).length > 0,
            "DeedNFT: IPFS details hash is required"
        );
        require(
            bytes(operatingAgreement).length > 0,
            "DeedNFT: Operating agreement is required"
        );
        require(
            bytes(definition).length > 0,
            "DeedNFT: Definition is required"
        );

        // Check if operating agreement is valid
        DeedInfo storage deedInfo = deedInfoMap[deedId];
        address validatorAddress = deedInfo.validator != address(0)
            ? deedInfo.validator
            : defaultValidator;

        require(
            validatorAddress != address(0),
            "DeedNFT: No validator available"
        );
        require(
            IERC165Upgradeable(validatorAddress).supportsInterface(
                type(IValidator).interfaceId
            ),
            "DeedNFT: Validator does not support IValidator interface"
        );

        string memory agreementName = IValidator(validatorAddress)
            .operatingAgreementName(operatingAgreement);
        require(
            bytes(agreementName).length > 0,
            "DeedNFT: Invalid operating agreement"
        );

        _setTokenURI(deedId, ipfsDetailsHash);

        deedInfo.operatingAgreement = operatingAgreement;
        deedInfo.definition = definition;
        deedInfo.configuration = configuration;

        if (!hasRole(VALIDATOR_ROLE, msg.sender)) {
            deedInfo.isValidated = false;
        }

        emit DeedNFTMetadataUpdated(deedId);
    }

    // Getter functions

    /**
     * @dev Retrieves the deed information.
     * @param deedId ID of the deed.
     * @return DeedInfo structure containing deed details.
     */
    function getDeedInfo(uint256 deedId)
        external
        view
        deedExists(deedId)
        returns (DeedInfo memory)
    {
        return deedInfoMap[deedId];
    }

    /**
     * @dev Determines whether the asset can be subdivided based on its type.
     * @param deedId ID of the deed.
     * @return True if the asset can be subdivided, false otherwise.
     */
    function canSubdivide(uint256 deedId)
        external
        view
        deedExists(deedId)
        returns (bool)
    {
        AssetType assetType = deedInfoMap[deedId].assetType;
        return assetType == AssetType.Land || assetType == AssetType.Estate;
    }

    /**
     * @dev Returns the token URI, potentially using a validator contract.
     * @param deedId ID of the deed.
     * @return The token URI string.
     */
    function tokenURI(uint256 deedId)
        public
        view
        override
        deedExists(deedId)
        returns (string memory)
    {
        DeedInfo storage deedInfo = deedInfoMap[deedId];
        address validatorAddress = deedInfo.validator != address(0)
            ? deedInfo.validator
            : defaultValidator;

        require(
            validatorAddress != address(0),
            "DeedNFT: No validator available"
        );
        require(
            validatorAddress.isContract(),
            "DeedNFT: Validator address is not a contract"
        );
        require(
            IERC165Upgradeable(validatorAddress).supportsInterface(
                type(IValidator).interfaceId
            ),
            "DeedNFT: Validator does not support IValidator interface"
        );

        IValidator validator = IValidator(validatorAddress);
        return validator.tokenURI(deedId);
    }

    // Interface support

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorageUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
