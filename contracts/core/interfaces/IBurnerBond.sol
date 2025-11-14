// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @title IBurnerBond
/// @notice Interface for BurnerBond ERC-1155 token system
interface IBurnerBond is IERC1155 {
    
    /* ========== STRUCTS ========== */
    
    /// @notice Bond information structure
    /// @param faceValue Face value of the bond in USDC (6 decimals)
    /// @param maturityDate Unix timestamp when bond can be redeemed
    /// @param discountPercentage Discount percentage (0-30%, in basis points)
    /// @param purchasePrice Actual price paid for the bond in USDC
    /// @param isRedeemed Whether the bond has been redeemed
    /// @param creator Address that created/minted the bond
    struct BondInfo {
        uint256 faceValue;
        uint256 maturityDate;
        uint256 discountPercentage;
        uint256 purchasePrice;
        bool isRedeemed;
        address creator;
    }
    
    /* ========== EVENTS ========== */
    
    /// @notice Emitted when a new bond is minted
    /// @param bondId Unique bond identifier
    /// @param creator Address that created the bond
    /// @param faceValue Face value of the bond
    /// @param maturityDate Maturity date of the bond
    /// @param discountPercentage Discount percentage applied
    /// @param purchasePrice Price paid for the bond
    event BondMinted(
        uint256 indexed bondId,
        address indexed creator,
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage,
        uint256 purchasePrice
    );
    
    /// @notice Emitted when a bond is redeemed
    /// @param bondId Unique bond identifier
    /// @param redeemer Address that redeemed the bond
    /// @param faceValue Face value redeemed
    event BondRedeemed(
        uint256 indexed bondId,
        address indexed redeemer,
        uint256 faceValue
    );
    
    /// @notice Emitted when discount parameters are updated
    /// @param maxDiscount Maximum discount percentage
    /// @param maxMaturity Maximum maturity period in seconds
    event DiscountParametersUpdated(uint256 maxDiscount, uint256 maxMaturity);
    
    /// @notice Emitted when discount curve is updated
    /// @param curveType Type of curve
    /// @param maxDiscount Maximum discount percentage
    /// @param maxMaturity Maximum maturity period
    /// @param curveParameter Curve-specific parameter
    event DiscountCurveUpdated(uint8 curveType, uint256 maxDiscount, uint256 maxMaturity, uint256 curveParameter);
    
    /// @notice Emitted when a bond trait is updated
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @param traitValue New value of the trait
    event BondTraitUpdated(uint256 indexed bondId, bytes32 indexed traitKey, bytes traitValue);
    
    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get bond information by ID
    /// @param bondId Unique bond identifier
    /// @return BondInfo struct containing all bond details
    function getBondInfo(uint256 bondId) external view returns (BondInfo memory);
    
    /// @notice Calculate discount percentage based on maturity date
    /// @param maturityDate Unix timestamp for bond maturity
    /// @return Discount percentage in basis points (0-3000 for 0-30%)
    function calculateDiscount(uint256 maturityDate) external view returns (uint256);
    
    /// @notice Calculate purchase price for a bond
    /// @param faceValue Face value of the bond in USDC
    /// @param maturityDate Maturity date of the bond
    /// @return Purchase price in USDC
    function calculatePurchasePrice(uint256 faceValue, uint256 maturityDate) external view returns (uint256);
    
    /// @notice Check if a bond is mature and can be redeemed
    /// @param bondId Unique bond identifier
    /// @return True if bond is mature
    function isBondMature(uint256 bondId) external view returns (bool);
    
    /// @notice Get total bonds created by an address
    /// @param creator Address to check
    /// @return Number of bonds created
    function getBondsCreatedBy(address creator) external view returns (uint256);
    
    /// @notice Get all bond IDs created by an address
    /// @param creator Address to check
    /// @return Array of bond IDs
    function getBondIdsByCreator(address creator) external view returns (uint256[] memory);
    
    /// @notice Get current discount parameters
    /// @return maxDiscount Maximum discount percentage in basis points
    /// @return maxMaturity Maximum maturity period in seconds
    function getDiscountParameters() external view returns (uint256 maxDiscount, uint256 maxMaturity);
    
    /* ========== DISCOUNT CURVE FUNCTIONS ========== */
    
    /// @notice Get discount curve configuration
    /// @return curveType Type of curve (0=linear, 1=bonding, 2=logarithmic, 3=custom)
    /// @return maxDiscount Maximum discount percentage in basis points
    /// @return maxMaturity Maximum maturity period in seconds
    /// @return curveParameter Curve-specific parameter (steepness, base, etc.)
    function getDiscountCurve() external view returns (uint8 curveType, uint256 maxDiscount, uint256 maxMaturity, uint256 curveParameter);
    
    /// @notice Set discount curve configuration
    /// @param curveType Type of curve (0=linear, 1=bonding, 2=logarithmic, 3=custom)
    /// @param maxDiscount Maximum discount percentage in basis points
    /// @param maxMaturity Maximum maturity period in seconds
    /// @param curveParameter Curve-specific parameter (steepness, base, etc.)
    function setDiscountCurve(uint8 curveType, uint256 maxDiscount, uint256 maxMaturity, uint256 curveParameter) external;
    
