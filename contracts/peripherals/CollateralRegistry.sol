// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "../core/interfaces/stable-credit/IExposureSource.sol";
import "../core/interfaces/stable-credit/IEncumbranceSource.sol";
import "../core/interfaces/stable-credit/ICollateralValuer.sol";
import "../core/interfaces/stable-credit/ICreditPositionSource.sol";
import "../core/interfaces/stable-credit/INetworkRegistry.sol";
import "../libraries/ExposureMath.sol";

/// @dev The one view the registry reads from a revolving issuer after a missed cycle (spec 12.5).
interface IUnsecuredExcessSource {
    function unsecuredExcessOf(address member) external view returns (uint256);
}

/// @title CollateralRegistry
/// @notice What each member has pledged, and what the AssurancePool would pay if it all defaulted.
/// @dev Two jobs that are really one. Pool exposure is not a property of a debt or of a pledge
/// separately -- it is the gap between what is owed and what the pledge behind it would realize --
/// so whatever knows about pledges is where the two get put together.
///
/// Exposure is maintained, not iterated. Summing over every member on read does not scale, and
/// summing over every member on write scales worse. Instead each member's exposure is computed
/// from their own positions, which are few, and a running total is adjusted by the difference
/// whenever one of them changes. `refresh` is permissionless so the total can be corrected by
/// anyone rather than only by whoever caused the change.
///
/// Haircuts are per collateral type and governed. An internal claim -- a bond, a pool share -- is
/// a claim on the co-op itself, and seizing it cancels an obligation rather than realizing an
/// asset, so it is haircut against known redemption terms. An external asset has a market price.
/// Sharing a haircut between them over-reserves one and under-reserves the other.
contract CollateralRegistry is
    IExposureSource,
    IEncumbranceSource,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice May move a pledge from an item it is retiring to the one it issues in its place.
    /// @dev A bond collection, for `rollItem`. Granted per collection: whoever holds it can move
    /// any member's pledge under any kind, so it goes only to a contract that moves its own.
    bytes32 public constant ITEM_ROLLER_ROLE = keccak256("ITEM_ROLLER_ROLE");

    /// @notice A kind of pledge, and the terms it is valued on.
    struct CollateralType {
        /// @dev How exposure treats debt drawn under this kind.
        ExposureMath.Backing backing;
        /// @dev Assumed realizable share of the pledged value, in basis points.
        uint256 haircutBps;
        /// @dev What one unit of the pledge is worth in ledger units, scaled by 1e18.
        /// @dev Carries the exchange rate and the decimal difference together, because splitting
        /// them invites getting one right and the other wrong. CLRUSD at par against a six-decimal
        /// ledger is 1e18; an eighteen-decimal token worth a dollar against the same ledger is
        /// 1e6, since one of its units is a millionth of a millionth of a ledger unit.
        uint256 unitPrice;
        /// @dev Asked what the pledge is worth, when a flat price will not do. A bond is worth
        /// something different every day; a dollar of savings is not.
        address valuer;
        bool registered;
    }

    INetworkRegistry public networkRegistry;

    /// @dev kind => terms
    mapping(bytes32 => CollateralType) public collateralTypes;
    bytes32[] private kinds;

    /// @dev member => kind => units pledged
    mapping(address => mapping(bytes32 => uint256)) public pledgedOf;
    /// @dev member => kind => the individual items pledged, for collateral that comes in items
    /// rather than amounts. A bond is one thing with an identity; a dollar is not.
    mapping(address => mapping(bytes32 => uint256[])) private pledgedItems;
    /// @dev member => kind => item => pledged
    mapping(address => mapping(bytes32 => mapping(uint256 => bool))) private itemPledged;
    /// @dev member => exposure last folded into the running total
    mapping(address => uint256) public recordedExposureOf;

    /// @notice What the AssurancePool would pay across every member, as last recorded.
    uint256 public totalExposure;

    /// @notice The collateral kind that is held as CLRUSD in the member's own account.
    /// @dev The one kind whose lock the token itself can enforce, because the member holds it
    /// directly rather than having pledged something held elsewhere.
    bytes32 public clrusdKind;

    /// @notice The CLRUSD token whose balance a savings pledge is valued against.
    /// @dev A pledge is a number an operator script writes; the savings behind it can be moved
    /// while nothing is drawn. So a CLRUSD pledge is worth what the member still holds, never more
    /// than what was pledged (audit C-2, DECISIONS #2). Appended from the gap.
    address public clrusdToken;

    /// @notice The next nonce a member's signature over a pledge must carry (Phase 4b, L-I).
    /// @dev Appended from the gap.
    mapping(address => uint256) public pledgeNonces;

    /* ========== ADDED IN PHASE 2E (section 9): three slots from the gap ========== */

    /// @notice member => kind => item => hash of the Maturity Instruction the member signed when
    /// pledging it (MB-05 §5.6). A bond pledge without one reverts.
    mapping(address => mapping(bytes32 => mapping(uint256 => bytes32))) public maturityInstructionOf;
    /// @dev member => kind => item => advance rate (bps of Present Value) stored at pledging.
    mapping(address => mapping(bytes32 => mapping(uint256 => uint256))) private _itemAdvanceBps;
    /// @dev member => kind => advance rate (bps of Pool Share Value) stored at pledging, blended by
    /// units across the member's pledges of that kind.
    mapping(address => mapping(bytes32 => uint256)) private _advanceBps;

    uint256[37] private __gap;

    /// @notice What a member signs to pledge an amount of a kind (Phase 4b, L-I).
    bytes32 public constant PLEDGE_TYPEHASH =
        keccak256("Pledge(address member,bytes32 kind,uint256 amount,uint256 nonce,uint256 deadline)");
    /// @notice What a member signs to pledge one item of a kind (Phase 4b, L-I), with the hash of
    /// the Maturity Instruction that goes with it (Phase 2e, section 9; MB-05 §5.6).
    bytes32 public constant PLEDGE_ITEM_TYPEHASH = keccak256(
        "PledgeItem(address member,bytes32 kind,uint256 itemId,bytes32 maturityInstruction,uint256 nonce,uint256 deadline)"
    );

    error CollateralRegistryInvalidAddress();
    error CollateralRegistryUnknownType(bytes32 kind);
    error CollateralRegistryTypeExists(bytes32 kind);
    error CollateralRegistryHaircutTooHigh(uint256 haircutBps);
    error CollateralRegistryEncumbered(address member, bytes32 kind, uint256 free, uint256 amount);
    /// @notice thrown when anything would change how the CLRUSD lock is computed once it is live.
    /// @dev Compliance spec 10a: the lock is computed from on-chain state and no admin can set,
    /// extend or hold one -- including indirectly, by re-pricing the collateral it is computed from.
    error CollateralRegistryClrusdTermsFixed();
    /// @notice thrown when a pledge's signature has expired (Phase 4b, L-I).
    error CollateralRegistrySignatureExpired(uint256 deadline);
    /// @notice thrown when a pledge is not signed by the member it pledges for (Phase 4b, L-I).
    error CollateralRegistryBadSignature(address member);
    /// @notice thrown when an item pledge carries no Maturity Instruction (Phase 2e, section 9).
    error CollateralRegistryNoMaturityInstruction(address member, uint256 itemId);

    event CollateralTypeRegistered(
        bytes32 indexed kind, ExposureMath.Backing backing, uint256 haircutBps
    );
    event CollateralTypeUpdated(bytes32 indexed kind, uint256 haircutBps, uint256 unitPrice);
    event CollateralValuerUpdated(bytes32 indexed kind, address valuer);
    event Pledged(address indexed member, bytes32 indexed kind, uint256 amount);
    event Released(address indexed member, bytes32 indexed kind, uint256 amount);
 event Seized(address indexed member, bytes32 indexed kind, uint256 amount);
    event ItemPledged(address indexed member, bytes32 indexed kind, uint256 itemId);
    event ItemReleased(address indexed member, bytes32 indexed kind, uint256 itemId);
    event ItemSeized(address indexed member, bytes32 indexed kind, uint256 itemId);
    event ItemRolled(address indexed member, bytes32 indexed kind, uint256 oldItemId, uint256 newItemId);
    /// @notice An item was pledged with this advance rate and Maturity Instruction (Phase 2e).
    event ItemPledgeTerms(
        address indexed member, bytes32 indexed kind, uint256 itemId, uint256 advanceBps, bytes32 maturityInstruction
    );
    /// @notice An amount pledge's stored advance rate after a pledge (Phase 2e).
    event PledgeAdvanceRate(address indexed member, bytes32 indexed kind, uint256 advanceBps);
    event ExposureRefreshed(address indexed member, uint256 previous, uint256 current);
    event ClrusdKindUpdated(bytes32 indexed kind);
    event ClrusdTokenUpdated(address indexed token);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address _networkRegistry) external initializer {
        if (admin == address(0) || _networkRegistry == address(0)) {
            revert CollateralRegistryInvalidAddress();
        }
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        networkRegistry = INetworkRegistry(_networkRegistry);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @notice every registered collateral kind.
    function collateralKinds() external view returns (bytes32[] memory) {
        return kinds;
    }

    /// @notice What one unit price is scaled by.
    uint256 public constant PRICE_SCALE = 1e18;

    /// @notice the value of what a member has pledged under one kind, before the haircut.
    /// @dev A valuer is asked when there is one, because some collateral is worth something
    /// different every day and a price somebody has to remember to update is a price that is
    /// usually stale.
    function collateralValueOf(address member, bytes32 kind) public view returns (uint256) {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;

        if (collateral.valuer != address(0)) {
            uint256[] storage items = pledgedItems[member][kind];
            if (items.length == 0) return 0;
            try ICollateralValuer(collateral.valuer).valueOfItems(member, items) returns (
                uint256 valued
            ) {
                return valued;
            } catch {
                // A valuer that cannot answer values the pledge at nothing rather than at
                // whatever it was last worth. Under-valuing shrinks a limit; over-valuing lends
                // against something nobody can price.
                return 0;
            }
        }

        uint256 units = _unitsHeld(member, kind);
        if (units == 0) return 0;
        return (units * collateral.unitPrice) / PRICE_SCALE;
    }

    /// @notice the pledged units that are actually still there.
    /// @dev For CLRUSD, the lesser of what was pledged and what the member holds. The pledge is not
    /// locked (DECISIONS #2: locking it would conflict with DFAL 10a), so savings moved away while
    /// nothing was drawn stop counting the moment they leave (audit C-2). With no token set the
    /// holding cannot be read, and it counts as nothing rather than as the pledge.
    function _unitsHeld(address member, bytes32 kind) private view returns (uint256) {
        uint256 units = pledgedOf[member][kind];
        if (units == 0 || kind != clrusdKind) return units;
        if (clrusdToken == address(0)) return 0;
        uint256 held = IERC20Upgradeable(clrusdToken).balanceOf(member);
        return held < units ? held : units;
    }

    /// @notice how much more a member may draw against a collateral kind, given what backs it now.
    /// @dev Read by the revolving line before it fills the savings tier, at the moment of the draw
    /// (audit C-2). Only the CLRUSD kind is limited this way; for every other kind the answer is
    /// "no limit from here", and the tier's capacity is what bounds it.
    /// @param member address of the member.
    /// @param kind collateral kind of the tier being drawn.
    /// @return the most that may still be drawn against it.
    function backedHeadroomOf(address member, bytes32 kind) external view returns (uint256) {
        if (kind == bytes32(0) || kind != clrusdKind) return type(uint256).max;
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        uint256 backs =
            (collateralValueOf(member, kind) * collateral.haircutBps) / ExposureMath.BPS;
        uint256 drawn = _drawnUnder(member, kind);
        return backs > drawn ? backs - drawn : 0;
    }

    /// @notice the individual items a member has pledged under one kind.
    function pledgedItemsOf(address member, bytes32 kind) external view returns (uint256[] memory) {
        return pledgedItems[member][kind];
    }

    /// @notice whether a member has pledged this item and it has not been released.
    /// @dev Pledged, whether or not anything is drawn against it: what `payPledged` and the pledged
    /// maturity split ask (IV-01 §4.9(d)). `isItemEncumbered` asks the narrower question.
    function isItemPledged(address holder, bytes32 kind, uint256 itemId) external view returns (bool) {
        return itemPledged[holder][kind][itemId];
    }

    /// @notice the advance rate a member's amount pledge of a kind carries (section 9): the rate
    /// stored when they pledged, blended by units across their pledges of that kind. A pledge made
    /// before Phase 2e stored none and carries the kind's governed rate.
    function advanceBpsOf(address member, bytes32 kind) public view returns (uint256) {
        uint256 stored = _advanceBps[member][kind];
        return stored != 0 ? stored : collateralTypes[kind].haircutBps;
    }

    /// @notice the advance rate stored with one pledged item when it was pledged (section 9);
    /// the kind's governed rate for an item pledged before Phase 2e.
    function itemAdvanceBpsOf(address member, bytes32 kind, uint256 itemId) public view returns (uint256) {
        uint256 stored = _itemAdvanceBps[member][kind][itemId];
        return stored != 0 ? stored : collateralTypes[kind].haircutBps;
    }

    /// @notice what a member's pledge of one kind lends against: each pledged item's value at the
    /// advance rate stored with it, or the pledged amount's value at its stored rate (section 9).
    /// @dev The figure LimitCalculator writes as the tier's capacity and the Liquidator measures a
    /// shortfall against. A governed rate change reaches new pledges, not ones already made.
    /// @param excludeItem an item to leave out (zero for none): the pledged maturity split asks for
    /// the limit the member has without the bond that is maturing (MB-05 §5.6).
    function advancedValueOf(address member, bytes32 kind, uint256 excludeItem)
        public
        view
        returns (uint256 value)
    {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        if (collateral.valuer == address(0)) {
            // Savings keep the kind's own terms, fixed once the CLRUSD lock is live (spec 10a).
            uint256 rate = kind == clrusdKind ? collateral.haircutBps : advanceBpsOf(member, kind);
            return (collateralValueOf(member, kind) * rate) / ExposureMath.BPS;
        }
        uint256[] storage items = pledgedItems[member][kind];
        uint256[] memory one = new uint256[](1);
        for (uint256 i = 0; i < items.length; i++) {
            uint256 itemId = items[i];
            if (itemId == excludeItem) continue;
            one[0] = itemId;
            try ICollateralValuer(collateral.valuer).valueOfItems(member, one) returns (uint256 v) {
                value += (v * itemAdvanceBpsOf(member, kind, itemId)) / ExposureMath.BPS;
            } catch {
                // Valued at nothing, as `collateralValueOf` does: under-valuing shrinks a limit.
            }
        }
    }

    /// @inheritdoc IEncumbranceSource
    /// @dev Whether one specific thing is spoken for. Amount-based collateral answers "how much
    /// must stay"; a bond has to answer "may this one leave", because half a bond is not a thing.
    function isItemEncumbered(address holder, bytes32 kind, uint256 itemId)
        external
        view
        override
        returns (bool)
    {
        if (!itemPledged[holder][kind][itemId]) return false;
        // Pledged, and still needed: a pledge that nothing is drawn against is free to go -- unless
        // a missed cycle left an unsecured excess this Earn pledge has to settle (spec 12.5).
        return _drawnUnder(holder, kind) > 0
            || (_excessLockApplies(kind, collateralTypes[kind]) && unsecuredExcessOf(holder) > 0);
    }

    /// @notice what a member owes above their halved unsecured limit after a missed cycle, summed
    /// over their issuers (spec 12.5). Zero otherwise.
    /// @dev Asked with a plain static call, so an issuer without the view (a term issuer, or one
    /// from before section 12) answers zero rather than reverting every lock read.
    function unsecuredExcessOf(address member) public view returns (uint256 excess) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (bool ok, bytes memory data) = issuers[i].staticcall(
                abi.encodeWithSelector(IUnsecuredExcessSource.unsecuredExcessOf.selector, member)
            );
            if (ok && data.length >= 32) excess += abi.decode(data, (uint256));
        }
    }

    /// @dev Only an Earn pledge (an internal claim: a bond or a pool share) settles an unsecured
    /// excess. Savings never do (spec 12.5), and an external asset is not Earn.
    function _excessLockApplies(bytes32 kind, CollateralType storage collateral)
        private
        view
        returns (bool)
    {
        return kind != clrusdKind && collateral.backing == ExposureMath.Backing.AssetInternal;
    }

    /// @notice what the pool would pay if this member defaulted on everything.
    /// @dev Walks the member's own positions, which are a handful of tiers and a handful of
    /// plans. Savings-backed contributes nothing, asset-backed contributes the shortfall left
    /// after its haircut, and anything else contributes in full.
    function exposureOf(address member) public view returns (uint256 exposure) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (bytes32[] memory positionKinds, uint256[] memory amounts) =
                ICreditPositionSource(issuers[i]).debtByKind(member);

            for (uint256 j = 0; j < positionKinds.length; j++) {
                bytes32 kind = positionKinds[j];
                CollateralType storage collateral = collateralTypes[kind];
                exposure += ExposureMath.positionExposure(
                    collateral.registered ? collateral.backing : ExposureMath.backingOf(kind),
                    amounts[j],
                    collateralValueOf(member, kind),
                    collateral.haircutBps
                );
            }
        }
    }

    /// @notice how much of a member's pledge under one kind is not backing anything.
    /// @dev A pledge is locked while the credit it backs is drawn. Freeing it while the debt
    /// stands would leave the pool covering a position it had been told was collateralized.
    function freeCollateralOf(address member, bytes32 kind) public view returns (uint256) {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        uint256 units = pledgedOf[member][kind];
        if (units == 0) return 0;

        uint256 required = _requiredUnits(member, kind, collateral);
        return units > required ? units - required : 0;
    }

    /// @notice the units of a kind that must stay pledged to cover what is drawn under it.
    function _requiredUnits(address member, bytes32 kind, CollateralType storage collateral)
        private
        view
        returns (uint256)
    {
        uint256 drawn = _drawnUnder(member, kind);
        if (drawn == 0) return 0;
        // The rate stored with the member's pledge (section 9), so a later governed change cannot
        // lock more of what they already pledged. The CLRUSD lock keeps the kind's own terms, which
        // are fixed once it is live (spec 10a).
        uint256 rate = kind == clrusdKind ? collateral.haircutBps : advanceBpsOf(member, kind);
        // Collateral that realizes nothing can never free itself while anything is drawn on it.
        if (rate == 0 || collateral.unitPrice == 0) return type(uint256).max;

        // The value the haircut has to reach, converted back into units. Rounded up at each step
        // and multiplied before dividing: rounding down left the lock a few units short of what is
        // drawn (audit L-6).
        uint256 neededValue =
            Math.mulDiv(drawn, ExposureMath.BPS, rate, Math.Rounding.Up);
        return Math.mulDiv(neededValue, PRICE_SCALE, collateral.unitPrice, Math.Rounding.Up);
    }

    /// @notice a member's outstanding principal drawn under one kind.
    function _drawnUnder(address member, bytes32 kind) private view returns (uint256 drawn) {
        address[] memory issuers = networkRegistry.issuersOf(member);
        for (uint256 i = 0; i < issuers.length; i++) {
            (bytes32[] memory positionKinds, uint256[] memory amounts) =
                ICreditPositionSource(issuers[i]).debtByKind(member);
            for (uint256 j = 0; j < positionKinds.length; j++) {
                if (positionKinds[j] == kind) drawn += amounts[j];
            }
        }
    }

    /// @inheritdoc IExposureSource
    function poolExposure() external view override returns (uint256) {
        return totalExposure;
    }

    /// @inheritdoc IEncumbranceSource
    /// @dev The credit line's own rule, read from the asset's side: withdrawable CLRUSD is the
    /// balance less what has been drawn against it. Scales with the draw rather than the pledge,
    /// so a member who has drawn nothing is not locked up and one who repays sees the lock
    /// recede. There is no pay-back date and no pay button; this is the enforcement.
    function encumberedOf(address holder) external view override returns (uint256) {
        bytes32 kind = clrusdKind;
        if (kind == bytes32(0)) return 0;
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        return _requiredUnits(holder, kind, collateral);
    }

    /// @inheritdoc IEncumbranceSource
    function encumberedOfKind(address holder, bytes32 kind)
        external
        view
        override
        returns (uint256)
    {
        CollateralType storage collateral = collateralTypes[kind];
        if (!collateral.registered) return 0;
        uint256 required = _requiredUnits(holder, kind, collateral);
        // After a missed cycle the Earn pledge also stands behind the unsecured excess until the
        // Liquidator settles it (spec 12.5): enough of it, on top of what its own tier needs, to
        // cover that excess on its own, and never more than was pledged. Computed from the
        // issuers' own state; no role sets it.
        if (_excessLockApplies(kind, collateral)) {
            uint256 excess = unsecuredExcessOf(holder);
            uint256 pledged = pledgedOf[holder][kind];
            if (excess > 0 && required < pledged) {
                uint256 units = collateral.unitPrice == 0
                    ? pledged
                    : Math.mulDiv(excess, PRICE_SCALE, collateral.unitPrice, Math.Rounding.Up);
                required = units >= pledged - required ? pledged : required + units;
            }
        }
        return required;
    }

    /// @notice names the CLRUSD token a savings pledge is valued against.
    /// @dev Admin, not operator: pointing this at a token that reports any balance it likes would
    /// reopen the hole it closes (audit C-2).
    function setClrusdToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert CollateralRegistryInvalidAddress();
        clrusdToken = token;
        emit ClrusdTokenUpdated(token);
    }

    /// @notice names the collateral kind held as CLRUSD in members' own accounts.
    function setClrusdKind(bytes32 kind) external onlyRole(OPERATOR_ROLE) {
        if (kind != bytes32(0) && !collateralTypes[kind].registered) {
            revert CollateralRegistryUnknownType(kind);
        }
        // Set once (spec 10a): pointing the lock at another kind would change what it locks.
        if (clrusdKind != bytes32(0)) revert CollateralRegistryClrusdTermsFixed();
        clrusdKind = kind;
        emit ClrusdKindUpdated(kind);
    }

    /* ========== MUTATIVE ========== */

    /// @notice recomputes a member's exposure and folds the difference into the total.
    /// @dev Permissionless. Anyone may correct the running total, so a missed call by whoever
    /// caused a change does not leave the figure the AssurancePool reserves against stale.
    /// @param member address of the member.
    /// @return the member's exposure now.
    function refresh(address member) public returns (uint256) {
        uint256 previous = recordedExposureOf[member];
        uint256 current = exposureOf(member);
        if (current != previous) {
            totalExposure = totalExposure + current - previous;
            recordedExposureOf[member] = current;
            emit ExposureRefreshed(member, previous, current);
        }
        return current;
    }

    /// @notice records a pledge.
    /// @dev Records rather than escrows. The member's smart account holds the collateral, and an
    /// ERC-7579 module on that account is what actually stops it moving while encumbered. This is
    /// the ledger of what was promised; enforcement lives where the asset does.
    ///
    /// The member consents to every pledge (Phase 4b, L-I): the operator submits, but only with the
    /// member's EIP-712 signature over this pledge (EIP-1271 for a smart account), the same shape as
    /// plan terms. A pledge encumbers what is pledged -- under 12.5's excess lock even an Earn asset
    /// -- so an operator key alone must not be able to put a member's assets behind their credit.
    /// @param member address pledging.
    /// @param kind collateral type.
    /// @param amount units pledged.
    /// @param deadline last second the signature is good for.
    /// @param signature the member's signature over `Pledge` at their current nonce.
    function pledge(address member, bytes32 kind, uint256 amount, uint256 deadline, bytes calldata signature)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        _consumePledgeSignature(member, PLEDGE_TYPEHASH, kind, amount, bytes32(0), deadline, signature);
        // Section 9: the advance rate is stored at pledging. Units already pledged keep theirs, so
        // the stored figure is the units-weighted blend of the two.
        uint256 before = pledgedOf[member][kind];
        uint256 rate = collateralTypes[kind].haircutBps;
        if (before != 0) rate = (advanceBpsOf(member, kind) * before + rate * amount) / (before + amount);
        _advanceBps[member][kind] = rate;
        pledgedOf[member][kind] = before + amount;
        emit Pledged(member, kind, amount);
        emit PledgeAdvanceRate(member, kind, rate);
        refresh(member);
    }

    /// @notice records a pledge of one specific thing.
    /// @dev For collateral with an identity. The registry records which one, because refusing to
    /// let it move and valuing it both need to know that. Signed by the member, like `pledge`.
    ///
    /// Section 9 (Phase 2e): the member's signature also covers the hash of the Maturity
    /// Instruction for this bond (MB-05 §5.6), and the pledge reverts without one. The hash and the
    /// kind's advance rate at this moment are stored with the item; the rate is the one this item
    /// lends at for as long as it stays pledged.
    /// @param maturityInstruction hash of the Maturity Instruction the member approved.
    function pledgeItem(
        address member,
        bytes32 kind,
        uint256 itemId,
        bytes32 maturityInstruction,
        uint256 deadline,
        bytes calldata signature
    ) external onlyRole(OPERATOR_ROLE) {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        if (maturityInstruction == bytes32(0)) revert CollateralRegistryNoMaturityInstruction(member, itemId);
        _consumePledgeSignature(member, PLEDGE_ITEM_TYPEHASH, kind, itemId, maturityInstruction, deadline, signature);
        if (itemPledged[member][kind][itemId]) return;
        itemPledged[member][kind][itemId] = true;
        pledgedItems[member][kind].push(itemId);
        uint256 rate = collateralTypes[kind].haircutBps;
        _itemAdvanceBps[member][kind][itemId] = rate;
        maturityInstructionOf[member][kind][itemId] = maturityInstruction;
        emit ItemPledged(member, kind, itemId);
        emit ItemPledgeTerms(member, kind, itemId, rate, maturityInstruction);
        refresh(member);
    }

    /// @notice releases one specific pledged thing.
    function releaseItem(address member, bytes32 kind, uint256 itemId)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (_drawnUnder(member, kind) > 0) {
            revert CollateralRegistryEncumbered(member, kind, 0, 1);
        }
        _dropItem(member, kind, itemId);
        emit ItemReleased(member, kind, itemId);
        refresh(member);
    }

    /// @notice moves a pledge from an item being retired to the one replacing it.
    /// @dev For a bond rolled at maturity: the matured id is burned and a new one issued for the
    /// same money, and the pledge has to follow or the credit drawn against it loses its backing
    /// the moment the old id stops existing. The collection calls this as it rolls, so the two
    /// cannot drift apart. Nothing happens if the old item was not pledged.
    function rollItem(address member, bytes32 kind, uint256 oldItemId, uint256 newItemId)
        external
        onlyRole(ITEM_ROLLER_ROLE)
    {
        if (!itemPledged[member][kind][oldItemId]) return;
        // The replacement is re-pledged on the same terms: the advance rate and Maturity
        // Instruction the member gave for the bond it replaces (section 9).
        uint256 rate = _itemAdvanceBps[member][kind][oldItemId];
        bytes32 instruction = maturityInstructionOf[member][kind][oldItemId];
        _dropItem(member, kind, oldItemId);
        if (!itemPledged[member][kind][newItemId]) {
            itemPledged[member][kind][newItemId] = true;
            pledgedItems[member][kind].push(newItemId);
            _itemAdvanceBps[member][kind][newItemId] = rate;
            maturityInstructionOf[member][kind][newItemId] = instruction;
        }
        emit ItemRolled(member, kind, oldItemId, newItemId);
        refresh(member);
    }

    /// @notice releases the pledge on an item its collection has just paid and burned.
    /// @dev For a bond settled at maturity under its Maturity Instruction, or paid under its
    /// pledge payment term: the bond is gone, its proceeds went where its terms say, and the pledge
    /// releases in the same transaction (MB-05 §5.6, IV-01 §4.9). Only a collection holding
    /// `ITEM_ROLLER_ROLE`, the role that already moves its own bonds' pledges on a roll.
    function releaseRetiredItem(address member, bytes32 kind, uint256 itemId)
        external
        onlyRole(ITEM_ROLLER_ROLE)
    {
        if (!itemPledged[member][kind][itemId]) return;
        _dropItem(member, kind, itemId);
        emit ItemReleased(member, kind, itemId);
        refresh(member);
    }

    /// @notice records that a pledged item was taken on default.
    function recordItemSeizure(address member, bytes32 kind, uint256 itemId)
        external
        onlyRole(OPERATOR_ROLE)
    {
        _dropItem(member, kind, itemId);
        emit ItemSeized(member, kind, itemId);
        refresh(member);
    }

    /// @notice the EIP-712 domain pledge signatures are made in.
    /// @dev Computed rather than stored: EIP712Upgradeable would add storage ahead of this
    /// contract's own, which an upgrade may not do.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Clear CollateralRegistry")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice the digest a member signs to pledge an amount of `kind`, at their current nonce.
    function pledgeDigest(address member, bytes32 kind, uint256 amount, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _pledgeDigest(PLEDGE_TYPEHASH, member, kind, amount, bytes32(0), pledgeNonces[member], deadline);
    }

    /// @notice the digest a member signs to pledge item `itemId` of `kind` with the Maturity
    /// Instruction whose hash is `maturityInstruction`, at their current nonce (section 9).
    function pledgeItemDigest(
        address member,
        bytes32 kind,
        uint256 itemId,
        bytes32 maturityInstruction,
        uint256 deadline
    ) external view returns (bytes32) {
        return _pledgeDigest(
            PLEDGE_ITEM_TYPEHASH, member, kind, itemId, maturityInstruction, pledgeNonces[member], deadline
        );
    }

    /// @dev An item pledge's struct carries the Maturity Instruction hash between the item and the
    /// nonce; an amount pledge's struct has no such field.
    function _pledgeDigest(
        bytes32 typehash,
        address member,
        bytes32 kind,
        uint256 amountOrItem,
        bytes32 maturityInstruction,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes32) {
        bytes32 structHash = typehash == PLEDGE_ITEM_TYPEHASH
            ? keccak256(abi.encode(typehash, member, kind, amountOrItem, maturityInstruction, nonce, deadline))
            : keccak256(abi.encode(typehash, member, kind, amountOrItem, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @dev Checks the member's signature over this pledge and uses up their nonce.
    function _consumePledgeSignature(
        address member,
        bytes32 typehash,
        bytes32 kind,
        uint256 amountOrItem,
        bytes32 maturityInstruction,
        uint256 deadline,
        bytes calldata signature
    ) private {
        if (block.timestamp > deadline) revert CollateralRegistrySignatureExpired(deadline);
        bytes32 digest = _pledgeDigest(
            typehash, member, kind, amountOrItem, maturityInstruction, pledgeNonces[member]++, deadline
        );
        if (!SignatureChecker.isValidSignatureNow(member, digest, signature)) {
            revert CollateralRegistryBadSignature(member);
        }
    }

    function _dropItem(address member, bytes32 kind, uint256 itemId) private {
        if (!itemPledged[member][kind][itemId]) return;
        itemPledged[member][kind][itemId] = false;
        delete _itemAdvanceBps[member][kind][itemId];
        delete maturityInstructionOf[member][kind][itemId];
        uint256[] storage items = pledgedItems[member][kind];
        for (uint256 i = 0; i < items.length; i++) {
            if (items[i] == itemId) {
                items[i] = items[items.length - 1];
                items.pop();
                break;
            }
        }
    }

    /// @notice releases a pledge that is not backing anything.
    /// @param member address releasing.
    /// @param kind collateral type.
    /// @param amount units to release.
    function release(address member, bytes32 kind, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        uint256 free = freeCollateralOf(member, kind);
        if (amount > free) revert CollateralRegistryEncumbered(member, kind, free, amount);
        pledgedOf[member][kind] -= amount;
        emit Released(member, kind, amount);
        refresh(member);
    }

    /// @notice records collateral taken from a member on default.
    /// @dev Distinct from `release`, which refuses to free anything backing drawn credit. That is
    /// exactly what a seizure takes, so it cannot go through the same door -- and if it did not go
    /// through any door the registry would go on counting collateral that is no longer there,
    /// reporting a position as covered by a pledge somebody else now holds.
    /// @param member address the collateral was taken from.
    /// @param kind collateral type.
    /// @param amount units taken.
    function recordSeizure(address member, bytes32 kind, uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        uint256 pledged = pledgedOf[member][kind];
        pledgedOf[member][kind] = amount > pledged ? 0 : pledged - amount;
        emit Seized(member, kind, amount);
        refresh(member);
    }

    /* ========== RESTRICTED ========== */

    /// @notice registers a kind of collateral and the terms it is valued on.
    /// @param kind tier kind this collateral backs.
    /// @param backing how exposure treats debt drawn under it.
    /// @param haircutBps assumed realizable share of pledged value, in basis points.
    /// @param unitPrice value of one unit in ledger units, scaled by 1e18.
    function registerCollateralType(
        bytes32 kind,
        ExposureMath.Backing backing,
        uint256 haircutBps,
        uint256 unitPrice
    ) external onlyRole(OPERATOR_ROLE) {
        if (collateralTypes[kind].registered) revert CollateralRegistryTypeExists(kind);
        if (haircutBps > ExposureMath.BPS) revert CollateralRegistryHaircutTooHigh(haircutBps);
        collateralTypes[kind] =
            CollateralType(backing, haircutBps, unitPrice, address(0), true);
        kinds.push(kind);
        emit CollateralTypeRegistered(kind, backing, haircutBps);
    }

    /// @notice revalues a collateral type.
    /// @dev Start the haircut high and lower it with evidence. Raising it, or marking a type down,
    /// increases what the pool reserves against every position drawn under it -- which is the
    /// point, and why the figure is governed rather than read from wherever the asset trades.
    function setCollateralTerms(bytes32 kind, uint256 haircutBps, uint256 unitPrice)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        if (haircutBps > ExposureMath.BPS) revert CollateralRegistryHaircutTooHigh(haircutBps);
        // A lower haircut or price on the CLRUSD kind would lock more of a member's CLRUSD for the
        // same draw: an indirect lock no admin may impose (spec 10a).
        if (kind == clrusdKind && kind != bytes32(0)) revert CollateralRegistryClrusdTermsFixed();
        collateralTypes[kind].haircutBps = haircutBps;
        collateralTypes[kind].unitPrice = unitPrice;
        emit CollateralTypeUpdated(kind, haircutBps, unitPrice);
    }

    /// @notice names the contract that values this kind of pledge.
    /// @dev Pass address(0) to fall back to the flat price. A valuer is for collateral whose
    /// worth moves without anybody touching it.
    function setCollateralValuer(bytes32 kind, address valuer) external onlyRole(OPERATOR_ROLE) {
        if (!collateralTypes[kind].registered) revert CollateralRegistryUnknownType(kind);
        if (kind == clrusdKind && kind != bytes32(0)) revert CollateralRegistryClrusdTermsFixed();
        collateralTypes[kind].valuer = valuer;
        emit CollateralValuerUpdated(kind, valuer);
    }
}
