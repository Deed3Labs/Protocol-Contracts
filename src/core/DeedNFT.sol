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
 * @title IERC7572 Metadata Renderer Interface
 * @dev Interface for the ERC-7572 standard for NFT metadata rendering
 */
interface IERC7572 {
    /**
     * @dev Returns the URI for a token's metadata
     * @param tokenContract Address of the token contract
     * @param tokenId ID of the token
     * @return Token URI
     */
    function tokenURI(address tokenContract, uint256 tokenId) external view returns (string memory);
}

/**
 * @title DeedNFT
 * @dev An ERC-721 token representing deeds with complex metadata and validator integration.
 *      Enables creation and management of digital deed assets with validation support.
 *      Implements ERC-7496 for dynamic traits and ERC-7572 for metadata rendering.
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
 * - Supports ERC-7496 for standardized trait access
 * - Supports ERC-7572 for flexible metadata rendering
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
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ============ Asset Types ============
    enum AssetType {
        Land,
        Vehicle,
        Estate,
        CommercialEquipment
    }

    // ============ State Variables ============
    uint256 public nextDeedId;
    address private defaultValidator;
    address private validatorRegistry;
    string private _contractURI;
    address public metadataRenderer;

    // ============ ERC-7496 Trait Storage ============
    /**
     * @dev Mapping from token ID to trait key to trait value
     * @notice Implements ERC-7496 trait storage
     */
    mapping(uint256 => mapping(bytes32 => bytes)) private _tokenTraits;
    
    /**
     * @dev Mapping from trait key to trait name
     * @notice Used for ERC-7496 trait metadata
     */
    mapping(bytes32 => string) private _traitNames;
    
    /**
     * @dev Array of all possible trait keys
     * @notice Used for ERC-7496 trait enumeration
     */
    bytes32[] private _allTraitKeys;

    // ============ Events ============
    event DeedNFTMinted(
        uint256 indexed deedId,
        AssetType assetType,
        address indexed minter,
        address validator
    );
    event DeedNFTBurned(uint256 indexed deedId);
    event DeedNFTValidatedChanged(uint256 indexed deedId, bool isValid);
    event DeedNFTMetadataUpdated(uint256 indexed deedId);
    event MetadataRendererUpdated(address indexed renderer);
    event ContractURIUpdated(string newURI);
    event TraitUpdated(bytes32 indexed traitKey, uint256 indexed tokenId, bytes traitValue);
    event TraitMetadataURIUpdated();

    // Storage gap for future upgrades
    uint256[45] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with default validator and registry addresses.
     * @param _defaultValidator Address of the default validator contract.
     * @param _validatorRegistry Address of the validator registry contract.
     */
    function initialize(
        address _defaultValidator,
        address _validatorRegistry
    ) public initializer {
        __ERC721_init("DeedNFT", "DEED");
        __ERC721URIStorage_init();
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); // Grant admin role
        _grantRole(VALIDATOR_ROLE, msg.sender);     // Grant validator role to deployer
        _grantRole(MINTER_ROLE, msg.sender);        // Grant minter role to deployer

        defaultValidator = _defaultValidator;
        validatorRegistry = _validatorRegistry;
        nextDeedId = 1;
        
        // Initialize trait keys and names
        _initializeTraits();
    }
    
    /**
     * @dev Initialize trait keys and names
     */
    function _initializeTraits() private {
        // Define trait keys
        bytes32 assetTypeKey = keccak256("assetType");
        bytes32 isValidatedKey = keccak256("isValidated");
        bytes32 operatingAgreementKey = keccak256("operatingAgreement");
        bytes32 definitionKey = keccak256("definition");
        bytes32 configurationKey = keccak256("configuration");
        bytes32 validatorKey = keccak256("validator");
        
        // Store trait keys
        _allTraitKeys = [
            assetTypeKey,
            isValidatedKey,
            operatingAgreementKey,
            definitionKey,
            configurationKey,
            validatorKey
        ];
        
        // Map trait keys to names
        _traitNames[assetTypeKey] = "Asset Type";
        _traitNames[isValidatedKey] = "Validation Status";
        _traitNames[operatingAgreementKey] = "Operating Agreement";
        _traitNames[definitionKey] = "Definition";
        _traitNames[configurationKey] = "Configuration";
        _traitNames[validatorKey] = "Validator";
        
        emit TraitMetadataURIUpdated();
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

    /**
     * @dev Modifier to check if the deed exists
     */
    modifier deedExists(uint256 deedId) {
        require(_exists(deedId), "DeedNFT: Deed does not exist");
        _;
    }

    /**
     * @dev Modifier to check if the caller is the deed owner
     */
    modifier onlyDeedOwner(uint256 deedId) {
        require(
            ownerOf(deedId) == msg.sender,
            "DeedNFT: Caller is not deed owner"
        );
        _;
    }

    /**
     * @dev Modifier to check if the caller is a validator or the deed owner
     */
    modifier onlyValidatorOrOwner(uint256 deedId) {
        require(
            hasRole(VALIDATOR_ROLE, msg.sender) || ownerOf(deedId) == msg.sender,
            "DeedNFT: Caller is not validator or owner"
        );
        _;
    }

    function _exists(uint256 tokenId) internal view override returns (bool) {
        return _ownerOf(tokenId) != address(0);
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
    
    /**
     * @dev Sets the metadata renderer address (ERC-7572).
     * @param renderer Address of the metadata renderer.
     */
    function setMetadataRenderer(address renderer)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(renderer != address(0), "DeedNFT: Invalid renderer address");
        metadataRenderer = renderer;
        emit MetadataRendererUpdated(renderer);
    }

    /**
     * @dev Grants the MINTER_ROLE to an address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param minter Address to grant the MINTER_ROLE to.
     */
    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minter != address(0), "DeedNFT: Invalid minter address");
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @dev Revokes the MINTER_ROLE from an address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param minter Address to revoke the MINTER_ROLE from.
     */
    function removeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    /**
     * @dev Mints a new deed to the specified owner.
     *      Only callable by accounts with MINTER_ROLE.
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
    ) external whenNotPaused onlyRole(MINTER_ROLE) returns (uint256) {
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

        uint256 deedId = nextDeedId++;
        _mint(owner, deedId);
        _setTokenURI(deedId, ipfsDetailsHash);

        // Set traits using ERC-7496
        _setTraitValue(deedId, keccak256("assetType"), abi.encode(assetType));
        _setTraitValue(deedId, keccak256("isValidated"), abi.encode(false));
        _setTraitValue(deedId, keccak256("operatingAgreement"), abi.encode(operatingAgreement));
        _setTraitValue(deedId, keccak256("definition"), abi.encode(definition));
        _setTraitValue(deedId, keccak256("configuration"), abi.encode(configuration));
        _setTraitValue(deedId, keccak256("validator"), abi.encode(address(0)));

        emit DeedNFTMinted(deedId, assetType, msg.sender, address(0));
        return deedId;
    }

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
        
        // Clear all traits
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            delete _tokenTraits[deedId][_allTraitKeys[i]];
        }
        
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
     * @dev Validates a deed and assigns a validator.
     *      Only callable by addresses with VALIDATOR_ROLE.
     * @param deedId ID of the deed to validate.
     */
    function validateDeed(uint256 deedId)
        external
        onlyRole(VALIDATOR_ROLE)
        whenNotPaused
    {
        require(_exists(deedId), "DeedNFT: Deed does not exist");
        
        // Get current validation status
        bytes memory isValidatedBytes = _tokenTraits[deedId][keccak256("isValidated")];
        bool isValidated = isValidatedBytes.length > 0 ? abi.decode(isValidatedBytes, (bool)) : false;
        
        // Get current validator
        bytes memory validatorBytes = _tokenTraits[deedId][keccak256("validator")];
        address validator = validatorBytes.length > 0 ? abi.decode(validatorBytes, (address)) : address(0);
        
        require(!isValidated, "DeedNFT: Deed is already validated");
        require(validator == address(0), "DeedNFT: Validator already assigned");

        // Ensure validator is registered
        require(
            IValidatorRegistry(validatorRegistry).isValidatorRegistered(msg.sender),
            "DeedNFT: Validator is not registered"
        );

        // Verify validator supports interface
        require(
            IERC165Upgradeable(msg.sender).supportsInterface(
                type(IValidator).interfaceId
            ),
            "DeedNFT: Validator does not support IValidator interface"
        );

        // Get operating agreement
        bytes memory operatingAgreementBytes = _tokenTraits[deedId][keccak256("operatingAgreement")];
        string memory operatingAgreement = abi.decode(operatingAgreementBytes, (string));

        // Check if operating agreement is valid
        string memory agreementName = IValidator(msg.sender)
            .operatingAgreementName(operatingAgreement);
        require(
            bytes(agreementName).length > 0,
            "DeedNFT: Invalid operating agreement"
        );

        // Update traits
        _setTraitValue(deedId, keccak256("isValidated"), abi.encode(true));
        _setTraitValue(deedId, keccak256("validator"), abi.encode(msg.sender));

        emit DeedNFTValidatedChanged(deedId, true);
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
        bytes memory validatorBytes = _tokenTraits[deedId][keccak256("validator")];
        address validatorAddress = validatorBytes.length > 0 
            ? abi.decode(validatorBytes, (address)) 
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

        // Update traits
        _setTraitValue(deedId, keccak256("operatingAgreement"), abi.encode(operatingAgreement));
        _setTraitValue(deedId, keccak256("definition"), abi.encode(definition));
        _setTraitValue(deedId, keccak256("configuration"), abi.encode(configuration));
        
        // If not called by validator, reset validation status
        if (!hasRole(VALIDATOR_ROLE, msg.sender)) {
            _setTraitValue(deedId, keccak256("isValidated"), abi.encode(false));
            _setTraitValue(deedId, keccak256("validator"), abi.encode(address(0)));
        }

        emit DeedNFTMetadataUpdated(deedId);
    }
    
    // ERC-7496 Implementation
    
    /**
     * @dev Sets a trait value for a token
     * @param tokenId ID of the token
     * @param traitKey Key of the trait
     * @param traitValue Value of the trait
     * @notice Updates a trait and emits a TraitUpdated event
     */
    function _setTraitValue(uint256 tokenId, bytes32 traitKey, bytes memory traitValue) internal {
        require(_exists(tokenId), "DeedNFT: Token does not exist");
        _tokenTraits[tokenId][traitKey] = traitValue;
        emit TraitUpdated(traitKey, tokenId, traitValue);
    }
    
    /**
     * @dev Gets a trait value for a token
     * @param tokenId ID of the token
     * @param traitKey Key of the trait
     * @return Value of the trait
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory) {
        require(_exists(tokenId), "DeedNFT: Token does not exist");
        return _tokenTraits[tokenId][traitKey];
    }
    
    /**
     * @dev Gets multiple trait values for a token
     * @param tokenId ID of the token
     * @param traitKeys Array of trait keys
     * @return Array of trait values
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitValues(uint256 tokenId, bytes32[] calldata traitKeys) external view returns (bytes[] memory) {
        require(_exists(tokenId), "DeedNFT: Token does not exist");
        bytes[] memory values = new bytes[](traitKeys.length);
        
        for (uint256 i = 0; i < traitKeys.length; i++) {
            values[i] = _tokenTraits[tokenId][traitKeys[i]];
        }
        
        return values;
    }
    
    /**
     * @dev Gets all trait keys for a token
     * @param tokenId ID of the token
     * @return Array of trait keys
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitKeys(uint256 tokenId) external view returns (bytes32[] memory) {
        require(_exists(tokenId), "DeedNFT: Token does not exist");
        
        // Return all possible trait keys
        // In a more optimized implementation, we would only return keys with values
        return _allTraitKeys;
    }
    
    /**
     * @dev Gets the name of a trait
     * @param traitKey Key of the trait
     * @return Name of the trait
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitName(bytes32 traitKey) external view returns (string memory) {
        return _traitNames[traitKey];
    }
    
    /**
     * @dev Gets the metadata URI for traits
     * @return Base64-encoded JSON schema of all traits
     * @notice Part of the ERC-7496 standard for dynamic traits
     * @notice The returned JSON schema defines the structure and validation rules for each trait
     */
    function getTraitMetadataURI() external pure returns (string memory) {
        return "data:application/json;charset=utf-8;base64,ewogICJ0cmFpdHMiOiB7CiAgICAiYXNzZXRUeXBlIjogewogICAgICAiZGlzcGxheU5hbWUiOiAiQXNzZXQgVHlwZSIsCiAgICAgICJkYXRhVHlwZSI6IHsKICAgICAgICAidHlwZSI6ICJlbnVtIiwKICAgICAgICAidmFsdWVzIjogWyJMYW5kIiwgIlZlaGljbGUiLCAiRXN0YXRlIiwgIkNvbW1lcmNpYWxFcXVpcG1lbnQiXQogICAgICB9CiAgICB9LAogICAgImlzVmFsaWRhdGVkIjogewogICAgICAiZGlzcGxheU5hbWUiOiAiVmFsaWRhdGlvbiBTdGF0dXMiLAogICAgICAiZGF0YVR5cGUiOiB7CiAgICAgICAgInR5cGUiOiAiYm9vbGVhbiIKICAgICAgfQogICAgfSwKICAgICJvcGVyYXRpbmdBZ3JlZW1lbnQiOiB7CiAgICAgICJkaXNwbGF5TmFtZSI6ICJPcGVyYXRpbmcgQWdyZWVtZW50IiwKICAgICAgImRhdGFUeXBlIjogewogICAgICAgICJ0eXBlIjogInN0cmluZyIsCiAgICAgICAgIm1pbkxlbmd0aCI6IDEKICAgICAgfQogICAgfSwKICAgICJkZWZpbml0aW9uIjogewogICAgICAiZGlzcGxheU5hbWUiOiAiRGVmaW5pdGlvbiIsCiAgICAgICJkYXRhVHlwZSI6IHsKICAgICAgICAidHlwZSI6ICJzdHJpbmciLAogICAgICAgICJtaW5MZW5ndGgiOiAxCiAgICAgIH0KICAgIH0sCiAgICAiY29uZmlndXJhdGlvbiI6IHsKICAgICAgImRpc3BsYXlOYW1lIjogIkNvbmZpZ3VyYXRpb24iLAogICAgICAiZGF0YVR5cGUiOiB7CiAgICAgICAgInR5cGUiOiAic3RyaW5nIiwKICAgICAgICAibWluTGVuZ3RoIjogMQogICAgICB9CiAgICB9LAogICAgInZhbGlkYXRvciI6IHsKICAgICAgImRpc3BsYXlOYW1lIjogIlZhbGlkYXRvciIsCiAgICAgICJkYXRhVHlwZSI6IHsKICAgICAgICAidHlwZSI6ICJhZGRyZXNzIgogICAgICB9CiAgICB9CiAgfQp9";
    }
    
    // ERC-7572 Implementation
    
    /**
     * @dev Implements ERC-7572: Contract-level metadata
     * @return URI for the contract metadata
     * @notice This function allows marketplaces and wallets to display collection information
     */
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }
    
    /**
     * @dev Sets the contract URI for collection metadata (ERC-7572)
     * @param newURI New contract URI
     * @notice Only callable by admin
     */
    function setContractURI(string memory newURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _contractURI = newURI;
        emit ContractURIUpdated(newURI);
    }
    
    /**
     * @dev Overrides the tokenURI function to use the metadata renderer if available
     * @param tokenId ID of the token
     * @return URI for the token metadata
     * @notice Implements ERC-7572 by delegating to the metadata renderer if set
     */
    function tokenURI(uint256 tokenId) public view override(ERC721URIStorageUpgradeable) returns (string memory) {
        require(_exists(tokenId), "DeedNFT: URI query for nonexistent token");
        
        // If metadata renderer is set, try to use it
        if (metadataRenderer != address(0)) {
            try IERC7572(metadataRenderer).tokenURI(address(this), tokenId) returns (string memory uri) {
                return uri;
            } catch {
                // Fall back to standard implementation if renderer fails
                return super.tokenURI(tokenId);
            }
        }
        return super.tokenURI(tokenId);
    }
    
    /**
     * @dev See {IERC165-supportsInterface}.
     * @param interfaceId Interface identifier
     * @return True if the interface is supported
     * @notice Adds support for ERC-7496 (Dynamic Traits) interface
     */
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(ERC721URIStorageUpgradeable, AccessControlUpgradeable) 
        returns (bool) 
    {
        return
            interfaceId == 0xaf332f3e || // ERC-7496 (Dynamic Traits)
            super.supportsInterface(interfaceId);
    }
}
