// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../core/interfaces/burner-bond/IBurnerBond.sol";
import "./BurnerBondBase.sol";
import "./IExtensionKind.sol";

/// @title BurnerBond
/// @notice ERC-1155 based bond system that allows users to mint bonds at a discount
/// @dev Bonds are backed by the proceeds held in the BondVault, never the AssurancePool.
///
/// Storage is BurnerBondBase's. The pledged-bond terms -- `payPledged` (IV-01 §4.9) and the pledged
/// maturity split in `settle` (MB-05 §5.6) -- run in BurnerBondPledges, a delegatecall module this
/// implementation pins in its constructor, because the collection had no room for them.
contract BurnerBond is BurnerBondBase, IBurnerBond {
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;

    /// @notice Where `payPledged` and `settle` run (BurnerBondPledges). Fixed for the life of this
    /// implementation, and so for every collection cloned from it.
    address public immutable pledges;

    /// @notice How long a new liquidator waits between being proposed and taking effect (audit M-6).
    /// @dev The liquidator is the pledge module's enforcement side for every pledged bond, so naming
    /// one is a power over every pledged bondholder; a week gives them time to see it coming.
    uint256 internal constant LIQUIDATOR_DELAY = 7 days;

    error BurnerBondLiquidatorNotReady(uint256 readyAt);
    error BurnerBondModuleMismatch();

    /// @notice Current discount curve shape (0=linear, 1=bonding, 2=logarithmic, 3=custom).
    function curveType() public view returns (uint8) {
        (uint8 t,) = discountCurveEngine.curveOf(address(this));
        return t;
    }

    /// @notice Curve-specific parameter (steepness, base, etc.).
    function curveParameter() public view returns (uint256) {
        (, uint256 p) = discountCurveEngine.curveOf(address(this));
        return p;
    }

    /* ========== CONSTRUCTOR ========== */
    
    /// @dev The pledge module is deployed on its own and passed in: creating it here would put its
    /// creation code inside this contract's, and so inside the factory's. It is checked for its kind
    /// and fixed for the life of this implementation, so no role can swap the code that pays a
    /// pledged bond.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address pledges_) {
        _disableInitializers();
        if (IExtensionKind(pledges_).extensionKind() != keccak256("BurnerBondPledges.v1")) {
            revert BurnerBondModuleMismatch();
        }
        pledges = pledges_;
    }

    /// @notice sets a collection up.
    /// @param _burnerBondDeposit Address of the BurnerBondDeposit contract
    /// @param _factory Address of the parameter source
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
        address _underlyingToken,
        string memory _uri,
        string memory _collectionName,
        string memory _collectionSymbol,
        string memory _collectionDescription,
        address _traitStore,
        address _discountCurve
    ) external initializer {
        __ERC1155_init(_uri);
        __Ownable_init();
        __ReentrancyGuard_init();

        require(_burnerBondDeposit != address(0), "Invalid BurnerBondDeposit address");
        require(_factory != address(0), "Invalid factory address");
        require(_underlyingToken != address(0), "Invalid underlying token address");
        
        burnerBondDeposit = IBurnerBondDeposit(_burnerBondDeposit);
        factory = IBurnerBondFactory(_factory);
        underlyingToken = IERC20(_underlyingToken);
        collectionName = _collectionName;
        collectionSymbol = _collectionSymbol;
        collectionDescription = _collectionDescription;
        traitStore = IBondTraitStore(_traitStore);
        discountCurveEngine = IBondDiscountCurve(_discountCurve);
        rollTerm = 365 days;
        
        
        // Start bond ID counter at 1
        _bondIdCounter.increment();
    }

    /* ========== VIEW FUNCTIONS ========== */
    
    /// @notice Get bond information by ID
    /// @param bondId Unique bond identifier
    /// @return BondInfo struct containing all bond details
    function getBondInfo(uint256 bondId) external view override returns (IBurnerBond.BondInfo memory) {
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
        return discountCurveEngine.discountFor(
            address(this),
            timeToMaturity,
            factory.getMinMaturity(),
            factory.getMaxMaturity(),
            factory.getMinDiscount(),
            factory.getMaxDiscount()
        );
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
        (uint8 t, uint256 p) = discountCurveEngine.curveOf(address(this));
        return (t, factory.getMaxDiscount(), factory.getMaxMaturity(), p);
    }
    
    /// @notice Set discount curve configuration
    /// @dev The shape only. The maximum discount and maturity it is drawn between are the
    /// factory's, shared by every collection -- this took them as arguments once, checked them,
    /// and kept nothing, so a collection looked configured to bounds it was not using. The event
    /// reports the bounds that actually apply.
    /// @param _curveType Type of curve (0=linear, 1=bonding, 2=logarithmic, 3=custom)
    /// @param _curveParameter Curve-specific parameter (steepness, base), 10,000 = 1.0
    function setDiscountCurve(uint8 _curveType, uint256 _curveParameter) external override onlyOwner {
        // Curve-type and parameter validation lives with the curve.
        discountCurveEngine.setCurve(_curveType, _curveParameter);

        emit DiscountCurveUpdated(_curveType, factory.getMaxDiscount(), factory.getMaxMaturity(), _curveParameter);
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
    
    // `getCollectionMetadata()` is gone (Phase 2c): it repeated `name()`, `symbol()`,
    // `description()`, `getUnderlyingToken()` and `totalBondsMinted()`, nothing read it, and its
    // bytes put the collection over EIP-170 once the build changed around it.
    
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
            creator: holder,
            issuedAt: uint64(block.timestamp)
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
        // A pledged bond pays out only under its Maturity Instruction, through `settle`, which
        // splits it and releases the pledge in the same transaction (MB-05 §5.6).
        if (_isPledged(msg.sender, bondId)) revert BurnerBondPledged(bondId);

        uint256 faceValue = bonds[bondId].faceValue;
        _retire(bondId, msg.sender, faceValue);

        // Paid out of the bond vault, which holds the proceeds and nothing else's. Redemption
        // does not compete with default coverage, and cannot fail because the credit book had a
        // bad quarter.
        bondVault.settle(bondId, msg.sender);

        emit BondRedeemed(bondId, msg.sender, faceValue);
    }

    /* ========== ADMIN FUNCTIONS ========== */
    
    // The factory's discount, maturity and face-value bounds are global and set on the factory
    // by its owner. This contract used to carry setters that forwarded to it; the factory's
    // setters are owner-only and the caller there was this contract, so every one reverted.
    /* ========== COLLATERAL ========== */

    /// @notice what a bond is worth today, rather than at maturity.
    /// @dev A zero-coupon bond accretes from what was paid for it toward what it will pay,
    /// straight-line across its term. Half way through, half the discount has been earned.
    ///
    /// This is the number a bond is worth as collateral, and the number `payPledged` pays.
    /// Paying face for a bond that has not matured would hand over interest nobody has waited for.
    /// @param bondId the bond
    /// @return the bond's value now
    function presentValueOf(uint256 bondId) public view returns (uint256) {
        return _presentValue(bondId);
    }

    /// @notice a bond's Accreted Value in this block: its Present Value under MB-05, and what
    /// `payPledged` pays (IV-01 §4.9(b)).
    /// @dev The same figure as `presentValueOf`. Phase 2f replaces straight-line accretion with
    /// the Earn spec's compounding at the Issue Yield; both answer here.
    function accretedValue(uint256 bondId) external view returns (uint256) {
        return _presentValue(bondId);
    }

    /// @notice pays a pledged bond under its pledge payment term (IV-01 §4.9; MB-05 §7.3(a)).
    /// @dev Anyone may call it. It succeeds only when the pledge module (the Liquidator) reports
    /// that MB-05 permits enforcement against this bond -- a default after notice and cure as
    /// recorded on chain, or a Shortfall uncured past its wait -- and only for the bond the module
    /// requests. It pays `accretedValue` in this block, in full (FIXED: never less than Present
    /// Value), applies it only to the Holder's MB-05 secured debt in the module's order, sends any
    /// surplus in USDC to the Holder, releases the pledge and burns the bond. No argument but the
    /// id, so no caller chooses an amount, a destination or a debt. Not a buyback.
    /// Runs in BurnerBondPledges.
    function payPledged(uint256) external returns (uint256) {
        _forward();
    }

    /// @notice settles a matured bond that pays out rather than rolls. Anyone may call it.
    /// @dev An unpledged bond pays its face value to its holder. A pledged one is split under its
    /// Maturity Instruction (MB-05 §5.6): `toDebt` is what keeps the Holder's Asset-Backed Drawn
    /// within their limit once this bond is gone, applied to that debt on their own instruction;
    /// `toHolder` is the rest, in USDC, unrestricted. The pledge releases and the bond burns in the
    /// same transaction. Runs in BurnerBondPledges.
    /// @return toDebt applied to the Holder's Asset-Backed Drawn.
    /// @return toHolder owed to the Holder (paid now, or recorded as a settlement shortfall).
    function settle(uint256) external returns (uint256, uint256) {
        _forward();
    }

    /// @dev Runs the pledge module's implementation of this call against this contract's storage,
    /// and returns or reverts exactly as it did.
    function _forward() private {
        address target = pledges;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
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
    /// A pledged bond rolls like any other; its pledge moves to the replacement.
    /// @param bondId the matured bond
    /// @return newBondId the replacement
    function rollBond(uint256 bondId) external nonReentrant returns (uint256 newBondId) {
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
        // A pledged bond's pledge moves to its replacement. Burning the old id used to leave the
        // registry holding a pledge on nothing, valued at nothing, under credit still drawn.
        if (address(encumbranceSource) != address(0) && collateralKind != bytes32(0)) {
            encumbranceSource.rollItem(msg.sender, collateralKind, bondId, newBondId);
        }
        emit BondRolled(bondId, newBondId, rolledValue);
    }

    /// @notice where this collection's bond ids start, set before it has sold anything.
    /// @dev The BondVault and the CollateralRegistry key a bond by its id alone, so two collections
    /// sharing them must never issue the same one. A collection that replaces another starts above
    /// every id the old one has issued or will issue by rolling.
    function setFirstBondId(uint256 firstId) external onlyOwner {
        require(totalBondsMinted == 0, "Bonds already issued");
        require(firstId >= 1, "Ids start at 1");
        _bondIdCounter._value = firstId;
    }

    /// @notice sets how long a rolled bond runs for.
    function setRollTerm(uint256 _rollTerm) external onlyOwner {
        require(_rollTerm >= factory.getMinMaturity(), "Roll term too short");
        require(_rollTerm <= factory.getMaxMaturity(), "Roll term too long");
        rollTerm = _rollTerm;
    }

    /// @notice sets the contract reporting which bonds are pledged, and the kind to ask about.
    function setEncumbranceSource(address source, bytes32 kind) external onlyOwner {
        encumbranceSource = IBondEncumbrance(source);
        collateralKind = kind;
    }

    /// @notice names the pledge module's enforcement side (the Liquidator) -- after a delay (audit M-6).
    /// @dev Takes effect at once only where nobody can be harmed by it: removing the liquidator
    /// (which only takes power away), or naming the first one before any bond exists. Otherwise
    /// it is a proposal that `executeLiquidatorChange` applies after `LIQUIDATOR_DELAY`, so the
    /// owner can no longer name itself and take every bond in the same breath.
    function setLiquidator(address _liquidator) external onlyOwner {
        if (_liquidator == address(0) || (liquidator == address(0) && totalBondsMinted == 0)) {
            liquidator = _liquidator;
            pendingLiquidator = address(0);
            pendingLiquidatorReadyAt = 0;
            emit LiquidatorUpdated(_liquidator);
            return;
        }
        pendingLiquidator = _liquidator;
        pendingLiquidatorReadyAt = block.timestamp + LIQUIDATOR_DELAY;
        emit LiquidatorProposed(_liquidator, pendingLiquidatorReadyAt);
    }

    /// @notice applies a proposed liquidator once its delay has passed.
    function executeLiquidatorChange() external onlyOwner {
        uint256 readyAt = pendingLiquidatorReadyAt;
        if (readyAt == 0 || block.timestamp < readyAt) revert BurnerBondLiquidatorNotReady(readyAt);
        liquidator = pendingLiquidator;
        pendingLiquidator = address(0);
        pendingLiquidatorReadyAt = 0;
        emit LiquidatorUpdated(liquidator);
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
