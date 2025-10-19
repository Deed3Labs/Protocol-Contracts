// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title IFractionalize
 * @dev Interface for the Fractionalize contract.
 *      Provides a standardized way for external contracts to interact with fractionalization functionality.
 *      Consolidates functionality needed for DeedNFT and Subdivision asset fractionalization.
 *      
 * Integration:
 * - Used by external contracts for fractionalization operations
 * - Supports ERC-20 standard for share management
 * - Implements comprehensive asset validation and management
 * - Provides approval-based unlocking mechanisms
 */
interface IFractionalize is IERC165Upgradeable {
    // ============ Type Definitions ============
    
    /// @notice Types of assets that can be fractionalized
    enum FractionAssetType { DeedNFT, SubdivisionNFT }
    
    /// @notice Parameters for creating a new fraction collection
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
    
    /// @notice Parameters for batch minting shares
    struct BatchMintParams {
        uint256 fractionId;
        uint256[] amounts;
        address[] recipients;
    }
    
    /// @notice Parameters for unlocking an asset
    struct UnlockParams {
        uint256 fractionId;
        address to;
        bool checkApprovals;
    }
    
    /// @notice Basic fraction information
    struct FractionBasicInfo {
        string name;
        string symbol;
        uint256 totalShares;
        uint256 activeShares;
        uint256 maxSharesPerWallet;
    }
    
    /// @notice Extended fraction information
    struct FractionExtendedInfo {
        string description;
        string collectionUri;
        uint256 requiredApprovalPercentage;
        bool isActive;
        bool burnable;
    }
    
    /// @notice Ownership information about a fraction
    struct FractionOwnershipInfo {
        FractionAssetType assetType;
        uint256 originalTokenId;
        address collectionAdmin;
    }

    // ============ Events ============
    
    /**
     * @dev Emitted when a new fraction is created
     * @param fractionId ID of the created fraction
     * @param assetType Type of the locked asset
     * @param originalTokenId ID of the locked NFT
     */
    event FractionCreated(uint256 indexed fractionId, FractionAssetType assetType, uint256 originalTokenId);
    
    /**
     * @dev Emitted when shares are minted
     * @param fractionId ID of the fraction
     * @param amount Amount of shares minted
     * @param to Address receiving the shares
     */
    event SharesMinted(uint256 indexed fractionId, uint256 amount, address to);
    
    /**
     * @dev Emitted when shares are burned
     * @param fractionId ID of the fraction
     * @param amount Amount of shares burned
     */
    event SharesBurned(uint256 indexed fractionId, uint256 amount);

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

    // ============ Core Functions ============
    
    /**
     * @notice Creates a new fraction by locking an NFT asset
     * @param params Fraction creation parameters
     */
    function createFraction(FractionCreationParams calldata params) external;
    
    /**
     * @notice Mints shares for a given fraction
     * @param fractionId ID of the fraction collection
     * @param amount Amount of shares to mint
     * @param to Address to receive the shares
     */
    function mintShares(uint256 fractionId, uint256 amount, address to) external;
    
    /**
     * @notice Batch mints multiple shares
     * @param params BatchMintParams containing mint details
     */
    function batchMintShares(BatchMintParams calldata params) external;
    
    /**
     * @notice Burns shares if burning is enabled
     * @param fractionId ID of the fraction collection
     * @param amount Amount of shares to burn
     */
    function burnShares(uint256 fractionId, uint256 amount) external;
    
    /**
     * @notice Unlocks the underlying asset
     * @param params UnlockParams containing unlock details
     */
    function unlockAsset(UnlockParams calldata params) external;

    // ============ Asset Validation Functions ============
    
