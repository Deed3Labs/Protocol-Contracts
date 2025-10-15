// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {StringsUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "../core/interfaces/IDeedNFT.sol";
import "../core/interfaces/ISubdivide.sol";
import "../core/interfaces/IFractionalize.sol";
import "../core/interfaces/IFractionTokenFactory.sol";
import "../core/FractionToken.sol";
import "../core/factories/FractionTokenFactory.sol";

/**
 * @title Fractionalize
 * @dev Contract for fractionalizing DeedNFT and Subdivide tokens into ERC-20 shares.
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
 * - Deploys ERC-20 tokens for each fraction
 * - Supports UUPSUpgradeable for upgradability
 */
contract Fractionalize is 
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IFractionalize
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
     * @param tokenAddress Address of the ERC-20 token
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
        address tokenAddress;
        mapping(address => bool) transferApprovals;
        mapping(address => bool) adminApprovals;
    }

    // ============ State Variables ============

    /// @notice Mapping of fraction IDs to their information
    mapping(uint256 => FractionInfo) private fractions;

    /// @notice Counter for generating unique fraction IDs
    uint256 public nextFractionId;

    /// @notice Factory for creating ERC-20 tokens
    address public fractionTokenFactory;

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with required dependencies
     * @param _deedNFT Address of the DeedNFT contract
     * @param _subdivideNFT Address of the Subdivide contract
     * @param _fractionTokenFactory Address of the FractionToken factory
     */
    function initialize(address _deedNFT, address _subdivideNFT, address _fractionTokenFactory) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        require(_deedNFT != address(0) && _subdivideNFT != address(0), "Invalid NFT addresses");
        require(_fractionTokenFactory != address(0), "Invalid factory address");
        deedNFT = IDeedNFT(_deedNFT);
        subdivideNFT = ISubdivide(_subdivideNFT);
        fractionTokenFactory = _fractionTokenFactory;
        nextFractionId = 1;
    }

    // ============ Core Functions ============

    /**
     * @notice Creates a new fraction by locking an NFT asset
     * @dev Transfers the NFT to this contract and deploys an ERC-20 token
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
            require(deedNFT._exists(params.originalTokenId), "DeedNFT does not exist");
            deedNFT.transferFrom(msg.sender, address(this), params.originalTokenId);
        } else {
            require(subdivideNFT.ownerOf(params.originalTokenId) == msg.sender, "Not asset owner");
            uint256 deedId = params.originalTokenId >> 128;
            uint256 unitId = params.originalTokenId & ((1 << 128) - 1);
            require(subdivideNFT.subdivisionExists(deedId), "Subdivision not found");
            require(subdivideNFT.unitExists(deedId, unitId), "Unit not found");
            IERC1155Upgradeable(address(subdivideNFT)).safeTransferFrom(msg.sender, address(this), params.originalTokenId, 1, "");
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

        // Deploy ERC-20 token for this fraction
        address tokenAddress = _deployFractionToken(fractionId, params);
        newFraction.tokenAddress = tokenAddress;

        emit FractionCreated(fractionId, params.assetType, params.originalTokenId);
        emit AssetLocked(fractionId, params.originalTokenId);
    }

    /**
     * @notice Mints shares for a given fraction
     * @dev Only the original asset owner can mint shares
     * @param fractionId ID of the fraction collection
     * @param amount Amount of shares to mint
     * @param to Address to receive the shares
     */
    function mintShares(uint256 fractionId, uint256 amount, address to) external whenNotPaused {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(amount > 0, "Amount must be greater than zero");
        require(fraction.activeShares + amount <= fraction.totalShares, "Exceeds total shares");

        address recipient = (to == address(0)) ? msg.sender : to;
        require(canReceiveShares(fractionId, recipient), "Exceeds wallet limit");

        _validateAndMintShares(fraction, fractionId, amount, recipient);
    }

    /**
     * @notice Batch mints multiple shares
     * @dev Only the original asset owner can batch mint
     * @param params BatchMintParams containing mint details
     */
    function batchMintShares(BatchMintParams calldata params) external whenNotPaused {
        FractionInfo storage fraction = fractions[params.fractionId];
        require(fraction.isActive, "Fraction not active");
        require(params.amounts.length == params.recipients.length, "Array length mismatch");

        address originalOwner = (fraction.assetType == FractionAssetType.DeedNFT)
            ? deedNFT.ownerOf(fraction.originalTokenId)
            : subdivideNFT.ownerOf(fraction.originalTokenId);
        require(msg.sender == originalOwner, "Not original owner");

        for (uint256 i = 0; i < params.amounts.length; i++) {
            require(params.amounts[i] > 0, "Amount must be greater than zero");
            require(fraction.activeShares + params.amounts[i] <= fraction.totalShares, "Exceeds total shares");
            
            address recipient = (params.recipients[i] == address(0)) ? msg.sender : params.recipients[i];
            require(canReceiveShares(params.fractionId, recipient), "Exceeds wallet limit");

            _mintShares(fraction, params.fractionId, params.amounts[i], recipient);
        }
    }

    /**
     * @notice Burns shares if burning is enabled
     * @dev Only share owners can burn their shares
     * @param fractionId ID of the fraction collection
     * @param amount Amount of shares to burn
     */
    function burnShares(uint256 fractionId, uint256 amount) external whenNotPaused {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.burnable, "Burning not allowed");
        require(amount > 0, "Amount must be greater than zero");

        FractionToken token = FractionToken(fraction.tokenAddress);
        require(token.balanceOf(msg.sender) >= amount, "Insufficient balance");

        token.burnFrom(msg.sender, amount);
        fraction.activeShares -= amount;
        emit SharesBurned(fractionId, amount);
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

    // ============ View Functions ============

    /**
     * @notice Validates a DeedNFT asset before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the DeedNFT asset is valid
     * @return validationDetails Additional validation information
     */
    function validateDeedNFTAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.DeedNFT, "Not a DeedNFT asset");
        
        if (!deedNFT._exists(fraction.originalTokenId)) {
            return (false, "DeedNFT does not exist");
        }
        
        (bool isDeedValidated, address validator) = deedNFT.getValidationStatus(fraction.originalTokenId);
        if (!isDeedValidated) {
            return (false, "DeedNFT is not validated");
        }
        
        uint8 assetType = deedNFT.getAssetType(fraction.originalTokenId);
        bool canSubdivide = deedNFT.canSubdivide(fraction.originalTokenId);
        return (true, string(abi.encodePacked(
            "Valid DeedNFT, Asset Type: ", uint256(assetType).toString(), 
            ", Validator: ", _addressToString(validator),
            ", Can Subdivide: ", canSubdivide ? "Yes" : "No"
        )));
    }

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
    ) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.DeedNFT, "Not a DeedNFT asset");
        
        assetType = deedNFT.getAssetType(fraction.originalTokenId);
        (isValidated, validator) = deedNFT.getValidationStatus(fraction.originalTokenId);
        tokenURI = deedNFT.tokenURI(fraction.originalTokenId);
    }

    /**
     * @notice Gets trait information for a DeedNFT asset
     * @param fractionId ID of the fraction collection
     * @param traitKey Key of the trait to retrieve
     * @return traitValue Value of the trait
     */
    function getDeedNFTAssetTrait(uint256 fractionId, bytes32 traitKey) external view returns (bytes memory traitValue) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.DeedNFT, "Not a DeedNFT asset");
        
        return deedNFT.getTraitValue(fraction.originalTokenId, traitKey);
    }

    /**
     * @notice Gets all trait keys for a DeedNFT asset
     * @param fractionId ID of the fraction collection
     * @return traitKeys Array of trait keys
     */
    function getDeedNFTAssetTraitKeys(uint256 fractionId) external view returns (bytes32[] memory traitKeys) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.DeedNFT, "Not a DeedNFT asset");
        
        return deedNFT.getTraitKeys(fraction.originalTokenId);
    }

    /**
     * @notice Validates a subdivision asset before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the subdivision asset is valid
     * @return validationDetails Additional validation information
     */
    function validateSubdivisionAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.SubdivisionNFT, "Not a subdivision asset");
        
        uint256 deedId = fraction.originalTokenId >> 128;
        uint256 unitId = fraction.originalTokenId & ((1 << 128) - 1);
        
        if (!subdivideNFT.subdivisionExists(deedId)) {
            return (false, "Subdivision does not exist");
        }
        
        if (!subdivideNFT.unitExists(deedId, unitId)) {
            return (false, "Unit does not exist");
        }
        
        (bool isUnitValidated, address validator) = subdivideNFT.getUnitValidationStatus(deedId, unitId);
        if (!isUnitValidated) {
            return (false, "Unit is not validated");
        }
        
        uint8 assetType = subdivideNFT.getUnitAssetType(deedId, unitId);
        return (true, string(abi.encodePacked("Valid subdivision unit, Asset Type: ", uint256(assetType).toString(), ", Validator: ", _addressToString(validator))));
    }

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
    ) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.SubdivisionNFT, "Not a subdivision asset");
        
        deedId = fraction.originalTokenId >> 128;
        unitId = fraction.originalTokenId & ((1 << 128) - 1);
        assetType = subdivideNFT.getUnitAssetType(deedId, unitId);
        (isValidated, validator) = subdivideNFT.getUnitValidationStatus(deedId, unitId);
    }

    /**
     * @notice Gets trait information for a subdivision asset
     * @param fractionId ID of the fraction collection
     * @param traitKey Key of the trait to retrieve
     * @return traitValue Value of the trait
     */
    function getSubdivisionAssetTrait(uint256 fractionId, bytes32 traitKey) external view returns (bytes memory traitValue) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.SubdivisionNFT, "Not a subdivision asset");
        
        uint256 deedId = fraction.originalTokenId >> 128;
        uint256 unitId = fraction.originalTokenId & ((1 << 128) - 1);
        
        return subdivideNFT.getUnitTraitValue(deedId, unitId, traitKey);
    }

    /**
     * @notice Gets all trait keys for a subdivision asset
     * @param fractionId ID of the fraction collection
     * @return traitKeys Array of trait keys
     */
    function getSubdivisionAssetTraitKeys(uint256 fractionId) external view returns (bytes32[] memory traitKeys) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        require(fraction.assetType == FractionAssetType.SubdivisionNFT, "Not a subdivision asset");
        
        uint256 deedId = fraction.originalTokenId >> 128;
        uint256 unitId = fraction.originalTokenId & ((1 << 128) - 1);
        
        return subdivideNFT.getUnitTraitKeys(deedId, unitId);
    }

    /**
     * @notice Validates any asset (DeedNFT or Subdivision) before fractionalization
     * @param fractionId ID of the fraction collection
     * @return isValid Whether the asset is valid
     * @return validationDetails Additional validation information
     */
    function validateAsset(uint256 fractionId) external view returns (bool isValid, string memory validationDetails) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        
        if (fraction.assetType == FractionAssetType.DeedNFT) {
            return this.validateDeedNFTAsset(fractionId);
        } else {
            return this.validateSubdivisionAsset(fractionId);
        }
    }

    /**
     * @notice Gets comprehensive asset information for any asset type
     * @param fractionId ID of the fraction collection
     * @return assetType Type of the asset (DeedNFT or Subdivision)
     * @return isValidated Whether the asset is validated
     * @return validator Address of the validator
     * @return metadata Additional metadata (tokenURI for DeedNFT, unit details for Subdivision)
     */
    function getAssetInformation(uint256 fractionId) external view returns (
        string memory assetType,
        bool isValidated,
        address validator,
        string memory metadata
    ) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        
        if (fraction.assetType == FractionAssetType.DeedNFT) {
            assetType = "DeedNFT";
            (bool isDeedValidated, address deedValidator) = deedNFT.getValidationStatus(fraction.originalTokenId);
            isValidated = isDeedValidated;
            validator = deedValidator;
            metadata = deedNFT.tokenURI(fraction.originalTokenId);
        } else {
            assetType = "Subdivision";
            uint256 deedId = fraction.originalTokenId >> 128;
            uint256 unitId = fraction.originalTokenId & ((1 << 128) - 1);
            (bool isUnitValidated, address unitValidator) = subdivideNFT.getUnitValidationStatus(deedId, unitId);
            isValidated = isUnitValidated;
            validator = unitValidator;
            metadata = string(abi.encodePacked("DeedID: ", deedId.toString(), ", UnitID: ", unitId.toString()));
        }
    }

    /**
     * @notice Returns basic information about a fraction
     * @param fractionId ID of the fraction collection
     * @return Basic fraction information
     */
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
    function getFractionOwnershipInfo(uint256 fractionId) external view returns (FractionOwnershipInfo memory) {
        FractionInfo storage fraction = fractions[fractionId];
        return FractionOwnershipInfo({
            assetType: fraction.assetType,
            originalTokenId: fraction.originalTokenId,
            collectionAdmin: fraction.collectionAdmin
        });
    }

    /**
     * @notice Returns the ERC-20 token address for a fraction
     * @param fractionId ID of the fraction collection
     * @return tokenAddress Address of the ERC-20 token
     */
    function getFractionToken(uint256 fractionId) external view returns (address tokenAddress) {
        FractionInfo storage fraction = fractions[fractionId];
        require(fraction.isActive, "Fraction not active");
        return fraction.tokenAddress;
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
     * @dev Deploys a new ERC-20 token for a fraction using the factory
     */
    function _deployFractionToken(uint256 fractionId, FractionCreationParams calldata params) internal returns (address) {
        require(fractionTokenFactory != address(0), "Factory not set");
        
        // Use the factory to create the token
        return IFractionTokenFactory(fractionTokenFactory).createFractionToken(
            fractionId,
            params.name,
            params.symbol,
            params.totalShares,
            params.burnable
        );
    }

    /**
     * @dev Converts an address to a string
     * @param addr Address to convert
     * @return String representation of the address
     */
    function _addressToString(address addr) internal pure returns (string memory) {
        return StringsUpgradeable.toHexString(uint160(addr), 20);
    }

    /**
     * @dev Internal helper for minting shares
     */
    function _validateAndMintShares(
        FractionInfo storage fraction,
        uint256 fractionId,
        uint256 amount,
        address recipient
    ) internal {
        address originalOwner = (fraction.assetType == FractionAssetType.DeedNFT)
            ? deedNFT.ownerOf(fraction.originalTokenId)
            : subdivideNFT.ownerOf(fraction.originalTokenId);
        require(msg.sender == originalOwner, "Not original owner");

        _mintShares(fraction, fractionId, amount, recipient);
    }

    /**
     * @dev Internal helper for minting shares
     */
    function _mintShares(
        FractionInfo storage fraction,
        uint256 fractionId,
        uint256 amount,
        address recipient
    ) internal {
        FractionToken token = FractionToken(fraction.tokenAddress);
        token.mint(recipient, amount);
        fraction.activeShares += amount;
        emit SharesMinted(fractionId, amount, recipient);
    }

    /**
     * @dev Burns all shares held by the caller
     */
    function _burnAllShares(uint256 fractionId) internal {
        FractionInfo storage fraction = fractions[fractionId];
        FractionToken token = FractionToken(fraction.tokenAddress);
        uint256 balance = token.balanceOf(msg.sender);
        if (balance > 0) {
            token.burnFrom(msg.sender, balance);
            fraction.activeShares -= balance;
            emit SharesBurned(fractionId, balance);
        }
    }

    /**
     * @dev Transfers the underlying asset
     */
    function _transferAsset(FractionInfo storage fraction, address to) internal {
        if (fraction.assetType == FractionAssetType.DeedNFT) {
            deedNFT.transferFrom(address(this), to, fraction.originalTokenId);
        } else {
            IERC1155Upgradeable(address(subdivideNFT)).safeTransferFrom(address(this), to, fraction.originalTokenId, 1, "");
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
        override(AccessControlUpgradeable, IERC165Upgradeable)
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
        FractionToken token = FractionToken(fraction.tokenAddress);
        return token.balanceOf(account);
    }

    /// @notice Checks if the required approval percentage is met for the fraction.
    function _checkApproval(uint256 fractionId) internal view returns (bool) {
        FractionInfo storage fraction = fractions[fractionId];
        FractionToken token = FractionToken(fraction.tokenAddress);
        
        uint256 totalVotes = token.totalSupply();
        uint256 approvalVotes = 0;

        // This is a simplified implementation
        // In practice, you'd need to track approvals differently
        if (totalVotes == 0) {
            return false;
        }
        
        // For now, we'll assume the caller has approval if they hold shares
        if (token.balanceOf(msg.sender) > 0 && fraction.adminApprovals[msg.sender]) {
            approvalVotes = token.balanceOf(msg.sender);
        }
        
        return (approvalVotes * 100) / totalVotes >= fraction.requiredApprovalPercentage;
    }
}