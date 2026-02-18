// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/IBurnerBondFactory.sol";
import "../interfaces/burner-bond/IBurnerBond.sol";
import "../interfaces/burner-bond/IBurnerBondDeposit.sol";
import "../interfaces/stable-credit/IAssurancePool.sol";
import "../interfaces/stable-credit/IAssuranceOracle.sol";
import "../../peripherals/BurnerBond.sol";
import "../../peripherals/BurnerBondDeposit.sol";

/// @title BurnerBondFactory
/// @notice Factory contract that creates token-specific BurnerBond collections
/// @dev Each whitelisted token gets its own NFT collection and deposit contract
contract BurnerBondFactory is IBurnerBondFactory, Ownable, ReentrancyGuard {
    
    /* ========== STATE VARIABLES ========== */
    
    /// @notice AssurancePool contract for token deposits
    IAssurancePool public assurancePool;
    
    /// @notice AssuranceOracle contract for token validation and pricing
    IAssuranceOracle public assuranceOracle;
    
    /// @notice Single unified deposit contract
    IBurnerBondDeposit public burnerBondDeposit;
    
    /// @notice Base URI template for new collections
    string public baseURI;
    
    /// @notice Mapping from token address to collection information
    mapping(address => CollectionInfo) public collections;
    
    /// @notice Array of all token addresses with collections
    address[] public allTokens;
    
    /// @notice Mapping from token address to index in allTokens array
    mapping(address => uint256) public tokenIndex;
    
    /// @notice Global parameters for all collections
    uint256 public maxDiscount = 5000; // 50%
    uint256 public minDiscount = 0; // 0% minimum discount
    uint256 public maxMaturity = 30 * 365 * 24 * 60 * 60; // 30 years
    uint256 public minMaturity = 24 * 60 * 60; // 1 day
    uint256 public minFaceValue = 100 * 10**6; // $100 USDC
    uint256 public maxFaceValue = 1000000 * 10**6; // $1M USDC
    
    /// @notice Total collections created
    uint256 public collectionCount;
    
    /* ========== CONSTRUCTOR ========== */
    
    /// @notice Initialize the BurnerBondFactory
    /// @param _assurancePool Address of the AssurancePool contract
    /// @param _assuranceOracle Address of the AssuranceOracle contract
    /// @param _baseURI Base URI template for new collections
    constructor(
        address _assurancePool,
        address _assuranceOracle,
        string memory _baseURI
    ) {
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        require(_assuranceOracle != address(0), "Invalid AssuranceOracle address");
        
        assurancePool = IAssurancePool(_assurancePool);
        assuranceOracle = IAssuranceOracle(_assuranceOracle);
        baseURI = _baseURI;
        
        // Deploy single unified deposit contract
        burnerBondDeposit = new BurnerBondDeposit(
            address(this),  // Factory address
            address(assurancePool)
        );
    }
    
    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get collection information for a token
    /// @param tokenAddress Address of the underlying token
    /// @return CollectionInfo struct containing collection details
    function getCollectionInfo(address tokenAddress) external view override returns (CollectionInfo memory) {
        return collections[tokenAddress];
    }
    
    /// @notice Check if a collection exists for a token
    /// @param tokenAddress Address of the underlying token
    /// @return True if collection exists and is active
    function hasCollection(address tokenAddress) external view override returns (bool) {
        return collections[tokenAddress].collectionAddress != address(0) && collections[tokenAddress].isActive;
    }
    
    /// @notice Get the collection address for a token
    /// @param tokenAddress Address of the underlying token
    /// @return Address of the BurnerBond collection (address(0) if not found)
    function getCollectionAddress(address tokenAddress) external view override returns (address) {
        return collections[tokenAddress].collectionAddress;
    }
    
    /// @notice Get the deposit contract address for a token (returns unified deposit contract)
    /// @return Address of the deposit contract (unified for all tokens)
    function getDepositContract(address /* tokenAddress */) external view override returns (address) {
        return address(burnerBondDeposit);
    }
    
    /// @notice Get the unified deposit contract address
    /// @return Address of the BurnerBondDeposit contract
    function getUnifiedDepositContract() external view returns (address) {
        return address(burnerBondDeposit);
    }
    
    /// @notice Get all active collections
    /// @return Array of token addresses with active collections
    function getActiveCollections() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active collections
        for (uint256 i = 0; i < allTokens.length; i++) {
            if (collections[allTokens[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array with active collections
        address[] memory activeTokens = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allTokens.length; i++) {
            if (collections[allTokens[i]].isActive) {
                activeTokens[index] = allTokens[i];
                index++;
            }
        }
        
        return activeTokens;
    }
    
    /// @notice Get collection count
    /// @return Total number of collections created
    function getCollectionCount() external view override returns (uint256) {
        return collectionCount;
    }
    
    /// @notice Get collection at index
    /// @param index Index in the collections array
    /// @return CollectionInfo struct
    function getCollectionAtIndex(uint256 index) external view override returns (CollectionInfo memory) {
        require(index < allTokens.length, "Index out of bounds");
        return collections[allTokens[index]];
    }
    
    /// @notice Get maximum discount percentage (single source of truth)
    /// @return Maximum discount percentage in basis points
    function getMaxDiscount() external view returns (uint256) {
        return maxDiscount;
    }
    
    /// @notice Get minimum discount percentage (single source of truth)
    /// @return Minimum discount percentage in basis points
    function getMinDiscount() external view returns (uint256) {
        return minDiscount;
    }
    
    /// @notice Get maximum maturity period (single source of truth)
    /// @return Maximum maturity period in seconds
    function getMaxMaturity() external view returns (uint256) {
        return maxMaturity;
    }
    
    /// @notice Get minimum maturity period (single source of truth)
    /// @return Minimum maturity period in seconds
    function getMinMaturity() external view returns (uint256) {
        return minMaturity;
    }
    
    /// @notice Get minimum face value (single source of truth)
    /// @return Minimum face value in token units
    function getMinFaceValue() external view returns (uint256) {
        return minFaceValue;
    }
    
    /// @notice Get maximum face value (single source of truth)
    /// @return Maximum face value in token units
    function getMaxFaceValue() external view returns (uint256) {
        return maxFaceValue;
    }
    
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
    ) {
        return (maxDiscount, maxMaturity, minMaturity, minFaceValue, maxFaceValue);
    }
    
    /* ========== MUTATIVE FUNCTIONS ========== */
    
    /// @notice Create a new collection for a token
    /// @param tokenAddress Address of the underlying token
    /// @param tokenSymbol Symbol of the token (for collection naming)
    /// @param tokenName Name of the token (for collection naming)
    /// @param collectionBaseURI Base URI for the collection metadata
    /// @return collectionAddress Address of the created collection
    /// @return depositContract Address of the created deposit contract
    function createCollection(
        address tokenAddress,
        string calldata tokenSymbol,
        string calldata tokenName,
        string calldata collectionBaseURI
    ) external override nonReentrant returns (address collectionAddress, address depositContract) {
        require(tokenAddress != address(0), "Invalid token address");
        require(collections[tokenAddress].collectionAddress == address(0), "Collection already exists");
        // Check if token is whitelisted by calling the oracle directly
        try assuranceOracle.isTokenWhitelisted(tokenAddress) returns (bool isWhitelisted) {
            require(isWhitelisted, "Token not whitelisted");
        } catch {
            revert("Token whitelist check failed");
        }
        
        // Create collection-specific URI
        string memory fullBaseURI = string(abi.encodePacked(collectionBaseURI, "/", tokenSymbol, "/"));
        
        // Create collection-specific metadata
        string memory collectionName = string(abi.encodePacked(tokenName, " BurnerBonds"));
        string memory collectionSymbol = string(abi.encodePacked(tokenSymbol, "-BB"));
        string memory collectionDescription = string(abi.encodePacked("BurnerBond collection backed by ", tokenName, " tokens"));
        
        // Deploy BurnerBond collection
        BurnerBond newCollection = new BurnerBond(
            address(burnerBondDeposit), // Use unified deposit contract
            address(this), // Factory address (single source of truth for parameters)
            address(assurancePool),
            tokenAddress, // Use the token as the underlying token for this collection
            fullBaseURI,
            collectionName,
            collectionSymbol,
            collectionDescription
        );
        
        // Register this collection with the unified deposit contract
        burnerBondDeposit.registerCollection(tokenAddress, address(newCollection));
        
        // Store collection information
        collections[tokenAddress] = CollectionInfo({
            tokenAddress: tokenAddress,
            tokenSymbol: tokenSymbol,
            tokenName: tokenName,
            collectionAddress: address(newCollection),
            depositContract: address(burnerBondDeposit), // Use unified deposit contract
            isActive: true,
            createdAt: block.timestamp
        });
        
        // Add to allTokens array
        allTokens.push(tokenAddress);
        tokenIndex[tokenAddress] = allTokens.length - 1;
        
        // Update collection count
        collectionCount++;
        
        // Transfer ownership to factory owner
        newCollection.transferOwnership(owner());
        
        emit CollectionCreated(tokenAddress, address(newCollection), address(burnerBondDeposit), tokenSymbol);
        
        return (address(newCollection), address(burnerBondDeposit));
    }
    
    
    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Deactivate a collection (admin only)
    /// @param tokenAddress Address of the underlying token
    function deactivateCollection(address tokenAddress) external override onlyOwner {
        require(collections[tokenAddress].collectionAddress != address(0), "Collection does not exist");
        require(collections[tokenAddress].isActive, "Collection already inactive");
        
        collections[tokenAddress].isActive = false;
        
        emit CollectionDeactivated(tokenAddress, collections[tokenAddress].collectionAddress);
    }
    
    /// @notice Reactivate a collection (admin only)
    /// @param tokenAddress Address of the underlying token
    function reactivateCollection(address tokenAddress) external override onlyOwner {
        require(collections[tokenAddress].collectionAddress != address(0), "Collection does not exist");
        require(!collections[tokenAddress].isActive, "Collection already active");
        
        collections[tokenAddress].isActive = true;
        
        emit CollectionReactivated(tokenAddress, collections[tokenAddress].collectionAddress);
    }
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external override onlyOwner {
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        assurancePool = IAssurancePool(_assurancePool);
    }
    
    /// @notice Set the AssuranceOracle contract address
    /// @param _assuranceOracle Address of the AssuranceOracle contract
    function setAssuranceOracle(address _assuranceOracle) external override onlyOwner {
        require(_assuranceOracle != address(0), "Invalid AssuranceOracle address");
        assuranceOracle = IAssuranceOracle(_assuranceOracle);
    }
    
    /// @notice Set the base URI for new collections
    /// @param _baseURI New base URI template
    function setBaseURI(string calldata _baseURI) external override onlyOwner {
        baseURI = _baseURI;
    }
    
    /// @notice Update collection parameters for all collections
    /// @param _maxDiscount Maximum discount percentage in basis points
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateGlobalParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external override onlyOwner {
        require(_maxDiscount <= 5000, "Max discount cannot exceed 50%");
        require(_minDiscount < _maxDiscount, "Min discount must be less than max discount");
        require(_maxMaturity >= minMaturity, "Max maturity too low");
        require(_maxMaturity <= 50 * 365 * 24 * 60 * 60, "Max maturity too high"); // 50 years max
        
        maxDiscount = _maxDiscount;
        minDiscount = _minDiscount;
        maxMaturity = _maxMaturity;
        
        // Update all existing collections
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddress = allTokens[i];
            if (collections[tokenAddress].isActive) {
                // Update collection parameters
                IBurnerBond(collections[tokenAddress].collectionAddress).updateDiscountParameters(_maxDiscount, _minDiscount, _maxMaturity);
                IBurnerBondDeposit(collections[tokenAddress].depositContract).updateDepositParameters(_maxDiscount, _minDiscount, _maxMaturity);
            }
        }
    }
    
    /// @notice Set minimum discount percentage
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external override onlyOwner {
        require(_minDiscount < maxDiscount, "Min discount must be less than max discount");
        minDiscount = _minDiscount;
        
        // Update all existing collections
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddress = allTokens[i];
            if (collections[tokenAddress].isActive) {
                IBurnerBond(collections[tokenAddress].collectionAddress).setMinDiscount(_minDiscount);
                IBurnerBondDeposit(collections[tokenAddress].depositContract).setMinDiscount(_minDiscount);
            }
        }
    }
    
    /// @notice Update minimum and maximum face value limits for all collections
    /// @dev This function updates face value limits on both BurnerBond collections and BurnerBondDeposit contracts
    /// @param _minFaceValue Minimum face value in token units
    /// @param _maxFaceValue Maximum face value in token units
    function updateFaceValueLimits(uint256 _minFaceValue, uint256 _maxFaceValue) external onlyOwner {
        require(_minFaceValue > 0, "Min face value must be positive");
        require(_maxFaceValue > _minFaceValue, "Max face value must be greater than min");
        require(_maxFaceValue <= 10000000 * 10**6, "Max face value too high"); // $10M max
        
        minFaceValue = _minFaceValue;
        maxFaceValue = _maxFaceValue;
        
        // Update all existing collections
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddress = allTokens[i];
            if (collections[tokenAddress].isActive) {
                // Update collection parameters
                // Try to update BurnerBond collection (may not be available in older versions)
                try IBurnerBond(collections[tokenAddress].collectionAddress).updateFaceValueLimits(_minFaceValue, _maxFaceValue) {
                    // Success - collection updated
                } catch {
                    // If the function doesn't exist, continue without error
                    // This ensures backward compatibility with older collection versions
                }
                IBurnerBondDeposit(collections[tokenAddress].depositContract).updateFaceValueLimits(_minFaceValue, _maxFaceValue);
            }
        }
    }
    
    /// @notice Update minimum maturity period for all collections
    /// @dev This function updates minimum maturity on both BurnerBond collections and BurnerBondDeposit contracts
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external onlyOwner {
        require(_minMaturity >= 60, "Min maturity too low"); // At least 1 minute
        require(_minMaturity <= maxMaturity, "Min maturity cannot exceed max maturity");
        
        minMaturity = _minMaturity;
        
        // Update all existing collections
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddress = allTokens[i];
            if (collections[tokenAddress].isActive) {
                // Update collection parameters
                // Try to update BurnerBond collection (may not be available in older versions)
                try IBurnerBond(collections[tokenAddress].collectionAddress).updateMinMaturity(_minMaturity) {
                    // Success - collection updated
                } catch {
                    // If the function doesn't exist, continue without error
                    // This ensures backward compatibility with older collection versions
                }
                IBurnerBondDeposit(collections[tokenAddress].depositContract).updateMinMaturity(_minMaturity);
            }
        }
    }
    
    /// @notice Emergency function to recover stuck tokens (owner only)
    /// @param token Token address to recover
    /// @param amount Amount to recover
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
}
