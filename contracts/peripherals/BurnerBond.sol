// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../core/interfaces/burner-bond/IBurnerBond.sol";
import "../core/interfaces/burner-bond/IBurnerBondDeposit.sol";
import "../core/interfaces/burner-bond/IBurnerBondFactory.sol";
import "../core/interfaces/stable-credit/IAssurancePool.sol";

/// @title BurnerBond
/// @notice ERC-1155 based bond system that allows users to mint bonds at a discount
/// @dev Bonds are backed by USDC deposited into the AssurancePool excess reserve
contract BurnerBond is IBurnerBond, ERC1155, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;

    /* ========== STATE VARIABLES ========== */
    
    /// @notice Counter for generating unique bond IDs
    Counters.Counter private _bondIdCounter;
    
    /// @notice BurnerBondDeposit contract for financial operations
    IBurnerBondDeposit public burnerBondDeposit;
    
    /// @notice BurnerBondFactory contract (single source of truth for parameters)
    IBurnerBondFactory public factory;
    
    /// @notice AssurancePool contract for USDC deposits and withdrawals
    IAssurancePool public assurancePool;
    
    /// @notice Underlying token contract (can be USDC, WETH, etc.)
    IERC20 public underlyingToken;
    
    /// @notice Collection name (e.g., "WETH BurnerBonds")
    string public collectionName;
    
    /// @notice Collection symbol (e.g., "WETH-BB")
    string public collectionSymbol;
    
    /// @notice Collection description
    string public collectionDescription;
    
    // ============ DISCOUNT CURVE SYSTEM ============
    
    /// @notice Discount curve types
    enum CurveType {
        LINEAR,      // 0: Linear scaling
        BONDING,     // 1: Bonding curve (S-curve)
        LOGARITHMIC, // 2: Logarithmic growth
        CUSTOM       // 3: Custom curve (future implementation)
    }
    
    /// @notice Current discount curve configuration
    CurveType public curveType = CurveType.LINEAR;
    
    /// @notice Curve-specific parameter (exponent, base, etc.)
    uint256 public curveParameter = 10000; // 1.0 for linear, exponent for exponential, etc.
    
    /// @notice Mapping from bond ID to bond information
    mapping(uint256 => BondInfo) public bonds;
    
    /// @notice Mapping from creator to number of bonds created
    mapping(address => uint256) public bondsCreatedBy;
    
    /// @notice Mapping from creator to array of bond IDs they created
    mapping(address => uint256[]) public bondIdsByCreator;
    
    /// @notice Mapping from bond ID to creator (for quick lookup)
    mapping(uint256 => address) public bondCreator;
    
    /// @notice Total bonds minted
    uint256 public totalBondsMinted;
    
    /// @notice Total USDC deposited through bond purchases
    uint256 public totalUSDCDeposited;
    
    /// @notice Total USDC redeemed through bond redemptions
    uint256 public totalUSDCRedeemed;

    // ============ ERC-7496 Trait Storage ============
    /**
     * @dev Mapping from bond ID to trait key to trait value
     * @notice Implements ERC-7496 trait storage for bonds
     */
    mapping(uint256 => mapping(bytes32 => bytes)) private _bondTraits;
    
    /**
     * @dev Mapping from trait key to trait name
     * @notice Used for ERC-7496 trait metadata
     */
    mapping(bytes32 => string) private _traitNames;
    
    /**
     * @dev Array of all possible trait keys
     * @notice Used for ERC-7496 trait enumeration
     */
    bytes32[] private _allTraitKeys;

    /* ========== CONSTRUCTOR ========== */
    
    /// @notice Initialize the BurnerBond contract
    /// @param _burnerBondDeposit Address of the BurnerBondDeposit contract
    /// @param _factory Address of the BurnerBondFactory contract (single source of truth for parameters)
    /// @param _assurancePool Address of the AssurancePool contract
    /// @param _underlyingToken Address of the underlying token (USDC, WETH, etc.)
    /// @param _uri Base URI for ERC-1155 metadata
    /// @param _collectionName Name of the collection
    /// @param _collectionSymbol Symbol of the collection
    /// @param _collectionDescription Description of the collection
    constructor(
        address _burnerBondDeposit,
        address _factory,
        address _assurancePool,
        address _underlyingToken,
        string memory _uri,
        string memory _collectionName,
        string memory _collectionSymbol,
        string memory _collectionDescription
    ) ERC1155(_uri) {
        require(_burnerBondDeposit != address(0), "Invalid BurnerBondDeposit address");
        require(_factory != address(0), "Invalid factory address");
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        require(_underlyingToken != address(0), "Invalid underlying token address");
        
        burnerBondDeposit = IBurnerBondDeposit(_burnerBondDeposit);
        factory = IBurnerBondFactory(_factory);
        assurancePool = IAssurancePool(_assurancePool);
        underlyingToken = IERC20(_underlyingToken);
        collectionName = _collectionName;
        collectionSymbol = _collectionSymbol;
        collectionDescription = _collectionDescription;
        
        // Initialize trait keys and names
        _initializeTraits();
        
        // Start bond ID counter at 1
        _bondIdCounter.increment();
    }

    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get bond information by ID
    /// @param bondId Unique bond identifier
    /// @return BondInfo struct containing all bond details
    function getBondInfo(uint256 bondId) external view override returns (BondInfo memory) {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        return bonds[bondId];
    }
    
    /// @notice Calculate discount percentage based on maturity date (legacy function)
    /// @param maturityDate Unix timestamp for bond maturity
    /// @return Discount percentage in basis points (0-3000 for 0-30%)
    function calculateDiscount(uint256 maturityDate) public view override returns (uint256) {
        return calculateDiscountWithCurve(maturityDate);
    }
    
    /// @notice Calculate discount using the configured curve
    /// @param maturityDate Maturity date for the bond
    /// @return Discount percentage in basis points
    function calculateDiscountWithCurve(uint256 maturityDate) public view override returns (uint256) {
        uint256 currentTime = block.timestamp;
        require(maturityDate > currentTime, "Maturity date must be in the future");
        
        uint256 timeToMaturity = maturityDate - currentTime;
        uint256 minMaturity = factory.getMinMaturity();
        uint256 maxMaturity = factory.getMaxMaturity();
        
        // Ensure maturity is within allowed range
        if (timeToMaturity < minMaturity) {
            return 0; // No discount for very short maturities
        }
        
        if (timeToMaturity > maxMaturity) {
            timeToMaturity = maxMaturity; // Cap at maximum maturity
        }
        
        return getDiscountForMaturity(timeToMaturity);
    }
    
    /// @notice Get discount for a specific maturity period using the configured curve
    /// @param timeToMaturity Time to maturity in seconds
    /// @return Discount percentage in basis points
    function getDiscountForMaturity(uint256 timeToMaturity) public view override returns (uint256) {
        uint256 minMaturity = factory.getMinMaturity();
        uint256 maxMaturity = factory.getMaxMaturity();
        
        if (timeToMaturity < minMaturity) {
            return 0;
        }
        
        if (timeToMaturity > maxMaturity) {
            timeToMaturity = maxMaturity;
        }
        
        // Calculate normalized time (0 to 1)
        uint256 normalizedTime = (timeToMaturity * 1e18) / maxMaturity;
        uint256 maxDiscount = factory.getMaxDiscount();
        uint256 minDiscount = factory.getMinDiscount();
        
        // Calculate the discount range (maxDiscount - minDiscount)
        uint256 discountRange = maxDiscount - minDiscount;
        
        if (curveType == CurveType.LINEAR) {
            // Linear: discount = minDiscount + (normalizedTime * discountRange)
            return minDiscount + (normalizedTime * discountRange) / 1e18;
            
        } else if (curveType == CurveType.BONDING) {
            // Bonding curve (S-curve): discount = minDiscount + discountRange * (1 - (1 - normalizedTime)^steepness)
            // curveParameter is the steepness (e.g., 20000 = 2.0)
            // This creates an S-curve that starts slow, accelerates in the middle, then slows down
            uint256 steepness = curveParameter;
            uint256 oneMinusTime = 1e18 - normalizedTime;
            uint256 poweredOneMinusTime = _power(oneMinusTime, steepness);
            uint256 curveValue = 1e18 - poweredOneMinusTime;
            return minDiscount + (curveValue * discountRange) / 1e18;
            
        } else if (curveType == CurveType.LOGARITHMIC) {
            // Logarithmic: discount = minDiscount + discountRange * log(1 + normalizedTime * (base - 1)) / log(base)
            // curveParameter is the base (e.g., 20000 = 2.0)
            // This creates diminishing returns - discourages longer-term bonds
            uint256 base = curveParameter;
            uint256 logResult = _logarithm(1e18 + (normalizedTime * (base - 1e18)) / 1e18, base);
            uint256 logBase = _logarithm(base, base);
            return minDiscount + (logResult * discountRange) / logBase;
            
        } else {
            // CUSTOM curve - for future implementation
            revert("Custom curve not implemented yet");
        }
    }
    
    /// @notice Calculate purchase price for a bond
    /// @param faceValue Face value of the bond in USDC
    /// @param maturityDate Maturity date of the bond
    /// @return Purchase price in USDC
    function calculatePurchasePrice(uint256 faceValue, uint256 maturityDate) public view override returns (uint256) {
        uint256 discount = calculateDiscount(maturityDate);
        uint256 discountAmount = (faceValue * discount) / 10000; // Convert basis points to percentage
        return faceValue - discountAmount;
    }
    
    /// @notice Check if a bond is mature and can be redeemed
    /// @param bondId Unique bond identifier
    /// @return True if bond is mature
    function isBondMature(uint256 bondId) public view override returns (bool) {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        return block.timestamp >= bonds[bondId].maturityDate;
    }
    
    /// @notice Get total bonds created by an address
    /// @param creator Address to check
    /// @return Number of bonds created
    function getBondsCreatedBy(address creator) external view override returns (uint256) {
        return bondsCreatedBy[creator];
    }
    
    /// @notice Get all bond IDs created by an address
    /// @param creator Address to check
    /// @return Array of bond IDs
    function getBondIdsByCreator(address creator) external view override returns (uint256[] memory) {
        return bondIdsByCreator[creator];
    }
    
    /// @notice Get current discount parameters
    /// @return maxDiscount Maximum discount percentage in basis points
    /// @return maxMaturity Maximum maturity period in seconds
    function getDiscountParameters() external view override returns (uint256, uint256) {
        return (factory.getMaxDiscount(), factory.getMaxMaturity());
    }
    
    /// @notice Get discount curve configuration
    /// @return curveType Type of curve (0=linear, 1=exponential, 2=logarithmic, 3=custom)
    /// @return maxDiscount Maximum discount percentage in basis points
    /// @return maxMaturity Maximum maturity period in seconds
    /// @return curveParameter Curve-specific parameter (exponent, base, etc.)
    function getDiscountCurve() external view override returns (uint8, uint256, uint256, uint256) {
        return (uint8(curveType), factory.getMaxDiscount(), factory.getMaxMaturity(), curveParameter);
    }
    
    /// @notice Set discount curve configuration
    /// @param _curveType Type of curve (0=linear, 1=exponential, 2=logarithmic, 3=custom)
    /// @param _maxDiscount Maximum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    /// @param _curveParameter Curve-specific parameter (exponent, base, etc.)
    function setDiscountCurve(uint8 _curveType, uint256 _maxDiscount, uint256 _maxMaturity, uint256 _curveParameter) external override onlyOwner {
        require(_curveType <= 3, "Invalid curve type");
        require(_maxDiscount <= 5000, "Max discount cannot exceed 50%");
        require(_maxMaturity >= factory.getMinMaturity(), "Max maturity too low");
        require(_maxMaturity <= 50 * 365 * 24 * 60 * 60, "Max maturity too high"); // 50 years max
        
        // Validate curve parameter based on curve type
        if (_curveType == 1) { // BONDING
            require(_curveParameter >= 10000 && _curveParameter <= 50000, "Steepness must be between 1.0 and 5.0");
        } else if (_curveType == 2) { // LOGARITHMIC
            require(_curveParameter >= 15000 && _curveParameter <= 100000, "Base must be between 1.5 and 10.0");
        } else if (_curveType == 0) { // LINEAR
            require(_curveParameter == 10000, "Linear curve parameter must be 1.0");
        }
        
        curveType = CurveType(_curveType);
        curveParameter = _curveParameter;
        // Note: maxDiscount and maxMaturity are now managed by the factory
        
        emit DiscountCurveUpdated(_curveType, _maxDiscount, _maxMaturity, _curveParameter);
    }
    
    /// @notice Get bond statistics
    /// @return totalMinted Total bonds minted
    /// @return totalDeposited Total USDC deposited
    /// @return totalRedeemed Total USDC redeemed
    function getBondStatistics() external view returns (uint256 totalMinted, uint256 totalDeposited, uint256 totalRedeemed) {
        return (totalBondsMinted, totalUSDCDeposited, totalUSDCRedeemed);
    }

    /* ========== TRAIT FUNCTIONS (ERC-7496) ========== */
    
    /// @notice Get a trait value for a bond
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @return Value of the trait
    function getBondTraitValue(uint256 bondId, bytes32 traitKey) external view override returns (bytes memory) {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        return _bondTraits[bondId][traitKey];
    }
    
    /// @notice Get multiple trait values for a bond
    /// @param bondId ID of the bond
    /// @param traitKeys Array of trait keys
    /// @return Array of trait values
    function getBondTraitValues(uint256 bondId, bytes32[] calldata traitKeys) external view override returns (bytes[] memory) {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        bytes[] memory values = new bytes[](traitKeys.length);
        for (uint256 i = 0; i < traitKeys.length; i++) {
            values[i] = _bondTraits[bondId][traitKeys[i]];
        }
        return values;
    }
    
    /// @notice Get all trait keys for a bond that have values
    /// @param bondId ID of the bond
    /// @return Array of trait keys that have values
    function getBondTraitKeys(uint256 bondId) external view override returns (bytes32[] memory) {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        
        bytes32[] memory traitKeys = new bytes32[](_allTraitKeys.length);
        uint256 count;
        
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_bondTraits[bondId][_allTraitKeys[i]].length > 0) {
                traitKeys[count++] = _allTraitKeys[i];
            }
        }
        
        // Resize array to actual count
        assembly {
            mstore(traitKeys, count)
        }
        
        return traitKeys;
    }
    
    /// @notice Get the name of a trait
    /// @param traitKey Key of the trait
    /// @return Name of the trait
    function getBondTraitName(bytes32 traitKey) external view override returns (string memory) {
        return _traitNames[traitKey];
    }
    
    /// @notice Set a trait value for a bond (admin only)
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @param traitValue Value of the trait
    function setBondTrait(uint256 bondId, bytes32 traitKey, bytes memory traitValue) external override onlyOwner {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        _setBondTraitValue(bondId, traitKey, traitValue);
        emit BondTraitUpdated(bondId, traitKey, traitValue);
    }
    
    /// @notice Set a trait value with flexible input types
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait (either bytes32 or string)
    /// @param traitValue Value of the trait (supports various types)
    /// @param valueType Type of the value (0=bytes, 1=string, 2=uint256, 3=bool)
    function setBondTraitFlexible(uint256 bondId, bytes memory traitKey, bytes memory traitValue, uint8 valueType) external override onlyOwner {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        
        // Convert string trait name to bytes32 key if provided as string
        bytes32 key;
        bool isStringKey = false;
        if (traitKey.length == 32) {
            assembly {
                key := mload(add(traitKey, 32))
            }
        } else {
            // Assume it's a string and hash it
            key = keccak256(traitKey);
            isStringKey = true;
        }

        // Handle different value types
        bytes memory value;
        if (valueType == 0) {
            // Direct bytes value
            value = traitValue;
        } else if (valueType == 1) {
            // String value
            value = abi.encode(string(traitValue));
        } else if (valueType == 2) {
            // Numeric value
            value = abi.encode(uint256(bytes32(traitValue)));
        } else if (valueType == 3) {
            // Boolean value
            value = abi.encode(uint256(bytes32(traitValue)) > 0);
        } else {
            revert("Invalid value type");
        }
        
        _setBondTraitValue(bondId, key, value);
        
        // If trait was provided as string, set the trait name automatically
        if (isStringKey) {
            _traitNames[key] = string(traitKey);
        }
        
        emit BondTraitUpdated(bondId, key, value);
    }
    
    /// @notice Remove a trait from a bond
    /// @param bondId ID of the bond
    /// @param traitName Name of the trait to remove
    function removeBondTrait(uint256 bondId, string memory traitName) external override onlyOwner {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        bytes32 traitKey = keccak256(bytes(traitName));
        require(_bondTraits[bondId][traitKey].length > 0, "Trait does not exist");
        
        delete _bondTraits[bondId][traitKey];
        emit BondTraitUpdated(bondId, traitKey, "");
    }
    
    /// @notice Get the metadata URI for traits
    /// @return Base64-encoded JSON schema indicating dynamic trait support
    function getBondTraitMetadataURI() external pure override returns (string memory) {
        // Simple schema indicating dynamic trait support
        return "data:application/json;base64,eyJ0cmFpdHMiOiB7ImR5bmFtaWMiOiB0cnVlfX0=";
    }
    
    /// @notice Get bond type based on maturity date
    /// @param maturityDate Maturity date of the bond
    /// @return Bond type string (short-term, mid-term, or long-term)
    function getBondType(uint256 maturityDate) external view returns (string memory) {
        return _calculateBondType(maturityDate);
    }
    
    /// @notice Get collection name
    /// @return Collection name
    function name() external view returns (string memory) {
        return collectionName;
    }
    
    /// @notice Get collection symbol
    /// @return Collection symbol
    function symbol() external view returns (string memory) {
        return collectionSymbol;
    }
    
    /// @notice Get collection description
    /// @return Collection description
    function description() external view returns (string memory) {
        return collectionDescription;
    }
    
    /// @notice Get underlying token address
    /// @return Address of the underlying token
    function getUnderlyingToken() external view returns (address) {
        return address(underlyingToken);
    }
    
    /// @notice Get collection metadata
    /// @return collectionName_ Collection name
    /// @return collectionSymbol_ Collection symbol
    /// @return collectionDescription_ Collection description
    /// @return underlyingTokenAddress_ Address of underlying token
    /// @return totalSupply_ Total bonds minted
    function getCollectionMetadata() external view returns (
        string memory collectionName_,
        string memory collectionSymbol_,
        string memory collectionDescription_,
        address underlyingTokenAddress_,
        uint256 totalSupply_
    ) {
        return (
            collectionName,
            collectionSymbol,
            collectionDescription,
            address(underlyingToken),
            totalBondsMinted
        );
    }
    
    /// @notice Get contract-level metadata URI (ERC-7572)
    /// @dev Returns JSON metadata for the entire collection
    /// @return Collection metadata URI
    function contractURI() external view returns (string memory) {
        // Return JSON metadata for the collection
        return string(abi.encodePacked(
            'data:application/json;utf8,',
            '{',
                '"name":"', collectionName, '",',
                '"symbol":"', collectionSymbol, '",',
                '"description":"', collectionDescription, '",',
                '"image":"', uri(0), '",',
                '"external_link":"https://protocol.com/collections/', collectionSymbol, '",',
                '"underlying_token":"', _addressToString(address(underlyingToken)), '",',
                '"total_supply":', _uintToString(totalBondsMinted),
            '}'
        ));
    }

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
    ) external override nonReentrant returns (uint256 bondId) {
        // Only BurnerBondDeposit contract can call this function
        require(msg.sender == address(burnerBondDeposit), "Only BurnerBondDeposit can mint");
        
        // Validate inputs using factory parameters
        require(faceValue >= factory.getMinFaceValue(), "Face value too low");
        require(faceValue <= factory.getMaxFaceValue(), "Face value too high");
        require(maturityDate > block.timestamp, "Maturity date must be in the future");
        require(maturityDate <= block.timestamp + factory.getMaxMaturity(), "Maturity date too far in future");
        require(discountPercentage <= factory.getMaxDiscount(), "Discount percentage too high");
        require(creator != address(0), "Invalid creator address");
        
        // Calculate expected discount based on maturity
        uint256 expectedDiscount = calculateDiscount(maturityDate);
        require(discountPercentage <= expectedDiscount, "Discount exceeds maximum for maturity period");
        
        // Calculate purchase price
        uint256 purchasePrice = calculatePurchasePrice(faceValue, maturityDate);
        
        // Generate unique bond ID
        bondId = _bondIdCounter.current();
        _bondIdCounter.increment();
        
        // Store bond information
        bonds[bondId] = BondInfo({
            faceValue: faceValue,
            maturityDate: maturityDate,
            discountPercentage: discountPercentage,
            purchasePrice: purchasePrice,
            isRedeemed: false,
            creator: creator
        });
        
        // Update mappings
        bondsCreatedBy[creator]++;
        bondIdsByCreator[creator].push(bondId);
        bondCreator[bondId] = creator;
        
        // Update statistics
        totalBondsMinted++;
        totalUSDCDeposited += purchasePrice;
        
        // Mint ERC-1155 token to creator
        _mint(creator, bondId, 1, "");
        
        // Set initial traits for the bond
        _setInitialBondTraits(bondId, faceValue, maturityDate, discountPercentage, creator);
        
        emit BondMinted(bondId, creator, faceValue, maturityDate, discountPercentage, purchasePrice);
        
        return bondId;
    }
    
    /// @notice Redeem a mature bond for its face value
    /// @param bondId Unique bond identifier
    function redeemBond(uint256 bondId) external override nonReentrant {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
        require(!bonds[bondId].isRedeemed, "Bond already redeemed");
        require(isBondMature(bondId), "Bond not yet mature");
        
        BondInfo storage bond = bonds[bondId];
        
        // Mark bond as redeemed
        bond.isRedeemed = true;
        
        // Update traits
        _setBondTraitValue(bondId, keccak256("isRedeemed"), abi.encode(true));
        _setBondTraitValue(bondId, keccak256("redeemedAt"), abi.encode(block.timestamp));
        emit BondTraitUpdated(bondId, keccak256("isRedeemed"), abi.encode(true));
        emit BondTraitUpdated(bondId, keccak256("redeemedAt"), abi.encode(block.timestamp));
        
        // Update statistics
        totalUSDCRedeemed += bond.faceValue;
        
        // Burn the ERC-1155 token
        _burn(msg.sender, bondId, 1);
        
        // Withdraw face value from AssurancePool
        assurancePool.withdrawToken(address(underlyingToken), bond.faceValue);
        
        // Transfer underlying token to bond holder
        underlyingToken.safeTransfer(msg.sender, bond.faceValue);
        
        emit BondRedeemed(bondId, msg.sender, bond.faceValue);
    }
    
    /// @notice Batch redeem multiple mature bonds
    /// @param bondIds Array of bond IDs to redeem
    function batchRedeemBonds(uint256[] calldata bondIds) external override nonReentrant {
        require(bondIds.length > 0, "No bonds to redeem");
        require(bondIds.length <= 50, "Too many bonds in batch"); // Gas limit protection
        
        uint256 totalFaceValue = 0;
        
        // Validate all bonds first
        for (uint256 i = 0; i < bondIds.length; i++) {
            uint256 bondId = bondIds[i];
            require(bonds[bondId].creator != address(0), "Bond does not exist");
            require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
            require(!bonds[bondId].isRedeemed, "Bond already redeemed");
            require(isBondMature(bondId), "Bond not yet mature");
            
            totalFaceValue += bonds[bondId].faceValue;
        }
        
        // Process all redemptions
        for (uint256 i = 0; i < bondIds.length; i++) {
            uint256 bondId = bondIds[i];
            BondInfo storage bond = bonds[bondId];
            
            // Mark bond as redeemed
            bond.isRedeemed = true;
            
            // Update traits
            _setBondTraitValue(bondId, keccak256("isRedeemed"), abi.encode(true));
            _setBondTraitValue(bondId, keccak256("redeemedAt"), abi.encode(block.timestamp));
            emit BondTraitUpdated(bondId, keccak256("isRedeemed"), abi.encode(true));
            emit BondTraitUpdated(bondId, keccak256("redeemedAt"), abi.encode(block.timestamp));
            
            // Update statistics
            totalUSDCRedeemed += bond.faceValue;
            
            // Burn the ERC-1155 token
            _burn(msg.sender, bondId, 1);
            
            emit BondRedeemed(bondId, msg.sender, bond.faceValue);
        }
        
        // Withdraw total face value from AssurancePool
        assurancePool.withdrawToken(address(underlyingToken), totalFaceValue);
        
        // Transfer total underlying token to bond holder
        underlyingToken.safeTransfer(msg.sender, totalFaceValue);
    }

    /* ========== ADMIN FUNCTIONS ========== */
    
    /// @notice Update discount calculation parameters (delegates to factory)
    /// @param _maxDiscount Maximum discount percentage in basis points (0-5000)
    /// @param _minDiscount Minimum discount percentage in basis points
    /// @param _maxMaturity Maximum maturity period in seconds
    function updateDiscountParameters(uint256 _maxDiscount, uint256 _minDiscount, uint256 _maxMaturity) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.updateGlobalParameters(_maxDiscount, _minDiscount, _maxMaturity);
    }
    
    /// @notice Set minimum discount percentage (delegates to factory)
    /// @param _minDiscount Minimum discount percentage in basis points
    function setMinDiscount(uint256 _minDiscount) external override onlyOwner {
        // Delegate to factory - this ensures consistency across all collections
        factory.setMinDiscount(_minDiscount);
    }
    
    /// @notice Set the AssurancePool contract address
    /// @param _assurancePool Address of the AssurancePool contract
    function setAssurancePool(address _assurancePool) external override onlyOwner {
        require(_assurancePool != address(0), "Invalid AssurancePool address");
        assurancePool = IAssurancePool(_assurancePool);
    }
    
    /// @notice Set the underlying token address
    /// @param _underlyingToken Address of the underlying token
    function setUnderlyingToken(address _underlyingToken) external onlyOwner {
        require(_underlyingToken != address(0), "Invalid underlying token address");
        underlyingToken = IERC20(_underlyingToken);
    }
    
    /// @notice Set the BurnerBondDeposit contract address
    /// @param _burnerBondDeposit Address of the BurnerBondDeposit contract
    function setBurnerBondDeposit(address _burnerBondDeposit) external onlyOwner {
        require(_burnerBondDeposit != address(0), "Invalid BurnerBondDeposit address");
        burnerBondDeposit = IBurnerBondDeposit(_burnerBondDeposit);
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
        require(token != address(underlyingToken), "Cannot recover underlying token");
        IERC20(token).safeTransfer(owner(), amount);
    }
    
    /// @notice Update the base URI for ERC-1155 metadata
    /// @param newuri New base URI
    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);
    }
    
    /// @notice Check if contract supports an interface
    /// @param interfaceId Interface identifier
    /// @return True if the interface is supported
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, IERC165) returns (bool) {
        return 
            interfaceId == 0xaf332f3e || // ERC-7496 (Dynamic Traits)
            super.supportsInterface(interfaceId);
    }

    /* ========== INTERNAL FUNCTIONS ========== */
    
    /// @notice Override to prevent transfers of redeemed bonds and update current holder trait
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
        
        // Prevent transfers of redeemed bonds and update current holder trait
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 bondId = ids[i];
            
            // Prevent transfers of redeemed bonds
            if (bonds[bondId].isRedeemed) {
                revert("Cannot transfer redeemed bond");
            }
            
            // Update current holder trait on transfers (not minting or burning)
            if (from != address(0) && to != address(0)) {
                _setBondTraitValue(bondId, keccak256("currentHolder"), abi.encode(to));
                emit BondTraitUpdated(bondId, keccak256("currentHolder"), abi.encode(to));
            }
        }
    }
    
    /// @notice Initialize trait keys and names
    function _initializeTraits() private {
        // Initialize trait keys and names in one go
        _allTraitKeys = [
            keccak256("faceValue"),
            keccak256("maturityDate"),
            keccak256("discountPercentage"),
            keccak256("purchasePrice"),
            keccak256("creator"),
            keccak256("currentHolder"),
            keccak256("isRedeemed"),
            keccak256("terms"),
            keccak256("bondType"),
            keccak256("issuer"),
            keccak256("createdAt"),
            keccak256("redeemedAt")
        ];
        
        // Map trait keys to names
        _traitNames[keccak256("faceValue")] = "Face Value";
        _traitNames[keccak256("maturityDate")] = "Maturity Date";
        _traitNames[keccak256("discountPercentage")] = "Discount Percentage";
        _traitNames[keccak256("purchasePrice")] = "Purchase Price";
        _traitNames[keccak256("creator")] = "Creator";
        _traitNames[keccak256("currentHolder")] = "Current Holder";
        _traitNames[keccak256("isRedeemed")] = "Is Redeemed";
        _traitNames[keccak256("terms")] = "Terms";
        _traitNames[keccak256("bondType")] = "Bond Type";
        _traitNames[keccak256("issuer")] = "Issuer";
        _traitNames[keccak256("createdAt")] = "Created At";
        _traitNames[keccak256("redeemedAt")] = "Redeemed At";
    }
    
    /// @notice Set initial traits for a newly minted bond
    /// @param bondId ID of the bond
    /// @param faceValue Face value of the bond
    /// @param maturityDate Maturity date of the bond
    /// @param discountPercentage Discount percentage
    /// @param creator Address that created the bond
    function _setInitialBondTraits(
        uint256 bondId,
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage,
        address creator
    ) internal {
        // Set core bond traits
        _setBondTraitValue(bondId, keccak256("faceValue"), abi.encode(faceValue));
        _setBondTraitValue(bondId, keccak256("maturityDate"), abi.encode(maturityDate));
        _setBondTraitValue(bondId, keccak256("discountPercentage"), abi.encode(discountPercentage));
        _setBondTraitValue(bondId, keccak256("purchasePrice"), abi.encode(calculatePurchasePrice(faceValue, maturityDate)));
        _setBondTraitValue(bondId, keccak256("creator"), abi.encode(creator));
        _setBondTraitValue(bondId, keccak256("currentHolder"), abi.encode(creator));
        _setBondTraitValue(bondId, keccak256("isRedeemed"), abi.encode(false));
        // Calculate bond type based on maturity period
        string memory bondType = _calculateBondType(maturityDate);
        _setBondTraitValue(bondId, keccak256("bondType"), abi.encode(bondType));
        _setBondTraitValue(bondId, keccak256("issuer"), abi.encode(address(this)));
        _setBondTraitValue(bondId, keccak256("createdAt"), abi.encode(block.timestamp));
        
        // Set default terms (can be updated later)
        _setBondTraitValue(bondId, keccak256("terms"), abi.encode("Standard BurnerBond Terms"));
    }
    
    /// @notice Calculate bond type based on maturity period
    /// @param maturityDate Maturity date of the bond
    /// @return Bond type string (short-term, mid-term, or long-term)
    function _calculateBondType(uint256 maturityDate) internal view returns (string memory) {
        uint256 currentTime = block.timestamp;
        uint256 timeToMaturity = maturityDate - currentTime;
        
        // Define time periods in seconds
        uint256 oneYear = 365 * 24 * 60 * 60;        // 1 year
        uint256 fifteenYears = 15 * 365 * 24 * 60 * 60; // 15 years
        
        if (timeToMaturity < oneYear) {
            return "short-term";
        } else if (timeToMaturity < fifteenYears) {
            return "mid-term";
        } else {
            return "long-term";
        }
    }
    
    /// @notice Set a trait value for a bond
    /// @param bondId ID of the bond
    /// @param traitKey Key of the trait
    /// @param traitValue Value of the trait
    function _setBondTraitValue(uint256 bondId, bytes32 traitKey, bytes memory traitValue) internal {
        // Add trait key if it doesn't exist (optimized check)
        for (uint i = 0; i < _allTraitKeys.length; i++) {
            if (_allTraitKeys[i] == traitKey) {
                _bondTraits[bondId][traitKey] = traitValue;
                return;
            }
        }
        _allTraitKeys.push(traitKey);
        _bondTraits[bondId][traitKey] = traitValue;
    }
    
    /// @notice Calculate power function for exponential curves
    /// @param base Base number (with 18 decimals)
    /// @param exponent Exponent (with 18 decimals)
    /// @return Result (with 18 decimals)
    function _power(uint256 base, uint256 exponent) internal pure returns (uint256) {
        if (exponent == 0) return 1e18;
        if (exponent == 1e18) return base;
        if (base == 0) return 0;
        
        // Handle common cases efficiently
        if (exponent == 2e18) {
            return (base * base) / 1e18;
        }
        if (exponent == 3e18) {
            return (base * base * base) / (1e18 * 1e18);
        }
        if (exponent == 4e18) {
            uint256 baseSquared = (base * base) / 1e18;
            return (baseSquared * baseSquared) / 1e18;
        }
        
        // For other cases, use binary exponentiation
        // Convert exponent to integer for calculation
        uint256 intExponent = exponent / 1e18;
        require(intExponent <= 10, "Exponent too large for approximation");
        
        uint256 result = 1e18;
        uint256 currentBase = base;
        uint256 currentExponent = intExponent;
        
        while (currentExponent > 0) {
            if (currentExponent % 2 == 1) {
                result = (result * currentBase) / 1e18;
            }
            currentBase = (currentBase * currentBase) / 1e18;
            currentExponent = currentExponent / 2;
        }
        
        return result;
    }
    
    /// @notice Calculate logarithm function for logarithmic curves
    /// @param value Value to take logarithm of (with 18 decimals)
    /// @param base Base of the logarithm (with 18 decimals)
    /// @return Result (with 18 decimals)
    function _logarithm(uint256 value, uint256 base) internal pure returns (uint256) {
        require(value > 0, "Logarithm of zero or negative number");
        require(base > 1e18, "Logarithm base must be greater than 1");
        
        if (value == 1e18) return 0;
        if (value == base) return 1e18;
        
        // For base 2, use a more accurate approximation
        if (base == 2e18) {
            // log₂(x) approximation using natural logarithm
            // log₂(x) = ln(x) / ln(2) ≈ (x - 1) * 1.4427 for x close to 1
            if (value < 2e18) {
                // For values between 1 and 2, use linear approximation
                uint256 xMinusOne = value - 1e18;
                return (xMinusOne * 14427) / 10000; // 1.4427 * (x - 1)
            } else if (value < 4e18) {
                // For values between 2 and 4, use interpolation
                return 1e18 + (value - 2e18) / 2e18; // 1 + (x-2)/2
            } else if (value < 8e18) {
                // For values between 4 and 8, use interpolation
                return 2e18 + (value - 4e18) / 4e18; // 2 + (x-4)/4
            } else if (value < 16e18) {
                // For values between 8 and 16, use interpolation
                return 3e18 + (value - 8e18) / 8e18; // 3 + (x-8)/8
            } else if (value < 32e18) {
                // For values between 16 and 32, use interpolation
                return 4e18 + (value - 16e18) / 16e18; // 4 + (x-16)/16
            } else if (value < 64e18) {
                // For values between 32 and 64, use interpolation
                return 5e18 + (value - 32e18) / 32e18; // 5 + (x-32)/32
            } else if (value < 128e18) {
                // For values between 64 and 128, use interpolation
                return 6e18 + (value - 64e18) / 64e18; // 6 + (x-64)/64
            } else if (value < 256e18) {
                // For values between 128 and 256, use interpolation
                return 7e18 + (value - 128e18) / 128e18; // 7 + (x-128)/128
            } else if (value < 512e18) {
                // For values between 256 and 512, use interpolation
                return 8e18 + (value - 256e18) / 256e18; // 8 + (x-256)/256
            } else if (value < 1024e18) {
                // For values between 512 and 1024, use interpolation
                return 9e18 + (value - 512e18) / 512e18; // 9 + (x-512)/512
            } else {
                // For larger values, use binary search
                uint256 lowSearch = 0;
                uint256 highSearch = 1e18 * 10;
                uint256 precisionSearch = 1e12;
                
                while (highSearch - lowSearch > precisionSearch) {
                    uint256 mid = (lowSearch + highSearch) / 2;
                    uint256 powerResult = _power(base, mid);
                    
                    if (powerResult == value) {
                        return mid;
                    } else if (powerResult < value) {
                        lowSearch = mid;
                    } else {
                        highSearch = mid;
                    }
                }
                
                return (lowSearch + highSearch) / 2;
            }
        }
        
        // For other bases, use binary search
        uint256 low = 0;
        uint256 high = 1e18 * 10;
        uint256 precision = 1e12;
        
        while (high - low > precision) {
            uint256 mid = (low + high) / 2;
            uint256 powerResult = _power(base, mid);
            
            if (powerResult == value) {
                return mid;
            } else if (powerResult < value) {
                low = mid;
            } else {
                high = mid;
            }
        }
        
        return (low + high) / 2;
    }
    
    /// @notice Convert address to string
    /// @param _addr Address to convert
    /// @return String representation of address
    function _addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3+i*2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }
    
    /// @notice Convert uint to string
    /// @param _i Uint to convert
    /// @return String representation of uint
    function _uintToString(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k-1;
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }
}