    /**
     * @notice Validates a DeedNFT asset before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the DeedNFT asset is valid
     * @return validationDetails Additional validation information
     */
    function validateDeedNFTAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails);
    
    /**
     * @notice Validates a subdivision asset before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the subdivision asset is valid
     * @return validationDetails Additional validation information
     */
    function validateSubdivisionAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails);
    
    /**
     * @notice Validates any asset (DeedNFT or Subdivision) before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the asset is valid
     * @return validationDetails Additional validation information
     */
    function validateAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails);

    // ============ Asset Information Functions ============
    
    /**
     * @notice Gets detailed information about a DeedNFT asset
     * @param fractionId ID of the fraction collection
     * @return assetType Asset type of the DeedNFT
     * @return isValidated Whether the DeedNFT is validated
     * @return validator Address of the validator
     * @return tokenURI URI of the DeedNFT metadata
     */
    function getDeedNFTAssetDetails(uint256 fractionId) external view returns (
        uint8 assetType,
        bool isValidated,
        address validator,
        string memory tokenURI
    );
    
    /**
     * @notice Gets detailed information about a subdivision asset
     * @param fractionId ID of the fraction collection
     * @return deedId Parent DeedNFT ID
     * @return unitId Subdivision unit ID
     * @return assetType Asset type of the unit
     * @return isValidated Whether the unit is validated
     * @return validator Address of the validator
     */
    function getSubdivisionAssetDetails(uint256 fractionId) external view returns (
        uint256 deedId,
        uint256 unitId,
        uint8 assetType,
        bool isValidated,
        address validator
    );
    
    /**
     * @notice Gets comprehensive asset information for any asset type
     * @param fractionId ID of the fraction collection
     * @return assetType Type of the asset (DeedNFT or Subdivision)
     * @return isValidated Whether the asset is validated
     * @return validator Address of the validator
     * @return metadata Additional metadata
     */
    function getAssetInformation(uint256 fractionId) external view returns (
        string memory assetType,
        bool isValidated,
        address validator,
        string memory metadata
    );

    // ============ Trait Functions ============
    
    /**
     * @notice Gets trait information for a DeedNFT asset
     * @param fractionId ID of the fraction collection
     * @param traitKey Key of the trait to retrieve
     * @return traitValue Value of the trait
     */
    function getDeedNFTAssetTrait(uint256 fractionId, bytes32 traitKey) external view returns (bytes memory traitValue);
    
    /**
     * @notice Gets all trait keys for a DeedNFT asset
     * @param fractionId ID of the fraction collection
     * @return traitKeys Array of trait keys
     */
    function getDeedNFTAssetTraitKeys(uint256 fractionId) external view returns (bytes32[] memory traitKeys);
    
    /**
     * @notice Gets trait information for a subdivision asset
     * @param fractionId ID of the fraction collection
     * @param traitKey Key of the trait to retrieve
     * @return traitValue Value of the trait
     */
    function getSubdivisionAssetTrait(uint256 fractionId, bytes32 traitKey) external view returns (bytes memory traitValue);
    
    /**
     * @notice Gets all trait keys for a subdivision asset
     * @param fractionId ID of the fraction collection
     * @return traitKeys Array of trait keys
     */
    function getSubdivisionAssetTraitKeys(uint256 fractionId) external view returns (bytes32[] memory traitKeys);

    // ============ Fraction Information Functions ============
    
    /**
     * @notice Returns basic information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Basic fraction information
     */
    function getFractionBasicInfo(uint256 fractionId) external view returns (FractionBasicInfo memory);
    
    /**
     * @notice Returns extended information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Extended fraction information
     */
    function getFractionExtendedInfo(uint256 fractionId) external view returns (FractionExtendedInfo memory);
    
    /**
     * @notice Returns ownership information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Ownership information
     */
    function getFractionOwnershipInfo(uint256 fractionId) external view returns (FractionOwnershipInfo memory);
    
    /**
     * @notice Returns the ERC-20 token address for a fraction
     * @param fractionId ID of the fraction collection
     * @return tokenAddress Address of the ERC-20 token
     */
    function getFractionToken(uint256 fractionId) external view returns (address tokenAddress);

    // ============ Approval Functions ============
    
    /**
     * @notice Returns approval statuses for an account
     * @param fractionId ID of the fraction collection
     * @param account Address to check
     * @return transferApproved Transfer approval status
     * @return adminApproved Admin approval status
     */
    function getApprovals(uint256 fractionId, address account) external view returns (bool transferApproved, bool adminApproved);

    // ============ Voting Functions ============
    
    /**
     * @notice Checks if an account can receive another share (based on wallet limit)
     * @param fractionId ID of the fraction collection
     * @param account Address to check
     * @return Whether the account can receive more shares
     */
    function canReceiveShares(uint256 fractionId, address account) external view returns (bool);
    
    /**
     * @notice Returns the voting power (number of shares owned) for an account
     * @param fractionId ID of the fraction collection
     * @param account Address to check
     * @return Number of shares owned by the account
     */
    function getVotingPower(uint256 fractionId, address account) external view returns (uint256);

    // ============ Admin Functions ============
    
    /**
     * @notice Pauses all contract operations
     */
    function pause() external;
    
    /**
     * @notice Unpauses contract operations
     */
    function unpause() external;
}
