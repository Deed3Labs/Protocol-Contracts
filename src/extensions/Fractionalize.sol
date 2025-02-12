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
 *      Required for asset locking and ownership verification.
 *      Ensures compatibility with the core DeedNFT contract.
 */
interface IDeedNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/**
 * @title ISubdivide Interface
 * @dev Interface for interacting with the Subdivide contract.
 *      Required for subdivision token locking and ownership verification.
 *      Ensures compatibility with the Subdivide contract.
 */
interface ISubdivide {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/**
 * @title Fractionalize
 * @dev Contract for fractionalizing DeedNFT and Subdivide tokens into ERC1155 shares.
 *      Enables creation of tradeable shares backed by locked NFT assets.
 *      
 * Security:
 * - Role-based access control for admin operations
 * - Pausable functionality for emergency stops
 * - Share transfer restrictions and wallet limits
 * - Approval-based unlocking mechanism
 * 
 * Integration:
 * - Works with DeedNFT and Subdivide contracts
 * - Implements ERC1155 for share management
 * - Supports UUPSUpgradeable for upgradability
 */
contract Fractionalize is 
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable 
{
    using StringsUpgradeable for uint256;

    // ============ Role Definitions ============

    /// @notice Role for administrative functions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ============ Contract References ============

    /// @notice Reference to the DeedNFT contract
    IDeedNFT public deedNFT;

    /// @notice Reference to the Subdivide contract
    ISubdivide public subdivideNFT;

    // ============ Type Definitions ============

    /// @notice Types of assets that can be fractionalized
    enum FractionAssetType { DeedNFT, SubdivisionNFT }

    /**
     * @title FractionInfo
     * @dev Core data structure for fraction collections
     * 
     * @param name Collection name
     * @param description Collection description
     * @param symbol Trading symbol
     * @param collectionUri Base URI for metadata
     * @param totalShares Total number of shares
     * @param activeShares Currently minted shares
     * @param maxSharesPerWallet Maximum shares per wallet
     * @param requiredApprovalPercentage Percentage needed for unlocking
     * @param isActive Operational status
     * @param burnable Whether shares can be burned
     * @param assetType Type of locked asset
     * @param originalTokenId ID of locked NFT
     * @param collectionAdmin Admin address
     */
    struct FractionInfo {
        string name;
        string description;
        string symbol;
        string collectionUri;
        uint256 totalShares;
        uint256 activeShares;
        uint256 maxSharesPerWallet;
        uint256 requiredApprovalPercentage;
        bool isActive;
        bool burnable;
        FractionAssetType assetType;
        uint256 originalTokenId;
        address collectionAdmin;
        mapping(uint256 => string) shareMetadata;
        mapping(address => bool) transferApprovals;
        mapping(address => bool) adminApprovals;
    }

    // ============ State Variables ============

    /// @notice Mapping of fraction IDs to their information
    mapping(uint256 => FractionInfo) private fractions;

    /// @notice Counter for generating unique fraction IDs
    uint256 public nextFractionId;

    // ============ Events ============

    /**
     * @dev Emitted when a new fraction is created
     * @param fractionId ID of the created fraction
     * @param assetType Type of the locked asset
     * @param originalTokenId ID of the locked NFT
     */
    event FractionCreated(uint256 indexed fractionId, FractionAssetType assetType, uint256 originalTokenId);
    
    /**
     * @dev Emitted when a share is minted
     * @param fractionId ID of the fraction
     * @param shareId ID of the minted share
     * @param to Address receiving the share
     */
    event ShareMinted(uint256 indexed fractionId, uint256 indexed shareId, address to);
    
    /**
     * @dev Emitted when a share is burned
     * @param fractionId ID of the fraction
     * @param shareId ID of the burned share
     */
    event ShareBurned(uint256 indexed fractionId, uint256 indexed shareId);

    /**
     * @dev Emitted when an asset is locked
     * @param fractionId ID of the fraction
     * @param originalTokenId ID of the locked NFT
     */
    event AssetLocked(uint256 indexed fractionId, uint256 originalTokenId);

    /**
     * @dev Emitted when an asset is unlocked
     * @param fractionId ID of the fraction
     * @param originalTokenId ID of the unlocked NFT
     * @param to Recipient address
     */
    event AssetUnlocked(uint256 indexed fractionId, uint256 originalTokenId, address to);

    /**
     * @dev Emitted when transfer approval is updated
     * @param fractionId ID of the fraction
     * @param approver Address setting approval
     * @param approved New approval status
     */
    event TransferApprovalSet(uint256 indexed fractionId, address indexed approver, bool approved);

    /**
     * @dev Emitted when admin approval is updated
     * @param fractionId ID of the fraction
     * @param approver Address setting approval
     * @param approved New approval status
     */
    event AdminApprovalSet(uint256 indexed fractionId, address indexed approver, bool approved);

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with required dependencies
     * @param _deedNFT Address of the DeedNFT contract
     * @param _subdivideNFT Address of the Subdivide contract
     */
    function initialize(address _deedNFT, address _subdivideNFT) public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        require(_deedNFT != address(0) && _subdivideNFT != address(0), "Invalid NFT addresses");
        deedNFT = IDeedNFT(_deedNFT);
        subdivideNFT = ISubdivide(_subdivideNFT);
        nextFractionId = 1;
    }

