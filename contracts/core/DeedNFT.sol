// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// OpenZeppelin Upgradeable Contracts
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC721URIStorageUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {IERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC2981Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// External validator and registry interfaces
import "./interfaces/IValidator.sol";
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IFundManager.sol";

// Import ICreatorToken interface for reference
import "@limitbreak/creator-token-standards/src/interfaces/ICreatorToken.sol";
import "@limitbreak/creator-token-standards/src/erc721c/ERC721C.sol";

// Import IMetadataRenderer interface
import "./interfaces/IMetadataRenderer.sol";

/**
 * @title DeedNFT
 * @dev An ERC-721 token representing deeds with complex metadata and validator integration.
 *      Implements ERC-7496 for dynamic traits and ERC-7572 for metadata rendering.
 *      Implements royalty enforcement inspired by ERC721-C.
 */
contract DeedNFT is
    Initializable,
    ERC721Upgradeable,
    ERC721URIStorageUpgradeable,
    ERC721EnumerableUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ICreatorToken,
    IERC2981Upgradeable
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
    uint256 public nexttokenId;
    address private defaultValidator;
    address private validatorRegistry;
    string private _contractURI;
    address public metadataRenderer;

    // ============ ERC721-C Security Policy ============
    // Mapping to track approved marketplaces
    mapping(address => bool) private _approvedMarketplaces;
    bool private _enforceRoyalties;
    address private _transferValidator;

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
        uint256 indexed tokenId,
        AssetType assetType,
        address indexed minter,
        address validator
    );
    event DeedNFTBurned(uint256 indexed tokenId);
    event MetadataRendererUpdated(address indexed renderer);
    event ContractURIUpdated(string newURI);
    event TraitUpdated(bytes32 indexed traitKey, uint256 indexed tokenId, bytes traitValue);
    event DeedValidated(uint256 indexed tokenId, bool isValid);
    event MarketplaceApproved(address indexed marketplace, bool approved);
    event RoyaltyEnforcementChanged(bool enforced);

    // Storage gap for future upgrades
    uint256[45] private __gap;

    /**
     * @dev Count of active tokens (more efficient than iterating)
     */
    uint256 private _activeTokenCount;

    // Add FundManager interface
    IFundManager public fundManager;

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

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VALIDATOR_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        defaultValidator = _defaultValidator;
        validatorRegistry = _validatorRegistry;
        nexttokenId = 1;
        _activeTokenCount = 0;
        
        // Initialize trait keys and names
        _initializeTraits();
        
        // Set default security policy
        setToDefaultSecurityPolicy();
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
        bytes32 beneficiaryKey = keccak256("beneficiary");
        
        // Store trait keys
        _allTraitKeys = [
            assetTypeKey,
            isValidatedKey,
            operatingAgreementKey,
            definitionKey,
            configurationKey,
            validatorKey,
            beneficiaryKey
        ];
        
        // Map trait keys to names
        _traitNames[assetTypeKey] = "Asset Type";
        _traitNames[isValidatedKey] = "Validation Status";
        _traitNames[operatingAgreementKey] = "Operating Agreement";
        _traitNames[definitionKey] = "Definition";
        _traitNames[configurationKey] = "Configuration";
        _traitNames[validatorKey] = "Validator";
        _traitNames[beneficiaryKey] = "Beneficiary";
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
     * @dev Modifier to allow only admin or the validator registry
     */
    modifier onlyAdminOrRegistry() {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || msg.sender == validatorRegistry,
            "Not admin or registry"
        );
        _;
    }

    /**
     * @dev Modifier to check if the deed exists
     */
    modifier deedExists(uint256 tokenId) {
        require(_exists(tokenId), "Deed does not exist");
        _;
    }

    /**
     * @dev Modifier to check if the caller is the deed owner
     */
    modifier onlyDeedOwner(uint256 tokenId) {
        require(ownerOf(tokenId) == msg.sender, "Not deed owner");
        _;
    }

    /**
     * @dev Modifier to check if the caller is a validator or the deed owner
     */
    modifier onlyValidatorOrOwner(uint256 tokenId) {
        require(
            hasRole(VALIDATOR_ROLE, msg.sender) || ownerOf(tokenId) == msg.sender,
            "Not authorized"
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
        require(validator != address(0), "Invalid validator address");
        require(
            IValidatorRegistry(validatorRegistry).isValidatorRegistered(
                validator
            ),
            "Validator not registered"
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
        require(registry != address(0), "Invalid registry address");
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
        require(renderer != address(0), "Invalid renderer address");
        
        // Revoke VALIDATOR_ROLE from old renderer if it exists
        if (metadataRenderer != address(0)) {
            _revokeRole(VALIDATOR_ROLE, metadataRenderer);
        }
        
        // Set new renderer and grant VALIDATOR_ROLE
        metadataRenderer = renderer;
        _grantRole(VALIDATOR_ROLE, renderer);
        
        emit MetadataRendererUpdated(renderer);
    }

    /**
     * @dev Grants the MINTER_ROLE to an address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param minter Address to grant the MINTER_ROLE to.
     */
    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minter != address(0), "Invalid minter address");
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
     * @dev Grants the VALIDATOR_ROLE to an address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param validator Address to grant the VALIDATOR_ROLE to.
     */
    function addValidator(address validator) external onlyAdminOrRegistry {
        require(validator != address(0), "Invalid validator address");
        _grantRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Revokes the VALIDATOR_ROLE from an address.
     *      Only callable by accounts with DEFAULT_ADMIN_ROLE.
     * @param validator Address to revoke the VALIDATOR_ROLE from.
     */
    function removeValidator(address validator) external onlyAdminOrRegistry {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Generates a unique token ID based on input parameters
     */
    function generateUniqueTokenId(
        address owner,
        AssetType assetType,
        string memory definition,
        uint256 salt
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            owner,
            uint8(assetType),
            definition,
            salt
        ))) % 1000000000; // Keep it to 9 digits for readability
    }

    /**
     * @dev Mints a new deed with a deterministic token ID
     */
    function mintAsset(
        address owner,
        AssetType assetType,
        string memory uri,
        string memory definition,
        string memory configuration,
        address validatorAddress,
        address token,
        uint256 salt
    ) external whenNotPaused onlyRole(MINTER_ROLE) returns (uint256) {
        require(owner != address(0), "Invalid owner address");
        require(bytes(definition).length > 0, "Definition cannot be empty");

        // Determine which validator to use
        address selectedValidator = validatorAddress;
        if (selectedValidator == address(0)) {
            selectedValidator = defaultValidator;
        }
        
        // Ensure validator is active
        require(selectedValidator != address(0), "No validator available");
        require(
            IValidatorRegistry(validatorRegistry).isValidatorActive(selectedValidator),
            "Validator not active"
        );
        
        // Verify validator supports interface
        require(
            IERC165Upgradeable(selectedValidator).supportsInterface(
                type(IValidator).interfaceId
            ),
            "Validator interface not supported"
        );
        
        // Verify validator supports this asset type
        require(
            IValidator(selectedValidator).supportsAssetType(uint256(assetType)),
            "Asset type not supported"
        );
        
        // Get default operating agreement from validator
        string memory operatingAgreementBase = IValidator(selectedValidator).defaultOperatingAgreement();
        require(bytes(operatingAgreementBase).length > 0, "No operating agreement available");

        // Process payment through FundManager if set
        if (address(fundManager) != address(0)) {
            require(token != address(0), "Payment token required");
            // Get service fee from validator
            uint256 serviceFee = IValidator(selectedValidator).getServiceFee(token);
            require(serviceFee > 0, "Service fee not set");

            // Process payment
            fundManager.processPayment(msg.sender, selectedValidator, token, serviceFee);
        } else {
            // If no FundManager is set, token parameter is optional
            require(token == address(0), "Payment token not allowed without FundManager");
        }

        uint256 tokenId;
        
        // Use unique ID generation if salt is provided, otherwise use sequential ID
        if (salt > 0) {
            tokenId = generateUniqueTokenId(owner, assetType, definition, salt);
            // Ensure the token ID doesn't already exist
            require(!_exists(tokenId), "Token ID already exists");
        } else {
            // Use the sequential ID approach
            tokenId = nexttokenId;
            nexttokenId++;
        }
        
        _mint(owner, tokenId);
        
        // Set token URI as fallback if provided
        if (bytes(uri).length > 0) {
            _setTokenURI(tokenId, uri);
        }

        // Construct the full operating agreement URI by appending tokenId
        string memory operatingAgreement = string(abi.encodePacked(operatingAgreementBase, tokenId.toString()));

        // Set base traits
        _setTraitValue(tokenId, keccak256("assetType"), abi.encode(assetType));
        _setTraitValue(tokenId, keccak256("isValidated"), abi.encode(false));
        _setTraitValue(tokenId, keccak256("operatingAgreement"), abi.encode(operatingAgreement));
        _setTraitValue(tokenId, keccak256("definition"), abi.encode(definition));
        _setTraitValue(tokenId, keccak256("configuration"), abi.encode(configuration));
        _setTraitValue(tokenId, keccak256("validator"), abi.encode(selectedValidator));
        _setTraitValue(tokenId, keccak256("beneficiary"), abi.encode(owner));

        emit DeedNFTMinted(tokenId, assetType, msg.sender, selectedValidator);
        return tokenId;
    }

    // Burning functions

    /**
     * @dev Burns a deed owned by the caller.
     * @param tokenId ID of the deed to burn.
     */
    function burnAsset(uint256 tokenId)
        public
        onlyDeedOwner(tokenId)
        whenNotPaused
    {
        _burn(tokenId);
        
        // Clear all traits
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            delete _tokenTraits[tokenId][_allTraitKeys[i]];
        }
        
        emit DeedNFTBurned(tokenId);
    }

    /**
     * @dev Batch burns multiple deeds owned by the caller.
     * @param tokenIds Array of deed IDs to burn.
     */
    function burnBatchAssets(uint256[] memory tokenIds)
        external
        whenNotPaused
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(
                ownerOf(tokenId) == msg.sender,
                "Not token owner"
            );
            burnAsset(tokenId);
        }
    }

    // Validation functions

    /**
     * @dev Updates the validation status of a token
     * @param tokenId ID of the token to validate
     * @param isValid Whether the token is valid
     * @param validatorAddress Address of the validator
     * @notice This function can only be called by a registered validator
     */
    function updateValidationStatus(uint256 tokenId, bool isValid, address validatorAddress) 
        external 
        onlyRole(VALIDATOR_ROLE)
    {
        require(_exists(tokenId), "Deed does not exist");
        require(
            IValidatorRegistry(validatorRegistry).isValidatorActive(validatorAddress),
            "Validator not active"
        );
        
        // Update traits
        _setTraitValue(tokenId, keccak256("isValidated"), abi.encode(isValid));
        _setTraitValue(tokenId, keccak256("validator"), abi.encode(validatorAddress));
        
        emit DeedValidated(tokenId, isValid);
    }

    // Metadata functions

    /**
     * @dev Updates the metadata of a deed.
     *      Only callable by the owner or a validator.
     *      If called by a non-validator, sets isValidated to false.
     * @param tokenId ID of the deed.
     * @param uri New token URI (used as fallback if metadata renderer fails).
     * @param operatingAgreement New operating agreement.
     * @param definition New definition.
     * @param configuration New configuration.
     */
    function updateMetadata(
        uint256 tokenId,
        string memory uri,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration
    ) external whenNotPaused onlyValidatorOrOwner(tokenId) {
        require(
            bytes(operatingAgreement).length > 0,
            "Operating agreement cannot be empty"
        );
        require(
            bytes(definition).length > 0,
            "Definition cannot be empty"
        );

        // Check if operating agreement is valid
        bytes memory validatorBytes = _tokenTraits[tokenId][keccak256("validator")];
        address validatorAddress = validatorBytes.length > 0 
            ? abi.decode(validatorBytes, (address)) 
            : defaultValidator;

        require(
            validatorAddress != address(0),
            "No validator available"
        );
        require(
            IERC165Upgradeable(validatorAddress).supportsInterface(
                type(IValidator).interfaceId
            ),
            "Validator interface not supported"
        );

        string memory agreementName = IValidator(validatorAddress)
            .operatingAgreementName(operatingAgreement);
        require(
            bytes(agreementName).length > 0,
            "Invalid operating agreement"
        );

        // Update token URI as fallback if provided
        if (bytes(uri).length > 0) {
            _setTokenURI(tokenId, uri);
        }

        // Update traits
        _setTraitValue(tokenId, keccak256("operatingAgreement"), abi.encode(operatingAgreement));
        _setTraitValue(tokenId, keccak256("definition"), abi.encode(definition));
        _setTraitValue(tokenId, keccak256("configuration"), abi.encode(configuration));
        
        // If not called by validator, reset validation status
        if (!hasRole(VALIDATOR_ROLE, msg.sender)) {
            _setTraitValue(tokenId, keccak256("isValidated"), abi.encode(false));
            _setTraitValue(tokenId, keccak256("validator"), abi.encode(address(0)));
        }
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
        require(_exists(tokenId), "Token does not exist");
        
        // Check if this is a new trait key and add it to _allTraitKeys if it doesn't exist
        bool traitExists = false;
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_allTraitKeys[i] == traitKey) {
                traitExists = true;
                break;
            }
        }
        
        // Add new trait key to the array if it doesn't exist
        if (!traitExists) {
            _allTraitKeys.push(traitKey);
        }
        
        _tokenTraits[tokenId][traitKey] = traitValue;
        emit TraitUpdated(traitKey, tokenId, traitValue);

        // Sync with MetadataRenderer if set
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).syncTraitUpdate(tokenId, traitKey, traitValue) {
                // Sync successful
            } catch {
                // Sync failed - continue anyway as this is not critical
            }
        }
    }

    /**
     * @dev Removes a trait from a token using human-readable name
     * @param tokenId ID of the token
     * @param traitName Name of the trait to remove
     */
    function removeTrait(uint256 tokenId, string memory traitName) external onlyValidatorOrOwner(tokenId) {
        require(_exists(tokenId), "Token does not exist");
        bytes32 traitKey = keccak256(bytes(traitName));
        require(_tokenTraits[tokenId][traitKey].length > 0, "Trait does not exist");
        delete _tokenTraits[tokenId][traitKey];
        emit TraitUpdated(traitKey, tokenId, "");
        
        // Sync deletion with MetadataRenderer
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).syncTraitUpdate(tokenId, traitKey, "") {} catch {}
        }
    }

    /**
     * @dev Sets a trait value with flexible input types
     * @param tokenId ID of the token
     * @param traitKey Key of the trait (either bytes32 or string)
     * @param traitValue Value of the trait (supports various types)
     * @param valueType Type of the value (0=bytes, 1=string, 2=uint256, 3=bool)
     * @notice This function consolidates all trait setting operations into one
     *         Can be used with direct bytes32 keys or human-readable names
     *         Supports different value types through type parameter
     */
    function setTrait(
        uint256 tokenId,
        bytes memory traitKey,
        bytes memory traitValue,
        uint8 valueType
    ) external onlyValidatorOrOwner(tokenId) {
        require(_exists(tokenId), "Token does not exist");
        
        // Convert string trait name to bytes32 key if provided as string
        bytes32 key;
        bool isStringKey = false;
        if (traitKey.length == 32) {
            assembly {
                key := mload(add(traitKey, 32))
            }
        } else {
            // Assume it's a string and hash it
            key = keccak256(traitKey);
            isStringKey = true;
        }

        // Handle different value types
        bytes memory value;
        if (valueType == 0) {
            // Direct bytes value
            value = traitValue;
        } else if (valueType == 1) {
            // String value
            value = abi.encode(string(traitValue));
        } else if (valueType == 2) {
            // Numeric value
            value = abi.encode(uint256(bytes32(traitValue)));
        } else if (valueType == 3) {
            // Boolean value
            value = abi.encode(uint256(bytes32(traitValue)) > 0);
        } else {
            revert("Invalid value type");
        }
        
        _setTraitValue(tokenId, key, value);
        
        // If trait was provided as string, set the trait name automatically
        if (isStringKey) {
            _traitNames[key] = string(traitKey);
        }
    }

    /**
     * @dev Gets a trait value for a token
     * @param tokenId ID of the token
     * @param traitKey Key of the trait
     * @return Value of the trait
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitValue(uint256 tokenId, bytes32 traitKey) external view returns (bytes memory) {
        require(_exists(tokenId), "Token does not exist");
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
        require(_exists(tokenId), "Token does not exist");
        bytes[] memory values = new bytes[](traitKeys.length);
        for (uint256 i = 0; i < traitKeys.length; i++) {
            values[i] = _tokenTraits[tokenId][traitKeys[i]];
        }
        return values;
    }
    
    /**
     * @dev Gets all trait keys for a token that have values
     * @param tokenId ID of the token
     * @return Array of trait keys that have values
     * @notice Part of the ERC-7496 standard for dynamic traits
     */
    function getTraitKeys(uint256 tokenId) external view returns (bytes32[] memory) {
        require(_exists(tokenId), "Token does not exist");
        
        // Count traits with values
        uint256 count;
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_tokenTraits[tokenId][_allTraitKeys[i]].length > 0) count++;
        }
        
        bytes32[] memory traitKeys = new bytes32[](count);
        if (count == 0) return traitKeys;
        
        // Fill array
        count = 0;
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_tokenTraits[tokenId][_allTraitKeys[i]].length > 0) {
                traitKeys[count++] = _allTraitKeys[i];
            }
        }
        
        return traitKeys;
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
     * @dev Sets the name for a trait key
     * @param traitKey Key of the trait
     * @param traitName Name of the trait
     * @notice Only callable by admin or validator
     */
    function setTraitName(bytes32 traitKey, string memory traitName) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _traitNames[traitKey] = traitName;
    }
    
    /**
     * @dev Gets the metadata URI for traits
     * @return Base64-encoded JSON schema indicating dynamic trait support
     * @notice Part of the ERC-7496 standard for dynamic traits
     * @notice The actual trait schema is generated dynamically by MetadataRenderer
     */
    function getTraitMetadataURI() external pure returns (string memory) {
        // Simple schema indicating dynamic trait support
        return "data:application/json;base64,eyJ0cmFpdHMiOiB7ImR5bmFtaWMiOiB0cnVlfX0=";
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
     * @dev Sets a specific token URI for a given token ID.
     * @param tokenId uint256 ID of the token to set its URI
     * @param _tokenURI string URI to assign
     */
    function _setTokenURI(uint256 tokenId, string memory _tokenURI) internal virtual override {
        require(_exists(tokenId), "Token does not exist");
        super._setTokenURI(tokenId, _tokenURI);
    }

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(uint256 tokenId) 
        public 
        view 
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable) 
        returns (string memory) 
    {
        // Check if metadata renderer is available and try to use it
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).tokenURI(tokenId) returns (string memory renderedURI) {
                if (bytes(renderedURI).length > 0) {
                    return renderedURI;
                }
            } catch {
                // If renderer fails, fall back to standard URI
            }
        }
        
        // Fall back to standard URI only if metadata renderer is not available or failed
        return ERC721URIStorageUpgradeable.tokenURI(tokenId);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     * @param interfaceId Interface identifier
     * @return True if the interface is supported
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable, ERC721EnumerableUpgradeable, AccessControlUpgradeable, IERC165Upgradeable)
        returns (bool)
    {
        return 
            interfaceId == type(IERC2981Upgradeable).interfaceId ||
            interfaceId == type(ICreatorToken).interfaceId ||
            interfaceId == 0xaf332f3e || // ERC-7496 (Dynamic Traits)
            super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns the validation status of a token
     * @param tokenId ID of the token
     * @return isValidated Whether the token is validated
     * @return validator Address of the validator that validated the token
     */
    function getValidationStatus(uint256 tokenId) 
        external 
        view 
        returns (bool isValidated, address validator) 
    {
        require(_exists(tokenId), "Deed does not exist");
        
        bytes memory isValidatedBytes = _tokenTraits[tokenId][keccak256("isValidated")];
        bytes memory validatorBytes = _tokenTraits[tokenId][keccak256("validator")];
        
        isValidated = isValidatedBytes.length > 0 ? abi.decode(isValidatedBytes, (bool)) : false;
        validator = validatorBytes.length > 0 ? abi.decode(validatorBytes, (address)) : address(0);
        
        return (isValidated, validator);
    }

    /**
     * @dev Returns the royalty information for a token
     * @param tokenId ID of the token
     * @param salePrice Sale price of the token
     * @return receiver Address that should receive royalties (Validator contract)
     * @return royaltyAmount Amount of royalties to be paid
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice) 
        external 
        view 
        override 
        returns (address receiver, uint256 royaltyAmount) 
    {
        require(_exists(tokenId), "Token does not exist");
        
        // Get validator from traits
        bytes memory validatorBytes = _tokenTraits[tokenId][keccak256("validator")];
        require(validatorBytes.length > 0, "No validator found");
        address validator = abi.decode(validatorBytes, (address));
        require(validator != address(0), "Invalid validator address");
        
        uint96 fee = IValidator(validator).getRoyaltyFeePercentage(tokenId);
        
        // Return the validator contract as the receiver
        receiver = validator;
        
        // Calculate the full royalty amount
        royaltyAmount = (salePrice * fee) / 10000;
    }

    /**
     * @dev Sets the contract to the default security policy for royalty enforcement
     */
    function setToDefaultSecurityPolicy() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _enforceRoyalties = true;
        emit RoyaltyEnforcementChanged(true);
    }

    /**
     * @dev Approves a marketplace for trading
     * @param marketplace Address of the marketplace
     * @param approved Whether the marketplace is approved
     */
    function setApprovedMarketplace(address marketplace, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _approvedMarketplaces[marketplace] = approved;
        emit MarketplaceApproved(marketplace, approved);
    }

    /**
     * @dev Checks if a marketplace is approved
     * @param marketplace Address of the marketplace
     * @return Whether the marketplace is approved
     */
    function isApprovedMarketplace(address marketplace) public view returns (bool) {
        return _approvedMarketplaces[marketplace];
    }

    /**
     * @dev Sets whether royalties are enforced
     * @param enforced Whether royalties are enforced
     */
    function setRoyaltyEnforcement(bool enforced) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _enforceRoyalties = enforced;
        emit RoyaltyEnforcementChanged(enforced);
    }

    /**
     * @dev Checks if royalties are enforced
     * @return Whether royalties are enforced
     */
    function isRoyaltyEnforced() public view returns (bool) {
        return _enforceRoyalties;
    }

    /**
     * @dev Override for approval to enforce royalties
     * @param to Address to approve
     * @param tokenId ID of the token to approve
     */
    function approve(address to, uint256 tokenId) public override(ERC721Upgradeable, IERC721Upgradeable) {
        if (_enforceRoyalties && !isApprovedMarketplace(to)) {
            revert("!mkt");
        }
        super.approve(to, tokenId);
    }

    /**
     * @dev Override for setApprovalForAll to enforce royalties
     * @param operator Address to approve
     * @param approved Whether the operator is approved
     */
    function setApprovalForAll(address operator, bool approved) public override(ERC721Upgradeable, IERC721Upgradeable) {
        if (_enforceRoyalties && approved && !isApprovedMarketplace(operator)) {
            revert("!mkt");
        }
        super.setApprovalForAll(operator, approved);
    }

    /**
     * @dev Burns a token
     * @param tokenId ID of the token to burn
     */
    function _burn(uint256 tokenId) 
        internal 
        virtual 
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable) 
    {
        super._burn(tokenId);
    }

    /**
     * @dev Gets the transfer validator address
     * @return validator The address of the transfer validator
     */
    function getTransferValidator() external view returns (address validator) {
        return _transferValidator;
    }

    /**
     * @dev Sets the transfer validator address
     * @param validator The address of the transfer validator
     */
    function setTransferValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldValidator = _transferValidator;
        _transferValidator = validator;
        emit TransferValidatorUpdated(oldValidator, validator);
    }

    /**
     * @dev Returns the function selector for the transfer validator's validation function
     * @return functionSignature The function signature
     * @return isViewFunction Whether the function is a view function
     */
    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        functionSignature = bytes4(keccak256("validateTransfer(address,address,address,uint256)"));
        isViewFunction = true;
    }

    /**
     * @dev Hook that is called before any token transfer. Implements ERC721C compatibility.
     * Updates the beneficiary trait to match the new owner during transfers.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        if (batchSize == 0) return;
        
        // Minting
        if (from == address(0)) _activeTokenCount++;
        // Burning
        else if (to == address(0)) _activeTokenCount--;
        // Regular transfer with royalty enforcement
        else if (_enforceRoyalties && _msgSender() != from && !_approvedMarketplaces[_msgSender()]) revert("!mkt");
        // Update beneficiary trait on transfer
        if (from != address(0) && to != address(0)) _setTraitValue(tokenId, keccak256("beneficiary"), abi.encode(to));
    }

    /**
     * @dev Returns the total supply of tokens (accounts for burned tokens)
     * @return The total number of active tokens
     */
    function totalSupply() public view override(ERC721EnumerableUpgradeable) returns (uint256) {
        return _activeTokenCount;
    }

    /**
     * @dev Sets the FundManager address
     * @param _fundManager Address of the FundManager contract
     */
    function setFundManager(address _fundManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_fundManager != address(0), "Invalid FundManager address");
        fundManager = IFundManager(_fundManager);
    }

}