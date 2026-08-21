// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "../core/interfaces/burner-bond/IBurnerBond.sol";
import "../core/interfaces/burner-bond/IBurnerBondDeposit.sol";
import "../core/interfaces/burner-bond/IBurnerBondFactory.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../core/interfaces/stable-credit/IAssurancePool.sol";

/// @title BurnerBond
/// @notice ERC-1155 based bond system that allows users to mint bonds at a discount
/// @dev Bonds are backed by USDC deposited into the AssurancePool excess reserve
interface IBondTraitStore {
    function setTrait(uint256 bondId, bytes32 key, bytes calldata value) external;
    function setTraits(uint256 bondId, bytes32[] calldata keys, bytes[] calldata values) external;
    function setCustomName(bytes32 key, string calldata name) external;
    function removeTrait(uint256 bondId, bytes32 key) external;
    function traitOf(address collection, uint256 bondId, bytes32 key)
        external view returns (bytes memory);
    function traitsOf(address collection, uint256 bondId, bytes32[] calldata keys)
        external view returns (bytes[] memory);
    function keysOf(address collection, uint256 bondId) external view returns (bytes32[] memory);
    function nameOf(address collection, bytes32 key) external view returns (string memory);
}

interface IBondVaultSettlement {
    function settle(uint256 bondId, address to) external returns (uint256);
    function settleEarly(uint256 bondId, address to, uint256 presentValue) external;
    function roll(uint256 oldBondId, uint256 newBondId, uint256 newFaceValue, uint64 newMaturity)
        external;
}