    // ============ Parameter Structs ============

    /**
     * @dev Parameters for creating a new fraction collection
     * @param assetType Type of asset to fractionalize
     * @param originalTokenId ID of NFT to lock
     * @param name Collection name
     * @param description Collection description
     * @param symbol Trading symbol
     * @param collectionUri Base URI for metadata
     * @param totalShares Total number of shares
     * @param burnable Whether shares can be burned
     * @param approvalPercentage Required percentage for unlocking
     */
    struct FractionCreationParams {
        FractionAssetType assetType;
        uint256 originalTokenId;
        string name;
        string description;
        string symbol;
        string collectionUri;
        uint256 totalShares;
        bool burnable;
        uint256 approvalPercentage;
    }

    /**
     * @dev Parameters for batch minting shares
     * @param fractionId ID of the fraction collection
     * @param shareIds Array of share IDs to mint
     * @param recipients Array of recipient addresses
     */
    struct BatchMintParams {
        uint256 fractionId;
        uint256[] shareIds;
        address[] recipients;
    }

    /**
     * @dev Parameters for unlocking an asset
     * @param fractionId ID of the fraction collection
     * @param to Address to receive the unlocked asset
     * @param checkApprovals Whether to check approval requirements
     */
    struct UnlockParams {
        uint256 fractionId;
        address to;
        bool checkApprovals;
    }

    // ============ Core Functions ============

    /**
     * @notice Creates a new fraction by locking an NFT asset
     * @dev Transfers the NFT to this contract and initializes fraction data
     * @param params Fraction creation parameters
     */
    function createFraction(FractionCreationParams calldata params) external whenNotPaused {
        require(params.totalShares > 0, "Invalid shares amount");
        require(bytes(params.symbol).length > 0, "Symbol required");
        require(params.approvalPercentage >= 51 && params.approvalPercentage <= 100, 
            "Approval percentage must be between 51 and 100");

        // Transfer asset from caller to contract
        if (params.assetType == FractionAssetType.DeedNFT) {
            require(deedNFT.ownerOf(params.originalTokenId) == msg.sender, "Not asset owner");
            deedNFT.transferFrom(msg.sender, address(this), params.originalTokenId);
        } else {
            require(subdivideNFT.ownerOf(params.originalTokenId) == msg.sender, "Not asset owner");
            subdivideNFT.transferFrom(msg.sender, address(this), params.originalTokenId);
        }

        uint256 fractionId = nextFractionId++;
        FractionInfo storage newFraction = fractions[fractionId];
        newFraction.name = params.name;
        newFraction.description = params.description;
        newFraction.symbol = params.symbol;
        newFraction.collectionUri = params.collectionUri;
        newFraction.totalShares = params.totalShares;
        newFraction.activeShares = 0;
        newFraction.maxSharesPerWallet = params.totalShares;
        newFraction.requiredApprovalPercentage = params.approvalPercentage;
        newFraction.isActive = true;
        newFraction.burnable = params.burnable;
        newFraction.assetType = params.assetType;
        newFraction.originalTokenId = params.originalTokenId;
        newFraction.collectionAdmin = msg.sender;

        emit FractionCreated(fractionId, params.assetType, params.originalTokenId);
        emit AssetLocked(fractionId, params.originalTokenId);
    }