    /// @notice Calculate discount using the configured curve
    /// @param maturityDate Maturity date for the bond
    /// @return Discount percentage in basis points
    function calculateDiscountWithCurve(uint256 maturityDate) external view returns (uint256);
    
    /// @notice Get discount for a specific maturity period
    /// @param timeToMaturity Time to maturity in seconds
    /// @return Discount percentage in basis points
    function getDiscountForMaturity(uint256 timeToMaturity) external view returns (uint256);
    
    /* ========== TRAIT FUNCTIONS (ERC-7496) ========== */
    
    /// @notice Get a trait value for a bond
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @return Value of the trait
    function getBondTraitValue(uint256 bondId, bytes32 traitKey) external view returns (bytes memory);
    
    /// @notice Get multiple trait values for a bond
    /// @param bondId ID of the bond
    /// @param traitKeys Array of trait keys
    /// @return Array of trait values
    function getBondTraitValues(uint256 bondId, bytes32[] calldata traitKeys) external view returns (bytes[] memory);
    
    /// @notice Get all trait keys for a bond that have values
    /// @param bondId ID of the bond
    /// @return Array of trait keys that have values
    function getBondTraitKeys(uint256 bondId) external view returns (bytes32[] memory);
    
    /// @notice Get the name of a trait
    /// @param traitKey Key of the trait
    /// @return Name of the trait
    function getBondTraitName(bytes32 traitKey) external view returns (string memory);
    
    /// @notice Set a trait value for a bond (admin only)
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @param traitValue Value of the trait
    function setBondTrait(uint256 bondId, bytes32 traitKey, bytes memory traitValue) external;
    
    /// @notice Set a trait value with flexible input types
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait (either bytes32 or string)
    /// @param traitValue Value of the trait (supports various types)
    /// @param valueType Type of the value (0=bytes, 1=string, 2=uint256, 3=bool)
    function setBondTraitFlexible(uint256 bondId, bytes memory traitKey, bytes memory traitValue, uint8 valueType) external;
    
    /// @notice Remove a trait from a bond
    /// @param bondId ID of the bond
    /// @param traitName Name of the trait to remove
    function removeBondTrait(uint256 bondId, string memory traitName) external;
    
    /// @notice Get the metadata URI for traits
    /// @return Base64-encoded JSON schema indicating dynamic trait support
    function getBondTraitMetadataURI() external pure returns (string memory);
    
    /// @notice Get bond type based on maturity date
    /// @param maturityDate Maturity date of the bond
    /// @return Bond type string (short-term, mid-term, or long-term)
    function getBondType(uint256 maturityDate) external view returns (string memory);
    
    /* ========== MUTATIVE FUNCTIONS ========== */
    
    /// @notice Mint a new BurnerBond (called by BurnerBondDeposit contract)
    /// @param faceValue Face value of the bond in USDC (6 decimals)
    /// @param maturityDate Unix timestamp when bond can be redeemed
    /// @param discountPercentage Discount percentage (0-30%, in basis points)
    /// @param creator Address that created the bond
    /// @return bondId Unique identifier for the minted bond
    function mintBond(
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage,
        address creator
    ) external returns (uint256 bondId);
    
    /// @notice Redeem a mature bond for its face value
    /// @param bondId Unique bond identifier
    function redeemBond(uint256 bondId) external;
    
    /// @notice Batch redeem multiple mature bonds
    /// @param bondIds Array of bond IDs to redeem
    function batchRedeemBonds(uint256[] calldata bondIds) external;
    
    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Update discount calculation parameters
    /// @param _maxDiscount Maximum discount percentage in basis points (0-5000)
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateDiscountParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external;
    
    /// @notice Set minimum discount percentage
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external;
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external;
    
    /// @notice Set the underlying token address
    /// @param _underlyingToken Address of the underlying token
    function setUnderlyingToken(address _underlyingToken) external;
    
    /// @notice Update minimum and maximum face value limits
    /// @param _minFaceValue Minimum face value in underlying token units
    /// @param _maxFaceValue Maximum face value in underlying token units
    function updateFaceValueLimits(uint256 _minFaceValue, uint256 _maxFaceValue) external;
    
    /// @notice Update minimum maturity period
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external;
    
    /// @notice Get collection name
    /// @return Collection name
    function name() external view returns (string memory);
    
    /// @notice Get collection symbol
    /// @return Collection symbol
    function symbol() external view returns (string memory);
    
    /// @notice Get collection description
    /// @return Collection description
    function description() external view returns (string memory);
    
    /// @notice Get underlying token address
    /// @return Address of the underlying token
    function getUnderlyingToken() external view returns (address);
    
    /// @notice Get collection metadata
    /// @return name Collection name
    /// @return symbol Collection symbol
    /// @return description Collection description
    /// @return underlyingToken Address of underlying token
    /// @return totalSupply Total bonds minted
    function getCollectionMetadata() external view returns (
        string memory name,
        string memory symbol,
        string memory description,
        address underlyingToken,
        uint256 totalSupply
    );
    
    /// @notice Get contract-level metadata URI (ERC-7572)
    /// @dev Returns JSON metadata for the entire collection
    /// @return Collection metadata URI
    function contractURI() external view returns (string memory);
}
