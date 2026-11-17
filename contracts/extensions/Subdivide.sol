// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {ERC1155Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC2981Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "../core/interfaces/IDeedNFT.sol";
import "../core/interfaces/IValidator.sol";
import "../core/interfaces/IValidatorRegistry.sol";
import "../core/interfaces/ISubdivide.sol";

/**
 * @title Subdivide
 * @dev Contract for subdividing DeedNFTs into multiple ERC1155 tokens.
 *      Allows DeedNFT owners to create and manage subdivisions of their Land or Estate assets.
 *      Each subdivision represents a collection of units or parcels tied to the original DeedNFT.
 *      
 * Security:
 * - Only DeedNFT owners can create subdivisions. createSubdivision takes custody of the parent deed,
 *   which stays in this contract until deactivateSubdivision (audit D-9): it cannot be sold or burned
 *   while units are outstanding.
 * - Collection admin rights belong to whoever holds the subdivided deed beneficially: the depositor, or
 *   whoever the depositor handed the subdivision to with transferCollectionAdmin (audit D-10).
 * - Burning can be enabled/disabled per subdivision
 * - Deactivation requires every unit to be burned, and returns the parent deed to the collection admin
 * - Unit-level validation and metadata management
 * 
 * Integration:
 * - Works with DeedNFT contract for ownership and validation
 * - Supports ERC1155 standard for unit management
 * - Implements UUPSUpgradeable for upgradability
 * - Unit-level validation and trait management
 * - MetadataRenderer integration for dynamic metadata
 */
