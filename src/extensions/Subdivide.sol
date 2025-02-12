// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

/**
 * @title IDeedNFT Interface
 * @dev Interface for interacting with the DeedNFT contract.
 *      Required for subdivision validation and ownership checks.
 *      Ensures compatibility with the core DeedNFT contract.
 */
interface IDeedNFT {
    enum AssetType { Land, Vehicle, Estate, CommercialEquipment }
    function ownerOf(uint256 tokenId) external view returns (address);
    function canSubdivide(uint256 tokenId) external view returns (bool);
    function getDeedInfo(uint256 tokenId) external view returns (
        AssetType assetType,
        bool isValidated,
        string memory operatingAgreement,
        string memory definition,
        string memory configuration,
        address validator
    );
}

/**
 * @title Subdivide
 * @dev Contract for subdividing DeedNFTs into multiple ERC1155 tokens.
 *      Allows DeedNFT owners to create and manage subdivisions of their Land or Estate assets.
 *      Each subdivision represents a collection of units or parcels tied to the original DeedNFT.
 *      
 * Security:
 * - Only DeedNFT owners can create and manage subdivisions
 * - Burning can be enabled/disabled per subdivision
 * - Deactivation requires ownership of all active units
 * 
 * Integration:
 * - Works with DeedNFT contract for ownership and validation
 * - Supports ERC1155 standard for unit management
 * - Implements UUPSUpgradeable for upgradability
 */
contract Subdivide is 
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable 
{
    using StringsUpgradeable for uint256;

    // ============ Role Definitions ============

    /// @notice Role for administrative functions
    /// @dev Has authority to pause/unpause contract and manage upgrades
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // ============ Contract References ============

    /// @notice Reference to the DeedNFT contract
    /// @dev Used for ownership verification and subdivision validation
    IDeedNFT public deedNFT;

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
     * @param collectionAdmin Address of the collection admin
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
        mapping(uint256 => string) unitMetadata;
    }
    
    // ============ State Variables ============

    /// @notice Mapping of DeedNFT IDs to their subdivision information
    /// @dev Key: DeedNFT ID, Value: SubdivisionInfo struct
    mapping(uint256 => SubdivisionInfo) public subdivisions;
    
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
     * @dev Initializes the Subdivide contract
     * @param _deedNFT Address of the DeedNFT contract
     */
    function initialize(address _deedNFT) public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        
        require(_deedNFT != address(0), "Invalid DeedNFT address");
        deedNFT = IDeedNFT(_deedNFT);
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
        require(deedNFT.canSubdivide(deedId), "Deed cannot be subdivided");
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

        emit SubdivisionCreated(deedId, name, totalUnits);
    }

    /**
     * @dev Updates the burnable status of a subdivision
     * @param deedId ID of the DeedNFT
     * @param burnable New burnable status
     */
    function setBurnable(uint256 deedId, bool burnable) external onlyCollectionAdmin(deedId) {
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
        onlyCollectionAdmin(deedId) 
    {
        require(subdivisions[deedId].isActive, "Subdivision not active");
        require(unitId < subdivisions[deedId].totalUnits, "Invalid unit ID");
        
        subdivisions[deedId].unitMetadata[unitId] = metadata;
        emit UnitMetadataUpdated(deedId, unitId, metadata);
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
        
        address deedOwner = deedNFT.ownerOf(deedId);
        require(msg.sender == deedOwner, "Not deed owner");
        
        address recipient = to == address(0) ? deedOwner : to;
        uint256 tokenId = _generateTokenId(deedId, unitId);
        
        _mint(recipient, tokenId, 1, "");
        subdivisions[deedId].activeUnits += 1;
        
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
        
        address deedOwner = deedNFT.ownerOf(deedId);
        require(msg.sender == deedOwner, "Not deed owner");
        
        uint256[] memory tokenIds = new uint256[](unitIds.length);
        uint256[] memory amounts = new uint256[](unitIds.length);
        address[] memory finalRecipients = new address[](unitIds.length);
        
        // Validate all inputs before minting
        for (uint256 i = 0; i < unitIds.length; i++) {
            require(unitIds[i] < subdivisions[deedId].totalUnits, "Invalid unit ID");
            tokenIds[i] = _generateTokenId(deedId, unitIds[i]);
            amounts[i] = 1;
            finalRecipients[i] = recipients[i] == address(0) ? deedOwner : recipients[i];
        }
        
        // Perform minting operations
        for (uint256 i = 0; i < unitIds.length; i++) {
            _mint(finalRecipients[i], tokenIds[i], 1, "");
            subdivisions[deedId].activeUnits += 1;
            emit UnitMinted(deedId, unitIds[i], finalRecipients[i]);
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
     * @dev Deactivates a subdivision if all units are owned by the DeedNFT owner or burned
     * @param deedId ID of the DeedNFT
     */
    function deactivateSubdivision(uint256 deedId) external {
        address deedOwner = deedNFT.ownerOf(deedId);
        require(deedOwner == msg.sender, "Not deed owner");
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        SubdivisionInfo storage subdivision = subdivisions[deedId];
        
        // Check if there are any active units not owned by the deed owner
        for (uint256 i = 0; i < subdivision.totalUnits; i++) {
            uint256 tokenId = _generateTokenId(deedId, i);
            uint256 balance = balanceOf(msg.sender, tokenId);
            if (balance > 0 && msg.sender != deedOwner) {
                revert("Outstanding units exist");
            }
        }
        
        require(subdivision.activeUnits == 0 || 
                subdivision.activeUnits == balanceOf(deedOwner, _generateTokenId(deedId, 0)), 
                "Outstanding units exist");
        
        subdivision.isActive = false;
        emit SubdivisionDeactivated(deedId);
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
    function uri(uint256 tokenId) public view override returns (string memory) {
        uint256 deedId = tokenId >> 128;
        uint256 unitId = tokenId & ((1 << 128) - 1);
        
        require(subdivisions[deedId].isActive, "Subdivision not active");
        
        if (bytes(subdivisions[deedId].unitMetadata[unitId]).length > 0) {
            return subdivisions[deedId].unitMetadata[unitId];
        }
        
        return string(abi.encodePacked(
            subdivisions[deedId].collectionUri,
            "/",
            StringsUpgradeable.toString(unitId)
        ));
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
        override(ERC1155Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @notice Transfers collection admin rights to a new address
     * @param deedId ID of the DeedNFT
     * @param newAdmin Address of the new admin
     */
    function transferCollectionAdmin(uint256 deedId, address newAdmin) external {
        require(subdivisions[deedId].collectionAdmin == msg.sender, "Not collection admin");
        require(newAdmin != address(0), "Invalid admin address");
        
        address previousAdmin = subdivisions[deedId].collectionAdmin;
        subdivisions[deedId].collectionAdmin = newAdmin;
        emit CollectionAdminTransferred(deedId, previousAdmin, newAdmin);
    }

    /**
     * @notice Modifier to restrict access to collection admin
     */
    modifier onlyCollectionAdmin(uint256 deedId) {
        require(subdivisions[deedId].collectionAdmin == msg.sender, "Not collection admin");
        _;
    }
}