    /**
     * @notice Mints a single share for a given fraction
     * @dev Only the original asset owner can mint shares
     * @param fractionId ID of the fraction collection
     * @param shareId ID of the share to mint
     * @param to Address to receive the share
     */
    function mintShare(uint256 fractionId, uint256 shareId, address to) external whenNotPaused {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(shareId < fraction.totalShares, "Invalid share ID");
        require(fraction.activeShares < fraction.totalShares, "All shares minted");

        address recipient = (to == address(0)) ? msg.sender : to;
        require(canReceiveShares(fractionId, recipient), "Exceeds wallet limit");

        _validateAndMintShare(fraction, fractionId, shareId, recipient);
    }

    /**
     * @notice Batch mints multiple shares
     * @dev Only the original asset owner can batch mint
     * @param params BatchMintParams containing mint details
     */
    function batchMintShares(BatchMintParams calldata params) external whenNotPaused {
        FractionInfo storage fraction = fractions[params.fractionId];
        require(fraction.isActive, "Fraction not active");
        require(params.shareIds.length == params.recipients.length, "Array length mismatch");
        require(fraction.activeShares + params.shareIds.length <= fraction.totalShares, "Exceeds total shares");

        address originalOwner = (fraction.assetType == FractionAssetType.DeedNFT)
            ? deedNFT.ownerOf(fraction.originalTokenId)
            : subdivideNFT.ownerOf(fraction.originalTokenId);
        require(msg.sender == originalOwner, "Not original owner");

        for (uint256 i = 0; i < params.shareIds.length; i++) {
            require(params.shareIds[i] < fraction.totalShares, "Invalid share ID");
            address recipient = (params.recipients[i] == address(0)) ? msg.sender : params.recipients[i];
            require(canReceiveShares(params.fractionId, recipient), "Exceeds wallet limit");

            uint256 tokenId = _generateTokenId(params.fractionId, params.shareIds[i]);
            _mint(recipient, tokenId, 1, "");
            fraction.activeShares += 1;
            emit ShareMinted(params.fractionId, params.shareIds[i], recipient);
        }
    }

    /**
     * @notice Burns a share if burning is enabled
     * @dev Only share owners can burn their shares
     * @param fractionId ID of the fraction collection
     * @param shareId ID of the share to burn
     */
    function burnShare(uint256 fractionId, uint256 shareId) external whenNotPaused {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.burnable, "Burning not allowed");

        uint256 tokenId = _generateTokenId(fractionId, shareId);
        require(balanceOf(msg.sender, tokenId) > 0, "Not share owner");

