// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "./IBurnerBond.sol";
import "../stable-credit/IAssurancePool.sol";
import "../stable-credit/IAssuranceOracle.sol";

/// @title IBurnerBondFactory
/// @notice Interface for BurnerBond factory that creates token-specific collections
interface IBurnerBondFactory {
    
    /* ========== STRUCTS ========== */
    
    /// @notice Collection information structure
    /// @param tokenAddress Address of the underlying token
    /// @param tokenSymbol Symbol of the underlying token
    /// @param tokenName Name of the underlying token
    /// @param collectionAddress Address of the BurnerBond collection
    /// @param depositContract Address of the token-specific deposit contract
    /// @param isActive Whether the collection is active
    /// @param createdAt Timestamp when collection was created
    struct CollectionInfo {
        address tokenAddress;
        string tokenSymbol;
        string tokenName;
        address collectionAddress;
        address depositContract;
        bool isActive;
        uint256 createdAt;
    }
    
    /* ========== EVENTS ========== */
    
    /// @notice Emitted when a new collection is created
    /// @param tokenAddress Address of the underlying token
    /// @param collectionAddress Address of the created collection
    /// @param depositContract Address of the deposit contract
    /// @param tokenSymbol Symbol of the token
    event CollectionCreated(
        address indexed tokenAddress,
        address indexed collectionAddress,
        address indexed depositContract,
        string tokenSymbol
    );
    
    /// @notice Emitted when a collection is deactivated
    /// @param tokenAddress Address of the underlying token
    /// @param collectionAddress Address of the collection
    event CollectionDeactivated(
        address indexed tokenAddress,
        address indexed collectionAddress
    );
    
    /// @notice Emitted when a collection is reactivated
    /// @param tokenAddress Address of the underlying token
    /// @param collectionAddress Address of the collection
    event CollectionReactivated(
        address indexed tokenAddress,
        address indexed collectionAddress
    );
    
    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get collection information for a token
    /// @param tokenAddress Address of the underlying token
    /// @return CollectionInfo struct containing collection details
    function getCollectionInfo(address tokenAddress) external view returns (CollectionInfo memory);
    
    /// @notice Check if a collection exists for a token
    /// @param tokenAddress Address of the underlying token
    /// @return True if collection exists and is active
    function hasCollection(address tokenAddress) external view returns (bool);
    
    /// @notice Get the collection address for a token
    /// @param tokenAddress Address of the underlying token
    /// @return Address of the BurnerBond collection (address(0) if not found)
    function getCollectionAddress(address tokenAddress) external view returns (address);
    
    /// @notice Get the deposit contract address for a token
    /// @param tokenAddress Address of the underlying token
    /// @return Address of the deposit contract (address(0) if not found)
    function getDepositContract(address tokenAddress) external view returns (address);
    
    /// @notice Get all active collections
    /// @return Array of token addresses with active collections
    function getActiveCollections() external view returns (address[] memory);
    
    /// @notice Get collection count
    /// @return Total number of collections created
    function getCollectionCount() external view returns (uint256);
    
    /// @notice Get collection at index
    /// @param index Index in the collections array
    /// @return CollectionInfo struct
    function getCollectionAtIndex(uint256 index) external view returns (CollectionInfo memory);
    
    /// @notice Get maximum discount percentage (single source of truth)
    /// @return Maximum discount percentage in basis points
    function getMaxDiscount() external view returns (uint256);
    
    /// @notice Get minimum discount percentage (single source of truth)
    /// @return Minimum discount percentage in basis points
    function getMinDiscount() external view returns (uint256);
    
    /// @notice Get maximum maturity period (single source of truth)
    /// @return Maximum maturity period in seconds
    function getMaxMaturity() external view returns (uint256);
    
    /// @notice Get minimum maturity period (single source of truth)
    /// @return Minimum maturity period in seconds
    function getMinMaturity() external view returns (uint256);
    
    /// @notice Get minimum face value (single source of truth)
    /// @return Minimum face value in token units
    function getMinFaceValue() external view returns (uint256);
    
    /// @notice Get maximum face value (single source of truth)
    /// @return Maximum face value in token units
    function getMaxFaceValue() external view returns (uint256);
    
    /// @notice Get all global parameters (single source of truth)
    /// @return maxDiscount_ Maximum discount percentage in basis points
    /// @return maxMaturity_ Maximum maturity period in seconds
    /// @return minMaturity_ Minimum maturity period in seconds
    /// @return minFaceValue_ Minimum face value in token units
    /// @return maxFaceValue_ Maximum face value in token units
    function getAllParameters() external view returns (
        uint256 maxDiscount_,
        uint256 maxMaturity_,
        uint256 minMaturity_,
        uint256 minFaceValue_,
        uint256 maxFaceValue_
    );
    
    /* ========== MUTATIVE FUNCTIONS ========== */
    
    /// @notice Create a new collection for a token
    /// @param tokenAddress Address of the underlying token
    /// @param tokenSymbol Symbol of the token (for collection naming)
    /// @param tokenName Name of the token (for collection naming)
    /// @param baseURI Base URI for the collection metadata
    /// @return collectionAddress Address of the created collection
    /// @return depositContract Address of the created deposit contract
    function createCollection(
        address tokenAddress,
        string calldata tokenSymbol,
        string calldata tokenName,
        string calldata baseURI
    ) external returns (address collectionAddress, address depositContract);
    
    /// @notice Deactivate a collection (admin only)
    /// @param tokenAddress Address of the underlying token
    function deactivateCollection(address tokenAddress) external;
    
    /// @notice Reactivate a collection (admin only)
    /// @param tokenAddress Address of the underlying token
    function reactivateCollection(address tokenAddress) external;
    
    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external;
    
    /// @notice Set the AssuranceOracle contract address
    /// @param _assuranceOracle Address of the AssuranceOracle contract
    function setAssuranceOracle(address _assuranceOracle) external;
    
    /// @notice Set the base URI for new collections
    /// @param _baseURI New base URI template
    function setBaseURI(string calldata _baseURI) external;
    
    /// @notice Update collection parameters for all collections
    /// @param _maxDiscount Maximum discount percentage in basis points
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateGlobalParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external;
    
    /// @notice Set minimum discount percentage
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external;
    
    /// @notice Update minimum and maximum face value limits for all collections
    /// @param _minFaceValue Minimum face value in token units
    /// @param _maxFaceValue Maximum face value in token units
    function updateFaceValueLimits(uint256 _minFaceValue, uint256 _maxFaceValue) external;
    
    /// @notice Update minimum maturity period for all collections
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external;
}
