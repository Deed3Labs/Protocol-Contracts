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
import {IAccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

// External validator and registry interfaces
import "./interfaces/IValidator.sol";
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IFundManager.sol";

import "@limitbreak/creator-token-standards/src/erc721c/ERC721C.sol";

// Import IMetadataRenderer interface
import "./interfaces/IMetadataRenderer.sol";

/// @dev Narrow view the Validator answers for audit D-1 (kept out of IValidator so its interface ID is unchanged).
interface IValidatorTraitPolicy {
    function isRequiredTrait(uint256 assetTypeId, bytes32 traitKey) external view returns (bool);
}

/// @dev Narrow registry view for per-deed validator authority (audit D-2, D-7).
interface IValidatorSignerRegistry {
    function isValidatorSigner(address validator, address account) external view returns (bool);
}

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
    IERC2981Upgradeable
{
    using StringsUpgradeable for uint256;
    using AddressUpgradeable for address;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.Bytes32Set;

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

    /**
     * @dev Every token ID ever minted, kept after burn. A recorded county deed names the Deed ID, so an
     *      ID must never point at a second property (audit D-8).
     */
    mapping(uint256 => bool) private _everMinted;

    /**
     * @dev Per-token trait key sets. The old global `_allTraitKeys` array grew with every key any holder
     *      invented and was scanned by every burn and tokenURI (audit D-12); each token now only pays for
     *      its own keys. `_allTraitKeys` is kept only for storage layout.
     */
    mapping(uint256 => EnumerableSetUpgradeable.Bytes32Set) private _tokenTraitKeys;

    // ============ Audit-fix constants, errors and events ============

    /// @dev Salted IDs live in [2^127, 2^128): above any reachable sequential ID, and below 2^128 so
    ///      Subdivide's `(deedId << 128) | unitId` packing stays collision-free (audit D-8).
    uint256 private constant SALTED_ID_FLAG = 1 << 127;

    bytes32 private constant KEY_ASSET_TYPE = keccak256("assetType");
    bytes32 private constant KEY_IS_VALIDATED = keccak256("isValidated");
    bytes32 private constant KEY_OPERATING_AGREEMENT = keccak256("operatingAgreement");
    bytes32 private constant KEY_DEFINITION = keccak256("definition");
    bytes32 private constant KEY_CONFIGURATION = keccak256("configuration");
    bytes32 private constant KEY_VALIDATOR = keccak256("validator");
    bytes32 private constant KEY_BENEFICIARY = keccak256("beneficiary");

    /// @dev Caller is neither the deed's holder nor a signer of the deed's own validator.
    error NotDeedEditor();
    /// @dev Caller is not the validator recorded on this deed.
    error NotDeedValidator();
    /// @dev The holder tried to change a trait the validator vouched for. Use updateMetadata (which
    ///      resets validation) or ask the deed's validator.
    error ValidatedTraitLocked();
    /// @dev A holder changes the operating agreement only through updateMetadata, which requires a name
    ///      the deed's validator registered (audit D-1, D-14).
    error AgreementViaUpdateMetadata();
    /// @dev The chosen validator is not active, does not implement IValidator, or does not support the asset type.
    error ValidatorNotUsable();

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
        // No VALIDATOR_ROLE for the deployer (audit D-2): editing rights over a deed belong to that
        // deed's own validator, never to a global key.
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
        
        // Trait keys are tracked per token now (audit D-12); `_allTraitKeys` is no longer filled.

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
     * @dev Returns whether the caller edits as the deed's validator, and reverts unless the caller is
     *      that validator (or one of its signers) or the deed's holder. Audit D-2: there is no global
     *      editor key; a validator's powers reach only the deeds that name it.
     */
    function _requireEditor(uint256 tokenId) private view returns (bool byValidator) {
        byValidator = _isDeedValidator(tokenId, msg.sender);
        if (!byValidator && ownerOf(tokenId) != msg.sender) revert NotDeedEditor();
    }

    /**
     * @dev The validator recorded on the deed. A zero record (written by the pre-fix updateMetadata,
     *      audit D-15) falls back to the default validator instead of bricking the deed.
     */
    function _validatorOf(uint256 tokenId) internal view returns (address validator) {
        bytes memory raw = _tokenTraits[tokenId][KEY_VALIDATOR];
        if (raw.length > 0) validator = abi.decode(raw, (address));
        if (validator == address(0)) validator = defaultValidator;
    }

    /**
     * @dev True when `account` is the deed's recorded validator contract, or holds VALIDATOR_ROLE inside
     *      that validator contract (its signers), and that validator is active in the registry.
     */
    function _isDeedValidator(uint256 tokenId, address account) internal view returns (bool) {
        return IValidatorSignerRegistry(validatorRegistry).isValidatorSigner(_validatorOf(tokenId), account);
    }

    /**
     * @notice Whether `account` may act as this deed's validator: the deed's recorded (active) validator
     *         contract or one of its signers. Used by MetadataRenderer for validator-only records.
     */
    function isDeedValidator(uint256 tokenId, address account) external view returns (bool) {
        return _exists(tokenId) && _isDeedValidator(tokenId, account);
    }

    function _isValidated(uint256 tokenId) private view returns (bool) {
        bytes memory raw = _tokenTraits[tokenId][KEY_IS_VALIDATED];
        return raw.length > 0 && abi.decode(raw, (bool));
    }

    /**
     * @dev Traits the validator vouches for and that the holder may not change on a validated deed
     *      (audit D-1): definition, operating agreement, configuration, and every required trait in the
     *      deed's validator criteria for its asset type. Fails closed if the criteria cannot be read.
     */
    function _isValidatedTrait(uint256 tokenId, bytes32 key) private view returns (bool) {
        if (key == KEY_DEFINITION || key == KEY_OPERATING_AGREEMENT || key == KEY_CONFIGURATION) return true;
        // Every minted deed has an asset type and a (non-zero, defaulted) validator. A validator without
        // isRequiredTrait reverts the holder's edit: fail closed.
        return IValidatorTraitPolicy(_validatorOf(tokenId)).isRequiredTrait(
            abi.decode(_tokenTraits[tokenId][KEY_ASSET_TYPE], (uint8)),
            key
        );
    }

    function _exists(uint256 tokenId) internal view override returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // Pausable functions

    /**
     * @dev Pauses all contract operations.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause(); // emits Paused
    }

    /**
     * @dev Unpauses all contract operations.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause(); // emits Unpaused
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
        
        // Older deployments granted the renderer VALIDATOR_ROLE; take it back if present.
        if (metadataRenderer != address(0)) {
            _revokeRole(VALIDATOR_ROLE, metadataRenderer);
        }
        
        // The renderer gets no role and no write power over deeds (audit D-2): it keeps its display
        // fields (custom metadata, gallery) in its own storage.
        metadataRenderer = renderer;
        
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
     * @dev Generates a unique token ID based on input parameters.
     *      Audit D-8: the old `% 1e9` ID space collided with the sequential range and with itself
     *      (birthday bound ~37k mints). Salted IDs now take 127 bits of the hash and set bit 127, so
     *      they sit in [2^127, 2^128): never in the sequential range, and still below 2^128 for
     *      Subdivide's unit-ID packing. Uniqueness over all time is enforced at mint by `_everMinted`.
     */
    function generateUniqueTokenId(
        address owner,
        AssetType assetType,
        string memory definition,
        uint256 salt
    ) public pure returns (uint256) {
        uint256 h = uint256(keccak256(abi.encodePacked(
            owner,
            uint8(assetType),
            definition,
            salt
        )));
        return (h & (SALTED_ID_FLAG - 1)) | SALTED_ID_FLAG;
    }

    /**
     * @notice Whether a token ID has ever been minted (including burned deeds). Such an ID can never be
     *         minted again.
     */
    function wasEverMinted(uint256 tokenId) external view returns (bool) {
        return _everMinted[tokenId];
    }

    /**
     * @dev Mints a new deed with a deterministic token ID. When a FundManager is set, the validator's fee
     *      read at execution must not exceed the cap the minter set with FundManager.setMaxFee (audit D-16).
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
        return _mintAsset(owner, assetType, uri, definition, configuration, validatorAddress, token, salt);
    }

    function _mintAsset(
        address owner,
        AssetType assetType,
        string memory uri,
        string memory definition,
        string memory configuration,
        address validatorAddress,
        address token,
        uint256 salt
    ) private returns (uint256) {
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
        } else {
            // Use the sequential ID approach, stepping over any ID a pre-fix salted mint occupied so a
            // collision can never brick sequential minting (audit D-8).
            while (_everMinted[nexttokenId]) nexttokenId++;
            tokenId = nexttokenId;
            nexttokenId++;
        }
        // Never reuse an ID, even after burn (audit D-8).
        require(!_everMinted[tokenId] && !_exists(tokenId), "Token ID already exists");
        _everMinted[tokenId] = true;

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
     *      Not pausable (audit D-17): an owner can always exit; a pause must never trap the holder's
     *      redemption. The ID stays recorded in `_everMinted` and can never be minted again (audit D-8),
     *      so the burned deed's traits are left in storage as its record instead of being wiped: a
     *      re-mint can no longer inherit them, and burning no longer loops over trait keys (audit D-12).
     *      (Trust agreement v5 also requires that burning does not erase the record.)
     * @param tokenId ID of the deed to burn.
     */
    function burnAsset(uint256 tokenId)
        public
        onlyDeedOwner(tokenId)
    {
        _burn(tokenId);
        emit DeedNFTBurned(tokenId);
    }

    /**
     * @dev Batch burns multiple deeds owned by the caller. Not pausable, like burnAsset.
     * @param tokenIds Array of deed IDs to burn.
     */
    function burnBatchAssets(uint256[] memory tokenIds)
        external
    {
        // burnAsset checks ownership of each deed
        for (uint256 i = 0; i < tokenIds.length; i++) {
            burnAsset(tokenIds[i]);
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
        whenNotPaused
        onlyRole(VALIDATOR_ROLE)
    {
        require(_exists(tokenId), "Deed does not exist");
        require(validatorAddress == msg.sender, "Validator mismatch");
        require(
            IValidatorRegistry(validatorRegistry).isValidatorActive(msg.sender),
            "Validator not active"
        );
        // Audit D-7: only the validator recorded on this deed may give or withdraw its verdict. Another
        // active validator cannot flip it or take its royalties; the holder moves a deed to a new
        // validator with reassignValidator.
        if (_validatorOf(tokenId) != msg.sender) revert NotDeedValidator();

        // Update traits
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(isValid));
        _setTraitValue(tokenId, KEY_VALIDATOR, abi.encode(msg.sender));

        emit DeedValidated(tokenId, isValid);
    }

    /**
     * @notice The holder moves the deed to another active (registry-vetted) validator. Validation is reset:
     *         the new validator must validate the deed itself, and refuses asset types it does not
     *         support. This is the only way a deed changes validator (audit D-7); no admin path exists.
     *         The change is logged by the TraitUpdated events for `validator` and `isValidated`.
     * @param tokenId ID of the deed.
     * @param newValidator Address of the new validator contract.
     */
    function reassignValidator(uint256 tokenId, address newValidator) external whenNotPaused onlyDeedOwner(tokenId) {
        if (!IValidatorRegistry(validatorRegistry).isValidatorActive(newValidator)) revert ValidatorNotUsable();
        _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
        _setTraitValue(tokenId, KEY_VALIDATOR, abi.encode(newValidator));
    }

    // Metadata functions

    /**
     * @dev Updates the metadata of a deed.
     *      Only callable by the owner or the deed's own validator (or one of its signers).
     *      If called by the owner, sets isValidated to false but keeps the recorded validator, so
     *      royaltyInfo and later edits keep working (audit D-15).
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
    ) external whenNotPaused {
        bool byValidator = _requireEditor(tokenId);
        require(
            bytes(operatingAgreement).length > 0,
            "Operating agreement cannot be empty"
        );
        require(
            bytes(definition).length > 0,
            "Definition cannot be empty"
        );

        // Check if operating agreement is valid
        address validatorAddress = _validatorOf(tokenId);

        // The recorded validator passed the IValidator interface check at mint or reassignment.
        require(
            validatorAddress != address(0),
            "No validator available"
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
        
        // If not called by the deed's validator, reset validation status. The validator record is kept
        // (audit D-15): writing address(0) made royaltyInfo and every later updateMetadata revert.
        if (!byValidator) {
            _setTraitValue(tokenId, KEY_IS_VALIDATED, abi.encode(false));
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

        // Track the key on this token only (audit D-12)
        _tokenTraitKeys[tokenId].add(traitKey);

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
    function removeTrait(uint256 tokenId, string memory traitName) external whenNotPaused {
        require(_exists(tokenId), "Token does not exist");
        bool byValidator = _requireEditor(tokenId);
        bytes32 traitKey = keccak256(bytes(traitName));
        require(!_isReservedTrait(traitKey) && traitKey != KEY_ASSET_TYPE, "Reserved trait");
        require(_tokenTraits[tokenId][traitKey].length > 0, "Trait does not exist");
        if (!byValidator && _isValidated(tokenId) && _isValidatedTrait(tokenId, traitKey)) {
            // Audit D-1: the holder cannot delete what the validator vouched for.
            revert ValidatedTraitLocked();
        }
        delete _tokenTraits[tokenId][traitKey];
        _tokenTraitKeys[tokenId].remove(traitKey);
        emit TraitUpdated(traitKey, tokenId, "");
        
        // Sync deletion with MetadataRenderer
        if (metadataRenderer != address(0)) {
            try IMetadataRenderer(metadataRenderer).syncTraitUpdate(tokenId, traitKey, "") {} catch {}
        }
    }

    /**
     * @dev Traits that setTrait and removeTrait refuse for every caller. isValidated and validator
     *      change only through updateValidationStatus, updateMetadata and minting; beneficiary
     *      follows the deed on transfer.
     */
    function _isReservedTrait(bytes32 key) private pure returns (bool) {
        return key == keccak256("isValidated") || key == keccak256("validator") || key == keccak256("beneficiary");
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
    ) external whenNotPaused {
        // Who is writing: the deed's own validator (or a signer of it), or the holder. Nobody else: no
        // global role, and the renderer has no write power at all (audit D-2).
        bool byValidator = _requireEditor(tokenId);
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
            // The name is stored and rendered; MetadataRenderer JSON-escapes it (audit D-6).
        }

        // Validation is written only by updateValidationStatus, updateMetadata and minting, so an
        // owner cannot mark their own deed validated or name its royalty receiver.
        require(!_isReservedTrait(key), "Reserved trait");
        if (key == KEY_ASSET_TYPE) {
            require(byValidator, "Only a validator sets asset type");
        }
        if (!byValidator) {
            // Audit D-1: once validated, what the validator vouched for is the validator's to change.
            if (_isValidated(tokenId) && _isValidatedTrait(tokenId, key)) revert ValidatedTraitLocked();
            // The holder changes the agreement only through updateMetadata, which checks the deed
            // validator's registered names (audit D-1: setTrait skipped that check).
            if (key == KEY_OPERATING_AGREEMENT) revert AgreementViaUpdateMetadata();
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

        // Scan only this token's own keys (audit D-12)
        EnumerableSetUpgradeable.Bytes32Set storage keys = _tokenTraitKeys[tokenId];
        uint256 n = keys.length();
        bytes32[] memory traitKeys = new bytes32[](n);
        uint256 count;
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = keys.at(i);
            if (_tokenTraits[tokenId][key].length > 0) traitKeys[count++] = key;
        }
        assembly {
            mstore(traitKeys, count)
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
        // ICreatorToken is not advertised or implemented (audit D-18).
        return
            interfaceId == type(IERC2981Upgradeable).interfaceId ||
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
        
        // Get validator from traits (falls back to the default validator, audit D-15)
        address validator = _validatorOf(tokenId);
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
        // Clearing an approval (to == 0) is always allowed (audit D-18).
        if (_enforceRoyalties && to != address(0) && !isApprovedMarketplace(to)) {
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

    // Audit D-18: the ERC721-C (ICreatorToken) transfer-validator getters and setter are removed. The
    // stored validator was never consulted, so advertising ERC721-C enforcement misled marketplaces, and
    // wiring it in would give the admin a power to block every transfer. `_transferValidator` is kept
    // only for storage layout. Royalty enforcement is the approved-marketplace list below.

    /**
     * @dev Hook that is called before any token transfer. Enforces the approved-marketplace list.
     * Updates the beneficiary trait to the new holder, except when the deed moves into an approved
     * marketplace or custody contract (Fractionalize, Subdivide, an escrow): there the depositor stays
     * the beneficiary (audit D-19). The trait is a convenience record of the last non-custody holder,
     * not the legal beneficial owner.
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
        // Update beneficiary trait on transfer, unless the deed is only going into custody (audit D-19)
        if (from != address(0) && to != address(0) && !_approvedMarketplaces[to]) {
            _setTraitValue(tokenId, KEY_BENEFICIARY, abi.encode(to));
        }
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