contract Subdivide is 
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IERC2981Upgradeable,
    ISubdivide
{
    using StringsUpgradeable for uint256;

    // ============ Role Definitions ============

    /// @notice Role for administrative functions
    /// @dev Has authority to pause/unpause contract and manage upgrades
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    /// @notice Role for validation operations
    /// @dev Has authority to validate subdivision units
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    // ============ Asset Type Constants ============
    
    /// @notice Asset types that support subdivision
    /// @dev Only Land (0) and Estate (2) can be subdivided
    uint8 public constant LAND_ASSET_TYPE = 0;
    uint8 public constant ESTATE_ASSET_TYPE = 2;
    
    // ============ Contract References ============

    /// @notice Reference to the DeedNFT contract
    /// @dev Used for ownership verification and subdivision validation
    IDeedNFT public deedNFT;

    /// @notice Reference to the ValidatorRegistry contract
    /// @dev Used for validator management and validation
    address public validatorRegistry;

    /// @notice Default validator for subdivision units
    /// @dev Inherited from parent DeedNFT, can be overridden per subdivision
    address public defaultValidator;


    // ============ Data Structures ============

    /**
     * @title SubdivisionInfo
     * @dev Comprehensive information about a subdivision collection
     * 
     * @param name Name of the subdivision collection
     * @param description Description of the subdivision and its purpose
     * @param symbol Trading symbol for the subdivision tokens
     * @param collectionUri Base URI for the subdivision collection's metadata
     * @param totalUnits Total number of units authorized for the subdivision
     * @param activeUnits Current number of minted and non-burned units
     * @param isActive Operational status of the subdivision
     * @param burnable Whether token holders can burn their units
     * @param collectionAdmin Beneficial owner of the escrowed parent deed (the depositor or its successor)
     * @param subdivisionValidator Validator for this subdivision (inherits from parent if not set)
     * @param unitMetadata Custom metadata URIs for specific units
     */
    struct SubdivisionInfo {
        string name;
        string description;
        string symbol;
        string collectionUri;
        uint256 totalUnits;
        uint256 activeUnits;
        bool isActive;
        bool burnable;
        address collectionAdmin;
        address subdivisionValidator;
        mapping(uint256 => string) unitMetadata;
    }

    // ============ ERC-7496 Trait Storage ============
    /**
     * @dev Mapping from token ID to trait key to trait value
     * @notice Implements ERC-7496 trait storage for subdivision units
     */
    mapping(uint256 => mapping(bytes32 => bytes)) private _unitTraits;
    
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

    // ============ ERC721-C Security Policy ============
    // Mapping to track approved marketplaces
    mapping(address => bool) private _approvedMarketplaces;
    bool private _enforceRoyalties;
    address private _transferValidator;

    // ============ State Variables ============

    /// @notice Mapping of DeedNFT IDs to their subdivision information
    /// @dev Key: DeedNFT ID, Value: SubdivisionInfo struct
    mapping(uint256 => SubdivisionInfo) public subdivisions;

    /// @notice Tracks current owner for each non-fungible subdivision unit tokenId.
    mapping(uint256 => address) private _unitOwners;
    
    // ============ Events ============

    /**
     * @dev Emitted when a new subdivision is created
     * @param deedId ID of the parent DeedNFT
     * @param name Name of the subdivision
     * @param totalUnits Total number of units authorized
     */
    event SubdivisionCreated(uint256 indexed deedId, string name, uint256 totalUnits);
    
    /**
     * @dev Emitted when a unit is minted within a subdivision
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the minted unit
     * @param to Address receiving the unit
     */
    event UnitMinted(uint256 indexed deedId, uint256 indexed unitId, address to);
    
    /**
     * @dev Emitted when a unit's metadata is updated
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the updated unit
     * @param metadata New metadata URI
     */
    event UnitMetadataUpdated(uint256 indexed deedId, uint256 indexed unitId, string metadata);

    
    /**
     * @dev Emitted when a subdivision is deactivated
     * @param deedId ID of the parent DeedNFT
     */
    event SubdivisionDeactivated(uint256 indexed deedId);
    
    /**
     * @dev Emitted when a subdivision's burnable status changes
     * @param deedId ID of the parent DeedNFT
     * @param burnable New burnable status
     */
    event BurnableStatusChanged(uint256 indexed deedId, bool burnable);
    
    /**
     * @dev Emitted when a unit is burned
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the burned unit
     */
    event UnitBurned(uint256 indexed deedId, uint256 indexed unitId);

    /**
     * @dev Emitted when a collection admin changes
     * @param deedId ID of the DeedNFT
     * @param newAdmin Address of the new admin
     */
    event CollectionAdminChanged(uint256 indexed deedId, address indexed newAdmin);

    /**
     * @dev Emitted when a collection admin is transferred
     * @param deedId ID of the DeedNFT
     * @param previousAdmin Address of the previous admin
     * @param newAdmin Address of the new admin
     */
    event CollectionAdminTransferred(uint256 indexed deedId, address indexed previousAdmin, address indexed newAdmin);



    /**
     * @dev Emitted when a marketplace is approved
     * @param marketplace Address of the marketplace
     * @param approved Whether the marketplace is approved
     */
    event MarketplaceApproved(address indexed marketplace, bool approved);

    /**
     * @dev Emitted when royalty enforcement changes
     * @param enforced Whether royalties are enforced
     */
    event RoyaltyEnforcementChanged(bool enforced);

    /**
     * @dev Emitted when subdivision validator is updated
     * @param deedId ID of the DeedNFT
     * @param validator Address of the new validator
     */
    event SubdivisionValidatorUpdated(uint256 indexed deedId, address indexed validator);

    // ============ Audit-fix errors ============

    /// @dev isValidated, validator, beneficiary and parentDeed are never written by the collection admin (audit D-3).
    error ReservedUnitTrait(bytes32 traitKey);
    /// @dev Only the unit's recorded validator, or the subdivision's chosen validator, may give a verdict.
    error NotUnitValidator(address caller);
    /// @dev Unit IDs must fit in 128 bits for the `(deedId << 128) | unitId` packing.
    error IdOutOfRange();

    // ============ Upgrade Gap ============

    /// @dev Storage gap for future upgrades
    uint256[49] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @dev Initializes the Subdivide contract
     * @param _deedNFT Address of the DeedNFT contract
     * @param _validatorRegistry Address of the ValidatorRegistry contract
     */
    function initialize(address _deedNFT, address _validatorRegistry) public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        
        require(_deedNFT != address(0), "Invalid DeedNFT address");
        require(_validatorRegistry != address(0), "Invalid ValidatorRegistry address");
        
        deedNFT = IDeedNFT(_deedNFT);
        validatorRegistry = _validatorRegistry;
        
        // Get default validator from DeedNFT (using a hardcoded address for now)
        // TODO: This should be retrieved from DeedNFT when the function is available
        defaultValidator = address(0);
        
        // Initialize trait keys and names
        _initializeTraits();
        
        // Set default security policy
        setToDefaultSecurityPolicy();
    }

    /**
     * @dev Initialize trait keys and names
     */
    function _initializeTraits() private {
        // Initialize trait keys and names in one go
        _allTraitKeys = [
            keccak256("assetType"),
            keccak256("isValidated"),
            keccak256("operatingAgreement"),
            keccak256("definition"),
            keccak256("configuration"),
            keccak256("validator"),
            keccak256("beneficiary"),
            keccak256("parentDeed"),
            keccak256("unitType")
        ];
        
        // Map trait keys to names
        _traitNames[keccak256("assetType")] = "Asset Type";
        _traitNames[keccak256("isValidated")] = "Validation Status";
        _traitNames[keccak256("operatingAgreement")] = "Operating Agreement";
        _traitNames[keccak256("definition")] = "Definition";
        _traitNames[keccak256("configuration")] = "Configuration";
        _traitNames[keccak256("validator")] = "Validator";
        _traitNames[keccak256("beneficiary")] = "Beneficiary";
        _traitNames[keccak256("parentDeed")] = "Parent Deed";
        _traitNames[keccak256("unitType")] = "Unit Type";
    }

    // ============ Access Control Functions ============

    /**
     * @dev Authorizes contract upgrades
     * @param newImplementation Address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    // ============ Subdivision Management Functions ============

    /**
     * @dev Creates a new subdivision for a DeedNFT
     * @param deedId ID of the DeedNFT to subdivide
     * @param name Name of the subdivision
     * @param description Description of the subdivision
     * @param symbol Symbol for the subdivision tokens
     * @param collectionUri Base URI for the subdivision collection
     * @param totalUnits Total number of units to create
     * @param burnable Whether units can be burned by holders
     */
    function createSubdivision(
        uint256 deedId,
        string memory name,
        string memory description,
        string memory symbol,
        string memory collectionUri,
        uint256 totalUnits,
        bool burnable
    ) external whenNotPaused {
        require(deedNFT.ownerOf(deedId) == msg.sender, "Not deed owner");
        // Unit IDs must fit in the low 128 bits of `(deedId << 128) | unitId`. DeedNFT IDs are always below
        // 2^128 (sequential, or salted in [2^127, 2^128)).
        if (totalUnits > type(uint128).max) revert IdOutOfRange();

        // Check if deed is validated
        (bool isValidated,) = deedNFT.getValidationStatus(deedId);
        require(isValidated, "Deed must be validated");
        
        // Check if asset type supports subdivision (only Land and Estate)
        bytes memory assetTypeBytes = deedNFT.getTraitValue(deedId, keccak256("assetType"));
        require(assetTypeBytes.length > 0, "Asset type not found");
        uint8 assetType = uint8(abi.decode(assetTypeBytes, (uint8)));
        require(
            assetType == LAND_ASSET_TYPE || assetType == ESTATE_ASSET_TYPE, 
            "Only Land (0) and Estate (2) asset types can be subdivided"
        );
        
        require(totalUnits > 0, "Invalid units amount");
        require(!subdivisions[deedId].isActive, "Subdivision already exists");
        require(bytes(symbol).length > 0, "Symbol required");
        require(bytes(collectionUri).length > 0, "Collection URI required");

        SubdivisionInfo storage newSubdivision = subdivisions[deedId];
        newSubdivision.name = name;
        newSubdivision.description = description;
        newSubdivision.symbol = symbol;
        newSubdivision.collectionUri = collectionUri;
        newSubdivision.totalUnits = totalUnits;
        newSubdivision.activeUnits = 0;
        newSubdivision.isActive = true;
        newSubdivision.burnable = burnable;
        newSubdivision.collectionAdmin = msg.sender;
        newSubdivision.subdivisionValidator = address(0); // Will inherit from parent DeedNFT

        // Audit D-9: take custody of the parent for the life of the subdivision, so it cannot be sold
        // or burned while units claim the land. Needs the holder's approval and this contract as an
        // approved marketplace on DeedNFT. Released only by deactivateSubdivision.
        deedNFT.transferFrom(msg.sender, address(this), deedId);

        emit SubdivisionCreated(deedId, name, totalUnits);
    }

    /**
     * @dev Updates the burnable status of a subdivision
     * @param deedId ID of the DeedNFT
     * @param burnable New burnable status
     */
    function setBurnable(uint256 deedId, bool burnable) external whenNotPaused onlyCollectionAdmin(deedId) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        subdivisions[deedId].burnable = burnable;
        emit BurnableStatusChanged(deedId, burnable);
    }

    /**
     * @dev Sets the metadata for a specific unit in a subdivision
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit
     * @param metadata New metadata URI
     */
    function setUnitMetadata(uint256 deedId, uint256 unitId, string calldata metadata)
        external
        whenNotPaused
        onlyCollectionAdmin(deedId) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        subdivisions[deedId].unitMetadata[unitId] = metadata;
        emit UnitMetadataUpdated(deedId, unitId, metadata);
    }

    /**
     * @dev Sets a custom validator for a subdivision
     * @param deedId ID of the DeedNFT
     * @param validator Address of the validator (address(0) to inherit from parent DeedNFT)
     */
    function setSubdivisionValidator(uint256 deedId, address validator)
        external
        whenNotPaused
        onlyCollectionAdmin(deedId) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        if (validator != address(0)) {
            require(
                IValidatorRegistry(validatorRegistry).isValidatorActive(validator),
                "Validator not active"
            );
        }
        
        subdivisions[deedId].subdivisionValidator = validator;
        emit SubdivisionValidatorUpdated(deedId, validator);
    }

    /**
     * @dev Gets the validator for a subdivision (inherits from parent DeedNFT if not set)
     * @param deedId ID of the DeedNFT
     * @return validator Address of the validator
     */
    function getSubdivisionValidator(uint256 deedId) public view returns (address validator) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        // If subdivision has a custom validator, use it
        if (subdivisions[deedId].subdivisionValidator != address(0)) {
            return subdivisions[deedId].subdivisionValidator;
        }
        
        // Otherwise, inherit from parent DeedNFT
        return defaultValidator;
    }

    /**
     * @dev Checks if a subdivision exists
     * @param deedId ID of the DeedNFT to check
     * @return Boolean indicating if the subdivision exists
     */
    function subdivisionExists(uint256 deedId) external view returns (bool) {
        return subdivisions[deedId].isActive;
    }

    /**
     * @dev Checks if a subdivision unit exists
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit
     * @return Boolean indicating if the unit exists
     */
    function unitExists(uint256 deedId, uint256 unitId) external view returns (bool) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        return unitId < subdivisions[deedId].totalUnits;
    }

    /**
     * @dev Gets the asset type of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return assetType Type of the asset
     */
    function getUnitAssetType(uint256 deedId, uint256 unitId) external view returns (uint8) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        // Every minted unit copies the parent's asset type at mint. (The old fallback called
        // DeedNFT.getAssetType, which DeedNFT never implemented, audit D-23.)
        return uint8(abi.decode(_unitTraits[_generateTokenId(deedId, unitId)][keccak256("assetType")], (uint8)));
    }

    /**
     * @dev Checks if a subdivision unit is validated
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return isValidated Whether the unit is validated
     */
    function isUnitValidated(uint256 deedId, uint256 unitId) external view returns (bool) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        bytes memory isValidatedBytes = _unitTraits[tokenId][keccak256("isValidated")];
        
        return isValidatedBytes.length > 0 ? abi.decode(isValidatedBytes, (bool)) : false;
    }

    /**
     * @dev Checks if an asset type supports subdivision
     * @param assetType The asset type to check
     * @return Whether the asset type can be subdivided
     * @notice Only Land (0) and Estate (2) can be subdivided
     */
    function supportsSubdivision(uint8 assetType) external pure returns (bool) {
        return assetType == LAND_ASSET_TYPE || assetType == ESTATE_ASSET_TYPE;
    }

    // ============ Minting Functions ============

    /**
     * @dev Mints a single subdivision unit to a specified address
     * @notice If recipient address is zero, defaults to DeedNFT owner
     * 
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit to mint (must be less than totalUnits)
     * @param to Address to receive the unit (address(0) defaults to DeedNFT owner)
     * 
     * Requirements:
     * - Subdivision must be active
     * - Unit ID must be valid
     * - Caller must be DeedNFT owner
     * - Contract must not be paused
     * 
     * Emits a {UnitMinted} event
     */
    function mintUnit(
        uint256 deedId,
        uint256 unitId,
        address to
    ) external whenNotPaused {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");

        address deedOwner = _requireSubdivisionOwner(deedId);

        address recipient = to == address(0) ? deedOwner : to;
        uint256 tokenId = _generateTokenId(deedId, unitId);
        require(_unitOwners[tokenId] == address(0), "Unit already minted");
        
        _mint(recipient, tokenId, 1, "");
        subdivisions[deedId].activeUnits += 1;
        
        // Set initial traits for the unit
        _setInitialUnitTraits(deedId, tokenId, recipient);
        
        emit UnitMinted(deedId, unitId, recipient);
    }

    /**
     * @dev Mints multiple subdivision units in a single transaction
     * @notice Allows batch minting of units to different addresses
     * 
     * @param deedId ID of the parent DeedNFT
     * @param unitIds Array of unit IDs to mint (each must be less than totalUnits)
     * @param recipients Array of addresses to receive the units (address(0) defaults to DeedNFT owner)
     * 
     * Requirements:
     * - Subdivision must be active
     * - All unit IDs must be valid
     * - Arrays must be same length
     * - Caller must be DeedNFT owner
     * - Contract must not be paused
     * 
     * Security:
     * - Validates all unit IDs before minting
     * - Prevents array length mismatch exploits
     * - Maintains accurate active units count
     * 
     * Emits multiple {UnitMinted} events, one for each minted unit
     */
    function batchMintUnits(
        uint256 deedId,
        uint256[] calldata unitIds,
        address[] calldata recipients
    ) external whenNotPaused {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitIds.length == recipients.length, "Array length mismatch");

        address deedOwner = _requireSubdivisionOwner(deedId);
        
        // Validate and mint in single loop
        for (uint256 i = 0; i < unitIds.length; i++) {
            require(unitIds[i] < subdivisions[deedId].totalUnits, "Invalid unit ID");
            
            uint256 tokenId = _generateTokenId(deedId, unitIds[i]);
            require(_unitOwners[tokenId] == address(0), "Unit already minted");
            address recipient = recipients[i] == address(0) ? deedOwner : recipients[i];
            
            _mint(recipient, tokenId, 1, "");
            subdivisions[deedId].activeUnits += 1;
            _setInitialUnitTraits(deedId, tokenId, recipient);
            emit UnitMinted(deedId, unitIds[i], recipient);
        }
    }

    /**
     * @dev Burns a subdivision unit
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit to burn
     */
    function burnUnit(uint256 deedId, uint256 unitId) external {
        uint256 tokenId = _generateTokenId(deedId, unitId);
        require(balanceOf(msg.sender, tokenId) > 0, "Not unit owner");
        require(subdivisions[deedId].burnable, "Burning not allowed");
        
        _burn(msg.sender, tokenId, 1);
        subdivisions[deedId].activeUnits -= 1;
        
        emit UnitBurned(deedId, unitId);
    }

    /**
     * @dev Deactivates a subdivision once every unit is burned, and returns the escrowed parent deed to
     *      the collection admin (its beneficial owner). Not pausable: it is the holder's exit.
     * @param deedId ID of the DeedNFT
     */
    function deactivateSubdivision(uint256 deedId) external {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        _requireSubdivisionOwner(deedId);

        // Deactivation is only allowed once all outstanding units are burned.
        require(subdivisions[deedId].activeUnits == 0, "Outstanding units exist");

        subdivisions[deedId].isActive = false;
        if (deedNFT.ownerOf(deedId) == address(this)) {
            deedNFT.transferFrom(address(this), msg.sender, deedId);
        }
        emit SubdivisionDeactivated(deedId);
    }

    /**
     * @dev The account that controls a subdivision: the collection admin while this contract holds the
     *      parent deed (audit D-9/D-10), otherwise the parent's current owner (subdivisions created
     *      before custody existed). Reverts "Not deed owner" for anyone else.
     */
    function _subdivisionOwner(uint256 deedId) internal view returns (address) {
        address holder = deedNFT.ownerOf(deedId);
        return holder == address(this) ? subdivisions[deedId].collectionAdmin : holder;
    }

    function _requireSubdivisionOwner(uint256 deedId) internal view returns (address owner_) {
        owner_ = _subdivisionOwner(deedId);
        require(msg.sender == owner_, "Not deed owner");
    }


    // ============ Validation Functions ============

    /**
     * @dev Updates the validation status of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit to validate
     * @param isValid Whether the unit is valid
     * @param validatorAddress Address of the validator (optional, uses subdivision validator if not provided)
     * @notice This function can only be called by a registered validator
     */
    function updateUnitValidationStatus(
        uint256 deedId, 
        uint256 unitId, 
        bool isValid, 
        address validatorAddress
    ) external whenNotPaused onlyRole(VALIDATOR_ROLE) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");

        require(
            validatorAddress == address(0) || validatorAddress == msg.sender,
            "Validator mismatch"
        );
        address validator = msg.sender;
        require(
            IValidatorRegistry(validatorRegistry).isValidatorActive(validator),
            "Validator not active"
        );

        uint256 tokenId = _generateTokenId(deedId, unitId);

        // Per-unit authority (audit D-3, mirroring D-7): the unit's recorded validator, or the validator
        // the collection admin chose for the subdivision. Another active validator cannot overwrite it.
        bytes memory recorded = _unitTraits[tokenId][keccak256("validator")];
        address recordedValidator = recorded.length > 0 ? abi.decode(recorded, (address)) : address(0);
        if (validator != recordedValidator && validator != subdivisions[deedId].subdivisionValidator) {
            revert NotUnitValidator(validator);
        }

        // Update traits
        _setUnitTraitValue(tokenId, keccak256("isValidated"), abi.encode(isValid));
        _setUnitTraitValue(tokenId, keccak256("validator"), abi.encode(validator));
        
        emit UnitValidated(deedId, unitId, isValid);
    }

    /**
     * @dev Returns the validation status of a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return isValidated Whether the unit is validated
     * @return validator Address of the validator that validated the unit
     */
    function getUnitValidationStatus(uint256 deedId, uint256 unitId) 
        external 
        view 
        returns (bool isValidated, address validator) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        
        bytes memory isValidatedBytes = _unitTraits[tokenId][keccak256("isValidated")];
        bytes memory validatorBytes = _unitTraits[tokenId][keccak256("validator")];
        
        isValidated = isValidatedBytes.length > 0 ? abi.decode(isValidatedBytes, (bool)) : false;
        validator = validatorBytes.length > 0 ? abi.decode(validatorBytes, (address)) : address(0);
        
        return (isValidated, validator);
    }

    // ============ Trait Management Functions ============

    /**
     * @dev Sets a trait value for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the trait
     * @param traitValue Value of the trait
     * @notice Updates a trait and emits a UnitTraitUpdated event
     * @notice Asset type changes are validated against parent DeedNFT constraints
     */
    function setUnitTrait(
        uint256 deedId,
        uint256 unitId,
        bytes32 traitKey,
        bytes memory traitValue
    ) external whenNotPaused onlyCollectionAdmin(deedId) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");

        // Validate asset type changes if traitKey is assetType
        if (traitKey == keccak256("assetType")) {
            _validateAssetTypeChange(deedId, traitValue);
        }

        uint256 tokenId = _generateTokenId(deedId, unitId);
        _beforeAdminTraitWrite(deedId, unitId, tokenId, traitKey);
        _setUnitTraitValue(tokenId, traitKey, traitValue);
        
        emit UnitTraitUpdated(deedId, unitId, traitKey, traitValue);
    }

    /**
     * @dev Gets a trait value for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the trait
     * @return Value of the trait
     */
    function getUnitTraitValue(uint256 deedId, uint256 unitId, bytes32 traitKey) 
        external 
        view 
        returns (bytes memory) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        return _unitTraits[tokenId][traitKey];
    }

    /**
     * @dev Gets multiple trait values for a subdivision unit
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKeys Array of trait keys
     * @return Array of trait values
     */
    function getUnitTraitValues(
        uint256 deedId, 
        uint256 unitId, 
        bytes32[] calldata traitKeys
    ) external view returns (bytes[] memory) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        bytes[] memory values = new bytes[](traitKeys.length);
        for (uint256 i = 0; i < traitKeys.length; i++) {
            values[i] = _unitTraits[tokenId][traitKeys[i]];
        }
        return values;
    }

    /**
     * @dev Gets all trait keys for a subdivision unit that have values
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @return Array of trait keys that have values
     */
    function getUnitTraitKeys(uint256 deedId, uint256 unitId) external view returns (bytes32[] memory) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        bytes32[] memory traitKeys = new bytes32[](_allTraitKeys.length);
        uint256 count;
        
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_unitTraits[tokenId][_allTraitKeys[i]].length > 0) {
                traitKeys[count++] = _allTraitKeys[i];
            }
        }
        
        // Resize array to actual count
        assembly {
            mstore(traitKeys, count)
        }
        
        return traitKeys;
    }

    /**
     * @dev Gets the name of a trait
     * @param traitKey Key of the trait
     * @return Name of the trait
     */
    function getUnitTraitName(bytes32 traitKey) external view returns (string memory) {
        return _traitNames[traitKey];
    }

    /**
     * @dev Sets the name for a trait key
     * @param traitKey Key of the trait
     * @param traitName Name of the trait
     */
    function setUnitTraitName(bytes32 traitKey, string memory traitName) external onlyRole(ADMIN_ROLE) {
        _traitNames[traitKey] = traitName;
    }

    /**
     * @dev Removes a trait from a subdivision unit using human-readable name
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitName Name of the trait to remove
     */
    function removeUnitTrait(uint256 deedId, uint256 unitId, string memory traitName) 
        external
        whenNotPaused
        onlyCollectionAdmin(deedId)
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");

        uint256 tokenId = _generateTokenId(deedId, unitId);
        bytes32 traitKey = keccak256(bytes(traitName));
        require(_unitTraits[tokenId][traitKey].length > 0, "Trait does not exist");
        if (traitKey == keccak256("assetType")) revert ReservedUnitTrait(traitKey);
        _beforeAdminTraitWrite(deedId, unitId, tokenId, traitKey);
        
        delete _unitTraits[tokenId][traitKey];
        emit UnitTraitUpdated(deedId, unitId, traitKey, "");
    }

    /**
     * @dev Sets a trait value with flexible input types (similar to DeedNFT.setTrait)
     * @param deedId ID of the parent DeedNFT
     * @param unitId ID of the unit
     * @param traitKey Key of the trait (either bytes32 or string)
     * @param traitValue Value of the trait (supports various types)
     * @param valueType Type of the value (0=bytes, 1=string, 2=uint256, 3=bool)
     * @notice This function consolidates all trait setting operations into one
     *         Can be used with direct bytes32 keys or human-readable names
     *         Supports different value types through type parameter
     * @notice Asset type changes are validated against parent DeedNFT constraints
     */
    function setUnitTraitFlexible(
        uint256 deedId,
        uint256 unitId,
        bytes memory traitKey,
        bytes memory traitValue,
        uint8 valueType
    ) external whenNotPaused onlyCollectionAdmin(deedId) {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        uint256 tokenId = _generateTokenId(deedId, unitId);
        
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
        
        // Validate asset type changes if traitKey is assetType
        if (key == keccak256("assetType")) {
            _validateAssetTypeChange(deedId, value);
        }

        _beforeAdminTraitWrite(deedId, unitId, tokenId, key);
        _setUnitTraitValue(tokenId, key, value);
        
        // If trait was provided as string, set the trait name automatically
        if (isStringKey) {
            _traitNames[key] = string(traitKey);
        }
        
        emit UnitTraitUpdated(deedId, unitId, key, value);
    }

    /**
     * @dev Gets the metadata URI for traits
     * @return Base64-encoded JSON schema indicating dynamic trait support
     */
    function getUnitTraitMetadataURI() external pure returns (string memory) {
        // Simple schema indicating dynamic trait support
        return "data:application/json;base64,eyJ0cmFpdHMiOiB7ImR5bmFtaWMiOiB0cnVlfX0=";
    }

    // ============ View Functions ============

    /**
     * @dev Retrieves metadata for a specific unit
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit
     * @return Metadata URI string
     */
    function getUnitMetadata(uint256 deedId, uint256 unitId) 
        external 
        view 
        returns (string memory) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        return subdivisions[deedId].unitMetadata[unitId];
    }

    /**
     * @dev Generates a unique token ID by combining deedId and unitId
     * @param deedId ID of the DeedNFT
     * @param unitId ID of the unit
     * @return Combined token ID
     */
    function _generateTokenId(uint256 deedId, uint256 unitId) 
        internal 
        pure 
        returns (uint256) 
    {
        return (deedId << 128) | unitId;
    }

    /**
     * @dev Returns the metadata URI for a token
     * @param tokenId ID of the token
     * @return Metadata URI string
     */
    function uri(uint256 tokenId) public view override(ERC1155Upgradeable, ISubdivide) returns (string memory) {
        uint256 deedId = tokenId >> 128;
        uint256 unitId = tokenId & ((1 << 128) - 1);
        
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        // Check for custom unit metadata
        if (bytes(subdivisions[deedId].unitMetadata[unitId]).length > 0) {
            return subdivisions[deedId].unitMetadata[unitId];
        }
        
        // Fall back to collection URI
        return string(abi.encodePacked(
            subdivisions[deedId].collectionUri,
            "/",
            StringsUpgradeable.toString(unitId)
        ));
    }

    // ============ Royalty Functions ============

    /**
     * @dev Returns the royalty information for a token
     * @param tokenId ID of the token
     * @param salePrice Sale price of the token
     * @return receiver Address that should receive royalties
     * @return royaltyAmount Amount of royalties to be paid
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice) 
        external 
        view 
        override(IERC2981Upgradeable, ISubdivide)
        returns (address receiver, uint256 royaltyAmount) 
    {
        uint256 deedId = tokenId >> 128;
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        // Get validator from traits
        bytes memory validatorBytes = _unitTraits[tokenId][keccak256("validator")];
        if (validatorBytes.length > 0) {
            address validator = abi.decode(validatorBytes, (address));
            // Only an active registered validator receives unit royalties; anything else falls back to
            // the parent deed (audit D-3).
            if (validator != address(0) && IValidatorRegistry(validatorRegistry).isValidatorActive(validator)) {
                uint96 fee = IValidator(validator).getRoyaltyFeePercentage(tokenId);
                receiver = validator;
                royaltyAmount = (salePrice * fee) / 10000;
                return (receiver, royaltyAmount);
            }
        }
        
        // Fall back to parent DeedNFT royalty info
        return deedNFT.royaltyInfo(deedId, salePrice);
    }

    // ============ Marketplace Functions ============

    /**
     * @dev Sets the contract to the default security policy for royalty enforcement
     */
    function setToDefaultSecurityPolicy() public onlyRole(ADMIN_ROLE) {
        _enforceRoyalties = true;
        emit RoyaltyEnforcementChanged(true);
    }

    /**
     * @dev Approves a marketplace for trading
     * @param marketplace Address of the marketplace
     * @param approved Whether the marketplace is approved
     */
    function setApprovedMarketplace(address marketplace, bool approved) external onlyRole(ADMIN_ROLE) {
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
    function setRoyaltyEnforcement(bool enforced) external onlyRole(ADMIN_ROLE) {
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

    // ============ Admin Functions ============

    /**
     * @dev Pauses all contract operations
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses all contract operations
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }


    /**
     * @dev See {IERC165-supportsInterface}
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155Upgradeable, AccessControlUpgradeable, IERC165Upgradeable, ISubdivide)
        returns (bool)
    {
        return 
            interfaceId == type(IERC2981Upgradeable).interfaceId ||
            interfaceId == 0xaf332f3e || // ERC-7496 (Dynamic Traits)
            super.supportsInterface(interfaceId);
    }

    /**
     * @notice Transfers collection admin rights to a new address. While the parent deed is in custody
     *         here, this hands over the beneficial ownership of the subdivided deed: the new admin is
     *         the one who gets the deed back on deactivation (audit D-10).
     * @param deedId ID of the DeedNFT
     * @param newAdmin Address of the new admin
     */
    function transferCollectionAdmin(uint256 deedId, address newAdmin) external whenNotPaused {
        _requireCollectionAdmin(deedId);
        require(newAdmin != address(0), "Invalid admin address");
        
        address previousAdmin = subdivisions[deedId].collectionAdmin;
        subdivisions[deedId].collectionAdmin = newAdmin;
        emit CollectionAdminTransferred(deedId, previousAdmin, newAdmin);
    }

    /**
     * @notice Modifier to restrict access to collection admin. Admin rights follow the deed's beneficial
     *         owner, not whoever created the subdivision (audit D-10).
     */
    modifier onlyCollectionAdmin(uint256 deedId) {
        // Out of line, so the check is not copied into every function (bytecode room for v5).
        _requireCollectionAdmin(deedId);
        _;
    }

    function _requireCollectionAdmin(uint256 deedId) internal view {
        require(_subdivisionOwner(deedId) == msg.sender, "Not collection admin");
    }

    /**
     * @notice Trust agreement v5, item 5 (IDeedCustody): while this contract holds a parent deed for an
     *         active subdivision, the deed belongs to the collection admin, who gets it back on
     *         deactivation. address(0) when no subdivision of `deedId` is active. (Every subdivision created
     *         since audit D-9 holds its parent while active; DeedNFT asks only when this contract is the holder.)
     */
    function beneficialOwnerOf(uint256 deedId) external view returns (address) {
        return subdivisions[deedId].isActive ? subdivisions[deedId].collectionAdmin : address(0);
    }

    /**
     * @dev Guards every collection-admin trait write (audit D-3): the validation, validator, beneficiary
     *      and parent-link traits are never the admin's to write, and editing a validated unit withdraws
     *      its validation until its validator looks again.
     */
    function _beforeAdminTraitWrite(uint256 deedId, uint256 unitId, uint256 tokenId, bytes32 key) internal {
        if (
            key == keccak256("isValidated") ||
            key == keccak256("validator") ||
            key == keccak256("beneficiary") ||
            key == keccak256("parentDeed")
        ) revert ReservedUnitTrait(key);
        bytes memory v = _unitTraits[tokenId][keccak256("isValidated")];
        if (v.length > 0 && abi.decode(v, (bool))) {
            _setUnitTraitValue(tokenId, keccak256("isValidated"), abi.encode(false));
            emit UnitValidated(deedId, unitId, false);
        }
    }

    // ============ Internal Functions ============

    /**
     * @dev Sets initial traits for a newly minted unit
     * @param deedId ID of the parent DeedNFT
     * @param tokenId Combined token ID
     * @param beneficiary Initial beneficiary/current owner of the unit
     */
    function _setInitialUnitTraits(uint256 deedId, uint256 tokenId, address beneficiary) internal {
        // Set default traits
        _setUnitTraitValue(tokenId, keccak256("isValidated"), abi.encode(false));
        _setUnitTraitValue(tokenId, keccak256("parentDeed"), abi.encode(deedId));
        _setUnitTraitValue(tokenId, keccak256("unitType"), abi.encode("Subdivision Unit"));
        _setUnitTraitValue(tokenId, keccak256("beneficiary"), abi.encode(beneficiary));
        
        // Inherit traits from parent DeedNFT
        bytes32[4] memory traitKeys = [keccak256("assetType"), keccak256("operatingAgreement"), keccak256("definition"), keccak256("configuration")];
        for (uint i = 0; i < 4; i++) {
            bytes memory value = deedNFT.getTraitValue(deedId, traitKeys[i]);
            if (value.length > 0) {
                _setUnitTraitValue(tokenId, traitKeys[i], value);
            }
        }
        
        // Set validator (use subdivision validator or inherit from parent)
        address subdivisionValidator = getSubdivisionValidator(deedId);
        if (subdivisionValidator != address(0)) {
            _setUnitTraitValue(tokenId, keccak256("validator"), abi.encode(subdivisionValidator));
        } else {
            // Fall back to parent DeedNFT validator
            bytes memory validatorBytes = deedNFT.getTraitValue(deedId, keccak256("validator"));
            if (validatorBytes.length > 0) {
                _setUnitTraitValue(tokenId, keccak256("validator"), validatorBytes);
            }
        }
    }

    /**
     * @dev Sets a trait value for a subdivision unit
     * @param tokenId ID of the token
     * @param traitKey Key of the trait
     * @param traitValue Value of the trait
     */
    function _setUnitTraitValue(uint256 tokenId, bytes32 traitKey, bytes memory traitValue) internal {
        // Add trait key if it doesn't exist (optimized check)
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_allTraitKeys[i] == traitKey) {
                _unitTraits[tokenId][traitKey] = traitValue;
                return;
            }
        }
        _allTraitKeys.push(traitKey);
        _unitTraits[tokenId][traitKey] = traitValue;
    }

    /**
     * @dev Track per-unit ownership for ERC1155 non-fungible units.
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        // Royalty enforcement (audit D-17): a third-party operator must be an approved marketplace.
        // Holder-sent transfers and burns are never blocked, and pause does not stop them: units are
        // the holders' property.
        if (from != address(0) && to != address(0) && _enforceRoyalties && operator != from && !_approvedMarketplaces[operator]) {
            revert("!mkt");
        }

        for (uint256 i = 0; i < ids.length; i++) {
            require(amounts[i] == 1, "Invalid unit amount");
            uint256 tokenId = ids[i];

            if (from == address(0)) {
                // Mint
                require(_unitOwners[tokenId] == address(0), "Unit already minted");
                _unitOwners[tokenId] = to;
            } else if (to == address(0)) {
                // Burn
                require(_unitOwners[tokenId] == from, "Not unit owner");
                delete _unitOwners[tokenId];
            } else {
                // Transfer
                require(_unitOwners[tokenId] == from, "Not unit owner");
                _unitOwners[tokenId] = to;

                uint256 deedId = tokenId >> 128;
                uint256 unitId = tokenId & ((1 << 128) - 1);
                // A unit going into an approved marketplace or custody contract (e.g. Fractionalize) keeps
                // its depositor as beneficiary (audit D-19).
                if (!_approvedMarketplaces[to]) {
                    _setUnitTraitValue(tokenId, keccak256("beneficiary"), abi.encode(to));
                    emit UnitTraitUpdated(deedId, unitId, keccak256("beneficiary"), abi.encode(to));
                }
            }
        }
    }

    /**
     * @dev Validates asset type changes for subdivision units
     * @param newAssetTypeBytes Encoded asset type value
     * @notice Units of a Land or Estate parent (the only subdividable types) may be Land or Estate.
     */
    function _validateAssetTypeChange(uint256, bytes memory newAssetTypeBytes) internal pure {
        require(newAssetTypeBytes.length > 0, "Invalid asset type");
        
        uint8 newAssetType = uint8(abi.decode(newAssetTypeBytes, (uint8)));
        // createSubdivision only accepts Land and Estate parents, so a unit is always Land or Estate. (The
        // Vehicle/Equipment branches were unreachable, and the parent lookup called getAssetType, which
        // DeedNFT did not implement, audit D-23.)
        require(newAssetType == LAND_ASSET_TYPE || newAssetType == ESTATE_ASSET_TYPE, "Land subdivisions can only be Land or Estate");
    }

    // ============ Missing Interface Implementations ============

    /**
     * @dev Returns the owner of a specific token
     * @param tokenId ID of the token to query
     * @return Address of the token owner
     */
    function ownerOf(uint256 tokenId) external view returns (address) {
        address unitOwner = _unitOwners[tokenId];
        require(unitOwner != address(0), "Unit not minted");
        return unitOwner;
    }

    // Audit D-18 (as on DeedNFT): the inert ERC721-C transfer-validator getters and setter are removed;
    // `_transferValidator` is kept only for storage layout. Enforcement is the approved-marketplace list.

    /**
     * @dev Grants the VALIDATOR_ROLE to an address
     * @param validator Address to grant the VALIDATOR_ROLE to
     */
    function addValidator(address validator) external onlyRole(ADMIN_ROLE) {
        _grantRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Revokes the VALIDATOR_ROLE from an address
     * @param validator Address to revoke the VALIDATOR_ROLE from
     */
    function removeValidator(address validator) external onlyRole(ADMIN_ROLE) {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @dev Override grantRole to satisfy both AccessControlUpgradeable and ISubdivide
     */
    function grantRole(bytes32 role, address account) public override(AccessControlUpgradeable, ISubdivide) {
        super.grantRole(role, account);
    }

    /**
     * @dev Override hasRole to satisfy both AccessControlUpgradeable and ISubdivide
     */
    function hasRole(bytes32 role, address account) public view override(AccessControlUpgradeable, ISubdivide) returns (bool) {
        return super.hasRole(role, account);
    }
}