contract BurnerBond is
    Initializable,
    ERC1155Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IBurnerBond
{
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

    /// @notice Where the money to redeem a bond comes from.
    /// @dev The vault, never the AssurancePool. A bondholder is a creditor and must not be
    /// exposed to how the credit book is performing.
    IBondVaultSettlement public bondVault;

    /// @notice May take a pledged bond, and redeem one before it matures.
    /// @dev Both restricted to the co-op or a contract acting for it. Early redemption exists so
    /// a defaulted position can be covered without waiting out the term, not so a holder can
    /// change their mind -- a bond anyone could exit early is not a term instrument.
    address public liquidator;

    /// @notice Bonds their holder has asked to be paid out rather than rolled at maturity.
    mapping(uint256 => bool) public autoRollOptedOut;

    /// @notice How long a rolled bond runs for.
    uint256 public rollTerm;

    event AutoRollOptOutSet(uint256 indexed bondId, bool optedOut);
    event BondRolled(uint256 indexed oldBondId, uint256 indexed newBondId, uint256 rolledValue);
    event BondSeized(uint256 indexed bondId, address indexed from, address indexed to);
    event RedeemedEarly(uint256 indexed bondId, address indexed holder, uint256 presentValue);
    event LiquidatorUpdated(address indexed liquidator);
    
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
    /// @notice Where a bond's metadata lives.
    /// @dev Not here. All of it is display and none of it decides whether a bond can be issued or
    /// redeemed, and this contract had reached the size a contract may be -- so it sheds what it
    /// does not need to be correct before it sheds anything it does.
    IBondTraitStore public traitStore;
    
    /**
     * @dev Mapping from trait key to trait name
     * @notice Used for ERC-7496 trait metadata
     */
    
    /**
     * @dev Array of all possible trait keys
     * @notice Used for ERC-7496 trait enumeration
     */

    /* ========== CONSTRUCTOR ========== */
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice sets a collection up.
    /// @param _burnerBondDeposit Address of the BurnerBondDeposit contract
    /// @param _factory Address of the parameter source
    /// @param _assurancePool Address of the AssurancePool contract
    /// @param _underlyingToken Address of the underlying token
    /// @param _uri Base URI for ERC-1155 metadata
    /// @param _collectionName Name of the collection
    /// @param _collectionSymbol Symbol of the collection
    /// @param _collectionDescription Description of the collection
    /// @dev An initializer rather than a constructor, so a collection can be a cheap copy of one
    /// implementation instead of a fresh deployment of the whole contract. The factory used to
    /// carry a copy of everything here inside its own bytecode, which is what put it past the
    /// deployable limit; a clone carries a pointer instead.
    function initialize(
        address _burnerBondDeposit,
        address _factory,
        address _assurancePool,
        address _underlyingToken,
        string memory _uri,
        string memory _collectionName,
        string memory _collectionSymbol,
        string memory _collectionDescription,
        address _traitStore
    ) external initializer {
        __ERC1155_init(_uri);
        __Ownable_init();
        __ReentrancyGuard_init();

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
        traitStore = IBondTraitStore(_traitStore);
        rollTerm = 365 days;
        
        
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
    
    /// @inheritdoc IBurnerBond
    function getBondTraitValue(uint256 bondId, bytes32 traitKey)
        external view override returns (bytes memory)
    {
        return traitStore.traitOf(address(this), bondId, traitKey);
    }

    /// @inheritdoc IBurnerBond
    function getBondTraitValues(uint256 bondId, bytes32[] calldata traitKeys)
        external view override returns (bytes[] memory)
    {
        return traitStore.traitsOf(address(this), bondId, traitKeys);
    }

    /// @inheritdoc IBurnerBond
    function getBondTraitKeys(uint256 bondId) external view override returns (bytes32[] memory) {
        return traitStore.keysOf(address(this), bondId);
    }

    /// @inheritdoc IBurnerBond
    function getBondTraitName(bytes32 traitKey) external view override returns (string memory) {
        return traitStore.nameOf(address(this), traitKey);
    }

    /// @inheritdoc IBurnerBond
    function setBondTrait(uint256 bondId, bytes32 traitKey, bytes memory traitValue)
        external override onlyOwner
    {
        traitStore.setTrait(bondId, traitKey, traitValue);
        emit BondTraitUpdated(bondId, traitKey, traitValue);
    }

    /// @inheritdoc IBurnerBond
    /// @dev The key may arrive as a hash or as the string behind one. A string is hashed and its
    /// name recorded, so a trait added later reads back with the name it was given.
    function setBondTraitFlexible(
        uint256 bondId,
        bytes memory traitKey,
        bytes memory traitValue,
        uint8 valueType
    ) external override onlyOwner {
        bytes32 key;
        if (traitKey.length == 32) {
            key = abi.decode(traitKey, (bytes32));
        } else {
            key = keccak256(traitKey);
            traitStore.setCustomName(key, string(traitKey));
        }

        bytes memory value;
        if (valueType == 1) value = abi.encode(string(traitValue));
        else if (valueType == 2) value = abi.encode(uint256(bytes32(traitValue)));
        else if (valueType == 3) value = abi.encode(uint256(bytes32(traitValue)) > 0);
        else value = traitValue;

        traitStore.setTrait(bondId, key, value);
        emit BondTraitUpdated(bondId, key, value);
    }

    /// @inheritdoc IBurnerBond
    function removeBondTrait(uint256 bondId, string memory traitName) external override onlyOwner {
        traitStore.removeTrait(bondId, keccak256(bytes(traitName)));
    }

    /// @inheritdoc IBurnerBond
    function getBondTraitMetadataURI() external pure override returns (string memory) {
        return "data:application/json;base64,eyJ0cmFpdHMiOiB7ImR5bmFtaWMiOiB0cnVlfX0=";
    }

    /// @notice How long a bond runs for, in words.
    /// @dev Kept as a view rather than a stored trait. It is derivable from the maturity date the
    /// bond already carries, and storing a description of a number next to the number is how a
    /// contract ends up too large to deploy.
    /// @param maturityDate Maturity date of the bond
    /// @return Bond type string (short-term, mid-term, or long-term)
    function getBondType(uint256 maturityDate) external view returns (string memory) {
        uint256 term = maturityDate > block.timestamp ? maturityDate - block.timestamp : 0;
        if (term <= 180 days) return "short-term";
        if (term <= 540 days) return "mid-term";
        return "long-term";
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
        
        bondId = _issue(faceValue, maturityDate, discountPercentage, purchasePrice, creator);
        totalUSDCDeposited += purchasePrice;
        emit BondMinted(bondId, creator, faceValue, maturityDate, discountPercentage, purchasePrice);
        return bondId;
    }

    /// @notice Creates a bond and hands it to somebody.
    /// @dev One path for a purchase and for a roll. They were the same twenty lines twice over,
    /// and duplicated logic stays duplicated only until somebody edits one of them.
    function _issue(
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage,
        uint256 purchasePrice,
        address holder
    ) internal returns (uint256 bondId) {
        bondId = _bondIdCounter.current();
        _bondIdCounter.increment();

        bonds[bondId] = BondInfo({
            faceValue: faceValue,
            maturityDate: maturityDate,
            discountPercentage: discountPercentage,
            purchasePrice: purchasePrice,
            isRedeemed: false,
            creator: holder
        });

        bondsCreatedBy[holder]++;
        bondIdsByCreator[holder].push(bondId);
        bondCreator[bondId] = holder;
        totalBondsMinted++;

        _mint(holder, bondId, 1, "");
        _setInitialBondTraits(bondId, faceValue, maturityDate, discountPercentage, holder);
    }
    
    /// @notice Redeem a mature bond for its face value
    /// @param bondId Unique bond identifier
    function redeemBond(uint256 bondId) external override nonReentrant {
        _redeem(bondId);
    }

    /// @notice Batch redeem multiple mature bonds
    /// @param bondIds Array of bond IDs to redeem
    function batchRedeemBonds(uint256[] calldata bondIds) external override nonReentrant {
        require(bondIds.length > 0, "No bonds to redeem");
        require(bondIds.length <= 50, "Too many bonds in batch"); // Gas limit protection
        for (uint256 i = 0; i < bondIds.length; i++) {
            _redeem(bondIds[i]);
        }
    }

    /// @notice Redeems one bond: checks it, retires it, and pays the holder.
    /// @dev One path for both entry points. They used to be two copies of the same twenty lines,
    /// which is how the batch version came to burn bonds and pay nobody -- the single version was
    /// changed to settle from the vault and its twin was not. Duplicated logic does not stay
    /// duplicated; it stays only until somebody edits one of them.
    /// @param bondId Unique bond identifier
    function _redeem(uint256 bondId) internal {
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
        require(!bonds[bondId].isRedeemed, "Bond already redeemed");
        require(isBondMature(bondId), "Bond not yet mature");

        BondInfo storage bond = bonds[bondId];
        bond.isRedeemed = true;

        bytes memory redeemedFlag = abi.encode(true);
        bytes memory redeemedAt = abi.encode(block.timestamp);
        _setBondTraitValue(bondId, keccak256("isRedeemed"), redeemedFlag);
        _setBondTraitValue(bondId, keccak256("redeemedAt"), redeemedAt);
        emit BondTraitUpdated(bondId, keccak256("isRedeemed"), redeemedFlag);
        emit BondTraitUpdated(bondId, keccak256("redeemedAt"), redeemedAt);

        totalUSDCRedeemed += bond.faceValue;
        _burn(msg.sender, bondId, 1);

        // Paid out of the bond vault, which holds the proceeds and nothing else's. Redemption
        // does not compete with default coverage, and cannot fail because the credit book had a
        // bad quarter.
        bondVault.settle(bondId, msg.sender);

        emit BondRedeemed(bondId, msg.sender, bond.faceValue);
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
    
    /* ========== COLLATERAL ========== */

    /// @notice what a bond is worth today, rather than at maturity.
    /// @dev A zero-coupon bond accretes from what was paid for it toward what it will pay,
    /// straight-line across its term. Half way through, half the discount has been earned.
    ///
    /// This is the number a bond is worth as collateral, and the number the co-op gets if it
    /// takes one early. Paying face for a bond that has not matured would hand over interest
    /// nobody has waited for.
    /// @param bondId the bond
    /// @return the bond's value now
    function presentValueOf(uint256 bondId) public view returns (uint256) {
        BondInfo storage bond = bonds[bondId];
        if (bond.creator == address(0) || bond.isRedeemed) return 0;
        if (block.timestamp >= bond.maturityDate) return bond.faceValue;

        uint256 issuedAt = bond.maturityDate > rollTerm ? bond.maturityDate - rollTerm : 0;
        // Fall back to face if the term cannot be reconstructed, which over-values rather than
        // under-values and so cannot cheat the holder.
        if (block.timestamp <= issuedAt) return bond.purchasePrice;

        uint256 elapsed = block.timestamp - issuedAt;
        uint256 term = bond.maturityDate - issuedAt;
        uint256 earned = ((bond.faceValue - bond.purchasePrice) * elapsed) / term;
        return bond.purchasePrice + earned;
    }

    /// @notice takes a pledged bond and hands it to the co-op.
    /// @dev A bond is one token with an id, not a balance, so seizing it is a transfer of that
    /// id rather than an amount. The caller decides whether a default has happened; this only
    /// enforces who may ask.
    /// @param bondId the bond
    /// @param from the member it is taken from
    /// @param to where it goes, which should be the co-op treasury
    function seizeBond(uint256 bondId, address from, address to) external {
        require(msg.sender == liquidator, "Only liquidator can seize");
        require(balanceOf(from, bondId) > 0, "Not bond holder");
        _safeTransferFrom(from, to, bondId, 1, "");
        emit BondSeized(bondId, from, to);
    }

    /// @notice pays out a bond before it matures, at what it is worth today.
    /// @dev Only the co-op, and only through the liquidator. A bond taken from a defaulted member
    /// is collateral somebody is waiting on, and waiting out the term would put the recovery
    /// months away -- the whole reason asset-backed collateral is haircut is that realising it is
    /// not free. Paying present value rather than face is what makes it not free: the vault keeps
    /// the interest the term did not run for.
    /// @param bondId the bond
    /// @return presentValue what was paid
    function redeemEarly(uint256 bondId) external nonReentrant returns (uint256 presentValue) {
        require(msg.sender == liquidator, "Only liquidator can redeem early");
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
        require(!bonds[bondId].isRedeemed, "Bond already redeemed");

        presentValue = presentValueOf(bondId);
        bonds[bondId].isRedeemed = true;
        totalUSDCRedeemed += presentValue;
        _burn(msg.sender, bondId, 1);

        bondVault.settleEarly(bondId, msg.sender, presentValue);
        emit RedeemedEarly(bondId, msg.sender, presentValue);
    }

    /// @notice whether a bond will roll when it matures.
    function willAutoRoll(uint256 bondId) public view returns (bool) {
        return !autoRollOptedOut[bondId] && !bonds[bondId].isRedeemed;
    }

    /// @notice asks for the cash at maturity instead of a replacement bond.
    /// @dev The holder's call, not the co-op's. Rolling is the default because letting a pledged
    /// bond lapse quietly contracts somebody's credit line, but a holder who wants their money
    /// should not have to argue for it.
    function setAutoRollOptOut(uint256 bondId, bool optOut) external {
        require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
        autoRollOptedOut[bondId] = optOut;
        emit AutoRollOptOutSet(bondId, optOut);
    }

    /// @notice replaces a matured bond with a new one of the same value.
    /// @dev The matured value buys the replacement, so the new face value is larger: the same
    /// money bought at a discount again. No cash leaves the vault and the collateral behind the
    /// position never lapses, which is the point.
    ///
    /// The co-op cannot roll a bond it has taken. A seized bond is collateral somebody is waiting
    /// on, and rolling it would put that recovery another term away -- so a bond held by the
    /// liquidator is redeemed early instead, which is what that path is for.
    /// @param bondId the matured bond
    /// @return newBondId the replacement
    function rollBond(uint256 bondId) external nonReentrant returns (uint256 newBondId) {
        require(msg.sender != liquidator, "Seized bonds are redeemed, not rolled");
        require(bonds[bondId].creator != address(0), "Bond does not exist");
        require(balanceOf(msg.sender, bondId) > 0, "Not bond holder");
        require(isBondMature(bondId), "Bond not yet mature");
        require(willAutoRoll(bondId), "Bond opted out of rolling");

        uint256 rolledValue = bonds[bondId].faceValue;
        uint256 newMaturity = block.timestamp + rollTerm;
        uint256 discount = calculateDiscount(newMaturity);
        uint256 newFaceValue = (rolledValue * 10000) / (10000 - discount);

        bonds[bondId].isRedeemed = true;
        _burn(msg.sender, bondId, 1);

        newBondId = _issue(newFaceValue, newMaturity, discount, rolledValue, msg.sender);
        bondVault.roll(bondId, newBondId, newFaceValue, uint64(newMaturity));
        emit BondRolled(bondId, newBondId, rolledValue);
    }

    /// @notice sets how long a rolled bond runs for.
    function setRollTerm(uint256 _rollTerm) external onlyOwner {
        require(_rollTerm >= factory.getMinMaturity(), "Roll term too short");
        require(_rollTerm <= factory.getMaxMaturity(), "Roll term too long");
        rollTerm = _rollTerm;
    }

    /// @notice names the contract that may seize and redeem early.
    function setLiquidator(address _liquidator) external onlyOwner {
        liquidator = _liquidator;
        emit LiquidatorUpdated(_liquidator);
    }

    /// @notice sets the vault redemptions are paid from.
    /// @dev Without this a collection can be created but never redeem, because the vault it pays
    /// out of would be the zero address. Ownership of a new collection passes to the factory
    /// owner, so this is theirs to call once the vault exists.
    /// @param _bondVault Address of the BondVault contract
    function setBondVault(address _bondVault) external onlyOwner {
        require(_bondVault != address(0), "Invalid BondVault address");
        bondVault = IBondVaultSettlement(_bondVault);
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
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155Upgradeable, IERC165Upgradeable) returns (bool) {
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
            
            // Prevent transfers of redeemed bonds -- but not their destruction. Redemption marks
            // the bond redeemed and then burns it, and a burn is a transfer to the zero address,
            // so a check that did not make this distinction refused the second half of the
            // operation the first half had just committed to. The instrument could take money in
            // and had no reachable way to pay it out.
            if (bonds[bondId].isRedeemed && to != address(0)) {
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
    /// @notice Records what a bond is, for anything that wants to show it to somebody.
    /// @dev Written in one call rather than a dozen, and written somewhere else -- see traitStore.
    function _setInitialBondTraits(
        uint256 bondId,
        uint256 faceValue,
        uint256 maturityDate,
        uint256 discountPercentage,
        address creator
    ) internal {
        bytes32[] memory keys = new bytes32[](8);
        bytes[] memory vals = new bytes[](8);
        keys[0] = keccak256("faceValue");
        vals[0] = abi.encode(faceValue);
        keys[1] = keccak256("maturityDate");
        vals[1] = abi.encode(maturityDate);
        keys[2] = keccak256("discountPercentage");
        vals[2] = abi.encode(discountPercentage);
        keys[3] = keccak256("purchasePrice");
        vals[3] = abi.encode(calculatePurchasePrice(faceValue, maturityDate));
        keys[4] = keccak256("creator");
        vals[4] = abi.encode(creator);
        keys[5] = keccak256("currentHolder");
        vals[5] = abi.encode(creator);
        keys[6] = keccak256("isRedeemed");
        vals[6] = abi.encode(false);
        keys[7] = keccak256("createdAt");
        vals[7] = abi.encode(block.timestamp);
        traitStore.setTraits(bondId, keys, vals);
    }

    /// @notice Records one trait against a bond.
    function _setBondTraitValue(uint256 bondId, bytes32 traitKey, bytes memory traitValue)
        internal
    {
        traitStore.setTrait(bondId, traitKey, traitValue);
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