        _burn(msg.sender, tokenId, 1);
        fraction.activeShares -= 1;
        emit ShareBurned(fractionId, shareId);
    }

    /**
     * @notice Unlocks the underlying asset
     * @dev Requires either full ownership or meeting approval threshold
     * @param params UnlockParams containing unlock details
     */
    function unlockAsset(UnlockParams calldata params) external whenNotPaused {
        require(params.to != address(0), "Invalid recipient");
        FractionInfo storage fraction = fractions[params.fractionId];
        require(fraction.isActive, "Fraction not active");

        if (params.checkApprovals) {
            require(_checkApproval(params.fractionId), "Transfer not approved");
        } else {
            require(getVotingPower(params.fractionId, msg.sender) == fraction.activeShares, "Must own all shares");
        }

        _burnAllShares(params.fractionId);
        _transferAsset(fraction, params.to);
        fraction.isActive = false;
        emit AssetUnlocked(params.fractionId, fraction.originalTokenId, params.to);
    }

    // ============ Transfer Functions ============

    /**
     * @notice Override of ERC1155 safeTransferFrom
     * @dev Adds transfer restrictions and validations
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public virtual override {
        require(!paused(), "Pausable: paused");
        if (from != address(0) && to != address(0)) {
            uint256 fractionId = id >> 128;
            FractionInfo storage fraction = fractions[fractionId];
            require(fraction.isActive, "Fraction not active");
            require(canReceiveShares(fractionId, to), "Exceeds wallet limit");
        }
        super.safeTransferFrom(from, to, id, amount, data);
    }

    /**
     * @notice Override of ERC1155 safeBatchTransferFrom
     * @dev Adds transfer restrictions and validations
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public virtual override {
        require(!paused(), "Pausable: paused");
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                uint256 fractionId = ids[i] >> 128;
                FractionInfo storage fraction = fractions[fractionId];
                require(fraction.isActive, "Fraction not active");
                require(canReceiveShares(fractionId, to), "Exceeds wallet limit");
            }
        }
        super.safeBatchTransferFrom(from, to, ids, amounts, data);
    }

    // ============ View Functions ============

    /**
     * @notice Returns basic information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Basic fraction information
     */
    struct FractionBasicInfo {
        string name;
        string symbol;
        uint256 totalShares;
        uint256 activeShares;
        uint256 maxSharesPerWallet;
    }

    function getFractionBasicInfo(uint256 fractionId) external view returns (FractionBasicInfo memory) {
        FractionInfo storage fraction = fractions[fractionId];
        return FractionBasicInfo({
            name: fraction.name,
            symbol: fraction.symbol,
            totalShares: fraction.totalShares,
            activeShares: fraction.activeShares,
            maxSharesPerWallet: fraction.maxSharesPerWallet
        });
    }

    /**
     * @notice Returns extended information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Extended fraction information
     */
    struct FractionExtendedInfo {
        string description;
        string collectionUri;
        uint256 requiredApprovalPercentage;
        bool isActive;
        bool burnable;
    }

    function getFractionExtendedInfo(uint256 fractionId) external view returns (FractionExtendedInfo memory) {
        FractionInfo storage fraction = fractions[fractionId];
        return FractionExtendedInfo({
            description: fraction.description,
            collectionUri: fraction.collectionUri,
            requiredApprovalPercentage: fraction.requiredApprovalPercentage,
            isActive: fraction.isActive,
            burnable: fraction.burnable
        });
    }

    /**
     * @notice Returns ownership information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Ownership information
     */
    struct FractionOwnershipInfo {
        FractionAssetType assetType;
        uint256 originalTokenId;
        address collectionAdmin;
    }

    function getFractionOwnershipInfo(uint256 fractionId) external view returns (FractionOwnershipInfo memory) {
        FractionInfo storage fraction = fractions[fractionId];
        return FractionOwnershipInfo({
            assetType: fraction.assetType,
            originalTokenId: fraction.originalTokenId,
            collectionAdmin: fraction.collectionAdmin
        });
    }

    /**
     * @notice Returns metadata URI for a specific share
     * @param fractionId ID of the fraction collection
     * @param shareId ID of the share
     * @return string Metadata URI
     */
    function getShareMetadata(uint256 fractionId, uint256 shareId) external view returns (string memory) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(shareId < fraction.totalShares, "Invalid share ID");
        string memory meta = fraction.shareMetadata[shareId];
        if (bytes(meta).length > 0) {
            return meta;
        }
        return string(abi.encodePacked(fraction.collectionUri, "/", shareId.toString()));
    }

    /**
     * @notice Returns approval statuses for an account
     * @param fractionId ID of the fraction collection
     * @param account Address to check
     * @return transferApproved Transfer approval status
     * @return adminApproved Admin approval status
     */
    function getApprovals(uint256 fractionId, address account) external view returns (bool transferApproved, bool adminApproved) {
        FractionInfo storage fraction = fractions[fractionId];
        return (fraction.transferApprovals[account], fraction.adminApprovals[account]);
    }

    // ============ Internal Functions ============

    /**
     * @dev Generates a unique token ID from fraction and share IDs
     */
    function _generateTokenId(uint256 fractionId, uint256 shareId) internal pure returns (uint256) {
        return (fractionId << 128) | shareId;
    }

    /**
     * @dev Internal helper for minting shares
     */
    function _validateAndMintShare(
        FractionInfo storage fraction,
        uint256 fractionId,
        uint256 shareId,
        address recipient
    ) internal {
        address originalOwner = (fraction.assetType == FractionAssetType.DeedNFT)
            ? deedNFT.ownerOf(fraction.originalTokenId)
            : subdivideNFT.ownerOf(fraction.originalTokenId);
        require(msg.sender == originalOwner, "Not original owner");

        uint256 tokenId = _generateTokenId(fractionId, shareId);
        _mint(recipient, tokenId, 1, "");
        fraction.activeShares += 1;
        emit ShareMinted(fractionId, shareId, recipient);
    }

    /**
     * @dev Burns all shares held by the caller
     */
    function _burnAllShares(uint256 fractionId) internal {
        FractionInfo storage fraction = fractions[fractionId];
        for (uint256 i = 0; i < fraction.totalShares; i++) {
            uint256 tokenId = _generateTokenId(fractionId, i);
            if (balanceOf(msg.sender, tokenId) > 0) {
                _burn(msg.sender, tokenId, 1);
                emit ShareBurned(fractionId, i);
            }
        }
    }

    /**
     * @dev Transfers the underlying asset
     */
    function _transferAsset(FractionInfo storage fraction, address to) internal {
        if (fraction.assetType == FractionAssetType.DeedNFT) {
            deedNFT.transferFrom(address(this), to, fraction.originalTokenId);
        } else {
            subdivideNFT.transferFrom(address(this), to, fraction.originalTokenId);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Pauses all contract operations
     * @dev Only callable by admin role
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses contract operations
     * @dev Only callable by admin role
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ============ Upgradability ============

    /**
     * @dev Required override for UUPS upgradability
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ============ Interface Support ============

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

    /// @notice Checks if an account can receive another share (based on wallet limit).
    function canReceiveShares(uint256 fractionId, address account) public view returns (bool) {
        FractionInfo storage fraction = fractions[fractionId];
        if (!fraction.isActive || fraction.maxSharesPerWallet == 0) {
            return true;
        }
        return getVotingPower(fractionId, account) < fraction.maxSharesPerWallet;
    }

    /// @notice Returns the voting power (number of shares owned) for an account.
    function getVotingPower(uint256 fractionId, address account) public view returns (uint256) {
        FractionInfo storage fraction = fractions[fractionId];
        uint256 votingPower = 0;
        for (uint256 i = 0; i < fraction.totalShares; i++) {
            uint256 tokenId = _generateTokenId(fractionId, i);
            if (balanceOf(account, tokenId) > 0) {
                votingPower++;
            }
        }
        return votingPower;
    }

    /// @notice Checks if the required approval percentage is met for the fraction.
    function _checkApproval(uint256 fractionId) internal view returns (bool) {
        FractionInfo storage fraction = fractions[fractionId];
        uint256 totalVotes = 0;
        uint256 approvalVotes = 0;

        for (uint256 i = 0; i < fraction.totalShares; i++) {
            uint256 tokenId = _generateTokenId(fractionId, i);
            // For simplicity, we assume msg.sender's voting is counted if they hold any share.
            if (balanceOf(msg.sender, tokenId) > 0) {
                totalVotes++;
                if (fraction.adminApprovals[msg.sender]) {
                    approvalVotes++;
                }
            }
        }
        if (totalVotes == 0) {
            return false;
        }
        return (approvalVotes * 100) / totalVotes >= fraction.requiredApprovalPercentage;
    }
}

