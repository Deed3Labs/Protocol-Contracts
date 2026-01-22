// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IBurnerBondDeposit
/// @notice Interface for BurnerBond deposit contract that handles financial logic
interface IBurnerBondDeposit {
    
    /* ========== STRUCTS ========== */
    
    /// @notice Deposit information structure
    /// @param tokenAddress Address of the token deposited
    /// @param amount Amount deposited in underlying token
    /// @param faceValue Face value of the bond to be minted
    /// @param maturityDate Maturity date for the bond
    /// @param discountPercentage Discount percentage applied
    /// @param depositor Address that made the deposit
    /// @param bondId Bond ID that will be minted (0 if not yet minted)
    /// @param isProcessed Whether the deposit has been processed
    struct DepositInfo {
        address tokenAddress;
        uint256 amount;
        uint256 faceValue;
        uint256 maturityDate;
        uint256 discountPercentage;
        address depositor;
        uint256 bondId;
        bool isProcessed;
    }
    
    /* ========== EVENTS ========== */
    
    /// @notice Emitted when a deposit is made
    /// @param depositId Unique deposit identifier
    /// @param depositor Address that made the deposit
    /// @param amount Amount deposited in USDC
    /// @param faceValue Face value of the bond
    /// @param maturityDate Maturity date
    /// @param discountPercentage Discount percentage
    event DepositMade(
        uint256 indexed depositId,
        address indexed depositor,
        uint256 amount,
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage
    );
    
    /// @notice Emitted when a deposit is processed and bond is minted
    /// @param depositId Deposit identifier
    /// @param bondId Bond ID that was minted
    /// @param depositor Address that made the deposit
    event DepositProcessed(
        uint256 indexed depositId,
        uint256 indexed bondId,
        address indexed depositor
    );
    
    /// @notice Emitted when deposit parameters are updated
    /// @param maxDiscount Maximum discount percentage
    /// @param maxMaturity Maximum maturity period
    event DepositParametersUpdated(uint256 maxDiscount, uint256 maxMaturity);
    
    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get deposit information by ID
    /// @param depositId Unique deposit identifier
    /// @return DepositInfo struct containing all deposit details
    function getDepositInfo(uint256 depositId) external view returns (DepositInfo memory);
    
    /// @notice Calculate required deposit amount for a bond
    /// @param tokenAddress Address of the token
    /// @param faceValue Face value of the bond
    /// @param maturityDate Maturity date of the bond
    /// @return Required deposit amount in underlying token
    function calculateRequiredDeposit(address tokenAddress, uint256 faceValue, uint256 maturityDate) external view returns (uint256);
    
    /// @notice Get total deposits made by an address
    /// @param depositor Address to check
    /// @return Number of deposits made
    function getDepositsBy(address depositor) external view returns (uint256);
    
    /// @notice Get all deposit IDs made by an address
    /// @param depositor Address to check
    /// @return Array of deposit IDs
    function getDepositIdsBy(address depositor) external view returns (uint256[] memory);
    
    /// @notice Get pending deposits (not yet processed)
    /// @return Array of pending deposit IDs
    function getPendingDeposits() external view returns (uint256[] memory);
    
    /// @notice Get current deposit parameters
    /// @return maxDiscount Maximum discount percentage
    /// @return maxMaturity Maximum maturity period
    function getDepositParameters() external view returns (uint256 maxDiscount, uint256 maxMaturity);
    
    /* ========== MUTATIVE FUNCTIONS ========== */
    
    /// @notice Make a deposit for bond creation (auto-processed)
    /// @param tokenAddress Address of the token to deposit
    /// @param faceValue Face value of the bond to be created
    /// @param maturityDate Maturity date for the bond
    /// @param discountPercentage Discount percentage (0-30%, in basis points)
    /// @return bondId Unique bond ID (minted immediately)
    function makeDeposit(
        address tokenAddress,
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage
    ) external returns (uint256 bondId);
    
    /// @notice Process a deposit and mint the corresponding bond
    /// @param depositId Deposit identifier to process
    /// @return bondId Bond ID that was minted
    function processDeposit(uint256 depositId) external returns (uint256 bondId);
    
    /// @notice Batch process multiple deposits
    /// @param depositIds Array of deposit IDs to process
    /// @return bondIds Array of bond IDs that were minted
    function batchProcessDeposits(uint256[] calldata depositIds) external returns (uint256[] memory bondIds);
    
    /// @notice Refund a deposit (admin only, for failed processing)
    /// @param depositId Deposit identifier to refund
    function refundDeposit(uint256 depositId) external;
    
    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Update deposit calculation parameters
    /// @param _maxDiscount Maximum discount percentage in basis points
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateDepositParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external;
    
    /// @notice Set minimum discount percentage
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external;
    
    /// @notice Register a collection for a token (factory only)
    /// @param tokenAddress Address of the token
    /// @param collectionAddress Address of the BurnerBond collection
    function registerCollection(address tokenAddress, address collectionAddress) external;
    
    /// @notice Set the factory contract address
    /// @param _factory Address of the BurnerBondFactory contract
    function setFactory(address _factory) external;
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external;
    
    /// @notice Update minimum and maximum face value limits
    /// @param _minFaceValue Minimum face value in underlying token units
    /// @param _maxFaceValue Maximum face value in underlying token units
    function updateFaceValueLimits(uint256 _minFaceValue, uint256 _maxFaceValue) external;
    
    /// @notice Update minimum maturity period
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external;
}
