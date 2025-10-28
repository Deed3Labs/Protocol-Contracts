// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../core/interfaces/IBurnerBondDeposit.sol";
import "../core/interfaces/IBurnerBond.sol";
import "../core/interfaces/IAssurancePool.sol";
import "../core/interfaces/IBurnerBondFactory.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title BurnerBondDeposit
/// @notice Handles all financial logic for BurnerBond creation
/// @dev Separates financial operations from NFT minting logic
contract BurnerBondDeposit is IBurnerBondDeposit, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;

    /* ========== STATE VARIABLES ========== */
    
    /// @notice Counter for generating unique deposit IDs
    Counters.Counter private _depositIdCounter;
    
    /// @notice Factory contract for managing collections (single source of truth for parameters)
    IBurnerBondFactory public factory;
    
    /// @notice AssurancePool contract for token deposits
    IAssurancePool public assurancePool;
    
    /// @notice Mapping from token address to BurnerBond collection
    mapping(address => IBurnerBond) public tokenToCollection;
    
    /// @notice Mapping from deposit ID to deposit information
    mapping(uint256 => DepositInfo) public deposits;
    
    /// @notice Mapping from depositor to number of deposits made
    mapping(address => uint256) public depositsBy;
    
    /// @notice Mapping from depositor to array of deposit IDs they made
    mapping(address => uint256[]) public depositIdsBy;
    
    /// @notice Array of pending deposit IDs (not yet processed)
    uint256[] public pendingDeposits;
    
    /// @notice Mapping from deposit ID to index in pendingDeposits array
    mapping(uint256 => uint256) public pendingDepositIndex;
    
    /// @notice Total deposits made
    uint256 public totalDepositsMade;
    
    /// @notice Total underlying token deposited
    uint256 public totalTokenDeposited;
    
    /// @notice Total deposits processed
    uint256 public totalDepositsProcessed;

    /* ========== CONSTRUCTOR ========== */
    
    /// @notice Initialize the BurnerBondDeposit contract
    /// @param _factory Address of the BurnerBondFactory contract (single source of truth for parameters)
    /// @param _assurancePool Address of the AssurancePool contract
    constructor(
        address _factory,
        address _assurancePool
    ) {
        require(_factory != address(0), "Invalid factory address");
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        
        factory = IBurnerBondFactory(_factory);
        assurancePool = IAssurancePool(_assurancePool);
        
        // Start deposit ID counter at 1
        _depositIdCounter.increment();
    }

    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get deposit information by ID
    /// @param depositId Unique deposit identifier
    /// @return DepositInfo struct containing all deposit details
    function getDepositInfo(uint256 depositId) external view override returns (DepositInfo memory) {
        require(deposits[depositId].depositor != address(0), "Deposit does not exist");
        return deposits[depositId];
    }
    
    /// @notice Calculate required deposit amount for a bond
    /// @param tokenAddress Address of the token
    /// @param faceValue Face value of the bond
    /// @param maturityDate Maturity date of the bond
    /// @return Required deposit amount in underlying token
    function calculateRequiredDeposit(address tokenAddress, uint256 faceValue, uint256 maturityDate) public view override returns (uint256) {
        uint256 currentTime = block.timestamp;
        require(maturityDate > currentTime, "Maturity date must be in the future");
        
        uint256 timeToMaturity = maturityDate - currentTime;
        uint256 minMaturity = factory.getMinMaturity();
        uint256 maxMaturity = factory.getMaxMaturity();
        
        // Ensure maturity is within allowed range
        if (timeToMaturity < minMaturity) {
            return faceValue; // No discount for very short maturities
        }
        
        if (timeToMaturity > maxMaturity) {
            timeToMaturity = maxMaturity; // Cap at maximum maturity
        }
        
        // Get the collection for this token
        IBurnerBond burnerBond = tokenToCollection[tokenAddress];
        require(address(burnerBond) != address(0), "Collection does not exist");
        
        // Use the BurnerBond contract's curve system to calculate discount
        uint256 discount = burnerBond.getDiscountForMaturity(timeToMaturity);
        uint256 discountAmount = (faceValue * discount) / 10000; // Convert basis points to percentage
        
        return faceValue - discountAmount;
    }
    
    /// @notice Get total deposits made by an address
    /// @param depositor Address to check
    /// @return Number of deposits made
    function getDepositsBy(address depositor) external view override returns (uint256) {
        return depositsBy[depositor];
    }
    
    /// @notice Get all deposit IDs made by an address
    /// @param depositor Address to check
    /// @return Array of deposit IDs
    function getDepositIdsBy(address depositor) external view override returns (uint256[] memory) {
        return depositIdsBy[depositor];
    }
    
    /// @notice Get pending deposits (not yet processed)
    /// @return Array of pending deposit IDs
    function getPendingDeposits() external view override returns (uint256[] memory) {
        return pendingDeposits;
    }
    
    /// @notice Get current deposit parameters
    /// @return maxDiscount Maximum discount percentage in basis points
    /// @return maxMaturity Maximum maturity period in seconds
    function getDepositParameters() external view override returns (uint256, uint256) {
        return (factory.getMaxDiscount(), factory.getMaxMaturity());
    }
    
    /// @notice Get deposit statistics
    /// @return totalMade Total deposits made
    /// @return totalDeposited Total underlying token deposited
    /// @return totalProcessed Total deposits processed
    function getDepositStatistics() external view returns (uint256 totalMade, uint256 totalDeposited, uint256 totalProcessed) {
        return (totalDepositsMade, totalTokenDeposited, totalDepositsProcessed);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */
    
    /// @notice Make a deposit for bond creation (auto-processed)
    /// @dev This is the main entry point for users to create bonds
    /// @dev Automatically creates collection if it doesn't exist (user pays gas)
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
    ) public override nonReentrant returns (uint256 bondId) {
        // Check if collection exists, if not, create it automatically
        IBurnerBond burnerBond = tokenToCollection[tokenAddress];
        
        if (address(burnerBond) == address(0)) {
            // Collection doesn't exist - create it via factory
            // This will revert if token is not whitelisted
            _createCollectionViaFactory(tokenAddress);
            
            // Get the newly created collection
            burnerBond = tokenToCollection[tokenAddress];
            require(address(burnerBond) != address(0), "Collection creation failed");
        }
        
        // Get the underlying token
        IERC20 underlyingToken = IERC20(tokenAddress);
        // Validate inputs using factory parameters
        require(faceValue >= factory.getMinFaceValue(), "Face value too low");
        require(faceValue <= factory.getMaxFaceValue(), "Face value too high");
        require(maturityDate > block.timestamp, "Maturity date must be in the future");
        require(maturityDate <= block.timestamp + factory.getMaxMaturity(), "Maturity date too far in future");
        require(discountPercentage <= factory.getMaxDiscount(), "Discount percentage too high");
        
        // Calculate required deposit amount
        uint256 requiredDeposit = calculateRequiredDeposit(tokenAddress, faceValue, maturityDate);
        
        // Validate discount percentage doesn't exceed calculated maximum using curve system
        uint256 maxAllowedDiscount = burnerBond.calculateDiscountWithCurve(maturityDate);
        require(discountPercentage <= maxAllowedDiscount, "Discount exceeds maximum for maturity period");
        
        // Transfer underlying token from user to this contract
        underlyingToken.safeTransferFrom(msg.sender, address(this), requiredDeposit);
        
        // Generate unique deposit ID for tracking
        uint256 depositId = _depositIdCounter.current();
        _depositIdCounter.increment();
        
        // Store deposit information
        deposits[depositId] = DepositInfo({
            tokenAddress: tokenAddress,
            amount: requiredDeposit,
            faceValue: faceValue,
            maturityDate: maturityDate,
            discountPercentage: discountPercentage,
            depositor: msg.sender,
            bondId: 0, // Will be set below
            isProcessed: false // Will be set to true below
        });
        
        // Update mappings
        depositsBy[msg.sender]++;
        depositIdsBy[msg.sender].push(depositId);
        
        // IMMEDIATELY PROCESS THE DEPOSIT (auto-processing)
        // This entire block is atomic - if any step fails, the whole transaction reverts
        
        // Step 1: Approve AssurancePool to spend underlying token
        underlyingToken.approve(address(assurancePool), requiredDeposit);
        
        // Step 2: Deposit underlying token into AssurancePool excess reserve
        // If this fails, the entire transaction reverts and user keeps their token
        assurancePool.depositTokenIntoExcess(address(underlyingToken), requiredDeposit);
        
        // Step 3: Only mint bond AFTER successful deposit to AssurancePool
        // This ensures the bond is backed by actual underlying token in the pool
        bondId = burnerBond.mintBond(
            faceValue,
            maturityDate,
            discountPercentage,
            msg.sender
        );
        
        // Safety check: Ensure bond was actually minted
        require(bondId > 0, "Bond minting failed");
        
        // If we reach here, both deposit and minting succeeded
        // The bond is now fully backed by underlying token in the AssurancePool
        
        // Update deposit information
        deposits[depositId].bondId = bondId;
        deposits[depositId].isProcessed = true;
        
        // Update statistics
        totalDepositsMade++;
        totalDepositsProcessed++;
        totalTokenDeposited += requiredDeposit;
        
        // Emit events
        emit DepositMade(depositId, msg.sender, requiredDeposit, faceValue, maturityDate, discountPercentage);
        emit DepositProcessed(depositId, bondId, msg.sender);
        
        return bondId;
    }
    
    /// @notice Process a deposit and mint the corresponding bond
    /// @param depositId Deposit identifier to process
    /// @return bondId Bond ID that was minted
    function processDeposit(uint256 depositId) public override nonReentrant returns (uint256 bondId) {
        require(deposits[depositId].depositor != address(0), "Deposit does not exist");
        require(!deposits[depositId].isProcessed, "Deposit already processed");
        
        DepositInfo storage deposit = deposits[depositId];
        
        // Get the collection for this token
        IBurnerBond burnerBond = tokenToCollection[deposit.tokenAddress];
        require(address(burnerBond) != address(0), "Collection does not exist");
        
        // Get the underlying token
        IERC20 underlyingToken = IERC20(deposit.tokenAddress);
        
        // Approve AssurancePool to spend underlying token
        underlyingToken.approve(address(assurancePool), deposit.amount);
        
        // Deposit underlying token into AssurancePool excess reserve
        assurancePool.depositTokenIntoExcess(deposit.tokenAddress, deposit.amount);
        
        // Mint bond using BurnerBond contract
        bondId = burnerBond.mintBond(
            deposit.faceValue,
            deposit.maturityDate,
            deposit.discountPercentage,
            deposit.depositor
        );
        
        // Update deposit information
        deposit.bondId = bondId;
        deposit.isProcessed = true;
        
        // Remove from pending deposits
        _removeFromPendingDeposits(depositId);
        
        // Update statistics
        totalDepositsProcessed++;
        
        emit DepositProcessed(depositId, bondId, deposit.depositor);
        
        return bondId;
    }
    
    /// @notice Batch process multiple deposits
    /// @param depositIds Array of deposit IDs to process
    /// @return bondIds Array of bond IDs that were minted
    function batchProcessDeposits(uint256[] calldata depositIds) external override nonReentrant returns (uint256[] memory bondIds) {
        require(depositIds.length > 0, "No deposits to process");
        require(depositIds.length <= 50, "Too many deposits in batch"); // Gas limit protection
        
        bondIds = new uint256[](depositIds.length);
        
        // Process all deposits
        for (uint256 i = 0; i < depositIds.length; i++) {
            uint256 depositId = depositIds[i];
            require(deposits[depositId].depositor != address(0), "Deposit does not exist");
            require(!deposits[depositId].isProcessed, "Deposit already processed");
            
            bondIds[i] = processDeposit(depositId);
        }
        
        return bondIds;
    }
    
    /// @notice Refund a deposit (admin only, for failed processing)
    /// @param depositId Deposit identifier to refund
    function refundDeposit(uint256 depositId) external override onlyOwner nonReentrant {
        require(deposits[depositId].depositor != address(0), "Deposit does not exist");
        require(!deposits[depositId].isProcessed, "Deposit already processed");
        
        DepositInfo storage deposit = deposits[depositId];
        
        // Get the underlying token
        IERC20 underlyingToken = IERC20(deposit.tokenAddress);
        
        // Mark as processed to prevent double refund
        deposit.isProcessed = true;
        
        // Remove from pending deposits
        _removeFromPendingDeposits(depositId);
        
        // Transfer underlying token back to depositor
        underlyingToken.safeTransfer(deposit.depositor, deposit.amount);
        
        // Update statistics
        totalDepositsProcessed++;
        totalTokenDeposited -= deposit.amount;
    }

    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Register a collection for a token (factory only)
    /// @param tokenAddress Address of the token
    /// @param collectionAddress Address of the BurnerBond collection
    function registerCollection(address tokenAddress, address collectionAddress) external override {
        require(msg.sender == address(factory), "Only factory can register collections");
        require(tokenAddress != address(0), "Invalid token address");
        require(collectionAddress != address(0), "Invalid collection address");
        require(address(tokenToCollection[tokenAddress]) == address(0), "Collection already registered");
        
        tokenToCollection[tokenAddress] = IBurnerBond(collectionAddress);
    }
    
    /// @notice Update deposit calculation parameters (delegates to factory)
    /// @param _maxDiscount Maximum discount percentage in basis points (0-5000)
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateDepositParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.updateGlobalParameters(_maxDiscount, _minDiscount, _maxMaturity);
    }
    
    /// @notice Set minimum discount percentage (delegates to factory)
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.setMinDiscount(_minDiscount);
    }
    
    /// @notice Set the factory contract address
    /// @param _factory Address of the BurnerBondFactory contract
    function setFactory(address _factory) external override onlyOwner {
        require(_factory != address(0), "Invalid factory address");
        factory = IBurnerBondFactory(_factory);
    }
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external override onlyOwner {
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        assurancePool = IAssurancePool(_assurancePool);
    }
    
    /// @notice Update minimum and maximum face value limits (delegates to factory)
    /// @param _minFaceValue Minimum face value in underlying token units
    /// @param _maxFaceValue Maximum face value in underlying token units
    function updateFaceValueLimits(uint256 _minFaceValue, uint256 _maxFaceValue) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.updateFaceValueLimits(_minFaceValue, _maxFaceValue);
    }
    
    /// @notice Update minimum maturity period (delegates to factory)
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.updateMinMaturity(_minMaturity);
    }
    
    /// @notice Emergency function to recover stuck tokens (owner only)
    /// @param token Token address to recover
    /// @param amount Amount to recover
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        // Check if token is registered as a collection token
        require(address(tokenToCollection[token]) == address(0), "Cannot recover registered collection token");
        IERC20(token).safeTransfer(owner(), amount);
    }

    /* ========== INTERNAL FUNCTIONS ========== */
    
    /// @notice Create a collection for a token via the factory
    /// @dev Called automatically when a user deposits a token without an existing collection
    /// @param tokenAddress Address of the token
    function _createCollectionViaFactory(address tokenAddress) internal {
        require(address(factory) != address(0), "Factory not set");
        
        // Get token metadata for collection naming
        string memory tokenSymbol;
        string memory tokenName;
        
        try IERC20Metadata(tokenAddress).symbol() returns (string memory _symbol) {
            tokenSymbol = _symbol;
        } catch {
            tokenSymbol = "TOKEN";
        }
        
        try IERC20Metadata(tokenAddress).name() returns (string memory _name) {
            tokenName = _name;
        } catch {
            tokenName = "Unknown Token";
        }
        
        // Call factory to create collection
        // This will revert if token is not whitelisted by AssuranceOracle
        IBurnerBondFactory(factory).createCollection(
            tokenAddress,
            tokenSymbol,
            tokenName,
            "" // Empty baseURI, factory will use its default
        );
        
        // Collection is automatically registered via factory's registerCollection call
    }
    
    /// @notice Calculate maximum discount for a given maturity date using curve system
    /// @param tokenAddress Address of the token
    /// @param maturityDate Maturity date for the bond
    /// @return Maximum discount percentage in basis points
    function calculateMaxDiscount(address tokenAddress, uint256 maturityDate) internal view returns (uint256) {
        IBurnerBond burnerBond = tokenToCollection[tokenAddress];
        require(address(burnerBond) != address(0), "Collection does not exist");
        return burnerBond.calculateDiscountWithCurve(maturityDate);
    }
    
    /// @notice Remove deposit from pending deposits array
    /// @param depositId Deposit ID to remove
    function _removeFromPendingDeposits(uint256 depositId) internal {
        uint256 index = pendingDepositIndex[depositId];
        uint256 lastIndex = pendingDeposits.length - 1;
        
        if (index != lastIndex) {
            // Move last element to the position of the element to delete
            uint256 lastDepositId = pendingDeposits[lastIndex];
            pendingDeposits[index] = lastDepositId;
            pendingDepositIndex[lastDepositId] = index;
        }
        
        // Remove last element
        pendingDeposits.pop();
        delete pendingDepositIndex[depositId];
    }
}
