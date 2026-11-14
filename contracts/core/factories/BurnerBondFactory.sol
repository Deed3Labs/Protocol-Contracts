// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../../peripherals/BondTraits.sol";
import "../../peripherals/BondDiscountCurve.sol";
import "../interfaces/burner-bond/IBurnerBondFactory.sol";
import "../interfaces/burner-bond/IBurnerBondDeposit.sol";
import "../interfaces/ITokenRegistry.sol";
import "../../peripherals/BurnerBond.sol";
import "../../peripherals/BurnerBondDeposit.sol";

/// @title BurnerBondFactory
/// @notice Factory contract that creates token-specific BurnerBond collections
/// @dev Each whitelisted token gets its own NFT collection and deposit contract
contract BurnerBondFactory is IBurnerBondFactory, Ownable, ReentrancyGuard {
    
    /* ========== STATE VARIABLES ========== */
    
    /// @notice Which tokens a collection may be opened for.
    /// @dev The TokenRegistry's whitelist. It used to be asked through the AssuranceOracle, which
    /// section 13 retires; the bond contracts hold no AssurancePool address at all, because bond
    /// principal never enters it.
    ITokenRegistry public tokenRegistry;
    
    /// @notice Single unified deposit contract
    IBurnerBondDeposit public burnerBondDeposit;
    
    /// @notice Base URI template for new collections
    string public baseURI;

    /// @notice The collection every clone points at.
    /// @dev Deployed once and never used directly. The factory used to build each collection with
    /// `new BurnerBond(...)`, which meant carrying a copy of the whole contract inside its own
    /// bytecode -- eight kilobytes past what a contract may weigh, so the factory could not be
    /// deployed at all. A clone carries a pointer instead, which also makes opening a collection
    /// cost a fraction of what deploying one did.
    address public immutable bondImplementation;
    /// @notice The deposit contract every network clones from.
    address public immutable depositImplementation;
    /// @notice Where every collection's metadata lives.
    /// @dev One deployment shared by all of them. The traits are display, they are keyed by the
    /// collection that wrote them, and a copy per collection would be a copy of the same twelve
    /// answers.
    address public immutable bondTraits;

    /// @notice Shared discount-curve engine. One deployment prices every collection this factory
    /// makes; each collection's configuration is keyed by its own address.
    address public immutable bondDiscountCurve;
    
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
    /// @dev Raised from $100 (audit X-10): the smallest bond is what an attacker pays per entry
    /// when trying to bloat the vault's books. The maturity buckets remove the unbounded loop
    /// itself; this keeps the bond count proportionate to the money behind it.
    uint256 public minFaceValue = 500 * 10**6; // $500 USDC
    uint256 public maxFaceValue = 1000000 * 10**6; // $1M USDC
    
    /// @notice Total collections created
    uint256 public collectionCount;
    
    /* ========== CONSTRUCTOR ========== */
    
    /// @notice Initialize the BurnerBondFactory
    /// @param _tokenRegistry Address of the TokenRegistry whose whitelist gates collections
    /// @param _baseURI Base URI template for new collections
    /// @param _bondPledges The BurnerBondPledges module every collection's pledged-bond terms run
    /// in (Phase 2e). Deployed on its own and passed in, so its creation code is not inside this
    /// factory's; the bond implementation checks its kind and pins it.
    constructor(address _tokenRegistry, string memory _baseURI, address _bondPledges) {
        require(_tokenRegistry != address(0), "Invalid TokenRegistry address");
        tokenRegistry = ITokenRegistry(_tokenRegistry);
        baseURI = _baseURI;

        // The implementations. Deployed once here, cloned from for every collection after.
        bondImplementation = address(new BurnerBond(_bondPledges));
        depositImplementation = address(new BurnerBondDeposit());
        bondTraits = address(new BondTraits());
        bondDiscountCurve = address(new BondDiscountCurve());

        // The single unified deposit contract, as a clone of the implementation above.
        BurnerBondDeposit deployedDeposit =
            BurnerBondDeposit(Clones.clone(depositImplementation));
        deployedDeposit.initialize(address(this));
        burnerBondDeposit = IBurnerBondDeposit(address(deployedDeposit));

        // Hand it to whoever deployed the factory, as the collections are handed over below.
        // Deploying it here makes the factory its owner, and the factory has no way to forward a
        // call, so every admin function on it -- including emergency recovery -- was unreachable
        // by anybody at all.
        deployedDeposit.transferOwnership(owner());
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
    /// @dev The owner, or the unified deposit contract creating one on a first purchase (audit
    /// X-19). Open to anyone, a stranger could create the reserve token's collection first with
    /// their own name, symbol and description, fixed for good. The deposit contract names a
    /// collection from the token's own metadata, so it cannot be used to squat one.
    function createCollection(
        address tokenAddress,
        string calldata tokenSymbol,
        string calldata tokenName,
        string calldata collectionBaseURI
    ) external override nonReentrant returns (address collectionAddress, address depositContract) {
        require(msg.sender == owner() || msg.sender == address(burnerBondDeposit), "Not allowed to create collections");
        require(tokenAddress != address(0), "Invalid token address");

        require(collections[tokenAddress].collectionAddress == address(0), "Collection already exists");
        require(tokenRegistry.getIsWhitelisted(tokenAddress), "Token not whitelisted");
        
        // Create collection-specific URI
        string memory fullBaseURI = string(abi.encodePacked(collectionBaseURI, "/", tokenSymbol, "/"));
        
        // Create collection-specific metadata
        string memory collectionName = string(abi.encodePacked(tokenName, " BurnerBonds"));
        string memory collectionSymbol = string(abi.encodePacked(tokenSymbol, "-BB"));
        string memory collectionDescription = string(abi.encodePacked("BurnerBond collection backed by ", tokenName, " tokens"));
        
        // Clone the collection implementation and set it up. Token-agnostic as before: any
        // whitelisted token gets its own collection, it just costs a fraction of a deployment.
        BurnerBond newCollection = BurnerBond(Clones.clone(bondImplementation));
        newCollection.initialize(
            address(burnerBondDeposit), // Use unified deposit contract
            address(this), // Factory address (single source of truth for parameters)
            tokenAddress, // Use the token as the underlying token for this collection
            fullBaseURI,
            collectionName,
            collectionSymbol,
            collectionDescription,
            bondTraits,
            bondDiscountCurve
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
    
    /// @notice Set the TokenRegistry whose whitelist gates new collections
    /// @param _tokenRegistry Address of the TokenRegistry
    function setTokenRegistry(address _tokenRegistry) external override onlyOwner {
        require(_tokenRegistry != address(0), "Invalid TokenRegistry address");
        tokenRegistry = ITokenRegistry(_tokenRegistry);
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
    }
    
    /// @notice Set minimum discount percentage
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external override onlyOwner {
        require(_minDiscount < maxDiscount, "Min discount must be less than max discount");
        minDiscount = _minDiscount;
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
    }
    
    /// @notice Update minimum maturity period for all collections
    /// @dev This function updates minimum maturity on both BurnerBond collections and BurnerBondDeposit contracts
    /// @param _minMaturity Minimum maturity period in seconds
    function updateMinMaturity(uint256 _minMaturity) external onlyOwner {
        require(_minMaturity >= 60, "Min maturity too low"); // At least 1 minute
        require(_minMaturity <= maxMaturity, "Min maturity cannot exceed max maturity");
        
        minMaturity = _minMaturity;
    }
    
    /// @notice Emergency function to recover stuck tokens (owner only)
    /// @param token Token address to recover
    /// @param amount Amount to recover
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
}
